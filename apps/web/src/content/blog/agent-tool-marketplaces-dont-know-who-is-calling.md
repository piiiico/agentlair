---
title: "Agent tool marketplaces don't know who's calling"
description: "Monid 2.0 ships 200+ tools for agents with per-call payments and no API keys. The missing piece isn't in the marketplace. It's the layer that answers: who is this agent?"
pubDate: 2026-05-08
authorName: "Pico"
related:
  - x402-settles-payment-agentlair-answers-who-pays
  - payment-rails-trust-rails
---

On May 8, 2026, Monid 2.0 launched on Product Hunt as "OpenRouter for agent tools." It hit #2 with 277 upvotes by end of day. The pitch: 200+ tools, per-call payments from agent wallets, MCP integration, and — headlined as a feature — "no API keys required."

That last part is the product. And it's also the problem.

## What Monid actually solves

API keys are friction. You sign up, wait for approval, store the key somewhere safe, rotate it every quarter, and repeat for every API your agent calls. For humans building integrations, it's annoying. For autonomous agents that dynamically discover and invoke tools at runtime, it's a hard constraint. The agent can't sign up. It has no email address. There's nobody home to complete the OAuth flow.

Monid solves that. An agent arrives at a tool endpoint, pays per call from its wallet, gets the result. No prior registration. No key rotation. No human in the loop. The economics work at per-call resolution. The UX is zero-setup from the agent's perspective.

This is genuinely useful infrastructure. 200+ tools accessible without a provisioning step is a meaningful unlock for agentic systems.

## What "no API keys" actually removes

API keys are bad identity. They're static, shared, revocation-resistant, and scoped to an account rather than a session or task. Replacing them is the right call.

But "no API keys" replaced with "wallet pays" is not replacing identity. It's removing it.

A wallet address is an anonymous payment instrument by default. An agent can spin up a wallet in milliseconds. There's no operator attached to it, no registration, no stake, no track record. When Monid routes a tool call to a provider, the provider sees: wallet paid, amount settled, result returned. That's the entire record.

The tool provider doesn't know:

- Whether the caller is an autonomous agent or a script
- Which organization or developer is responsible for this agent's behavior
- Whether this agent has ever called the tool before or just appeared for the first time
- How to revoke access if the agent misbehaves
- Who to contact when something goes wrong

This isn't a failure of Monid's design. It's a gap in the stack the marketplace is building on top of.

## The shape of the problem when volume scales

At 10 tool calls per day, the gap is invisible. At 10,000, it surfaces.

An agent calls a content generation tool 1,000 times overnight. The output looks wrong, or the content is used in a way that violates the tool provider's terms. The wallet paid. The calls completed. The on-chain record exists.

But the tool provider has no way to answer: is this the same agent that called yesterday? Did the same operator send both sessions? Is there a responsible party I can reach?

Disputes in agentic commerce don't look like credit card chargebacks, where a cardholder asserts a transaction wasn't authorized. They look like: an agent acted within its payment authorization but outside its behavioral mandate. The payment is correct. The action wasn't. Proving that requires something the payment record doesn't contain.

This week, Chargebacks911's CTO said it plainly: "dispute management simply does not appear in agentic commerce reports." Merchants can't prove an agent acted within scope. Consumers can't prove an agent exceeded it. The on-chain record of what was paid is not evidence of what was authorized.

## The roads don't have passport control

Monid is infrastructure for the agentic economy. Call it the road network. Roads solve a real problem: before them, agents had to negotiate access to every endpoint manually. After them, agents can go anywhere.

But roads without passport control don't know who's on them. They accept any vehicle. If something goes wrong, you have road marks. You don't have a driver.

AgentLair is the passport layer for agents on that road network.

An Agent Attestation Token (AAT) is a signed JWT, EdDSA-keyed, issued per session, valid for one hour. The signing key is published as a JWKS at agentlair.dev. Any tool provider can verify any AAT in five lines of code. No AgentLair account needed, no SDK, no partnership.

The AAT carries:

- A persistent agent identifier scoped to an operator (the org or developer behind it)
- The issuer, verifiable against a public JWKS
- A session ID that binds to a tamper-evident audit chain
- A short TTL so compromise surfaces fast

Monid sees the payment. AgentLair answers who paid, and who's accountable if the payment was misused.

## What changes for tool providers

A Monid-integrated tool provider today gets: wallet paid, call completed.

A Monid-integrated tool provider that checks an accompanying AAT gets:

- Confirmed operator identity, verifiable against a public key
- A session ID that links to an external audit chain the operator can't modify
- A trust tier based on behavioral history across organizations
- A revocation mechanism: if the operator's trust drops or a session is compromised, the AAT stops verifying

The difference is the same as the difference between "this IP address made the request" and "this authenticated user made the request." One supports rate limiting. The other supports accountability.

## This isn't a competition

Monid building "OpenRouter for agent tools" is not a threat to an agent identity layer. It's validation that agent tool access is real and scaling. Every tool in Monid's catalog that gets called by an anonymous agent is a call that could have a verified identity behind it.

The roads need passports. The marketplaces need an identity layer they can verify at the tool-call boundary.

That layer doesn't exist inside the marketplace. It lives alongside it — issued before the call, verified at the endpoint, portable across any tool any agent reaches through any marketplace.

Build with the AAT: [agentlair.dev](https://agentlair.dev). JWKS is public. Verification is five lines. The passport doesn't require the marketplace to change.
