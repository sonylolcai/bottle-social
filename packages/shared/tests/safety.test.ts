import { describe, expect, it } from "vitest";
import { checkTextSafety } from "../src/safety";

describe("checkTextSafety", () => {
  it("allows ordinary diary text", () => {
    expect(checkTextSafety("I saw a beautiful sunset from the bus.")).toEqual({
      ok: true
    });
  });

  it("rejects empty text", () => {
    expect(checkTextSafety("   ")).toEqual({
      ok: false,
      code: "TEXT_EMPTY"
    });
  });

  it("rejects text over the default 1200 character limit", () => {
    expect(checkTextSafety("a".repeat(1201))).toEqual({
      ok: false,
      code: "TEXT_TOO_LONG_OVER_1200_CHARS"
    });
  });

  it("rejects text over a custom numeric max length", () => {
    expect(checkTextSafety("too long", 3)).toEqual({
      ok: false,
      code: "TEXT_TOO_LONG_OVER_1200_CHARS"
    });
  });

  it("rejects URLs", () => {
    expect(checkTextSafety("visit https://example.com")).toEqual({
      ok: false,
      code: "CONTAINS_URL"
    });
  });

  it("rejects email addresses", () => {
    expect(checkTextSafety("write me at person@example.com")).toEqual({
      ok: false,
      code: "CONTAINS_EMAIL"
    });
  });

  it("rejects phone-like contact strings", () => {
    expect(checkTextSafety("my number is +1 415 555 1212")).toEqual({
      ok: false,
      code: "CONTAINS_PHONE_NUMBER"
    });
  });

  it("rejects exact location patterns", () => {
    expect(checkTextSafety("meet me at 123 Main Street")).toEqual({
      ok: false,
      code: "CONTAINS_EXACT_LOCATION_PATTERN"
    });
  });

  it("rejects payment handles", () => {
    expect(checkTextSafety("venmo @person")).toEqual({
      ok: false,
      code: "CONTAINS_PAYMENT_HANDLE"
    });
  });

  it("rejects high-risk keywords", () => {
    expect(checkTextSafety("my password is secret")).toEqual({
      ok: false,
      code: "CONTAINS_HIGH_RISK_KEYWORD"
    });
  });
});
