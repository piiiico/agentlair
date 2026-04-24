/**
 * AgentLair Trust Gate Integration
 *
 * Handles all AgentLair verification logic:
 *   1. Token introspection (validates AAT, extracts claims)
 *   2. Trust check (verifies trust level against threshold)
 *   3. Audit logging (sends tool call telemetry back to AgentLair)
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TrustLevel = "intern" | "junior" | "senior" | "principal";

export interface IntrospectionResult {
  active: boolean;
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  jti?: string;
  al_scopes?: string[];
  al_name?: string;
  al_email?: string;
  al_trust?: {
    score: number;
    level: TrustLevel;
    confidence: number;
    computed_at: string;
  };
  did?: string;
}

export interface TrustCheckResult {
  agentId: string;
  score: number;
  atfLevel: TrustLevel;
  meetsMinimum: boolean;
  requiredLevel: TrustLevel;
  confidence: number;
  cached?: boolean;
}

export interface TrustDecision {
  allowed: boolean;
  agentId: string;
  trustLevel: TrustLevel;
  trustScore: number;
  reason?: string;
  introspection?: IntrospectionResult;
}

// ─── ATF Level Ordering ────────────────────────────────────────────────────────

const ATF_LEVELS: TrustLevel[] = ["intern", "junior", "senior", "principal"];

function levelIndex(level: TrustLevel): number {
  return ATF_LEVELS.indexOf(level);
}

function meetsMinimum(level: TrustLevel, minimum: TrustLevel): boolean {
  return levelIndex(level) >= levelIndex(minimum);
}

// ─── AgentLair API Client ─────────────────────────────────────────────────────

const AGENTLAIR_BASE = process.env.AGENTLAIR_BASE_URL ?? "https://agentlair.dev";

/**
 * Step 1: Introspect an AAT to verify it's valid and extract claims.
 * This is a public endpoint — no AgentLair API key required.
 *
 * RFC 7662 compatible. Returns { active: false } for invalid/expired tokens.
 */
export async function introspectToken(
  token: string
): Promise<IntrospectionResult> {
  const url = `${AGENTLAIR_BASE}/v1/tokens/introspect`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch (e) {
    throw new Error(
      `AgentLair introspection network error: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `AgentLair introspection failed (HTTP ${res.status}): ${body}`
    );
  }

  return res.json() as Promise<IntrospectionResult>;
}

/**
 * Step 2: Check the agent's current trust level against a minimum threshold.
 * Uses the /v1/trust/{agentId}/check endpoint (cached, low-latency).
 *
 * Requires an AgentLair API key for authorization.
 */
export async function checkTrust(
  agentId: string,
  minLevel: TrustLevel,
  serverApiKey: string
): Promise<TrustCheckResult> {
  const url = `${AGENTLAIR_BASE}/v1/trust/${encodeURIComponent(agentId)}/check?min_level=${minLevel}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${serverApiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    throw new Error(
      `AgentLair trust check network error: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AgentLair trust check failed (HTTP ${res.status}): ${body}`);
  }

  return res.json() as Promise<TrustCheckResult>;
}

/**
 * Main trust gate — calls introspect + trust check in sequence.
 *
 * Trust-based access tiers:
 *   - trust >= senior (score ~65+): all tools available
 *   - trust >= junior (score ~40+): read_file only
 *   - trust < junior: access denied
 *
 * Returns a TrustDecision with full context for logging.
 */
export async function verifyAndCheckTrust(
  bearerToken: string | undefined,
  serverApiKey: string
): Promise<TrustDecision> {
  // Extract token from "Bearer <token>" header if needed
  const token = bearerToken?.startsWith("Bearer ")
    ? bearerToken.slice(7)
    : bearerToken;

  if (!token) {
    return {
      allowed: false,
      agentId: "unknown",
      trustLevel: "intern",
      trustScore: 0,
      reason: "No AAT provided. Include your AgentLair token in the request.",
    };
  }

  // Step 1: Introspect token
  let introspection: IntrospectionResult;
  try {
    introspection = await introspectToken(token);
  } catch (e) {
    return {
      allowed: false,
      agentId: "unknown",
      trustLevel: "intern",
      trustScore: 0,
      reason: `Token introspection failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!introspection.active) {
    return {
      allowed: false,
      agentId: "unknown",
      trustLevel: "intern",
      trustScore: 0,
      reason: "Token is inactive or expired.",
      introspection,
    };
  }

  const agentId = introspection.sub ?? "unknown";

  // Use embedded al_trust if available (avoids extra API call for low-latency path)
  // Fall back to real-time trust check for accuracy
  if (introspection.al_trust) {
    const embeddedTrust = introspection.al_trust;
    const level = embeddedTrust.level;
    const score = embeddedTrust.score;

    return {
      allowed: meetsMinimum(level, "junior"),
      agentId,
      trustLevel: level,
      trustScore: score,
      reason: meetsMinimum(level, "junior")
        ? undefined
        : `Trust level '${level}' (score ${score}) is below minimum required 'junior'. Build trust by using AgentLair tools consistently.`,
      introspection,
    };
  }

  // Step 2: Real-time trust check (when no embedded trust available)
  try {
    const trustCheck = await checkTrust(agentId, "intern", serverApiKey);

    return {
      allowed: meetsMinimum(trustCheck.atfLevel, "junior"),
      agentId,
      trustLevel: trustCheck.atfLevel,
      trustScore: trustCheck.score,
      reason: trustCheck.meetsMinimum
        ? undefined
        : `Trust level '${trustCheck.atfLevel}' (score ${trustCheck.score}) is below minimum required 'junior'.`,
      introspection,
    };
  } catch (e) {
    // Fail open with intern level if trust API is unreachable
    // In production you'd likely fail closed — adjust to your risk tolerance
    console.error(`[trust-gate] Trust check failed for ${agentId}: ${e}`);
    return {
      allowed: false,
      agentId,
      trustLevel: "intern",
      trustScore: 0,
      reason: `Trust verification unavailable: ${e instanceof Error ? e.message : String(e)}`,
      introspection,
    };
  }
}

/**
 * Send tool call telemetry to AgentLair audit trail.
 * Non-blocking — logs fire-and-forget. Failures are logged but not fatal.
 */
export async function logToolCall(opts: {
  serverApiKey: string;
  agentId: string;
  toolName: string;
  trustLevel: TrustLevel;
  allowed: boolean;
  errorCode?: string;
}): Promise<void> {
  const { serverApiKey, agentId, toolName, trustLevel, allowed, errorCode } =
    opts;

  const url = `${AGENTLAIR_BASE}/v1/telemetry`;

  const payload = {
    actor_id: agentId,
    category: "mcp_tool",
    action: `${toolName}:${allowed ? "execute" : "denied"}`,
    result: allowed ? "success" : "denied",
    resource_type: "mcp_tool",
    metadata: {
      tool: toolName,
      trust_level: trustLevel,
      denied_reason: allowed ? undefined : errorCode ?? "trust_insufficient",
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[trust-gate] Telemetry failed (HTTP ${res.status}): ${body}`);
    }
  } catch (e) {
    console.error(`[trust-gate] Telemetry network error: ${e}`);
  }
}
