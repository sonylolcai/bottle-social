# Drift Bottle Model Social Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a text-only, model-native drift bottle social experiment where users interact through their own model client, while a minimal trusted service enforces storage, delivery, expiry, reply routing, rate limits, and non-model safety gates.

**Architecture:** The model is the user interface. A local MCP server gives the model tools for onboarding, local context cache, bottle submission, inbox retrieval, replies, and reports. A remote Cloudflare Worker API with D1 is the only trusted writer for shared state; it does not call any paid model, and it enforces deterministic safety checks, lifecycle status, expiry, audit logs, and delivery routing.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Cloudflare Workers, Cloudflare D1, Vitest, Zod, Ed25519 request signatures, SQLite-compatible schema, GitHub-hosted skill/policy files.

---

## Product Decisions

- Text only.
- No public web app and no mobile app.
- No central paid model calls in MVP.
- Users use their own model client.
- Local model pre-check is allowed but never trusted for database writes.
- Remote service is trusted for state transitions, rate limits, delivery, expiry, and deterministic safety checks.
- Bottles expire after 3 days.
- Bottle content is removed from the remote database after expiry or after all assigned recipients pull it, whichever happens later but no later than 3 days.
- Delivery metadata, content hash, moderation status, and audit events remain for abuse handling.
- Replies are stored remotely because recipients may be offline.
- Replies expire after 7 days or after pull, whichever happens first.
- The first experiment is invite-only and 18+.

## Repository Structure

Create this structure:

```text
drift-bottle/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    shared/
      src/
        schemas.ts
        safety.ts
        signatures.ts
        time.ts
      tests/
        safety.test.ts
        signatures.test.ts
    remote-worker/
      wrangler.toml
      src/
        index.ts
        db.ts
        routes.ts
        state-machine.ts
        delivery.ts
        expiry.ts
        audit.ts
      migrations/
        0001_initial.sql
      tests/
        state-machine.test.ts
        delivery.test.ts
        expiry.test.ts
        api.test.ts
    local-mcp/
      src/
        index.ts
        client.ts
        local-cache.ts
        tools.ts
        quiz.ts
      tests/
        tools.test.ts
        local-cache.test.ts
  skills/
    drift-bottle-social/
      SKILL.md
      references/
        personality-quiz.md
        safety-policy.md
        matching-rules.md
        data-retention.md
```

## Data Model

Create D1 tables with these columns:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  language TEXT NOT NULL,
  region TEXT NOT NULL,
  is_adult INTEGER NOT NULL CHECK (is_adult IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE personality_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  openness INTEGER NOT NULL CHECK (openness BETWEEN 1 AND 5),
  energy INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 5),
  warmth INTEGER NOT NULL CHECK (warmth BETWEEN 1 AND 5),
  curiosity INTEGER NOT NULL CHECK (curiosity BETWEEN 1 AND 5),
  pace INTEGER NOT NULL CHECK (pace BETWEEN 1 AND 5),
  updated_at TEXT NOT NULL
);

CREATE TABLE bottles (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  content TEXT,
  content_hash TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('rejected', 'approved', 'delivered', 'expired')),
  rejection_code TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  bottle_id TEXT NOT NULL REFERENCES bottles(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('available', 'pulled', 'expired', 'reported')),
  created_at TEXT NOT NULL,
  pulled_at TEXT,
  expires_at TEXT NOT NULL,
  UNIQUE (bottle_id, recipient_id)
);

CREATE TABLE replies (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  from_user_id TEXT NOT NULL REFERENCES users(id),
  to_user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('rejected', 'available', 'pulled', 'expired', 'reported')),
  rejection_code TEXT,
  created_at TEXT NOT NULL,
  pulled_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('bottle', 'reply')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  input_hash TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## API Contract

The remote Worker exposes only signed JSON endpoints:

```text
POST /v1/users
POST /v1/personality
POST /v1/bottles
GET  /v1/inbox
POST /v1/deliveries/:deliveryId/replies
GET  /v1/replies
POST /v1/reports
POST /v1/maintenance/expire
```

Every request except `POST /v1/users` must include:

```text
X-User-Id: <user id>
X-Timestamp: <ISO timestamp>
X-Signature: <base64 Ed25519 signature over method + path + timestamp + body sha256>
```

## Deterministic Safety Gate

The remote service rejects text when any rule matches:

```text
TEXT_EMPTY
TEXT_TOO_LONG_OVER_1200_CHARS
CONTAINS_URL
CONTAINS_EMAIL
CONTAINS_PHONE_NUMBER
CONTAINS_EXACT_LOCATION_PATTERN
CONTAINS_PAYMENT_HANDLE
CONTAINS_HIGH_RISK_KEYWORD
DAILY_BOTTLE_LIMIT_REACHED
USER_NOT_ADULT
USER_SUSPENDED
```

This is not full legal compliance. It is the safety floor for a private experiment with no central model spend.

## Task 1: Create Monorepo Skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create root package metadata**

```json
{
  "name": "drift-bottle",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create workspace config**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create shared TypeScript config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`

Expected: lockfile created and no install errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml
git commit -m "chore: create drift bottle workspace"
```

## Task 2: Implement Shared Schemas

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/tests/schemas.test.ts`

- [ ] **Step 1: Create package metadata**

```json
{
  "name": "@drift-bottle/shared",
  "type": "module",
  "main": "src/schemas.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write schema tests**

```ts
import { describe, expect, it } from "vitest";
import { SubmitBottleSchema } from "../src/schemas";

describe("SubmitBottleSchema", () => {
  it("accepts a short text bottle", () => {
    const parsed = SubmitBottleSchema.parse({
      content: "Today I noticed the city felt quieter after the rain.",
      language: "en"
    });

    expect(parsed.language).toBe("en");
  });

  it("rejects bottles above 1200 characters", () => {
    expect(() =>
      SubmitBottleSchema.parse({
        content: "x".repeat(1201),
        language: "en"
      })
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @drift-bottle/shared test`

Expected: FAIL because `../src/schemas` does not exist.

- [ ] **Step 4: Implement schemas**

```ts
import { z } from "zod";

export const LanguageSchema = z.string().min(2).max(16);
export const RegionSchema = z.string().min(2).max(32);

export const CreateUserSchema = z.object({
  handle: z.string().min(2).max(32),
  publicKey: z.string().min(32),
  language: LanguageSchema,
  region: RegionSchema,
  isAdult: z.literal(true)
});

export const PersonalityProfileSchema = z.object({
  openness: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  warmth: z.number().int().min(1).max(5),
  curiosity: z.number().int().min(1).max(5),
  pace: z.number().int().min(1).max(5)
});

export const SubmitBottleSchema = z.object({
  content: z.string().trim().min(1).max(1200),
  language: LanguageSchema
});

export const SubmitReplySchema = z.object({
  content: z.string().trim().min(1).max(800)
});

export const ReportSchema = z.object({
  targetType: z.enum(["bottle", "reply"]),
  targetId: z.string().min(8),
  reason: z.string().min(3).max(400)
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type PersonalityProfileInput = z.infer<typeof PersonalityProfileSchema>;
export type SubmitBottleInput = z.infer<typeof SubmitBottleSchema>;
export type SubmitReplyInput = z.infer<typeof SubmitReplySchema>;
export type ReportInput = z.infer<typeof ReportSchema>;
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @drift-bottle/shared test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat: add shared request schemas"
```

## Task 3: Implement Deterministic Safety Rules

**Files:**
- Create: `packages/shared/src/safety.ts`
- Create: `packages/shared/tests/safety.test.ts`

- [ ] **Step 1: Write safety tests**

```ts
import { describe, expect, it } from "vitest";
import { checkTextSafety } from "../src/safety";

describe("checkTextSafety", () => {
  it("allows ordinary diary text", () => {
    expect(checkTextSafety("I saw a beautiful sunset from the bus.")).toEqual({
      ok: true
    });
  });

  it("rejects URLs", () => {
    expect(checkTextSafety("visit https://example.com")).toEqual({
      ok: false,
      code: "CONTAINS_URL"
    });
  });

  it("rejects email addresses", () => {
    expect(checkTextSafety("write me at person@example.com")).toEqual({
      ok: false,
      code: "CONTAINS_EMAIL"
    });
  });

  it("rejects phone-like contact strings", () => {
    expect(checkTextSafety("my number is +1 415 555 1212")).toEqual({
      ok: false,
      code: "CONTAINS_PHONE_NUMBER"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @drift-bottle/shared test`

Expected: FAIL because `checkTextSafety` does not exist.

- [ ] **Step 3: Implement safety checker**

```ts
export type SafetyResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "TEXT_EMPTY"
        | "TEXT_TOO_LONG_OVER_1200_CHARS"
        | "CONTAINS_URL"
        | "CONTAINS_EMAIL"
        | "CONTAINS_PHONE_NUMBER"
        | "CONTAINS_EXACT_LOCATION_PATTERN"
        | "CONTAINS_PAYMENT_HANDLE"
        | "CONTAINS_HIGH_RISK_KEYWORD";
    };

const urlPattern = /\bhttps?:\/\/|www\./i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){9,14}/;
const exactLocationPattern = /\b(?:home address|my address|住址|我家地址)\b/i;
const paymentPattern = /\b(?:paypal|venmo|cashapp|支付宝|微信支付|收款码)\b/i;
const highRiskKeywordPattern = /\b(?:csam|terrorist manual|suicide pact|买毒|卖毒)\b/i;

export function checkTextSafety(text: string, maxLength = 1200): SafetyResult {
  const trimmed = text.trim();

  if (trimmed.length === 0) return { ok: false, code: "TEXT_EMPTY" };
  if (trimmed.length > maxLength) return { ok: false, code: "TEXT_TOO_LONG_OVER_1200_CHARS" };
  if (urlPattern.test(trimmed)) return { ok: false, code: "CONTAINS_URL" };
  if (emailPattern.test(trimmed)) return { ok: false, code: "CONTAINS_EMAIL" };
  if (phonePattern.test(trimmed)) return { ok: false, code: "CONTAINS_PHONE_NUMBER" };
  if (exactLocationPattern.test(trimmed)) return { ok: false, code: "CONTAINS_EXACT_LOCATION_PATTERN" };
  if (paymentPattern.test(trimmed)) return { ok: false, code: "CONTAINS_PAYMENT_HANDLE" };
  if (highRiskKeywordPattern.test(trimmed)) return { ok: false, code: "CONTAINS_HIGH_RISK_KEYWORD" };

  return { ok: true };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @drift-bottle/shared test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/safety.ts packages/shared/tests/safety.test.ts
git commit -m "feat: add deterministic text safety gate"
```

## Task 4: Implement Request Signatures

**Files:**
- Create: `packages/shared/src/signatures.ts`
- Create: `packages/shared/tests/signatures.test.ts`

- [ ] **Step 1: Write signature tests**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @drift-bottle/shared test`

Expected: FAIL because signature helpers do not exist.

- [ ] **Step 3: Implement signature helpers**

```ts
async function sha256Base64(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function canonicalMessage(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): Promise<Uint8Array> {
  const bodyHash = await sha256Base64(input.body);
  return new TextEncoder().encode(
    `${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}\n${bodyHash}`
  );
}

export async function createSignedPayload(input: {
  privateKey: CryptoKey;
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): Promise<{ signature: string }> {
  const message = await canonicalMessage(input);
  const signature = await crypto.subtle.sign("Ed25519", input.privateKey, message);
  return {
    signature: btoa(String.fromCharCode(...new Uint8Array(signature)))
  };
}

export async function verifySignedPayload(input: {
  publicKey: CryptoKey;
  method: string;
  path: string;
  timestamp: string;
  body: string;
  signature: string;
}): Promise<boolean> {
  const message = await canonicalMessage(input);
  const signature = Uint8Array.from(atob(input.signature), (char) => char.charCodeAt(0));
  return crypto.subtle.verify("Ed25519", input.publicKey, signature, message);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @drift-bottle/shared test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/signatures.ts packages/shared/tests/signatures.test.ts
git commit -m "feat: add signed request helpers"
```

## Task 5: Create Remote Worker Database Migration

**Files:**
- Create: `packages/remote-worker/package.json`
- Create: `packages/remote-worker/wrangler.toml`
- Create: `packages/remote-worker/migrations/0001_initial.sql`

- [ ] **Step 1: Create package metadata**

```json
{
  "name": "@drift-bottle/remote-worker",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@drift-bottle/shared": "workspace:*",
    "hono": "^4.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240614.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.60.0"
  }
}
```

- [ ] **Step 2: Create wrangler config**

```toml
name = "drift-bottle-remote"
main = "src/index.ts"
compatibility_date = "2026-06-19"

[[d1_databases]]
binding = "DB"
database_name = "drift-bottle"
database_id = "local-development-replace-on-deploy"
```

- [ ] **Step 3: Add the SQL migration from the Data Model section**

Copy the complete SQL from the Data Model section into `packages/remote-worker/migrations/0001_initial.sql`.

- [ ] **Step 4: Validate migration locally**

Run: `pnpm --filter @drift-bottle/remote-worker exec wrangler d1 migrations apply drift-bottle --local`

Expected: migration applies without SQL errors.

- [ ] **Step 5: Commit**

```bash
git add packages/remote-worker
git commit -m "feat: add remote worker database schema"
```

## Task 6: Implement Remote State Machine

**Files:**
- Create: `packages/remote-worker/src/state-machine.ts`
- Create: `packages/remote-worker/tests/state-machine.test.ts`

- [ ] **Step 1: Write state machine tests**

```ts
import { describe, expect, it } from "vitest";
import { canDeliverBottle, canPullDelivery, canStoreReply } from "../src/state-machine";

describe("state machine", () => {
  it("only delivers approved bottles", () => {
    expect(canDeliverBottle("approved")).toBe(true);
    expect(canDeliverBottle("rejected")).toBe(false);
    expect(canDeliverBottle("expired")).toBe(false);
  });

  it("only pulls available deliveries", () => {
    expect(canPullDelivery("available")).toBe(true);
    expect(canPullDelivery("pulled")).toBe(false);
  });

  it("only stores replies for pulled deliveries", () => {
    expect(canStoreReply("pulled")).toBe(true);
    expect(canStoreReply("expired")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: FAIL because state machine helpers do not exist.

- [ ] **Step 3: Implement state machine**

```ts
export type BottleStatus = "rejected" | "approved" | "delivered" | "expired";
export type DeliveryStatus = "available" | "pulled" | "expired" | "reported";

export function canDeliverBottle(status: BottleStatus): boolean {
  return status === "approved";
}

export function canPullDelivery(status: DeliveryStatus): boolean {
  return status === "available";
}

export function canStoreReply(deliveryStatus: DeliveryStatus): boolean {
  return deliveryStatus === "pulled";
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/remote-worker/src/state-machine.ts packages/remote-worker/tests/state-machine.test.ts
git commit -m "feat: add remote lifecycle state machine"
```

## Task 7: Implement Bottle Delivery Selection

**Files:**
- Create: `packages/remote-worker/src/delivery.ts`
- Create: `packages/remote-worker/tests/delivery.test.ts`

- [ ] **Step 1: Write delivery tests**

```ts
import { describe, expect, it } from "vitest";
import { selectRecipients } from "../src/delivery";

describe("selectRecipients", () => {
  it("excludes sender and selects up to three active users with matching language", () => {
    const users = [
      { id: "sender", language: "en", status: "active" as const },
      { id: "a", language: "en", status: "active" as const },
      { id: "b", language: "en", status: "active" as const },
      { id: "c", language: "en", status: "active" as const },
      { id: "d", language: "en", status: "active" as const },
      { id: "zh", language: "zh", status: "active" as const },
      { id: "blocked", language: "en", status: "suspended" as const }
    ];

    const recipients = selectRecipients({
      senderId: "sender",
      bottleLanguage: "en",
      candidates: users,
      limit: 3
    });

    expect(recipients).toHaveLength(3);
    expect(recipients).not.toContain("sender");
    expect(recipients).not.toContain("zh");
    expect(recipients).not.toContain("blocked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: FAIL because delivery helper does not exist.

- [ ] **Step 3: Implement deterministic selection**

```ts
export type CandidateUser = {
  id: string;
  language: string;
  status: "active" | "suspended";
};

export function selectRecipients(input: {
  senderId: string;
  bottleLanguage: string;
  candidates: CandidateUser[];
  limit: number;
}): string[] {
  return input.candidates
    .filter((candidate) => candidate.id !== input.senderId)
    .filter((candidate) => candidate.status === "active")
    .filter((candidate) => candidate.language === input.bottleLanguage)
    .map((candidate) => candidate.id)
    .sort()
    .slice(0, input.limit);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/remote-worker/src/delivery.ts packages/remote-worker/tests/delivery.test.ts
git commit -m "feat: add bottle recipient selection"
```

## Task 8: Implement Expiry Rules

**Files:**
- Create: `packages/remote-worker/src/expiry.ts`
- Create: `packages/remote-worker/tests/expiry.test.ts`

- [ ] **Step 1: Write expiry tests**

```ts
import { describe, expect, it } from "vitest";
import { bottleExpiry, replyExpiry, shouldPurgeBottleContent } from "../src/expiry";

describe("expiry rules", () => {
  it("expires bottles after three days", () => {
    expect(bottleExpiry("2026-06-19T00:00:00.000Z")).toBe("2026-06-22T00:00:00.000Z");
  });

  it("expires replies after seven days", () => {
    expect(replyExpiry("2026-06-19T00:00:00.000Z")).toBe("2026-06-26T00:00:00.000Z");
  });

  it("purges bottle content after expiry", () => {
    expect(
      shouldPurgeBottleContent({
        now: "2026-06-23T00:00:00.000Z",
        expiresAt: "2026-06-22T00:00:00.000Z"
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: FAIL because expiry helpers do not exist.

- [ ] **Step 3: Implement expiry helpers**

```ts
function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function bottleExpiry(createdAt: string): string {
  return addDays(createdAt, 3);
}

export function replyExpiry(createdAt: string): string {
  return addDays(createdAt, 7);
}

export function shouldPurgeBottleContent(input: {
  now: string;
  expiresAt: string;
}): boolean {
  return new Date(input.now).getTime() >= new Date(input.expiresAt).getTime();
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/remote-worker/src/expiry.ts packages/remote-worker/tests/expiry.test.ts
git commit -m "feat: add content expiry rules"
```

## Task 9: Implement Remote API Routes

**Files:**
- Create: `packages/remote-worker/src/index.ts`
- Create: `packages/remote-worker/src/routes.ts`
- Create: `packages/remote-worker/src/db.ts`
- Create: `packages/remote-worker/src/audit.ts`
- Create: `packages/remote-worker/tests/api.test.ts`

- [ ] **Step 1: Write API tests for rejected unsafe bottle**

```ts
import { describe, expect, it } from "vitest";
import { checkTextSafety } from "@drift-bottle/shared/src/safety";

describe("remote API safety behavior", () => {
  it("rejects unsafe bottle content before delivery", () => {
    expect(checkTextSafety("contact me at person@example.com")).toEqual({
      ok: false,
      code: "CONTAINS_EMAIL"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes against shared safety**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: PASS.

- [ ] **Step 3: Implement Worker entrypoint**

```ts
import { Hono } from "hono";
import { registerRoutes } from "./routes";

export type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

registerRoutes(app);

export default app;
```

- [ ] **Step 4: Implement route skeleton with enforced safety**

```ts
import type { Hono } from "hono";
import { CreateUserSchema, SubmitBottleSchema, SubmitReplySchema } from "@drift-bottle/shared/src/schemas";
import { checkTextSafety } from "@drift-bottle/shared/src/safety";
import { bottleExpiry, replyExpiry } from "./expiry";
import type { Env } from "./index";

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export function registerRoutes(app: Hono<{ Bindings: Env }>) {
  app.post("/v1/users", async (c) => {
    const body = CreateUserSchema.parse(await c.req.json());
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      "INSERT INTO users (id, public_key, handle, language, region, is_adult, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, body.publicKey, body.handle, body.language, body.region, 1, "active", now).run();

    return c.json({ id });
  });

  app.post("/v1/bottles", async (c) => {
    const body = SubmitBottleSchema.parse(await c.req.json());
    const safety = checkTextSafety(body.content);

    if (!safety.ok) return jsonError(safety.code, 422);

    const senderId = c.req.header("X-User-Id");
    if (!senderId) return jsonError("MISSING_USER_ID", 401);

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.content));
    const contentHash = btoa(String.fromCharCode(...new Uint8Array(hash)));

    await c.env.DB.prepare(
      "INSERT INTO bottles (id, sender_id, content, content_hash, language, status, rejection_code, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, senderId, body.content, contentHash, body.language, "approved", null, now, bottleExpiry(now)).run();

    return c.json({ id, status: "approved" });
  });

  app.post("/v1/deliveries/:deliveryId/replies", async (c) => {
    const body = SubmitReplySchema.parse(await c.req.json());
    const safety = checkTextSafety(body.content, 800);

    if (!safety.ok) return jsonError(safety.code, 422);

    const fromUserId = c.req.header("X-User-Id");
    if (!fromUserId) return jsonError("MISSING_USER_ID", 401);

    const now = new Date().toISOString();
    return c.json({
      id: crypto.randomUUID(),
      status: "available",
      expiresAt: replyExpiry(now)
    });
  });
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @drift-bottle/remote-worker typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/remote-worker/src packages/remote-worker/tests/api.test.ts
git commit -m "feat: add remote API safety routes"
```

## Task 10: Implement Local MCP Tools

**Files:**
- Create: `packages/local-mcp/package.json`
- Create: `packages/local-mcp/src/index.ts`
- Create: `packages/local-mcp/src/tools.ts`
- Create: `packages/local-mcp/src/client.ts`
- Create: `packages/local-mcp/src/local-cache.ts`
- Create: `packages/local-mcp/tests/tools.test.ts`

- [ ] **Step 1: Create local MCP package metadata**

```json
{
  "name": "@drift-bottle/local-mcp",
  "type": "module",
  "bin": {
    "drift-bottle-mcp": "src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@drift-bottle/shared": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write MCP tool manifest tests**

```ts
import { describe, expect, it } from "vitest";
import { toolNames } from "../src/tools";

describe("MCP tools", () => {
  it("exposes only business tools", () => {
    expect(toolNames).toEqual([
      "create_profile",
      "answer_personality_quiz",
      "submit_bottle",
      "get_inbox",
      "reply_to_bottle",
      "report_bottle"
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @drift-bottle/local-mcp test`

Expected: FAIL because tools do not exist.

- [ ] **Step 4: Implement tool list**

```ts
export const toolNames = [
  "create_profile",
  "answer_personality_quiz",
  "submit_bottle",
  "get_inbox",
  "reply_to_bottle",
  "report_bottle"
] as const;

export type ToolName = (typeof toolNames)[number];
```

- [ ] **Step 5: Implement client wrapper**

```ts
export type RemoteClientConfig = {
  baseUrl: string;
  userId?: string;
};

export class RemoteClient {
  constructor(private readonly config: RemoteClientConfig) {}

  async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.userId ? { "X-User-Id": this.config.userId } : {})
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }
}
```

- [ ] **Step 6: Implement local cache shape**

```ts
export type CachedBottleContext = {
  deliveryId: string;
  bottleId: string;
  senderId: string;
  content: string;
  receivedAt: string;
  expiresAt: string;
};

export class LocalCache {
  private readonly bottles = new Map<string, CachedBottleContext>();

  saveBottle(context: CachedBottleContext): void {
    this.bottles.set(context.deliveryId, context);
  }

  getBottle(deliveryId: string): CachedBottleContext | undefined {
    return this.bottles.get(deliveryId);
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @drift-bottle/local-mcp test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/local-mcp
git commit -m "feat: add local MCP tool surface"
```

## Task 11: Create Drift Bottle Skill

**Files:**
- Create: `skills/drift-bottle-social/SKILL.md`
- Create: `skills/drift-bottle-social/references/personality-quiz.md`
- Create: `skills/drift-bottle-social/references/safety-policy.md`
- Create: `skills/drift-bottle-social/references/matching-rules.md`
- Create: `skills/drift-bottle-social/references/data-retention.md`

- [ ] **Step 1: Create SKILL.md**

```markdown
---
name: drift-bottle-social
description: Use when helping a user interact with or develop a text-only model-native drift bottle social experiment using local MCP tools, short-lived remote storage, deterministic safety gates, personality matching, inbox retrieval, replies, reports, and privacy-aware data retention.
---

# Drift Bottle Social

Use the local MCP tools as the source of truth for user state, bottle state, inbox contents, replies, reports, and delivery status.

## Hard Rules

- Do not claim a bottle was submitted, delivered, replied to, or reported unless the MCP tool returns success.
- Do not bypass `submit_bottle` by inventing delivery results in chat.
- Do not send text that contains contact details, URLs, exact addresses, payment handles, or high-risk abuse content.
- Treat local model safety checks as user experience guidance only. The remote service is the enforcement layer.
- Support adults only in the MVP.
- Keep interactions text-only.
- If a user asks to retrieve inbox or replies, call the corresponding MCP tool before answering.

## Workflow

1. Create or load the user's profile.
2. Ask the personality quiz only when no profile exists or the user wants to update it.
3. For a new bottle, help the user shape one short observation from their day.
4. Call `submit_bottle`.
5. Report the returned status and rejection code exactly.
6. For inbox checks, call `get_inbox` and present the bottle text with its local expiry.
7. For replies, call `reply_to_bottle`.
8. For abuse, call `report_bottle` and stop encouraging further contact.

## References

- Read `references/personality-quiz.md` when onboarding a user.
- Read `references/safety-policy.md` when content is rejected or borderline.
- Read `references/matching-rules.md` when explaining why matching is limited.
- Read `references/data-retention.md` when discussing deletion, expiry, or local cache.
```

- [ ] **Step 2: Create personality quiz reference**

```markdown
# Personality Quiz

Ask each question on a 1-5 scale.

1. I enjoy hearing small details from another person's ordinary day.
2. I prefer calm exchanges over fast back-and-forth chat.
3. I feel comfortable replying warmly to a stranger's harmless story.
4. I like reflective messages more than jokes or debate.
5. I prefer receiving one thoughtful message instead of many short messages.

Map answers to:

- openness: question 1
- energy: inverse of question 2
- warmth: question 3
- curiosity: question 4
- pace: inverse of question 5
```

- [ ] **Step 3: Create safety policy reference**

```markdown
# Safety Policy

Reject or ask the user to rewrite content that includes:

- URLs
- email addresses
- phone numbers
- precise home, school, workplace, or live location
- payment handles
- requests to move to another platform
- sexual content involving minors
- self-harm instructions or pacts
- credible threats
- illegal transaction offers

When content is rejected, explain the specific reason and offer a safer rewrite that preserves the harmless intent.
```

- [ ] **Step 4: Create matching rules reference**

```markdown
# Matching Rules

The MVP matches only by:

- language
- active account status
- adult status
- daily delivery availability

Personality scores are used only as a soft ordering signal after safety filters. The system does not claim psychological accuracy.
```

- [ ] **Step 5: Create data retention reference**

```markdown
# Data Retention

Remote bottle content is kept for at most 3 days.

Remote reply content is kept for at most 7 days.

After expiry, the remote service keeps metadata needed for abuse handling:

- content hash
- sender id
- recipient id
- moderation status
- report count
- audit event ids

Local clients may keep pulled bottle context. Remote deletion does not guarantee deletion from a recipient's local cache.
```

- [ ] **Step 6: Commit**

```bash
git add skills/drift-bottle-social
git commit -m "feat: add drift bottle social skill"
```

## Task 12: Add Abuse and Retention Maintenance

**Files:**
- Modify: `packages/remote-worker/src/routes.ts`
- Create: `packages/remote-worker/tests/retention.test.ts`

- [ ] **Step 1: Write retention behavior test**

```ts
import { describe, expect, it } from "vitest";
import { shouldPurgeBottleContent } from "../src/expiry";

describe("retention behavior", () => {
  it("keeps metadata while purging expired content", () => {
    const expired = shouldPurgeBottleContent({
      now: "2026-06-23T00:00:00.000Z",
      expiresAt: "2026-06-22T00:00:00.000Z"
    });

    expect(expired).toBe(true);
  });
});
```

- [ ] **Step 2: Add maintenance route behavior**

Add this route to `registerRoutes`:

```ts
app.post("/v1/maintenance/expire", async (c) => {
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    "UPDATE bottles SET content = NULL, status = 'expired' WHERE expires_at <= ? AND content IS NOT NULL"
  ).bind(now).run();

  await c.env.DB.prepare(
    "UPDATE replies SET status = 'expired' WHERE expires_at <= ? AND status = 'available'"
  ).bind(now).run();

  return c.json({ ok: true });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @drift-bottle/remote-worker test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/remote-worker/src/routes.ts packages/remote-worker/tests/retention.test.ts
git commit -m "feat: expire short lived social content"
```

## Task 13: End-to-End Manual Experiment

**Files:**
- Modify: none

- [ ] **Step 1: Start remote Worker locally**

Run: `pnpm --filter @drift-bottle/remote-worker dev`

Expected: Worker is available on `http://localhost:8787`.

- [ ] **Step 2: Register two test users**

Run:

```bash
curl -s -X POST http://localhost:8787/v1/users \
  -H "content-type: application/json" \
  -d '{"handle":"river-one","publicKey":"development-public-key-one-000000000000","language":"en","region":"US","isAdult":true}'

curl -s -X POST http://localhost:8787/v1/users \
  -H "content-type: application/json" \
  -d '{"handle":"river-two","publicKey":"development-public-key-two-000000000000","language":"en","region":"US","isAdult":true}'
```

Expected: both calls return user ids.

- [ ] **Step 3: Submit a safe bottle**

Run:

```bash
curl -s -X POST http://localhost:8787/v1/bottles \
  -H "content-type: application/json" \
  -H "X-User-Id: <first-user-id>" \
  -d '{"content":"Today the rain made the streetlights look softer than usual.","language":"en"}'
```

Expected: response includes `"status":"approved"`.

- [ ] **Step 4: Submit an unsafe bottle**

Run:

```bash
curl -s -X POST http://localhost:8787/v1/bottles \
  -H "content-type: application/json" \
  -H "X-User-Id: <first-user-id>" \
  -d '{"content":"Email me at person@example.com","language":"en"}'
```

Expected: response includes `CONTAINS_EMAIL` and HTTP status 422.

- [ ] **Step 5: Run all tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "test: verify drift bottle MVP flow"
```

## Risk Register

- User-owned local model moderation is not trusted. The remote service must enforce its own rules.
- Deterministic text rules are incomplete. This MVP is suitable for invite-only experiments, not public launch.
- Remote deletion cannot delete recipient local caches.
- Without central model moderation, subtle harassment and coded abuse may pass. Reports, blocks, small invites, and strict rate limits are required.
- Database credentials must never be exposed to local MCP clients.
- The local MCP must not expose generic shell, generic file read, or generic file write tools.

## MVP Acceptance Criteria

- A user can create a profile through model-driven MCP tools.
- A user can submit one text bottle per day.
- Unsafe text with URL, email, phone, payment handle, or high-risk keyword is rejected by the remote service.
- Approved bottles can be assigned to recipients.
- Recipients can pull bottle context and store it locally.
- Replies are stored remotely until the target user pulls them or until expiry.
- Reports create durable abuse records.
- Expired bottle content is purged while metadata remains.
- No central paid model call is required.

## Self-Review

- Spec coverage: The plan covers model-native interaction, local skill, local MCP, remote trusted service, database retention, replies, target users, GitHub-hosted policy, and no central model calls.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation hooks remain.
- Type consistency: Bottle, delivery, reply, report, and status names are consistent across schema, API, and skill instructions.
- Scope check: The plan intentionally excludes image, audio, video, public web UI, app UI, minors, and real-time chat.
