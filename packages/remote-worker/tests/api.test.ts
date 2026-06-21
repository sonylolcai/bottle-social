import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
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
  private values: unknown[] = [];

  constructor(private readonly statement: SqliteStatement) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return {
      results: this.statement.all(...this.values) as T[],
      success: true,
      meta: d1Meta,
    };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    this.statement.run(...this.values);
    return { results: [] as T[], success: true, meta: d1Meta };
  }
}

class FakeD1Database {
  private readonly db: SqliteDatabase;

  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(migrationSql);
  }

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.db.prepare(query));
  }

  close(): void {
    this.db.close();
  }

}

const publicKey = (label: string) => `${label}-`.padEnd(32, "x");

const request = (db: FakeD1Database, path: string, init?: RequestInit) =>
  app.request(path, init, { DB: db as unknown as D1Database });

const createUser = async (
  db: FakeD1Database,
  input: {
    handle: string;
    language?: string;
    region?: string;
  },
) => {
  const response = await request(db, "/v1/users", {
    method: "POST",
    body: JSON.stringify({
      handle: input.handle,
      publicKey: publicKey(input.handle),
      language: input.language ?? "en",
      region: input.region ?? "US",
      isAdult: true,
    }),
  });

  expect(response.status).toBe(200);
  return (await response.json()) as { id: string };
};

describe("remote API routes", () => {
  let db: FakeD1Database;

  beforeEach(() => {
    db = new FakeD1Database();
  });

  it("creates active adult users", async () => {
    const response = await request(db, "/v1/users", {
      method: "POST",
      body: JSON.stringify({
        handle: "sender",
        publicKey: publicKey("sender"),
        language: "en",
        region: "US",
        isAdult: true,
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^usr_/);

    const row = await db
      .prepare("SELECT handle, is_adult, status FROM users WHERE id = ?")
      .bind(body.id)
      .first<{ handle: string; is_adult: number; status: string }>();
    expect(row).toEqual({ handle: "sender", is_adult: 1, status: "active" });
  });

  it("rejects unsafe bottles before inserting", async () => {
    const sender = await createUser(db, { handle: "sender" });

    const response = await request(db, "/v1/bottles", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body: JSON.stringify({
        content: "write me at sender@example.com",
        language: "en",
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "CONTAINS_EMAIL" });

    const row = await db.prepare("SELECT COUNT(*) AS count FROM bottles").first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("creates a safe bottle delivery for a matching recipient", async () => {
    const sender = await createUser(db, { handle: "sender" });
    const recipient = await createUser(db, { handle: "recipient" });
    await createUser(db, { handle: "other-language", language: "fr" });

    const response = await request(db, "/v1/bottles", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body: JSON.stringify({
        content: "A quiet note from the shore.",
        language: "en",
      }),
    });

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

  it("pulls inbox delivery and allows a reply to be stored", async () => {
    const sender = await createUser(db, { handle: "sender" });
    const recipient = await createUser(db, { handle: "recipient" });

    await request(db, "/v1/bottles", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body: JSON.stringify({
        content: "Does this reach someone kind?",
        language: "en",
      }),
    });

    const inboxResponse = await request(db, "/v1/inbox", {
      headers: { "X-User-Id": recipient.id },
    });
    expect(inboxResponse.status).toBe(200);
    const inbox = (await inboxResponse.json()) as {
      bottles: Array<{ deliveryId: string; content: string; senderId: string }>;
    };
    expect(inbox.bottles).toHaveLength(1);
    expect(inbox.bottles[0]).toMatchObject({
      content: "Does this reach someone kind?",
      senderId: sender.id,
    });

    const pulledBottle = inbox.bottles[0];
    if (!pulledBottle) {
      throw new Error("Expected one inbox bottle");
    }

    const replyResponse = await request(db, `/v1/deliveries/${pulledBottle.deliveryId}/replies`, {
      method: "POST",
      headers: { "X-User-Id": recipient.id },
      body: JSON.stringify({ content: "It did." }),
    });

    expect(replyResponse.status).toBe(200);
    const reply = (await replyResponse.json()) as { id: string; status: string; expiresAt: string };
    expect(reply.id).toMatch(/^rep_/);
    expect(reply.status).toBe("available");
    expect(reply.expiresAt).toMatch(/Z$/);
  });

  it("pulls available replies for the target user", async () => {
    const sender = await createUser(db, { handle: "sender" });
    const recipient = await createUser(db, { handle: "recipient" });

    await request(db, "/v1/bottles", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body: JSON.stringify({ content: "Reply test", language: "en" }),
    });
    const inboxResponse = await request(db, "/v1/inbox", {
      headers: { "X-User-Id": recipient.id },
    });
    const inbox = (await inboxResponse.json()) as { bottles: Array<{ deliveryId: string }> };
    const pulledBottle = inbox.bottles[0];
    if (!pulledBottle) {
      throw new Error("Expected one inbox bottle");
    }

    await request(db, `/v1/deliveries/${pulledBottle.deliveryId}/replies`, {
      method: "POST",
      headers: { "X-User-Id": recipient.id },
      body: JSON.stringify({ content: "A reply from the sea." }),
    });

    const repliesResponse = await request(db, "/v1/replies", {
      headers: { "X-User-Id": sender.id },
    });

    expect(repliesResponse.status).toBe(200);
    const replies = (await repliesResponse.json()) as {
      replies: Array<{ content: string; fromUserId: string; status: string }>;
    };
    expect(replies.replies).toEqual([
      {
        id: expect.stringMatching(/^rep_/),
        deliveryId: pulledBottle.deliveryId,
        fromUserId: recipient.id,
        content: "A reply from the sea.",
        status: "pulled",
      },
    ]);
  });

  it("enforces one bottle per sender per UTC day", async () => {
    const sender = await createUser(db, { handle: "sender" });
    await createUser(db, { handle: "recipient" });

    const first = await request(db, "/v1/bottles", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body: JSON.stringify({ content: "First bottle today.", language: "en" }),
    });
    expect(first.status).toBe(200);

    const second = await request(db, "/v1/bottles", {
      method: "POST",
      headers: { "X-User-Id": sender.id },
      body: JSON.stringify({ content: "Second bottle today.", language: "en" }),
    });

    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "DAILY_BOTTLE_LIMIT_REACHED" });
  });
});
