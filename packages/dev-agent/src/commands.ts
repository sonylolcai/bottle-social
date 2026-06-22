import { createSignedPayload } from "../../shared/src/signatures";
import type { AgentIdentity } from "./identity";

export type ParsedArgs = {
  command: string;
  flags: Record<string, string>;
};

export const parseArgs = (argv: string[]): ParsedArgs => {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item?.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = value;
    index += 1;
  }

  return { command, flags };
};

export const requireFlag = (flags: Record<string, string>, name: string): string => {
  const value = flags[name];
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
};

export const createSignedHeaders = async (
  identity: AgentIdentity,
  method: string,
  path: string,
  body: string,
): Promise<Record<string, string>> => {
  if (!identity.userId) {
    throw new Error(`Agent ${identity.agent} does not have a userId. Run create-profile first.`);
  }
  const timestamp = new Date().toISOString();
  const signed = await createSignedPayload({
    privateKey: identity.privateKey,
    method,
    path,
    timestamp,
    body,
  });
  return {
    "content-type": "application/json",
    "X-User-Id": identity.userId,
    "X-Timestamp": timestamp,
    "X-Signature": signed.signature,
  };
};

export const requestJson = async (
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<unknown> => {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, init);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }
  return payload;
};
