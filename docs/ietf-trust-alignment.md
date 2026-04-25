# IETF Draft Alignment: Agent Payment Trust Dimensions

_Source: [draft-sharif-agent-payment-trust-00](https://datatracker.ietf.org/doc/draft-sharif-agent-payment-trust/)_
_Last verified: 2026-04-25_

The IETF draft defines five trust dimensions for AI agent interactions, each weighted equally at 20% of an overall 0-100 trust score. This document maps each dimension to AgentLair's current capabilities.

---

## Alignment Table

| IETF Dimension | Definition (§7.1) | AgentLair Coverage | Evidence | Status |
|---|---|---|---|---|
| **Behavioural Consistency (BC)** | "Statistical consistency of the agent's transaction patterns (amounts, recipients, timing) relative to its established baseline." | `consistency` dimension | `GET /v1/trust/{agentId}` → `dimensions.consistency`. Computed via entropy analysis of call sequences (session_regularity, tool_stability, window_consistency). | ✅ **Maps** |
| **Anomaly History (AH)** | "The inverse of the count and severity of detected anomalies (fewer anomalies = higher score)." | `restraint` dimension | `GET /v1/trust/{agentId}` → `dimensions.restraint`. Computed from scope_utilization, rate_limit_proximity, escalation_appropriateness. Higher score = agent stays within bounds = fewer anomalies. | ✅ **Maps** |
| **Execution Success Rate (ES)** | "The proportion of the agent's past transactions that completed without anomaly, dispute, or reversal." | `transparency` dimension (partial) | `GET /v1/trust/{agentId}` → `dimensions.transparency`. Measures external event reporting consistency and error reporting fidelity. Captures the observable signal of success (agents that report errors honestly), not the raw success rate. | ⚠️ **Partial** |
| **Operational Tenure (OT)** | "The duration the agent has been registered and actively transacting." | ATF maturity levels + observation count (partial) | Agent registration timestamp exists. `observationCount` in trust response reflects activity duration. ATF level progression (intern → junior → senior → principal) implicitly rewards sustained operation. No explicit tenure-as-score computation. | ⚠️ **Partial** |
| **Code Attestation (CA)** | "Whether the agent's code has been cryptographically verified against its declared specification." | Not implemented | AgentLair issues Ed25519 identity tokens (AAT) and supports per-agent signing keys at `POST /v1/agents/signing-keys` — this verifies *who* the agent is, not *what code it runs*. Missing: code hash registry or verifiable build attestation. | ❌ **Gap** |

---

## Summary

| Count | Dimensions |
|---|---|
| 2 direct maps | BC (consistency), AH (restraint) |
| 1 partial map | ES (transparency — captures error reporting fidelity, not raw success rate) |
| 1 partial infrastructure | OT (registration timestamp + ATF levels, no explicit tenure score) |
| 1 gap | CA (identity verification exists; code attestation does not) |

**AgentLair directly implements 2/5 IETF trust dimensions and partially covers a third.**

---

## What Would Close the Gaps

### Execution Success Rate (ES → full coverage)
- Track explicit success/failure outcomes per API interaction (not just error reporting)
- Add a `success_rate` field to the trust profile computed from outcome events
- Requires consumer integrations to report outcome data (vs. inferring from error events)

### Operational Tenure (OT → full coverage)
- Expose `registration_date` and `active_days` in the trust API response
- Compute a tenure score: `tanh(active_days / 30)` → [0, 1] range, asymptotes toward full score at ~90 days
- Already have the data; needs a scoring function and API exposure

### Code Attestation (CA → new capability)
- Define an attestation format: `{code_hash, spec_hash, signed_by: agent_signing_key}`
- Add `POST /v1/attestations/code` endpoint for agent-submitted build attestations
- Allow relying parties to verify attestation via `GET /v1/attestations/{agentId}`
- ZK-proof option: prove code matches spec without revealing code (future)

---

## Use of This Alignment

This table is factual — cross-checked against the trust-engine implementation at
`packages/worker/src/trust-engine.ts` and the live API endpoint `GET /v1/trust/{agentId}`.

**Claim guidance for external communications:**
- ✅ Safe: "AgentLair implements behavioural consistency and anomaly history scoring aligned with IETF draft-sharif trust dimensions"
- ✅ Safe: "Two of five IETF draft trust dimensions have direct implementations; a third (execution success rate) is partially covered via transparency scoring"
- ❌ Avoid: "AgentLair implements 3/5 IETF trust dimensions" without the caveat that the third is partial
- ❌ Avoid: Any mention of code attestation as supported
