import type { Context } from "hono";

export type Env = {
  DB: D1Database;
};

export const nowIso = (): string => new Date().toISOString();

export const utcDayBounds = (iso: string): { start: string; end: string } => {
  const date = new Date(iso);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
};

export const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;

export const contentHash = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const jsonError = (c: Context<{ Bindings: Env }>, status: number, error: string) =>
  c.json({ error }, status as never);

export const readJson = async (c: Context<{ Bindings: Env }>): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
};

export type UserRow = {
  id: string;
  language: string;
  is_adult: number;
  status: "active" | "suspended";
};

export const getActiveAdultUser = async (db: D1Database, userId: string): Promise<UserRow | null> =>
  db
    .prepare(
      "SELECT id, language, is_adult, status FROM users WHERE id = ? AND status = 'active' AND is_adult = 1",
    )
    .bind(userId)
    .first<UserRow>();
