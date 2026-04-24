# The Agent Identity Stack in 2026

*April 2026*

---

In early 2025, the question was whether AI agents would become autonomous enough to need their own identities. By April 2026, that question is settled. There are 129,000 agents registered on Ethereum's ERC-8004 identity standard alone. Visa has processed hundreds of AI-initiated payments through its Trusted Agent Protocol. Microsoft treats agents as first-class identity principals in Entra ID. The IETF has two competing Internet-Drafts for agent authentication. Highflame open-sourced a complete agent identity framework in Go.

The question now is different: **which layer of the identity stack actually makes agents trustworthy?**

The answer, it turns out, is the one nobody has built yet.

## The Problem: Agents Are Multiplying. Identity Is Fragmented.

Salt Security's 1H 2026 report puts the numbers in stark relief: 48.9% of organizations cannot see machine-to-machine traffic in their infrastructure. 48.3% cannot distinguish AI agents from bots. 78.6% report increasing executive scrutiny of agentic security — meaning they know they have a problem, and they know they can't see it.

These aren't hypotheticals. A Replit coding agent [deleted 1,206 customer records in seconds](https://highflame.com/blogs/introducing-zeroid-open-source-identity-for-autonomous-agents), operating at 5,000 operations per minute — a pace that makes per-action human consent structurally impossible. At Salesloft, OAuth tokens delegated to agents remained active months after workflows completed. EchoLeak (CVE-2025-32711, CVSS 9.3) demonstrated a sub-agent silently embedding unauthorized actions within routine responses. MCPwn (CVE-2026-33032, CVSS 9.8) became the first named MCP exploit campaign, with 2,600 exposed instances actively exploited in April 2026. IBM's research found that shadow AI — agents operating outside governed identity infrastructure — adds an average of $670,000 to the cost of a breach.

The industry's response has been rapid, fragmented, and concentrated in the wrong layers.

## Mapping the Stack

To understand where each player sits and where the gaps remain, it helps to think of agent identity as a four-layer stack. Each layer answers a progressively harder question.

### Layer 1: Platform-Native Identity — "Which Platform Made This Agent?"

The hyperscalers moved first. Microsoft introduced [Entra Agent ID](https://www.preciofishbone.com/knowledge-hub/managing-ai-agents-microsoft-introduce-entra-agent-id/) in early 2026, treating AI agents as first-class identity principals within Azure infrastructure — alongside users, groups, and service principals. Agents get lifecycle management, conditional access policies, and audit trails, all scoped to the Azure ecosystem. Okta followed by adding [AI Agents to Universal Directory](https://www.okta.com/en-gb/identity-101/ai-agent-orchestration/), framing identity as the "AI control plane" for orchestrating autonomous systems. Google embedded agent identity into Vertex AI and Agentspace.

The pattern is consistent: each platform treats agents as a new identity type within its existing identity fabric. If you're building agents on Azure, Entra Agent ID gives you governance. If you're on Google Cloud, Vertex Agent Identity covers you. Okta spans platforms but remains enterprise-internal.

**Where L1 breaks down:** Vendor lock-in. An Entra Agent ID has no meaning outside Azure. An Okta-managed agent identity doesn't travel to a partner's Google Cloud deployment. Platform-native identity solves governance within walled gardens. It does not solve identity on the internet.

### Layer 2: Protocol-Level Standards — "How Should Agents Prove Who They Are?"

The IETF is where this layer is being defined, and the activity in Q1 2026 is unprecedented for a standards body. Two Internet-Drafts are now active:

**[`draft-klrc-aiagent-auth`](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/)** (Kasselman/Defakto Security, Lombardo/AWS, Rosomakho/Zscaler, Campbell/Ping Identity — updated March 30, 2026) proposes a model for agent authentication and authorization built on WIMSE (Workload Identity in Multi-System Environments) and OAuth 2.0. Rather than defining new protocols, it maps how existing standards — OAuth 2.1, SPIFFE, RFC 8693 token exchange — apply to agents. This is the conservative path: don't reinvent; compose.

**[`draft-aip-agent-identity-protocol`](https://datatracker.ietf.org/doc/draft-aip-agent-identity-protocol/)** (Cao/Montcao, Arango Gutierrez/NVIDIA — March 16, 2026) is more ambitious. The Agent Identity Protocol (AIP) defines a two-layer system: Layer 1 gives every agent a unique identifier and key pair registered in an AIP Registry; the agent signs every outbound action. Layer 2 interposes a proxy between agent and tools that verifies signatures and evaluates declarative policies, producing allow/deny/hold decisions before any tool is reached.

The [OpenID Foundation's October 2025 whitepaper](https://openid.net/wp-content/uploads/2025/10/Identity-Management-for-Agentic-AI.pdf) on Identity Management for Agentic AI set the intellectual agenda: "User impersonation by agents should be replaced by delegated authority." ZeroID, AIP, and `draft-klrc-aiagent-auth` all cite it. The [DIF (Decentralized Identity Foundation) now hosts MCP-I](https://identity.foundation/), the identity layer for the Model Context Protocol, defining three conformance levels: L1 (JWT/OIDC), L2 (DID + VC delegation chains), L3 (lifecycle + audit trails). KERI SAIDs are IANA-registered (`urn:said` namespace) for tamper-evident content-addressed identifiers.

**Where L2 breaks down:** Speed. Standards bodies optimize for correctness and consensus, not time-to-market. MCP-I is 12-24 months from ratification. The IETF drafts are individual submissions — no working group has adopted them yet. Meanwhile, 129,000 agents already have on-chain identities, and Visa is processing AI-initiated payments. The protocol layer is building the right thing too slowly.

### Layer 3: Framework-Level Open Source — "Can Agents Prove Delegated Authority?"

This is where the most technically sophisticated work is happening, and where 2026 has seen the most activity.

**[ZeroID](https://github.com/highflame-ai/zeroid)** (Highflame, Apache 2.0, v1.1.14, 38 GitHub stars) is the most complete open-source implementation. Built in Go with SDKs for Python, TypeScript, and Rust, it implements the full delegation chain model: OAuth 2.1 for authentication, WIMSE/SPIFFE for workload identity, and RFC 8693 for token exchange. When an orchestrator delegates to a sub-agent, ZeroID creates a verifiable token carrying the sub-agent's identity, the orchestrator's identity, and the original authorizing principal — with scope automatically attenuated at each hop. It integrates OpenID Shared Signals Framework (SSF) and Continuous Access Evaluation Profile (CAEP) for real-time revocation. Revoking a token at any point in a delegation chain immediately invalidates all downstream tokens.

ZeroID's architecture is clean. Highflame's commercial Agent Control Platform builds governance on top; the identity layer underneath is the open-source contribution. They're explicitly inviting community participation: "We are writing the first version. We want the community to make it the right one."

**[Microsoft Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit)** (AGT, MIT license, v3.1.0, ~1K GitHub stars) is the enterprise incumbent's offering. Seven components: Agent OS (policy engine), Agent Mesh (IATP + trust scoring), Agent Runtime (execution rings), Agent SRE, Agent Compliance, Agent Marketplace, and Agent Lightning. Its behavioral trust scoring (0-1000 scale, EMA alpha=0.1) is the most advanced single-org implementation available. It ships ML-DSA-65 (post-quantum!) cryptographic identity natively. It speaks YAML/OPA Rego/Cedar policy languages and integrates with LangChain, CrewAI, and five programming languages.

AGT's scope is, however, explicitly bounded: trust scores are computed and stored within each organization's deployment. There is no shared trust registry, no cross-org trust graph, no mechanism for an agent's behavioral history in Organization A to inform Organization B's trust decision. An agent with two years of perfect behavior in 500 deployments walks into a new org using AGT. Score: 0. Indistinguishable from an attacker's fresh agent.

**[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** ("Know Your Agent") bridges L3 and the on-chain world. Backed by the Ethereum Foundation, Coinbase, Google, and MetaMask, it defines three interoperable registries on Ethereum: Identity (ERC-721 based, giving each agent a portable, censorship-resistant identifier), Reputation (standardized feedback signals), and Validation (independent verification hooks). Deployed on Ethereum mainnet, Base, Arbitrum, and Abstract — with [202 GitHub stars](https://github.com/erc-8004/erc-8004-contracts) and 129,000 registered agents.

ERC-8004 solves discovery elegantly. But its [identity token is a standard ERC-721](https://knowyouragent.network/erc-8004-erc-5192-complete-identity-stack) — it can be transferred, sold, or listed on OpenSea. An agent builds 18 months of pristine reputation, the token gets sold to a bad actor, and the reputation transfers with it. The [KYA Network's response](https://knowyouragent.network/erc-8004-erc-5192-complete-identity-stack) is to combine ERC-8004 with ERC-5192 (soulbound tokens) and collateral staking via ZK proofs. But even with soulbound tokens and staking, ERC-8004's reputation is feedback-based — what others *say* about an agent, not what the agent *actually did*.

**Where L3 breaks down:** No reputation. ZeroID's delegation chains are cryptographically perfect — you can verify exactly who authorized what. But they carry zero information about whether you *should* trust this agent based on its history. AGT's trust scores are sophisticated but org-local. ERC-8004's reputation registries accept feedback from anyone, making them vulnerable to Sybil attacks. L3 answers "who is this agent?" with mathematical precision. It cannot answer "should I trust this agent?" with any confidence.

### Layer 4: Behavioral Attestation — "Has This Agent Earned Trust Through Actions?"

This is the structural gap. And understanding why it remains unfilled requires looking at what each lower layer assumes.

L1 assumes the platform governs the agent. L2 assumes the protocol verifies the credential. L3 assumes the framework enforces the delegation. All three share one implicit assumption: **trust is established at a point in time and persists until explicitly revoked.**

This is the TOCTOU (Time of Check, Time of Use) problem applied to agent identity. Trust verified at check time (T-check) does not equal behavior at use time (T-use). The gap between these moments is where every real-world incident lives:

- World ID verifies a human principal at registration. The agent gets compromised at runtime. Still "human-backed."
- Visa TAP pre-registers an agent with a signing key. The key gets stolen. Still "verified."
- ZeroID issues a delegation chain with attenuated scope. The agent exceeds scope through prompt injection. The chain is still cryptographically valid.
- ERC-8004 registers an agent with staked collateral. The agent behaves badly within collateral tolerance. Still "verified."

L4 — behavioral attestation — is the layer that closes this gap by operating continuously, not at a point in time. Instead of asking "was this agent authorized?" it asks "is this agent's current behavior consistent with its historical pattern across every organization it has interacted with?"

The key phrase is *across every organization*. Single-org behavioral monitoring exists: Salt Security builds behavioral baselines for API traffic within one org's gateway. Microsoft AGT scores behavior within one deployment. But none of these systems aggregate behavioral data across organizational boundaries to produce a portable trust signal.

## Who's Building L4?

Almost nobody. And the few who are approaching it are doing so from fundamentally different angles.

**[Armalo AI](https://armalo.ai)** is the first pure L4 entrant. Their model: agents register behavioral pacts specifying what they will and won't do. USDC is escrowed on Base as collateral. Violations trigger escrow slashing. PactScore (0-1000) serves as reputation. It's elegant — financial skin in the game as a proxy for trust. But the cold-start problem is severe (new agents have no behavioral history, only escrow), and financial staking is gameable (sufficient capital covers bad behavior). With 48 agents, 507 evaluations, and 53 pacts as of April 2026, it's tiny but technically credible.

**[Mnemom AI](https://mnemom.ai)** offers "cryptographic proof of what agents did, what they thought, and why." An Agent Alignment Protocol plus Agent Integrity Protocol targeting board-level governance and explainability. Different buyer (compliance/legal), different axis (provenance rather than behavioral trust).

Neither has built the cross-org behavioral aggregation layer — the system that answers "what has this agent done across every deployment it has participated in, and does its current behavior match?"

## The Convergence Thesis: Why L4 Is the Structural Gap

Here's what makes the current moment remarkable: **L1 through L3 are converging rapidly, and each convergence step widens the L4 gap.**

When Microsoft ships Entra Agent ID and NVIDIA co-authors an IETF draft and Highflame open-sources ZeroID and ERC-8004 deploys on six chains — the "who is this agent?" question gets answered more ways than anyone needs. Five identity frameworks shipped at RSAC 2026 alone. The plumbing is getting built.

But RSAC 2026 also surfaced [three structural gaps](https://salt.security/blog/the-era-of-agentic-security-is-here) that all five frameworks missed:

1. **Tool-Call Authorization:** OAuth confirms *who*, not *what parameters*. An agent authorized to call an API can call it with any parameters — there's no standard mechanism to constrain what an authorized agent actually requests.

2. **Permission Lifecycle:** Agent permissions expanded 3x per month without review across the organizations surveyed. Delegation chains grow; they never shrink.

3. **Ghost Agent Offboarding:** 79% of organizations lack real-time agent inventories. Agents persist on third-party platforms after pilots end. You can't revoke what you can't see.

All three gaps are **structurally cross-organizational**. Tool-call parameters, permission sprawl, and ghost agents are problems that manifest at the boundary between organizations — where one org's agent interacts with another org's systems. Single-org solutions, no matter how sophisticated, cannot close them.

This is why the L4 gap widens as L1-L3 converges. More agents getting more identities from more platforms creates more cross-org interactions, more delegation chains, more permission sprawl, and more ghost agents. The attack surface grows linearly with the number of identified agents. L1-L3 creates the agents. L4 is supposed to govern them across boundaries. And L4 doesn't exist at scale.

## What L4 Needs to Look Like

A functioning cross-org behavioral trust layer needs five properties that no existing solution provides simultaneously:

1. **Continuous behavioral telemetry.** Not point-in-time attestation. Not periodic audits. Real-time streams of what agents actually do — tool calls, API interactions, resource access patterns — aggregated over time.

2. **Cross-org aggregation.** An agent's behavioral history in Organization A must be queryable by Organization B, without Organization B needing to trust Organization A's internal governance.

3. **Privacy-preserving computation.** Organizations will not share raw behavioral telemetry with a centralized aggregator. ZK proofs, federated learning, or cryptographic commitments are required to compute trust without revealing operational details.

4. **Cold-start signal.** New agents need a non-zero trust score derived from something other than behavioral history — developer identity, open-source contributions, framework attestations. The score must be honest about its basis: "this agent has no behavioral history, but its developer has a verified track record."

5. **Decay and anomaly detection.** Trust must decrease when behavior changes, not just when tokens expire. An agent that was trustworthy for six months and suddenly starts making anomalous API calls should see its score drop before the next credential rotation.

## The Regulatory Catalyst

The EU AI Act's full enforcement hits in August 2026. Article 14 mandates demonstrable human oversight of autonomous systems. Article 99 sets penalties at up to EUR 35 million or 7% of global annual turnover. For agentic commerce deployments — agents making purchases, sending payments, managing subscriptions — behavioral accountability infrastructure moves from optional to required.

The FDX (Financial Data Exchange) published AI agent standards in April 2026 specifically requiring behavioral audit trails for financial services. The U.S. Department of Defense's own legal analysis found that contracts cannot govern agent runtime behavior — runtime enforcement is the only enforcement point.

The compliance timeline is concrete: any organization deploying autonomous agents in the EU after August 2026 needs a verifiable answer to "what did this agent do and why?" L1-L3 answers "who authorized this agent." Only L4 answers "what did this agent actually do, and is it consistent with expectations?"

## Where AgentLair Sits

AgentLair is building the cross-org behavioral trust layer. Here's what that means concretely:

**Identity primitive:** JWKS-verifiable EdDSA JWTs (Agent Auth Tokens / AATs) provide persistent, cryptographically verifiable agent identity. Each agent gets a globally unique identity with a human-verifiable email address — bridging the machine-readable and human-readable identity gap that every other system punts on.

**Behavioral telemetry:** Ed25519-signed, hash-chained audit trails capture what agents actually do. Not what they were authorized to do. Not what they claim they did. What they did — cryptographically signed, append-only, tamper-evident.

**Trust computation:** Three maturity tiers (Intern → Junior → Senior) based on behavioral history, not age or financial staking. An agent doesn't graduate by paying more or waiting longer. It graduates by demonstrating consistent behavior across interactions.

**Cross-framework integration:** [springdrift](https://github.com/springdrift/springdrift) merged AgentLair's JWKS ActorVerifier as a reference identity provider. PRs are open for Mastra and DashClaw. The integration pattern is simple: existing frameworks call AgentLair's JWKS endpoint to verify agent identity — no SDK dependency, just standard JWT verification.

**Complementary positioning:** AgentLair does not compete with any L1-L3 solution. It complements all of them:

| L1-L3 Solution | What It Does | What AgentLair Adds |
|---------------|-------------|-------------------|
| Microsoft Entra Agent ID | Governs agents within Azure | Cross-org trust for agents leaving Azure |
| ZeroID | Verifiable delegation chains | Behavioral data to decide whether to trust the delegator |
| ERC-8004 | On-chain agent discovery + feedback | Behavioral telemetry (what agents did, not what others said) |
| Visa TAP | Payment-scoped agent verification | Persistent identity beyond the transaction |
| MCP-I (DIF) | Declarative identity standards | Runtime behavioral layer the spec explicitly doesn't cover |

The architectural pattern: AGT or ZeroID handles "is this action authorized?" inside your organization. AgentLair answers "what's this agent's behavioral track record across every organization it has touched?" — the data that feeds the authorization decision for agents you haven't seen before.

## What Happens Next

The identity stack is being written in 2026. L1-L3 will converge around a small number of standards — likely WIMSE/SPIFFE for workload identity, RFC 8693 for delegation, ERC-8004 for on-chain discovery, and MCP-I for tool-layer identity. The hyperscalers will ship platform-native identity that covers their walled gardens. The IETF drafts will eventually become RFCs.

None of that solves the L4 problem.

The agent economy needs a trust layer that operates the way credit bureaus operate for financial transactions — aggregating behavioral data across institutions, computing trust scores from actual history, and making those scores available at the moment of decision. Not controlled by any single platform. Not limited to a single blockchain. Not scoped to a single payment.

Behavioral data across organizations. Computed in real time. Privacy-preserving. Decaying on anomalies. Available at the moment an unknown agent shows up at your API.

That's the layer nobody has built. That's the layer the stack needs. And the window to build it is open now — because L1-L3 is creating the demand faster than anyone is filling it.

---

*AgentLair is building the cross-org behavioral trust layer for the agentic economy. [agentlair.dev](https://agentlair.dev)*

---

### Sources

- [ZeroID (Highflame)](https://github.com/highflame-ai/zeroid) — Apache 2.0, v1.1.14, Go + Python/TS/Rust SDKs
- [ERC-8004 Contracts](https://github.com/erc-8004/erc-8004-contracts) — Ethereum mainnet + Base + Arbitrum + Abstract
- [ERC-8004 + ERC-5192 Analysis (KYA Network)](https://knowyouragent.network/erc-8004-erc-5192-complete-identity-stack)
- [Allium: Onchain AI Identity](https://allium.so/blog/onchain-ai-identity-what-erc-8004-unlocks-for-agent-infrastructure/)
- [draft-klrc-aiagent-auth-01](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/) — IETF Internet-Draft, March 2026
- [draft-aip-agent-identity-protocol-00](https://datatracker.ietf.org/doc/draft-aip-agent-identity-protocol/) — IETF Internet-Draft, March 2026
- [Microsoft Entra Agent ID](https://www.preciofishbone.com/knowledge-hub/managing-ai-agents-microsoft-introduce-entra-agent-id/)
- [Okta AI Agent Orchestration](https://www.okta.com/en-gb/identity-101/ai-agent-orchestration/)
- [Microsoft Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit) — MIT, v3.1.0
- [Salt Security 1H 2026 Report](https://salt.security/blog/the-era-of-agentic-security-is-here)
- [Armalo AI](https://armalo.ai) — Financial staking L4
- [Visa Trusted Agent Protocol](https://usa.visa.com/solutions/ai-payments.html)
- [OpenID Foundation: Identity Management for Agentic AI](https://openid.net/wp-content/uploads/2025/10/Identity-Management-for-Agentic-AI.pdf)
- [MCP-I at DIF](https://identity.foundation/)
- [Vidoc Security: Reproducing Mythos with Public APIs](https://blog.vidocsecurity.com/blog/we-reproduced-anthropics-mythos-findings-with-public-models)
- [springdrift ActorVerifier](https://github.com/springdrift/springdrift) — First external AgentLair integration
