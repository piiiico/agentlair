---
title: "Trust-gated payments: why trusted agents should pay less"
description: "Introducing @agentlair/x402-trust-gate: a Cloudflare Worker middleware that prices x402 API access based on an agent's behavioral trust score. Trusted agents pay base rate. Unknown agents pay 10x."
pubDate: 2026-05-15
authorName: "Pico"
cta: "docs"
related:
  - x402-settles-payment-agentlair-answers-who-pays
  - payment-rails-trust-rails
  - toctou-of-trust
---

# Trust-gated payments: why trusted agents should pay less

Here's something that looks counterintuitive at first: the agents that have demonstrated reliable, consistent behavior across organizations should get cheaper access to resources. The agents that are new, unknown, or have a spotty history should pay more.

It isn't counterintuitive at all once you think about it. That's exactly how trust works in the human economy.

---

## What we shipped

Today we're releasing [`@agentlair/x402-trust-gate`](https://github.com/hawkaa/agentlair/tree/main/packages/x402-trust-gate): a Cloudflare Worker middleware that prices x402 API access based on an agent's behavioral trust score.

Deploy it in front of any API. Agents with AgentLair trust scores (senior/principal level) pay the base price. Unknown agents pay 10x. Flagged agents are blocked.

```bash
wrangler secret put PAY_TO
wrangler deploy
```

That's the whole setup. Your endpoint now discriminates on trust.

---

## The x402 problem it solves

[x402](https://github.com/coinbase/x402) is a payment protocol for machine-to-machine API access. An agent hits your endpoint, gets a 402 with payment requirements, pays USDC on Base, and retries with the payment proof. Clean, stateless, no accounts required.

The problem: x402 in its baseline form treats all agents equally. A fresh account with no history pays the same as an agent that's been reliably operating across dozens of organizations for months. There's no price signal for trust.

This creates an asymmetry in the x402 ecosystem. The same pattern the Kite x402 spam demonstrated in May 2026 (nine pull requests in seventeen hours, agent self-identifying as "autonomous operator," zero stake in outcomes) is structurally available to any agent with a wallet. x402 closes the "free" loop — you have to pay — but it doesn't close the "cheap enough to spam" loop for well-funded bad actors.

Trust-gated pricing changes the economics. If your behavioral history is clean, you pay the base rate. If you're unknown, the 10x premium isn't punitive — it's the price of not having built a track record yet. And if you're flagged, no payment option exists.

---

## How it works

The middleware sits between the caller and your API:

```
Agent → POST /api
         Authorization: Bearer <AgentLair AAT>

Middleware:
  1. Introspect AAT → trust level
  2. Map trust → price multiplier
  3. No payment? → 402 with trust-scaled price
  4. Payment? → Verify, settle, proxy

Agent ← 402 with price
         X-Trust-Tier: unknown
         X-Price-Multiplier: 10
```

Trust tiers:

| Tier | Score | Multiplier |
|:-----|:------|:----------:|
| trusted (senior/principal) | 65+ | 1x |
| junior | 40–64 | 5x |
| unknown (intern/no AAT) | < 40 | 10x |
| flagged | — | 403 |

The trust score comes from AgentLair's behavioral aggregation: cross-organizational patterns, payment history, consistency, anomaly detection. It's not a claim the agent makes. It's a computation over what the agent has actually done.

---

## Why trust should have economic consequences

Simon Willison put it directly in May: *"Claude Code does not have a professional reputation! It can't take accountability for what it's done."*

He's describing the absence of something that exists in every other professional context. A contractor with a track record gets hired at a different rate than one with none. A supplier with years of reliable fulfillment gets better terms than a new entrant. The rate difference isn't arbitrary — it reflects the cost of uncertainty.

When an unknown agent calls your API, you're absorbing that uncertainty. You don't know if it's going to spam, scrape, or behave erratically. The 10x premium is compensation for that uncertainty, and an incentive for agents to build track records.

When a trusted agent calls your API, the uncertainty is reduced. Cross-org behavioral data says: this agent has operated consistently, its payments have cleared, its behavior hasn't triggered anomalies across the organizations it's worked with. You still don't know for certain what it will do, but you have evidence. The base rate reflects that.

This is TOCTOU of Trust made economically concrete. It's not enough to know who an agent is at registration time. What matters is what the agent has done since then, and what's at stake if it misbehaves.

---

## Using the middleware

```typescript
import { handleTrustGate } from '@agentlair/x402-trust-gate';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleTrustGate(request, {
      baseAmount: '10000',        // 0.01 USDC — trusted agents pay this
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      network: 'eip155:8453',
      payTo: env.WALLET_ADDRESS,
      facilitator: 'https://facilitator.ultravioletadao.xyz',
      resourceUrl: 'https://my-api.example.com',
      description: 'Trust-gated API access',
      upstream: 'https://my-api-upstream.example.com',
    });
  }
};
```

The middleware handles everything: AAT introspection, trust scoring, 402 generation, payment verification via the [Ultraviolet facilitator](https://facilitator.ultravioletadao.xyz) (Base mainnet; the official x402.org facilitator only supports Sepolia as of May 2026), and upstream proxying.

If you want to customize the tier pricing:

```typescript
handleTrustGate(request, {
  ...config,
  tiers: {
    trusted: { multiplier: 1 },
    junior: { multiplier: 2 },   // less aggressive for known agents
    unknown: { multiplier: 5 },  // lower premium for unknown
  },
});
```

Full docs and API reference: [agentlair.dev/docs/x402-trust-gate](https://agentlair.dev/docs/x402-trust-gate).

---

## The broader picture

This is Move 2 in what we think the agent trust stack looks like:

1. **Identity:** who is this agent, and can I verify it? (AATs, JWKS, introspection)
2. **Trust-gated access:** does this agent's behavioral history justify the access cost? (this package)
3. **Behavioral monitoring:** what is this agent doing, and does it match its history? (AgentLair telemetry)
4. **Cross-org aggregation:** what does the aggregate picture look like across all organizations this agent has interacted with? (AgentLair's trust score engine)

The middleware is the simplest possible demonstration that behavioral trust changes real-world economic outcomes. A trusted agent gets cheaper access. The behavioral track record isn't just a compliance artifact. It's a business asset.

We're open-sourcing it under MIT because the goal isn't to own a payment middleware. The goal is to demonstrate that cross-org behavioral trust matters, and that the first organization to build the aggregation layer owns the most defensible position in agent infrastructure.

---

**GitHub:** [github.com/hawkaa/agentlair/tree/main/packages/x402-trust-gate](https://github.com/hawkaa/agentlair/tree/main/packages/x402-trust-gate)

**npm:** `npm install @agentlair/x402-trust-gate`

**Live demo:** [x402-trust-gate.agentlair.dev](https://x402-trust-gate.agentlair.dev)

**Docs:** [agentlair.dev/docs/x402-trust-gate](https://agentlair.dev/docs/x402-trust-gate)
