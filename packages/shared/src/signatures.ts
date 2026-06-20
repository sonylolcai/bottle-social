export type CreateSignedPayloadInput = {
  privateKey: CryptoKey;
  method: string;
  path: string;
  timestamp: string;
  body: string;
};

export type VerifySignedPayloadInput = {
  publicKey: CryptoKey;
  method: string;
  path: string;
  timestamp: string;
  body: string;
  signature: string;
};

type BufferValue = Uint8Array & { toString(encoding: string): string };

type BufferLike = {
  from(
    input: ArrayBuffer | Uint8Array | string,
    encoding?: string
  ): BufferValue;
};

const encoder = new TextEncoder();

function getBuffer(): BufferLike | undefined {
  return (globalThis as typeof globalThis & { Buffer?: BufferLike }).Buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return globalThis.btoa(binary);
  }

  const buffer = getBuffer();
  if (buffer) {
    return buffer.from(bytes).toString("base64");
  }

  throw new Error("No base64 encoder is available");
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  const buffer = getBuffer();
  if (buffer) {
    const decoded = buffer.from(value, "base64");
    return new Uint8Array(decoded as unknown as Uint8Array);
  }

  throw new Error("No base64 decoder is available");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function createCanonicalMessage(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): Promise<string> {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    await sha256Base64(input.body)
  ].join("\n");
}

export async function createSignedPayload(
  input: CreateSignedPayloadInput
): Promise<{ signature: string }> {
  const message = await createCanonicalMessage(input);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    input.privateKey,
    encoder.encode(message)
  );

  return { signature: bytesToBase64(new Uint8Array(signature)) };
}

export async function verifySignedPayload(
  input: VerifySignedPayloadInput
): Promise<boolean> {
  try {
    const message = await createCanonicalMessage(input);
    return await crypto.subtle.verify(
      "Ed25519",
      input.publicKey,
      toArrayBuffer(base64ToBytes(input.signature)),
      encoder.encode(message)
    );
  } catch {
    return false;
  }
}
