# @agentlair/verify

Lightweight AAT (Agent Authentication Token) verification for Node.js, Bun, Deno, and edge runtimes.

Fetches JWKS from agentlair.dev, caches keys, and validates EdDSA JWTs in one function call. Zero configuration needed.

## Install

```bash
npm install @agentlair/verify
# or
bun add @agentlair/verify
```

## Quick Start

```typescript
import { verifyAAT } from '@agentlair/verify';

const result = await verifyAAT(token);

if (result.valid) {
  console.log('Agent ID:', result.agentId);          // "acc_abc123"
  console.log('Agent email:', result.operatorEmail); // "my-agent@agentlair.dev"
  console.log('Scopes:', result.scopes);             // ["mcp:tools:read", ...]
  console.log('Issued at:', result.issuedAt);        // Date
  console.log('Expires at:', result.expiresAt);      // Date
} else {
  console.error('Token rejected:', result.error);
}
```

## API

### `verifyAAT(token, options?)`

Verifies an AgentLair AAT. Fetches JWKS from agentlair.dev, caches keys, and validates the EdDSA signature and JWT claims.

```typescript
const result = await verifyAAT(token, {
  jwksUrl: 'https://agentlair.dev/.well-known/jwks.json', // default
  audience: 'https://my-service.example.com',             // optional: enforce aud claim
  maxAge: '1h',                                           // optional: reject tokens older than 1 hour
  cacheTtl: 300_000,                                      // JWKS cache TTL in ms (default: 5 min)
  requiredClaims: { iss: 'https://agentlair.dev' },       // optional: additional claim checks
});
```

**Returns:** `VerifyResult`

```typescript
// On success:
{
  valid: true,
  agentId: string,         // sub claim — AgentLair account ID
  operatorEmail: string | undefined,  // al_email claim
  issuedAt: Date,
  expiresAt: Date,
  scopes: string[],        // al_scopes claim
  claims: AATClaims,       // full decoded payload for advanced use
}

// On failure:
{
  valid: false,
  error: string,           // human-readable reason
}
```

### `clearJWKSCache()`

Clears the module-level JWKS cache. Useful in tests or when forcing a key refresh.

```typescript
import { clearJWKSCache } from '@agentlair/verify';
clearJWKSCache();
```

## Middleware

### Express

```typescript
import express from 'express';
import { createExpressMiddleware } from '@agentlair/verify';

const app = express();

// Protect all /api routes
app.use('/api', createExpressMiddleware({
  audience: 'https://my-api.example.com',
}));

app.get('/api/data', (req, res) => {
  // req.aat is set after successful verification
  console.log('Agent:', req.aat?.agentId);
  console.log('Scopes:', req.aat?.scopes);
  res.json({ ok: true });
});
```

TypeScript: extend the request type to get autocomplete:

```typescript
declare global {
  namespace Express {
    interface Request {
      aat?: import('@agentlair/verify').VerifyResult & { valid: true };
    }
  }
}
```

### Hono

```typescript
import { Hono } from 'hono';
import { createHonoMiddleware } from '@agentlair/verify';

const app = new Hono<{
  Variables: { aat: import('@agentlair/verify').VerifyResult & { valid: true } }
}>();

app.use('/api/*', createHonoMiddleware({
  audience: 'https://my-api.example.com',
}));

app.get('/api/data', (c) => {
  const aat = c.get('aat');
  return c.json({ agentId: aat.agentId, scopes: aat.scopes });
});
```

### Fastify

```typescript
import Fastify from 'fastify';
import { createFastifyHook } from '@agentlair/verify';

const fastify = Fastify();

fastify.addHook('preHandler', createFastifyHook({
  audience: 'https://my-api.example.com',
}));

fastify.get('/api/data', async (request) => {
  console.log('Agent:', request.aat?.agentId);
  return { ok: true };
});
```

## Behavioral Event Reporting (RFC-003)

Report behavioral telemetry back to AgentLair to improve your agent's trust score. Events feed the trust engine's consistency, restraint, and transparency dimensions.

### Quick start

```typescript
import { reportEvent } from '@agentlair/verify';

await reportEvent(
  {
    event_id: crypto.randomUUID(),         // client-generated idempotency key
    timestamp: new Date().toISOString(),   // when the event occurred
    category: 'tool',                      // see EventCategory below
    action: 'tool.invoke',                 // freeform within category
    result: 'success',                     // "success" | "failure" | "denied" | "timeout"
    metadata: { tool_name: 'read_file', file_type: 'json', bytes: 4096 },
  },
  {
    aat: process.env.AGENTLAIR_AAT!,
  }
);
```

### Batch reporting

```typescript
import { reportBatch } from '@agentlair/verify';

await reportBatch(events, { aat: process.env.AGENTLAIR_AAT! });
// Up to 100 events per call
```

### Buffered reporting (high-throughput agents)

```typescript
import { createEventBuffer } from '@agentlair/verify';

const buffer = createEventBuffer({
  aat: process.env.AGENTLAIR_AAT!,
  flushAt: 50,          // flush when 50 events accumulate
  flushInterval: 5000,  // or every 5 seconds, whichever comes first
  onFlushError: (err) => console.error('Event flush failed:', err),
});

// Add events throughout your session
await buffer.add({ event_id: crypto.randomUUID(), ... });

// At shutdown: flush remaining events and clear timers
await buffer.destroy();
```

### Event schema

```typescript
interface BehavioralEvent {
  event_id: string;          // UUID or nanoid — used for deduplication
  timestamp: string;         // ISO 8601, when the event occurred (not submission time)
  category: EventCategory;
  action: string;            // Freeform description (e.g. "tool.invoke", "resource.read")
  result: EventResult;

  // Optional enrichment
  resource_type?: string;    // e.g. "file", "database", "api"
  duration_ms?: number;      // How long the action took
  error_code?: string;       // Machine-readable error identifier
  scope_used?: string;       // Which scope was exercised
  metadata?: Record<string, string | number | boolean>;  // Max 10 keys
}

type EventCategory =
  | "tool"        // Tool/function invocations
  | "resource"    // Resource access (files, DBs, APIs)
  | "auth"        // Authentication events
  | "session"     // Lifecycle (start, end, crash)
  | "escalation"  // Privilege escalation attempts
  | "delegation"  // Cross-agent delegation
  | "error";      // Unhandled errors, violations

type EventResult = "success" | "failure" | "denied" | "timeout";
```

### Privacy rules

Events MUST NOT contain:
- Raw request/response bodies
- Exact prompts or LLM outputs
- End-user identifiers
- File contents or database query results
- Credentials, tokens, or secrets

The `metadata` field is for structural annotations only (e.g., `{"tool_name": "read_file", "file_type": "json", "bytes": 4096}`).

### Rate limits

| Tier | Events/hour | Events/day | Burst (per minute) |
|------|-------------|------------|-------------------|
| Default | 1,000 | 10,000 | 100 |
| Verified operator | 5,000 | 50,000 | 500 |

The SDK automatically retries on 429 (up to `maxRetries` times, default 2), respecting the `Retry-After` header.

### ReportOptions

```typescript
interface ReportOptions {
  aat: string;          // AAT for authentication (required)
  baseUrl?: string;     // Default: "https://agentlair.dev"
  sessionId?: string;   // Optional: group events by session
  maxRetries?: number;  // Retry on 429. Default: 2
}
```

## How it works

1. The JWT header contains a `kid` (key ID).
2. `@agentlair/verify` fetches `https://agentlair.dev/.well-known/jwks.json` and caches the response for 5 minutes (configurable).
3. The matching JWK is selected by `kid` — key ID matching, not array position. This means key rotation is seamless.
4. The EdDSA (Ed25519) signature is verified using the public key.
5. Standard JWT claims (`exp`, `iat`, `iss`) and AgentLair-specific claims (`al_scopes`, `al_audit_url`) are validated.

## Error messages

Clear error messages for common failure modes:

| Situation | Error |
|-----------|-------|
| Token expired | `Token expired at 2026-04-20T12:00:00.000Z` |
| Wrong issuer | `Invalid claim "iss": check failed` |
| Audience mismatch | `Invalid claim "aud": check failed` |
| Bad signature | `Signature verification failed: token may be tampered or signed with wrong key` |
| Unknown key | `No matching key in JWKS: key ID not found or key has been rotated` |
| JWKS fetch failed | `Failed to fetch JWKS: <network error>` |
| Malformed JWT | `Malformed token: expected 3-part JWT (header.payload.signature)` |

## Types

```typescript
import type {
  AATClaims,      // Full JWT payload type
  VerifyOptions,  // Options for verifyAAT()
  VerifyResult,   // Return type of verifyAAT()
  MiddlewareOptions, // Options for middleware factories
} from '@agentlair/verify';
```

### `AATClaims`

```typescript
interface AATClaims {
  // Standard JWT
  iss: string;          // "https://agentlair.dev"
  sub: string;          // AgentLair account ID
  aud: string;          // Target audience URL
  exp: number;          // Expiration (Unix seconds)
  iat: number;          // Issued at (Unix seconds)
  jti: string;          // Unique token ID

  // AgentLair-specific
  al_scopes: string[];  // Granted scopes
  al_audit_url: string; // Audit trail link
  al_name?: string;     // Agent name
  al_email?: string;    // Agent email (@agentlair.dev)

  // MCP-I Level 2 interop
  did?: string;         // e.g. "did:web:agentlair.dev:agents:acc_xxx"

  // Trust attestation (RFC-001 Phase 1)
  al_trust?: {
    score: number;       // [0, 100]
    level: 'intern' | 'junior' | 'senior' | 'principal';
    confidence: number;  // [0.0, 1.0]
    computed_at: string; // ISO 8601
    trend: 'improving' | 'stable' | 'declining';
  };
}
```

## Requirements

- Node.js ≥ 18 (Web Crypto API required)
- Bun (any version)
- Deno (any version)
- Edge runtimes: Cloudflare Workers, Vercel Edge Functions, etc.

## License

MIT — [AgentLair](https://agentlair.dev)
