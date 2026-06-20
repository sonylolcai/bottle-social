import { describe, expect, it } from "vitest";
import { createSignedPayload, verifySignedPayload } from "../src/signatures";

describe("request signatures", () => {
  it("verifies a signed request", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );

    const body = JSON.stringify({ content: "hello" });
    const signed = await createSignedPayload({
      privateKey: pair.privateKey,
      method: "POST",
      path: "/v1/bottles",
      timestamp: "2026-06-19T00:00:00.000Z",
      body
    });

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method: "POST",
        path: "/v1/bottles",
        timestamp: "2026-06-19T00:00:00.000Z",
        body,
        signature: signed.signature
      })
    ).resolves.toBe(true);
  });

  it("rejects a tampered request body", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );

    const signed = await createSignedPayload({
      privateKey: pair.privateKey,
      method: "POST",
      path: "/v1/bottles",
      timestamp: "2026-06-19T00:00:00.000Z",
      body: JSON.stringify({ content: "hello" })
    });

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method: "POST",
        path: "/v1/bottles",
        timestamp: "2026-06-19T00:00:00.000Z",
        body: JSON.stringify({ content: "goodbye" }),
        signature: signed.signature
      })
    ).resolves.toBe(false);
  });
});
