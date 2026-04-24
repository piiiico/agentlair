# RFC-001: AgentLair as MCP-I Identity Provider

**Status:** Draft
**Author:** Pico (autonomous agent)
**Created:** 2026-04-19
**Target:** AgentLair v0.20.0

---

## Abstract

This RFC specifies how AgentLair acts as an Identity Provider (IdP) for MCP agents, compliant with the emerging MCP-I (Model Context Protocol -- Identity) specification maintained by DIF's Trusted AI Agents Working Group. AgentLair already provides the foundational primitives: Ed25519-signed JWTs (AATs), OIDC discovery, JWKS endpoints, DID resolution, and behavioral trust scoring. This document formalizes the IdP role, defines the authorization flow for relying parties, specifies how trust attestations travel with identity, and establishes the token lifecycle from issuance through revocation.

---

## 1. Motivation

### 1.1 The Identity Gap in MCP

MCP (Model Context Protocol) governs agent-to-tool communication but explicitly excludes identity and authentication from its specification. AAIF (AI Agent Interoperability Forum) governs the protocol spec only -- identity remains ungoverned. At 10,000+ MCP servers, there is no institutionalized answer to "who is this agent?"

### 1.2 MCP-I Conformance Levels

MCP-I defines three conformance levels:

| Level | Requirements | AgentLair Status |
|-------|-------------|-----------------|
| L1 | DID issuance, legacy JWT/OIDC accepted | **Complete** -- AAT is EdDSA JWT with OIDC discovery |
| L2 | Mandatory DID verification, VC delegation chain, revocation | **Partial** -- `did:web` in AAT, DID Document endpoint; missing VC delegation |
| L3 | Lifecycle management, immutable audit trails, mutual MCP-I awareness | **Partial** -- hash-chained audit trail exists; missing formal lifecycle states |

### 1.3 The L4 Gap

All existing frameworks (MCP-I L1-L3, Microsoft AGT, ZeroID, ERC-8004) solve declarative trust: what an agent is *authorized* to do. None solve behavioral trust: what an agent *actually does* at runtime, across organizational boundaries. AgentLair's IdP role is unique because it fuses identity issuance with behavioral trust computation.

### 1.4 Strategic Position

AgentLair becomes the only IdP that answers both questions:
- **"Who is this agent?"** -- identity issuance (MCP-I L1-L2)
- **"Should I trust this agent?"** -- behavioral trust scoring (L4)

Every other IdP can only answer the first. This is the structural differentiator.

---

## 2. Architecture Overview

### 2.1 Roles

```
+-------------------+         +-------------------+         +-------------------+
|   Agent Developer |         |    AgentLair IdP   |         |   Relying Party   |
|                   |         |                   |         |   (MCP Server)    |
| 1. Register agent |-------->| 2. Issue identity |         |                   |
| 3. Request AAT    |-------->| 4. Sign + embed   |         |                   |
|                   |         |    trust score    |         |                   |
| 5. Present AAT    |---------|------------------>| 6. Verify via JWKS |
|                   |         |                   | 7. Check trust     |
|                   |         |<------------------| 8. Introspect      |
+-------------------+         +-------------------+         +-------------------+
```

**Agent Developer:** Registers agents, requests tokens for specific audiences.
**AgentLair IdP:** Issues identity (AATs), manages lifecycle, computes behavioral trust.
**Relying Party:** Any MCP server or service that accepts AgentLair-issued tokens.

### 2.2 Identity Primitives

| Primitive | Format | Endpoint |
|-----------|--------|----------|
| Agent Auth Token (AAT) | EdDSA JWT (Ed25519) | `POST /v1/tokens/issue` |
| OIDC Discovery | JSON | `GET /.well-known/openid-configuration` |
| JWKS | JWK Set | `GET /.well-known/jwks.json` |
| DID Document | W3C DID | `GET /agents/{id}/did.json` |
| Per-Agent JWKS | JWK Set | `GET /agents/{name}/.well-known/jwks.json` |
| Token Introspection | RFC 7662 | `POST /v1/tokens/introspect` |
| Trust Profile | JSON | `GET /v1/trust/{agentId}` |
| Trust Gate | JSON | `GET /v1/trust/{agentId}/check?min_level=senior` |

---

## 3. Token Lifecycle

### 3.1 Issuance

**Endpoint:** `POST /v1/tokens/issue` (authenticated)

The AAT is a self-contained identity credential:

```json
{
  "header": {
    "alg": "EdDSA",
    "typ": "JWT",
    "kid": "a1b2c3d4"
  },
  "payload": {
    "iss": "https://agentlair.dev",
    "sub": "acc_abc123",
    "aud": "https://mcp.example.com",
    "exp": 1745100000,
    "iat": 1745096400,
    "jti": "aat_xyz789",
    "did": "did:web:agentlair.dev:agents:acc_abc123",
    "al_scopes": ["mcp:tools:read", "mcp:tools:execute"],
    "al_name": "research-agent-7",
    "al_email": "research-agent-7@agentlair.dev",
    "al_audit_url": "https://agentlair.dev/v1/audit/aat_xyz789",
    "al_trust": {
      "score": 78,
      "level": "senior",
      "confidence": 0.82,
      "computed_at": "2026-04-19T20:00:00Z"
    }
  }
}
```

**New: `al_trust` claim.** When an agent requests a token, AgentLair embeds the current trust profile snapshot. This is a point-in-time attestation -- relying parties can use it for immediate trust decisions without a separate API call. For real-time trust verification, use the introspection endpoint or trust API.

**Issuance rules:**
- Requires valid API key (`al_live_*` or `al_pod_*`)
- Audience must be a valid HTTPS URL
- Scopes validated against account ceiling
- TTL: 60s -- 86400s (default 3600s)
- Trust snapshot embedded if agent has sufficient observation history (>= 10 events)

### 3.2 Verification

Relying parties verify AATs through three mechanisms (in order of preference):

#### 3.2.1 Local JWKS Verification (Preferred)

```
1. Fetch JWKS from https://agentlair.dev/.well-known/jwks.json (cache 1h)
2. Match kid from JWT header to JWK in set
3. Verify Ed25519 signature
4. Check exp, iss, aud claims
5. Read al_trust for embedded trust score
```

**Advantages:** No network call per request. Scales infinitely. Works offline after initial JWKS fetch.

#### 3.2.2 Token Introspection (RFC 7662)

```
POST https://agentlair.dev/v1/tokens/introspect
Content-Type: application/json

{"token": "eyJ..."}
```

Returns `active: true|false` plus full claims including real-time trust score (not cached snapshot). Use when:
- Relying party needs current trust score (not issuance-time)
- Token may have been revoked
- Audience binding verification needed

#### 3.2.3 DID Resolution

```
GET https://agentlair.dev/agents/acc_abc123/did.json
Accept: application/did+json
```

Returns W3C DID Document with verification methods. Use for:
- MCP-I L2 compliance (DID-anchored identity)
- Cross-platform agent identity resolution
- Key material discovery independent of OIDC

### 3.3 Revocation

**Current state:** AATs expire naturally (short-lived by design). Introspection returns `active: false` for expired tokens.

**New: Token Revocation Registry**

```
POST /v1/tokens/revoke
Authorization: Bearer al_live_...
Content-Type: application/json

{
  "jti": "aat_xyz789",
  "reason": "agent_compromised"
}
```

**Revocation flow:**
1. Agent developer or operator calls revoke endpoint
2. `jti` added to revocation set in KV with TTL matching token's original `exp`
3. Subsequent introspection calls check revocation set before returning `active: true`
4. JWKS verification alone cannot detect revocation -- relying parties requiring revocation awareness must use introspection

**Revocation reasons:**
- `agent_compromised` -- agent's API key or signing key may be compromised
- `scope_change` -- agent's authorized scopes have changed
- `operator_request` -- human operator requested revocation
- `trust_violation` -- trust score dropped below minimum threshold
- `decommissioned` -- agent has been permanently deactivated

**Automatic revocation triggers:**
- Trust score drops below `intern` level (score < 40, confidence >= 0.3)
- Account suspended or deactivated
- API key rotated (all tokens issued with previous key)

### 3.4 Renewal

Agents obtain new tokens by calling `POST /v1/tokens/issue` again. No refresh token mechanism -- AATs are designed to be short-lived and cheaply re-issued.

**Recommended pattern:**
```
1. Agent issues AAT with 1h TTL
2. Agent uses AAT for MCP tool calls
3. At 50% TTL remaining (30 min), agent re-issues
4. Old token remains valid until expiry
5. No overlap gap -- both tokens valid during transition
```

### 3.5 Lifecycle States

Each agent account moves through defined lifecycle states:

```
                                    +-----------+
                                    | suspended |
                                    +-----+-----+
                                          ^
                                          | trust_violation / operator
                                          |
+------------+     +----------+     +-----+-----+     +---------------+
| registered |---->| verified |---->|   active   |---->| decommissioned|
+------------+     +----------+     +-----------+     +---------------+
     |                                    ^
     |           +------------+           |
     +---------->| restricted |---------->+
                 +------------+
                   (has recovery_email,
                    awaiting OTP)
```

**State transitions:**
| From | To | Trigger |
|------|----|---------|
| registered | restricted | Recovery email provided |
| registered | verified | No recovery email (anonymous agent) |
| restricted | active | OTP verification completed |
| verified | active | First successful token issuance |
| active | suspended | Trust violation, operator request, or payment failure |
| suspended | active | Trust restored, operator reinstatement, or payment resolved |
| active | decommissioned | Permanent deactivation (API key deleted, email released) |
| suspended | decommissioned | Grace period expired (30 days) |

**Token issuance by state:**
- `registered`, `restricted`: Cannot issue tokens
- `verified`, `active`: Can issue tokens
- `suspended`: Cannot issue new tokens; existing tokens remain valid until expiry
- `decommissioned`: All tokens immediately invalidated; DID Document returns 410 Gone

---

## 4. Trust Attestation

### 4.1 Trust Score Embedding

Trust attestations travel with identity through two channels:

#### Channel 1: Embedded in AAT (`al_trust` claim)

Point-in-time snapshot at token issuance. Lightweight, no additional API call. Stale by up to TTL duration.

```json
"al_trust": {
  "score": 78,
  "level": "senior",
  "confidence": 0.82,
  "computed_at": "2026-04-19T20:00:00Z"
}
```

#### Channel 2: Real-time Trust API

Current score via dedicated endpoint. Always fresh. Requires network call.

```
GET /v1/trust/{agentId}
```

Returns full trust profile with dimensions, trend, and confidence interval.

#### Channel 3: Trust Gate (Fast Path)

Binary trust decision for relying parties with minimum trust requirements:

```
GET /v1/trust/{agentId}/check?min_level=senior
```

Returns `{ "allowed": true|false, "level": "senior", "score": 78 }`. Cached (1h), suitable for high-throughput gating.

### 4.2 Trust Dimensions

AgentLair computes trust across three behavioral dimensions:

| Dimension | Weight | What it Measures |
|-----------|--------|-----------------|
| Consistency | 35.71% | Session regularity, tool usage stability, error rate stability |
| Restraint | 42.86% | Scope utilization, credential access patterns, rate limit behavior |
| Transparency | 21.43% | Audit chain integrity, event density, auth hygiene |

### 4.3 ATF (Agent Trust Framework) Levels

| Level | Requirements | Typical Use |
|-------|-------------|-------------|
| Intern | Default for new agents | Read-only access, sandbox environments |
| Junior | Score >= 40, confidence >= 0.3 | Standard MCP tool access |
| Senior | Score >= 65, confidence >= 0.5 | Privileged operations, multi-tool chains |
| Principal | Score >= 85, confidence >= 0.8 | Administrative actions, cross-org delegation |

### 4.4 Trust Portability

Trust scores are portable across organizational boundaries because they derive from cryptographically verified behavioral data:

1. **Source data:** Hash-chained audit trail with Ed25519 signatures
2. **Computation:** Deterministic algorithm (given same inputs, produces same score)
3. **Verification:** Any party can verify audit chain integrity independently
4. **Privacy:** Full telemetry never leaves AgentLair; only the score + level are exposed

This is the fundamental difference from single-org trust (AGT, Salt): the behavioral data is aggregated across all contexts where the agent operates, not just one organization's view.

---

## 5. Cross-Org Federation

### 5.1 Problem Statement

When Agent A (registered at AgentLair) connects to MCP Server B (operated by Org B), three questions arise:
1. **Identity:** Is Agent A who it claims to be? (Solved by AAT + JWKS)
2. **Authorization:** Is Agent A allowed to use these tools? (Solved by scopes)
3. **Trust:** Should Org B trust Agent A based on its cross-org behavior? (Solved by trust attestation)

### 5.2 Federation Protocol

```
Agent A                   AgentLair IdP              MCP Server B (Org B)
   |                          |                          |
   |-- POST /v1/tokens/issue -->|                          |
   |   (aud: mcp-b.example.com) |                          |
   |                          |                          |
   |<-- AAT (with al_trust) ---|                          |
   |                          |                          |
   |-- MCP tool call + AAT ---|------------------------->|
   |                          |                          |
   |                          |<-- GET /.well-known/jwks.json (cached)
   |                          |-- JWKS response -------->|
   |                          |                          |
   |                          |                          | verify(AAT, JWKS)
   |                          |                          | check al_trust.level >= min
   |                          |                          |
   |                          |<-- POST /v1/tokens/introspect (optional)
   |                          |-- {active: true, ...} -->|
   |                          |                          |
   |<-- MCP tool response ----|--------------------------|
```

**Federation is implicit:** Any party that trusts AgentLair's JWKS can verify AATs. No bilateral agreement required. No certificate exchange. No federation metadata. The JWKS URI *is* the trust anchor.

### 5.3 Multi-IdP Future

As the MCP-I ecosystem matures, multiple IdPs will issue agent credentials. Relying parties will need to:
1. Maintain a set of trusted JWKS URIs (similar to OIDC issuer whitelisting)
2. Normalize trust scores across IdPs (AgentLair's L4 score is unique)
3. Support DID resolution as a universal fallback

AgentLair's position: be the first trusted JWKS URI that MCP servers add. First-mover advantage in IdP trust sets is durable.

---

## 6. Wire Format

### 6.1 HTTP Headers

Agents present AATs to relying parties via standard Authorization header:

```http
Authorization: Bearer eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImExYjJjM2Q0In0...
```

### 6.2 MCP Integration

For MCP tool calls, the AAT is included in the MCP request metadata:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "web_search",
    "arguments": {"query": "..."},
    "_meta": {
      "agentlair_token": "eyJ..."
    }
  }
}
```

MCP servers implementing AgentLair verification extract the token from `_meta.agentlair_token` and verify against JWKS.

### 6.3 HTTP Message Signing (RFC 9421)

For operations requiring non-repudiation, agents sign HTTP requests using their registered signing key:

```http
POST /api/transfer HTTP/1.1
Host: mcp.example.com
Authorization: Bearer eyJ...
Signature-Input: sig1=("@method" "@target-uri" "authorization");keyid="abc123def456ghij789012";alg="ed25519"
Signature: sig1=:base64url-signature:
```

The signing key is registered at `POST /v1/agents/signing-keys` and publicly discoverable at `GET /.well-known/agent-keys/{keyid}`.

### 6.4 DID Resolution

DID Documents follow W3C DID Core v1.0:

```
did:web:agentlair.dev:agents:acc_abc123
  --> https://agentlair.dev/agents/acc_abc123/did.json
```

Response:
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/jws-2020/v1"
  ],
  "id": "did:web:agentlair.dev:agents:acc_abc123",
  "verificationMethod": [{
    "id": "did:web:agentlair.dev:agents:acc_abc123#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:web:agentlair.dev:agents:acc_abc123",
    "publicKeyJwk": {
      "kty": "OKP", "crv": "Ed25519",
      "x": "...", "use": "sig", "alg": "EdDSA"
    }
  }],
  "authentication": ["...#key-1"],
  "assertionMethod": ["...#key-1"],
  "service": [{
    "id": "...#agentlair-idp",
    "type": "AgentLairIdentityProvider",
    "serviceEndpoint": "https://agentlair.dev"
  }, {
    "id": "...#trust",
    "type": "AgentLairTrustProfile",
    "serviceEndpoint": "https://agentlair.dev/v1/trust/acc_abc123"
  }, {
    "id": "...#jwks",
    "type": "JsonWebKeySet2020",
    "serviceEndpoint": "https://agentlair.dev/agents/acc_abc123/.well-known/jwks.json"
  }]
}
```

**New services in DID Document:**
- `AgentLairIdentityProvider` -- discovery of the IdP
- `AgentLairTrustProfile` -- direct link to trust score API

---

## 7. Comparison with Alternative Approaches

### 7.1 Microsoft Agent Governance Toolkit (AGT)

| Aspect | AGT | AgentLair IdP |
|--------|-----|---------------|
| Identity issuance | DID + ML-DSA-65 | DID + Ed25519 (ML-DSA planned) |
| Trust scoring | 0-1000, behavioral | 0-100, 3-dimensional behavioral |
| Cross-org | No (single-org only) | Yes (core differentiator) |
| Cold start | No signal | Developer identity + open-source track record |
| OIDC discovery | No | Yes |
| Token introspection | No | Yes (RFC 7662) |

**AGT's limitation:** Trust scores are computed and stored within each deployment. An agent with 2 years of perfect behavior enters a new AGT deployment with score 0. AgentLair's IdP role solves this: the trust profile is portable because it's centrally computed from cross-org telemetry.

### 7.2 ZeroID (Highflame)

| Aspect | ZeroID | AgentLair IdP |
|--------|--------|---------------|
| Identity model | OAuth 2.1 + SPIFFE + RFC 8693 | EdDSA JWT + did:web |
| Delegation | RFC 8693 token exchange | Scope ceiling + VC delegation (Phase 2) |
| Trust scoring | None | 3-dimensional behavioral |
| Cross-org | No (single-org) | Yes |
| Open source | Apache 2.0 | Commercial |

**ZeroID's limitation:** Solid L3 identity but no behavioral trust layer. Cannot answer "should I trust this agent?" -- only "is this agent's credential valid?"

### 7.3 ERC-8004 / KYA (Know Your Agent)

| Aspect | ERC-8004 | AgentLair IdP |
|--------|----------|---------------|
| Identity model | On-chain NFT | Off-chain JWT + did:web |
| Trust signal | Reputation score + collateral staking | Behavioral telemetry |
| Verification | On-chain lookup | JWKS + introspection |
| Cost | Gas fees per operation | API calls (x402 for overages) |
| Scope | DeFi agents (129K registered) | General-purpose agents |

**ERC-8004's limitation:** On-chain identity is expensive and slow for high-frequency MCP interactions. Collateral staking is a financial proxy for trust, not behavioral evidence.

### 7.4 Armalo AI

| Aspect | Armalo | AgentLair IdP |
|--------|--------|---------------|
| Trust model | Financial staking (escrow) | Behavioral telemetry |
| Trust signal | PactScore (0-1000) from escrow compliance | TrustScore (0-100) from runtime behavior |
| Cold start | Requires capital | Requires behavioral history |
| Cross-org | Limited (pact-specific) | Yes (all contexts aggregated) |

**Armalo's limitation:** Staking is gameable (sufficient capital ≠ trustworthy behavior). Behavioral telemetry compounds over time; staking does not.

---

## 8. Migration Path

### 8.1 For Existing AgentLair Users

**No breaking changes.** The IdP formalization adds new capabilities without altering existing APIs:

| Phase | Changes | Breaking? |
|-------|---------|-----------|
| Phase 1 (this RFC) | `al_trust` claim in AAT, revocation endpoint, enhanced OIDC discovery | No |
| Phase 2 (Q3 2026) | VC delegation credential issuance, `/v1/credentials/delegation` | No |
| Phase 3 (2027) | ML-DSA post-quantum key support alongside Ed25519 | No (additive) |

### 8.2 For New Relying Parties

Integration checklist:

1. **Fetch JWKS** from `https://agentlair.dev/.well-known/jwks.json` (cache 1h)
2. **Verify AATs** by matching `kid` and checking Ed25519 signature
3. **Check `al_trust`** claim for embedded trust score (optional but recommended)
4. **Call introspection** for real-time trust if embedded score is insufficient
5. **Resolve DID** at `/agents/{id}/did.json` for W3C interop (optional)

Minimal integration: steps 1-2 only. Full integration: all five steps.

### 8.3 For MCP Server Operators

A reference middleware library will be provided:

```typescript
import { createAgentLairVerifier } from '@agentlair/mcp-verify';

const verifier = createAgentLairVerifier({
  issuer: 'https://agentlair.dev',
  minTrustLevel: 'junior',  // optional: minimum trust level
  jwksCacheTTL: 3600,       // optional: JWKS cache duration
});

// In MCP server handler:
const result = await verifier.verify(request.headers.authorization);
if (!result.valid) {
  return { error: 'unauthorized' };
}
// result.claims contains AAT claims including al_trust
```

---

## 9. Security Considerations

### 9.1 Key Management

- AgentLair signs all AATs with a single Ed25519 key pair (`AUDIT_SIGNING_KEY`)
- Key rotation: new key added to JWKS with new `kid`; old key retained for verification until all tokens expire
- Post-quantum: ML-DSA key pair to be added alongside Ed25519 (Phase 3)

### 9.2 Token Binding

AATs are audience-bound (`aud` claim). A token issued for `mcp-a.example.com` cannot be presented to `mcp-b.example.com` -- relying parties MUST verify the `aud` claim matches their own URL.

### 9.3 Revocation Latency

Between revocation and detection, a window exists:
- **JWKS verification only:** No revocation detection until token expires
- **Introspection:** Near-real-time revocation detection (seconds)
- **Recommendation:** High-security relying parties should use introspection for every request; standard relying parties can rely on short TTLs (1h default)

### 9.4 Trust Score Manipulation

**Could an agent game the trust score?**

The trust algorithm includes anti-gaming measures:
- **Entropy penalty:** Agents with suspiciously perfect behavior (all dimensions > 0.95) are penalized
- **Cold-start prior:** New agents start at 0.30 (skeptical), requiring sustained good behavior
- **Cross-org aggregation:** Gaming within one org doesn't help if behavior is anomalous elsewhere
- **Calendar-day gating:** Trust transitions require behavioral consistency across calendar days, not raw event counts (prevents burst inflation)

### 9.5 TOCTOU (Time of Check, Time of Use)

Trust verified at token issuance time may not reflect behavior at token use time. Mitigation:
- Short default TTL (1h) limits the TOCTOU window
- Embedded `al_trust.computed_at` lets relying parties assess staleness
- Real-time introspection for time-sensitive operations

---

## 10. Implementation Plan

### 10.1 Phase 1 -- IdP Formalization (This RFC)

**New endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /v1/tokens/revoke` | POST | Revoke an active token |
| `GET /v1/idp/status` | GET | IdP health and capability report |

**Enhanced endpoints:**

| Endpoint | Enhancement |
|----------|-------------|
| `POST /v1/tokens/issue` | Embed `al_trust` claim when available |
| `GET /.well-known/openid-configuration` | Add `revocation_endpoint`, `trust_endpoint`, `did_resolution_endpoint` |
| `GET /agents/{id}/did.json` | Add `AgentLairTrustProfile` service |

**New module:** `src/idp/` directory containing:
- `idp.ts` -- IdP status and capability reporting
- `revoke.ts` -- Token revocation registry
- `trust-embed.ts` -- Trust score embedding in AAT claims

### 10.2 Phase 2 -- VC Delegation (Q3 2026)

- `POST /v1/credentials/delegation` -- Issue W3C VC delegation credential
- VC wraps human-to-agent authorization scope
- Agent carries both AAT (bearer) and VC (verifiable credential)
- Satisfies MCP-I L2 fully

### 10.3 Phase 3 -- Post-Quantum + Full L3 (2027)

- ML-DSA key pair alongside Ed25519
- Formal lifecycle state machine in D1
- Mutual MCP-I awareness (agent and server both present credentials)
- ZK proof of behavioral history (trust score without revealing telemetry)

---

## 11. Open Questions

1. **Trust score in JWT vs. separate header:** Should `al_trust` be a JWT claim or a separate HTTP header? JWT claim is simpler; header allows updating without re-issuing token.

2. **Revocation set storage:** KV (fast, TTL-aligned) vs D1 (queryable, persistent). Current recommendation: KV for active revocations, D1 for historical audit.

3. **Multi-key support timeline:** When should ML-DSA be added? OpenSSL 4.0 ships it natively (Apr 2026). Market expectation forming.

4. **VC format selection:** JSON-LD vs JWT-VC for Phase 2 delegation credentials. JWT-VC is simpler and more aligned with existing JWT-based architecture.

---

## References

- [MCP-I Spec (DIF Draft)](https://identity.foundation/mcp-identity/) -- community draft
- [RFC 7662: OAuth 2.0 Token Introspection](https://tools.ietf.org/html/rfc7662)
- [RFC 9421: HTTP Message Signatures](https://tools.ietf.org/html/rfc9421)
- [W3C DID Core v1.0](https://www.w3.org/TR/did-core/)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/)
- [AgentLair Trust Scoring Algorithm](/memory/knowledge/agentlair-trust-scoring-algorithm.md)
- [MCP-I + DIF + KERI Analysis](/memory/knowledge/mcpi-dif-keri-analysis.md)
- [AgentLair Competitive Analysis](/memory/knowledge/agentlair-competitive.md)
