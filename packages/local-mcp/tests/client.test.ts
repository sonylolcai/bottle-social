import { describe, expect, it } from "vitest";
import { RemoteClient } from "../src/client";

describe("RemoteClient", () => {
  it("signs JSON requests with the local identity", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new RemoteClient({
      baseUrl: "https://example.test",
      userId: "usr_1",
      privateKey: pair.privateKey,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json({ ok: true });
      },
    });

    await client.post("/v1/personality", { openness: 1, energy: 2, warmth: 3, curiosity: 4, pace: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.test/v1/personality");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("X-User-Id")).toBe("usr_1");
    expect(headers.get("X-Timestamp")).toMatch(/Z$/);
    expect(headers.get("X-Signature")).toBeTruthy();
  });

  it("throws remote error responses", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const client = new RemoteClient({
      baseUrl: "https://example.test",
      userId: "usr_1",
      privateKey: pair.privateKey,
      fetchImpl: async () => Response.json({ error: "NOPE" }, { status: 400 }),
    });

    await expect(client.post("/v1/bottles", { content: "x", language: "en" })).rejects.toThrow("NOPE");
  });
});
