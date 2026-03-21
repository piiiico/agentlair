# AgentLair API Test Suite

Integration tests hitting the live API at `https://agentlair.dev`.

## Location

Tests live at `src/api.test.ts` — co-located with source modules per Bun convention.

## Running

```bash
# Run against production (default)
bun test src/api.test.ts

# With a pre-created API key (avoids IP rate limit of 5 keys/hour)
TEST_API_KEY=al_live_... bun test src/api.test.ts

# With two keys (enables ownership/isolation tests)
TEST_API_KEY=al_live_... TEST_API_KEY2=al_live_... bun test src/api.test.ts

# With a pre-claimed email address (avoids free tier address limit of 10)
TEST_API_KEY=al_live_... TEST_EMAIL_ADDRESS=testbot@agentlair.dev bun test src/api.test.ts

# Run against local dev
BASE_URL=http://localhost:8787 bun test src/api.test.ts
```

## Coverage

96 test cases across:
- **Public routes** (5): health, API docs, A2A card, CORS
- **Auth: Key creation** (2): POST /v1/auth/keys + alias
- **Auth: Agent register** (8): success, auto-address, name derivation, address validation, reserved, rate limit
- **Auth: Login** (3): magic link happy path, invalid/missing email
- **Auth: Token verify** (2): missing/invalid token
- **Auth: Keys management** (3): list, backup, rotate
- **Auth: E2E key rotation** (3): recovery email storage + validation
- **Auth: failures** (3): no auth, invalid key, malformed header
- **Account** (4): GET me, set recovery email, validation, persistence
- **Email: Claim** (5): already-owned, non-agentlair domain, missing address, stolen address, no auth
- **Email: Inbox** (8): missing params, returns messages, isolation, wrong domain, message CRUD, no auth
- **Email: Addresses** (2): list, no auth
- **Email: Send** (5): missing fields, non-agentlair sender, stolen address, happy path, no auth
- **Email: Outbox** (2): list, no auth
- **Email: Webhooks** (5): register, list, delete non-existent, delete, no auth
- **Vault: Unauthenticated** (5): store, missing seed, invalid email, recover, invalid email
- **Vault: KV store** (11): list, no auth, PUT, missing ciphertext, GET, versioning, not found, isolation, DELETE, delete-missing, list-contains
- **Stacks** (5): create, missing domain, list, idempotent, no auth
- **Observations** (8): write, missing fields, content too long, list, topic filter, topics, shared scope, no auth
- **Usage & Billing** (4): usage, usage-no-auth, billing, billing-no-auth
