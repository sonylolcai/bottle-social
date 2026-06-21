import { describe, expect, it } from "vitest";
import { LocalCache } from "../src/local-cache";

describe("LocalCache", () => {
  it("stores pulled bottle context by delivery id", () => {
    const cache = new LocalCache();

    cache.saveBottle({
      deliveryId: "del_1",
      bottleId: "bot_1",
      senderId: "usr_sender",
      content: "A quiet line from elsewhere.",
      receivedAt: "2026-06-21T00:00:00.000Z",
      expiresAt: "2026-06-24T00:00:00.000Z",
    });

    expect(cache.getBottle("del_1")).toMatchObject({
      bottleId: "bot_1",
      content: "A quiet line from elsewhere.",
    });
  });

  it("returns undefined for unknown delivery ids", () => {
    expect(new LocalCache().getBottle("missing")).toBeUndefined();
  });
});
