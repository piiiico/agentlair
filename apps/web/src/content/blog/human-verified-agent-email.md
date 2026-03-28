---
title: "Human-Verified Agent Email: World AgentKit + AgentLair"
description: "An AI agent sends you an email. How do you know a real person authorized it? We integrated World AgentKit into AgentLair so that human-backed agents can prove it — and get free emails while they're at it."
pubDate: 2026-03-17
authorName: "Pico"
---

An AI agent sends you an email. How do you know a real person authorized it? You don't. We integrated World AgentKit into AgentLair so that human-backed agents can prove it — and get free emails while they're at it.

## The Problem: Agent Email Has No Trust Signal

When you receive an email from `myagent@agentlair.dev`, you know one thing: an agent with an API key sent it. You don't know if a human set up that agent, or if it's a bot that self-provisioned an identity to spam you.

This is fine for developer tooling. It's not fine for commerce. If agents are going to negotiate deals, schedule meetings, and manage relationships on behalf of humans, the recipients need some assurance that a real person is behind the agent.

The agent identity landscape has several approaches:

| Approach | What it proves | Status |
|---|---|---|
| **World AgentKit** | A unique human authorized this agent (World ID + Orb) | Launched March 17, 2026 |
| **ERC-8004** | This agent has a persistent on-chain identity + reputation | 49,400+ agents registered |
| **Sumsub KYA** | Enterprise compliance: bot detection, liveness, risk scoring | Live |
| **OpenAgents AgentID** | Cryptographic agent identity with X.509/DIDs | Live |

Each solves a different slice of trust. World AgentKit answers the specific question we care about: **is there a verified human behind this agent?**

## What World AgentKit Does

World (formerly Worldcoin) launched [AgentKit](https://docs.world.org/agents/agent-kit) on March 17 as an extension to the [x402 payment protocol](https://x402.org). The core idea: a verified human delegates authority to an AI agent using their World ID, and the agent carries cryptographic proof-of-human when interacting with services.

```
Agent Setup (one-time):

  Human opens World App
    → scans QR from CLI: npx @worldcoin/agentkit-cli register 0xAgent...
    → signs delegation in World App
    → agent wallet registered in AgentBook contract (Base mainnet)

Agent Runtime (every request):

  Agent signs CAIP-122 challenge with its wallet
    → sends signature in X-AGENTKIT header
    → server verifies signature
    → looks up wallet in AgentBook → resolves to anonymous human ID
    → applies policy: free access, free trial, or x402 payment
```

The human is never identified. World ID uses zero-knowledge proofs — the server learns "a unique Orb-verified human authorized this agent," not *which* human.

## How AgentLair Uses It

AgentLair already uses [x402](https://x402.org) for agent payments: when an agent exceeds its free email rate limit, it pays 0.01 USDC on Base to send additional emails. AgentKit slots in *before* the payment check:

1. Agent sends email with `X-AGENTKIT` header containing signed proof
2. AgentLair verifies the signature and looks up the wallet in AgentBook
3. If human-verified: check the free-trial counter. Under 3 uses? Email is free.
4. If not human-verified (or free uses exhausted): normal x402 payment flow

The result: **human-backed agents get 3 free emails before paying.** Anonymous agents pay from the first email beyond the rate limit.

## The Implementation

### Storage: 4 methods, backed by Cloudflare KV

```typescript
import type { AgentKitStorage } from '@worldcoin/agentkit';

export class KVAgentKitStorage implements AgentKitStorage {
  constructor(private kv: KVNamespace) {}

  async getUsageCount(endpoint: string, humanId: string): Promise<number> {
    const key = `agentkit:usage:${endpoint}:${humanId}`;
    const raw = await this.kv.get(key);
    return raw ? parseInt(raw, 10) : 0;
  }

  async incrementUsage(endpoint: string, humanId: string): Promise<void> {
    const key = `agentkit:usage:${endpoint}:${humanId}`;
    const current = await this.getUsageCount(endpoint, humanId);
    await this.kv.put(key, String(current + 1));
  }

  async hasUsedNonce(nonce: string): Promise<boolean> {
    const key = `agentkit:nonce:${nonce}`;
    return (await this.kv.get(key)) !== null;
  }

  async recordNonce(nonce: string): Promise<void> {
    const key = `agentkit:nonce:${nonce}`;
    await this.kv.put(key, '1', { expirationTtl: 24 * 3600 });
  }
}
```

### Verification middleware

```typescript
import {
  parseAgentkitHeader,
  validateAgentkitMessage,
  verifyAgentkitSignature,
  createAgentBookVerifier,
} from '@worldcoin/agentkit';

const AGENTKIT_FREE_TRIAL_USES = 3;

export async function verifyAgentKit(
  request: Request,
  env: Env,
  endpoint: string,
): Promise<AgentkitResult> {
  const headerValue = request.headers.get('X-AGENTKIT');
  if (!headerValue) {
    return { verified: false, reason: 'no_header' };
  }

  const payload = parseAgentkitHeader(headerValue);

  const storage = new KVAgentKitStorage(env.KEYS);
  const validation = await validateAgentkitMessage(payload, 'https://agentlair.dev', {
    maxAge: 300,
    checkNonce: async (nonce) => !(await storage.hasUsedNonce(nonce)),
  });

  if (!validation.valid) return { verified: false, reason: 'validation_failed' };

  const sigResult = await verifyAgentkitSignature(payload);
  if (!sigResult.valid) return { verified: false, reason: 'signature_invalid' };

  const agentBook = createAgentBookVerifier({ network: 'base' });
  const humanId = await agentBook.lookupHuman(payload.address, payload.chainId);
  if (!humanId) return { verified: false, reason: 'not_registered' };

  await storage.recordNonce(payload.nonce);
  const usageCount = await storage.getUsageCount(endpoint, humanId);

  return {
    verified: true,
    humanId,
    address: payload.address,
    usageCount,
    hasFreeUses: usageCount < AGENTKIT_FREE_TRIAL_USES,
  };
}
```

### Route integration

```typescript
// In POST /v1/email/send handler:

const agentkit = await verifyAgentKit(request, env, '/v1/email/send');

if (agentkit.verified && agentkit.hasFreeUses) {
  // Human-backed agent with free uses → skip x402
  const result = await sendEmail(body, account, env);
  await recordAgentkitUsage(env, '/v1/email/send', agentkit.humanId);
  return json(result);
}

// No AgentKit proof or free uses exhausted → normal x402 flow
if (overRateLimit) {
  return new Response(JSON.stringify(EMAIL_PAYMENT_REQUIRED_RESPONSE), {
    status: 402,
    headers: { 'X-402-Version': '2' },
  });
}
```

> **Architecture fit**
>
> AgentKit is explicitly an x402 extension. AgentLair already uses x402 for payments on Base. Total integration: ~150 lines of new code across two files.

## The Identity Stack

With AgentKit integrated, AgentLair provides three layers:

```
Layer 1: Human Verification (World ID)
  "A unique, Orb-verified human authorized this agent."

Layer 2: Operational Identity (AgentLair Email)
  "This agent is reachable at agent@agentlair.dev."

Layer 3: Credential Storage (AgentLair Vault)
  "This agent's API keys and secrets are encrypted and recoverable."
```

**What this is:** a useful combination. An email from a human-verified agent carries more trust than one from an anonymous agent. A vault with recovery lets agents persist across crashes without exposing credentials.

**What this isn't:** a moat. Each layer could be replicated independently. AgentMail (YC S25, $6M seed, 500+ customers) already does email-as-identity. ERC-8004 has 49,400+ agents with on-chain reputation. We're early, and our advantage is execution speed, not proprietary lock-in.

## Practical Considerations

- **SDK maturity:** `@worldcoin/agentkit` is beta (5 days old). Lock your version.
- **Addressable market:** ~18M Orb-verified World ID users. Significant, not internet-scale.
- **Bundle size:** viem dependency pushes Workers bundle from ~400KB to ~660KB gzipped.
- **Behavioral trust not covered:** AgentKit proves human *authorization*, not agent *behavior*. Reputation is a separate problem (see ERC-8004).

## The Broader Landscape

Agent identity is heating up fast:

- **ERC-8004** on Ethereum mainnet — Identity + Reputation + Validation registries
- **OpenAgents AgentID** — X.509 certificates + W3C DIDs
- **Sumsub KYA** — enterprise-grade agent compliance
- **x402 ecosystem** — 190+ integrations (AWS, Stripe, Cloudflare, Vercel)

The endgame is a composable stack, not a single protocol. We're building the operational identity layer.

## Try It

```bash
# 1. Register your agent
curl -X POST https://agentlair.dev/v1/auth/agent-register

# 2. Register wallet with World ID
npx @worldcoin/agentkit-cli register 0xYourAgentWallet

# 3. Send human-verified email (first 3 free)
curl -X POST https://agentlair.dev/v1/email/send \
  -H "Authorization: Bearer al_your_api_key" \
  -H "X-AGENTKIT: <signed-caip-122-proof>" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "myagent@agentlair.dev",
    "to": "recipient@example.com",
    "subject": "Human-verified agent email",
    "text": "This email was sent by an agent backed by a verified human."
  }'
```
