import type { Context, Hono } from "hono";
import type { ZodType } from "zod";
import {
  CreateUserSchema,
  PersonalityProfileSchema,
  ReportSchema,
  SubmitBottleSchema,
  SubmitReplySchema,
} from "../../shared/src/schemas";
import { checkTextSafety } from "../../shared/src/safety";
import { selectRecipients, type CandidateUser } from "./delivery";
import {
  contentHash,
  getActiveAdultUser,
  jsonError,
  newId,
  nowIso,
  readJson,
  utcDayBounds,
  type Env,
} from "./db";
import { bottleExpiry, replyExpiry } from "./expiry";
import { canStoreReply } from "./state-machine";
import { writeAuditEvent } from "./audit";

type App = Hono<{ Bindings: Env }>;
type AppContext = Context<{ Bindings: Env }>;

const requireUserId = (headers: Headers): string | null => headers.get("X-User-Id");

const parseBody = async <T>(appContext: AppContext, schema: ZodType<T>): Promise<
  { ok: true; data: T } | { ok: false }
> => {
  const result = schema.safeParse(await readJson(appContext));
  return result.success ? { ok: true, data: result.data } : { ok: false };
};

export const registerRoutes = (app: App): void => {
  app.post("/v1/users", async (c) => {
    const parsed = await parseBody(c, CreateUserSchema);
    if (!parsed.ok) {
      return jsonError(c, 400, "INVALID_REQUEST");
    }

    const id = newId("usr");
    const createdAt = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO users (
        id, public_key, handle, language, region, is_adult, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'active', ?)`,
    )
      .bind(id, parsed.data.publicKey, parsed.data.handle, parsed.data.language, parsed.data.region, createdAt)
      .run();

    await writeAuditEvent(c.env.DB, {
      actorUserId: id,
      action: "user.create",
      targetType: "user",
      targetId: id,
      result: "ok",
    });

    return c.json({ id });
  });

  app.post("/v1/personality", async (c) => {
    const userId = requireUserId(c.req.raw.headers);
    if (!userId) {
      return jsonError(c, 401, "MISSING_USER_ID");
    }

    const user = await getActiveAdultUser(c.env.DB, userId);
    if (!user) {
      return jsonError(c, 403, "USER_NOT_ACTIVE_ADULT");
    }

    const parsed = await parseBody(c, PersonalityProfileSchema);
    if (!parsed.ok) {
      return jsonError(c, 400, "INVALID_REQUEST");
    }

    await c.env.DB.prepare(
      `INSERT INTO personality_profiles (
        user_id, openness, energy, warmth, curiosity, pace, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        openness = excluded.openness,
        energy = excluded.energy,
        warmth = excluded.warmth,
        curiosity = excluded.curiosity,
        pace = excluded.pace,
        updated_at = excluded.updated_at`,
    )
      .bind(
        userId,
        parsed.data.openness,
        parsed.data.energy,
        parsed.data.warmth,
        parsed.data.curiosity,
        parsed.data.pace,
        nowIso(),
      )
      .run();

    return c.json({ ok: true });
  });

  app.post("/v1/bottles", async (c) => {
    const userId = requireUserId(c.req.raw.headers);
    if (!userId) {
      return jsonError(c, 401, "MISSING_USER_ID");
    }

    const parsed = await parseBody(c, SubmitBottleSchema);
    if (!parsed.ok) {
      return jsonError(c, 400, "INVALID_REQUEST");
    }

    const safety = checkTextSafety(parsed.data.content);
    if (!safety.ok) {
      return c.json({ error: safety.code }, 422);
    }

    const sender = await getActiveAdultUser(c.env.DB, userId);
    if (!sender) {
      return jsonError(c, 403, "USER_NOT_ACTIVE_ADULT");
    }

    const createdAt = nowIso();
    const day = utcDayBounds(createdAt);
    const existing = await c.env.DB.prepare(
      "SELECT id FROM bottles WHERE sender_id = ? AND created_at >= ? AND created_at < ? LIMIT 1",
    )
      .bind(userId, day.start, day.end)
      .first<{ id: string }>();
    if (existing) {
      return c.json({ error: "DAILY_BOTTLE_LIMIT_REACHED" }, 429);
    }

    const bottleId = newId("bot");
    const expiresAt = bottleExpiry(createdAt);
    await c.env.DB.prepare(
      `INSERT INTO bottles (
        id, sender_id, content, content_hash, language, status, rejection_code, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'approved', NULL, ?, ?)`,
    )
      .bind(
        bottleId,
        userId,
        parsed.data.content,
        await contentHash(parsed.data.content),
        parsed.data.language,
        createdAt,
        expiresAt,
      )
      .run();

    const candidatesResult = await c.env.DB.prepare(
      "SELECT id, language, status FROM users WHERE language = ? AND status = 'active' AND is_adult = 1",
    )
      .bind(parsed.data.language)
      .all<CandidateUser>();
    const recipientIds = selectRecipients({
      senderId: userId,
      bottleLanguage: parsed.data.language,
      candidates: candidatesResult.results,
      limit: 3,
    });

    for (const recipientId of recipientIds) {
      await c.env.DB.prepare(
        `INSERT INTO deliveries (
          id, bottle_id, recipient_id, status, created_at, pulled_at, expires_at
        ) VALUES (?, ?, ?, 'available', ?, NULL, ?)`,
      )
        .bind(newId("del"), bottleId, recipientId, createdAt, expiresAt)
        .run();
    }

    const status = recipientIds.length > 0 ? "delivered" : "approved";
    if (status === "delivered") {
      await c.env.DB.prepare("UPDATE bottles SET status = 'delivered' WHERE id = ?").bind(bottleId).run();
    }

    await writeAuditEvent(c.env.DB, {
      actorUserId: userId,
      action: "bottle.submit",
      targetType: "bottle",
      targetId: bottleId,
      input: parsed.data.content,
      result: status,
    });

    return c.json({ id: bottleId, status, deliveryCount: recipientIds.length });
  });

  app.get("/v1/inbox", async (c) => {
    const userId = requireUserId(c.req.raw.headers);
    if (!userId) {
      return jsonError(c, 401, "MISSING_USER_ID");
    }

    const pulledAt = nowIso();
    const rows = (
      await c.env.DB.prepare(
        `SELECT
          deliveries.id AS deliveryId,
          deliveries.bottle_id AS bottleId,
          bottles.sender_id AS senderId,
          bottles.content AS content,
          bottles.language AS language,
          deliveries.expires_at AS expiresAt
        FROM deliveries
        JOIN bottles ON bottles.id = deliveries.bottle_id
        WHERE deliveries.recipient_id = ?
          AND deliveries.status = 'available'
          AND deliveries.expires_at > ?
          AND bottles.content IS NOT NULL
        ORDER BY deliveries.created_at ASC`,
      )
        .bind(userId, pulledAt)
        .all<{
          deliveryId: string;
          bottleId: string;
          senderId: string;
          content: string;
          language: string;
          expiresAt: string;
        }>()
    ).results;

    for (const row of rows) {
      await c.env.DB.prepare("UPDATE deliveries SET status = 'pulled', pulled_at = ? WHERE id = ?")
        .bind(pulledAt, row.deliveryId)
        .run();
    }

    return c.json({
      bottles: rows.map((row) => ({
        ...row,
        status: "pulled",
      })),
    });
  });

  app.post("/v1/deliveries/:deliveryId/replies", async (c) => {
    const userId = requireUserId(c.req.raw.headers);
    if (!userId) {
      return jsonError(c, 401, "MISSING_USER_ID");
    }

    const parsed = await parseBody(c, SubmitReplySchema);
    if (!parsed.ok) {
      return jsonError(c, 400, "INVALID_REQUEST");
    }

    const safety = checkTextSafety(parsed.data.content, 800);
    if (!safety.ok) {
      return c.json({ error: safety.code }, 422);
    }

    const delivery = await c.env.DB.prepare(
      `SELECT
        deliveries.id AS id,
        deliveries.status AS status,
        deliveries.recipient_id AS recipientId,
        bottles.sender_id AS senderId
      FROM deliveries
      JOIN bottles ON bottles.id = deliveries.bottle_id
      WHERE deliveries.id = ?`,
    )
      .bind(c.req.param("deliveryId"))
      .first<{ id: string; status: "available" | "pulled" | "expired" | "reported"; recipientId: string; senderId: string }>();

    if (!delivery || delivery.recipientId !== userId || !canStoreReply(delivery.status)) {
      return jsonError(c, 409, "DELIVERY_NOT_REPLYABLE");
    }

    const createdAt = nowIso();
    const expiresAt = replyExpiry(createdAt);
    const replyId = newId("rep");
    await c.env.DB.prepare(
      `INSERT INTO replies (
        id, delivery_id, from_user_id, to_user_id, content, content_hash, status, rejection_code,
        created_at, pulled_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', NULL, ?, NULL, ?)`,
    )
      .bind(
        replyId,
        delivery.id,
        userId,
        delivery.senderId,
        parsed.data.content,
        await contentHash(parsed.data.content),
        createdAt,
        expiresAt,
      )
      .run();

    return c.json({ id: replyId, status: "available", expiresAt });
  });

  app.get("/v1/replies", async (c) => {
    const userId = requireUserId(c.req.raw.headers);
    if (!userId) {
      return jsonError(c, 401, "MISSING_USER_ID");
    }

    const pulledAt = nowIso();
    const rows = (
      await c.env.DB.prepare(
        `SELECT id, delivery_id AS deliveryId, from_user_id AS fromUserId, content
        FROM replies
        WHERE to_user_id = ?
          AND status = 'available'
          AND expires_at > ?
          AND content IS NOT NULL
        ORDER BY created_at ASC`,
      )
        .bind(userId, pulledAt)
        .all<{ id: string; deliveryId: string; fromUserId: string; content: string }>()
    ).results;

    for (const row of rows) {
      await c.env.DB.prepare("UPDATE replies SET status = 'pulled', pulled_at = ? WHERE id = ?")
        .bind(pulledAt, row.id)
        .run();
    }

    return c.json({
      replies: rows.map((row) => ({
        ...row,
        status: "pulled",
      })),
    });
  });

  app.post("/v1/reports", async (c) => {
    const userId = requireUserId(c.req.raw.headers);
    if (!userId) {
      return jsonError(c, 401, "MISSING_USER_ID");
    }

    const parsed = await parseBody(c, ReportSchema);
    if (!parsed.ok) {
      return jsonError(c, 400, "INVALID_REQUEST");
    }

    const id = newId("rpt");
    await c.env.DB.prepare(
      `INSERT INTO reports (
        id, reporter_id, target_type, target_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, userId, parsed.data.targetType, parsed.data.targetId, parsed.data.reason, nowIso())
      .run();

    if (parsed.data.targetType === "reply") {
      await c.env.DB.prepare("UPDATE replies SET status = 'reported' WHERE id = ?")
        .bind(parsed.data.targetId)
        .run();
    } else {
      await c.env.DB.prepare("UPDATE deliveries SET status = 'reported' WHERE id = ? OR bottle_id = ?")
        .bind(parsed.data.targetId, parsed.data.targetId)
        .run();
    }

    return c.json({ id });
  });
};
