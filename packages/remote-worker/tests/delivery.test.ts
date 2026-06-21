import { describe, expect, it } from "vitest";
import { selectRecipients } from "../src/delivery";

describe("selectRecipients", () => {
  it("excludes sender and selects up to three active users with matching language", () => {
    const users = [
      { id: "sender", language: "en", status: "active" as const },
      { id: "a", language: "en", status: "active" as const },
      { id: "b", language: "en", status: "active" as const },
      { id: "c", language: "en", status: "active" as const },
      { id: "d", language: "en", status: "active" as const },
      { id: "zh", language: "zh", status: "active" as const },
      { id: "blocked", language: "en", status: "suspended" as const },
    ];

    const recipients = selectRecipients({
      senderId: "sender",
      bottleLanguage: "en",
      candidates: users,
      limit: 3,
    });

    expect(recipients).toHaveLength(3);
    expect(recipients).not.toContain("sender");
    expect(recipients).not.toContain("zh");
    expect(recipients).not.toContain("blocked");
  });

  it("returns matching recipients in deterministic id order", () => {
    const recipients = selectRecipients({
      senderId: "sender",
      bottleLanguage: "en",
      candidates: [
        { id: "charlie", language: "en", status: "active" },
        { id: "alpha", language: "en", status: "active" },
        { id: "bravo", language: "en", status: "active" },
      ],
      limit: 3,
    });

    expect(recipients).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("returns all matching recipients when fewer candidates are available than the limit", () => {
    const recipients = selectRecipients({
      senderId: "sender",
      bottleLanguage: "en",
      candidates: [
        { id: "sender", language: "en", status: "active" },
        { id: "one", language: "en", status: "active" },
        { id: "two", language: "en", status: "active" },
      ],
      limit: 5,
    });

    expect(recipients).toEqual(["one", "two"]);
  });

  it("returns no recipients when the limit is zero or negative", () => {
    const candidates = [
      { id: "one", language: "en", status: "active" as const },
      { id: "two", language: "en", status: "active" as const },
    ];

    expect(
      selectRecipients({
        senderId: "sender",
        bottleLanguage: "en",
        candidates,
        limit: 0,
      }),
    ).toEqual([]);
    expect(
      selectRecipients({
        senderId: "sender",
        bottleLanguage: "en",
        candidates,
        limit: -1,
      }),
    ).toEqual([]);
  });
});
