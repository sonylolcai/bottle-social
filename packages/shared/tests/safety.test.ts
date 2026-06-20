import { describe, expect, it } from "vitest";
import { checkTextSafety } from "../src/safety";

describe("checkTextSafety", () => {
  it("allows ordinary diary text", () => {
    expect(checkTextSafety("I saw a beautiful sunset from the bus.")).toEqual({
      ok: true
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
});
