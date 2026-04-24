// ---------------------------------------------------------------------------
// @agentlair/agent-framework — Trust API Client
// ---------------------------------------------------------------------------

import type { TrustScore, TrustBreakdown, AgentLairTrustConfig, BehavioralEvent } from "./types.js";
import { scoreTier } from "./types.js";

const DEFAULT_BASE_URL = "https://agentlair.dev";
const DEFAULT_TIMEOUT = 2000;

/**
 * Fetch an agent's trust score from AgentLair.
 *
 * Uses the public badge endpoint (no auth required) with fallback
 * to the authenticated API for richer data.
 */
export async function fetchTrustScore(
  agentId: string,
  config: Pick<AgentLairTrustConfig, "apiKey" | "baseUrl" | "timeout"> = {},
): Promise<TrustScore> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // Prefer authenticated endpoint for full breakdown
    const url = config.apiKey
      ? `${baseUrl}/v1/trust/${encodeURIComponent(agentId)}`
      : `${baseUrl}/badge/${encodeURIComponent(agentId)}/score.json`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Trust API returned ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Normalize response shape
    const score = typeof data.score === "number" ? data.score : 0;
    const breakdown: TrustBreakdown = (data.breakdown as TrustBreakdown) ?? {
      behavioral: 0,
      consistency: 0,
      reputation: 0,
      transparency: 0,
    };

    return {
      agentId,
      score,
      tier: scoreTier(score),
      breakdown,
      computedAt:
        typeof data.computedAt === "string"
          ? data.computedAt
          : new Date().toISOString(),
      observationCount:
        typeof data.observationCount === "number" ? data.observationCount : 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Emit a behavioral event to AgentLair.
 *
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function emitEvent(
  event: BehavioralEvent,
  config: Pick<AgentLairTrustConfig, "apiKey" | "baseUrl" | "timeout"> = {},
): Promise<void> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  if (!config.apiKey) return; // Can't emit without auth

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    await fetch(`${baseUrl}/v1/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...event,
        event_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
  } catch {
    // Fire-and-forget: swallow errors
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Batch-emit multiple behavioral events.
 */
export async function emitEvents(
  events: BehavioralEvent[],
  config: Pick<AgentLairTrustConfig, "apiKey" | "baseUrl" | "timeout"> = {},
): Promise<void> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  if (!config.apiKey || events.length === 0) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const enriched = events.map((e) => ({
      ...e,
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }));

    await fetch(`${baseUrl}/v1/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(enriched),
      signal: controller.signal,
    });
  } catch {
    // Fire-and-forget
  } finally {
    clearTimeout(timer);
  }
}
