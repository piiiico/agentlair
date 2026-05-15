/**
 * @agentlair/x402-trust-gate
 *
 * Trust-gated x402 payment middleware. Agents with AgentLair behavioral trust
 * scores pay less — trusted agents get the base price, unknown agents pay 10x,
 * flagged agents are blocked.
 *
 * Works in Cloudflare Workers, Node 18+, Bun, and Deno.
 *
 * @example Cloudflare Worker (standalone demo)
 * ```
 * wrangler deploy
 * ```
 *
 * @example As middleware in your own Worker
 * ```typescript
 * import { handleTrustGate } from '@agentlair/x402-trust-gate';
 *
 * export default {
 *   async fetch(request, env) {
 *     return handleTrustGate(request, {
 *       baseAmount: '10000',          // 0.01 USDC base price
 *       asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
 *       network: 'eip155:8453',
 *       payTo: env.WALLET_ADDRESS,
 *       facilitator: 'https://facilitator.ultravioletadao.xyz',
 *       resourceUrl: 'https://my-api.example.com',
 *       description: 'My API - trust-gated pricing',
 *       upstream: 'https://my-api-upstream.example.com',
 *     });
 *   }
 * };
 * ```
 *
 * @example Check trust directly
 * ```typescript
 * import { checkTrust, getEffectivePrice } from '@agentlair/x402-trust-gate';
 *
 * const trust = await checkTrust(bearerToken);
 * const { tier, effectiveAmount } = getEffectivePrice('10000', trust);
 * console.log(`Agent pays: ${effectiveAmount} (tier: ${tier.name})`);
 * ```
 *
 * @see https://agentlair.dev/docs/x402-trust-gate
 * @see https://github.com/hawkaa/agentlair/tree/main/packages/x402-trust-gate
 */

// Core middleware
export { handleTrustGate } from "./middleware.js";

// Trust checking
export { checkTrust, extractToken, isTrusted } from "./trust.js";

// Pricing
export { getEffectivePrice, resolveTier, applyMultiplier, formatUsdc, describePricing } from "./pricing.js";

// x402 protocol
export {
  buildPaymentRequired,
  build402Response,
  build403Response,
  extractPaymentSignature,
  verifyPayment,
  settlePayment,
} from "./x402.js";

// Types
export type {
  TrustLevel,
  TrustResult,
  PriceTier,
  TrustGateConfig,
  TrustGateResult,
  X402PaymentRequired,
  X402PaymentOption,
  X402VerifyResult,
  X402SettleResult,
} from "./types.js";
