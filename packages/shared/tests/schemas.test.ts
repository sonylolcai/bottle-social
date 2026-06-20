import { describe, expect, it } from "vitest";
import { SubmitBottleSchema } from "../src/schemas";

describe("SubmitBottleSchema", () => {
  it("accepts a short text bottle", () => {
    const parsed = SubmitBottleSchema.parse({
      content: "Today I noticed the city felt quieter after the rain.",
      language: "en"
    });

    expect(parsed.language).toBe("en");
  });

  it("rejects bottles above 1200 characters", () => {
    expect(() =>
      SubmitBottleSchema.parse({
        content: "x".repeat(1201),
        language: "en"
      })
    ).toThrow();
  });
});
