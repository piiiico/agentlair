/**
 * @agentlair/x402-trust-gate — trust checking
 *
 * Queries AgentLair to determine an agent's trust level.
 * Uses the public /v1/tokens/introspect endpoint (no API key needed).
 * Falls back to anonymous trust for missing or invalid tokens.
 */

import type { TrustLevel, TrustResult } from "./types.js";

const AGENTLAIR_DEFAULT = "https://agentlair.dev";

// ─── Introspection ────────────────────────────────────────────────────────────

interface IntrospectionResponse {
  active: boolean;
  sub?: string;
  al_trust?: {
    score: number;
    level: TrustLevel;
    confidence: number;
    computed_at: string;
    flagged?: boolean;
  };
  [key: string]: unknown;
}

async function introspect(
  token: string,
  base: string
): Promise<IntrospectionResponse> {
  const res = await fetch(`${base}/v1/tokens/introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    throw new Error(`Introspection failed: HTTP ${res.status}`);
  }

  return res.json() as Promise<IntrospectionResponse>;
}

// ─── Level helpers ────────────────────────────────────────────────────────────

/** Anonymous / no-token trust result */
const ANONYMOUS: TrustResult = {
  level: "intern",
  score: 0,
  agentId: "anonymous",
  blocked: false,
};

const BLOCKED: Omit<TrustResult, "agentId"> = {
  level: "intern",
  score: 0,
  blocked: true,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract the bearer token from an Authorization header value.
 * Handles both "Bearer <token>" and raw token strings.
 */
export function extractToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  if (authHeader.startsWith("Bearer ") || authHeader.startsWith("bearer ")) {
    const t = authHeader.slice(7).trim();
    return t || null;
  }
  return authHeader.trim() || null;
}

/**
 * Check an agent's trust level using their AgentLair AAT.
 *
 * @param token - Raw AAT (without "Bearer " prefix) or null for anonymous
 * @param agentlairBase - AgentLair API base URL
 * @returns TrustResult with level, score, agentId, and blocked flag
 */
export async function checkTrust(
  token: string | null,
  agentlairBase: string = AGENTLAIR_DEFAULT
): Promise<TrustResult> {
  // No token → anonymous treatment
  if (!token) {
    return ANONYMOUS;
  }

  let introspection: IntrospectionResponse;

  try {
    introspection = await introspect(token, agentlairBase);
  } catch (err) {
    // If introspection fails (network, timeout), treat as anonymous rather than failing open
    console.warn(`[x402-trust-gate] Introspection failed, treating as anonymous: ${err}`);
    return ANONYMOUS;
  }

  // Invalid/expired token
  if (!introspection.active) {
    return {
      level: "intern",
      score: 0,
      agentId: "invalid",
      blocked: false,
    };
  }

  const agentId = (introspection.sub as string) ?? "unknown";

  // Use embedded al_trust if available
  if (introspection.al_trust) {
    const t = introspection.al_trust;

    // Explicitly flagged agents are blocked
    if (t.flagged) {
      return { ...BLOCKED, agentId };
    }

    // Negative score = flagged
    if (t.score < 0) {
      return { ...BLOCKED, agentId };
    }

    return {
      level: t.level,
      score: t.score,
      agentId,
      blocked: false,
      raw: introspection as Record<string, unknown>,
    };
  }

  // No trust data embedded — treat as intern (new agent)
  return {
    level: "intern",
    score: 0,
    agentId,
    blocked: false,
    raw: introspection as Record<string, unknown>,
  };
}

/**
 * Determine if a trust level qualifies as "trusted" for base pricing.
 * senior (65+) and principal are trusted; everything else pays a premium.
 */
export function isTrusted(level: TrustLevel): boolean {
  return level === "senior" || level === "principal";
}
