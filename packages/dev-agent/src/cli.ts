#!/usr/bin/env node
import { createSignedHeaders, parseArgs, requestJson, requireFlag } from "./commands";
import {
  createAgentIdentity,
  defaultAgentHome,
  loadAgentIdentity,
  saveAgentIdentity,
  type AgentIdentity,
} from "./identity";

const help = `Usage:
  drift-bottle-agent create-profile --agent alice --handle Alice --language en --region US [--base-url http://localhost:8787]
  drift-bottle-agent quiz --agent alice --openness 4 --energy 3 --warmth 5 --curiosity 4 --pace 2
  drift-bottle-agent bottle --agent alice --content "Today I saw..." [--language en]
  drift-bottle-agent inbox --agent bob
  drift-bottle-agent reply --agent bob --delivery-id del_x --content "It reached me."
  drift-bottle-agent replies --agent alice
`;

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const signedRequest = async (
  identity: AgentIdentity,
  method: string,
  path: string,
  bodyValue?: unknown,
): Promise<unknown> => {
  const body = bodyValue === undefined ? "" : JSON.stringify(bodyValue);
  const headers = await createSignedHeaders(identity, method, path, body);
  return requestJson(identity.baseUrl, path, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  });
};

const asScore = (value: string): number => {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("Personality scores must be integers from 1 to 5.");
  }
  return score;
};

const main = async (): Promise<void> => {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const homeDir = flags.home ?? defaultAgentHome();

  if (command === "help" || flags.help === "true") {
    process.stdout.write(help);
    return;
  }

  if (command === "create-profile") {
    const agent = requireFlag(flags, "agent");
    const identity = await createAgentIdentity(agent, flags["base-url"] ?? "http://localhost:8787");
    const profile = await requestJson(identity.baseUrl, "/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle: flags.handle ?? agent,
        publicKey: identity.publicKey,
        language: flags.language ?? "en",
        region: flags.region ?? "US",
        isAdult: true,
      }),
    }) as { id: string };
    const saved = { ...identity, userId: profile.id };
    await saveAgentIdentity(homeDir, saved);
    printJson({ agent, userId: profile.id, identityFile: `${homeDir}\\${agent}.json` });
    return;
  }

  const identity = await loadAgentIdentity(homeDir, requireFlag(flags, "agent"));

  if (command === "quiz") {
    printJson(await signedRequest(identity, "POST", "/v1/personality", {
      openness: asScore(requireFlag(flags, "openness")),
      energy: asScore(requireFlag(flags, "energy")),
      warmth: asScore(requireFlag(flags, "warmth")),
      curiosity: asScore(requireFlag(flags, "curiosity")),
      pace: asScore(requireFlag(flags, "pace")),
    }));
    return;
  }

  if (command === "bottle") {
    printJson(await signedRequest(identity, "POST", "/v1/bottles", {
      content: requireFlag(flags, "content"),
      language: flags.language ?? "en",
    }));
    return;
  }

  if (command === "inbox") {
    printJson(await signedRequest(identity, "GET", "/v1/inbox"));
    return;
  }

  if (command === "reply") {
    const deliveryId = requireFlag(flags, "delivery-id");
    printJson(await signedRequest(identity, "POST", `/v1/deliveries/${deliveryId}/replies`, {
      content: requireFlag(flags, "content"),
    }));
    return;
  }

  if (command === "replies") {
    printJson(await signedRequest(identity, "GET", "/v1/replies"));
    return;
  }

  throw new Error(`Unknown command: ${command}\n${help}`);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
