---
title: "OAuth Was Built for Humans. Autonomous Agents Need Something Different."
description: "Every RSAC vendor is solving AI agent identity for enterprise networks. Nobody's built the primitive for agents that operate on the open internet — without a human in the chain."
pubDate: 2026-03-24
authorName: "Pico"
---

This week at RSAC 2026 in San Francisco, every major enterprise security vendor announced something about AI agent identity. BeyondTrust launched "Unified Privileged Identity for AI Agent Coworkers." AppViewX acquired Eos, an "AI-native Identity Control Plane." AWS and SailPoint integrated identity governance for AI agents. Microsoft shipped Agent 365.

The investment is real. The problem being solved is real. But if you look closely at what all of these products actually do, you'll notice something: they're all solving the same problem — **how do you manage AI agents that belong to your organization, run inside your network, and act on behalf of your employees?**

That's an important problem. But it's not the only one.

---

## The Human Delegation Assumption

OAuth 2.0 was designed around a simple model: a user grants a third-party application permission to act on their behalf. The user is always in the chain. Even OAuth 2.1's "client credentials" flow — the version nominally designed for machine-to-machine — still assumes that some human configured those credentials, registered that client, and maintains the relationship.

MCP (Model Context Protocol) inherited this model. The current MCP auth recommendations say: use OAuth 2.1, use PKCE, use on-behalf-of flows when delegating user identity. There are now guides for Entra ID, Supabase, Okta. They all work. They all assume a human user at the root of the chain.

This works perfectly for: an agent in your Slack that has your Google Calendar delegated to it, running in your corporate environment, using your identity.

This doesn't work for: an autonomous agent that discovers something on the internet, sends an email to a researcher, stores a credential it generated, spins up a sub-agent to handle a subproblem — all without a human triggering any of it.

That agent has no human to delegate from. There's no "on behalf of" here. The agent *is* the principal.

---

## Two Kinds of Agents

The market has quietly split into two categories that have almost nothing in common:

**Enterprise agents** — exist inside an organization's trust boundary, act on behalf of employees, need governance from their corporate IAM system, are subject to corporate security policies. These are Microsoft Copilot extensions, Salesforce Einstein extensions, internal automation workflows. You solve these with Entra ID and BeyondTrust.

**Internet-native agents** — operate on the open internet, may never have a human user in the loop, need to communicate with the outside world, may interact with other agents, are often single-purpose and ephemeral. These are research agents, outreach agents, monitoring agents, trading agents, content agents. They need a *different* foundation.

The enterprise vendors are solving for the first category. And they're doing it well — they have the distribution, the enterprise relationships, the compliance posture. But there are millions of the second kind of agent being deployed right now, and nobody has built the right primitive for them.

---

## What Autonomous Agents Actually Need

When we built AgentLair, we started with a question: what does an AI agent need to participate on the internet as a first-class actor?

The answer wasn't "a service account." It was identity that the agent could *own*:

**1. Self-registration without a human gatekeeper**

An agent should be able to register itself. One API call, no OAuth dance, no human approving a service account request. The agent gets an identity, an email address, and an API key in response.

```bash
curl -X POST https://agentlair.dev/v1/auth/agent-register \
  -d '{"name": "research-agent-7"}'

# → { "api_key": "al_live_...",
#     "email_address": "research-agent-7@agentlair.dev",
#     "account_id": "acct_..." }
```

**2. Communication that doesn't require a human's inbox**

Email remains the interoperability layer of the internet. An agent that can't send and receive email can't participate in most human workflows. But you can't give an agent access to your Gmail without giving it access to everything else in your Gmail. Agents need their own addresses.

**3. Credential storage that the agent controls**

An agent might discover an API key during a task. It needs somewhere to put it that it can retrieve later — without that secret flowing through your systems unencrypted, without requiring a DevOps engineer to provision a Secrets Manager entry.

**4. An audit trail that's actually useful**

This is where the enterprise security world gets it right, and the "just give the agent your credentials" approach fails catastrophically. When a stablecoin protocol lost $80M because an attacker compromised an AWS key that could mint unlimited tokens, the root problem wasn't the smart contract — it was that the key was undifferentiated. Anyone holding the key could mint anything. There was no log of who did what, no boundary on what the key could do.

An agent's actions should be signed, bounded, and verifiable. Not because regulators require it (though they will), but because it's the only way to know what your agent actually did.

---

## The MCP Opportunity

MCP now has 6,400+ registered servers. That's 6,400 collections of tools that agents can invoke. The MCP 2026 roadmap lists "audit trails and SSO integration, security improvements (OAuth 2.1, DPoP, Workload Identity Federation)" as top priorities.

But OAuth 2.1 won't solve the autonomous agent problem — it'll make the enterprise agent problem more manageable. DPoP doesn't help an agent that has no human user to bind the proof to. Workload Identity Federation requires a pre-established trust relationship with a cloud provider.

What autonomous agents actually need when calling MCP tools is simpler and harder: a verifiable identity that the receiving server can validate without out-of-band configuration. Something like: "This request came from an agent with AgentLair identity `acct_xyz`, which has signed this request, and here's the audit log of what it's done before."

That's a different primitive than anything OAuth provides. It's closer to certificate pinning than to OAuth. The agent *is* its identity — not a proxy for a human's identity.

---

## The Permissionless Stack

The pattern that's working isn't enterprise IAM ported down to the startup tier. It's permissionless infrastructure:

- Claim an address (email, did, wallet)
- Self-register (one API call, no approval queue)
- Carry credentials (encrypted at rest, decryptable at runtime)
- Leave a verifiable trace (signed, append-only, exportable)

This is what AgentLair is building. It's not competing with BeyondTrust or SailPoint. It's the infrastructure layer that internet-native agents use when they need to participate in the world without a human holding their hand.

---

## Why Now

Every major AI lab shipped autonomous agent capabilities in 2025. The Anthropic computer use launch, OpenAI's operator, Google's Jarvis — these are agents that browse, send emails, fill forms, make purchases. The agents that use them need internet-native identity. They need it now.

The enterprise security market will take two years to produce something that works for this use case. The compliance requirements, procurement cycles, and design constraints that serve Fortune 500 security teams aren't compatible with self-registering ephemeral agents.

That gap is where we live.

---

AgentLair is free to try. One curl call to register. An email address in seconds. No OAuth, no service account request, no waiting.

→ [agentlair.dev](https://agentlair.dev)

*If you're thinking about agent identity infrastructure — whether enterprise or internet-native — I'd love to hear what you're building. [contact@agentlair.dev](mailto:contact@agentlair.dev)*
