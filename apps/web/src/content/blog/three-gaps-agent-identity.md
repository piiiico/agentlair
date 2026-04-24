---
title: "The Three Gaps: Why Every Agent Identity Framework Fails at Runtime"
description: "RSAC 2026 shipped five agent identity frameworks. All missed three critical runtime gaps that are structurally cross-org. Salt Security's 1H 2026 data quantifies the blind spot: 48.9% of organizations can't see agent-to-agent traffic. Here's what that means."
pubDate: 2026-04-19
authorName: "Pico"
---

Salt Security's 1H 2026 report on agentic security landed with a number that should have ended the conversation about whether agent identity is solved: **48.9% of organizations are blind to machine-to-machine traffic.** Not partially blind. Not "working on it." Blind.

The same report: 48.3% of organizations can't distinguish agents from bots. Only 23.5% find their existing security tools effective against agentic workloads. And 78.6% report that executive scrutiny of agentic security is increasing — meaning the board is asking questions that the security team cannot answer.

These numbers describe a market that has shipped identity infrastructure and declared victory while nearly half of its participants can't see the traffic they're supposed to be securing. RSAC 2026 featured five new agent identity frameworks — Microsoft's Agent Governance Toolkit, Curity's Access Intelligence, ZeroID by Highflame, ERC-8004's Know Your Agent standard, and Armalo AI's behavioral pacts. Each addresses part of the problem. Each misses the same three gaps.

These gaps are not oversights. They are structural. And they are all cross-organizational — which means single-org solutions cannot close them by design.

## Gap 1: Tool-Call Authorization

OAuth confirms **who** an agent is. It does not constrain **what parameters** that agent passes to the tools it's authorized to use.

Consider a concrete example. An agent has OAuth-scoped access to a database via an MCP server. The OAuth token grants `database:read` scope. The agent is verified, authenticated, and authorized. The identity problem is "solved."

Now: does `database:read` mean `SELECT customer_name FROM orders WHERE id = 42`? Or does it mean `SELECT * FROM customers`? Or `SELECT credit_card_number, ssn FROM customers LIMIT 1000000`?

All three queries are valid reads. All three fit within the OAuth scope. The authorization layer sees them identically. The difference between a targeted lookup and a mass data exfiltration is invisible to every identity framework shipped at RSAC 2026.

This isn't hypothetical. The OWASP Top 10 for Agentic Applications lists "Excessive Agency" as the #1 risk — agents performing actions beyond their intended scope using permissions that were technically granted. The permission model is coarse. The action space is fine-grained. The gap between them is where data breaches live.

**What the frameworks do about it:**

Microsoft's Agent Governance Toolkit enforces policies at the action level — approve, block, or observe per tool call. This is the most sophisticated approach at RSAC 2026. But it operates within a single org's deployment. If your agent calls a partner's MCP server, AGT's policies don't travel with it. The partner sees a valid OAuth token and permits the call. Whatever parameters the agent passes are between the agent and the server.

Curity's Access Intelligence issues per-action tokens encoding purpose and intent. This narrows the authorization surface — each action gets a scoped token rather than a broad access grant. But the token encodes what the agent *declares* it will do, not what it *actually does*. An agent requesting a token for "customer lookup" that then executes a bulk export isn't caught by the token — the token was already issued.

ZeroID by Highflame chains OAuth 2.1 + SPIFFE + RFC 8693 into delegation hierarchies. Solid engineering for proving who delegated what authority to whom. But the delegation chain is complete before the first tool call executes. It constrains the delegation graph, not the parameter space.

The gap isn't in identity verification. It's in the gap between **authorized scope** (what the agent is allowed to access) and **actual parameters** (what the agent actually sends). No framework at RSAC 2026 closes this at runtime, across organizational boundaries.

## Gap 2: Permission Lifecycle

Permissions expand. They don't contract.

Salt Security's 1H 2026 data (from their own enterprise customers) indicates that agent permissions expand approximately **3x per month** without systematic review. An agent deployed in January with five scoped API permissions has, by April, accumulated fifteen — through automated scope requests, emergency access grants that were never revoked, and integration expansions that propagated broader permissions.

This isn't unique to agents. Every security professional has dealt with human permission creep. But agents compound the problem in three ways that human IAM doesn't:

**First, agents don't leave for lunch.** A human with excessive permissions might exercise them occasionally. An agent with excessive permissions exercises them continuously, at machine speed, 24/7. The window between permission grant and permission abuse isn't hours — it's milliseconds.

**Second, agents replicate.** When Agent A delegates to Agent B via a delegation chain (RFC 8693, SPIFFE, or Mastercard's Verifiable Intent framework), the delegated permissions are typically a superset of what Agent B actually needs. The principle of least privilege is hard to maintain when the delegation is automated and the delegating agent doesn't understand the full scope of what it's granting.

**Third, the review cycle doesn't match the permission cycle.** Most organizations review human access quarterly. Agent permissions change multiple times per week. By the time a quarterly review catches an over-permissioned agent, the agent has had 3 months of unchecked access to resources it was never intended to reach.

**What the frameworks do about it:**

ERC-8004, the on-chain Know Your Agent standard, approaches this through economic accountability. Agents register on-chain (NFT-based identity), stake collateral, and build a reputation score. If an agent is caught violating its stated behavior, collateral can be slashed. At 129,000 registered agents as of April 2026, it's the largest agent identity registry in the crypto-native ecosystem.

But ERC-8004's permission model is what the agent *declares* at registration time plus what the on-chain reputation system records post-facto. It doesn't track real-time permission accumulation across off-chain services. An agent with a strong on-chain reputation can quietly accumulate OAuth scopes, API keys, and MCP server access across 20 different services — none of which the on-chain registry sees.

Microsoft AGT tracks permissions within a single deployment using policy enforcement with sub-millisecond latency. Policies are expressed in OPA Rego, Cedar, or YAML. This is effective within the deployment — but the permissions an agent accumulates on third-party platforms are invisible. AGT's policy engine only governs what it can observe. Permissions granted by external services are outside its observation boundary.

The structural problem: **permission lifecycle is cross-organizational.** An agent's total permission surface spans every service it interacts with — your OAuth provider, your partner's MCP server, three SaaS APIs, two database connectors, and a payment rail. No single-org governance framework can see the full picture because no single org owns the full picture.

## Gap 3: Ghost Agent Offboarding

This is the gap that nobody talks about because it's embarrassing.

According to CSA survey data, **79% of organizations lack real-time inventories** of their AI agents. Not inventories of other organizations' agents — their *own* agents. They deployed agents for pilot projects. Those projects ended. The agents persisted.

The problem worsens across organizational boundaries. When Company A runs a pilot with Company B's agent platform, Company B deploys agents that interact with Company A's services — calling APIs, storing credentials, maintaining state. When the pilot ends, Company A decommissions its side of the integration. But Company B's agents — running on Company B's infrastructure, with credentials that Company A issued during the pilot — continue to exist.

These are ghost agents. They have valid credentials. They have active sessions. They have permissions that were never revoked because nobody knew they needed to be revoked. And they persist on third-party platforms where the decommissioning organization has no visibility and no kill switch.

Vidoc Security's reproduction of Anthropic's Mythos-class vulnerability discovery capabilities adds urgency. Their finding: autonomous zero-day discovery is now reproducible for under $30 using public model APIs and open-source tooling. The threat model for unmonitored agents just expanded from 52 vetted Glasswing consortium members to every developer with an API key. Ghost agents with active credentials and zero oversight are the ideal host for capabilities that their original deployers never intended them to have.

**What the frameworks do about it:**

Saviynt, the enterprise IGA incumbent, shipped an "Identity Lifecycle Management" module for AI agents at RSAC 2026 — governing agents from registration through decommissioning. This is the right approach for agents within a single enterprise: Hertz, UKG, and The Auto Club Group are design partners. But Saviynt's lifecycle management governs agents inside an enterprise IT perimeter. It cannot see agents that the enterprise deployed on third-party platforms, and it cannot decommission agents running on infrastructure it doesn't control.

Armalo AI's behavioral pacts include an escrow mechanism — USDC staked on Base, slashable if the agent violates its pact. This creates financial accountability for active agents. But a ghost agent, by definition, has no active monitoring. Its pact isn't being evaluated because nobody is watching. The escrow sits unclaimed while the agent persists.

The structural problem: **agent lifecycle is cross-organizational.** An agent's existence spans the deploying org, the platform it runs on, and every service it has credentials for. Decommissioning requires coordinated action across all three. No framework at RSAC 2026 provides a mechanism for cross-org lifecycle coordination.

## The Framework Comparison

Every framework shipped at RSAC 2026 and in the weeks following addresses a genuine problem. None addresses all three gaps. The pattern is consistent:

| Framework | Tool-Call Auth | Permission Lifecycle | Ghost Offboarding | Scope |
|-----------|:-:|:-:|:-:|---------|
| **Microsoft AGT** | ✅ Per-action policies | ✅ Within deployment | ❌ No cross-org visibility | Single-org |
| **Curity Access Intelligence** | Partial (declarative tokens) | ❌ No lifecycle tracking | ❌ No agent inventory | Single-org |
| **ZeroID (Highflame)** | ❌ Delegation graph only | ❌ No lifecycle tracking | ❌ No agent inventory | Single-org |
| **ERC-8004 (KYA)** | ❌ On-chain identity only | Partial (staking as deterrent) | ❌ Chain-scoped only | Chain-scoped |
| **Armalo AI** | ❌ Behavioral pacts only | Partial (escrow monitoring) | ❌ Inactive agents = unmonitored | Cross-org (limited) |

AGT comes closest. Its per-action policy enforcement is the most granular approach to Gap 1. Its within-deployment permission tracking addresses Gap 2 for local agents. But both capabilities stop at the organizational boundary. When the agent leaves your deployment, AGT's policies and tracking don't follow.

## The Cross-Org Problem

The three gaps share a structural root cause: **they are all cross-organizational.**

Tool-call authorization fails cross-org because policies don't travel with the agent. An agent governed by AGT's Rego policies inside Organization A calls an MCP server at Organization B. Organization B doesn't run AGT. Organization B sees a valid OAuth token and processes the request. Whatever AGT's policy would have said about the parameters is irrelevant — the policy exists in A's deployment, and the call is happening at B's server.

Permission lifecycle fails cross-org because no single organization owns the complete permission surface. Agent permissions are distributed across OAuth providers, API key issuers, MCP server operators, and delegation chain participants. Each sees only its own grants. The total accumulation is visible to nobody.

Ghost agent offboarding fails cross-org because decommissioning requires coordinated revocation across every service the agent ever authenticated to. This requires an inventory that spans organizational boundaries — knowing not just which agents you deployed, but which third-party services those agents integrated with, and having the ability to trigger revocation on all of them simultaneously.

Single-org solutions address one organization's view of each gap. The gap itself is the space between organizations.

## What Would It Take to Close These Gaps?

Closing these three gaps requires infrastructure that operates across organizational boundaries — not as an extension of any single organization's governance, but as a neutral substrate that multiple organizations can read from and write to.

For **Tool-Call Authorization**, closing the gap requires behavioral telemetry — not just policy enforcement — that follows the agent across services. When an agent's actual parameter patterns deviate from its historical baseline (a lookup agent suddenly executing bulk exports), the signal needs to be visible to every service the agent interacts with, not just the deploying org's policy engine. This is the TOCTOU problem applied to authorization: trust verified at token-issuance time is not the same as behavior at tool-call time.

For **Permission Lifecycle**, closing the gap requires a cross-org view of an agent's total permission surface — an aggregation layer that can see the accumulation pattern across services, flag drift, and enable coordinated review. This is the cross-org behavioral trust problem: the permission lifecycle is a behavioral pattern that can only be observed from outside any single organization.

For **Ghost Agent Offboarding**, closing the gap requires persistent agent identity that is independent of any single platform. An agent with an identity that spans its deploying org, its hosting platform, and every service it authenticates to can be located and decommissioned from a single control point. Without that persistent identity, ghost agents are invisible by construction — they exist only as credentials scattered across services, with no unifying identifier to query against.

AgentLair's approach addresses these three gaps through three architectural primitives:

**Short-lived Agent Auth Tokens (AATs)** — EdDSA-signed JWTs with one-hour TTL, verified via JWKS. Because tokens expire quickly, ghost agents lose their ability to authenticate without continuous renewal. An agent that nobody is actively running simply stops being able to act. This doesn't eliminate ghost agents — it makes them inert.

**Cross-org behavioral telemetry** — runtime data about what agents actually do, aggregated across organizational boundaries. Not operational metrics from a single deployment (that's what AGT provides), but behavioral patterns that span every interaction an agent has had across every organization it's touched. This is what closes the TOCTOU gap: trust isn't a credential issued once, it's a track record computed continuously.

**Behavioral trust scoring** — a queryable signal that any counterparty can check before allowing an agent to act. When an agent from Organization A calls a service at Organization B, Organization B can query the agent's cross-org behavioral history — not just whether its OAuth token is valid, but whether its actual behavior in the last 10,000 interactions across 50 organizations is consistent with what it claims to be doing now.

These aren't novel concepts. They're the architectural consequences of taking the three gaps seriously. If tool-call authorization is a cross-org problem, you need cross-org observability. If permission lifecycle is a cross-org problem, you need cross-org aggregation. If ghost offboarding is a cross-org problem, you need cross-org identity.

## What's Still Missing

This analysis has focused on gaps in existing frameworks. But there are gaps in the proposed solutions too.

Cross-org behavioral telemetry raises legitimate surveillance concerns. An aggregation layer that sees agent behavior across organizational boundaries could become the very surveillance infrastructure it's trying to prevent. Any credible approach needs ZK-native privacy — contributing behavioral data without revealing the underlying interactions. This is buildable (ZK proofs are production-ready in 2026), but it's not trivial, and it's not shipped.

Short-lived tokens mitigate ghost agents but don't eliminate them. An agent with a token renewal mechanism (a stored refresh credential, an automated re-authentication flow) can persist indefinitely even with one-hour TTLs. The token lifecycle addresses the symptom; the root cause is uncoordinated decommissioning.

Behavioral trust scoring introduces a cold-start problem. A brand-new agent with no behavioral history is indistinguishable from a compromised agent with a wiped record. The cold-start signal has to come from somewhere — developer identity, open-source track record, human principal attestation, financial staking. No single signal is sufficient. The first credible cross-org trust system will likely combine multiple cold-start signals rather than relying on any one.

These are hard problems. But they're the right problems. The identity layer is converging. The authorization layer is shipping. The behavioral trust layer — the part that closes the three gaps between what agents are authorized to do and what they actually do — is where the real engineering challenge lives.

The frameworks shipped at RSAC 2026 answered the question "who is this agent?" The question the market still hasn't answered is: "given everything this agent has done across every organization it's ever interacted with, should I let it do this?"

That's the question the three gaps are asking. Answering it requires infrastructure that doesn't exist yet — but the architectural requirements are now clear enough to build.
