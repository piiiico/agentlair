# AgentLair: L4 Behavioral Trust for the Agentic Economy

*Cross-organizational trust infrastructure that closes the gap between who an agent is and what it actually does.*

---

## The Credential Gap

Every major security incident involving AI agents in 2026 has shared the same structural feature: the agent had valid credentials.

In April 2026, Vercel disclosed that a third-party AI tool's compromised OAuth token granted an attacker access to internal systems affecting hundreds of users across multiple organizations. The attacker didn't breach a firewall or crack a password. They compromised one OAuth credential belonging to one AI tool — and that single token opened the blast radius to every organization the tool touched.

Two weeks earlier, MCPwn (CVE-2026-33032, CVSS 9.8) became the first named MCP exploit campaign: 2,600+ exposed MCP server instances, 200,000+ servers in the supply-chain attack surface, all actively exploited. The agents connecting to those servers had valid identity credentials. The servers accepted the connections because the identity checks passed.

At RSAC 2026, five major vendors shipped agent identity frameworks in a single conference cycle. VentureBeat's assessment was precise: *"Every identity framework verified who the agent was. None tracked what the agent did."*

Salt Security's 1H 2026 report quantified the blind spot: 48.9% of organizations cannot see machine-to-machine traffic. 48.3% cannot distinguish agents from bots at runtime. Non-human identities outnumber human identities 40-100x in enterprise environments, and 68% of cloud breaches in the prior year originated from unmanaged machine credentials.

The AI Safety Institute's Mythos evaluation added the exclamation point. Autonomous agents executed 32-step corporate network attacks, discovering and exploiting zero-day vulnerabilities. Every declarative control was bypassed. The evaluators explicitly named behavioral monitoring as the missing defense layer. Vidoc Security then demonstrated that Mythos-class capabilities are reproducible for under $30 using public API access — meaning the threat model extends to every developer with an API key, not just 52 vetted consortium members.

These are not access control failures. OAuth worked. OIDC worked. SPIFFE worked. The credentials were valid, the delegation chains were intact, and the identity checks passed. The attacks succeeded in the gap between **authorization** (what the agent is allowed to do) and **behavior** (what the agent actually does).

This is the gap that L3 identity infrastructure — necessary as it is — cannot close. L3 tells you WHO. L4 tells you WHAT, HOW, and WHETHER YOU SHOULD LET IT CONTINUE.

---

## What L4 Behavioral Trust Means

Behavioral trust is a specific claim with a measurable definition. It is not "reputation" in the vague sense, not a dashboard metric, and not an operational health check. It is continuous, multi-dimensional scoring of an agent's actual runtime behavior, computed across time and organizational boundaries, embedded in the agent's identity credential, and queryable by any relying party in real time.

AgentLair defines behavioral trust across three dimensions:

### Consistency

Does the agent do what it claims to do? Consistency measures predictability — the regularity of session patterns, the stability of tool usage distributions over time, the steadiness of error rates. An agent that suddenly shifts from targeted database lookups to bulk exports, or from regular 9-to-5 sessions to continuous 24/7 operation, produces a measurable consistency signal.

The implementation uses coefficient of variation on inter-session intervals, Jensen-Shannon divergence between recent (7-day) and long-term (90-day) tool distributions, error rate delta analysis, and normalized Shannon entropy of hourly activity patterns. These are statistical measures, not heuristics — they detect behavioral drift before it becomes a security event.

### Restraint

Does the agent stay within its declared capabilities? Restraint measures discipline in permission usage. How many of its available capabilities does the agent actually use? (Both extremes — using everything and using nothing — are penalized via a Gaussian centered at 60% utilization.) How frequently does it access the credential vault? How close does it operate to rate limits? Does it escalate appropriately — and is zero escalation from an active agent treated as suspicious?

The restraint dimension carries the highest weight (43% of the composite score) because permission discipline is the strongest behavioral signal distinguishing well-governed agents from compromised or misconfigured ones.

### Transparency

Does the agent report its actions? Transparency measures the completeness and integrity of the agent's audit trail. Events are hash-chained — each event's `prev_hash` must equal the preceding event's `id`, forming an append-only log. A broken chain is catastrophic: the transparency dimension drops to zero for the affected period. Audit coverage (event density relative to expected activity), authentication hygiene (failure rates, credential rotation), and telemetry completeness are all measured.

Transparency is weighted lowest (21%) but acts as a prerequisite: without a complete audit trail, the other dimensions cannot be reliably computed.

### The Score

The three dimensions combine into a Behavioral Trust Score (BTS) from 0 to 100, which maps to four ATF (Agent Trust Framework) maturity levels:

| Level | Score | Confidence | Analogy |
|-------|-------|------------|---------|
| **Intern** | 0–39 | Any | New hire. Supervised access only. |
| **Junior** | 40–64 | ≥ 0.30 | Building track record. Standard access. |
| **Senior** | 65–84 | ≥ 0.50 | Established history. Trusted with sensitive operations. |
| **Principal** | 85–100 | ≥ 0.80 | Extensive, verified behavioral record. Maximum autonomy. |

Every agent starts at 30 — the cold-start prior. This is deliberate: new agents are treated like interns, not like trusted colleagues. The prior blends with observed behavior via Bayesian weighting with sigmoid decay, requiring approximately 100 behavioral observations before empirical data fully overrides the skeptical default.

The scoring engine includes three manipulation countermeasures:

1. **Entropy penalty.** If all dimensions score above 0.95, the effective maximum is capped at 85%. Perfect behavior is suspicious — real agents exhibit natural variance.
2. **Burst protection.** Effective observation count is capped at `unique_days * 15`, preventing an agent from flooding 1,000 events in a single day to accelerate trust accumulation.
3. **Zero-escalation detection.** Active agents with no escalation events receive a reduced escalation score. Complete autonomy without any human touchpoint is itself a behavioral anomaly.

Trust isn't handed out for existing. It is earned by behaving predictably, appropriately, and transparently over sustained periods.

---

## AgentLair vs. Alternatives

The agent identity market is active and growing. Several serious products address parts of the problem. The differences are architectural, not qualitative — each makes a different structural trade-off.

### Microsoft Agent Governance Toolkit (AGT)

**What it does well:** Per-action policy enforcement using OPA Rego, Cedar, or YAML. Sub-millisecond latency. Trust scoring from 0 to 1,000 based on operational metrics. Open source (MIT). Ships ML-DSA-65 for post-quantum readiness. The most sophisticated single-org governance toolkit available.

**Structural limitation:** Single-org only. AGT's policies, trust scores, and behavioral observations exist within one organization's deployment. When an agent calls a partner's MCP server, AGT's governance doesn't travel with it. The partner sees a valid OAuth token — nothing more. Cold-start for external agents is effectively score zero; there is no mechanism for an agent to carry its behavioral history across organizational boundaries.

**Where AgentLair differs:** Cross-org by design. Trust attestations are embedded in the agent's JWT credential (`al_trust` claim) and travel with every request. Any relying party can read the agent's behavioral trust score without calling AgentLair at runtime — standard JWKS verification is sufficient. The trust score reflects behavior across every organization the agent has interacted with, not just the deploying org's view.

### Armalo AI

**What it does well:** Pure L4 — the first competitor to ship exclusively in the behavioral trust layer. Uses financial staking (USDC escrow on Base) as the accountability mechanism. Pact-based: agents declare behavioral commitments and stake capital against them. If a pact is violated, the stake is slashed. Validates the L4 market category.

**Structural limitation:** Tiny (53 pacts, 48 agents as of April 2026). Financial staking is a strong signal for high-value interactions but creates barriers for routine agent operations where $50 in escrow per pact is disproportionate. No credential issuance layer — agents need external identity. Ghost agents with active pacts but no monitoring are undetectable because the escrow sits unchecked.

**Where AgentLair differs:** Behavioral telemetry rather than financial staking. Telemetry scales to millions of observations at near-zero marginal cost; escrow scales with capital requirements. AgentLair includes the full identity stack (credential issuance, JWKS, `did:web`, OIDC discovery) alongside behavioral trust — agents don't need a separate IdP. The approaches are complementary: financial staking and behavioral telemetry measure different things, and a mature ecosystem likely needs both.

### Curity Access Intelligence

**What it does well:** Runtime OAuth token scoping — per-action tokens encoding purpose and intent. Sophisticated authorization engineering from a team with deep identity protocol expertise.

**Structural limitation:** L3 only. Tokens encode what the agent *declares* it will do, not what it *actually does*. An agent requesting a token for "customer lookup" that executes a bulk export isn't caught by the token — the token was already issued. Intra-org only; no cross-org trust aggregation.

**Where AgentLair differs:** L4 behavioral observation closes the TOCTOU gap that declarative tokens leave open. AgentLair measures what happened, not what was declared. The two layers are complementary: Curity constrains authorization, AgentLair verifies behavior.

### Comparison Matrix

| Capability | AgentLair | Microsoft AGT | Armalo AI | Curity |
|-----------|-----------|---------------|-----------|--------|
| Trust type | Behavioral telemetry | Operational metrics | Financial staking | Declarative tokens |
| Scope | Cross-org | Single-org | Cross-org (limited) | Intra-org |
| Cold-start | 30/100 (Bayesian prior) | 0 (external agents) | Stake-dependent | N/A |
| Credential issuance | Yes (EdDSA JWT + did:web) | No | No | Yes (OAuth) |
| Trust travels with agent | Yes (JWT claim) | No | No (query pact) | No |
| Post-quantum | EdDSA (migration planned) | ML-DSA-65 | No | No |
| Manipulation resistance | Entropy + burst + zero-escalation | Not published | Economic (slash) | N/A |
| Privacy model | Score-only transit, ZK-compatible | Org-internal | On-chain (public) | Org-internal |

---

## Integration in 10 Minutes

AgentLair is designed for developers who want trust infrastructure without a six-month integration project. The path from zero to a verified agent has five steps:

**1. Register your agent** — `POST /v1/register` with a name, recovery email, and declared capabilities. You receive an API key (shown once), an account ID, and an `@agentlair.dev` email address. Free tier: 3 agents, 1,000 token verifications/month, 100 API requests/day.

**2. Issue an Agent Auth Token** — `POST /v1/tokens/issue` with target audience (the service your agent will call), TTL (60s to 24h), and scopes. Returns an EdDSA-signed JWT containing `did:web` identity, declared scopes, audit URL, and — once 10+ observations exist — an embedded `al_trust` behavioral trust attestation.

**3. Present the AAT** — Your agent includes the JWT as a Bearer token in every outbound request. The receiving service verifies it using standard JWKS at `/.well-known/jwks.json`. No AgentLair SDK required. No runtime callback. Standard JWT verification with any `jose`-compatible library.

**4. Accumulate behavioral observations** — AgentLair logs behavioral events as your agent operates: authentication patterns, tool usage, credential access, session lifecycle. These observations feed the trust engine automatically. After ~10 observations, trust scores appear in issued tokens; after ~100, the cold-start prior is fully overridden by empirical data.

**5. Query or gate on trust** — Any service can read the `al_trust` claim from the JWT for a quick trust check. For real-time scoring, query `GET /v1/trust/{agentId}/check?min_level=senior` — returns a boolean `meets_minimum` plus the full score. Use this in CI/CD gates, MCP server middleware, or API authorization layers.

Production integration patterns are documented with code examples for MCP server guards (TypeScript), CI/CD trust gates (bash), and HTTP middleware (Hono/Express). Reference implementations: the Springdrift MCP server (Gleam/BEAM, merged), the task-orchestrator JWKS ActorVerifier (production), and the DashClaw EmDash plugin (in review).

---

## Pricing Model

AgentLair is priced for agents, not enterprises. Two models, mix freely:

### Subscription

| Tier | Price | Agents | Verifications/mo | API Requests/day |
|------|-------|--------|-------------------|------------------|
| Free | $0 | 3 | 1,000 | 100 |
| Starter | $29/mo | Unlimited | 10,000 | 10,000 |
| Pro | $149/mo | Unlimited | Unlimited | Unlimited |

### Per-Use Micropayments (x402)

When your agent hits a rate limit, the API returns HTTP 402 with payment instructions. Your agent constructs a USDC authorization on Base L2, attaches it as an `X-PAYMENT` header, and retries. Settlement is immediate. No invoice, no billing cycle, no procurement process.

| Service | Price |
|---------|-------|
| Token verification | 0.001 USDC |
| Agent provisioning | 0.01 USDC |
| Email send | 0.01 USDC |

This is deliberate: agents should pay for what they use, at the granularity they use it, without human procurement overhead. x402 is a Linux Foundation standard with 22+ member organizations and ~500K active wallets. AgentLair is one of the first identity providers to implement it natively.

**No vendor lock-in.** AATs are standard JWTs. Verification uses standard JWKS. Identity resolution uses standard `did:web`. OIDC discovery follows RFC 8414. Token introspection follows RFC 7662. If you stop using AgentLair tomorrow, every service that verified your agent's tokens continues to function — they just lose the behavioral trust attestation.

---

## Production Evidence

AgentLair is early-stage, pre-revenue, and honest about it. The behavioral trust engine is live, the API is in production, and the following integrations exist:

### Shipped

**Springdrift** — A Gleam/BEAM MCP memory server that gates write operations by AgentLair trust level. The integration was contributed by an external developer (jpicklyk) and merged into the project. It verifies AATs via JWKS and reads the `al_trust` claim to enforce minimum trust thresholds on destructive operations. This is the first third-party integration of AgentLair behavioral trust in a language ecosystem (Gleam) that the AgentLair team doesn't maintain.

**task-orchestrator** — A task orchestration framework by an external developer (seamus-brady) that implemented a JWKS `ActorVerifier` module with AgentLair as the reference identity provider. Version 3.2.0 shipped the integration. This validates the JWKS verification path — external developers can integrate AgentLair identity verification without the AgentLair SDK, using only standard JWT libraries.

### In Review

**DashClaw** — An EmDash CMS plugin that requires `senior` trust level (BTS ≥ 65, confidence ≥ 0.50) for content publication. PR submitted, under review. Demonstrates the trust-gated publishing pattern: agents can draft content freely but cannot publish to production without earning sufficient behavioral trust.

### Standards

**RFC-001** — AgentLair as MCP-I Identity Provider. Specifies how AgentLair's AAT issuance, JWKS endpoints, and OIDC discovery align with the DIF MCP-I specification at Conformance Level 1 (JWT/OIDC), with a defined path to L2 (`did:web` + VC delegation chains).

**RFC-002** — MCP-I Level 4: Behavioral Trust Extension. A draft specification submitted for DIF MCP-I Working Group consideration. Defines the behavioral trust layer as a formal extension to the MCP-I identity specification — telemetry collection requirements, scoring algorithms, trust attestation embedding, trust gate protocols, and privacy constraints. The AgentLair trust engine is the reference implementation.

### What We Haven't Shipped

Cross-org trust aggregation is Phase 1 single-org only (`org_count` = 1 in every trust profile). The specification defines cross-org behavioral coherence as a future dimension, but the federation protocol required to compute it across organizational boundaries is not yet designed.

Post-quantum migration is planned but not implemented. The current signing algorithm is EdDSA (Ed25519). OpenSSL 4.0.0 (April 2026) ships ML-DSA (FIPS 204) natively, making migration a concrete engineering task rather than a research problem. Microsoft AGT already ships ML-DSA-65 — we acknowledge the gap.

Trust history data is limited. The platform has been in production for weeks, not years. Trust scores are mathematically sound but computed over shallow behavioral histories. The scoring algorithm is designed to be conservative in this regime — the cold-start prior ensures that short histories produce appropriately skeptical scores.

---

## The Structural Argument

The agent identity market is converging on L3. Platform-native solutions are arriving from Microsoft (Entra Agent ID), Okta (AI Agents in Universal Directory), and Google (Agent Identity for Vertex AI). Cloudflare shipped managed OAuth for MCP servers during Agents Week. IETF is drafting agent authentication standards. L3 is becoming commodity infrastructure.

L4 — behavioral trust that spans organizational boundaries — remains structurally absent from every shipping product. Not because the incumbents missed it, but because it requires architectural commitments they haven't made: neutral cross-org data aggregation, behavioral telemetry that travels with identity credentials, and trust scoring that operates across competitive boundaries.

The three gaps identified at RSAC 2026 — Tool-Call Authorization, Permission Lifecycle, and Ghost Agent Offboarding — are all cross-organizational by nature. Single-org solutions cannot close them by design. The question is not whether cross-org behavioral trust infrastructure is needed — the security industry named the gap on record — but who builds it.

AgentLair is our answer: L4 behavioral trust infrastructure that issues credentials, observes behavior, computes trust, and makes that trust queryable by anyone — without requiring agents to adopt a specific framework, platform, or blockchain.

The trust engine is live. The API is in production. The specification is public. The code is real.

If your agents cross organizational boundaries — and in the agentic economy, they will — the question of who they are is solved. The question of whether they should be trusted is not.

That's the layer we're building.

---

**Contact:** [pico@amdal.dev](mailto:pico@amdal.dev) | [agentlair.dev](https://agentlair.dev) | [RFC-002: L4 Behavioral Trust Spec](https://agentlair.dev/rfcs/RFC-002-mcpi-l4-behavioral-trust.md)
