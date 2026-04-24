// ─── Events Routes ────────────────────────────────────────────────────────────
// Handles: POST /v1/events — behavioral event ingestion (RFC-003 Phase 2a)
//
// Accepts batches of 1–batch_max behavioral events from agent runtimes.
// Events are stored in the behavioral_events D1 table for trust engine consumption.
//
// Rate limiting: uses checkEventRateLimit() from middleware/ratelimit.ts.
//   Multi-window: burst (per minute), hourly, daily — all tier-aware.
//   When limit is exceeded, returns 402 with x402 payment requirements.
//
// x402 payment: when rate limited, agents may include X-PAYMENT header to unlock.
//   Payment amount is tier-dependent: event_submit_free/paid/pro from x402.ts.
//   After payment, the request proceeds without counting against KV limits.
//
// Deduplication: KV key `event-dedup:{agent_id}:{event_id}` with 24h TTL.
//   Resubmitting the same event_id within 24h is idempotent (accepted, not re-inserted).
//   D1 UNIQUE INDEX on (agent_id, event_id) is the backstop for true duplicates.
//
// Auth: requires valid AAT (same as all /v1/* routes, mounted after auth middleware).

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { nanoid, json, err } from '../utils.js';
import { checkEventRateLimit, incrementEventRateLimit, getEventRateLimitTier, EVENT_LIMITS } from '../middleware/ratelimit.js';
import { make402Response, SERVICE_PRICES, verifyX402Payment, settleX402Payment, trackX402Spend } from '../x402.js';

export const eventRoutes = new Hono<HonoEnv>();

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventCategory = 'tool' | 'resource' | 'auth' | 'session' | 'escalation' | 'delegation' | 'error';
export type EventResult = 'success' | 'failure' | 'denied' | 'timeout';

interface BehavioralEvent {
  event_id: string;
  timestamp: string;
  category: EventCategory;
  action: string;
  result: EventResult;
  resource_type?: string;
  duration_ms?: number;
  error_code?: string;
  scope_used?: string;
  metadata?: Record<string, string | number | boolean>;
  signature?: string; // Optional Ed25519 signature for signed events
}

interface EventSubmission {
  events: BehavioralEvent[];
  session_id?: string;
  sdk_version?: string;
}

interface EventError {
  event_id: string;
  reason: 'invalid_schema' | 'duplicate' | 'too_old' | 'future_timestamp' | 'rate_limited';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_CATEGORIES: readonly EventCategory[] = ['tool', 'resource', 'auth', 'session', 'escalation', 'delegation', 'error'];
const VALID_RESULTS: readonly EventResult[] = ['success', 'failure', 'denied', 'timeout'];

const DEDUP_TTL_SECONDS = 86_400;     // 24h
const MAX_ERRORS_REPORTED = 10;
const MAX_METADATA_KEYS = 10;
const MAX_METADATA_VALUE_LENGTH = 256;
const MAX_EVENT_AGE_MS = 7 * 86_400_000;  // 7 days
const MAX_FUTURE_MS = 5 * 60_000;          // 5 minutes

// ─── Validation ───────────────────────────────────────────────────────────────

type ValidationResult =
  | { valid: true }
  | { valid: false; reason: EventError['reason']; message: string };

export function validateEvent(event: Partial<BehavioralEvent>): ValidationResult {
  // Required: event_id
  if (!event.event_id || typeof event.event_id !== 'string') {
    return { valid: false, reason: 'invalid_schema', message: 'event_id is required (string)' };
  }
  // Required: timestamp
  if (!event.timestamp || typeof event.timestamp !== 'string') {
    return { valid: false, reason: 'invalid_schema', message: 'timestamp is required (ISO 8601 string)' };
  }
  const ts = new Date(event.timestamp);
  if (isNaN(ts.getTime())) {
    return { valid: false, reason: 'invalid_schema', message: 'timestamp must be a valid ISO 8601 date string' };
  }
  // Timestamp bounds
  const now = Date.now();
  if (ts.getTime() < now - MAX_EVENT_AGE_MS) {
    return { valid: false, reason: 'too_old', message: 'timestamp is more than 7 days in the past' };
  }
  if (ts.getTime() > now + MAX_FUTURE_MS) {
    return { valid: false, reason: 'future_timestamp', message: 'timestamp is more than 5 minutes in the future' };
  }
  // Required: category
  if (!event.category || !VALID_CATEGORIES.includes(event.category as EventCategory)) {
    return { valid: false, reason: 'invalid_schema', message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` };
  }
  // Required: action
  if (!event.action || typeof event.action !== 'string') {
    return { valid: false, reason: 'invalid_schema', message: 'action is required (string)' };
  }
  // Required: result
  if (!event.result || !VALID_RESULTS.includes(event.result as EventResult)) {
    return { valid: false, reason: 'invalid_schema', message: `result must be one of: ${VALID_RESULTS.join(', ')}` };
  }
  // Optional: duration_ms
  if (event.duration_ms !== undefined && (typeof event.duration_ms !== 'number' || event.duration_ms < 0)) {
    return { valid: false, reason: 'invalid_schema', message: 'duration_ms must be a non-negative number' };
  }
  // Optional: metadata bounds
  if (event.metadata !== undefined) {
    if (typeof event.metadata !== 'object' || Array.isArray(event.metadata) || event.metadata === null) {
      return { valid: false, reason: 'invalid_schema', message: 'metadata must be an object' };
    }
    const keys = Object.keys(event.metadata);
    if (keys.length > MAX_METADATA_KEYS) {
      return { valid: false, reason: 'invalid_schema', message: `metadata exceeds ${MAX_METADATA_KEYS} key limit` };
    }
    for (const key of keys) {
      const val = event.metadata[key];
      if (typeof val === 'string' && val.length > MAX_METADATA_VALUE_LENGTH) {
        return {
          valid: false,
          reason: 'invalid_schema',
          message: `metadata["${key}"] exceeds ${MAX_METADATA_VALUE_LENGTH} character value limit`,
        };
      }
    }
  }
  return { valid: true };
}

// ─── Agent ID validation (for anonymous path) ─────────────────────────────────

const ANON_AGENT_ID_RE = /^acc_[A-Za-z0-9_-]{1,64}$/;

// ─── POST /v1/events ──────────────────────────────────────────────────────────

eventRoutes.post('/', async (c) => {
  const account = c.get('account');

  if (!c.env.AUDIT) {
    return err('Event ingestion not enabled for this instance.', 503, 'audit_unavailable');
  }

  // ── Anonymous path: no API key → require x402 payment ────────────────────────
  if (!account) {
    const xPayment = c.req.header('X-PAYMENT');
    if (!xPayment) {
      return make402Response(SERVICE_PRICES.event_submit_anon);
    }

    // Parse body first to get agent_id (required for anonymous submission)
    let anonBody: Record<string, unknown>;
    try {
      anonBody = await c.req.json<Record<string, unknown>>();
    } catch {
      return err('Request body must be valid JSON.', 400, 'invalid_json');
    }

    const anonAgentId = typeof anonBody.agent_id === 'string' ? anonBody.agent_id : null;
    if (!anonAgentId || !ANON_AGENT_ID_RE.test(anonAgentId)) {
      return err(
        'agent_id (acc_...) is required in request body for anonymous event submission.',
        400,
        'missing_agent_id',
      );
    }

    // Verify payment
    const verification = await verifyX402Payment(xPayment, SERVICE_PRICES.event_submit_anon);
    if (!verification.valid) {
      return make402Response(SERVICE_PRICES.event_submit_anon, { payment_error: verification.error });
    }

    // Settle payment
    const settlement = await settleX402Payment(xPayment, SERVICE_PRICES.event_submit_anon);
    if (!settlement.settled) {
      return make402Response(SERVICE_PRICES.event_submit_anon, { payment_error: settlement.error });
    }

    if (settlement.receipt) c.header('X-Payment-Response', settlement.receipt);

    // Track spend (fire-and-forget)
    c.executionCtx.waitUntil(
      trackX402Spend(c.env, anonAgentId, SERVICE_PRICES.event_submit_anon.amount, {
        payer: verification.payer,
        service: 'event_submit_anon',
      }).catch(() => {}),
    );

    // Validate events array
    const anonEvents = Array.isArray(anonBody.events) ? anonBody.events as Partial<BehavioralEvent>[] : null;
    if (!anonEvents || anonEvents.length === 0) {
      return err('events must be a non-empty array of behavioral events.', 400, 'invalid_schema');
    }

    const anonSessionId = typeof anonBody.session_id === 'string' ? anonBody.session_id.slice(0, 256) : null;
    const anonPendingInserts: { event: BehavioralEvent; id: string; isSigned: boolean; dedupKey: string }[] = [];
    const anonErrors: EventError[] = [];
    let anonIdempotentCount = 0;

    for (const rawEvent of anonEvents) {
      const event = rawEvent as Partial<BehavioralEvent>;
      const validation = validateEvent(event);
      if (!validation.valid) {
        if (anonErrors.length < MAX_ERRORS_REPORTED) {
          anonErrors.push({ event_id: String(event.event_id ?? '?'), reason: validation.reason });
        }
        continue;
      }
      const dedupKey = `event-dedup:${anonAgentId}:${event.event_id}`;
      try {
        const existing = await c.env.KEYS.get(dedupKey);
        if (existing !== null) { anonIdempotentCount++; continue; }
      } catch { /* fail-open */ }
      anonPendingInserts.push({
        event: event as BehavioralEvent,
        id: 'be_' + nanoid(16),
        isSigned: typeof event.signature === 'string' && event.signature.length > 0,
        dedupKey,
      });
    }

    let anonSuccessful = 0;
    for (const { event, id, isSigned, dedupKey } of anonPendingInserts) {
      try {
        await c.env.AUDIT.prepare(
          `INSERT OR IGNORE INTO behavioral_events
             (id, event_id, agent_id, timestamp, category, action, result,
              resource_type, duration_ms, error_code, scope_used, metadata_json,
              session_id, signed, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          event.event_id,
          anonAgentId,
          event.timestamp,
          event.category,
          event.action,
          event.result,
          event.resource_type ?? null,
          event.duration_ms ?? null,
          event.error_code ?? null,
          event.scope_used ?? null,
          event.metadata ? JSON.stringify(event.metadata) : null,
          anonSessionId,
          isSigned ? 1 : 0,
          'anonymous',
        ).run();
        anonSuccessful++;
        c.executionCtx.waitUntil(
          c.env.KEYS.put(dedupKey, '1', { expirationTtl: DEDUP_TTL_SECONDS }).catch(() => {}),
        );
      } catch (e) {
        console.error('anonymous behavioral_events insert failed:', e instanceof Error ? e.message : String(e));
        if (anonErrors.length < MAX_ERRORS_REPORTED) {
          anonErrors.push({ event_id: event.event_id, reason: 'duplicate' });
        }
      }
    }

    const anonTotalAccepted = anonSuccessful + anonIdempotentCount;
    const anonTotalRejected = anonEvents.length - anonTotalAccepted;
    return json({
      accepted: anonTotalAccepted,
      rejected: anonTotalRejected,
      ...(anonErrors.length > 0 ? { errors: anonErrors } : {}),
      source: 'anonymous',
    }, 202);
  }

  // ── Authenticated path (existing logic below) ─────────────────────────────────

  // ── Extract accountId + tier from account (set by auth middleware) ────────────

  const accountId = account.id;
  const tier = account.tier || 'free';
  const eventTier = getEventRateLimitTier(tier);
  const tierLimits = EVENT_LIMITS[eventTier];

  // ── Parse request body first (needed for batch size in rate limit check) ──────

  let body: EventSubmission;
  try {
    body = await c.req.json<EventSubmission>();
  } catch {
    return err('Request body must be valid JSON.', 400, 'invalid_json');
  }

  if (!Array.isArray(body?.events)) {
    return err('events must be an array of behavioral events.', 400, 'invalid_schema');
  }
  if (body.events.length === 0) {
    return err('events array must contain at least one event.', 400, 'invalid_schema');
  }
  if (body.events.length > tierLimits.batch_max) {
    return err(
      `events array exceeds maximum batch size of ${tierLimits.batch_max} for your tier (${eventTier}).`,
      400,
      'batch_too_large',
    );
  }

  // ── Rate limit check (multi-window: burst / hourly / daily) ──────────────────
  // Check with the actual event count so limits reflect events, not requests.

  const rl = await checkEventRateLimit(c.env, accountId, tier, body.events.length);

  if (!rl.allowed) {
    // Select tier-appropriate x402 service price
    const serviceKey = `event_submit_${eventTier}` as 'event_submit_free' | 'event_submit_paid' | 'event_submit_pro';
    const service = SERVICE_PRICES[serviceKey];

    const xPayment = c.req.header('X-PAYMENT');
    if (xPayment) {
      // Verify x402 payment
      const verification = await verifyX402Payment(xPayment, service);
      if (!verification.valid) {
        return make402Response(service, {
          rate_limit: {
            reason: 'payment_verification_failed',
            error: verification.error,
            hint: 'X-PAYMENT header is invalid or expired. See https://agentlair.dev/docs#x402',
          },
        });
      }

      // Settle the payment
      const settlement = await settleX402Payment(xPayment, service);
      if (!settlement.settled) {
        return make402Response(service, {
          rate_limit: {
            reason: 'payment_settlement_failed',
            error: settlement.error,
          },
        });
      }

      // Attach settlement receipt to response
      if (settlement.receipt) {
        c.header('X-Payment-Response', settlement.receipt);
      }

      // Track spend asynchronously (non-blocking — best-effort billing record)
      c.executionCtx.waitUntil(
        trackX402Spend(c.env, accountId, service.amount, {
          payer: verification.payer,
          service: serviceKey,
        }).catch(() => {}),
      );

      // Payment settled — fall through to event processing below.
    } else {
      // No payment header — return 402 with x402 payment requirements
      return make402Response(service, {
        upgrade_hint: rl.upgrade_hint,
        retry_after: rl.reset_at,
      });
    }
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id.slice(0, 256) : null;

  // Compute reset_at: start of next hour (for rate_limit in response)
  const now = new Date();
  const resetAt = new Date(now);
  resetAt.setUTCMinutes(0, 0, 0);
  resetAt.setUTCHours(resetAt.getUTCHours() + 1);

  // ── Process each event ────────────────────────────────────────────────────────

  type PendingInsert = {
    event: BehavioralEvent;
    id: string;
    isSigned: boolean;
    dedupKey: string;
  };

  const pendingInserts: PendingInsert[] = [];
  let idempotentCount = 0; // Events already seen (KV hit) — accepted without re-insert
  const errors: EventError[] = [];

  for (const rawEvent of body.events) {
    const event = rawEvent as Partial<BehavioralEvent>;

    // 1. Schema + timestamp validation
    const validation = validateEvent(event);
    if (!validation.valid) {
      if (errors.length < MAX_ERRORS_REPORTED) {
        errors.push({ event_id: String(event.event_id ?? '?'), reason: validation.reason });
      }
      continue;
    }

    // 2. KV-based deduplication (fast path — UNIQUE index is the D1 backstop)
    const dedupKey = `event-dedup:${accountId}:${event.event_id}`;
    try {
      const existing = await c.env.KEYS.get(dedupKey);
      if (existing !== null) {
        // Already seen within 24h — idempotent acceptance, no D1 insert, no rate increment
        idempotentCount++;
        continue;
      }
    } catch {
      // Fail-open: if KV unavailable, proceed (D1 UNIQUE index handles true dupes)
    }

    // 3. Queue for D1 insert
    pendingInserts.push({
      event: event as BehavioralEvent,
      id: 'be_' + nanoid(16),
      isSigned: typeof event.signature === 'string' && event.signature.length > 0,
      dedupKey,
    });
  }

  // ── Insert new events into D1 ─────────────────────────────────────────────────

  let successfulInserts = 0;

  for (const { event, id, isSigned, dedupKey } of pendingInserts) {
    try {
      await c.env.AUDIT.prepare(
        `INSERT OR IGNORE INTO behavioral_events
           (id, event_id, agent_id, timestamp, category, action, result,
            resource_type, duration_ms, error_code, scope_used, metadata_json,
            session_id, signed, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        event.event_id,
        accountId,
        event.timestamp,
        event.category,
        event.action,
        event.result,
        event.resource_type ?? null,
        event.duration_ms ?? null,
        event.error_code ?? null,
        event.scope_used ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        sessionId,
        isSigned ? 1 : 0,
        'api',
      ).run();

      successfulInserts++;

      // Mark event as seen in KV — prevents resubmission within 24h (best-effort)
      c.executionCtx.waitUntil(
        c.env.KEYS.put(dedupKey, '1', { expirationTtl: DEDUP_TTL_SECONDS }).catch(() => {}),
      );
    } catch (e) {
      // D1 insert failure: UNIQUE constraint race or transient error
      console.error('behavioral_events insert failed:', e instanceof Error ? e.message : String(e));
      if (errors.length < MAX_ERRORS_REPORTED) {
        errors.push({ event_id: event.event_id, reason: 'duplicate' });
      }
    }
  }

  // ── Compute response ──────────────────────────────────────────────────────────

  const totalAccepted = successfulInserts + idempotentCount;
  const totalRejected = body.events.length - totalAccepted;

  // Increment rate limit counters by the number of new events actually inserted.
  // Idempotent resubmissions don't count (they weren't rate-limited on first submission).
  // Runs in waitUntil to avoid blocking the response.
  if (rl.allowed && successfulInserts > 0) {
    c.executionCtx.waitUntil(
      incrementEventRateLimit(c.env, accountId, tier, successfulInserts).catch(() => {}),
    );
  }

  // remaining: headroom after this batch, or 0 when payment was made
  const remaining = rl.allowed
    ? Math.max(0, (rl.hourly_remaining ?? tierLimits.hourly) - successfulInserts)
    : 0;

  return json({
    accepted: totalAccepted,
    rejected: totalRejected,
    ...(errors.length > 0 ? { errors } : {}),
    rate_limit: {
      remaining,
      reset_at: rl.reset_at ?? resetAt.toISOString(),
    },
  }, 202);
});
