---
title: "Developer Quickstart: Trust-Verified Agents with AgentLair"
description: "Everything a developer needs to register agents, issue JWTs, verify trust scores, and integrate AgentLair into MCP servers and CI/CD pipelines."
pubDate: 2026-04-19
authorName: "Pico"
---

Most agent frameworks solve the *capability* problem: how do you give an agent tools? AgentLair solves the *identity* problem: how does anyone — human, service, or another agent — know whether to trust the agent holding those tools?

AgentLair is L4 behavioral trust infrastructure for autonomous agents. It handles three things: **credential issuance** (signed JWTs with verifiable `did:web` claims), **runtime behavioral monitoring** (an append-only observation log), and **trust scoring** (a 0–100 composite across consistency, restraint, and transparency). Every interaction your agent has with an external service can be authenticated, every behavioral pattern can be measured, and any relying party can verify both — without calling home.

This guide takes you from zero to a fully trust-verified agent in about 15 minutes.

---

## Quickstart: Your First Verified Agent

### Step 1: Register as an operator

An operator is a human or organization that owns one or more agents. Register with your email to create an account that can provision agents.

```bash
curl -X POST https://agentlair.dev/v1/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-research-agent",
    "recovery_email": "you@example.com",
    "capabilities": ["mcp:tools:read", "mcp:tools:execute"]
  }'
```

Response:

```json
{
  "api_key": "al_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "account_id": "acc_xxxxxxxxxxxxxxxx",
  "email_address": "my-research-agent@agentlair.dev",
  "tier": "free",
  "status": "restricted",
  "created_at": "2026-04-19T12:00:00Z",
  "warning": "Save your API key — it will not be shown again.",
  "limits": {
    "emails_per_day": 10,
    "requests_per_day": 100
  },
  "restrictions": {
    "outbound_email_recipients": ["you@example.com"],
    "note": "POST /v1/register/verify to unlock"
  }
}
```

**Save your `api_key` now. It is shown exactly once.**

If `my-research-agent` is already taken, AgentLair appends a 4-digit suffix or you can specify any address explicitly with the `address` field. Providing `recovery_email` puts the account in `restricted` mode until you verify via OTP — recommended for production agents.

---

### Step 2: Issue an Agent Auth Token (AAT)

An AAT is a short-lived, audience-bound EdDSA JWT. It is what your agent presents to external services to prove its identity.

```bash
curl -X POST https://agentlair.dev/v1/tokens/issue \
  -H "Authorization: Bearer al_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "audience": "https://mcp.yourservice.com",
    "ttl": 3600,
    "scopes": ["mcp:tools:read", "mcp:tools:execute"]
  }'
```

Response:

```json
{
  "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImExYjJjM2Q0In0...",
  "expires_at": "2026-04-19T13:00:00Z",
  "jti": "aat_xyz789"
}
```

**AAT constraints:**

| Parameter | Default | Range |
|-----------|---------|-------|
| `ttl` | 3600s | 60s – 86400s |
| `audience` | — | Required, HTTPS URL |
| Scopes per token | — | Max 20, within account ceiling |

**What's inside the JWT:**

```json
{
  "header": {
    "alg": "EdDSA",
    "typ": "JWT",
    "kid": "a1b2c3d4"
  },
  "payload": {
    "iss": "https://agentlair.dev",
    "sub": "acc_xxxxxxxxxxxxxxxx",
    "aud": "https://mcp.yourservice.com",
    "exp": 1745100000,
    "iat": 1745096400,
    "jti": "aat_xyz789",
    "did": "did:web:agentlair.dev:agents:acc_xxxxxxxxxxxxxxxx",
    "al_scopes": ["mcp:tools:read", "mcp:tools:execute"],
    "al_name": "my-research-agent",
    "al_email": "my-research-agent@agentlair.dev",
    "al_audit_url": "https://agentlair.dev/v1/audit/aat_xyz789",
    "al_trust": {
      "score": 78,
      "level": "senior",
      "confidence": 0.82,
      "computed_at": "2026-04-19T12:00:00Z"
    }
  }
}
```

Key claims: `did` gives the agent a W3C-standard decentralized identity. `al_trust` is an embedded trust snapshot (present once the agent has ≥10 behavioral observations). `al_audit_url` points to the full audit trail for this specific token.

---

### Step 3: Verify via JWKS

Any service can verify an AAT without calling AgentLair at runtime. The platform publishes its signing keys at the standard JWKS endpoint:

```bash
curl https://agentlair.dev/.well-known/jwks.json
```

Here's how to verify an AAT in Node.js using the `jose` library:

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://agentlair.dev/.well-known/jwks.json")
);

async function verifyAAT(token: string, expectedAudience: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://agentlair.dev",
    audience: expectedAudience,
    algorithms: ["EdDSA"],
  });

  return {
    agentId: payload.sub,
    did: payload.did as string,
    scopes: payload.al_scopes as string[],
    trust: payload.al_trust as { score: number; level: string } | undefined,
    auditUrl: payload.al_audit_url as string,
  };
}

// Usage
const agent = await verifyAAT(
  incomingBearerToken,
  "https://mcp.yourservice.com"
);

if (!agent.scopes.includes("mcp:tools:execute")) {
  throw new Error("Insufficient scope");
}
```

JWKS verification is fully offline after the initial key fetch. Keys are cached — you don't pay a network round-trip per request. AgentLair also supports per-agent JWKS at `/agents/{name}/.well-known/jwks.json` and full DID document resolution at `/agents/{id}/did.json` for W3C DID resolution flows.

---

### Step 4: Check the trust score

Trust scores are computed from behavioral observations AgentLair collects over time. The score runs 0–100 across three dimensions:

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| **Restraint** | 43% | Appropriate resource usage — scope utilization, credential frequency, rate limit proximity, escalation behavior |
| **Consistency** | 36% | Predictable patterns — session regularity, tool stability, error stability over a 90-day window |
| **Transparency** | 21% | Auditability — audit trail coverage, chain integrity, authenticated operations |

```bash
curl https://agentlair.dev/v1/trust/acc_xxxxxxxxxxxxxxxx \
  -H "Authorization: Bearer al_live_your_api_key"
```

Response:

```json
{
  "agentId": "acc_xxxxxxxxxxxxxxxx",
  "score": 78,
  "confidence": 0.82,
  "atfLevel": "senior",
  "trend": "improving",
  "dimensions": {
    "consistency": { "score": 75, "confidence": 0.80 },
    "restraint": { "score": 80, "confidence": 0.85 },
    "transparency": { "score": 75, "confidence": 0.78 }
  },
  "observationCount": 142,
  "computedAt": "2026-04-19T12:00:00Z"
}
```

**ATF maturity levels:**

| Level | Score range | Notes |
|-------|-------------|-------|
| `intern` | 0–39 | Cold-start default: 30 |
| `junior` | 40–64 | Building history |
| `senior` | 65–84 | Minimum 0.5 confidence |
| `principal` | 85–100 | Minimum 0.8 confidence |

New agents start at a skeptical prior of 30. The prior is overridden after 10+ observations and fully replaced by empirical scoring after 100. Entropy is penalized — if all dimensions score above 0.95, the effective max is capped at 85. Trust doesn't get handed out for existing; it gets earned by behaving predictably, appropriately, and transparently.

---

## Integration Patterns

### MCP server guard

The most common integration: verify the AAT before handling any tool call. Reference pattern from the Springdrift integration.

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { McpRequest, McpResponse } from "@modelcontextprotocol/sdk";

const JWKS = createRemoteJWKSet(
  new URL("https://agentlair.dev/.well-known/jwks.json")
);

async function agentLairMiddleware(
  req: McpRequest,
  next: () => Promise<McpResponse>
): Promise<McpResponse> {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: { code: -32001, message: "Missing AAT" } };
  }

  try {
    const { payload } = await jwtVerify(
      authHeader.slice(7),
      JWKS,
      {
        issuer: "https://agentlair.dev",
        audience: "https://mcp.yourservice.com",
        algorithms: ["EdDSA"],
      }
    );

    const trust = payload.al_trust as { score: number; level: string } | undefined;

    // Fail open if trust hasn't been established yet (< 10 observations)
    // Fail closed once you have data
    if (trust && trust.score < 40) {
      return {
        error: { code: -32003, message: "Trust score too low for this operation" },
      };
    }

    // Attach to request context for downstream handlers
    (req as any).agent = {
      id: payload.sub,
      did: payload.did,
      scopes: payload.al_scopes,
      trust,
    };

    return next();
  } catch (err) {
    return { error: { code: -32001, message: "Invalid or expired AAT" } };
  }
}
```

The fail-open pattern on new agents is deliberate — blocking agents with no observation history punishes legitimate new deployments.

---

### CI/CD trust gate

Reference pattern from the task-orchestrator integration: check trust score before allowing an agent to trigger a deployment.

```bash
#!/bin/bash
# ci-trust-check.sh

AGENT_ID="${AGENTLAIR_AGENT_ID}"
MIN_SCORE="${MIN_TRUST_SCORE:-65}"
API_KEY="${AGENTLAIR_API_KEY}"

TRUST=$(curl -s \
  -H "Authorization: Bearer ${API_KEY}" \
  "https://agentlair.dev/v1/trust/${AGENT_ID}")

SCORE=$(echo "$TRUST" | jq -r '.score')
LEVEL=$(echo "$TRUST" | jq -r '.atfLevel')
CONFIDENCE=$(echo "$TRUST" | jq -r '.confidence')

echo "Trust: ${SCORE}/100 (${LEVEL}, confidence: ${CONFIDENCE})"

if [ "$(echo "$SCORE < $MIN_SCORE" | bc)" = "1" ]; then
  echo "BLOCKED: Score ${SCORE} below threshold ${MIN_SCORE}"
  exit 1
fi

echo "APPROVED: Agent cleared for deployment"
```

Set `MIN_TRUST_SCORE=65` (senior level) in your CI environment. First-time agents will need to accumulate observations before they can self-deploy — that's the point.

---

### HTTP middleware (Express/Hono)

For REST APIs that want to verify agent identity on every request:

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://agentlair.dev/.well-known/jwks.json")
);

// Hono middleware
app.use("/api/*", async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: "https://agentlair.dev",
      audience: new URL(c.req.url).origin,
      algorithms: ["EdDSA"],
    });

    c.set("agent", payload);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});
```

For token introspection (RFC 7662 compliant, useful when you need real-time revocation checks):

```bash
curl -X POST https://agentlair.dev/v1/tokens/introspect \
  -H "Content-Type: application/json" \
  -d '{"token": "eyJhbGci..."}'
```

This endpoint is public — no API key required. Returns `{ "active": true, ... }` or `{ "active": false }`.

---

## Pricing and Rate Limits

AgentLair's free tier is designed to be genuinely useful for development and small deployments. Pay-per-use overages via USDC micropayments (x402 protocol on Base L2) let you exceed limits without committing to a subscription.

| Feature | Free | Starter ($29/mo) | Pro ($149/mo) |
|---------|------|-----------------|--------------|
| Agents | 3 | Unlimited | Unlimited |
| Token verifications/month | 1,000 | 10,000 | Unlimited |
| API requests/day | 100 | 10,000 | Unlimited |
| Outbound emails/day | 10 | Unlimited | Unlimited |
| Stacks (custom domains) | 1 | Unlimited | Unlimited |

**x402 overage pricing** (pay per-use when limits exceeded):

| Service | Price |
|---------|-------|
| Token verification | 0.001 USDC |
| Agent provisioning | 0.01 USDC |
| Email send | 0.01 USDC |
| Stack creation | 0.01 USDC |
| Tier upgrade (30 days) | 5.00 USDC |

When your agent hits a limit, the API returns HTTP 402 with an `X-402-Version` header. Your agent constructs a USDC authorization payload, attaches it as `X-PAYMENT`, and retries. The server verifies the signature, settles on Base, and allows the request. Receipts are stored in `/v1/billing`.

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/register` | — | Register agent (returns API key) |
| `POST` | `/v1/tokens/issue` | Bearer | Issue AAT for a target audience |
| `POST` | `/v1/tokens/introspect` | — | Verify token (RFC 7662, public) |
| `POST` | `/v1/tokens/revoke` | Bearer | Revoke token by JTI |
| `GET` | `/v1/tokens/info` | — | Token service capabilities |
| `GET` | `/v1/trust/:agent_id` | Bearer | Get behavioral trust score |
| `POST` | `/v1/observations` | Bearer | Write behavioral observation |
| `GET` | `/v1/observations` | Bearer | Read observation history |
| `GET` | `/v1/usage` | Bearer | Account usage and limits |
| `GET` | `/v1/billing` | Bearer | x402 spending history |
| `POST` | `/v1/email/send` | Bearer | Send email (402-payable) |
| `GET` | `/v1/email/inbox` | Bearer | Read incoming messages |
| `PUT` | `/v1/vault/{key}` | Bearer | Write encrypted secret (zero-knowledge — encrypt client-side first) |
| `GET` | `/v1/vault/{key}` | Bearer | Read encrypted secret |
| `POST` | `/v1/stack` | Bearer | Create custom domain stack |
| `GET` | `/v1/stack` | Bearer | List stacks |
| `GET` | `/.well-known/jwks.json` | — | Platform signing keys |
| `GET` | `/.well-known/openid-configuration` | — | OIDC discovery (RFC 8414) |
| `GET` | `/agents/:id/did.json` | — | W3C DID document |
| `GET` | `/agents/:name/.well-known/jwks.json` | — | Per-agent JWKS |

All authenticated endpoints accept `Authorization: Bearer al_live_...` (API key) or `Authorization: Bearer eyJ...` (AAT where supported). All responses are JSON. Errors follow `{ "error": "message" }` format.

---

## What to build next

The pattern most teams land on: agents issue short-lived AATs at the start of each session, present them to every service they call, and accumulate observations passively. After a few weeks of normal operation, trust scores stabilize — and you can start using them to gate permissions, auto-approve routine actions, or flag anomalies.

A few integrations worth looking at:

- **[Prism MCP](https://agentlair.dev/blog/prism-mcp-agentlair-integration)** — memory server that gates writes by trust level
- **[EmDash Trust Guard](https://agentlair.dev/blog/emdash-trust-guard)** — CMS plugin that requires `senior` trust to publish
- **[claude-code-git-reset-approval-gate](https://agentlair.dev/blog/claude-code-git-reset-approval-gate)** — blocks destructive git ops below trust threshold

Questions? Email [support@agentlair.dev](mailto:support@agentlair.dev). API issues can be filed on [GitHub](https://github.com/piiiico/agentlair). Trust score methodology is documented in the [RFC-001](https://agentlair.dev/rfcs/RFC-001-agentlair-idp.md).
