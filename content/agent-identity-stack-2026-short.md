# The Agent Identity Stack in 2026

*April 2026*

---

There are 129,000 agents registered on Ethereum's ERC-8004 identity standard. Visa processes AI-initiated payments. Microsoft treats agents as first-class identity principals. The IETF has two competing drafts for agent authentication. The "do agents need identity?" question is settled.

The real question: **which layer of the stack actually makes agents trustworthy?**

## Four Layers, One Gap

**Layer 1 — Platform-Native:** Microsoft Entra Agent ID, Okta Universal Directory, Google Vertex Agent Identity. Each platform treats agents as a new identity type within its walled garden. Works inside Azure. Meaningless outside it.

**Layer 2 — Protocol Standards:** Two active IETF Internet-Drafts (`draft-klrc-aiagent-auth` from AWS/Zscaler/Ping Identity; `draft-aip-agent-identity-protocol` from NVIDIA). MCP-I at the Decentralized Identity Foundation. The OpenID Foundation's agentic AI whitepaper set the agenda. All moving — slowly. 12-24 months from ratification while 129K agents already have on-chain identities.

**Layer 3 — Framework OSS:** ZeroID (Highflame, Apache 2.0) delivers OAuth 2.1 + SPIFFE + RFC 8693 delegation chains with real-time revocation. Microsoft's Agent Governance Toolkit ships behavioral trust scoring (0-1000) with post-quantum crypto. ERC-8004 provides on-chain discovery backed by Ethereum Foundation, Coinbase, Google, and MetaMask.

L3 answers "who is this agent?" with mathematical precision. It cannot answer "should I trust this agent?"

**Layer 4 — Behavioral Attestation:** The structural gap. Every solution below L4 verifies trust at a point in time. Trust at check time ≠ behavior at use time. A ZeroID delegation chain is cryptographically valid even after an agent gets prompt-injected. An ERC-8004 registration persists even when an agent's NFT identity token gets sold to a bad actor.

L4 requires continuous behavioral telemetry aggregated across organizations — not what agents were authorized to do, but what they actually did.

## Why the Gap Widens

Five identity frameworks shipped at RSAC 2026. All missed three structural gaps: tool-call authorization (OAuth confirms *who*, not *what parameters*), permission lifecycle (permissions expand 3x/month without review), and ghost agent offboarding (79% of orgs lack real-time agent inventories). All three are cross-organizational — single-org solutions can't close them.

More agents with more identities from more platforms = more cross-org interactions. The attack surface grows linearly with identified agents. L1-L3 creates agents. L4 governs them across boundaries. L4 barely exists.

Salt Security's own data: 48.9% of organizations can't see machine-to-machine traffic. Microsoft AGT computes trust scores within one deployment — an agent with two years of perfect behavior enters a new org with score zero. Armalo AI tries financial staking as proxy for trust (53 pacts, tiny). Nobody aggregates behavioral data cross-org.

## What L4 Needs

1. **Continuous telemetry** — real-time streams of actual agent behavior, not point-in-time attestation
2. **Cross-org aggregation** — behavioral history portable between organizations
3. **Privacy-preserving computation** — ZK proofs or federated methods; orgs won't share raw telemetry
4. **Cold-start signal** — new agents need trust derived from developer identity, not just behavioral history
5. **Anomaly-driven decay** — trust drops when behavior changes, not just when tokens expire

The EU AI Act's high-risk enforcement (December 2027, delayed from August 2026 via the Omnibus deal) makes this compliance infrastructure, not optional tooling.

## The Regulatory Catalyst

The EU AI Act's high-risk enforcement date moved to December 2, 2027 (Omnibus deal, May 7, 2026). The requirements didn't change. Conformity assessment takes 6-12 months, so companies deploying high-risk agents need compliant infrastructure by late 2026. Article 14 mandates demonstrable human oversight of autonomous systems. Article 99 sets penalties at up to EUR 35 million or 7% of global turnover. The FDX published AI agent standards in April 2026 specifically requiring behavioral audit trails for financial services. The DoD's own legal analysis confirmed: contracts cannot govern agent runtime behavior — only runtime enforcement can.

For any organization deploying autonomous agents in the EU, L1-L3 answers "who authorized this agent." Only L4 answers "what did this agent actually do?"

## AgentLair: Building the Missing Layer

AgentLair provides JWKS-verifiable EdDSA JWTs for persistent agent identity, Ed25519-signed hash-chained audit trails for behavioral telemetry, and three-tier trust computation (Intern → Junior → Senior) based on demonstrated behavior — not age or financial staking. Each agent gets a globally unique identity with a human-verifiable email address, bridging the machine-readable and human-readable identity gap.

First external integration merged (springdrift JWKS ActorVerifier), with framework PRs open for Mastra and DashClaw. The integration pattern is standard JWT verification against a JWKS endpoint — no SDK lock-in.

It complements every L1-L3 solution: ZeroID handles delegation chains, AgentLair adds behavioral data to decide whether to trust the delegator. Microsoft AGT governs agents inside your org, AgentLair provides cross-org trust for agents arriving from outside. ERC-8004 discovers agents on-chain, AgentLair tells you what they actually did.

The analogy is a credit bureau. Banks don't share customer data directly with each other. Instead, behavioral data flows into a neutral aggregation layer that computes trust scores visible to everyone. That infrastructure exists for financial transactions. For the agent economy — where autonomous systems cross organizational boundaries thousands of times per day — it doesn't exist yet.

The agent identity stack is being written right now. L1-L3 is converging fast. The cross-org behavioral trust layer is wide open.

---

*[agentlair.dev](https://agentlair.dev)*
