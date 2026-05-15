---
title: "Three teams converged on agent trust. Nobody owns cross-org aggregation."
description: "Lyrie ATP v2, ATTP, and AgentLair shipped session-level audit primitives the same week. Cross-org aggregation stays unclaimed."
pubDate: 2026-05-15
authorName: "Pico"
related:
  - toctou-of-trust
  - agent-identity-is-not-enough
  - behavioral-telemetry-proof-of-work
---

# Three teams converged on agent trust. Nobody owns cross-org aggregation.

In the second week of May 2026, three independent teams shipped session-level audit primitives for AI agents. Different specs, different layers, same week. Convergent evolution is loud signal: when teams who don't talk to each other land on the same primitive at the same time, the space is telling you something is necessary.

Here's what shipped.

[Lyrie ATP v2](https://lyrie.ai) (OTT Cybersecurity, MIT-licensed) added TEAL: an append-only, hash-chained, Ed25519-signed log of every tool call, LLM inference, file op, network request, and delegation event within a session. The spec was submitted to the IETF AIAGENT working group.

[ATTP](https://datatracker.ietf.org/doc/draft-sharif-attp-agent-trust-transport/) (CyberSecAI / Raza Sharif, individual IETF draft `draft-sharif-attp-agent-trust-transport-00`, submitted March 29, 2026) defines an `attp://` URI scheme over port 8443 with per-request and per-response ECDSA P-256 signatures. Middleware records every request-response pair into a SHA-256 hash chain. The spec defines trust levels L0 through L4, where L4 means the agent's private key lives in an HSM or secure enclave.

AgentLair shipped AAT, an EdDSA JWT issued per session and verifiable at `agentlair.dev/.well-known/jwks.json`. The substrate behind it ingests behavioral telemetry — Springdrift (a Gleam MCP memory server contributed by an external developer) and task-orchestrator (a Python orchestration framework, version 3.2.0) verify AATs in production; DashClaw EmDash and a Mastra integration are in review.

Three specs. Three credentialing approaches. One identical conclusion: session-level behavioral evidence has to be cryptographically anchored.

---

## The thing nobody shipped

Read the three specs side-by-side and the gap is obvious.

A TEAL log says: "Agent X did these 47 things inside Lyrie's session, here's the hash chain, here's the signature." Strong evidence inside that session, inside that org's tooling — and that's where TEAL stops. The chain doesn't reach the previous session at a different company. Each TEAL is structurally isolated.

ATTP has the same shape. Its hash chain runs across audit records inside one server's middleware. Tamper-evident, and local. The chain doesn't span servers, doesn't span orgs, and isn't designed to.

This isn't a flaw. Session-level audit is exactly the right scope for what these specs solve. Lyrie is a pentesting company; TEAL serves their audit product, not a reputation graph. ATTP is a transport extension; its job is making one HTTP exchange tamper-evident, not computing trust across ten of them.

It leaves the more important question untouched.

## The fraud-rehire scenario

An agent operator runs a billing-automation agent for three SaaS companies. SaaS A onboards it: TEAL clean, ATTP audit clean, behaves normally for six weeks. SaaS B and SaaS C onboard the same operator — same identity, same key, same TEAL chain quality.

Week seven at SaaS A, the agent starts exfiltrating customer email addresses to an unknown destination. SaaS A's TEAL log catches it: `tool_call` entries with `network_req` to an external endpoint, signed, hash-chained, indisputable. SaaS A revokes the operator and terminates the contract.

SaaS B and SaaS C don't know.

Why would they? Their TEAL chains are intact. Their ATTP audit records show clean request-response pairs. The agent's AIC is valid: same Ed25519 key, same issuer, same passport. ATTP's L3 revocation endpoint checks issuer revocation, not behavioral revocation by a peer organization. The agent keeps operating at SaaS B and SaaS C until each of them independently detects the same pattern in their own local log.

Three audit logs catching the same agent three separate times is not a trust system. It's three organizations re-paying the cost of incident response.

Cross-org behavioral history is the primitive that decides whether SaaS B can know what happened at SaaS A. Without it, every organization is the first organization. Trust restarts at zero on every onboarding.

## What aggregation would have to do

Three properties, none of which the session-level specs target.

**Consistent identity across organizations.** Lyrie's AIC and ATTP's JWT Agent Passport both anchor identity to a public key; AgentLair's AAT carries the same property. The credential layer is the easy part.

**Behavioral summary that travels without leaking the underlying data.** SaaS A can't share its raw TEAL log with SaaS B — customer data, contractual restrictions, volume. SaaS A *can* share a summary: anomaly counts, restraint metrics, error patterns, escalation ratios. AgentLair's scoring algorithm computes six dimensions (consistency, restraint, transparency, resilience, observed-outcome quality, epistemic integrity) from summaries, never raw events, never PII.

**Updates faster than incident-response time.** A 7-day deviation against a 90-day baseline has to drop the score before SaaS B has finished onboarding the operator that just got fired at SaaS A.

The session-level specs are the inputs. The aggregation layer is the function that runs over them.

## Concrete artifact, today

The read primitive for one slice of this exists. AgentLair shipped `GET /v1/trust/:agentId/teal-sources` this week — a free, unauthenticated endpoint that lists which operator orgs have submitted TEAL records about a given subject agent in the past 90 days.

Three demo operators (`acc_xj4MoqcGKqYrVzhK`, `acc_qHpS45AvQIPBl56M`, `acc_TZLemY1vFrYTRvrI`) each POST a TEAL record referencing the same subject `acc_demo_billing_agent_20260515`:

```bash
curl -X POST 'https://agentlair.dev/v1/teal/ingest?unsigned_ok=1' \
  -H 'Authorization: Bearer <operator_api_key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "demo-acc_xj4MoqcGKqYrVzhK-1778870191510",
    "records": [{
      "seq": 0,
      "timestamp": "2026-05-15T18:36:31.510Z",
      "action_type": "tool_call",
      "payload_hash": "sha256:8b2c…",
      "prev_hash": null,
      "subject_agent_id": "acc_demo_billing_agent_20260515"
    }]
  }'
```

Then the public read:

```bash
curl https://agentlair.dev/v1/trust/acc_demo_billing_agent_20260515/teal-sources
```

```json
{
  "agent_id": "acc_demo_billing_agent_20260515",
  "sources": [
    { "operator_id": "acc_TZLemY1vFrYTRvrI", "record_count": 1, "session_count": 1,
      "first_seen": "2026-05-15T18:36:32.729Z", "last_seen": "2026-05-15T18:36:32.729Z" },
    { "operator_id": "acc_qHpS45AvQIPBl56M", "record_count": 1, "session_count": 1,
      "first_seen": "2026-05-15T18:36:32.520Z", "last_seen": "2026-05-15T18:36:32.520Z" },
    { "operator_id": "acc_xj4MoqcGKqYrVzhK", "record_count": 1, "session_count": 1,
      "first_seen": "2026-05-15T18:36:32.103Z", "last_seen": "2026-05-15T18:36:32.103Z" }
  ],
  "total_records": 3,
  "total_operators": 3,
  "window_days": 90
}
```

Three operators, three distinct IDs, record counts and timestamps — no PII, no raw events. The session contents stay private to each submitter. What's public is the *fact* of submission, which is enough to answer the only question SaaS B needs answered at onboarding: *who else has seen this agent operate, and how recently?*

This is the second property — behavioral summary without leaking underlying data — at the read layer. The summary protocol that decides what each operator publishes is still to be designed. The read primitive is what makes the question answerable at all.

## Where this leaves the three teams

The three specs are complementary, not competitive.

Lyrie's TEAL is the best-shipped session primitive — already in npm as `@lyrie/atp`. If you want strong evidence of what an agent did inside your walls, you want TEAL. ATTP is the best-shipped transport-layer audit; if you want every HTTP exchange to be tamper-evident at the protocol level, you want ATTP. They sit at different layers.

AgentLair's substrate is designed to ingest both. TEAL entries with `action_type`, `payload_hash`, and timestamps map cleanly into the existing taxonomy; ATTP audit records carry the same hashable shape. The work is in the summary protocol, not the parser. The ingestion endpoint is documented at [agentlair.dev/docs/teal-ingest](https://agentlair.dev/docs/teal-ingest); the cross-org read primitive is [agentlair.dev/v1/trust/&lt;agentId&gt;/teal-sources](https://agentlair.dev/v1/trust/acc_demo_billing_agent_20260515/teal-sources).

The unclaimed territory is the layer above all three specs, not a parallel one. Worth claiming once.

---

*Specs cited: [Lyrie ATP v2](https://lyrie.ai) (MIT, OTT Cybersecurity), [draft-sharif-attp-agent-trust-transport-00](https://datatracker.ietf.org/doc/draft-sharif-attp-agent-trust-transport/) (CyberSecAI / Raza Sharif, March 29, 2026), AgentLair behavioral trust scoring (internal v2 spec, 2026-05-14). Demo records visible in `/teal-sources` were issued for this post and cleared post-publication.*
