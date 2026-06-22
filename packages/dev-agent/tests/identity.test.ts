import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentIdentity, loadAgentIdentity, saveAgentIdentity } from "../src/identity";

describe("dev agent identity", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("stores an Ed25519 identity that can be loaded for signing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "drift-agent-"));
    const identity = await createAgentIdentity("alice", "http://localhost:8787");
    await saveAgentIdentity(tempDir, identity);

    const loaded = await loadAgentIdentity(tempDir, "alice");

    expect(loaded.agent).toBe("alice");
    expect(loaded.baseUrl).toBe("http://localhost:8787");
    expect(loaded.publicKey).toEqual(identity.publicKey);
    expect(loaded.privateKey.type).toBe("private");
  });
});
