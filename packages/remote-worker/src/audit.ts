import { contentHash, newId, nowIso } from "./db";

export const writeAuditEvent = async (
  db: D1Database,
  input: {
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId: string;
    input?: string;
    result: string;
  },
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO audit_events (
        id, actor_user_id, action, target_type, target_id, input_hash, result, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("aud"),
      input.actorUserId ?? null,
      input.action,
      input.targetType,
      input.targetId,
      input.input ? await contentHash(input.input) : null,
      input.result,
      nowIso(),
    )
    .run();
};
