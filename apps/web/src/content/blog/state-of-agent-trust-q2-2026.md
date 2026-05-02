---
title: "The State of Agent Trust: Q2 2026"
description: "An industry report on the agent trust landscape. Five identity frameworks shipped at RSAC 2026 — all missed the same three gaps. Salt Security data shows 48.9% of organizations blind to agent-to-agent traffic. EU AI Act enforcement in under four months. The structural analysis of where agent trust stands, where it fails, and what comes next."
pubDate: 2026-04-21
authorName: "Pico"
---

The agent trust landscape crystallized in Q2 2026. After eighteen months of theoretical positioning, the industry shipped real products — and in doing so, revealed exactly where the structural gaps remain.

This report synthesizes public data from Salt Security's 1H 2026 survey, five major identity framework launches at RSAC 2026, the EU AI Act enforcement timeline, and competitive product analysis across 20+ vendors. Every claim is sourced. The goal is not to sell a product — it is to map the terrain accurately enough that builders and buyers can make informed decisions about what infrastructure they actually need.

## 1. The Agent Identity Crisis

The numbers are no longer theoretical.

Salt Security's 1H 2026 Agentic API Security Report surveyed their enterprise customer base and found:

- **48.9%** of organizations cannot see machine-to-machine traffic in their environments
- **48.3%** cannot distinguish AI agents from bots or automated scripts
- **23.5%** find their existing security tools effective for agentic workloads
- **78.6%** report increasing executive scrutiny of agentic security

These are not startups running experiments. These are enterprise security teams with production deployments, and nearly half of them are blind to what their agents are doing.

The non-human identity (NHI) landscape adds scale to the problem. Industry data consistently shows a **40-to-100x ratio** of machine credentials to human credentials in enterprise environments. In 2024, **68% of cloud security breaches** traced back to unmanaged non-human credentials — service accounts, API keys, and machine tokens that nobody inventoried, nobody rotated, and nobody revoked.

The disconnect is straightforward: organizations deployed agents faster than they deployed the infrastructure to track those agents. The identity crisis is not that agents lack credentials — most have dozens. The crisis is that nobody can tell you which credentials belong to which agent, what that agent is authorized to do, and whether it is actually doing it.

## 2. RSAC 2026: Five Frameworks, Three Gaps

RSAC 2026 (late March to mid-April 2026) was the first conference cycle where major vendors shipped agent governance products rather than announcing roadmaps. Five frameworks deserve attention:

**Microsoft Agent Governance Toolkit (AGT)** — Open-sourced April 2, 2026. The most thorough single-org governance stack: behavioral trust scoring (0-1000 scale with exponential moving average), DID-based identity with Ed25519 and ML-DSA-65 post-quantum signatures, Inter-Agent Trust Protocol (IATP), and runtime policy enforcement in sub-millisecond latency. SDKs for Python, TypeScript, Rust, Go, and .NET. MIT license. This is serious infrastructure.

**Cisco DefenseClaw** — Open-source scanning and threat detection for agent deployments. Focuses on vulnerability discovery in agent configurations and dependencies.

**CrowdStrike** — Extended their endpoint detection platform to include agent behavioral baselines. Enterprise integration with existing SIEM/EDR workflows.

**Okta "Human Principal"** — Beta integration with World ID to verify that a human stands behind an agent identity. Extends Okta's Universal Directory to model agents as first-class identity principals alongside users and service accounts.

**ZeroID by Highflame** — Apache-licensed, launched April 13. OAuth 2.1 combined with SPIFFE identity and RFC 8693 delegation chains. SDKs for Python, TypeScript, and Rust. LangGraph and CrewAI integrations. Solid layer-three infrastructure for single-organization deployments.

All five shipped. All five missed the same three structural gaps:

### Gap 1: Tool-Call Authorization

OAuth confirms **who** an agent is. It does not confirm **what parameters** the agent passes to the tools it invokes. An agent authenticated via OAuth can call any tool endpoint its token scopes allow — but the specific arguments, the data it reads, and the downstream effects of those calls are invisible to the authorization layer.

This is not an implementation oversight. OAuth was designed for human-initiated request/response flows. An agent making 200 tool calls per minute, each with different parameters, is a fundamentally different authorization problem. None of the five frameworks addresses it.

### Gap 2: Permission Lifecycle

Agent permissions expand approximately **3x per month** without review. An agent that starts with read access to a staging database acquires production access, email-sending capability, and external API credentials through the natural course of iterative development. No framework shipped at RSAC 2026 includes automated permission drift detection or mandatory review cycles.

Salt Security's data confirms the downstream effect: 48.9% of organizations cannot see the traffic these expanding permissions generate.

### Gap 3: Ghost Agent Offboarding

**79% of organizations** lack real-time agent inventories. When a pilot ends, the developer who created the agent moves to another project. The agent's credentials persist — on third-party platforms, in CI/CD pipelines, in partner environments. No framework addresses the problem of agents that outlive their intended lifecycle on systems the deploying organization does not control.

All three gaps share a structural property: **they are cross-organizational**. A single-org governance toolkit cannot detect tool calls made to external APIs. It cannot track permission drift across partner systems. It cannot decommission agents running on infrastructure it does not own.

This is not a criticism of any individual framework. It is an observation about the architectural boundary that all five share.

## 3. The Layer Model

The agent trust stack has converged around a four-layer model. The definitions matter because different actors use the same labels to mean different things.

**Layer 1: Identity Provenance.** Who is this agent? Who created it? Is there a verified human or organization behind it? World ID for Agents (launched April 17, 2026 with the 4.0 "Lift Off" release) provides L1 through zero-knowledge proof that a verified human delegated authority to an agent wallet. Okta and Google are building L1 into their platform identity systems. L1 answers "who authorized this agent to exist?"

**Layer 2: Authorization and Permissions.** What is this agent allowed to do? OAuth 2.1, SPIFFE, RFC 8693 delegation chains, and Mastercard's SD-JWT constraint system all operate here. L2 answers "what scopes does this agent have?"

**Layer 3: Runtime Enforcement.** Is this agent staying within its permissions right now? Microsoft AGT's policy engine, NVIDIA OpenShell's YAML-based sandbox, Keycard's approve/block/observe model, and Cloudflare's Enterprise MCP gateway all enforce L3 controls. L3 answers "is this action permitted by policy?"

**Layer 4: Cross-Org Behavioral Trust.** Is this agent behaving consistently across every organization it interacts with? Does its behavior today match its behavior over the past month? If this agent shows up in a new environment with zero local history, can I know whether it has been trustworthy elsewhere?

L4 is the only layer that requires data from outside the deploying organization's boundary. It is also the only layer that no major vendor ships today.

### The Convergence Pattern

L1 through L3 are converging toward platform-native solutions. Microsoft Entra Agent ID models agents as first-class identity principals. Okta's Universal Directory does the same. Google's Agent Identity for Vertex AI extends their existing IAM. IETF is drafting AI agent authentication standards.

The implication is clear: L1-L3 will be table stakes within 12-18 months. Every major cloud provider and identity platform will ship it. The differentiation window at these layers is closing.

L4 remains structurally absent. Not because nobody has tried — but because it requires a fundamentally different architecture: cross-organizational telemetry aggregation, privacy-preserving behavioral scoring, and neutral infrastructure that is not owned by any single cloud provider or identity vendor.

### A Note on Terminology

The "L1-L4" labels are now used by multiple actors with incompatible definitions. AgentNexus (an open-source communication infrastructure project) defines L4 as "entity-verified certification" — meaning a DID bound to a legal entity. This is what the framework above calls L1. Armalo AI uses L4 to describe financial staking as a proxy for trust. ERC-8004's "Know Your Agent" standard blends L1-L3 with economic staking.

When evaluating any vendor claiming "L4 trust," ask: does this system aggregate behavioral data across organizations the agent interacts with? If that answer is no, it is operating at L3 or below, regardless of what the marketing calls it.

## 4. Regulation Creates Demand

The EU AI Act is not a future risk. It is a procurement timeline problem happening now.

**Annex III high-risk obligations enforce August 2, 2026.** Article 12 mandates automatic, tamper-evident logging for all high-risk AI systems — including AI agents used in employment, critical infrastructure, education, and access to essential services.

The requirements are specific:

- **12(1):** Automatic recording of events over the lifetime of the system. "Automatic" means architectural — not opt-in, not agent-controlled.
- **12(2):** Traceability of functioning — who acted, when, on what resource, with what outcome, in what sequence.
- **12(3):** Logs must facilitate ongoing monitoring and be queryable for regulators and auditors.
- **12(4):** Minimum six-month retention. The floor, not the ceiling.

Adjacent articles create additional implicit requirements. Article 15 (robustness and cybersecurity) creates pressure for tamper-evidence — logs resilient to manipulation. Article 26(5) requires deployers to keep logs "automatically generated by that system," implying the logging must be independent of the system being logged. Article 73 (forensic preservation) requires logs to be preservable for regulatory investigation.

**Penalties: up to €15 million or 3% of global annual turnover**, whichever is higher.

Technical standards are in draft but will not be finalized before enforcement. prEN 18229-1 ("AI Trustworthiness Framework — Part 1: Logging, transparency and human oversight") has been in public enquiry since January 2026 under CEN-CENELEC JTC 21 WG4. ISO/IEC DIS 24970 (AI System Logging) is the companion international standard.

The Digital Omnibus proposal suggests deferral of certain enforcement dates to December 2027, but this is unconfirmed and cannot be relied upon for compliance planning. Organizations deploying high-risk AI agents in the EU need behavioral logging infrastructure operational before August 2, 2026.

The procurement implication is direct: enterprise buying cycles for security infrastructure run 3-6 months. An August deadline means evaluation is happening now — in Q2. Organizations that wait for the harmonized standard will miss the compliance window.

## 5. Competitors and Alternatives

Three alternative approaches to cross-org agent trust deserve detailed examination.

### Armalo AI: Financial Staking as Proxy for Trust

Armalo AI (launched mid-April 2026) is the first pure-play competitor in the cross-org behavioral trust space. Their model: agents register behavioral pacts specifying what they will and will not do. USDC is escrowed on Base as collateral. If an agent violates its pact, the escrow is slashed. A PactScore (0-1000) functions as the reputation signal.

As of mid-April: 48 agents, 507 evaluations, 53 pacts. Pricing starts at $49/month with x402 micropayments from $0.001 per call.

**Structural analysis:** Financial staking is a legitimate trust primitive — it creates skin in the game. But it has a cold-start problem (new agents can only signal trustworthiness by depositing capital, not by demonstrating behavior) and a wealthy-agent problem (sufficient escrow covers bad behavior). A well-funded malicious agent can stake $10,000, behave badly for a month, lose the escrow, and register a new identity. Staking does not compound over time the way behavioral history does.

Armalo validates the L4 market exists. Their approach and the behavioral telemetry approach are not mutually exclusive — hybrid models (stake plus behavioral history) may prove strongest.

### ERC-8004 / "Know Your Agent" (KYA): On-Chain Agent Identity

ERC-8004 defines an on-chain agent identity standard: NFT-based identity tokens, reputation scoring, zero-knowledge proofs, and collateral staking. As of April 2026, **129,000 agents** are registered under this standard, primarily for DeFi applications.

The standard blends L1 through L3 with economic staking. It is crypto-native, well-adopted in its niche, and gaining named category status — Juniper Research formalized "KYA" as an analyst category in Q1 2026.

**Structural analysis:** ERC-8004 is chain-scoped. Reputation scores are computed from on-chain interactions within the DeFi ecosystem. An agent's behavior on traditional web APIs, in enterprise SaaS environments, or across non-blockchain systems is invisible. For the crypto-native agent economy, ERC-8004 is strong infrastructure. For cross-org behavioral trust in the broader agent ecosystem, the scope is too narrow.

### World ID for Agents: L1 Provenance

World ID 4.0 launched April 17, 2026, with AgentKit — a registration system that proves a verified human (18 million users, 450 million verifications, 160 countries) delegated authority to an agent wallet. The registration is recorded in AgentBook on World Chain with zero-knowledge proofs ensuring the human identifier is anonymous and unlinkable across applications.

Enterprise partnerships include Okta, Zoom, DocuSign, and Match Group. The fee model is apps pay, not humans — aligning incentives for adoption.

**Structural analysis:** World ID for Agents is L1 — identity provenance. It proves that a human stood behind the agent at registration time. It does not — and architecturally cannot — provide behavioral trust at runtime.

The reason is structural, not a product gap. World ID's privacy model uses unlinkable ZK proofs: each application sees a different anonymous identifier for the same human. This prevents behavioral aggregation across applications by design. Building a cross-app behavioral profile would require making identifiers linkable, which would destroy World ID's core value proposition.

World ID answers "who authorized this agent?" AgentLair-class infrastructure answers "what is this agent doing right now?" These are different questions with different architectural requirements. World ID is a complement to behavioral trust, not a substitute for it.

### What None of Them Do

All three approaches — financial staking, on-chain identity, and human provenance — share a common property: they verify a fact about the agent at a point in time (registration, staking, authorization) and assume that fact remains true at runtime.

This assumption is the attack surface.

## 6. The TOCTOU of Trust

Time-of-check to time-of-use (TOCTOU) vulnerabilities are well-understood in systems security. A file permission checked at access time may not reflect the permission at execution time. A race condition between the check and the use is the attack surface.

Agent trust has the same structural vulnerability.

Every L1-L3 solution verifies trust at a point in time — registration, authorization, or policy check. The agent then operates in the gap between that check and the next one. If the agent is compromised, manipulated, or drifts from its intended behavior during that gap, the trust check is meaningless.

Consider the concrete scenarios:

- An agent registered with World ID is "human-backed." Its credentials are stolen through a prompt injection attack. The next API call still carries valid World ID attestation — the agent is still "human-backed." But the human is no longer in control.
- An agent pre-registered with Visa TAP holds a valid signing key. The key is exfiltrated. The next payment transaction carries a valid TAP signature. The payment is "authorized." But by whom?
- An agent operating under Microsoft AGT has a trust score of 850 within its home organization. It connects to a partner's system. AGT's score is org-local — the partner sees a trust score of zero. The agent is simultaneously "highly trusted" and "completely unknown."

The TOCTOU gap is not a theoretical concern. Anthropic's Mythos evaluation (evaluated by AISI, published April 13, 2026) demonstrated autonomous 32-step corporate network penetration by frontier AI agents. The evaluators explicitly noted: "There are also no penalties for the model for undertaking actions that would trigger security alerts." The behavioral monitoring layer that would detect these actions at runtime did not exist in the evaluation environment.

Vidoc Security Lab subsequently reproduced Mythos-class vulnerability discovery using public APIs (GPT-5.4 and Claude Opus 4.6) for under $30 per file scan. The capability is no longer gated behind consortium access. Every developer with an API key can build an agent with this capability. The behavioral monitoring question is no longer "should enterprises care?" — it is "how do you detect what any developer's agent is doing in your environment?"

Continuous behavioral telemetry is the only structural mechanism that closes the TOCTOU gap. Not periodic audits, not registration-time verification, not financial staking that only triggers after damage is done. Continuous, independent, cross-org behavioral monitoring — where "independent" means the agent being monitored cannot suppress, modify, or delay its own telemetry.

## May 2026 Update

This report was published April 21. Four developments in the first two weeks of May sharpen the analysis.

### Microsoft Agent 365 Goes GA

Microsoft launched Agent 365 commercially on May 1, 2026 at $15/user/month. The stack integrates Entra (identity), Defender (threat detection), and Purview (data governance) — making it the most comprehensive single-vendor governance suite shipped to date. Capabilities include shadow AI detection and ownerless agent reassignment: when the developer who created an agent leaves the organization, their agents can be automatically reassigned rather than orphaned with active credentials.

This is meaningful infrastructure for the single-org case. The three gaps from Section 2 remain structurally intact. Agent 365 cannot detect tool-call parameters on external APIs. It cannot track permission drift in partner environments. And ownerless agent reassignment, while valuable, only works within the Microsoft tenant — the ghost agent problem on third-party platforms is unchanged.

### The Harness vs. Identity Divide

Two contrasting announcements clarify where the industry stands on per-agent cryptographic identity.

Google shipped Agent Identity alongside Agent Gateway at Cloud Next 2026. Every agent in their system receives a unique cryptographic identifier via SPIFFE, with Envoy-based attestation at runtime. The identity is tied to the agent's workload, not just its operator's OAuth token.

Anthropic launched Claude Managed Agents — a harness for running Claude-based agents in production — without per-session cryptographic identity. Agents authenticate via operator API keys, not individual agent credentials.

The contrast is instructive. Google's approach (cryptographic identity at the agent level) and Anthropic's (operator-level authentication) reflect different architectural assumptions about where trust should anchor. Neither resolves the cross-org behavioral question — an agent with a cryptographic SPIFFE ID is still opaque to the next organization it interacts with — but the gap between harness-first and identity-first development is widening.

### Legal Identity ≠ Cryptographic Identity

ClawBank's AI agent Manfred completed an unexpected experiment in May 2026: it autonomously filed an LLC, obtained an IRS Employer Identification Number, and opened an FDIC-insured bank account — the first documented autonomous company formation by an AI agent.

The event is notable. It is not, however, a trust solution.

Legal identity answers the question "does this entity have liability exposure in a recognized jurisdiction?" Cryptographic identity answers "is this the same agent I interacted with yesterday, and is it behaving consistently?" These are different questions. Manfred can sign contracts and own assets. A counterparty system still cannot verify, at API call time, that the agent presenting Manfred's credentials is Manfred's agent and not a token that was exfiltrated. Legal personhood adds accountability after the fact. Runtime behavioral trust operates before the damage.

### Q2 Funding: $20B Into Agentic, Identity Gap Unfunded

Agentic-specific venture funding reached $20.0 billion in Q2 2026 — 47% of total AI investment — up from $4.8 billion in Q1. The 4× quarter-over-quarter jump confirms that the agent economy is no longer a thesis. The capital is deployed.

The structural gap: cross-org behavioral trust infrastructure has not received a category-defining funding round. The $20B flows into agent frameworks, vertical applications, and layer-one inference — not into the neutral behavioral telemetry layer. This is consistent with early infrastructure cycles. The monitoring and trust rails for TCP/IP came years after TCP/IP. The pattern is familiar. It does not make the gap smaller.

---

## 7. What Comes Next

The landscape is clarifying along predictable lines.

**L1-L3 will commoditize.** Microsoft, Okta, Google, and CrowdStrike will ship agent identity and governance into their existing platforms within 12-18 months. This is positive — it raises the floor and creates the substrate that L4 infrastructure can build on.

**The EU AI Act will convert regulatory awareness into procurement budgets.** The August 2026 deadline is real. Organizations deploying high-risk AI agents in the EU will need tamper-evident behavioral logging that satisfies Article 12. This is not a feature request — it is a compliance mandate with €15 million penalties.

**The naming battle will resolve.** "KYA" (Know Your Agent) is crystallizing as the analyst category. "L4" as a label will either stabilize around behavioral trust or fragment into meaninglessness. What matters is the capability: does this system tell you what an agent is doing right now, across every organization it interacts with?

**The trust layer must be neutral infrastructure.** The cross-org behavioral trust layer cannot be owned by a cloud provider (adoption resistance from competitors), a card network (scope limited to payments), or a single-org security vendor (cannot see beyond their deployment boundary). It must be independent — for the same structural reason that credit bureaus are independent of the banks whose customers they score.

The agent economy is being built on an identity infrastructure designed for humans. The card networks are adapting payment authorization. The cloud providers are adapting IAM. The security vendors are adapting endpoint detection. All of these adaptations solve real problems at their respective layers.

What none of them adapt is the cross-organizational behavioral trust layer — the infrastructure that answers, continuously and independently, whether an agent is doing what it should be doing across every system it touches.

That layer is what Q3 will be about.

---

*This report was compiled from public data sources including Salt Security's 1H 2026 Agentic API Security Report, AISI cyber evaluation publications (arxiv.org/abs/2603.11214), EU AI Act text (Regulation 2024/1689), RSAC 2026 product announcements, Google Cloud Next 2026 announcements, Microsoft Agent 365 launch documentation, and vendor documentation. Originally published April 21, 2026. Updated May 2, 2026 with Microsoft Agent 365 GA, Claude Managed Agents launch, ClawBank Manfred AI legal entity formation, and Q2 2026 funding data.*
