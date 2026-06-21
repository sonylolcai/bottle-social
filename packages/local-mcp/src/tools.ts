export const toolNames = [
  "create_profile",
  "answer_personality_quiz",
  "submit_bottle",
  "get_inbox",
  "reply_to_bottle",
  "report_bottle",
] as const;

export type ToolName = (typeof toolNames)[number];

export const isToolName = (value: string): value is ToolName =>
  (toolNames as readonly string[]).includes(value);
