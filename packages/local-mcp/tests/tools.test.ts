import { describe, expect, it } from "vitest";
import { toolNames } from "../src/tools";

describe("MCP tools", () => {
  it("exposes only business tools", () => {
    expect(toolNames).toEqual([
      "create_profile",
      "answer_personality_quiz",
      "submit_bottle",
      "get_inbox",
      "reply_to_bottle",
      "report_bottle",
    ]);
  });
});
