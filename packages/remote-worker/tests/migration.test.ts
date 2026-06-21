import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(testDir, "../migrations/0001_initial.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

describe("initial D1 migration", () => {
  test("allows expired bottle and reply content to be purged while protecting live content", () => {
    expect(migrationSql).toMatch(
      /bottles_lifecycle[\s\S]*status IN \('approved', 'delivered'\)[\s\S]*content IS NOT NULL[\s\S]*status = 'rejected'[\s\S]*rejection_code IS NOT NULL[\s\S]*status = 'expired'/
    );
    expect(migrationSql).toMatch(
      /content TEXT,\s*content_hash TEXT NOT NULL,\s*status TEXT NOT NULL CHECK \(status IN \('rejected', 'available', 'pulled', 'expired', 'reported'\)\),/
    );
    expect(migrationSql).toMatch(
      /replies_lifecycle[\s\S]*status IN \('available', 'pulled', 'reported'\)[\s\S]*content IS NOT NULL[\s\S]*status = 'rejected'[\s\S]*rejection_code IS NOT NULL[\s\S]*status = 'expired'/
    );
  });

  test("declares lookup indexes for delivery, bottle, report, and audit workflows", () => {
    expect(migrationSql).toContain(
      "CREATE INDEX idx_deliveries_recipient_status_expires_at ON deliveries(recipient_id, status, expires_at);"
    );
    expect(migrationSql).toContain(
      "CREATE INDEX idx_replies_to_user_status_expires_at ON replies(to_user_id, status, expires_at);"
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
