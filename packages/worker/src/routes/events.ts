// ─── Events Routes ────────────────────────────────────────────────────────────
// Handles: POST /v1/events — behavioral event ingestion (RFC-003 Phase 2a)
//
// Accepts batches of 1–100 behavioral events from agent runtimes.
// Events are stored in the behavioral_events D1 table for trust engine consumption.
//
// Deduplication: KV key `event-dedup:{agent_id}:{event_id}` with 24h TTL.
//   Resubmitting the same event_id within 24h is idempotent (accepted, not re-inserted).
//
// Rate limiting: KV key `event-rl:{agent_id}:hour:{YYYY-MM-DDTHH}` sliding window.
//   Default: 1,000 events/hour. Only new insertions count against the limit.
//
// Auth: requires valid AAT (same as all /v1/* routes, mounted after auth middleware).

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { nanoid, json, err } from '../utils.js';

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

export const DEFAULT_HOURLY_LIMIT = 1_000;
const DEDUP_TTL_SECONDS = 86_400;    // 24h
const RATE_LIMIT_TTL_SECONDS = 7_200; // 2h (covers current + previous hour window)
const MAX_ERRORS_REPORTED = 10;
const MAX_METADATA_KEYS = 10;
const MAX_METADATA_VALUE_LENGTH = 256;
const MAX_BATCH_SIZE = 100;
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

// ─── POST /v1/events ──────────────────────────────────────────────────────────

eventRoutes.post('/', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT) {
    return err('Event ingestion not enabled for this instance.', 503, 'audit_unavailable');
  }

  // ── Parse request body ────────────────────────────────────────────────────────

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
  if (body.events.length > MAX_BATCH_SIZE) {
    return err(`events array exceeds maximum batch size of ${MAX_BATCH_SIZE}.`, 400, 'batch_too_large');
  }

  const agentId = account.id;
  const sessionId = typeof body.session_id === 'string' ? body.session_id.slice(0, 256) : null;

  // ── Rate limit check (hourly sliding window) ──────────────────────────────────

  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
  const rlKey = `event-rl:${agentId}:hour:${hourKey}`;

  // Compute reset time: start of next hour
  const resetAt = new Date(now);
  resetAt.setUTCMinutes(0, 0, 0);
  resetAt.setUTCHours(resetAt.getUTCHours() + 1);

  let currentHourCount = 0;
  try {
    const raw = await c.env.KEYS.get(rlKey);
    currentHourCount = parseInt(raw ?? '0', 10) || 0;
  } catch {
    // Fail-open: if KV unavailable, allow the request
  }

  // Reject entire batch if account is already at the hourly ceiling
  if (currentHourCount >= DEFAULT_HOURLY_LIMIT) {
    return json({
      accepted: 0,
      rejected: body.events.length,
      errors: body.events.slice(0, MAX_ERRORS_REPORTED).map(e => ({
        event_id: String((e as unknown as Record<string, unknown>).event_id ?? '?'),
        reason: 'rate_limited' as const,
      })),
      rate_limit: { remaining: 0, reset_at: resetAt.toISOString() },
    }, 429);
  }

  // ── Process each event ────────────────────────────────────────────────────────

  // Events to write to D1 (passed validation + dedup, within rate limit)
  type PendingInsert = {
    event: BehavioralEvent;
    id: string;
    isSigned: boolean;
    dedupKey: string;
  };

  const pendingInserts: PendingInsert[] = [];
  let idempotentCount = 0; // Events already seen (KV hit) — counted as accepted, no D1 insert
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

    // 2. Per-event rate limit check (don't accept more than headroom allows)
    const headroom = DEFAULT_HOURLY_LIMIT - currentHourCount;
    if (pendingInserts.length >= headroom) {
      if (errors.length < MAX_ERRORS_REPORTED) {
        errors.push({ event_id: event.event_id!, reason: 'rate_limited' });
      }
      continue;
    }

    // 3. Deduplication via KV
    const dedupKey = `event-dedup:${agentId}:${event.event_id}`;
    try {
      const existing = await c.env.KEYS.get(dedupKey);
      if (existing !== null) {
        // Already seen — idempotent acceptance (no re-insert, no rate limit increment)
        idempotentCount++;
        continue;
      }
    } catch {
      // Fail-open: if KV unavailable, proceed to D1 (UNIQUE index handles true dupes)
    }

    // 4. Queue for D1 insert
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
        agentId,
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

      // Mark as seen in KV (non-blocking — best-effort dedup for future requests)
      c.executionCtx.waitUntil(
        c.env.KEYS.put(dedupKey, '1', { expirationTtl: DEDUP_TTL_SECONDS }).catch(() => {}),
      );
    } catch (e) {
      // D1 insert failure (race condition on UNIQUE constraint or transient error)
      console.error('behavioral_events insert failed:', e instanceof Error ? e.message : String(e));
      if (errors.length < MAX_ERRORS_REPORTED) {
        errors.push({ event_id: event.event_id, reason: 'duplicate' });
      }
    }
  }

  // ── Update rate limit counter (non-blocking) ──────────────────────────────────

  if (successfulInserts > 0) {
    const newCount = currentHourCount + successfulInserts;
    c.executionCtx.waitUntil(
      c.env.KEYS.put(rlKey, String(newCount), { expirationTtl: RATE_LIMIT_TTL_SECONDS }).catch(() => {}),
    );
  }

  // ── Compute response totals ───────────────────────────────────────────────────

  const totalAccepted = successfulInserts + idempotentCount;
  const totalRejected = body.events.length - totalAccepted;
  const remainingAfterBatch = Math.max(0, DEFAULT_HOURLY_LIMIT - (currentHourCount + successfulInserts));

  return json({
    accepted: totalAccepted,
    rejected: totalRejected,
    ...(errors.length > 0 ? { errors } : {}),
    rate_limit: {
      remaining: remainingAfterBatch,
      reset_at: resetAt.toISOString(),
    },
  }, 202);
});
