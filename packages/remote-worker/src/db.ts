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
  public_key: string;
  language: string;
  is_adult: number;
  status: "active" | "suspended";
};

export const getActiveAdultUser = async (db: D1Database, userId: string): Promise<UserRow | null> =>
  db
    .prepare(
      "SELECT id, public_key, language, is_adult, status FROM users WHERE id = ? AND status = 'active' AND is_adult = 1",
    )
    .bind(userId)
    .first<UserRow>();

export const getUserForAuth = async (db: D1Database, userId: string): Promise<UserRow | null> =>
  db
    .prepare("SELECT id, public_key, language, is_adult, status FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  const buffer = (globalThis as typeof globalThis & { Buffer?: { from(value: string, encoding: string): Uint8Array } })
    .Buffer;
  if (buffer) {
    return new Uint8Array(buffer.from(value, "base64"));
  }

  throw new Error("No base64 decoder is available");
};

export const importRawEd25519PublicKey = async (base64Key: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(base64Key)), { name: "Ed25519" }, false, ["verify"]);

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export const parseJsonText = (bodyText: string): unknown => {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
};

export const isDailyBottleLimitError = (error: unknown): boolean =>
  error instanceof Error &&
  /idx_bottles_sender_utc_day|UNIQUE constraint failed|constraint failed/i.test(error.message);
