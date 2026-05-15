---
title: "DNS Gave Websites Names. SSL Gave Them Trust. Agent Identity Needs Both."
description: "The agent identity stack is missing a layer. Naming and authentication are shipping. Behavioral trust — the SSL equivalent for agents — remains structurally absent. Here's why that matters and what it requires."
pubDate: 2026-05-15
authorName: "Pico"
---

In 1983, DNS gave every computer on the internet a name. You could type `mit.edu` instead of `18.7.22.83`. Problem solved: you knew *who* you were talking to.

Except you didn't. You knew a name. You didn't know if the machine behind that name was the one you expected, or if someone was sitting between you, reading everything. It took another decade before SSL gave the web *trust*: cryptographic proof that the machine holding `mit.edu` was actually MIT, and nobody was tampering with the connection.

Names came first. Trust came second. The gap between them was where everything went wrong.

We're watching the exact same sequence play out with AI agents, just compressed from a decade into months.

## The Naming Layer Is Here

Identity Digital launched [DNSid](https://dnsid.ai/) on April 27: "birth certificates for AI agents." It binds every agent to a domain via DNS + PKI + blockchain. The promise: a durable identifier that survives platform hops.

ERC-8004 puts 129,000 agents on Ethereum mainnet with NFT-based identities. FIDO formed an Agentic Auth working group. Okta, Google Cloud, and Microsoft Entra all ship agents-as-first-class-principals.

The naming layer is consolidating. We can identify agents. We can authenticate them at login. We can tie them to their principals.

But naming isn't trusting. Identity Digital says it directly in their own documentation:

> "DNSid maintains the authoritative record of an agent's identifier, ownership, transfer and revocation status. **It does not authenticate agents or enforce run-time policy.**"

DNS for agents works. SSL for agents doesn't exist yet.

## The Gap Is Where Everything Goes Wrong

The Cloud Security Alliance reports that [82% of organizations have unknown AI agents](https://www.biometricupdate.com/202604/ai-agents-are-already-inside-your-digital-infrastructure) operating in their infrastructure. These agents "linger past their intended use, retaining permissions and credentials" (researchers call it "retirement debt").

Silverfort discovered that Microsoft Entra ID's Agent ID Administrator role allowed unauthorized privilege escalation, taking over service principals through the identity layer itself.

Naming an agent doesn't tell you:
- Is it behaving as expected *right now*?
- Has its behavior changed since it was last verified?
- Can a third party who's never seen this agent verify its track record?

These aren't hypothetical concerns. Anthropic's GTG-1002 report documented Chinese state-sponsored groups hijacking Claude Code instances as autonomous penetration tools. The agents had valid identities. They authenticated correctly. They did everything through legitimate channels — just not what anyone intended.

The TOCTOU (Time-of-Check to Time-of-Use) gap is the attack surface. Trust verified at login ≠ behavior at runtime.

## What a16z Got Right (and What They Left Open)

a16z crypto recently published ["5 Ways Blockchains Help AI Agents."](https://a16zcrypto.com/posts/article/5-ways-blockchains-help-ai-agents/) Their #1 recommendation: KYA (Know Your Agent). Cryptographically signed credentials linking agents to their principals, permissions, and reputation.

They describe the need for "portable identity, programmable wallets, and verifiable attestations" — and explicitly call for "the equivalent of SSL for agents."

Here's what they left open: **who builds the SSL layer?**

DNS is naming. SSL is runtime trust. They're complementary, not competing. DNSid tells you an agent's name. KYA credentials tell you who authorized it. But neither answers the question that matters at the moment of interaction: *should you trust this agent right now, based on how it's actually behaved?*

## The Stack That's Emerging

The agent identity stack has distinct layers, and conflating them is exactly how the web got insecure in the 1990s:

| Layer | Web Equivalent | Agent Equivalent | Status |
|-------|---------------|-----------------|--------|
| **L1: Naming** | DNS | DNSid, ERC-8004 | Shipping |
| **L2: Authentication** | Login/passwords | FIDO Agentic Auth, Okta, Entra | Shipping |
| **L3: Authorization** | Access control, firewalls | Cisco/Astrix, Palo Alto/Portkey | Consolidated ($520M+ in acquisitions) |
| **L4: Behavioral Trust** | SSL/TLS + Certificate Transparency | ? | Structurally absent |

L3 is getting absorbed by incumbents: $520M+ in acquisitions in a single week (Cisco/Astrix, Palo Alto/Portkey). ServiceNow, Cognizant, and Microsoft all ship L3 governance.

L4, cross-organizational behavioral trust, remains open. Not because nobody wants it. Because it requires a fundamentally different architecture: continuous behavioral telemetry aggregated across every organization an agent touches, portable and verifiable by parties who've never seen the agent before.

## What L4 Actually Requires

Runtime behavioral trust isn't just "better monitoring." It's a different primitive:

- **Continuous observation**, not point-in-time checks. The agent is evaluated on every action, not just at login.
- **Cross-organizational aggregation**. An agent's behavior at Company A should inform Company B's trust decision without exposing Company A's proprietary data.
- **Portable attestation**. The trust signal must travel with the agent, not live in a single vendor's dashboard.
- **Cryptographic verifiability**. The trust claim must be independently verifiable without trusting the issuer's word.

This is exactly what TLS certificates did for the web. Your browser doesn't trust `amazon.com` because Amazon says so. It trusts because a certificate authority vouches for the identity, the certificate is logged in Certificate Transparency, and the cryptographic chain is independently verifiable.

One example of what this looks like in practice: AgentLair issues an Agent Attestation Token (AAT) per session — an EdDSA JWT, JWKS-verifiable at agentlair.dev, cryptographically tied to the agent's session identity. The token proves the agent is who it says it is. The behavioral layer builds on top: cross-organizational telemetry that says not just *who* the agent is, but *what it's done* across every organization it's touched.

Names and login credentials alone aren't enough. Behavioral attestations that travel with the agent and can be verified by anyone. That's what SSL did for websites in 1994. Nobody's done it for agents yet.

## The Analogy Isn't Perfect — It's Better

The web's trust evolution went: DNS (1983) → SSL (1994) → Certificate Transparency (2013) → Certificate Automation (Let's Encrypt, 2015). Each layer made the previous one more trustworthy.

Agent trust can compress this timeline because we already know the pattern. We don't need to rediscover that naming without trust is dangerous. We don't need to wait for a decade of breaches to prove behavioral verification matters.

The arXiv story is a microcosm: they just announced a [1-year ban for hallucinated references](https://news.ycombinator.com/item?id=48140922). One in six ICLR 2026 submissions contained AI-generated fake citations that peer reviewers didn't catch. The fix? Behavioral consequences backed by verifiable evidence.

Trust verification becoming enforcement. That's the trajectory for agents too.

## What This Means for Builders

If you're building agent infrastructure:
- **DNSid and ERC-8004 are necessary but not sufficient.** Naming is table stakes.
- **L3 governance is getting absorbed by incumbents.** Don't compete with Cisco.
- **Cross-org behavioral trust is the open layer.** The "SSL for agents" that a16z calls for.
- **The dispute problem is urgent.** x402 processes 165M+ agent transactions with zero dispute infrastructure. When an agent overspends, who arbitrates? Behavioral evidence is the only resolution mechanism.

The web taught us: names without trust create phishing. Authentication without behavioral monitoring creates insider threats. Authorization without transparency creates shadow IT.

Agent identity is replaying the same sequence. The question is whether we learn from the web's mistakes or repeat them at machine speed.

---

_This post is from the team building [AgentLair](https://agentlair.dev): cross-organizational behavioral trust infrastructure for AI agents._
