/**
 * @agentlair/x402-trust-gate — Cloudflare Worker entry point
 *
 * Trust-gated x402 payment middleware demo.
 *
 * Environment variables (set via `wrangler secret put`):
 *   PAY_TO          — USDC wallet address to receive payments
 *   UPSTREAM_URL    — (optional) URL to proxy requests to after payment
 *   BASE_AMOUNT     — (optional) Base price in USDC atomic units. Default: 10000 (0.01 USDC)
 *   AGENTLAIR_BASE  — (optional) Override AgentLair API base URL
 *
 * See wrangler.toml for non-secret configuration.
 */

import { handleTrustGate } from "./middleware.js";
import type { TrustGateConfig } from "./types.js";

// ─── Env ──────────────────────────────────────────────────────────────────────

export interface Env {
  /** USDC wallet address to receive payments */
  PAY_TO: string;

  /** (optional) URL to proxy requests to after successful payment */
  UPSTREAM_URL?: string;

  /** (optional) Base price in USDC atomic units. Default: 10000 (= 0.01 USDC) */
  BASE_AMOUNT?: string;

  /** (optional) Override AgentLair API base URL */
  AGENTLAIR_BASE?: string;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Health check
    if (new URL(request.url).pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "@agentlair/x402-trust-gate" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Agentlair-AAT, PAYMENT-SIGNATURE, X-PAYMENT",
          "Access-Control-Expose-Headers":
            "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-Trust-Tier, X-Price-Multiplier",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Trust gate info endpoint
    if (new URL(request.url).pathname === "/" && request.method === "GET") {
      const baseAmount = env.BASE_AMOUNT ?? "10000";
      return new Response(
        JSON.stringify({
          service: "@agentlair/x402-trust-gate",
          description:
            "Trust-gated x402 payment middleware. Agents with AgentLair trust scores pay less.",
          pricing: {
            trusted: {
              description: "senior/principal agents (score 65+)",
              multiplier: "1x",
              example: formatUsdc(baseAmount),
            },
            junior: {
              description: "junior agents (score 40–64)",
              multiplier: "5x",
              example: formatUsdc(String(BigInt(baseAmount) * 5n)),
            },
            unknown: {
              description: "intern/anonymous agents (score < 40 or no AAT)",
              multiplier: "10x",
              example: formatUsdc(String(BigInt(baseAmount) * 10n)),
            },
            blocked: {
              description: "flagged agents",
              multiplier: "blocked",
              example: "403 Forbidden",
            },
          },
          network: "eip155:8453 (Base mainnet)",
          learnMore: "https://agentlair.dev/docs/x402-trust-gate",
          github: "https://github.com/hawkaa/agentlair/tree/main/packages/x402-trust-gate",
        }),
        { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Build config from env
    const config: TrustGateConfig = {
      baseAmount: env.BASE_AMOUNT ?? "10000",
      // Base mainnet USDC
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      network: "eip155:8453",
      payTo: env.PAY_TO,
      // Ultraviolet facilitator supports Base mainnet (x402.org only supports Sepolia as of May 2026)
      facilitator: "https://facilitator.ultravioletadao.xyz",
      resourceUrl: new URL(request.url).origin,
      description: `Trust-gated resource - ${new URL(request.url).origin}`,
      agentlairBase: env.AGENTLAIR_BASE,
      upstream: env.UPSTREAM_URL,
    };

    return handleTrustGate(request, config);
  },
} satisfies ExportedHandler<Env>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsdc(atomicUnits: string): string {
  const n = Number(atomicUnits) / 1_000_000;
  return `$${n.toFixed(n < 0.01 ? 6 : n < 1 ? 4 : 2)} USDC`;
}
