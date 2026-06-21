import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(testDir, "../migrations/0001_initial.sql");
const migrationSql = readFileSync(migrationPath, "utf8");
const now = "2026-06-21T00:00:00.000Z";
const require = createRequire(import.meta.url);

type SqliteStatement = {
  get: (...values: unknown[]) => unknown;
  run: (...values: unknown[]) => unknown;
};

type SqliteDatabase = {
  close: () => void;
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};

const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

type BottleStatus = "approved" | "delivered" | "expired" | "rejected";
type ReplyStatus = "available" | "pulled" | "reported" | "expired" | "rejected";

const createDatabase = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(migrationSql);
  seedUsers(db);
  return db;
};

const seedUsers = (db: SqliteDatabase) => {
  const insertUser = db.prepare(`
    INSERT INTO users (id, public_key, handle, language, region, is_adult, status, created_at)
    VALUES (?, ?, ?, 'en', 'US', 1, 'active', ?)
  `);

  insertUser.run("sender", "sender-public-key", "sender", now);
  insertUser.run("recipient", "recipient-public-key", "recipient", now);
};

const insertBottle = (
  db: SqliteDatabase,
  {
    id = "bottle",
    status,
    content,
    rejectionCode = null,
  }: {
    id?: string;
    status: BottleStatus;
    content: string | null;
    rejectionCode?: string | null;
  }
) => {
  db.prepare(`
    INSERT INTO bottles (
      id, sender_id, content, content_hash, language, status, rejection_code, created_at, expires_at
    )
    VALUES (?, 'sender', ?, ?, 'en', ?, ?, ?, ?)
  `).run(id, content, `${id}-hash`, status, rejectionCode, now, now);
};

const seedDelivery = (db: SqliteDatabase) => {
  insertBottle(db, {
    id: "delivery-bottle",
    status: "approved",
    content: "ready for delivery",
  });

  db.prepare(`
    INSERT INTO deliveries (id, bottle_id, recipient_id, status, created_at, expires_at)
    VALUES ('delivery', 'delivery-bottle', 'recipient', 'available', ?, ?)
  `).run(now, now);
};

const insertReply = (
  db: SqliteDatabase,
  {
    id = "reply",
    status,
    content,
    rejectionCode = null,
  }: {
    id?: string;
    status: ReplyStatus;
    content: string | null;
    rejectionCode?: string | null;
  }
) => {
  db.prepare(`
    INSERT INTO replies (
      id, delivery_id, from_user_id, to_user_id, content, content_hash, status, rejection_code,
      created_at, pulled_at, expires_at
    )
    VALUES (?, 'delivery', 'recipient', 'sender', ?, ?, ?, ?, ?, NULL, ?)
  `).run(id, content, `${id}-hash`, status, rejectionCode, now, now);
};

const expectRejected = (operation: () => void) => {
  expect(operation).toThrow(/CHECK constraint failed/i);
};

describe("initial D1 migration", () => {
  test("enforces bottle content retention lifecycle states", () => {
    const db = createDatabase();

    try {
      insertBottle(db, {
        id: "approved-with-content",
        status: "approved",
        content: "hello",
      });
      insertBottle(db, {
        id: "delivered-with-content",
        status: "delivered",
        content: "already delivered",
      });
      expectRejected(() =>
        insertBottle(db, {
          id: "approved-without-content",
          status: "approved",
          content: null,
        })
      );
      expectRejected(() =>
        insertBottle(db, {
          id: "delivered-without-content",
          status: "delivered",
          content: null,
        })
      );
      expectRejected(() =>
        insertBottle(db, {
          id: "expired-with-content",
          status: "expired",
          content: "should be purged",
        })
      );
      insertBottle(db, {
        id: "expired-without-content",
        status: "expired",
        content: null,
      });
      expectRejected(() =>
        insertBottle(db, {
          id: "rejected-without-code",
          status: "rejected",
          content: null,
        })
      );

      expect(
        db.prepare("SELECT COUNT(*) AS count FROM bottles").get()
      ).toMatchObject({ count: 3 });
    } finally {
      db.close();
    }
  });

  test("enforces reply content retention lifecycle states", () => {
    const db = createDatabase();

    try {
      seedDelivery(db);

      insertReply(db, {
        id: "available-with-content",
        status: "available",
        content: "reply content",
      });
      insertReply(db, {
        id: "pulled-with-content",
        status: "pulled",
        content: "pulled reply content",
      });
      insertReply(db, {
        id: "reported-with-content",
        status: "reported",
        content: "reported reply content",
      });
      expectRejected(() =>
        insertReply(db, {
          id: "pulled-without-content",
          status: "pulled",
          content: null,
        })
      );
      expectRejected(() =>
        insertReply(db, {
          id: "reported-without-content",
          status: "reported",
          content: null,
        })
      );
      expectRejected(() =>
        insertReply(db, {
          id: "expired-with-content",
          status: "expired",
          content: "should be purged",
        })
      );
      insertReply(db, {
        id: "expired-without-content",
        status: "expired",
        content: null,
      });
      expectRejected(() =>
        insertReply(db, {
          id: "rejected-without-code",
          status: "rejected",
          content: null,
        })
      );

      expect(
        db.prepare("SELECT COUNT(*) AS count FROM replies").get()
      ).toMatchObject({ count: 4 });
    } finally {
      db.close();
    }
  });

  test("declares lookup indexes for delivery, bottle, report, and audit workflows", () => {
    expect(migrationSql).toContain(
      "CREATE INDEX idx_deliveries_recipient_status_expires_at ON deliveries(recipient_id, status, expires_at);"
    );
    expect(migrationSql).toContain(
      "CREATE INDEX idx_replies_to_user_status_expires_at ON replies(to_user_id, status, expires_at);"
    );
    expect(migrationSql).toContain(
      "CREATE INDEX idx_users_delivery_candidates ON users(language, status, is_adult);"
    );
    expect(migrationSql).toContain(
      "CREATE INDEX idx_bottles_status_language_expires_at ON bottles(status, language, expires_at);"
    );
    expect(migrationSql).toContain(
      "CREATE INDEX idx_bottles_sender_created_at ON bottles(sender_id, created_at);"
    );
    expect(migrationSql).toContain(
      "CREATE INDEX idx_reports_target ON reports(target_type, target_id);"
    );
    expect(migrationSql).toContain(
      "CREATE INDEX idx_audit_events_target_created_at ON audit_events(target_type, target_id, created_at);"
    );
  });
});
