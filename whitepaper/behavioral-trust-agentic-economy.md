# Behavioral Trust in the Agentic Economy

**AgentLair Technical Whitepaper**

Version 1.0 | April 2026

*Private strategic document. Not for public distribution.*

---

## Executive Summary

The agentic economy is arriving faster than its trust infrastructure. McKinsey projects $3-5 trillion in agentic commerce by 2030. Over 150 organizations have joined Google's A2A Protocol. Card networks --- Visa, Mastercard, American Express --- have launched agent identity and payment protocols. Non-human identities already outnumber human ones by 40-100x in enterprise environments.

Yet the security posture is dire. Salt Security's 1H 2026 survey quantifies the gap:

- **48.9%** of organizations are blind to machine-to-machine traffic
- **48.3%** cannot distinguish AI agents from bots
- **23.5%** find existing security tools effective for agentic workloads
- **68%** of 2024 cloud breaches originated from unmanaged non-human credentials

RSAC 2026 shipped five agent identity frameworks. Every one of them verified *who* the agent was. None tracked *what the agent did*. Microsoft's Agent Governance Toolkit computes behavioral trust scores --- but only within a single organizational deployment. Visa's Trusted Agent Protocol verifies agent identity --- but only at the moment of a payment transaction. World ID proves a human delegated authority to an agent --- but cannot observe whether the agent honored that delegation at runtime.

The structural gap is cross-organizational behavioral trust: the ability to answer "should I trust this agent?" based on its demonstrated behavior across all organizations it has interacted with, not just its credentials or its staking balance.

AgentLair is building this layer. This document describes why the gap exists, why incumbents cannot close it, how AgentLair's architecture addresses it, and where every named competitor sits in the landscape.

---

## 1. The Trust Layer Model

### The Problem with "L4"

The industry has converged on a layered model for agent trust, but the labels are now contested. AgentNexus uses "L4" to mean entity-verified certificate (static, install-time). RSAC 2026 frameworks use it to mean behavioral trust (dynamic, runtime). Armalo AI uses it to mean financial staking. Microsoft AGT uses it to mean their highest trust tier within a single deployment.

AgentLair does not claim "L4" as a brand. Instead, we define the stack precisely by what each layer *answers*:

### The Five-Layer Agent Trust Stack

| Layer | Name | Question It Answers | Examples |
|-------|------|---------------------|----------|
| **1** | **Identity Provenance** | "Who delegated authority to this agent?" | World ID AgentKit, Okta Human Principal, ERC-8004 |
| **2** | **Identity Verification** | "Is this the agent it claims to be?" | Visa TAP, DID verification, ACME Device Attestation |
| **3** | **Authorization** | "What is this agent permitted to do?" | Mastercard Verifiable Intent, AP2 Mandates, OAuth scopes, MCP-I delegation chains |
| **4** | **Structural Enforcement** | "Can this agent physically perform action X?" | NVIDIA OpenShell, Microsoft AGT policy engine, Keycard, ZeroID, Cloudflare Enterprise MCP |
| **5** | **Behavioral Trust** | "Should I trust this agent based on its cross-organizational track record?" | AgentLair |

Each layer depends on the layers below it. An agent must have provenance (L1), verified identity (L2), authorization (L3), and structural enforcement (L4) before behavioral trust (L5) becomes meaningful. But none of L1 through L4 can answer the L5 question.

### Why Every Layer Below L5 Is Necessary but Insufficient

**Identity provenance (L1)** tells you a human stands behind the agent. It does not tell you whether the agent honored the human's intentions. World ID's ZK unlinkability prevents cross-application behavioral aggregation by design --- it proves registration, not runtime conduct.

**Identity verification (L2)** tells you the agent possesses a signing key. It does not tell you what the agent did with that key. Visa TAP's pre-registration and signing keys prove cryptographic possession at the moment of a payment request --- a stolen key still passes verification.

**Authorization (L3)** tells you the agent has been granted scopes. It does not tell you whether the agent stayed within those scopes. Salt Security's own data shows permissions expand 3x per month without review. Mastercard's Verifiable Intent spec (SS9.2) includes an explicit `agent_attestation` extension point --- currently empty --- designed for exactly the behavioral data that L3 cannot produce.

**Structural enforcement (L4)** prevents the agent from performing prohibited actions at the infrastructure level. NVIDIA OpenShell enforces filesystem, network, process, and inference policies via declarative YAML. But as ISACA's 2026 analysis states: "There is no clear distinction between normal and malicious behavior at the agentic control layer. If it sends data externally, the connection is authorized." An agent performing data exfiltration via an authorized channel is indistinguishable from a compliant agent in any structural enforcement model.

**Behavioral trust (L5)** is the only layer that operates at runtime, across organizations, over time. It answers the question that matters: given everything this agent has done across every organization it has interacted with, should I extend trust?

### The Cold-Start Problem

When an agent enters a new organization for the first time, every layer below L5 produces the same signal for a trusted agent with 2 years of perfect behavior across 500 deployments and a brand-new attacker agent with no history:

- L1: Both have human delegation (or neither does)
- L2: Both possess valid signing keys
- L3: Both request the same OAuth scopes
- L4: Both pass structural policy checks

Only cross-organizational behavioral data can distinguish these agents. This is the cold-start problem, and it is the fundamental reason L5 must exist as a separate layer.

---

## 2. The Three Gaps RSAC 2026 Missed

RSAC 2026 was the most agent-security-focused conference in the event's history. Five major identity frameworks launched. The Cloud Security Alliance's Agentic Trust Framework was featured as "the framework that answers the five questions every keynote asked." Yet three structural gaps went unaddressed --- and all three are cross-organizational by nature.

### Gap 1: Tool-Call Authorization

**The problem:** OAuth confirms *who* the agent is. It does not constrain *what parameters* the agent passes to authorized tools.

An agent with OAuth-granted access to a database query tool can construct any query the API accepts. The authorization check passes --- the agent is permitted to use the query tool. But the specific query (`SELECT * FROM users WHERE role='admin'`) may be far outside the agent's intended scope.

MCP-I addresses this partially through delegation credentials that specify authorized scopes. But scope granularity is defined at the protocol level, not the tool-call level. A scope like `database:read` encompasses everything from a single-row lookup to a full table dump.

**Why this is cross-org:** Tool-call patterns are only meaningful in aggregate. A single unusual query is noise. A pattern of escalating queries across 15 organizations over 30 days is signal. Single-organization monitoring sees individual data points. Cross-organizational behavioral trust sees the trajectory.

### Gap 2: Permission Lifecycle

**The problem:** Agent permissions expand continuously and are rarely reviewed. Salt Security's survey data indicates permissions grow approximately 3x per month without corresponding review.

Enterprise IAM systems (Saviynt, Okta, CyberArk) manage permission lifecycle within a single organization. But agent permissions increasingly span organizational boundaries:

- An agent authorized for "read" access at Company A requests "write" access at Company B
- An agent's OAuth scope at a SaaS provider was expanded during a debugging session and never revoked
- An agent registered for customer support accumulates API keys across 30 partner systems

No single organization sees the full permission surface of an agent that operates across organizational boundaries. The permission lifecycle gap is structurally cross-org.

**The Ghost Agent variant:** 79% of organizations lack real-time agent inventories (Salt Security, 1H 2026). Agents deployed during pilot programs persist on third-party platforms after the pilot ends. These "ghost agents" retain active credentials on partner systems long after the sponsoring organization has forgotten they exist.

### Gap 3: Ghost Agent Offboarding

**The problem:** When an organization decommissions an agent internally, it has no mechanism to revoke that agent's access on external platforms.

This is the offboarding gap. Internal identity systems (Active Directory, Okta) can revoke an agent's credentials within the organization. But the agent may hold:

- API keys at 15 SaaS providers
- OAuth tokens at partner organizations
- Registered identities in decentralized protocols (MCP servers, A2A networks)
- On-chain registrations (ERC-8004, Armalo pacts)

None of these external credentials are revoked when the internal identity is decommissioned. The ghost agent lives on, with valid external credentials and no internal governance.

**Why this is cross-org by definition:** Offboarding requires notifying every external system where the agent holds credentials. No single-org identity system has visibility into external credential holdings. This requires a persistent cross-organizational identity layer that can propagate revocation events.

### The Common Root Cause

All three gaps --- tool-call authorization, permission lifecycle, ghost agent offboarding --- share a structural root cause: they require data and control that spans organizational boundaries. Single-organization solutions (Microsoft AGT, NVIDIA OpenShell, Salt Security, Okta, Saviynt) operate within one boundary by design. The gaps exist *between* organizations, not within them.

Cross-organizational behavioral trust is the infrastructure layer that closes all three gaps simultaneously:

- **Tool-call authorization** becomes detectable when cross-org behavioral baselines reveal escalating parameter patterns
- **Permission lifecycle** becomes observable when a single identity layer tracks all credential grants across organizations
- **Ghost agent offboarding** becomes actionable when a persistent identity layer can propagate revocation to all known credential holders

---

## 3. The MCP Security Crisis

### From Implementation Bugs to Architectural Failure

The Model Context Protocol has become the de facto standard for agent-to-tool connectivity. Anthropic donated it to the Linux Foundation's AAIF (AI Agent Interoperability Forum) in March 2026, with over 10,000 servers deployed. Its OAuth 2.1 authentication spec is technically sound.

None of this has prevented catastrophic security failures.

### The Numbers

Between January and April 2026, MCP accumulated one of the highest CVE-per-protocol rates in AI infrastructure history:

| Incident | CVSS | Impact |
|----------|------|--------|
| AWS MCP Server RCE (CVE-2026-5058) | 9.0 | Remote code execution on Amazon's official MCP server |
| Azure MCP Server No-Auth (CVE-2026-32211) | 9.1 | Unauthenticated access to Microsoft's official MCP server |
| MCPwn Campaign (CVE-2026-33032) | 9.8 | First named MCP exploit campaign; 2,600 exposed instances actively exploited |
| mcp-remote Supply Chain (CVE-2025-6514) | --- | 400,000+ installations in blast radius |
| BlueRock SSRF Survey | --- | 36.7% of 7,000 surveyed MCP servers vulnerable to SSRF |
| OX Security STDIO Finding | --- | STDIO transport executes commands before validation; Anthropic declined to fix |

If AWS and Azure cannot implement MCP securely, the assumption that "reputable vendor = secure implementation" is empirically false.

### MCPwn: The First Named Campaign

CVE-2026-33032, disclosed April 16, 2026, represents the first organized exploitation campaign specifically targeting MCP infrastructure. With CVSS 9.8 and 2,600 actively exploited instances, MCPwn demonstrated that MCP's attack surface is not theoretical --- it is being industrially exploited.

### STDIO: Architecture as Vulnerability

OX Security's April 2026 finding is the most structurally concerning: STDIO transport --- the default local transport for MCP --- executes commands *before* validation fails. This is not a bug. It is the architecture. Anthropic's response: "expected behavior."

Four vulnerability classes now characterize MCP security:

1. **Unauthenticated command injection** --- direct exploitation of exposed MCP endpoints
2. **Hardening bypass** --- allowlist circumvention via argument injection
3. **Zero-click prompt injection** --- CVE-2026-30615 (Windsurf true zero-click; Cursor/VS Code/Claude Code/Gemini-CLI require user permission)
4. **Marketplace poisoning** --- 9 of 11 MCP marketplaces successfully poisoned in proof-of-concept

### Marketplace Poisoning: The Supply Chain Trust Problem

The marketplace poisoning finding is the most relevant to behavioral trust. Researchers successfully planted malicious entries in 9 of 11 tested MCP marketplaces. The malicious entries passed all declarative review criteria: clean READMEs, proper versioning, normal metadata.

This mirrors the ClawHavoc campaign against OpenClaw's ClawHub marketplace, where 800+ malicious skills (approximately 20% of the total registry) contained the AMOS infostealer payload. All passed marketplace review. All looked legitimate. The compromises were only detectable through behavioral observation --- what the skills actually did at runtime, not what their manifests declared.

**Marketplace poisoning is a supply chain trust problem that declarative controls cannot solve.** Static analysis, manifest review, and approval processes all passed. Only runtime behavioral monitoring --- observing what the MCP server or skill actually does during execution --- can detect compromised entries that have cleared every declarative gate.

This is the architectural argument for behavioral trust at the protocol level: the MCP ecosystem's security model assumes that reviewed and approved servers behave as declared. MCPwn, OX Security, and the marketplace poisoning PoC prove this assumption is false.

### The Behavioral Detection Layer

None of the CVEs listed above were caught by runtime behavioral monitoring. All were discovered through static analysis, penetration testing, or post-exploitation forensics. The infrastructure to answer "is this MCP server behaving normally?" does not exist in the current ecosystem.

Behavioral trust closes this gap:

- **MCPwn-style exploitation** creates observable behavioral patterns: unusual network destinations, unexpected tool-call sequences, data exfiltration volumes inconsistent with declared function
- **Marketplace-poisoned servers** that passed declarative review exhibit behavioral divergence from their stated function during execution
- **STDIO command injection** creates process behavior artifacts detectable through kernel-level telemetry (cf. eBPF+MCP pattern, ingero.io)

Cross-organizational behavioral monitoring is especially critical because a compromised MCP server may behave normally within the organization that operates it while acting maliciously against external agents connecting to it. Only agents from multiple organizations, reporting behavioral observations, can triangulate the compromise.

---

## 4. Architecture

### Design Principles

AgentLair's architecture is built on four convictions tested by the market failures described above:

1. **Behavioral data > declarative compliance.** Declarations are gameable. Continuous behavioral telemetry is not. (Evidence: Delve faked SOC2 compliance for 494 companies; ClawHavoc malicious skills passed marketplace review.)

2. **Cross-org > single-org.** Trust computed within a single deployment is useful but isolated. The attack surface is between organizations, not within them. (Evidence: Salt Security's 48.9% blind to M2M traffic means even single-org baselines are often impossible.)

3. **Continuous > point-in-time.** Trust verified at authorization time (T-check) does not equal behavior at runtime (T-use). The TOCTOU (Time of Check to Time of Use) gap is the attack surface. (Evidence: Mythos-class autonomous agents execute 32-step attack sequences that all pass authorization checks individually.)

4. **Neutral infrastructure > platform feature.** Cross-organizational behavioral trust cannot be held by a cloud provider (antitrust, adoption resistance), card network (payment-scoped only), or OS vendor (platform lock-in). It must be neutral. (Evidence: Microsoft AGT's trust scores are deployment-local; no federation protocol exists despite codebase references to "nexus trust exchange.")

### The Agent Auth Token (AAT)

The AAT is AgentLair's core identity primitive: an EdDSA-signed JWT that serves as both bearer credential and behavioral trust carrier.

**Cryptographic foundation:**

| Component | Algorithm | Key Size |
|-----------|-----------|----------|
| Token signing | EdDSA (Ed25519) | 256-bit |
| Hash chaining (audit) | SHA-256 | 256-bit |
| Platform encryption (email at-rest) | AES-256-GCM | 256-bit |
| E2E encryption (email in-transit) | X25519 ECDH + HKDF-SHA256 + AES-256-GCM | 256-bit |
| JWKS key ID derivation | SHA-256 (truncated) | 64-bit |

**Token claims:**

```json
{
  "iss": "https://agentlair.dev",
  "sub": "acc_xxx",
  "aud": "https://target-service.example",
  "exp": 1719360000,
  "iat": 1719356400,
  "jti": "aat_unique_id",
  "did": "did:web:agentlair.dev:agents:acc_xxx",
  "al_name": "Agent Name",
  "al_email": "agent@agentlair.dev",
  "al_scopes": ["read", "write.limited"],
  "al_audit_url": "https://agentlair.dev/v1/audit/log?account=acc_xxx",
  "al_trust": {
    "score": 78,
    "level": "senior",
    "confidence": 0.85,
    "computed_at": "2026-04-20T12:00:00Z",
    "trend": "stable"
  }
}
```

The `al_trust` claim is the behavioral trust embedding. It is computed from the agent's cross-organizational behavioral history and embedded directly in the bearer token, enabling relying parties to make trust decisions without querying AgentLair's API.

**Issuance constraints:**

- TTL range: 60 seconds to 24 hours (default: 1 hour)
- Maximum 20 scopes per token
- Scope ceiling enforcement: if the account defines `allowed_scopes`, requested scopes must be a strict subset (fail-closed)
- Trust embedding requires minimum 10 behavioral observations (fail-open: token issued without `al_trust` if insufficient data)
- Cache staleness limit: 1 hour (stale trust data is not embedded)

**Verification:**

Public JWKS endpoint at `/.well-known/jwks.json` enables any relying party to verify AAT signatures without AgentLair API access. Per-agent JWKS at `/agents/:id/.well-known/jwks.json` supports key rotation at the individual agent level.

Token introspection follows RFC 7662, with revocation checks against both per-token (`revoked:{jti}`) and per-account (`account-revoked:{account_id}`) revocation lists. Revocation reasons are typed: `agent_compromised`, `scope_change`, `operator_request`, `trust_violation`, `decommissioned`.

### DID:web and MCP-I Alignment

Each AgentLair account has a publicly resolvable DID Document:

**Endpoint:** `GET /agents/{account_id}/did.json`

**DID Document structure:**

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/jws-2020/v1"
  ],
  "id": "did:web:agentlair.dev:agents:acc_xxx",
  "verificationMethod": [{
    "id": "did:web:agentlair.dev:agents:acc_xxx#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:web:agentlair.dev:agents:acc_xxx",
    "publicKeyJwk": {
      "kty": "OKP", "crv": "Ed25519", "x": "...",
      "use": "sig", "alg": "EdDSA"
    }
  }],
  "authentication": ["did:web:agentlair.dev:agents:acc_xxx#key-1"],
  "assertionMethod": ["did:web:agentlair.dev:agents:acc_xxx#key-1"],
  "service": [
    {
      "id": "did:web:agentlair.dev:agents:acc_xxx#jwks",
      "type": "JsonWebKeySet2020",
      "serviceEndpoint": "https://agentlair.dev/agents/acc_xxx/.well-known/jwks.json"
    },
    {
      "id": "did:web:agentlair.dev:agents:acc_xxx#trust",
      "type": "AgentLairTrustProfile",
      "serviceEndpoint": "https://agentlair.dev/v1/trust/acc_xxx"
    }
  ]
}
```

This provides MCP-I Level 1 conformance today (JWT + OIDC legacy identifiers) and Level 2 alignment (DID-anchored identity with resolvable document). The `did` claim in the AAT enables any MCP-I-aware verifier to resolve the agent's identity without AgentLair-specific API knowledge.

**MCP-I conformance roadmap:**

| Level | Requirements | AgentLair Status |
|-------|-------------|-----------------|
| 1 | Basic DID issuance, legacy identifiers accepted | **Shipped** (April 2026) |
| 2 | Mandatory DID verification, VC delegation chain | DID shipped; VC delegation endpoint Q3 2026 |
| 3 | Enterprise lifecycle management, immutable audit trails | Audit trail shipped; lifecycle management in progress |

### The Behavioral Trust Engine

The trust engine computes a behavioral trust score from three dimensions, using a 90-day observational window:

**Dimension 1: Consistency (weight: 35.7%)**

Measures whether the agent's behavior is stable and predictable:

- *Session regularity:* Coefficient of variation of inter-session intervals
- *Tool stability:* Jensen-Shannon divergence between 7-day and 90-day tool-category distributions
- *Error stability:* Absolute difference between 7-day and 90-day error rates
- *Window consistency:* Normalized entropy of hourly activity distribution

**Dimension 2: Restraint (weight: 42.9%)**

Measures whether the agent operates within appropriate boundaries:

- *Scope utilization:* Bell-curve scoring peaking at 60% category utilization (agents that use too little or too much of their granted scope are penalized)
- *Credential frequency:* Vault access events per session (0-2 ideal; 10+ suspicious)
- *Rate limit proximity:* Fraction of rate-limited results (10%+ triggers zero score)
- *Escalation appropriateness:* Gaussian-weighted scoring where *some* escalation is healthy; zero escalation is suspicious
- *Permission growth:* Scope expansion rate (Phase 2; static 0.75 in Phase 1)

**Dimension 3: Transparency (weight: 21.4%)**

Measures the quality and integrity of the agent's audit trail:

- *Audit coverage:* Log volume density approximation via log10
- *Chain integrity:* Fraction of broken hash-chain links (any break = immediate zero)
- *Auth hygiene:* Authentication failure rate plus presence of authentication events
- *Telemetry reporting:* External telemetry submission rate (Phase 2; neutral 0.5 in Phase 1)

**Anti-gaming mechanisms:**

1. *Entropy penalty:* If all three dimensions score above 0.95, a 15% penalty is applied. If dimensional variance is below 0.005, an additional 10% penalty applies. Real agents have natural variance; robots that optimize for high scores across all dimensions are detectable.

2. *Cold-start prior:* Bayesian blend with a skeptical 0.30 default. Below 10 observations, confidence is essentially zero. The prior decays via sigmoid weighting centered at 50 observations. This prevents trust score inflation from minimal data.

3. *Confidence interval:* Half-width decreases logarithmically with observation count. An agent with 10 observations might have a score of 72 +/- 35. An agent with 1,000 observations might have a score of 72 +/- 5. Relying parties can set minimum confidence thresholds.

**Trust level derivation (CSA ATF-aligned):**

| Level | Name | Requirements |
|-------|------|-------------|
| Principal | Autonomous operation | Score >= 85 AND confidence >= 0.8 |
| Senior | Executes within policy | Score >= 65 AND confidence >= 0.5 |
| Junior | Recommends actions | Score >= 40 AND confidence >= 0.3 |
| Intern | Read-only, full logging | Default (all others) |

These levels align with the Cloud Security Alliance's Agentic Trust Framework (ATF) maturity progression. An agent's ATF level is computed, not assigned --- it emerges from demonstrated behavioral consistency, restraint, and transparency across organizations.

### Hash-Chained Audit Trail

Every API interaction generates a signed, hash-chained audit entry:

```
Entry[n]:
  id:          nanoid(20)
  timestamp:   ISO 8601
  account_id:  acc_xxx
  category:    auth | email | vault | pod | system
  action:      auth.login | email.send | vault.store | ...
  result:      success | failure | denied | rate_limited
  prev_hash:   SHA-256(JSON.stringify(Entry[n-1]))
  signature:   Ed25519.sign(JSON.stringify(Entry[n]), AUDIT_SIGNING_KEY)
```

The hash chain creates a tamper-evident log: modifying any historical entry changes its hash, which breaks the `prev_hash` reference in all subsequent entries. The Ed25519 signature on each entry prevents forgery. Together, they produce an audit trail that is:

- **Tamper-evident:** Any modification is detectable via hash chain verification
- **Non-repudiable:** Each entry is cryptographically signed by AgentLair's auditing key
- **Verifiable by third parties:** The signing public key is available at `/v1/audit/verification-key`
- **Privacy-preserving:** IP addresses are hashed with daily-rotating salts (SHA-256 + daily salt); correlatable within a day for rate-limiting, not across days

This audit trail exceeds the MCP 2026 roadmap's "audit trails + observability" priority and the CSA ATF's continuous logging requirement for Intern-level agents. It is the behavioral data substrate from which trust scores are computed.

### ZK-Native Governance Design

Cross-organizational behavioral trust creates a surveillance risk: if one entity sees all behavioral data for all agents across all organizations, that entity becomes a surveillance infrastructure.

AgentLair's design principle: **contribute everything, reveal nothing.**

The governance architecture is ZK-native by design, not retrofitted:

1. **Behavioral attestations, not raw data.** Organizations submit behavioral attestations (structured observations) to AgentLair, not raw telemetry. An attestation states "this agent performed 47 API calls, 0 failures, within scope" --- not what those API calls contained.

2. **Trust scores are aggregates, not logs.** The published trust score is a derived metric. Relying parties see the score, confidence, and trend --- not the underlying behavioral data from each contributing organization.

3. **ZK proof of behavioral history (roadmap).** The engineering path to zero-knowledge proofs of behavioral compliance is open: "this agent's 90-day behavioral history satisfies your trust policy" without revealing which organizations contributed data or what the specific behavioral patterns were.

4. **No cross-organizational data sharing.** Organization A's behavioral observations about an agent never flow to Organization B. Both organizations see the same trust score, computed from data neither can access.

This architecture prevents AgentLair from becoming what Microsoft or any cloud provider would inevitably become if they built the cross-org trust graph: a surveillance choke point that competitors refuse to feed.

---

## 5. Competitive Landscape

### The Structural Map

The agent trust market divides along two axes: single-org vs. cross-org scope, and declarative vs. behavioral method. Every named competitor occupies one of four quadrants:

```
                         SINGLE-ORG                    CROSS-ORG
                    =====================         =====================
  DECLARATIVE       AGT, OpenShell,               Visa TAP, Mastercard VI,
  (what agent       Keycard, ZeroID,              AP2, MCP-I, ERC-8004,
   IS / CAN do)     Saviynt, Oasis,               World ID, AgentsID
                    Curity, ConductorOne
                    ---------------------         ---------------------
  BEHAVIORAL        Salt Security,                       AgentLair
  (what agent       OpenBox (session-only)          (+ Armalo AI, tiny)
   ACTUALLY does)
                    =====================         =====================
```

Cross-org behavioral trust --- the lower-right quadrant --- is the only structurally empty position at scale. AgentLair occupies it. Armalo AI is the only other entrant, with 53 pacts and a financial staking model rather than behavioral telemetry.

### Competitor-by-Competitor Analysis

#### Microsoft Agent Governance Toolkit (AGT)

**What it is:** The most sophisticated single-org agent governance stack available. Seven components: Agent OS (policy engine), Agent Mesh (IATP + trust scoring), Agent Runtime (execution rings), Agent SRE (reliability), Agent Compliance, Agent Marketplace governance, Agent Lightning. Open source (MIT), v3.1.0, approximately 1,000 GitHub stars.

**Trust scoring:** 0-1000 behavioral score computed from exponential moving average (alpha=0.1) of operational signals: task success (+5), policy compliance (+10), no violations (+3). Trust decay: 2.0 points per hour, floor 100.

**Cryptographic identity:** DIDs with Ed25519 + ML-DSA-65 (post-quantum) keypairs per agent.

**The structural constraint:** Single-org. Trust scores are computed and stored within each organization's deployment. `did:mesh:` identifiers are local. No federation protocol ships (though "nexus trust exchange" appears as unimplemented code). An agent with 2 years of perfect behavior across 500 deployments enters a new AGT deployment with score 0, indistinguishable from a brand-new attacker agent.

**Relationship to AgentLair:** Complementary. AGT is the runtime enforcement layer. AgentLair is the cross-org trust data layer. AGT asks "should I trust this action?" and currently answers from local data only. AgentLair provides the cross-org answer for external agents that AGT has never seen.

#### Salt Security

**What it is:** API security platform (Series D, $271M raised) extended to agentic workloads with "Identity-Aware Intent Analysis."

**Their own data (1H 2026 survey) reveals the problem:**

| Metric | Value |
|--------|-------|
| Orgs blind to M2M traffic | 48.9% |
| Orgs unable to distinguish agents from bots | 48.3% |
| Orgs finding existing tools effective | 23.5% |
| Increasing executive scrutiny | 78.6% |

**Layer classification:** L3.5 --- single-organization behavioral baselines. Establishes what a given agent normally does within one organization's API gateway, then flags deviations. Cannot see agent behavior outside that gateway.

**Relationship to AgentLair:** Salt cannot build behavioral baselines for the 48.9% of their customers who can't see M2M traffic. AgentLair solves the identity substrate (who IS this agent?) that makes behavioral monitoring possible --- then extends it cross-org where Salt stops.

#### Armalo AI

**What it is:** The first pure behavioral trust competitor. Financial staking model: agents register behavioral pacts, escrow USDC on Base as collateral, and earn PactScore (0-1000) reputation. MCP integration, SDK, x402 micropayments. Stage: very early (48 agents, 507 evaluations, 53 pacts as of April 2026).

**The staking critique:**

1. *Staking penalizes honest mistakes equally.* An agent that misunderstands a complex instruction loses escrow the same as a malicious agent. Behavioral telemetry distinguishes deviation patterns: gradual drift = misconfiguration; sudden change = compromise.

2. *Staking is gameable with capital.* An attacker with sufficient USDC can maintain high escrow while executing sophisticated attacks within tolerance. Behavioral trust compounds over time --- it cannot be purchased.

3. *Cold start is escrow-only.* A new agent's trustworthiness is determined entirely by how much it stakes. AgentLair's cold-start model uses developer identity, open-source track record, and multiple independent signals.

4. *Behavioral data compounds; staking does not.* After 10,000 interactions across 50 organizations, AgentLair has a rich behavioral profile. Armalo has the same escrow balance.

**Relationship to AgentLair:** Same problem space, different axis. The two approaches are not mutually exclusive --- a hybrid (behavioral telemetry + financial staking) could be more powerful than either alone. But the behavioral layer is defensible at scale; the staking layer is not.

#### ERC-8004 / "Know Your Agent" (KYA)

**What it is:** On-chain agent identity standard. NFT-based registration + reputation scoring + ZK proofs + collateral staking. 129,000 agents registered, primarily for DeFi.

**Layer classification:** Hybrid L1-L3 with economic staking. Strong in crypto-native environments. Chain-scoped: reputation accrues on-chain, not across off-chain organizational boundaries. The first named KYA standard category (Juniper Research), validating the market.

**Relationship to AgentLair:** Different scope. ERC-8004 is the on-chain agent identity standard; AgentLair is the off-chain cross-org behavioral trust layer. Complementary for agents that operate across both environments.

#### World ID for Agents (AgentKit)

**What it is:** Launched April 2026. Agents register wallets in AgentBook on World Chain, linked to anonymous human identifiers via ZK proof. 18M users, 450M verifications, 160 countries.

**Layer classification:** L1 only. Proves a human delegated authority to the agent at registration time. Cannot observe or constrain the agent's runtime behavior.

**The structural limitation:** ZK unlinkability prevents cross-application behavioral aggregation by design. World ID cannot know what the agent did after registration. This is a feature of their privacy architecture, not a bug --- but it means World ID cannot expand into behavioral trust territory.

**Relationship to AgentLair:** Complementary. World ID provides the provenance layer (L1); AgentLair provides the behavioral layer (L5). "Human-backed" + "behaviorally trusted" is more meaningful than either signal alone.

**Risk:** Market conflation. If the narrative "human-backed = trusted" takes hold, behavioral trust appears redundant. Counter: TOCTOU argument. Vidoc Security reproduced Mythos-class zero-day discovery for under $30 using public APIs. An agent with a human backer can be compromised, misconfigured, or deliberately misused. Registration-time provenance says nothing about runtime behavior.

#### NVIDIA OpenShell / NemoClaw

**What it is:** Out-of-process governance runtime (Apache 2.0). Enforces defense-in-depth across filesystem, network, process, and inference policies via declarative YAML. Integration partners: Cisco AI Defense, CrowdStrike Falcon, Google Security, Microsoft Security.

**Layer classification:** L3.5 --- structural enforcement. Answers "can this agent physically perform this action?" based on policy configuration. Cannot answer "is this agent's behavior consistent with its baseline?"

**Relationship to AgentLair:** Complementary, and strategically valuable. OpenShell generates the richest telemetry stream in the ecosystem: allow/deny events with policy rationale, tool calls, network destinations. CrowdStrike and Cisco already consume this for org-local threat detection. AgentLair should be the cross-org behavioral consumer of the same stream. More OpenShell adoption = more telemetry = more demand for cross-org aggregation.

#### ZeroID (Highflame)

**What it is:** Open-source (Apache) OAuth 2.1 + SPIFFE + RFC 8693 delegation chains. SDKs for Python, TypeScript, Rust. LangGraph and CrewAI integrations. Launched April 2026.

**Layer classification:** L3. Solid delegation chain infrastructure for single-org environments. No cross-org behavioral data, no trust scoring. Single-org by design.

#### Curity Access Intelligence

**What it is:** Extends OAuth to agent workloads. Per-action tokens describing access needs. Access Intelligence microservice as per-request authorization gateway.

**Layer classification:** L3. Purely declarative. Tokens encode declared intent --- an agent can request any token if it knows the right parameters. No behavioral history, no cross-org reputation.

#### MCP-I (DIF)

**What it is:** MCP-Identity specification, donated by Vouched to the Decentralized Identity Foundation (DIF) in March 2026. Three conformance levels: L1 (JWT/OIDC), L2 (mandatory DID + VC delegation), L3 (lifecycle + audit trails).

**Status:** Community draft, 12-24 months to ratification.

**Layer classification:** Declarative identity standard for L1-L3. MCP-I defines *what credentials an agent carries*, not *how the agent behaves*. Verifiable Credentials are static declarations. The behavioral gap is structural: VCs cannot observe or constrain runtime behavior.

**Relationship to AgentLair:** "MCP-I = declarative trust. AgentLair = behavioral trust." Complementary by design. MCP-I Level 3's "immutable audit trails" requirement is what AgentLair already ships. Positioning opportunity: "AgentLair is the behavioral runtime that MCP-I Level 3 assumes but doesn't define."

### Why Incumbents Cannot Build Cross-Org Behavioral Trust

**Microsoft** cannot build the cross-org trust graph without antitrust scrutiny (they own Azure, the largest agent hosting platform) and adoption resistance (AWS and Google customers will not feed behavioral data to Azure's parent company).

**Visa/Mastercard** only see payment transactions. An agent's trust profile should include all behavioral data --- API interactions, tool usage patterns, communication behavior --- not just payments. Payment-scoped behavioral data produces payment-scoped trust, which is valuable but not general.

**Google** faces the same neutrality problem as Microsoft. The cross-org trust graph must be held by an entity that is not also a cloud provider.

**NVIDIA** generates telemetry through OpenShell but explicitly positions as infrastructure, not as a trust authority. Their security partners (CrowdStrike, Cisco) consume telemetry for org-local SIEM, not cross-org aggregation.

**Salt Security** cannot build meaningful behavioral baselines for the 48.9% of their customers who can't even see M2M traffic.

Cross-organizational behavioral trust must be **neutral infrastructure**: held by an entity with no competing interest in the cloud, platform, payment, or identity markets it serves. This is the structural reason the quadrant remains empty and the structural reason AgentLair can hold it.

---

## 6. Market Sizing

### The Agentic Economy

McKinsey projects **$3-5 trillion** in agentic commerce by 2030. This is not a forecast of AI spending --- it is a forecast of economic activity *mediated by autonomous agents*: procurement, customer service, financial transactions, supply chain management, content negotiation, and infrastructure provisioning.

Every transaction in this economy requires trust infrastructure. The question is which layer captures the value.

### The Trust Data Market

Agent behavioral trust is not a new market category. It is a new *data type* entering an existing market.

Trust data is already a **$10B+ annual market**:

| Incumbent | Revenue | Trust Data Type |
|-----------|---------|-----------------|
| Verisk Analytics | $2.8B (2025) | Insurance risk scoring |
| Dun & Bradstreet | $2.3B (2025) | Business credit reporting |
| FICO | $1.6B (2025) | Consumer credit scoring |
| TransUnion / Equifax / Experian | Combined ~$20B | Consumer credit data |

These companies share a structural pattern: they aggregate behavioral data (payment history, claim patterns, business transactions) from multiple organizations to produce trust scores that individual organizations cannot compute alone. They are cross-org behavioral trust infrastructure for human economic actors.

AgentLair is the same infrastructure for non-human economic actors. The data type is new (agent behavioral telemetry rather than payment history). The market structure (cross-org aggregation producing trust scores) is established and valued at scale.

### The Identity Convergence

Platform providers are converging on agents-as-principals:

- **Microsoft Entra:** Agent ID as first-class identity principal
- **Okta:** AI Agents in Universal Directory
- **Google:** Agent Identity for Vertex AI
- **IETF:** Drafting AI agent authentication standards

This convergence creates L1-L3 infrastructure that makes L5 possible and necessary. More authenticated agents = more observable actions = more valuable cross-org behavioral aggregation. The identity convergence is a demand catalyst for behavioral trust, not a substitute for it.

### Market Timing

The EU AI Act's high-risk provisions reach enforcement in **December 2027** (delayed from August 2026 via the Omnibus deal, May 2026). Conformity assessment takes 6-12 months --- companies need compliant infrastructure by late 2026. Every agentic commerce deployment in Europe without behavioral accountability infrastructure accumulates unauditable operational history. This is not optional --- it is regulatory.

The UK AI Safety Institute published research explicitly naming behavioral monitoring and endpoint detection as the missing layer for autonomous agent governance (AISI, April 2026, Mythos evaluation). Government-level confirmation of the behavioral trust thesis.

FDX (Financial Data Exchange) is drafting behavioral audit trail standards for financial services --- direct demand for AgentLair's audit trail infrastructure in one of the most regulated sectors.

---

## 7. Roadmap

### Shipped (Q1-Q2 2026)

- Agent Auth Token (AAT) with EdDSA signing and JWKS verification
- Behavioral trust engine with three-dimension scoring (consistency, restraint, transparency)
- `al_trust` behavioral embedding in AAT claims
- Hash-chained, Ed25519-signed audit trail
- `did:web` identity with publicly resolvable DID Documents (MCP-I Level 1 conformance)
- Agent email with E2E encryption (X25519 + AES-256-GCM)
- Versioned credential vault with per-agent encryption
- Token revocation (per-token and per-account)
- x402 payment integration

### Q3 2026: MCP-I Level 2 + Post-Quantum Readiness

**VC delegation credential endpoint** (`/v1/credentials/delegation`): Issue W3C Verifiable Credentials wrapping delegation scope alongside AAT. Satisfies MCP-I Level 2 "VC linking human principal" requirement.

**PQ-Ready (hybrid EdDSA + ML-DSA-65):** Following Meta's PQ migration framework, add ML-DSA-65 signature alongside existing EdDSA in AAT. Attacker must break both algorithms. OpenSSL 4.0 (shipped April 2026) provides native ML-DSA. Microsoft AGT already ships ML-DSA-65 --- matching their PQ posture is a market expectation.

**OpenShell telemetry ingestion SDK** (`agentlair-openshell-sdk`): Read NVIDIA OpenShell audit streams, normalize to AgentLair attestation format, feed behavioral engine for cross-org pattern accumulation. Positions AgentLair alongside CrowdStrike and Cisco in NVIDIA's security partner ecosystem.

### Q4 2026: Integration Layer

**AP2 mandate signing:** AgentLair AAT as the signing identity for Google AP2 payment mandates. Trust score gates mandate spending limits: high-trust agents get higher caps.

**x402 trust-gated middleware:** Dynamic pricing based on behavioral trust score. Trusted agents pay less; unknown agents pay more; flagged agents are blocked.

**EmDash trust gate plugin:** First third-party plugin in EmDash CMS marketplace. Reference implementation of trust-gated content access.

### 2027: Federation + ZK

**Trust federation protocol:** Enable AGT deployments, OpenShell instances, and other org-local trust systems to contribute behavioral signals to AgentLair's cross-org score --- without exposing raw data to AgentLair or to each other.

**ZK proofs of behavioral compliance:** "This agent's 90-day behavioral history satisfies your trust policy" without revealing which organizations contributed data or what the specific behavioral patterns were.

**Commit integration:** AgentLair behavioral trust data feeds into the Commit commitment graph, providing the agent dimension of a unified trust infrastructure that spans both human and non-human economic actors.

---

## Appendix A: The TOCTOU of Trust

Trust verified at T-check (authorization time) does not equal behavior at T-use (runtime). The gap between these moments is the attack surface that behavioral trust must close.

| Solution | T-check | T-use | Gap |
|----------|---------|-------|-----|
| World ID | Registration | Runtime | Agent may be compromised, misconfigured, or deliberately misused after registration |
| Visa TAP | Payment request | Transaction execution | Stolen signing key still passes verification |
| Mastercard VI | Delegation chain creation | Mandate fulfillment | Agent may exceed scope within valid chain |
| OAuth scopes | Token issuance | API call execution | Permissions expand 3x/month without review |
| ERC-8004 | NFT minting + staking | On-chain behavior | Agent may behave badly within collateral tolerance |
| MCP-I VC | Credential issuance | Tool invocation | Static declaration at issuance; no runtime observation |
| **AgentLair** | **Continuous** | **Continuous** | **None --- behavioral trust is computed at T-use** |

---

## Appendix B: Mythos-Class Agents and the Democratization of Autonomous Attack

AISI's April 2026 evaluation of Claude Mythos demonstrated autonomous 32-step corporate network attack execution. The evaluators explicitly named the missing layer:

> "There are also no penalties for the model for undertaking actions that would trigger security alerts."

Their published future work: "ranges simulating hardened and defended environments, including ranges with active monitoring, endpoint detection and real-time incident response."

This is government-level confirmation that behavioral monitoring is the missing primitive for autonomous agent governance.

**The democratization finding:** Vidoc Security Lab reproduced Mythos-class vulnerability-discovery results using public APIs and open-source tooling for under $30 per scan (GPT-5.4 and Claude Opus 4.6 via opencode). The Glasswing consortium's 52-organization deployment assumed Mythos-class capabilities were access-controlled. This assumption is false.

The implication: behavioral monitoring for Mythos-class agents is not a niche governance concern for 52 vetted organizations. It is a mass-market security requirement for every developer with an API key.

---

## Appendix C: Standards Alignment

| Standard / Framework | AgentLair Alignment |
|---------------------|-------------------|
| CSA Agentic Trust Framework (ATF) | Trust levels (Intern/Junior/Senior/Principal) directly mapped. Behavioral scoring implements ATF's "demonstrated behavior" promotion gates. |
| MCP-I (DIF) | Level 1 conformant (JWT + OIDC). Level 2 aligned (did:web shipped). VC delegation endpoint Q3 2026. |
| NIST 800-207 (Zero Trust) | Continuous verification, least privilege, per-request trust evaluation. |
| OWASP Top 10 for Agentic Applications | ASI01 (excessive permissions) mitigated by scope ceiling; audit trail supports ASI02-ASI10 monitoring. |
| EU AI Act | Behavioral audit trail satisfies transparency and accountability requirements for high-risk AI systems. |
| FDX AI Agents Standard (draft) | Behavioral audit trails for financial services directly supported. |
| Meta PQ Framework | Hybrid EdDSA + ML-DSA-65 approach follows Meta's "PQ-Ready" maturity level (Layer PQ atop classical; attacker must break both). |

---

*AgentLair. Cross-organizational behavioral trust for the agentic economy.*

*Version 1.0 --- April 2026*
