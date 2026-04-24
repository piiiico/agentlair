/**
 * @agentlair/defenseclaw — Trust Client
 *
 * Thin HTTP client for AgentLair's behavioral trust API.
 * Zero dependencies.
 */

import type { TrustCheckOptions, TrustCheckResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://agentlair.dev";
const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Check an agent's behavioral trust score via the AgentLair Trust API.
 *
 * @param agentId - The agent's unique identifier (agentId from ToolContext)
 * @param opts    - API key, base URL, timeout configuration
 * @returns       - Trust check result with `trusted` flag and `score`
 * @throws        - On network error or non-200 response
 */
export async function checkTrust(
  agentId: string,
  opts: TrustCheckOptions = {}
): Promise<TrustCheckResponse> {
  const apiKey =
    opts.apiKey ?? process.env.AGENTLAIR_API_KEY ?? "";
  const baseUrl = (opts.baseUrl ?? process.env.AGENTLAIR_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = `${baseUrl}/v1/trust/${encodeURIComponent(agentId)}/check`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(
        `AgentLair trust API returned ${res.status} for agent ${agentId}`
      );
    }

    const data = (await res.json()) as TrustCheckResponse;

    if (typeof data.trusted !== "boolean" || typeof data.score !== "number") {
      throw new Error(
        `AgentLair trust API returned unexpected shape: ${JSON.stringify(data)}`
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}
