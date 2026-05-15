/**
 * @agentlair/x402-trust-gate — pricing
 *
 * Maps trust levels to price multipliers.
 *
 * Default tiers:
 *   - principal / senior  (trusted, score 65+)  →  1x  (base price)
 *   - junior              (known, score 40–64)   →  5x
 *   - intern / anonymous  (unknown, score < 40)  → 10x
 *   - flagged / blocked                          → 403 (no payment option)
 */

import type { TrustResult, PriceTier } from "./types.js";

export interface PricingConfig {
  trusted?: { multiplier: number };
  junior?: { multiplier: number };
  unknown?: { multiplier: number };
}

const DEFAULT_TIERS: Required<Record<keyof PricingConfig, PriceTier>> = {
  trusted: { name: "trusted", multiplier: 1, blocked: false },
  junior: { name: "junior", multiplier: 5, blocked: false },
  unknown: { name: "unknown", multiplier: 10, blocked: false },
};

const BLOCKED_TIER: PriceTier = { name: "blocked", multiplier: 0, blocked: true };

/**
 * Resolve the price tier for a given trust result.
 */
export function resolveTier(trust: TrustResult, config?: PricingConfig): PriceTier {
  if (trust.blocked) return BLOCKED_TIER;

  const merged = {
    trusted: { ...DEFAULT_TIERS.trusted, ...config?.trusted },
    junior: { ...DEFAULT_TIERS.junior, ...config?.junior },
    unknown: { ...DEFAULT_TIERS.unknown, ...config?.unknown },
  };

  switch (trust.level) {
    case "principal":
    case "senior":
      return { ...merged.trusted, name: "trusted", blocked: false };
    case "junior":
      return { ...merged.junior, name: "junior", blocked: false };
    case "intern":
    default:
      return { ...merged.unknown, name: "unknown", blocked: false };
  }
}

/**
 * Apply a price multiplier to a base amount string (USDC atomic units).
 * Rounds up to ensure we never under-charge.
 */
export function applyMultiplier(baseAmount: string, multiplier: number): string {
  const base = BigInt(baseAmount);
  const scaled = base * BigInt(Math.ceil(multiplier));
  return scaled.toString();
}

/**
 * Get the effective price for an agent given their trust level.
 *
 * @param baseAmount - Base price in USDC atomic units (e.g. "10000" = 0.01 USDC)
 * @param trust - Trust result from checkTrust()
 * @param config - Optional tier configuration overrides
 * @returns { tier, effectiveAmount, blocked }
 */
export function getEffectivePrice(
  baseAmount: string,
  trust: TrustResult,
  config?: PricingConfig
): { tier: PriceTier; effectiveAmount: string; blocked: boolean } {
  const tier = resolveTier(trust, config);

  if (tier.blocked) {
    return { tier, effectiveAmount: "0", blocked: true };
  }

  const effectiveAmount = applyMultiplier(baseAmount, tier.multiplier);
  return { tier, effectiveAmount, blocked: false };
}

/**
 * Format USDC atomic units as a human-readable string.
 * e.g. "10000" → "$0.01 USDC"
 */
export function formatUsdc(atomicUnits: string): string {
  const n = Number(atomicUnits) / 1_000_000;
  return `$${n.toFixed(n < 0.01 ? 6 : n < 1 ? 4 : 2)} USDC`;
}

/**
 * Build a human-readable tier summary for logging/debugging.
 */
export function describePricing(
  trust: TrustResult,
  baseAmount: string,
  config?: PricingConfig
): string {
  const { tier, effectiveAmount, blocked } = getEffectivePrice(baseAmount, trust, config);

  if (blocked) {
    return `agent=${trust.agentId} level=${trust.level} score=${trust.score} → BLOCKED`;
  }

  return [
    `agent=${trust.agentId}`,
    `level=${trust.level}`,
    `score=${trust.score}`,
    `tier=${tier.name}`,
    `multiplier=${tier.multiplier}x`,
    `price=${formatUsdc(effectiveAmount)}`,
  ].join(" ");
}
