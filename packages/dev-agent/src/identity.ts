import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type StoredAgentIdentity = {
  agent: string;
  baseUrl: string;
  userId?: string;
  publicKey: string;
  privateKeyPkcs8: string;
};

export type AgentIdentity = Omit<StoredAgentIdentity, "privateKeyPkcs8"> & {
  privateKey: CryptoKey;
  privateKeyPkcs8: string;
};

const toBase64 = (value: ArrayBuffer): string => Buffer.from(value).toString("base64");

const fromBase64 = (value: string): ArrayBuffer => {
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const identityPath = (homeDir: string, agent: string): string => join(homeDir, `${agent}.json`);

export const defaultAgentHome = (): string => join(process.cwd(), ".drift-bottle", "agents");

export const createAgentIdentity = async (agent: string, baseUrl: string): Promise<AgentIdentity> => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    agent,
    baseUrl,
    publicKey: toBase64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateKey: pair.privateKey,
    privateKeyPkcs8: toBase64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  };
};

export const saveAgentIdentity = async (homeDir: string, identity: AgentIdentity): Promise<void> => {
  await mkdir(homeDir, { recursive: true });
  const stored: StoredAgentIdentity = {
    agent: identity.agent,
    baseUrl: identity.baseUrl,
    publicKey: identity.publicKey,
    privateKeyPkcs8: identity.privateKeyPkcs8,
  };
  if (identity.userId) {
    stored.userId = identity.userId;
  }
  await writeFile(identityPath(homeDir, identity.agent), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
};

export const loadAgentIdentity = async (homeDir: string, agent: string): Promise<AgentIdentity> => {
  const stored = JSON.parse(await readFile(identityPath(homeDir, agent), "utf8")) as StoredAgentIdentity;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64(stored.privateKeyPkcs8),
    { name: "Ed25519" },
    true,
    ["sign"],
  );
  return {
    ...stored,
    privateKey,
  };
};
