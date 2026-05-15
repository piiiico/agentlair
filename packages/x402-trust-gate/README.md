# @agentlair/x402-trust-gate

Trust-gated x402 payment middleware. Agents with [AgentLair](https://agentlair.dev) behavioral trust scores pay less — trusted agents get the base price, unknown agents pay 10x, flagged agents are blocked.

**The core idea:** if you've built a track record of reliable, consistent behavior across organizations, you should pay less to access resources. Trust is an economic signal.

## How it works

Every request to a trust-gated endpoint is priced based on the agent's AgentLair trust level:

| Trust tier | Score | Multiplier | Example (0.01 USDC base) |
|:-----------|:------|:----------:|:------------------------:|
| `trusted` (senior/principal) | 65+ | **1x** | $0.01 USDC |
| `junior` | 40–64 | **5x** | $0.05 USDC |
| `unknown` (intern/anonymous) | < 40 | **10x** | $0.10 USDC |
| `blocked` (flagged) | — | **403** | Blocked |

The middleware reads the agent's [AAT](https://agentlair.dev/docs/aat) from the `Authorization` header, introspects it, and returns a [402 Payment Required](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/402) with the appropriate price. When the agent pays, the middleware verifies and settles the payment via the [x402 facilitator](https://github.com/coinbase/x402).

## Quick start

### As a Cloudflare Worker (standalone demo)

```bash
git clone https://github.com/hawkaa/agentlair
cd agentlair/packages/x402-trust-gate

# Set your receiving wallet address
wrangler secret put PAY_TO
# > Enter your USDC wallet address (Base mainnet)

# Deploy
wrangler deploy
```

That's it. Your endpoint now charges based on trust.

### As npm middleware

```bash
npm install @agentlair/x402-trust-gate
# or
bun add @agentlair/x402-trust-gate
```

```typescript
import { handleTrustGate } from '@agentlair/x402-trust-gate';

// Cloudflare Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleTrustGate(request, {
      baseAmount: '10000',          // 0.01 USDC — trusted agents pay this
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      network: 'eip155:8453',       // Base mainnet
      payTo: env.WALLET_ADDRESS,    // Your receiving wallet
      facilitator: 'https://facilitator.ultravioletadao.xyz',
      resourceUrl: 'https://my-api.example.com',
      description: 'My API — trust-gated pricing',
      upstream: 'https://my-api-upstream.example.com', // Optional proxy target
    });
  }
};
```

### Check trust directly

```typescript
import { checkTrust, getEffectivePrice, formatUsdc } from '@agentlair/x402-trust-gate';

const token = request.headers.get('Authorization')?.slice(7) ?? null;
const trust = await checkTrust(token);
const { tier, effectiveAmount } = getEffectivePrice('10000', trust);

console.log(`Agent: ${trust.agentId}`);
console.log(`Trust: ${trust.level} (score ${trust.score})`);
console.log(`Price: ${formatUsdc(effectiveAmount)} (${tier.name} tier, ${tier.multiplier}x)`);
```

## Request flow

```
Agent → POST /api
         Authorization: Bearer <AAT>

Middleware:
  1. Introspect AAT at agentlair.dev/v1/tokens/introspect
  2. Determine trust tier → price multiplier
  3. No payment? → 402 PAYMENT-REQUIRED (base64 PaymentRequired JSON)
  4. Payment present? → Verify via facilitator → Settle → Proxy upstream

Agent ← 402 Payment Required
         PAYMENT-REQUIRED: <base64>
         X-Trust-Tier: unknown
         X-Price-Multiplier: 10

Agent pays → POST /api
              PAYMENT-SIGNATURE: <base64 PaymentPayload>

Agent ← 200 OK (or proxy response)
         PAYMENT-RESPONSE: <base64 SettlementResponse>
```

## Configuration

```typescript
interface TrustGateConfig {
  /** Base price in USDC atomic units (6 decimals). e.g. 10000 = 0.01 USDC */
  baseAmount: string;

  /** USDC contract address */
  asset: string;

  /** Network identifier. Default: Base mainnet */
  network: string;

  /** Address to receive payments */
  payTo: string;

  /** x402 facilitator URL */
  facilitator: string;

  /** Resource URL (used in PaymentRequired) */
  resourceUrl: string;

  /** Resource description */
  description: string;

  /** AgentLair API base URL. Default: https://agentlair.dev */
  agentlairBase?: string;

  /** Optional upstream URL to proxy after payment */
  upstream?: string;

  /** Price tier overrides */
  tiers?: {
    trusted?: { multiplier: number };
    junior?: { multiplier: number };
    unknown?: { multiplier: number };
  };
}
```

## Price tier overrides

```typescript
// Custom pricing: trusted gets 1x, junior 2x, unknown 5x (more lenient)
handleTrustGate(request, {
  ...config,
  tiers: {
    trusted: { multiplier: 1 },
    junior: { multiplier: 2 },
    unknown: { multiplier: 5 },
  },
});
```

## Headers

### Request (agent → middleware)
| Header | Description |
|:-------|:------------|
| `Authorization: Bearer <AAT>` | AgentLair Agent Authentication Token |
| `X-Agentlair-AAT: <AAT>` | Alternative to Authorization header |
| `PAYMENT-SIGNATURE: <base64>` | x402 payment payload (on retry after 402) |

### Response (middleware → agent)
| Header | Description |
|:-------|:------------|
| `PAYMENT-REQUIRED: <base64>` | PaymentRequired JSON (on 402) |
| `X-Trust-Tier: trusted\|junior\|unknown` | Agent's trust tier |
| `X-Price-Multiplier: <n>` | Price multiplier applied |
| `PAYMENT-RESPONSE: <base64>` | Settlement result (on 200) |

### Upstream headers (middleware → upstream, when proxying)
| Header | Description |
|:-------|:------------|
| `X-Trust-Agent-Id` | Agent's identifier |
| `X-Trust-Level` | intern\|junior\|senior\|principal |
| `X-Trust-Score` | 0–100 trust score |
| `X-Trust-Tier` | trusted\|junior\|unknown |
| `X-Payment-Tx` | Transaction hash of settled payment |

## Get an AgentLair AAT

Agents get a behavioral trust score by using AgentLair. The trust score reflects cross-organizational behavioral patterns — not just identity claims.

```bash
# Register an agent
curl -X POST https://agentlair.dev/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'

# Get an AAT
curl -X POST https://agentlair.dev/v1/tokens \
  -H "Authorization: Bearer <api_key>"
```

See [agentlair.dev/docs](https://agentlair.dev/docs) for full onboarding.

## Live demo

[x402-trust-gate.agentlair.dev](https://x402-trust-gate.agentlair.dev) — try it with and without an AAT to see price differentiation in action.

## License

MIT © [AgentLair](https://agentlair.dev)
