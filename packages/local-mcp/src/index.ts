import { RemoteClient } from "./client";
import { LocalCache } from "./local-cache";
import { personalityFromQuiz, type QuizAnswers } from "./quiz";
import { toolNames, type ToolName } from "./tools";

export type DriftBottleLocalContext = {
  client: RemoteClient;
  cache: LocalCache;
};

export const createLocalContext = (client: RemoteClient): DriftBottleLocalContext => ({
  client,
  cache: new LocalCache(),
});

export const listTools = (): readonly ToolName[] => toolNames;

export const callTool = async (
  context: DriftBottleLocalContext,
  toolName: ToolName,
  input: Record<string, unknown>,
): Promise<unknown> => {
  switch (toolName) {
    case "create_profile":
      return context.client.post("/v1/users", input);
    case "answer_personality_quiz":
      return context.client.post("/v1/personality", personalityFromQuiz(input as QuizAnswers));
    case "submit_bottle":
      return context.client.post("/v1/bottles", input);
    case "get_inbox": {
      const result = (await context.client.get("/v1/inbox")) as {
        bottles?: Array<{
          deliveryId: string;
          bottleId: string;
          senderId: string;
          content: string;
          expiresAt: string;
        }>;
      };
      for (const bottle of result.bottles ?? []) {
        context.cache.saveBottle({
          ...bottle,
          receivedAt: new Date().toISOString(),
        });
      }
      return result;
    }
    case "reply_to_bottle": {
      const deliveryId = String(input.deliveryId ?? "");
      return context.client.post(`/v1/deliveries/${deliveryId}/replies`, {
        content: input.content,
      });
    }
    case "report_bottle":
      return context.client.post("/v1/reports", input);
  }
};
