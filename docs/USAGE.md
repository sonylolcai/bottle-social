# Drift Bottle Usage

This project is a text-only, model-native drift bottle social experiment.

The model or local MCP layer is the user interface. The remote Worker is the trusted shared-state writer.

## Install

```powershell
pnpm install
```

## Test

Run everything:

```powershell
pnpm test
pnpm typecheck
```

Run individual packages:

```powershell
pnpm --filter @drift-bottle/shared test
pnpm --filter @drift-bottle/remote-worker test
pnpm --filter @drift-bottle/local-mcp test
```

## Database Migration

Apply the D1 migration locally:

```powershell
pnpm --filter @drift-bottle/remote-worker exec wrangler d1 migrations apply drift-bottle --local
```

The migration creates:

- users
- personality profiles
- bottles
- deliveries
- replies
- reports
- audit events

It also enforces lifecycle constraints so expired bottle and reply rows cannot keep remote content.

## Remote Worker

Start the Worker locally:

```powershell
pnpm --filter @drift-bottle/remote-worker dev
```

Or start the same Worker inside Docker, with local D1 data persisted in a Docker volume:

```powershell
pnpm docker:up
```

Stop it with:

```powershell
pnpm docker:down
```

The Worker exposes:

- `POST /v1/users`
- `POST /v1/personality`
- `POST /v1/bottles`
- `GET /v1/inbox`
- `POST /v1/deliveries/:deliveryId/replies`
- `GET /v1/replies`
- `POST /v1/reports`
- `POST /v1/maintenance/expire`

All routes except `POST /v1/users` require:

- `X-User-Id`
- `X-Timestamp`
- `X-Signature`

The signature uses the shared canonical contract:

```text
METHOD
PATH
TIMESTAMP
SHA256_BASE64_BODY
```

The local MCP `RemoteClient` signs requests with the user's Ed25519 private key.

## Local Multi-Agent Test

After the Worker is running on `http://localhost:8787`, use the dev agent CLI to simulate different local agents.

Create two local identities and remote profiles:

```powershell
pnpm agent create-profile --agent alice --handle Alice --language en --region US
pnpm agent create-profile --agent bob --handle Bob --language en --region US
```

Save their personality profiles:

```powershell
pnpm agent quiz --agent alice --openness 4 --energy 3 --warmth 5 --curiosity 4 --pace 2
pnpm agent quiz --agent bob --openness 3 --energy 4 --warmth 4 --curiosity 5 --pace 3
```

Send a bottle from Alice:

```powershell
pnpm agent bottle --agent alice --content "Today I saw a quiet street after the rain." --language en
```

Pull Bob's inbox:

```powershell
pnpm agent inbox --agent bob
```

Use the returned `deliveryId` to reply:

```powershell
pnpm agent reply --agent bob --delivery-id del_xxx --content "It reached me. The rain note felt peaceful."
```

Then Alice can pull replies:

```powershell
pnpm agent replies --agent alice
```

Local agent identities are stored under `.drift-bottle/agents` and are ignored by git.

## Current E2E Coverage

`packages/remote-worker/tests/api.test.ts` runs the Worker app in memory with a D1-compatible SQLite adapter. It verifies:

- user creation with base64 raw Ed25519 public keys
- signed profile upsert
- missing and spoofed signatures rejected
- unsafe bottle content rejected before insert
- safe bottle delivery to matching recipient
- inbox pull
- reply creation after delivery pull
- reply retrieval
- authorized report handling
- unauthorized report rejection
- suspended or nonexistent user rejection
- one bottle per user per UTC day
- transactional rollback on delivery insert failure
- remote content expiry through maintenance

## Current Limits

- Text only.
- Adults only.
- No public web app or mobile app.
- Remote moderation is deterministic rules only, not full legal/compliance review.
- Pulled bottle context may remain in a user's local cache after remote expiry.
