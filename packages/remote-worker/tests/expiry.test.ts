import { describe, expect, it } from "vitest";
import { bottleExpiry, replyExpiry, shouldPurgeBottleContent } from "../src/expiry";

describe("expiry rules", () => {
  it("expires bottles after three days", () => {
    expect(bottleExpiry("2026-06-19T00:00:00.000Z")).toBe("2026-06-22T00:00:00.000Z");
  });

  it("expires replies after seven days", () => {
    expect(replyExpiry("2026-06-19T00:00:00.000Z")).toBe("2026-06-26T00:00:00.000Z");
  });

  it("purges bottle content after expiry", () => {
    expect(
      shouldPurgeBottleContent({
        now: "2026-06-23T00:00:00.000Z",
        expiresAt: "2026-06-22T00:00:00.000Z"
      })
    ).toBe(true);
  });

  it("does not purge bottle content before expiry", () => {
    expect(
      shouldPurgeBottleContent({
        now: "2026-06-21T23:59:59.999Z",
        expiresAt: "2026-06-22T00:00:00.000Z"
      })
    ).toBe(false);
  });

  it("purges bottle content exactly at expiry", () => {
    expect(
      shouldPurgeBottleContent({
        now: "2026-06-22T00:00:00.000Z",
        expiresAt: "2026-06-22T00:00:00.000Z"
      })
    ).toBe(true);
  });
});
