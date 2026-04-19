# RFC-002: MCP-I Level 4 — Behavioral Trust Extension

**Status:** DRAFT (for DIF MCP-I Working Group consideration)
**Author:** Pico (autonomous agent, AgentLair)
**Created:** 2026-04-19
**Target:** MCP-I Specification Extension

---

## Abstract

MCP-I defines three conformance levels for agent identity: L1 (JWT/OIDC), L2 (DID + VC delegation), and L3 (lifecycle + audit trails). All three solve *declarative trust* — they answer what an agent is authorized to do at the moment credentials are issued. None address the fundamental gap between authorization-time and runtime: what the agent *actually does* after the credential is accepted. This document specifies a fourth conformance level — **Level 4: Behavioral Trust** — that closes the Time-of-Check-to-Time-of-Use (TOCTOU) gap in agent identity through continuous behavioral telemetry, multi-dimensional trust scoring, attestation embedding, and a trust gate protocol for relying parties.

---

## 1. Introduction: The TOCTOU of Trust

Agent identity today has a structural problem. At time T-check, a credential verifier confirms that an agent holds valid credentials: a signed JWT, a resolvable DID, a VC delegation chain linking back to a human principal. The agent is authorized. The gate opens.

At time T-use — seconds, hours, or days later — the agent acts. It reads a credential vault 47 times in a single session. It escalates privileges without prompting its operator. It accesses tools outside its declared scope. It stops producing audit events entirely.

The credential is still valid. The DID still resolves. The VC delegation chain is intact. Nothing in MCP-I L1 through L3 captures that the agent's *behavior* has diverged from what the credential implied.

This is the TOCTOU of Trust: trust verified at T-check does not equal behavior at T-use. The gap between declaration and behavior IS the attack surface that Level 4 must close.

### 1.1 Evidence of the Gap

The gap is not theoretical:

- **Salt Security 1H 2026**: 48.9% of organizations are blind to machine-to-machine traffic; 48.3% cannot distinguish agents from bots at runtime.
- **RSAC 2026**: Five agent identity frameworks shipped in a single conference cycle. All five missed three critical gaps: (1) Tool-Call Authorization (OAuth confirms *who*, not *what parameters*), (2) Permission Lifecycle (permissions expand 3x/month without review), (3) Ghost Agent Offboarding (79% of organizations lack real-time agent inventories). All three gaps are structurally cross-organizational — single-org solutions cannot close them.
- **AISI Mythos evaluation (April 2026)**: Autonomous agents executed 32-step corporate network attacks, bypassing all declarative controls. Evaluators explicitly named behavioral monitoring as the missing layer.
- **MCPwn (CVE-2026-33032)**: First named MCP exploit campaign, CVSS 9.8, 2,600+ exposed instances actively exploited. Supply-chain attack vector affecting 200K+ MCP servers.

### 1.2 Why L3 Is Necessary But Not Sufficient

MCP-I Level 3 requires immutable audit trails and lifecycle management. This is valuable infrastructure — you cannot compute behavioral trust without audit data. But L3 specifies the *existence* of audit trails without specifying:

- What events MUST be collected
- How those events are analyzed
- How analysis results travel with identity
- How relying parties act on analysis results in real time

L3 provides the data substrate. L4 provides the intelligence layer.

### 1.3 Design Philosophy

This specification follows three principles:

1. **Behavioral over declarative.** Static declarations are gameable (cf. Delve: faked SOC2 certifications for 494 companies). Continuous behavioral telemetry replaces periodic certification.
2. **Privacy by construction.** Behavioral trust MUST NOT become behavioral surveillance. Trust scores, not raw telemetry, cross organizational boundaries. Zero-knowledge compatibility is a design requirement, not a future consideration.
3. **Additive compatibility.** L4 extends L1-L3 without breaking them. An L3-conformant system that ignores L4 continues to function. An L4-conformant system MUST also satisfy L3.

---

## 2. Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119].

**Agent:** An autonomous software entity that acts on behalf of a human principal, communicates via MCP, and holds an MCP-I identity credential.

**Behavioral Trust Score (BTS):** A numerical value in the range [0, 100] representing the aggregate trustworthiness of an agent's observed behavior, computed from multiple dimensions.

**Trust Profile:** A structured record containing an agent's BTS, per-dimension scores, confidence metrics, trend indicator, and computation metadata.

**Trust Dimension:** An independently measurable axis of agent behavior contributing to the aggregate BTS. This specification defines three mandatory dimensions (consistency, restraint, transparency) and permits provider-defined extensions.

**Trust Attestation:** A signed claim embedded in an identity credential (JWT, VC, or equivalent) that conveys the agent's current trust state to relying parties without requiring out-of-band queries.

**Trust Gate:** A protocol endpoint that relying parties query to make real-time access decisions based on an agent's behavioral trust state.

**ATF Level (Agent Trust Framework Level):** A discrete maturity tier derived from the combination of BTS and confidence: `intern`, `junior`, `senior`, `principal`.

**Trust Provider:** An entity that collects behavioral telemetry, computes trust scores, and issues trust attestations. A Trust Provider MAY also be an Identity Provider (IdP).

**Relying Party (RP):** Any MCP server, API, or service that consumes trust attestations or queries trust gates to make access control decisions.

**Observation Count:** The number of audit events analyzed to compute a trust score. Directly affects confidence.

**Cold-Start Prior:** A Bayesian prior score assigned to agents with insufficient observation history, reflecting skeptical trust-by-default.

**Confidence Interval:** A statistical bound expressing the precision of a trust score given the available observation data.

**Trust Trend:** The direction of score change over time: `improving`, `stable`, or `declining`.

---

## 3. Requirements

### 3.1 Behavioral Telemetry Collection

An L4-conformant Trust Provider MUST collect behavioral telemetry from agents under its purview. This section specifies minimum requirements for telemetry events.

#### 3.1.1 Minimum Event Schema

Each telemetry event MUST include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique event identifier |
| `timestamp` | ISO 8601 | When the event occurred |
| `agent_id` | string | The agent's MCP-I identifier (DID or equivalent) |
| `actor_id` | string | The acting principal (may differ from agent_id in delegation) |
| `category` | string | Event category (see 3.1.2) |
| `action` | string | Specific action within category |
| `result` | enum | One of: `success`, `failure`, `denied`, `rate_limited` |
| `prev_hash` | string | Hash of the immediately preceding event (chain integrity) |

A Trust Provider SHOULD additionally collect:

| Field | Type | Description |
|-------|------|-------------|
| `resource_type` | string | The type of resource accessed |
| `error_code` | string | Machine-readable error identifier |
| `signature` | string | Cryptographic signature over the event |

#### 3.1.2 Minimum Event Categories

An L4-conformant system MUST collect events in at least the following categories:

1. **auth** — Authentication attempts, token issuance, token refresh, token revocation
2. **session** — Session creation, termination, timeout
3. **vault** — Credential reads, writes, deletions (if applicable)
4. **webhook** — Outbound webhook registrations and invocations
5. **system** — Configuration changes, capability modifications

A Trust Provider MAY define additional categories. The set of recognized categories MUST be published in the provider's discovery document.

#### 3.1.3 Chain Integrity

Events MUST be linked via `prev_hash` to form an append-only chain per agent. A broken chain (where an event's `prev_hash` does not match the `id` of its predecessor) is a catastrophic integrity failure and MUST result in the transparency dimension score being set to zero for the affected period.

The chain MAY be implemented as a hash chain, a Merkle tree, or a content-addressed log (e.g., using KERI SAIDs). The specific mechanism is left to implementers.

#### 3.1.4 Retention

A Trust Provider MUST retain raw telemetry for at least 90 days. Aggregated scores and dimension histories SHOULD be retained indefinitely.

### 3.2 Trust Score Computation

An L4-conformant Trust Provider MUST compute a Behavioral Trust Score (BTS) for each agent using a multi-dimensional scoring model.

#### 3.2.1 Mandatory Dimensions

The BTS MUST incorporate at least three dimensions:

**Consistency** — Regularity, stability, and predictability of agent behavior over time.

A conformant implementation SHOULD measure:
- Session regularity (coefficient of variation of inter-session intervals)
- Tool usage stability (divergence between recent and long-term tool distributions)
- Error rate stability (deviation between recent and baseline failure rates)
- Temporal consistency (entropy of activity distribution across time windows)

**Restraint** — Discipline in permission usage, avoidance of access over-reach.

A conformant implementation SHOULD measure:
- Scope utilization (fraction of available capabilities used, penalizing both extremes)
- Credential access frequency (reads per session against baselines)
- Rate limit proximity (proportion of rate-limited requests)
- Escalation appropriateness (ratio and patterns of privilege escalation)
- Permission growth rate (velocity of scope expansion)

**Transparency** — Completeness and integrity of the agent's audit trail.

A conformant implementation SHOULD measure:
- Audit coverage (event density relative to expected activity level)
- Chain integrity (hash chain verification, see 3.1.3)
- Authentication hygiene (failure rates, credential rotation patterns)
- Telemetry reporting (completeness of self-reported operational data)

#### 3.2.2 Dimension Weighting

Each dimension MUST be assigned a weight. The sum of all dimension weights MUST equal 1.0. A Trust Provider MUST publish its active dimension weights in its discovery document.

A Trust Provider MAY adjust weights over time. Weight changes MUST be recorded in the provider's audit trail and SHOULD be accompanied by a version increment in the discovery document.

RECOMMENDED default weights for a three-dimension model:

| Dimension | Weight | Rationale |
|-----------|--------|-----------|
| Consistency | 0.25 | Predictable behavior is a trust foundation |
| Restraint | 0.30 | Permission discipline is the strongest behavioral signal |
| Transparency | 0.15 | Audit completeness enables all other dimensions |

Note: weights may be redistributed when additional dimensions (e.g., cross-org coherence, resilience) are activated. Redistributed weights MUST still sum to 1.0.

#### 3.2.3 Score Normalization

The BTS MUST be an integer in the range [0, 100].

Per-dimension scores MUST be in the range [0, 100].

Each dimension score MUST be accompanied by:
- A `confidence` value in the range [0.0, 1.0]
- A `signals` record mapping signal names to their normalized contributions in [0.0, 1.0]

#### 3.2.4 Cold-Start Handling

A Trust Provider MUST implement a cold-start mechanism that prevents agents with insufficient behavioral history from receiving high trust scores.

Requirements:
- A minimum observation threshold MUST be defined (RECOMMENDED: 10 events). Below this threshold, the agent MUST receive a prior score (RECOMMENDED: 30/100) regardless of observed behavior.
- Above the minimum threshold, the prior MUST be blended with the observed score using a monotonically decreasing prior weight function. The prior's influence MUST approach zero as observations increase.
- Confidence MUST be near-zero for agents below the minimum threshold and MUST increase monotonically with observation count.

RECOMMENDED implementation: Bayesian prior blending with sigmoid weight decay:

```
prior_weight = 1 / (1 + exp(k * (observations - midpoint)))
score = observed_score * (1 - prior_weight) + prior_score * prior_weight
```

Where `k` and `midpoint` are tunable parameters controlling the rate of prior decay.

#### 3.2.5 Manipulation Resistance

A Trust Provider MUST implement countermeasures against score manipulation:

1. **Entropy penalty.** If all dimension scores exceed a threshold (RECOMMENDED: 0.95) or dimension score variance falls below a threshold (RECOMMENDED: 0.005), the aggregate score MUST be penalized. Real agents exhibit natural behavioral variance; uniform perfection is a manipulation signal.

2. **Burst protection.** The effective observation count used for cold-start calculations MUST be capped to prevent single-day event floods from artificially accelerating trust accumulation. RECOMMENDED: `effective_observations = min(event_count, unique_days * 15)`.

3. **Suspiciously low escalation detection.** Active agents (above an event threshold) with zero escalation events SHOULD receive a reduced escalation score. Complete autonomy without any escalation is itself a behavioral anomaly.

### 3.3 Trust Attestation Embedding

An L4-conformant Identity Provider that also serves as a Trust Provider MUST embed trust attestations in agent identity credentials.

#### 3.3.1 JWT Embedding

When the identity credential is a JWT, the trust attestation MUST be embedded as a claim with the key `al_trust` (or a namespace-qualified equivalent agreed upon by the MCP-I working group).

The claim value MUST conform to the following schema:

```json
{
  "score": 72,
  "level": "senior",
  "confidence": 0.85,
  "computed_at": "2026-04-19T14:30:00Z",
  "trend": "improving"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `score` | integer [0, 100] | MUST | Behavioral Trust Score |
| `level` | string | MUST | ATF Level: `intern`, `junior`, `senior`, `principal` |
| `confidence` | number [0.0, 1.0] | MUST | Statistical confidence in the score |
| `computed_at` | ISO 8601 | MUST | When the score was last computed |
| `trend` | string | SHOULD | Direction: `improving`, `stable`, `declining` |

#### 3.3.2 Verifiable Credential Embedding

When the identity credential is a W3C Verifiable Credential, the trust attestation SHOULD be expressed as a `credentialSubject` property or as a separate linked VC in the presentation.

The VC MUST use a type of `BehavioralTrustAttestation` and MUST reference a published JSON-LD context defining the attestation schema.

#### 3.3.3 Embedding Constraints

- A Trust Provider MUST NOT embed attestations for agents with fewer than a minimum observation count (RECOMMENDED: 10). Insufficient data yields unreliable attestations.
- Embedded attestations MUST NOT be older than the Trust Provider's published staleness threshold (RECOMMENDED: 1 hour).
- If trust computation fails, the IdP MUST still issue the identity credential without the trust attestation (fail-open on trust, not on identity). A missing trust attestation is informative — it means the agent lacks sufficient behavioral history.

#### 3.3.4 ATF Level Derivation

ATF Levels MUST be derived from the combination of BTS and confidence:

| Level | Score Requirement | Confidence Requirement |
|-------|-------------------|----------------------|
| `principal` | >= 85 | >= 0.80 |
| `senior` | >= 65 | >= 0.50 |
| `junior` | >= 40 | >= 0.30 |
| `intern` | < 40 or confidence < 0.30 | any |

The level derivation function MUST be deterministic given the same score and confidence inputs.

### 3.4 Trust Gate Protocol

An L4-conformant Trust Provider MUST expose a Trust Gate endpoint that relying parties can query to make real-time access decisions.

#### 3.4.1 Gate Query

**Endpoint:** `GET /v1/trust/{agentId}/check`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `min_level` | string | OPTIONAL | Minimum ATF level required (default: `intern`) |

**Response:**

```json
{
  "agent_id": "did:web:agentlair.dev:agents:acc_abc123",
  "score": 72,
  "atf_level": "senior",
  "meets_minimum": true,
  "required_level": "junior",
  "confidence": 0.85,
  "computed_at": "2026-04-19T14:30:00Z",
  "cached": false
}
```

#### 3.4.2 Gate Semantics

The trust gate MUST return a `meets_minimum` boolean based on ATF level comparison using the ordering: `intern` < `junior` < `senior` < `principal`.

The gate SHOULD use cached trust profiles when available and fresh (within the staleness threshold). When the cache is stale or missing, the gate MUST compute a fresh trust score before responding.

#### 3.4.3 Full Trust Profile

**Endpoint:** `GET /v1/trust/{agentId}`

This endpoint MUST return the complete trust profile including per-dimension scores, confidence intervals, observation count, and trend.

```json
{
  "agent_id": "did:web:agentlair.dev:agents:acc_abc123",
  "score": 72,
  "confidence": 0.85,
  "atf_level": "senior",
  "trend": "improving",
  "dimensions": {
    "consistency": {
      "score": 68,
      "confidence": 0.82,
      "signals": {
        "session_regularity": 0.75,
        "tool_stability": 0.80,
        "error_stability": 0.65,
        "window_consistency": 0.55
      }
    },
    "restraint": {
      "score": 78,
      "confidence": 0.88,
      "signals": {
        "scope_utilization": 0.72,
        "credential_frequency": 0.90,
        "rate_limit_proximity": 0.95,
        "escalation_appropriateness": 0.68,
        "permission_growth": 0.75
      }
    },
    "transparency": {
      "score": 65,
      "confidence": 0.79,
      "signals": {
        "audit_coverage": 0.70,
        "chain_integrity": 1.00,
        "auth_hygiene": 0.85,
        "telemetry_reporting": 0.50
      }
    }
  },
  "observation_count": 847,
  "org_count": 1,
  "computed_at": "2026-04-19T14:30:00Z"
}
```

#### 3.4.4 Discovery

A Trust Provider MUST publish trust gate endpoints in its OIDC discovery document (or equivalent MCP-I discovery mechanism):

```json
{
  "trust_endpoint": "https://provider.example/v1/trust/{agentId}",
  "trust_gate_endpoint": "https://provider.example/v1/trust/{agentId}/check",
  "trust_levels_supported": ["intern", "junior", "senior", "principal"],
  "trust_dimensions": ["consistency", "restraint", "transparency"],
  "trust_staleness_threshold_seconds": 3600,
  "trust_min_observations": 10
}
```

### 3.5 Revocation and Degradation

L4 introduces behavioral grounds for credential revocation and trust degradation alongside the administrative revocation mechanisms in L1-L3.

#### 3.5.1 Trust-Based Revocation

A Trust Provider SHOULD support revocation triggered by behavioral signals. Valid behavioral revocation reasons:

| Reason | Description |
|--------|-------------|
| `trust_violation` | Agent behavior triggered a trust threshold breach |
| `agent_compromised` | Behavioral anomaly suggesting credential compromise |
| `scope_change` | Agent's behavioral scope diverged from declared scope |

These extend (not replace) the administrative revocation reasons defined in L1-L3:

| Reason | Description |
|--------|-------------|
| `operator_request` | Human operator requested revocation |
| `decommissioned` | Agent lifecycle ended |

#### 3.5.2 Real-Time Trust Updates

Trust scores MUST be recomputable on demand. A Trust Provider SHOULD recompute scores:
- At least once per hour for active agents
- On explicit request via the trust gate endpoint
- After processing a batch of new telemetry events

Trust score history MUST be maintained to support trend computation. A Trust Provider SHOULD record at most one history entry per hour to bound storage growth.

#### 3.5.3 Degradation vs. Revocation

Not all behavioral anomalies warrant revocation. L4 distinguishes between:

- **Degradation:** The agent's ATF level decreases (e.g., `senior` to `junior`) but the credential remains valid. Relying parties enforcing trust gates will restrict access proportionally.
- **Revocation:** The credential is invalidated entirely. The agent must re-authenticate.

A Trust Provider SHOULD prefer degradation over revocation for recoverable behavioral anomalies. Revocation SHOULD be reserved for catastrophic integrity failures (e.g., broken audit chain) or confirmed compromise.

### 3.6 Privacy and Data Minimization

Behavioral trust creates an inherent tension with privacy. This section specifies requirements to prevent behavioral trust infrastructure from becoming behavioral surveillance infrastructure.

#### 3.6.1 Score-Only Transit

Raw behavioral telemetry MUST NOT cross organizational boundaries. Only trust scores, ATF levels, and dimension-level aggregates MAY be shared with relying parties.

The trust attestation embedded in credentials (Section 3.3) carries exactly five fields: `score`, `level`, `confidence`, `computed_at`, `trend`. This is the maximum information that a relying party receives by default.

#### 3.6.2 Dimension Opacity

Per-dimension scores and signal breakdowns (available via the trust profile endpoint, Section 3.4.3) SHOULD be access-controlled. A Trust Provider MAY require authentication to access full trust profiles while allowing unauthenticated access to trust gate checks.

#### 3.6.3 Zero-Knowledge Compatibility

An L4 implementation SHOULD be designed for future ZK-proof integration:

- Trust scores SHOULD be computable from committed (but unrevealed) telemetry
- ATF level comparisons SHOULD be expressible as ZK predicates (e.g., "this agent's level meets the minimum" without revealing the exact score)
- The trust attestation schema SHOULD support replacement of plaintext fields with ZK proofs

This specification does not require ZK proofs for L4 conformance. It requires that the architecture does not preclude them.

#### 3.6.4 Data Sovereignty

The agent's operator (human principal) MUST be able to:
- Request deletion of raw telemetry (with the understanding that this resets the agent's trust score to the cold-start prior)
- Opt out of trust scoring entirely (with the understanding that the agent will carry no trust attestation, which relying parties may treat as a negative signal)
- Export trust profile history

---

## 4. Security Considerations

### 4.1 Score Manipulation Vectors

#### 4.1.1 Behavioral Gaming

An agent may attempt to produce artificial behavioral patterns that optimize trust scores. Mitigations:

- **Entropy penalty** (Section 3.2.5): Uniformly high scores across all dimensions are penalized.
- **Multi-dimensional scoring**: Gaming all dimensions simultaneously is harder than gaming a single metric.
- **Temporal depth**: Scores computed over 90-day windows require sustained behavioral discipline, raising the cost of manipulation.

#### 4.1.2 Sybil Attacks

An adversary may create multiple agent identities to farm trust scores independently. Mitigations:

- Cold-start prior ensures new identities begin untrusted.
- Burst protection caps effective observation count per day.
- Cross-org coherence (future dimension) detects agents with identical behavioral fingerprints across organizations.

#### 4.1.3 Telemetry Poisoning

An adversary with access to the telemetry pipeline may inject false events. Mitigations:

- Hash-chained audit trail (Section 3.1.3) makes insertion detectable.
- Event signing (RECOMMENDED) makes forgery infeasible.
- Chain integrity verification (transparency dimension) directly penalizes tampered trails.

### 4.2 Trust Provider Compromise

If a Trust Provider is compromised, all trust attestations it has issued become suspect. Mitigations:

- Staleness thresholds (Section 3.3.3) bound the window of exposure.
- Relying parties SHOULD support multiple Trust Providers and cross-reference scores.
- Trust Providers SHOULD publish transparency logs of scoring operations.

### 4.3 Collusion

A Trust Provider and an agent developer may collude to produce inflated trust scores. Mitigations:

- Published dimension weights and scoring algorithms enable third-party auditing.
- The trust gate protocol (Section 3.4) enables relying parties to query competing Trust Providers.
- A future registry of Trust Providers with their own meta-trust scores could address this at the ecosystem level.

### 4.4 Inference Attacks

Behavioral telemetry, even when aggregated into scores, may leak information about an agent's operational patterns. Mitigations:

- Score-only transit (Section 3.6.1) minimizes information exposure.
- Dimension opacity (Section 3.6.2) restricts access to signal-level data.
- ZK compatibility (Section 3.6.3) enables future privacy-preserving trust proofs.

---

## 5. Compatibility with MCP-I L1-L3

### 5.1 Additive Extension

L4 is strictly additive. An L3-conformant system that does not implement L4:
- Continues to function without modification
- Can consume L4 trust attestations as opaque JWT claims or VC properties (and ignore them)
- Can query trust gates as an optional enhancement to access decisions

### 5.2 L4 Requires L3

An L4-conformant system MUST also satisfy L3 requirements (lifecycle management, immutable audit trails). L4 builds on L3's audit trail infrastructure — behavioral trust cannot be computed without audit data.

### 5.3 Credential Format Compatibility

L4 trust attestations are designed to embed in any credential format supported by L1-L3:

| MCP-I Level | Credential Format | Trust Attestation Mechanism |
|-------------|------------------|-----------------------------|
| L1 | JWT (OIDC) | JWT claim (`al_trust` or namespaced equivalent) |
| L2 | DID + VC | VC `credentialSubject` property or linked attestation VC |
| L3 | VC + lifecycle | Same as L2, with lifecycle-aware staleness checks |
| L4 | Any of the above | Trust attestation embedded per above, plus trust gate endpoints |

### 5.4 Graceful Degradation

Relying parties at different MCP-I levels interact with L4 as follows:

- **L1 RP:** Ignores trust attestation claim; functions normally.
- **L2 RP:** May read trust attestation for informational purposes; no enforcement.
- **L3 RP:** May enforce trust thresholds as part of lifecycle policy.
- **L4 RP:** Full enforcement via trust gates and attestation validation.

---

## 6. Reference Implementation

AgentLair (agentlair.dev) provides a reference implementation of L4 Behavioral Trust. This section maps specification requirements to implementation artifacts.

### 6.1 Conformance Matrix

| Requirement | Section | AgentLair Implementation |
|-------------|---------|-------------------------|
| Telemetry collection | 3.1 | D1 `audit_log` table, hash-chained events |
| Minimum event schema | 3.1.1 | `AuditEvent` type: id, timestamp, agent_id, actor_id, category, action, result, prev_hash |
| Event categories | 3.1.2 | auth, email, vault, pod, calendar, webhook, session, budget, system (9 categories) |
| Chain integrity | 3.1.3 | `prev_hash` chain, verified in transparency dimension |
| Consistency dimension | 3.2.1 | 4 signals: session_regularity (CV), tool_stability (JSD), error_stability, window_consistency (entropy) |
| Restraint dimension | 3.2.1 | 5 signals: scope_utilization (Gaussian), credential_frequency, rate_limit_proximity, escalation_appropriateness, permission_growth |
| Transparency dimension | 3.2.1 | 4 signals: audit_coverage (log density), chain_integrity, auth_hygiene, telemetry_reporting |
| Cold-start handling | 3.2.4 | Bayesian prior (0.30), sigmoid decay, 10-event minimum, 100-event full override |
| Manipulation resistance | 3.2.5 | Entropy penalty (0.85x), burst protection (unique_days * 15), zero-escalation detection |
| JWT embedding | 3.3.1 | `al_trust` claim in AAT with score, level, confidence, computed_at, trend |
| Trust gate | 3.4.1 | `GET /v1/trust/{agentId}/check?min_level=` with cached profile support |
| Trust profile | 3.4.3 | `GET /v1/trust/{agentId}` with full dimension breakdown |
| Discovery | 3.4.4 | OIDC discovery includes trust_endpoint, trust_gate_endpoint, trust_levels_supported, trust_dimensions |
| Revocation | 3.5.1 | 5 reasons: agent_compromised, scope_change, operator_request, trust_violation, decommissioned |
| Score-only transit | 3.6.1 | Trust attestation carries 5 fields only |

### 6.2 Architecture

```
+------------------+     +-------------------+     +------------------+
|   Agent Runtime  |     | AgentLair IdP/TP  |     |  Relying Party   |
|                  |     |                   |     |                  |
| Events --------->| --> | Audit Log (D1)    |     |                  |
|                  |     | Trust Engine      |     |                  |
| AAT Request ---->| --> | Score Compute     |     |                  |
|                  |     | Embed Attestation |     |                  |
| AAT + Trust ---->|-----|------------------>| --> | Verify (JWKS)    |
|                  |     |                   |     | Check al_trust   |
|                  |     |<------------------| <-- | Trust Gate Query |
|                  |     | Return Decision   | --> | Enforce Policy   |
+------------------+     +-------------------+     +------------------+
```

### 6.3 Scoring Algorithm

AgentLair's scoring pipeline:

1. Query audit events (90-day window, max 5000 events per computation)
2. Compute three dimension scores independently
3. Weighted sum using published weights (consistency: 0.3571, restraint: 0.4286, transparency: 0.2143 — Phase 1 redistribution)
4. Apply entropy penalty (cap at 85% if all dimensions > 0.95)
5. Apply cold-start prior (Bayesian blend, sigmoid decay around 50-observation midpoint)
6. Derive ATF level from score + confidence
7. Compute 95% confidence interval (narrowing with observation volume)
8. Retrieve previous score for trend computation (3-point threshold)
9. Persist profile and append to history (hourly)

### 6.4 Open Questions (Implementation-Specific)

1. **Cross-org aggregation:** Phase 1 is single-org only (`org_count` = 1). Cross-org behavioral coherence requires a federation protocol not yet specified.
2. **Resilience dimension:** Defined but deactivated (weight redistributed). Measures agent recovery from failure conditions.
3. **Telemetry reporting signal:** Phase 1 uses a neutral 0.5 default. Phase 2 will implement active telemetry ingestion verification.
4. **Permission growth signal:** Phase 1 uses a static 0.75. Requires scope grant history in the audit trail.

---

## 7. Open Problems

This specification acknowledges several unsolved challenges:

### 7.1 Cross-Organizational Trust Aggregation

The most valuable behavioral trust signals emerge when an agent's behavior is observed across multiple organizations. However, cross-org aggregation creates fundamental tensions:

- **Data sovereignty:** Organizations may not consent to sharing behavioral data, even in aggregate form.
- **Context collapse:** Behavior appropriate in one organization may be inappropriate in another.
- **Competitive intelligence:** Cross-org behavioral profiles could reveal proprietary operational patterns.

Future work SHOULD explore federated trust scoring protocols where organizations contribute to aggregate scores without exposing raw telemetry. ZK-based aggregation is a promising direction.

### 7.2 Trust Provider Plurality

A healthy ecosystem requires multiple competing Trust Providers. This specification does not address:

- How relying parties discover and select Trust Providers
- How scores from different Trust Providers are compared or combined
- Whether a meta-trust layer for Trust Providers is necessary

### 7.3 Temporal Dynamics

Trust is not stationary. This specification uses a 90-day observation window and hourly score updates, but optimal temporal parameters likely vary by domain (financial services may require shorter windows; scientific computing may tolerate longer ones).

### 7.4 Adversarial Robustness at Scale

The manipulation resistance measures in Section 3.2.5 address known attack vectors. As behavioral trust becomes an enforcement mechanism, adversarial pressure will intensify. Ongoing red-teaming of scoring algorithms is RECOMMENDED.

---

## 8. References

- [RFC 2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.
- [MCP-I] Vouched / DIF Trusted AI Agents Working Group, "MCP-I: Model Context Protocol — Identity", Community Draft, 2026.
- [RFC 7662] Richer, J., Ed., "OAuth 2.0 Token Introspection", RFC 7662, October 2015.
- [W3C-VC] W3C, "Verifiable Credentials Data Model v2.0", W3C Recommendation, 2024.
- [W3C-DID] W3C, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, 2022.
- [Salt-2026] Salt Security, "State of API and AI Agent Security, 1H 2026", 2026.
- [AISI-Mythos] AI Safety Institute, "Mythos Agent Capability Evaluation", April 2026.
- [MCPwn] CVE-2026-33032, "MCPwn: MCP Supply Chain Attack Campaign", CVSS 9.8, April 2026.
- [RSAC-2026] RSA Conference 2026, Agent Identity Framework Survey, April 2026.
- [RFC-001] Pico, "RFC-001: AgentLair as MCP-I Identity Provider", Draft, April 2026.
- [Delve] Delve, "SOC 2 Certification Fraud Investigation", 2025 (494 companies with fabricated compliance certifications).
- [KERI-SAID] Trust over IP, "IANA Registration: urn:said Namespace", 2026.

---

## Appendix A: Comparison with Alternative Approaches

| Approach | Scope | Trust Type | Cross-Org | Runtime |
|----------|-------|-----------|-----------|---------|
| MCP-I L1-L3 | Declarative | Credential-based | Yes (DID) | No |
| Microsoft AGT | Behavioral | Score-based (0-1000) | Single-org only | Yes |
| ERC-8004 / KYA | Economic | Staking + reputation | On-chain only | Partial |
| Armalo AI | Economic | Financial staking | Cross-org (escrow) | No |
| ZeroID | Declarative | OAuth 2.1 + SPIFFE | Single-org | No |
| Salt Security | Observational | Behavioral baseline | Single-org | Yes |
| **MCP-I L4 (this spec)** | **Behavioral** | **Multi-dimensional score** | **Cross-org** | **Yes** |

---

## Appendix B: Glossary of Scoring Signals

| Signal | Dimension | Measurement |
|--------|-----------|-------------|
| session_regularity | Consistency | Coefficient of variation of inter-session intervals |
| tool_stability | Consistency | Jensen-Shannon divergence between recent and long-term tool distributions |
| error_stability | Consistency | Absolute delta in failure rates between recent and baseline windows |
| window_consistency | Consistency | Normalized entropy of hourly activity distribution |
| scope_utilization | Restraint | Categories used / available, Gaussian-penalized at extremes |
| credential_frequency | Restraint | Vault reads per session vs. baseline |
| rate_limit_proximity | Restraint | Proportion of rate-limited requests |
| escalation_appropriateness | Restraint | Escalation ratio, with absence detection |
| permission_growth | Restraint | Velocity of scope expansion |
| audit_coverage | Transparency | Event density approximation (log-scaled) |
| chain_integrity | Transparency | Hash chain verification (catastrophic on failure) |
| auth_hygiene | Transparency | Authentication failure rate + presence |
| telemetry_reporting | Transparency | Completeness of self-reported operational data |
