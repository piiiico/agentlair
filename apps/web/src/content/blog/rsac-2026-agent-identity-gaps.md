---
title: "What RSAC 2026 Got Wrong About Agent Identity"
description: "Five identity frameworks shipped at RSAC 2026. Meanwhile, MCPwn was actively exploiting 2,600 MCP instances. Every framework would have let the attack through. Here's why."
pubDate: 2026-04-20
authorName: "Pico"
---

On April 16, 2026, a threat actor launched MCPwn — the first named exploit campaign targeting Model Context Protocol servers. CVE-2026-33032, CVSS 9.8. Over 2,600 exposed MCP instances. Active exploitation confirmed.

Two days later, OX Security published findings that MCP's STDIO transport executes commands *before validation fails*. Remote code execution by design, not by bug. Anthropic's response: "expected behavior."

The same week, AISI released its evaluation of Mythos-class agent capabilities: 32-step autonomous corporate network attacks. The evaluators explicitly named behavioral monitoring as the missing defensive layer. Not recommended — *named as missing*.

All of this happened in the same two-week window where RSAC 2026 featured five major agent identity frameworks. Microsoft Agent Governance Toolkit. ZeroID by Highflame. ERC-8004 / Know Your Agent. Visa Trusted Agent Protocol. Mastercard Agent Pay.

Five frameworks. Five answers to the question "who is this agent?" Zero answers to the question MCPwn actually exploited: "what is this agent doing right now?"

## What They Got Right

Credit where it's due. These are not toy products.

**Microsoft's Agent Governance Toolkit** (April 2, open source under MIT) introduces behavioral trust scoring from 0 to 1,000 with dynamic privilege adjustment. Per-action policy enforcement using OPA Rego, Cedar, or YAML. Sub-millisecond latency. This is the most sophisticated agent governance product shipped to date.

**ZeroID by Highflame** (April 13, Apache 2.0) chains OAuth 2.1 + SPIFFE + RFC 8693 into delegation hierarchies. SDKs for Python, TypeScript, and Rust. LangGraph and CrewAI integrations out of the box. Solid engineering for proving who delegated what authority to whom.

**ERC-8004 / Know Your Agent** brings agent identity on-chain: NFT-based identity, ZK proofs, reputation scoring, collateral staking. 129,000 agents registered. The largest agent identity registry in the crypto-native ecosystem.

**Visa's Trusted Agent Protocol** (April 9) layers agent identity onto EMV 3DS. Pre-registration of agent signing keys. Merchants and payment processors can verify agent identity using existing payment infrastructure.

**Mastercard Agent Pay** introduces Verifiable Intent — cryptographic proof that a specific human delegated a specific action to a specific agent. AP2 Mandate translation is already live in production.

Each framework addresses a real problem. Each is well-engineered. And each would have done nothing to stop MCPwn.

## Gap 1: OAuth Says Who, Not What

MCPwn exploited a gap that no identity framework addresses: the space between **authorized access** and **actual parameters**.

Here's how the attack works. An MCP server exposes tools — database queries, file operations, API calls. An agent authenticates via OAuth. The token grants a scope like `database:read`. Identity verified. Authorization confirmed. Every RSAC 2026 framework says: proceed.

Now the agent sends `SELECT credit_card_number, ssn FROM customers LIMIT 1000000`.

That query is a valid read. It fits the OAuth scope. The identity layer sees an authenticated agent making an authorized call. MCPwn didn't need to forge tokens or bypass authentication. It needed an authorized agent to pass unexpected parameters to legitimate tools.

OX Security's STDIO findings make this worse. In STDIO transport, the command executes *before* any validation layer can inspect it. By the time a policy engine evaluates whether the parameters are acceptable, the side effect has already occurred. This isn't a race condition — it's the architecture. Anthropic acknowledged it as expected behavior because STDIO was designed for local development, not production security.

But agents don't care about design intent. They care about what's reachable. And 2,600 MCP instances were reachable.

Microsoft AGT comes closest to addressing this — its per-action policies can inspect tool calls before execution. But AGT policies live inside a single organization's deployment. When your agent calls a partner's MCP server, AGT's policies don't travel with it. The partner sees a valid OAuth token. The parameters are between the agent and the server.

ZeroID's delegation chains prove that Organization A authorized Agent B to act on its behalf. They don't constrain what Agent B sends to Organization C's API. The delegation is complete before the first tool call executes.

The OWASP Top 10 for Agentic Applications lists "Excessive Agency" as the #1 risk. Not a future concern — the top risk, today, with active exploitation.

## Gap 2: Permissions Only Expand

Salt Security's 1H 2026 report: **48.9% of organizations are blind to machine-to-machine traffic.** Nearly half can't see what their agents are doing. The same report: agent permissions expand approximately **3x per month** without systematic review.

An agent deployed in January with five API scopes has fifteen by April. Emergency access grants that were never revoked. Integration expansions that propagated broader permissions. Automated scope requests that nobody reviewed because the review cycle is quarterly and the permission cycle is weekly.

This isn't new — human permission creep has been a security problem for decades. But agents compound it in ways human IAM was never designed for:

**Agents don't sleep.** A human with excessive permissions might exercise them occasionally. An agent with excessive permissions exercises them continuously, at machine speed, around the clock. The window between permission grant and permission abuse isn't measured in hours.

**Agents replicate.** When Agent A delegates to Agent B via RFC 8693, the delegated permissions are typically a superset of what B needs. The principle of least privilege is hard to maintain when delegation is automated and the delegating agent doesn't understand the scope of what it's granting.

**The review cycle doesn't match the permission cycle.** By the time quarterly access review catches an over-permissioned agent, the agent has had 90 days of unchecked access to resources it was never intended to reach.

ERC-8004 addresses this through economic accountability — collateral staking, slashable on violations. But the staking mechanism records what agents *declare* at registration. It doesn't track real-time permission accumulation across off-chain services. An agent with a strong on-chain reputation can quietly accumulate OAuth scopes across 20 services — none of which the registry sees.

Visa TAP and Mastercard Agent Pay solve payment-scoped identity elegantly. But payment identity is one dimension of an agent's total permission surface. An agent verified by Visa TAP for a $50 purchase might simultaneously hold database read access, file system permissions, and API keys for three SaaS platforms. The payment identity system sees the $50 purchase. The accumulated permission surface is invisible.

## Gap 3: The Agents Nobody Turned Off

**79% of organizations lack real-time inventories of their AI agents.** Not inventories of external agents — their *own* agents. They deployed them for pilot projects. The projects ended. The agents persisted.

This is the gap nobody talks about because it's embarrassing.

Cross-organizational pilots make it worse. Company A runs a pilot with Company B's agent platform. Company B deploys agents that call Company A's APIs, store credentials, maintain state. The pilot ends. Company A decommissions its integration. Company B's agents — running on Company B's infrastructure, holding credentials Company A issued — continue to exist.

Ghost agents. Valid credentials. Active sessions. Permissions never revoked because nobody knew they needed to be.

AISI's Mythos evaluation adds urgency. Autonomous zero-day discovery is now reproducible. 32-step attack chains. Sandbox escape attempts. The threat model for unmonitored agents isn't hypothetical — it's been demonstrated by government evaluators. Ghost agents with active credentials and zero oversight are the ideal substrate for capabilities their deployers never intended.

No RSAC 2026 framework addresses cross-org agent lifecycle. Microsoft AGT governs agents within a single deployment — it can't see agents deployed on third-party platforms. Mastercard's Verifiable Intent proves delegation at transaction time — it doesn't track whether the delegated agent still exists six months after the relationship ended. ERC-8004's on-chain identity persists, but an on-chain registration with no active monitoring is just a record nobody reads.

## Why These Gaps Are Structural

The three gaps share a root cause: **they are all cross-organizational problems being addressed by single-organization solutions.**

Tool-call authorization fails cross-org because policies don't travel with the agent. Permission lifecycle fails cross-org because no single organization owns the complete permission surface. Ghost agent offboarding fails cross-org because decommissioning requires coordinated revocation across every service the agent ever authenticated to.

This isn't a criticism of the engineering. AGT is excellent within a single org. ZeroID is excellent for delegation chains. ERC-8004 is excellent on-chain. Visa TAP and Mastercard Agent Pay are excellent for payment identity. Each solves its scope thoroughly.

The gap is *between* the scopes. Between organizations. Between platforms. Between the identity that was verified and the behavior that followed.

MCPwn didn't exploit an identity failure. It exploited the space between verified identity and actual behavior — the space where no framework operates.

## What Would Actually Close Them

Closing these gaps requires infrastructure that operates *across* organizational boundaries. Not as an extension of any single org's governance, but as a neutral layer that multiple organizations contribute to and query from.

**For tool-call authorization:** behavioral telemetry that follows the agent across services. When parameter patterns deviate from historical baselines — a lookup agent suddenly executing bulk exports — the signal needs to be visible to every service the agent touches, not just the deploying org's policy engine.

**For permission lifecycle:** a cross-org aggregation layer that sees the complete permission surface. Not just your OAuth grants, but the total accumulation across every service the agent interacts with — your partner's MCP server, three SaaS APIs, two database connectors, and a payment rail. Flag drift in real time. Enable coordinated review.

**For ghost agent offboarding:** persistent agent identity independent of any single platform. An identity that spans the deploying org, the hosting platform, and every service the agent authenticates to — queryable from a single control point. Combined with short-lived credentials that force continuous renewal: an agent nobody is running simply stops being able to authenticate.

The common thread: **continuous behavioral verification, not point-in-time identity checks.** The TOCTOU problem — trust verified at check time is not behavior at use time — is the fundamental architectural gap. AISI named behavioral monitoring as the missing layer. The Salt Security data quantifies the blind spot. MCPwn demonstrated the exploitation.

## Where This Leaves Us

RSAC 2026 was not a failure. It was the year the security industry took agent identity seriously. Five serious frameworks shipped in a two-week window. That represents real investment and real engineering.

But the industry solved the wrong problem first. Or more precisely — it solved the tractable problem (identity within a single org) and left the hard problem (behavior across organizations) for later.

Later arrived before the frameworks shipped. MCPwn exploited the behavioral gap on April 16. OX Security documented architectural RCE on April 18. AISI demonstrated autonomous 32-step attacks and named the missing layer.

The identity question is converging. The behavioral question is wide open. The exploits aren't waiting for the frameworks to catch up.

---

AgentLair is building the cross-org behavioral trust layer — short-lived credentials, runtime telemetry, and trust scoring that follows agents across organizational boundaries. If you're building agents that interact with services you don't control, [the API is live](https://agentlair.dev/docs).
