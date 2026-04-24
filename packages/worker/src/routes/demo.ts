// ─── Demo Route ─────────────────────────────────────────────────────────────────
//
// Public, unauthenticated endpoint for exploring the trust scoring API.
// Returns a synthetic trust profile — no real agent data.
//
// Endpoint:
//   GET /v1/demo?scenario=healthy|suspicious|new   (default: healthy)
//
// Rate limiting:
//   10 requests / minute / IP — sliding window via KV (60s TTL)
//
// Headers (ALL responses):
//   X-Demo: true
//
// Headers (200 and 429):
//   X-RateLimit-Limit: 10
//   X-RateLimit-Remaining: <n>
//   Retry-After: 60  (429 only)
//
// Mounted in index.ts (PUBLIC block, before auth middleware):
//   app.route('/v1/demo', demoRoutes)

import { Hono } from 'hono';
import { json } from '../utils.js';
import type { HonoEnv } from '../types.js';

export const demoRoutes = new Hono<HonoEnv>();

// ─── Constants ───────────────────────────────────────────────────────────────────

const RATE_LIMIT = 10;          // requests per minute per IP
const RATE_WINDOW_TTL = 60;     // seconds

const VALID_SCENARIOS = ['healthy', 'suspicious', 'new'] as const;
type Scenario = typeof VALID_SCENARIOS[number];

// ─── Fixture Profiles ────────────────────────────────────────────────────────────
//
// Dimension weights (from L4 Behavioral Trust Specification):
//   consistency:    0.3571
//   restraint:      0.4286
//   transparency:   0.2143
//
// Scores validated against the formula:
//   overall = consistency * 0.3571 + restraint * 0.4286 + transparency * 0.2143

interface DimensionScore {
  score: number;
  confidence: number;
  signals: Record<string, number>;
}

interface ConfidenceInterval {
  score: number;
  lower: number;
  upper: number;
  confidence: number;
}

interface TrustProfileFixture {
  agentId: string;
  score: number;
  confidence: number;
  confidenceInterval: ConfidenceInterval;
  atfLevel: string;
  trend: string;
  dimensions: {
    consistency: DimensionScore;
    restraint: DimensionScore;
    transparency: DimensionScore;
  };
  observationCount: number;
  orgCount: number;
}

const FIXTURES: Record<Scenario, TrustProfileFixture> = {
  healthy: {
    agentId: 'acc_demo_healthy_XXXXXXXXXX',
    score: 84,
    confidence: 0.91,
    confidenceInterval: { score: 84, lower: 79, upper: 89, confidence: 0.91 },
    atfLevel: 'principal',
    trend: 'stable',
    dimensions: {
      // 0.82 * 0.3571 + 0.87 * 0.4286 + 0.80 * 0.2143 = 0.2928 + 0.3729 + 0.1714 = 83.7
      consistency: {
        score: 0.82,
        confidence: 0.93,
        signals: {
          session_timing: 0.85,
          call_pattern: 0.83,
          scope_stability: 0.78,
        },
      },
      restraint: {
        score: 0.87,
        confidence: 0.92,
        signals: {
          vault_read_rate: 0.91,
          rate_limit_hits: 0.89,
          scope_minimality: 0.82,
          permission_growth: 0.87,
        },
      },
      transparency: {
        score: 0.80,
        confidence: 0.88,
        signals: {
          event_coverage: 0.83,
          result_reporting: 0.78,
          error_disclosure: 0.79,
        },
      },
    },
    observationCount: 1847,
    orgCount: 1,
  },

  suspicious: {
    agentId: 'acc_demo_suspicious_XXXXXXXX',
    score: 31,
    confidence: 0.76,
    confidenceInterval: { score: 31, lower: 24, upper: 38, confidence: 0.76 },
    atfLevel: 'intern',
    trend: 'declining',
    dimensions: {
      // 0.30 * 0.3571 + 0.32 * 0.4286 + 0.29 * 0.2143 = 0.1071 + 0.1372 + 0.0622 = 30.6
      consistency: {
        score: 0.30,
        confidence: 0.78,
        signals: {
          session_timing: 0.22,
          call_pattern: 0.31,
          scope_stability: 0.37,
        },
      },
      restraint: {
        score: 0.32,
        confidence: 0.75,
        signals: {
          vault_read_rate: 0.28,
          rate_limit_hits: 0.19,
          scope_minimality: 0.41,
          permission_growth: 0.38,
        },
      },
      transparency: {
        score: 0.29,
        confidence: 0.77,
        signals: {
          event_coverage: 0.24,
          result_reporting: 0.33,
          error_disclosure: 0.29,
        },
      },
    },
    observationCount: 412,
    orgCount: 1,
  },

  new: {
    agentId: 'acc_demo_new_XXXXXXXXXXXXXX',
    score: 34,
    confidence: 0.28,
    confidenceInterval: { score: 34, lower: 18, upper: 52, confidence: 0.28 },
    atfLevel: 'intern',
    trend: 'improving',
    dimensions: {
      // 0.35 * 0.3571 + 0.33 * 0.4286 + 0.35 * 0.2143 = 0.1250 + 0.1414 + 0.0750 = 34.1
      consistency: {
        score: 0.35,
        confidence: 0.29,
        signals: {
          session_timing: 0.40,
          call_pattern: 0.33,
          scope_stability: 0.32,
        },
      },
      restraint: {
        score: 0.33,
        confidence: 0.27,
        signals: {
          vault_read_rate: 0.35,
          rate_limit_hits: 0.38,
          scope_minimality: 0.30,
          permission_growth: 0.28,
        },
      },
      transparency: {
        score: 0.35,
        confidence: 0.29,
        signals: {
          event_coverage: 0.38,
          result_reporting: 0.33,
          error_disclosure: 0.35,
        },
      },
    },
    observationCount: 11,
    orgCount: 1,
  },
};

// ─── Rate Limiting ───────────────────────────────────────────────────────────────
//
// Uses KEYS KV namespace. Key: `demo:rl:<ip>:<minute>`
// TTL: 60s (sliding — resets on each increment within the window).
// Fail-open: if KV is unavailable, all requests are allowed.

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

async function checkDemoRateLimit(kv: KVNamespace | undefined, ip: string): Promise<RateLimitResult> {
  if (!kv) return { allowed: true, remaining: RATE_LIMIT };
  try {
    const minute = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    const key = `demo:rl:${ip}:${minute}`;
    const current = parseInt(await kv.get(key) || '0');
    if (current >= RATE_LIMIT) {
      return { allowed: false, remaining: 0 };
    }
    await kv.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_TTL });
    return { allowed: true, remaining: RATE_LIMIT - current - 1 };
  } catch {
    // Fail open: KV unavailable (quota exceeded, etc.)
    return { allowed: true, remaining: RATE_LIMIT };
  }
}

// ─── GET /v1/demo ────────────────────────────────────────────────────────────────

demoRoutes.get('/', async (c) => {
  const demoHeaders: Record<string, string> = { 'X-Demo': 'true' };

  // ── Input validation ─────────────────────────────────────────────────────────
  const rawScenario = c.req.query('scenario') ?? 'healthy';
  if (rawScenario && !(VALID_SCENARIOS as readonly string[]).includes(rawScenario)) {
    return json(
      { error: 'invalid_scenario', message: `Unknown scenario '${rawScenario}'. Valid values: healthy, suspicious, new.` },
      400,
      demoHeaders,
    );
  }
  const scenario = (rawScenario as Scenario) || 'healthy';

  // ── Rate limiting ────────────────────────────────────────────────────────────
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const rl = await checkDemoRateLimit(c.env.KEYS, ip);

  if (!rl.allowed) {
    return json(
      {
        error: 'rate_limited',
        message: `Demo endpoint is limited to ${RATE_LIMIT} requests per minute per IP. Try again in 60 seconds.`,
      },
      429,
      {
        ...demoHeaders,
        'X-RateLimit-Limit': String(RATE_LIMIT),
        'X-RateLimit-Remaining': '0',
        'Retry-After': '60',
      },
    );
  }

  // ── Build response ───────────────────────────────────────────────────────────
  const fixture = FIXTURES[scenario];
  const profile = {
    ...fixture,
    computedAt: new Date().toISOString(),
  };

  return json(profile, 200, {
    ...demoHeaders,
    'X-RateLimit-Limit': String(RATE_LIMIT),
    'X-RateLimit-Remaining': String(rl.remaining),
  });
});
