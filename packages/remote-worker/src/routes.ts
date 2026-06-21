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
import { verifySignedPayload } from "../../shared/src/signatures";
import { createAuditEventStatement, writeAuditEvent } from "./audit";
import { selectRecipients, type CandidateUser } from "./delivery";
import {
  contentHash,
  getUserForAuth,
  importRawEd25519PublicKey,
  isDailyBottleLimitError,
  jsonError,
  newId,
  nowIso,
  parseJsonText,
  readJson,
  type Env,
  type UserRow,
} from "./db";
import { bottleExpiry, replyExpiry } from "./expiry";
import { canStoreReply } from "./state-machine";

type App = Hono<{ Bindings: Env }>;
type AppContext = Context<{ Bindings: Env }>;
type AuthenticatedRequest = {
  user: UserRow;
  userId: string;
  bodyText: string;
};

const parseBody = async <T>(
  value: unknown,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false }> => {
  const result = schema.safeParse(value);
  return result.success ? { ok: true, data: result.data } : { ok: false };
};

const readPostBodyText = async (c: AppContext): Promise<string> => {
  if (c.req.raw.method === "GET" || c.req.raw.method === "HEAD") {
    return "";
  }
  return c.req.raw.text();
};

const getCanonicalPath = (c: AppContext): string => new URL(c.req.url).pathname;

const authenticate = async (c: AppContext): Promise<AuthenticatedRequest | Response> => {
  const userId = c.req.header("X-User-Id");
  const timestamp = c.req.header("X-Timestamp");
  const signature = c.req.header("X-Signature");
  const bodyText = await readPostBodyText(c);

  if (!userId || !timestamp || !signature) {
    return jsonError(c, 401, "MISSING_SIGNATURE_HEADERS");
  }

  const user = await getUserForAuth(c.env.DB, userId);
  if (!user) {
    return jsonError(c, 401, "INVALID_SIGNATURE");
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await importRawEd25519PublicKey(user.public_key);
  } catch {
    return jsonError(c, 401, "INVALID_SIGNATURE");
  }

  const verified = await verifySignedPayload({
    publicKey,
    method: c.req.raw.method,
    path: getCanonicalPath(c),
    timestamp,
    body: bodyText,
    signature,
  });
  if (!verified) {
    return jsonError(c, 401, "INVALID_SIGNATURE");
  }

  if (user.status !== "active" || user.is_adult !== 1) {
    return jsonError(c, 403, "USER_NOT_ACTIVE_ADULT");
  }

  return { user, userId, bodyText };
};

const isResponse = (value: AuthenticatedRequest | Response): value is Response => value instanceof Response;

export const registerRoutes = (app: App): void => {
  app.post("/v1/users", async (c) => {
    const parsed = await parseBody(await readJson(c), CreateUserSchema);
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
    const auth = await authenticate(c);
    if (isResponse(auth)) {
      return auth;
    }

    const parsed = await parseBody(parseJsonText(auth.bodyText), PersonalityProfileSchema);
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
        auth.userId,
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
    const auth = await authenticate(c);
    if (isResponse(auth)) {
      return auth;
    }

    const parsed = await parseBody(parseJsonText(auth.bodyText), SubmitBottleSchema);
    if (!parsed.ok) {
      return jsonError(c, 400, "INVALID_REQUEST");
    }

    const safety = checkTextSafety(parsed.data.content);
    if (!safety.ok) {
      return c.json({ error: safety.code }, 422);
    }

    const candidatesResult = await c.env.DB.prepare(
      "SELECT id, language, status FROM users WHERE language = ? AND status = 'active' AND is_adult = 1",
    )
      .bind(parsed.data.language)
      .all<CandidateUser>();
    const recipientIds = selectRecipients({
      senderId: auth.userId,
      bottleLanguage: parsed.data.language,
      candidates: candidatesResult.results,
      limit: 3,
    });

    const createdAt = nowIso();
    const bottleId = newId("bot");
    const expiresAt = bottleExpiry(createdAt);
    const status = recipientIds.length > 0 ? "delivered" : "approved";
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `INSERT INTO bottles (
          id, sender_id, content, content_hash, language, status, rejection_code, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).bind(
        bottleId,
        auth.userId,
        parsed.data.content,
        await contentHash(parsed.data.content),
        parsed.data.language,
        status,
        createdAt,
        expiresAt,
      ),
      ...recipientIds.map((recipientId) =>
        c.env.DB.prepare(
          `INSERT INTO deliveries (
            id, bottle_id, recipient_id, status, created_at, pulled_at, expires_at
          ) VALUES (?, ?, ?, 'available', ?, NULL, ?)`,
        ).bind(newId("del"), bottleId, recipientId, createdAt, expiresAt),
      ),
      await createAuditEventStatement(c.env.DB, {
        actorUserId: auth.userId,
        action: "bottle.submit",
        targetType: "bottle",
        targetId: bottleId,
        input: parsed.data.content,
        result: status,
      }),
    ];

    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      if (isDailyBottleLimitError(error)) {
        return c.json({ error: "DAILY_BOTTLE_LIMIT_REACHED" }, 429);
      }
      return jsonError(c, 500, "BOTTLE_BATCH_FAILED");
    }

    return c.json({ id: bottleId, status, deliveryCount: recipientIds.length });
  });

  app.get("/v1/inbox", async (c) => {
    const auth = await authenticate(c);
    if (isResponse(auth)) {
      return auth;
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
        .bind(auth.userId, pulledAt)
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
    const auth = await authenticate(c);
    if (isResponse(auth)) {
      return auth;
    }

    const parsed = await parseBody(parseJsonText(auth.bodyText), SubmitReplySchema);
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

    if (!delivery || delivery.recipientId !== auth.userId || !canStoreReply(delivery.status)) {
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
        auth.userId,
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
    const auth = await authenticate(c);
    if (isResponse(auth)) {
      return auth;
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
        .bind(auth.userId, pulledAt)
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
    const auth = await authenticate(c);
    if (isResponse(auth)) {
      return auth;
    }

    const parsed = await parseBody(parseJsonText(auth.bodyText), ReportSchema);
    if (!parsed.ok) {
      return jsonError(c, 400, "INVALID_REQUEST");
    }

    const id = newId("rpt");
    const createdAt = nowIso();
    const insertReport = c.env.DB.prepare(
      `INSERT INTO reports (
        id, reporter_id, target_type, target_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, auth.userId, parsed.data.targetType, parsed.data.targetId, parsed.data.reason, createdAt);

    if (parsed.data.targetType === "bottle") {
      const delivery = await c.env.DB.prepare("SELECT id, recipient_id AS recipientId FROM deliveries WHERE id = ?")
        .bind(parsed.data.targetId)
        .first<{ id: string; recipientId: string }>();
      if (!delivery) {
        return jsonError(c, 404, "REPORT_TARGET_NOT_FOUND");
      }
      if (delivery.recipientId !== auth.userId) {
        return jsonError(c, 403, "REPORT_NOT_AUTHORIZED");
      }
      await c.env.DB.batch([
        insertReport,
        c.env.DB.prepare("UPDATE deliveries SET status = 'reported' WHERE id = ?").bind(parsed.data.targetId),
      ]);
    } else {
      const reply = await c.env.DB.prepare(
        "SELECT id, from_user_id AS fromUserId, to_user_id AS toUserId FROM replies WHERE id = ?",
      )
        .bind(parsed.data.targetId)
        .first<{ id: string; fromUserId: string; toUserId: string }>();
      if (!reply) {
        return jsonError(c, 404, "REPORT_TARGET_NOT_FOUND");
      }
      if (reply.fromUserId !== auth.userId && reply.toUserId !== auth.userId) {
        return jsonError(c, 403, "REPORT_NOT_AUTHORIZED");
      }
      await c.env.DB.batch([
        insertReport,
        c.env.DB.prepare("UPDATE replies SET status = 'reported' WHERE id = ?").bind(parsed.data.targetId),
      ]);
    }

    return c.json({ id });
  });

  app.post("/v1/maintenance/expire", async (c) => {
    const now = nowIso();

    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE bottles SET content = NULL, status = 'expired' WHERE expires_at <= ? AND status IN ('approved', 'delivered')",
      ).bind(now),
      c.env.DB.prepare(
        "UPDATE deliveries SET status = 'expired' WHERE expires_at <= ? AND status = 'available'",
      ).bind(now),
      c.env.DB.prepare(
        "UPDATE replies SET content = NULL, status = 'expired' WHERE expires_at <= ? AND status IN ('available', 'pulled', 'reported')",
      ).bind(now),
    ]);

    return c.json({ ok: true });
  });
};
