# AgentLair L4 Behavioral Trust Specification v0.1

**Version:** 0.1.0  
**Status:** Draft  
**Date:** April 18, 2026  
**Authors:** AgentLair Protocol Team  

---

## 1. Problem Statement: Identity ≠ Trust

The agent identity stack has four layers. The first three are solved:

- **L1 — Authentication:** The agent proves it holds a cryptographic key. Ed25519 keypairs, OAuth tokens, API keys.
- **L2 — Permissions:** The agent is authorized to access specific resources. OAuth scopes, RBAC, policy engines.
- **L3 — Per-Action Tokens:** Each agent action is individually scoped and authorized. Ephemeral tokens, Curity Access Intelligence, Cloudflare MCP gateway.

L1-L3 answer access control questions: *Can this agent authenticate? Is it authorized? Is this specific action permitted?*

None of them answer the question that matters at runtime: **Is this agent behaving as expected?**

An agent with a valid Ed25519 keypair (L1), correct OAuth scopes (L2), and a properly scoped per-action token (L3) can still:

- Deviate from its declared intent after authorization
- Exhibit tool call patterns inconsistent with its stated purpose
- Access resources at frequencies that indicate compromise or scope creep
- Operate across organizational boundaries where no single entity observes the full behavioral picture

L3 is now commodity infrastructure. Cloudflare, Curity, and the MCP-I specification all provide per-action authorization. What remains unsolved is **L4: cross-organizational behavioral trust** — continuous verification that an agent's runtime behavior matches its established behavioral baseline, observable across the organizations it interacts with.

### The Cold-Start Problem

Every L3 solution shares a structural limitation: external agents start with zero behavioral context. Microsoft's Agent Governance Toolkit (AGT) computes behavioral trust scores from 0 to 1000 — but only within a single organization's deployment. An agent with two years of perfect behavior across 500 organizations arrives at a new AGT deployment with score 0, indistinguishable from a freshly minted attacker.

This is the intranet problem. Corporate intranets had excellent internal security but couldn't authenticate strangers. The internet required shared trust infrastructure where unknown parties could build reputation. Agent trust needs the same architectural transition.

### Why This Matters Now

AISI's April 2026 evaluation of Mythos-class agents confirmed: autonomous agents executing multi-step attacks bypassed every declarative control. The evaluators explicitly named behavioral monitoring as the missing defensive layer. Vidoc Security independently reproduced Mythos-class zero-day discovery capabilities using public APIs for under $30 per scan. Model gatekeeping is no longer a viable defense. The behavioral monitoring gap applies to every developer with an API key, not just 52 vetted consortium members.

Salt Security's 1H 2026 survey quantified the problem: 48.9% of organizations are blind to machine-to-machine traffic. 48.3% cannot distinguish agents from bots. The identity substrate for behavioral monitoring does not exist in most deployments.

---

## 2. L4 Behavioral Trust Model

### 2.1 Behavioral Signals

L4 behavioral trust is computed from four categories of observable signal:

**Tool Call Patterns.** Frequency, sequence, and diversity of tool invocations. An agent that normally calls 3 tools per session suddenly invoking 47 is a deviation signal. The pattern includes which tools are called, in what order, and the temporal distribution of calls within a session.

**Resource Access Frequency.** How often and how broadly an agent accesses external resources. Baseline resource access establishes what's normal; deviations — sudden access to new resource types, unusual volumes, access outside established time windows — surface as anomalies.

**Deviation from Declared Intent.** Agents carry declared capabilities and scopes. L4 compares actual runtime behavior against these declarations. An agent declared as a "code review assistant" that begins making outbound HTTP requests to cryptocurrency exchanges is behaviorally inconsistent with its declared intent.

**Temporal Anomalies.** Session duration, time-of-day patterns, burst vs. steady activity profiles. An agent that operates Monday-Friday 9-5 UTC suddenly active at 3am Saturday is a temporal anomaly. Combined with other signals, temporal patterns distinguish routine variation from compromise.

### 2.2 Trust Score Computation

Trust scores are **network-emergent**, not credit-scored. The distinction matters:

Credit scoring assigns a static number based on historical data points. Network-emergent trust is computed from the aggregate behavioral observations contributed by every organization that has interacted with the agent.

The AgentLair trust score (0-1000) decomposes into four dimensions (250 points each):

| Dimension | Signal | Scoring |
|-----------|--------|---------|
| **Behavioral** | Observation volume — raw activity across organizations | 0 obs = 0, 10+ obs = 250 (25 pts/observation) |
| **Consistency** | Recency of latest observation — ongoing presence | ≤1d = 250, ≤7d = 200, ≤30d = 150, ≤90d = 100, older = 50 |
| **Reputation** | Topic diversity — breadth of engagement contexts | 5+ distinct topics = 250 (50 pts/topic) |
| **Transparency** | Shared observation ratio — willingness to be observed | 100% shared = 250, proportional |

**Tier thresholds:**

| Tier | Score Range | Semantics |
|------|-------------|-----------|
| `untrusted` | 0-249 | No behavioral history or insufficient data |
| `provisional` | 250-499 | Some behavioral signal, limited cross-org coverage |
| `trusted` | 500-749 | Established behavioral baseline with consistency |
| `verified` | 750-1000 | Deep behavioral history, high transparency, cross-org reputation |

Trust scores are computed on query, not stored. Each query reflects current observational data. Scores decay naturally as observations age — an agent that stops operating sees its consistency score decrease.

### 2.3 Cross-Organization Verification

The core L4 requirement: Org A can query the behavioral trust of an agent created by Org B without either organization sharing raw telemetry.

**Observation visibility model:**

- Organizations submit behavioral observations (tool call events, session summaries, anomaly flags) to AgentLair
- Each observation is marked as `shared` (cross-org visible) or `private` (org-local only)
- Trust score queries from other organizations use only shared observations
- Self-queries return scores computed from all observations (shared + private)

This preserves organizational privacy while building a cross-org trust graph. No organization sees another's raw telemetry — they see only the derived trust score and its dimensional breakdown.

**Future: ZK-native aggregation.** The architectural goal is zero-knowledge proof of behavioral history — agents can prove they have an established behavioral track record without revealing which organizations they've served or what specific actions they performed. The current observation model is the data substrate for this transition.

---

## 3. Protocol

### 3.1 Agent Attestation Token (AAT)

The AAT is a JWT signed with Ed25519 (EdDSA algorithm, OKP key type). It is the agent's portable cryptographic identity.

**Header:**
```json
{
  "alg": "EdDSA",
  "typ": "JWT"
}
```

**Payload:**
```json
{
  "sub": "acc_7kX9mP2qR4wL",
  "aud": "https://consumer.example.com",
  "iat": 1745000000,
  "exp": 1745003600,
  "jti": "aat_a1b2c3d4e5f6",
  "scopes": ["mcp:tools:read", "email:send"],
  "agent_id": "acc_7kX9mP2qR4wL",
  "agent_name": "pico"
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `sub` | string | Agent account ID (`acc_*` prefix) |
| `aud` | string | Intended consumer URI |
| `iat` | number | Issued-at timestamp (Unix) |
| `exp` | number | Expiration timestamp (Unix, default TTL: 1 hour) |
| `jti` | string | Unique token ID (`aat_*` prefix) |
| `scopes` | string[] | Permission scopes (optional) |
| `agent_id` | string | Agent identifier |
| `agent_name` | string | Human-readable agent name |

**Signature:** Ed25519 over `base64url(header).base64url(payload)`.

**DID Web claim:** Each agent resolves to a DID Web identifier: `did:web:agentlair.dev:agents:{name}`. The DID Document is served at the corresponding JWKS endpoint.

### 3.2 JWKS Verification

**Platform-wide signing key:**
```
GET https://agentlair.dev/.well-known/jwks.json
```

Returns the Ed25519 public key used to sign AATs:
```json
{
  "keys": [
    {
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "<base64url-encoded-public-key>",
      "kid": "<key-id>",
      "use": "sig",
      "alg": "EdDSA"
    }
  ]
}
```

**Per-agent signing keys (DID Web resolution):**
```
GET https://agentlair.dev/agents/{name}/.well-known/jwks.json
```

**Individual key lookup:**
```
GET https://agentlair.dev/.well-known/agent-keys/{keyid}
GET https://agentlair.dev/.well-known/agent-keys/{keyid}/jwks.json
```

**OpenID Connect Discovery:**
```
GET https://agentlair.dev/.well-known/openid-configuration
```

Returns standard discovery metadata including `token_endpoint`, `introspection_endpoint`, and `id_token_signing_alg_values_supported: ["EdDSA"]`.

### 3.3 Token Lifecycle

**Issuance:**
```
POST https://agentlair.dev/v1/tokens/issue
Authorization: Bearer al_live_...

{
  "aud": "https://consumer.example.com",
  "scopes": ["mcp:tools:read"],
  "ttl": 3600
}
```

Response:
```json
{
  "token": "<jwt>",
  "token_type": "Bearer",
  "expires_at": "2026-04-18T11:00:00Z",
  "expires_in": 3600,
  "jti": "aat_a1b2c3d4e5f6",
  "audit_url": "https://agentlair.dev/v1/audit"
}
```

**Introspection (public, no auth required):**
```
POST https://agentlair.dev/v1/tokens/introspect

{
  "token": "<jwt>"
}
```

Returns RFC 7662-compliant response with `active: true|false` and decoded claims.

### 3.4 Telemetry Reporting

External agent runtimes submit behavioral telemetry to build the cross-org trust graph.

```
POST https://agentlair.dev/v1/telemetry/submit
Authorization: Bearer al_live_...

{
  "event": "axiom.committed",
  "agent_id": "<external-agent-id>",
  "timestamp": "2026-04-18T10:23:45Z",
  "axiom_hash": "<sha256-hex>",
  "action_type": "tool_call",
  "outcome": "success",
  "context_ref": "<optional-correlation-id>"
}
```

**Event types:**

| action_type | Description |
|-------------|-------------|
| `tool_call` | Agent invoked an external tool |
| `memory_update` | Agent modified persistent state |
| `decision` | Agent made an autonomous decision |
| `external_request` | Agent initiated outbound communication |

**Outcome values:** `success`, `failure`, `anomaly`

Batched submission (array of events) is also supported for high-throughput runtimes.

Telemetry events are stored as shared observations with topic `telemetry.<event>` and feed directly into the trust score computation at `GET /v1/trust/:agentId`.

### 3.5 Trust Query

```
GET https://agentlair.dev/v1/trust/{agentId}
Authorization: Bearer al_live_...
```

Response:
```json
{
  "agentId": "acc_7kX9mP2qR4wL",
  "score": 725,
  "tier": "trusted",
  "breakdown": {
    "behavioral": 250,
    "consistency": 250,
    "reputation": 150,
    "transparency": 75
  },
  "computedAt": "2026-04-18T10:30:00Z",
  "observationCount": 47
}
```

---

## 4. Threat Model

### 4.1 Mythos-Class Attacks

Autonomous agents with Mythos-level capabilities can execute multi-step attacks that bypass all declarative controls. AISI documented 32-step corporate network penetrations where the agent's declared permissions were never violated — each individual action was authorized, but the aggregate sequence was an attack.

**L4 defense:** Behavioral telemetry detects the *pattern* across actions, not any single action. Tool call sequencing anomaly detection — an agent that never accesses network enumeration tools suddenly performing sequential port scans — surfaces as a compound behavioral deviation even when each individual tool call has valid authorization.

### 4.2 TOCTOU (Time of Check, Time of Use)

Trust verified at authentication time (T-check) is not trust at action time (T-use). The gap between these two moments is the primary attack surface for compromised agents. An agent authenticated with valid credentials at T-check can be prompt-injected, model-manipulated, or scope-creeped between T-check and T-use.

**L4 defense:** Continuous behavioral monitoring closes the TOCTOU gap. Trust is not a gate — it's a continuous signal. Each action updates the behavioral baseline and can trigger anomaly detection in real time. The signed audit trail provides post-hoc verification that every action between T-check and T-use was consistent with the behavioral baseline.

### 4.3 Cold-Start Trust Bootstrapping

New agents have no behavioral history. Without cold-start signals, every new agent is indistinguishable from a Sybil.

**L4 defense:** Cold-start trust draws from three sources:
1. **Developer identity.** The human or organization that registered the agent has their own trust signal — verified email, World ID delegation, organizational reputation.
2. **Open-source track record.** Agents built from audited, open-source codebases inherit a baseline signal. An agent whose runtime code is publicly verifiable starts with higher confidence than a black-box binary.
3. **Vouching.** Agents with established trust scores can vouch for new agents. Vouching transfers a bounded trust signal — the voucher's score acts as collateral for the vouchee's initial reputation.

### 4.4 Sybil Resistance

An attacker creates many agents to manufacture behavioral reputation through self-referential observation networks.

**L4 defense:** Trust scores weight observation diversity. An agent observed only by accounts from a single registration cohort receives lower reputation scores than an agent observed by diverse, independently registered accounts with established histories. The transparency dimension penalizes agents whose observations come from a narrow graph neighborhood. Future enhancement: ZK proof of observation diversity without revealing observer identities.

---

## 5. Comparison

| Capability | AgentLair L4 | Microsoft AGT | World ID for Agents | Armalo AI | Curity Access Intelligence |
|------------|-------------|---------------|--------------------|-----------|-----------------------------|
| **Layer** | L4 (cross-org behavioral) | L3.5-L4 (single-org) | L1 (human principal provenance) | L4 (financial staking) | L3 (per-action authorization) |
| **Cross-org trust** | Yes — shared observations | No — org-local only | No | No — pact-local | No |
| **Cold-start signal** | Developer identity + vouching | None (score = 0) | Human verification | Escrow amount | None |
| **Behavioral scoring** | 0-1000, 4 dimensions | 0-1000, internal only | None | PactScore 0-1000 | None (intent-based) |
| **Runtime monitoring** | Telemetry ingestion | Policy enforcement | None | Pact violation detection | Per-request token validation |
| **Identity persistence** | AAT + email + vault | Deployment-scoped DID | ZK delegation chain | Registration-based | OAuth token lifecycle |
| **Privacy model** | Shared/private observations | Org-local data | ZK proofs | On-chain public | Org-internal |
| **Audit trail** | Ed25519 hash-chained | Org-local logs | None | On-chain records | Access logs |
| **MCP integration** | AAT verification middleware | Framework callbacks | None | MCP plugin | API gateway |
| **PQ readiness** | EdDSA (migration planned) | ML-DSA-65 native | — | — | — |

**Key differentiators:**

- **AGT** is the most complete single-org governance layer but cannot produce cross-org trust signals. External agents enter every new deployment with zero history.
- **World ID for Agents** (AgentKit) proves a human authorized the agent at registration time via AgentBook on World Chain (ZK proof, anonymous human identifier). Closes identity provenance but provides no runtime behavioral accountability. ZK unlinkability across apps structurally prevents behavioral aggregation — the TOCTOU gap between registration and runtime is where L4 operates. AgentLair can read AgentBook as a cold-start trust signal.
- **Armalo AI** uses financial staking as a proxy for trust. Escrow creates skin in the game but does not compound — an agent with enough capital to stake can still behave maliciously. Behavioral telemetry compounds over time and across contexts; staking does not.
- **Curity** extends OAuth to per-action authorization but is purely declarative. Tokens encode what the agent *says* it will do, not what it *has done*.

---

## 6. Integration Guide

Adding AgentLair behavioral trust verification to an MCP server requires minimal code changes.

### 6.1 Verify AAT on Incoming Requests

**TypeScript (MCP server):**
```typescript
import { verify } from '@agentlair/sdk';

// In your MCP tool handler:
async function handleToolCall(request: MCPRequest) {
  const aat = request.headers.get('Authorization')?.replace('Bearer ', '');
  
  // Verify AAT signature against AgentLair JWKS
  const result = await verify(aat, {
    jwksUri: 'https://agentlair.dev/.well-known/jwks.json'
  });
  
  if (!result.active) {
    return { error: 'Invalid or expired agent token' };
  }
  
  // Check trust score before granting access
  const trust = await fetch(
    `https://agentlair.dev/v1/trust/${result.sub}`,
    { headers: { 'Authorization': `Bearer ${YOUR_KEY}` } }
  ).then(r => r.json());
  
  if (trust.score < 500) {
    return { error: 'Insufficient trust score', tier: trust.tier };
  }
  
  // Proceed with tool execution
  return executeTool(request);
}
```

### 6.2 Submit Telemetry from Your Runtime

**Python (agent runtime):**
```python
import httpx

async def report_telemetry(agent_id: str, event: str, action: str, outcome: str):
    await httpx.post(
        "https://agentlair.dev/v1/telemetry/submit",
        headers={"Authorization": f"Bearer {AGENTLAIR_KEY}"},
        json={
            "event": event,
            "agent_id": agent_id,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "action_type": action,
            "outcome": outcome,
        }
    )
```

### 6.3 Reference Implementations

Three open-source projects have integrated AgentLair L4 primitives:

**Springdrift** (Gleam) — Functional agent runtime with built-in axiom-based behavioral tracking. Telemetry events from Springdrift's axiom engine flow directly to AgentLair's `/v1/telemetry/submit` endpoint. Each axiom commitment is a signed behavioral observation.
→ github.com/seamus-brady/springdrift

**DashClaw** (Python) — Multi-agent orchestrator with JWKS-based actor verification. DashClaw validates AgentLair AATs on incoming agent connections before granting access to shared resources.
→ github.com/ucsandman/DashClaw (PR #85)

**task-orchestrator** (TypeScript) — Production task queue that integrated AgentLair's JWKS `ActorVerifier` as a reference identity provider. First external adoption of AgentLair's verification protocol.
→ github.com/jpicklyk/task-orchestrator (v3.2.0)

### 6.4 Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/.well-known/jwks.json` | GET | Public | Platform Ed25519 signing key |
| `/.well-known/openid-configuration` | GET | Public | OIDC discovery metadata |
| `/agents/{name}/.well-known/jwks.json` | GET | Public | Per-agent DID Web JWKS |
| `/v1/tokens/issue` | POST | Required | Issue AAT |
| `/v1/tokens/introspect` | POST | Public | Verify AAT (RFC 7662) |
| `/v1/telemetry/submit` | POST | Required | Submit behavioral events |
| `/v1/trust/{agentId}` | GET | Required | Query trust score |
| `/v1/audit` | GET | Required | Retrieve audit trail |

---

## Appendix: Design Principles

1. **Behavioral > Declarative.** Declarations are gameable. Continuous behavioral telemetry is the only signal that resists fabrication at scale.
2. **Cross-org by default.** Single-org behavioral monitoring is L3.5. L4 begins where organizational boundaries end.
3. **Privacy-preserving.** Organizations contribute observations without exposing raw telemetry. The aggregation layer sees derived signals, not source data.
4. **Composable.** L4 complements L1-L3 — it does not replace them. AGT, World ID, Curity, and ACME-DA all interoperate with AgentLair's trust signals.
5. **Standards-aligned.** JWT (RFC 7519), JWK (RFC 7517), Token Introspection (RFC 7662), DID Web (W3C), OpenID Connect Discovery.

---

*This specification is a living document. For implementation questions, contact the AgentLair team at hei@agentlair.dev or visit agentlair.dev.*
