import { describe, expect, it } from "vitest";
import { createSignedPayload, verifySignedPayload } from "../src/signatures";

describe("request signatures", () => {
  async function createSignedRequest() {
    const pair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );
    const body = JSON.stringify({ content: "hello" });
    const method = "POST";
    const path = "/v1/bottles";
    const timestamp = "2026-06-19T00:00:00.000Z";
    const signed = await createSignedPayload({
      privateKey: pair.privateKey,
      method,
      path,
      timestamp,
      body
    });

    return { pair, body, method, path, timestamp, signature: signed.signature };
  }

  it("verifies a signed request", async () => {
    const { pair, body, method, path, timestamp, signature } =
      await createSignedRequest();

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method,
        path,
        timestamp,
        body,
        signature
      })
    ).resolves.toBe(true);
  });

  it("rejects a tampered request body", async () => {
    const { pair, method, path, timestamp, signature } =
      await createSignedRequest();

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method,
        path,
        timestamp,
        body: JSON.stringify({ content: "goodbye" }),
        signature
      })
    ).resolves.toBe(false);
  });

  it("rejects a tampered request method", async () => {
    const { pair, body, path, timestamp, signature } =
      await createSignedRequest();

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method: "GET",
        path,
        timestamp,
        body,
        signature
      })
    ).resolves.toBe(false);
  });

  it("rejects a tampered request path", async () => {
    const { pair, body, method, timestamp, signature } =
      await createSignedRequest();

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method,
        path: "/v1/other-bottles",
        timestamp,
        body,
        signature
      })
    ).resolves.toBe(false);
  });

  it("rejects a tampered request timestamp", async () => {
    const { pair, body, method, path, signature } = await createSignedRequest();

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method,
        path,
        timestamp: "2026-06-20T00:00:00.000Z",
        body,
        signature
      })
    ).resolves.toBe(false);
  });

  it("rejects an invalid base64 signature", async () => {
    const { pair, body, method, path, timestamp } = await createSignedRequest();

    await expect(
      verifySignedPayload({
        publicKey: pair.publicKey,
        method,
        path,
        timestamp,
        body,
        signature: "!!!!"
      })
    ).resolves.toBe(false);
  });

  it("rejects newline injection in the path when signing", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );

    await expect(
      createSignedPayload({
        privateKey: pair.privateKey,
        method: "POST",
        path: "/v1/bottles\n2026-06-19T00:00:00.000Z",
        timestamp: "2026-06-19T00:00:00.000Z",
        body: JSON.stringify({ content: "hello" })
      })
    ).rejects.toThrow("path must not contain newline characters");
  });

  it("rejects newline injection in the timestamp when signing", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );

    await expect(
      createSignedPayload({
        privateKey: pair.privateKey,
        method: "POST",
        path: "/v1/bottles",
        timestamp: "2026-06-19T00:00:00.000Z\nbody-digest",
        body: JSON.stringify({ content: "hello" })
      })
    ).rejects.toThrow("timestamp must not contain newline characters");
  });

  it("rejects a non-letter request method when signing", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );

    await expect(
      createSignedPayload({
        privateKey: pair.privateKey,
        method: "POST1",
        path: "/v1/bottles",
        timestamp: "2026-06-19T00:00:00.000Z",
        body: JSON.stringify({ content: "hello" })
      })
    ).rejects.toThrow("method must contain only letters");
  });
});
