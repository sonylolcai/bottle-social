import { describe, expect, it } from "vitest";
import { createSignedPayload } from "../../shared/src/signatures";
import { createAgentIdentity } from "../src/identity";
import { createSignedHeaders, parseArgs } from "../src/commands";

const fromBase64 = (value: string): ArrayBuffer => {
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const requireHeader = (headers: Record<string, string>, name: string): string => {
  const value = headers[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

describe("dev agent commands", () => {
  it("parses command flags without depending on shell-specific syntax", () => {
    expect(
      parseArgs(["bottle", "--agent", "alice", "--content", "hello", "--language", "en"]),
    ).toEqual({
      command: "bottle",
      flags: {
        agent: "alice",
        content: "hello",
        language: "en",
      },
    });
  });

  it("creates headers that verify against the shared signature contract", async () => {
    const identity = {
      ...(await createAgentIdentity("alice", "http://localhost:8787")),
      userId: "usr_alice",
    };
    const body = JSON.stringify({ content: "hello", language: "en" });
    const headers = await createSignedHeaders(identity, "POST", "/v1/bottles", body);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      fromBase64(identity.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const timestamp = requireHeader(headers, "X-Timestamp");
    const signature = requireHeader(headers, "X-Signature");

    const expected = await createSignedPayload({
      privateKey: identity.privateKey,
      method: "POST",
      path: "/v1/bottles",
      timestamp,
      body,
    });

    expect(headers["X-User-Id"]).toBe(identity.userId);
    expect(signature).toBe(expected.signature);
    await expect(
      crypto.subtle.verify(
        "Ed25519",
        publicKey,
        fromBase64(signature),
        new TextEncoder().encode("not the canonical message"),
      ),
    ).resolves.toBe(false);
  });
});
