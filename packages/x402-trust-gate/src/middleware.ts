/**
 * @agentlair/x402-trust-gate — core middleware
 *
 * Framework-agnostic trust-gated x402 middleware.
 * Handles the full request lifecycle:
 *
 *   1. Check agent's AAT for trust level
 *   2. If blocked: return 403
 *   3. If no payment: return 402 with trust-scaled price
 *   4. If payment present: verify, settle, and proxy upstream
 *
 * Works in any environment that supports the Fetch API (Cloudflare Workers,
 * Node 18+, Bun, Deno, browsers).
 */

import type { TrustGateConfig } from "./types.js";
import { extractToken, checkTrust } from "./trust.js";
import { getEffectivePrice, describePricing } from "./pricing.js";
import {
  buildPaymentRequired,
  build402Response,
  build403Response,
  extractPaymentSignature,
  verifyPayment,
  settlePayment,
  safeBase64,
} from "./x402.js";

// ─── Trust gate handler ───────────────────────────────────────────────────────

/**
 * Process a request through the trust gate.
 *
 * @param request - Incoming HTTP request
 * @param config - Trust gate configuration
 * @returns Response (402, 403, upstream proxy, or pass-through info)
 */
export async function handleTrustGate(
  request: Request,
  config: TrustGateConfig
): Promise<Response> {
  const agentlairBase = config.agentlairBase ?? "https://agentlair.dev";

  // ── 1. Extract AAT from Authorization header or X-Agentlair-AAT ─────────────
  const authHeader =
    request.headers.get("Authorization") ??
    request.headers.get("X-Agentlair-AAT");
  const token = extractToken(authHeader);

  // ── 2. Check trust level ─────────────────────────────────────────────────────
  const trust = await checkTrust(token, agentlairBase);

  // ── 3. Get effective price based on trust ────────────────────────────────────
  const { tier, effectiveAmount, blocked } = getEffectivePrice(
    config.baseAmount,
    trust,
    config.tiers
  );

  // ── 4. Block flagged agents ──────────────────────────────────────────────────
  if (blocked) {
    console.log(`[x402-trust-gate] BLOCKED: ${describePricing(trust, config.baseAmount, config.tiers)}`);
    return build403Response(trust.agentId);
  }

  // ── 5. Check for payment signature ──────────────────────────────────────────
  const paymentSig = extractPaymentSignature(request);

  if (!paymentSig) {
    // No payment — return 402 with trust-scaled price
    console.log(`[x402-trust-gate] 402: ${describePricing(trust, config.baseAmount, config.tiers)}`);

    const paymentRequired = buildPaymentRequired({
      amount: effectiveAmount,
      asset: config.asset,
      network: config.network,
      payTo: config.payTo,
      resourceUrl: config.resourceUrl,
      description: config.description,
      maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
      extra: {
        trustTier: tier.name,
        trustScore: trust.score,
        baseAmount: config.baseAmount,
        priceMultiplier: tier.multiplier,
      },
    });

    return build402Response(paymentRequired, {
      agentId: trust.agentId,
      tier: tier.name,
      multiplier: tier.multiplier,
    });
  }

  // ── 6. Verify payment ────────────────────────────────────────────────────────
  const paymentRequired = buildPaymentRequired({
    amount: effectiveAmount,
    asset: config.asset,
    network: config.network,
    payTo: config.payTo,
    resourceUrl: config.resourceUrl,
    description: config.description,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
    extra: {
      trustTier: tier.name,
      trustScore: trust.score,
      baseAmount: config.baseAmount,
      priceMultiplier: tier.multiplier,
    },
  });

  const verified = await verifyPayment(paymentSig, paymentRequired, config.facilitator);

  if (!verified.isValid) {
    console.log(`[x402-trust-gate] Payment verification failed: ${verified.error}`);
    return new Response(
      JSON.stringify({ error: "Payment verification failed", reason: verified.error }),
      {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": safeBase64(JSON.stringify(paymentRequired)),
        },
      }
    );
  }

  // ── 7. Settle payment (broadcast tx) ────────────────────────────────────────
  const settled = await settlePayment(paymentSig, paymentRequired, config.facilitator);

  if (!settled.success) {
    console.log(`[x402-trust-gate] Payment settlement failed: ${settled.error}`);
    return new Response(
      JSON.stringify({ error: "Payment settlement failed", reason: settled.error }),
      {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": safeBase64(JSON.stringify(paymentRequired)),
        },
      }
    );
  }

  console.log(
    `[x402-trust-gate] Payment settled: txHash=${settled.txHash} agent=${trust.agentId} tier=${tier.name}`
  );

  // ── 8. Proxy to upstream (if configured) ────────────────────────────────────
  if (config.upstream) {
    const upstreamUrl = new URL(config.upstream);
    const incomingUrl = new URL(request.url);

    // Preserve path and query from incoming request
    upstreamUrl.pathname = incomingUrl.pathname;
    upstreamUrl.search = incomingUrl.search;

    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: (() => {
        const h = new Headers(request.headers);
        // Strip x402 payment headers before forwarding
        h.delete("PAYMENT-SIGNATURE");
        h.delete("X-PAYMENT");
        // Inject trust context for upstream
        h.set("X-Trust-Agent-Id", trust.agentId);
        h.set("X-Trust-Level", trust.level);
        h.set("X-Trust-Score", String(trust.score));
        h.set("X-Trust-Tier", tier.name);
        if (settled.txHash) h.set("X-Payment-Tx", settled.txHash);
        return h;
      })(),
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
    });

    const upstreamResponse = await fetch(upstreamRequest);

    // Add PAYMENT-RESPONSE header
    const response = new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: upstreamResponse.headers,
    });

    if (settled.txHash) {
      const settlementResponse = safeBase64(
        JSON.stringify({ txHash: settled.txHash, network: config.network })
      );
      response.headers.set("PAYMENT-RESPONSE", settlementResponse);
    }

    return response;
  }

  // ── 9. Standalone mode — return payment confirmation ─────────────────────────
  return new Response(
    JSON.stringify({
      success: true,
      message: "Payment verified and settled.",
      txHash: settled.txHash,
      trust: {
        agentId: trust.agentId,
        level: trust.level,
        score: trust.score,
        tier: tier.name,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(settled.txHash
          ? { "PAYMENT-RESPONSE": safeBase64(JSON.stringify({ txHash: settled.txHash })) }
          : {}),
      },
    }
  );
}
