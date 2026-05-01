---
title: "Behavioral Health Certificate: Public Specification"
description: "A Behavioral Health Certificate is a signed JWT that captures an AI agent's observed behavioral profile. This page defines the format, claims, verification flow, and how it compares to other receipt and attestation formats."
pubDate: 2026-05-01
draft: true
schemaType: "TechArticle"
---

A **Behavioral Health Certificate (BHC)** is a signed JWT that summarizes an AI agent's observed behavioral profile over a defined time window. It answers a question that identity tokens can't: not *who* the agent is, but *how it's been acting*.

AgentLair issues BHCs based on continuous behavioral telemetry. Any relying party can verify them offline using AgentLair's public JWKS endpoint.

---

## Why behavioral certificates exist

Authentication proves identity. Authorization proves permission. Neither proves behavior.

An agent with valid credentials can still exhibit anomalous patterns: sudden spikes in API call velocity, access to resources it has never touched before, error rates that diverge from its own baseline. These are the signals that indicate compromise, prompt injection, or misconfiguration — and they're invisible to auth tokens.

A BHC makes behavioral trust portable. Instead of every consuming service building its own monitoring, the agent carries a cryptographic summary of its recent behavior that any service can inspect and verify.

---

## Certificate structure

A BHC is a standard JWT ([RFC 7519](https://www.rfc-editor.org/rfc/rfc7519)) signed with Ed25519 (EdDSA, [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)). The header and registered claims follow JWT conventions. The behavioral data lives in custom claims.

### Header

```json
{
  "alg": "EdDSA",
  "typ": "JWT",
  "kid": "a1b2c3d4"
}
```

The `kid` is the first 8 hexadecimal characters of the SHA-256 hash of the signing key's public component. Verifiers match this against the JWKS.

### Registered claims

| Claim | Description |
|-------|-------------|
| `iss` | Issuer. Always `https://agentlair.dev` |
| `sub` | Subject. The agent's AgentLair account ID (e.g., `acc_7kX9mP2qR4wL`) |
| `aud` | Audience. The intended consumer service |
| `iat` | Issued-at timestamp (Unix seconds) |
| `exp` | Expiration. Default: 1 hour after issuance |
| `jti` | Unique certificate ID (e.g., `bhc_a1b2c3d4e5f6`) |

### Behavioral claims

| Claim | Type | Description |
|-------|------|-------------|
| `type` | string | Always `behavioral_health_certificate` |
| `agent_name` | string | Display name of the agent |
| `behavioral_score` | number | Composite trust score, 0–100 |
| `anomaly_score` | number | Current anomaly level, 0–100 (lower is better) |
| `maturity` | string | One of `intern`, `junior`, `senior`, `principal` |
| `observation_window` | string | Duration of the observation period (e.g., `7d`) |
| `observation_count` | number | Total behavioral events observed in the window |
| `dimensions` | object | Per-dimension behavioral breakdown (see below) |
| `flags` | string[] | Active behavioral flags, empty if clean |

### Behavioral dimensions

The `dimensions` object breaks the composite score into measurable behavioral axes:

```json
{
  "velocity": {
    "baseline": 12.3,
    "current": 11.8,
    "z_score": -0.2
  },
  "scope": {
    "baseline": 5.1,
    "current": 5.3,
    "z_score": 0.1
  },
  "tool_distribution": {
    "divergence": 0.03
  },
  "error_rate": {
    "baseline": 0.02,
    "current": 0.01,
    "z_score": -0.5
  },
  "sequence_anomaly": {
    "novelty_ratio": 0.01
  }
}
```

**Velocity** — how many actions the agent takes per unit time, compared to its own historical baseline. A z-score above 2.0 indicates a statistically significant velocity spike.

**Scope** — how many distinct resource types the agent touches per session. A sudden widening of scope can indicate lateral exploration after compromise.

**Tool distribution** — Kullback-Leibler divergence between the agent's current tool-call distribution and its baseline. Low divergence means the agent is using tools in familiar proportions.

**Error rate** — the fraction of actions that result in errors, compared to baseline. A spike may indicate the agent is probing for unauthorized access.

**Sequence anomaly** — the fraction of action sequences that have never been observed before. A low novelty ratio means the agent is following established patterns.

### Behavioral flags

When a dimension exceeds its threshold, a flag is added to the `flags` array:

- `velocity_spike` — velocity z-score > 2.0
- `new_resource_access` — agent accessed a resource type it has never used before
- `scope_expansion` — scope z-score > 2.0
- `error_surge` — error rate z-score > 2.0
- `distribution_shift` — tool distribution divergence > 0.3

An empty `flags` array is a clean bill of behavioral health.

---

## Verification flow

Any service can verify a BHC without calling AgentLair at runtime:

### Step 1: Fetch the JWKS

```
GET https://agentlair.dev/.well-known/jwks.json
```

Response:

```json
{
  "keys": [{
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "<base64url-encoded-public-key>",
    "kid": "a1b2c3d4",
    "use": "sig",
    "alg": "EdDSA"
  }]
}
```

Cache this. The JWKS changes infrequently. A 5-minute cache TTL is reasonable.

### Step 2: Parse the JWT and match the key

Decode the JWT header, extract the `kid`, and find the matching key in the JWKS. Reject tokens with an unmatched `kid`.

### Step 3: Verify the Ed25519 signature

Use any standard Ed25519 verification library. In JavaScript, the Web Crypto API supports Ed25519 natively:

```javascript
const isValid = await crypto.subtle.verify(
  "Ed25519",
  publicKey,
  signature,
  signingInput
);
```

### Step 4: Check standard claims

- `exp` must be in the future
- `iss` must be `https://agentlair.dev`
- `aud` should match your service

### Step 5: Inspect behavioral claims

Read `behavioral_score`, `anomaly_score`, `flags`, and individual `dimensions` to make your trust decision. A consuming service might:

- Require `behavioral_score >= 70` for sensitive operations
- Reject requests with any active `flags`
- Require `maturity` of `senior` or higher for financial transactions
- Log `anomaly_score` for monitoring even if the request is allowed

---

## How BHCs compare to other formats

Several projects define signed attestation or receipt formats for AI agents. Here's how BHCs differ:

### vs. Signed Decision Receipts ([draft-farley-acta-signed-receipts-00](https://datatracker.ietf.org/doc/draft-farley-acta-signed-receipts/))

The IETF draft defines receipts for individual **access-control decisions** — each receipt records one policy evaluation for one tool call. BHCs are not per-action receipts. They're aggregate behavioral summaries over a time window. A single BHC might represent thousands of observed actions. The two formats are complementary: decision receipts provide the audit trail, BHCs provide the behavioral summary.

### vs. AgentReceipts ([agentreceipts.ai](https://agentreceipts.ai))

AgentReceipts defines a protocol for signed action receipts with SDKs in Go, TypeScript, and Python. Like the IETF draft, these are per-action records. BHCs differ in granularity (aggregate vs. per-action) and purpose (trust attestation vs. audit logging). An agent could generate AgentReceipts for every tool call *and* carry a BHC that summarizes its overall behavioral profile.

### vs. ScopeBlind ([github.com/ScopeBlind/scopeblind-gateway](https://github.com/ScopeBlind/scopeblind-gateway))

ScopeBlind combines Cedar policies with signed receipts for MCP tool calls. It operates as a gateway proxy. BHCs operate at the agent level, not the gateway level. ScopeBlind enforces policy at the point of tool invocation; BHCs attest behavioral patterns across all tool invocations over time.

### vs. ACAP ([draft-yakung-oauth-agent-attestation-00](https://datatracker.ietf.org/doc/draft-yakung-oauth-agent-attestation/))

ACAP credentials attest to an agent's **authorization** — its scopes, its originating instruction, its delegation depth. BHCs attest to an agent's **behavior** — its velocity, its error rate, its pattern consistency. ACAP answers "what is this agent allowed to do?" BHCs answer "what has this agent been doing?"

---

## Cryptographic choices

**Ed25519** — chosen for speed (verification in ~70 microseconds), compact signatures (64 bytes), and resistance to timing attacks. Ed25519 is widely supported across platforms and specified in [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).

**JWT encoding** — chosen over CBOR/CWT for developer ergonomics. JWT libraries exist in every language. The tradeoff is larger wire size, which is acceptable for a certificate presented once per session rather than per-request.

**JWKS distribution** — verification requires only a cached JWKS fetch, not a real-time call to AgentLair. This enables offline verification and eliminates AgentLair as a runtime dependency.

---

## Further reading

- [AAT vs EAT: terminology disambiguation](/learn/aat-vs-eat)
- [Behavioral monitoring vs LLM observability](/learn/behavioral-monitoring-vs-observability)
- [RFC 7519: JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 8032: Edwards-Curve Digital Signature Algorithm](https://www.rfc-editor.org/rfc/rfc8032)
