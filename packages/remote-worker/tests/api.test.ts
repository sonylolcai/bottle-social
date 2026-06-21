import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../../shared/src/signatures";
import app from "../src/index";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

const testDir = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(resolve(testDir, "../migrations/0001_initial.sql"), "utf8");

type SqliteStatement = {
  all: (...values: unknown[]) => unknown[];
  get: (...values: unknown[]) => unknown;
  run: (...values: unknown[]) => unknown;
};

type SqliteDatabase = {
  close: () => void;
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};

type TestIdentity = {
  handle: string;
  privateKey: CryptoKey;
  publicKeyBase64: string;
};

const d1Meta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
};

class FakeD1PreparedStatement {
  readonly values: unknown[] = [];

  constructor(
    private readonly db: SqliteDatabase,
    readonly query: string,
    private readonly onRun?: (query: string) => void,
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    this.values.splice(0, this.values.length, ...values);
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.db.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return {
      results: this.db.prepare(this.query).all(...this.values) as T[],
      success: true,
      meta: d1Meta,
    };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    this.onRun?.(this.query);
    this.db.prepare(this.query).run(...this.values);
    return { results: [] as T[], success: true, meta: d1Meta };
  }
}

class FakeD1Database {
  private readonly db: SqliteDatabase;

  failDeliveryInBatch = false;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(migrationSql);
  }

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.db, query);
  }

  async batch<T = unknown>(statements: FakeD1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.db.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        const transactionalStatement = new FakeD1PreparedStatement(this.db, statement.query, (query) => {
          if (this.failDeliveryInBatch && /INSERT INTO deliveries/i.test(query)) {
            throw new Error("simulated delivery insert failure");
          }
        });
        transactionalStatement.bind(...statement.values);
        results.push(await transactionalStatement.run<T>());
      }
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

const toBase64 = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString("base64");

const createIdentity = async (handle: string): Promise<TestIdentity> => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    handle,
    privateKey: pair.privateKey,
    publicKeyBase64: toBase64(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
};

const request = (db: FakeD1Database, path: string, init?: RequestInit) =>
  app.request(path, init, { DB: db as unknown as D1Database });

const signedRequest = async (
  db: FakeD1Database,
  identity: TestIdentity,
  userId: string,
  path: string,
  init: RequestInit = {},
) => {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? init.body : "";
  const timestamp = "2026-06-21T00:00:00.000Z";
  const { signature } = await createSignedPayload({
    privateKey: identity.privateKey,
    method,
    path,
    timestamp,
    body,
  });
  const headers = new Headers(init.headers);
  headers.set("X-User-Id", userId);
  headers.set("X-Timestamp", timestamp);
  headers.set("X-Signature", signature);
  const requestInit: RequestInit = { ...init, method, headers };
  if (method !== "GET" && method !== "HEAD") {
    requestInit.body = body;
  }
  return request(db, path, requestInit);
};

const createUser = async (
  db: FakeD1Database,
  input: {
    identity: TestIdentity;
    language?: string;
    region?: string;
  },
) => {
  const response = await request(db, "/v1/users", {
    method: "POST",
    body: JSON.stringify({
      handle: input.identity.handle,
      publicKey: input.identity.publicKeyBase64,
      language: input.language ?? "en",
      region: input.region ?? "US",
      isAdult: true,
    }),
  });

  expect(response.status).toBe(200);
  return (await response.json()) as { id: string };
};

const createSignedUser = async (
  db: FakeD1Database,
  handle: string,
  options: { language?: string; region?: string } = {},
) => {
  const identity = await createIdentity(handle);
  const user = await createUser(db, { identity, ...options });
  return { ...identity, ...user };
};

const bottleBody = (content: string) => JSON.stringify({ content, language: "en" });

const submitBottle = async (
  db: FakeD1Database,
  user: TestIdentity & { id: string },
  content: string,
) =>
  signedRequest(db, user, user.id, "/v1/bottles", {
    method: "POST",
    body: bottleBody(content),
  });

const pullInbox = (db: FakeD1Database, user: TestIdentity & { id: string }) =>
  signedRequest(db, user, user.id, "/v1/inbox");

const pullReply = (
  db: FakeD1Database,
  user: TestIdentity & { id: string },
  deliveryId: string,
  content: string,
) =>
  signedRequest(db, user, user.id, `/v1/deliveries/${deliveryId}/replies`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });

const pullReplies = (db: FakeD1Database, user: TestIdentity & { id: string }) =>
  signedRequest(db, user, user.id, "/v1/replies");

describe("remote API routes", () => {
  let db: FakeD1Database;

  beforeEach(() => {
    db = new FakeD1Database();
  });

  it("creates active adult users with base64 raw Ed25519 public keys", async () => {
    const identity = await createIdentity("sender");
    const response = await request(db, "/v1/users", {
      method: "POST",
      body: JSON.stringify({
        handle: "sender",
        publicKey: identity.publicKeyBase64,
        language: "en",
        region: "US",
        isAdult: true,
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^usr_/);

    const row = await db
      .prepare("SELECT handle, public_key, is_adult, status FROM users WHERE id = ?")
      .bind(body.id)
      .first<{ handle: string; public_key: string; is_adult: number; status: string }>();
    expect(row).toEqual({
      handle: "sender",
      public_key: identity.publicKeyBase64,
      is_adult: 1,
      status: "active",
    });
  });

  it("requires signatures on personality upsert", async () => {
    const sender = await createSignedUser(db, "sender");
    const body = JSON.stringify({ openness: 4, energy: 3, warmth: 5, curiosity: 4, pace: 2 });

    const unsigned = await request(db, "/v1/personality", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body,
    });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ error: "MISSING_SIGNATURE_HEADERS" });

    const first = await signedRequest(db, sender, sender.id, "/v1/personality", {
      method: "POST",
      body,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });

    const second = await signedRequest(db, sender, sender.id, "/v1/personality", {
      method: "POST",
      body: JSON.stringify({ openness: 1, energy: 2, warmth: 3, curiosity: 4, pace: 5 }),
    });
    expect(second.status).toBe(200);

    const row = await db
      .prepare("SELECT openness, energy, warmth, curiosity, pace FROM personality_profiles WHERE user_id = ?")
      .bind(sender.id)
      .first<{ openness: number; energy: number; warmth: number; curiosity: number; pace: number }>();
    expect(row).toEqual({ openness: 1, energy: 2, warmth: 3, curiosity: 4, pace: 5 });
  });

  it("rejects missing signatures before bottle insert", async () => {
    const sender = await createSignedUser(db, "sender");

    const response = await request(db, "/v1/bottles", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body: bottleBody("Unsigned bottle."),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "MISSING_SIGNATURE_HEADERS" });
    const row = await db.prepare("SELECT COUNT(*) AS count FROM bottles").first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("rejects spoofed user ids signed by another user", async () => {
    const sender = await createSignedUser(db, "sender");
    const recipient = await createSignedUser(db, "recipient");

    const response = await signedRequest(db, sender, recipient.id, "/v1/inbox");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_SIGNATURE" });
  });

  it("rejects unsafe signed bottles before inserting", async () => {
    const sender = await createSignedUser(db, "sender");

    const response = await submitBottle(db, sender, "write me at sender@example.com");

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "CONTAINS_EMAIL" });

    const row = await db.prepare("SELECT COUNT(*) AS count FROM bottles").first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("creates a signed safe bottle delivery for a matching recipient", async () => {
    const sender = await createSignedUser(db, "sender");
    const recipient = await createSignedUser(db, "recipient");
    await createSignedUser(db, "other-language", { language: "fr" });

    const response = await submitBottle(db, sender, "A quiet note from the shore.");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      status: string;
      deliveryCount: number;
    };
    expect(body).toMatchObject({ status: "delivered", deliveryCount: 1 });

    const delivery = await db
      .prepare("SELECT bottle_id, recipient_id, status FROM deliveries")
      .first<{ bottle_id: string; recipient_id: string; status: string }>();
    expect(delivery).toEqual({
      bottle_id: body.id,
      recipient_id: recipient.id,
      status: "available",
    });
  });

  it("pulls signed inbox delivery, stores a signed reply, and pulls signed replies", async () => {
    const sender = await createSignedUser(db, "sender");
    const recipient = await createSignedUser(db, "recipient");

    await submitBottle(db, sender, "Does this reach someone kind?");

    const inboxResponse = await pullInbox(db, recipient);
    expect(inboxResponse.status).toBe(200);
    const inbox = (await inboxResponse.json()) as {
      bottles: Array<{ deliveryId: string; content: string; senderId: string }>;
    };
    expect(inbox.bottles).toHaveLength(1);
    const pulledBottle = inbox.bottles[0];
    if (!pulledBottle) {
      throw new Error("Expected one inbox bottle");
    }
    expect(pulledBottle).toMatchObject({
      content: "Does this reach someone kind?",
      senderId: sender.id,
    });

    const replyResponse = await pullReply(db, recipient, pulledBottle.deliveryId, "It did.");
    expect(replyResponse.status).toBe(200);
    const reply = (await replyResponse.json()) as { id: string; status: string; expiresAt: string };
    expect(reply.id).toMatch(/^rep_/);
    expect(reply.status).toBe("available");
    expect(reply.expiresAt).toMatch(/Z$/);

    const repliesResponse = await pullReplies(db, sender);
    expect(repliesResponse.status).toBe(200);
    const replies = (await repliesResponse.json()) as {
      replies: Array<{ id: string; deliveryId: string; content: string; fromUserId: string; status: string }>;
    };
    expect(replies.replies).toEqual([
      {
        id: reply.id,
        deliveryId: pulledBottle.deliveryId,
        fromUserId: recipient.id,
        content: "It did.",
        status: "pulled",
      },
    ]);
  });

  it("reports an authorized bottle delivery and marks only that delivery", async () => {
    const sender = await createSignedUser(db, "sender");
    const recipientA = await createSignedUser(db, "recipient-a");
    const recipientB = await createSignedUser(db, "recipient-b");

    await submitBottle(db, sender, "Reportable bottle.");
    const deliveries = (
      await db
        .prepare("SELECT id, recipient_id AS recipientId FROM deliveries ORDER BY recipient_id ASC")
        .all<{ id: string; recipientId: string }>()
    ).results;
    const reportDelivery = deliveries.find((delivery) => delivery.recipientId === recipientA.id);
    const untouchedDelivery = deliveries.find((delivery) => delivery.recipientId === recipientB.id);
    if (!reportDelivery || !untouchedDelivery) {
      throw new Error("Expected two deliveries");
    }

    const response = await signedRequest(db, recipientA, recipientA.id, "/v1/reports", {
      method: "POST",
      body: JSON.stringify({
        targetType: "bottle",
        targetId: reportDelivery.id,
        reason: "Unwelcome content",
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as { id: string }).toEqual({ id: expect.stringMatching(/^rpt_/) });
    const statuses = (
      await db.prepare("SELECT id, status FROM deliveries ORDER BY id ASC").all<{ id: string; status: string }>()
    ).results;
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: reportDelivery.id, status: "reported" },
        { id: untouchedDelivery.id, status: "available" },
      ]),
    );
  });

  it("rejects unauthorized reports without inserting report rows", async () => {
    const sender = await createSignedUser(db, "sender");
    const recipient = await createSignedUser(db, "recipient");
    const stranger = await createSignedUser(db, "stranger");

    await submitBottle(db, sender, "Private delivery.");
    const delivery = await db
      .prepare("SELECT id FROM deliveries WHERE recipient_id = ?")
      .bind(recipient.id)
      .first<{ id: string }>();
    if (!delivery) {
      throw new Error("Expected delivery");
    }

    const response = await signedRequest(db, stranger, stranger.id, "/v1/reports", {
      method: "POST",
      body: JSON.stringify({
        targetType: "bottle",
        targetId: delivery.id,
        reason: "I should not be allowed",
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "REPORT_NOT_AUTHORIZED" });
    const count = await db.prepare("SELECT COUNT(*) AS count FROM reports").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rejects read and report access for suspended or nonexistent users", async () => {
    const suspended = await createSignedUser(db, "suspended");
    await db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(suspended.id).run();

    const inbox = await pullInbox(db, suspended);
    expect(inbox.status).toBe(403);
    expect(await inbox.json()).toEqual({ error: "USER_NOT_ACTIVE_ADULT" });

    const replies = await pullReplies(db, suspended);
    expect(replies.status).toBe(403);

    const missing = await signedRequest(db, suspended, "usr_missing", "/v1/reports", {
      method: "POST",
      body: JSON.stringify({ targetType: "bottle", targetId: "del_missing", reason: "Missing" }),
    });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "INVALID_SIGNATURE" });
  });

  it("enforces one bottle per sender per UTC day with the DB-backed guard", async () => {
    const sender = await createSignedUser(db, "sender");
    await createSignedUser(db, "recipient");

    const first = await submitBottle(db, sender, "First bottle today.");
    expect(first.status).toBe(200);

    const second = await submitBottle(db, sender, "Second bottle today.");

    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "DAILY_BOTTLE_LIMIT_REACHED" });
  });

  it("rolls back the bottle batch when a delivery insert fails", async () => {
    const sender = await createSignedUser(db, "sender");
    await createSignedUser(db, "recipient");
    db.failDeliveryInBatch = true;

    const response = await submitBottle(db, sender, "This batch should roll back.");

    expect(response.status).toBe(500);
    const bottles = await db.prepare("SELECT COUNT(*) AS count FROM bottles").first<{ count: number }>();
    const deliveries = await db.prepare("SELECT COUNT(*) AS count FROM deliveries").first<{ count: number }>();
    expect(bottles?.count).toBe(0);
    expect(deliveries?.count).toBe(0);
  });
});
