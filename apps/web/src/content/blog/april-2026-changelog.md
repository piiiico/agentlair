---
title: "April 2026: did:web Identity, Trust Scoring, Pricing, and Community Integrations"
description: "AgentLair shipped MCP-I Level 2 Phase 1 compliance, a new trust scoring engine, self-service pricing and registration, full developer documentation, and welcomed its first three external integrations."
pubDate: 2026-04-18
authorName: "Pico"
---

A lot shipped in April. This is the canonical changelog.

---

## did:web Identity — MCP-I Level 2 Phase 1

Every AgentLair-issued AAT (Agent Authentication Token) now carries a `did:web` claim:

```
did:web:agentlair.dev:agents:{account_id}
```

This makes each agent a first-class identity subject on the open web. The DID document is served at:

```
GET /agents/:id/did.json
```

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:agentlair.dev:agents:acct_abc123",
  "verificationMethod": [{
    "id": "did:web:agentlair.dev:agents:acct_abc123#jwks",
    "type": "JsonWebKey2020",
    "controller": "did:web:agentlair.dev:agents:acct_abc123",
    "publicKeyJwk": { ... }
  }]
}
```

Any verifier that resolves `did:web` — and there are many — can now verify an AgentLair agent's identity without calling our API. The JWKS endpoint remains at `/.well-known/jwks.json` for direct verification.

This completes **MCP-I Level 2 Phase 1**. Phase 2 (VC delegation credentials at `/v1/credentials/delegation`) is scheduled for Q3 2026.

---

## Trust Scoring — Phase 1

We shipped a 3-dimension behavioral trust scoring engine sourced entirely from the audit log. No self-reported claims. No attestations. Observed behavior only.

**Three dimensions, each 0–100:**

| Dimension | What it measures |
|-----------|-----------------|
| **Consistency** | Rate of matching claim→behavior across action categories |
| **Restraint** | Rate of denied/suspicious actions (lower is worse) |
| **Transparency** | Completeness of audit trail coverage |

**Two endpoints:**

```bash
# Full trust profile
GET /v1/trust/:id
→ { score: 87, dimensions: { consistency: 91, restraint: 88, transparency: 82 }, ... }

# Fast gate — returns in <5ms for hot-path use
GET /v1/trust/:id/check
→ { trusted: true, score: 87, threshold: 70 }
```

The gate endpoint is designed to be called inline in tool dispatch paths. Below-threshold agents get the request rejected before it reaches your infrastructure.

The trust score is computed from `audit_log` entries, not observations — which means it reflects what the agent actually did, timestamped and signed.

---

## Pricing and Self-Service Registration

Four tiers are live:

| Tier | Price | Agents | Verifications |
|------|-------|--------|---------------|
| Free | $0 | 3 | 1,000/mo |
| Starter | $29/mo | 20 | 50,000/mo |
| Pro | $149/mo | 200 | 1,000,000/mo |
| Enterprise | Custom | Unlimited | Unlimited |

Per-verification pricing at `$0.001` via x402 is available on all paid tiers for burst traffic above plan limits.

**Self-service registration is live at [agentlair.dev/register](/register).** No form, no email required for the Free tier:

```bash
# What the registration page does under the hood:
curl -X POST https://api.agentlair.dev/v1/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent", "recovery_email": "you@example.com"}'

# → { "api_key": "al_live_...", "jwks_endpoint": "https://agentlair.dev/.well-known/jwks.json" }
```

You get an API key and JWKS endpoint immediately. Start issuing AATs in under two minutes.

See [agentlair.dev/pricing](/pricing) for the full tier comparison.

---

## Developer Documentation

Four documentation pages are live:

- [/docs](/docs) — Overview and architecture
- [/docs/quickstart](/docs/quickstart) — From zero to first verified AAT
- [/docs/api-reference](/docs/api-reference) — Full endpoint reference
- [/docs/concepts](/docs/concepts) — The trust model, AAT structure, and behavioral telemetry

If you found the previous "read the spec" onboarding painful, the quickstart gets you to a working integration in about 10 minutes.

---

## Community Integrations

Three external integrations shipped or opened in April. All three arrived organically — no seeded partnerships.

### springdrift (seamus-brady) — MERGED

[springdrift](https://github.com/seamus-brady/springdrift) is a Gleam/BEAM library for agent gate enforcement. **It is now the first confirmed external AgentLair integration.**

All four gate handlers are implemented — AAT verification, trust check, scope enforcement, and audit logging. The integration runs async fire-and-forget on the BEAM scheduler, which means gate checks don't block the calling process.

```gleam
import springdrift/agentlair

pub fn handle_request(req: Request, aat: String) -> Response {
  case agentlair.verify(aat, required_scope: "read:documents") {
    Ok(claims) -> serve_request(req, claims)
    Error(reason) -> agentlair.reject(reason)
  }
}
```

1,555 tests passing. The merge confirmed the AAT format is stable enough for external library authors to build on.

### task-orchestrator (jpicklyk) — Production

[task-orchestrator](https://github.com/jpicklyk/task-orchestrator) is an MCP server for AI agent task management. It reached **production adoption** in April: v3.2.0 merged a JWKS-based `ActorVerifier` that uses AgentLair as the identity reference implementation.

```kotlin
// From task-orchestrator v3.2.0
val verifier = ActorVerifier.fromJwks(
  jwksUri = "https://agentlair.dev/.well-known/jwks.json"
)
```

The `did:web` claim now carried in every AAT is directly relevant here — task-orchestrator uses it to populate the `claimedBy` field in atomic work assignments.

### DashClaw PR #85 (ucsandman) — Open

[DashClaw](https://github.com/ucsandman/dashclaw) is a dashboard agent framework. PR #85 wires in AgentLair token validation for agent authentication. The `al_name` claim resolution fix shipped from our side; the PR is open and awaiting ucsandman's review.

### Mastra PR #15271 — Open

PR #15271 adds AgentLair integration to [Mastra](https://github.com/mastra-ai/mastra), one of the larger TypeScript agent frameworks. `@agentlair/mastra` v0.1.0 is on npm. The PR is open and mergeable — if you're a Mastra user and want this, a review comment helps.

---

## What's Next

**Trust scoring API — public beta.** The trust scoring engine is live but gated. We're opening the `/v1/trust/:id/check` endpoint to all registered users in May. If you want early access, register at [/register](/register) and reach out.

**VC delegation credentials — Q3 2026.** Phase 2 of MCP-I Level 2: verifiable credential issuance at `/v1/credentials/delegation`. This is the piece that lets an agent delegate a scoped capability to a sub-agent with a cryptographically verifiable chain of authority. Not declarative policies — signed credentials.

---

If you're building something on AgentLair that isn't listed here, [open an issue](https://github.com/piiiico/agentlair) or reach out. The integrations above came in because those developers were solving real problems — that's the kind of signal we pay attention to.
