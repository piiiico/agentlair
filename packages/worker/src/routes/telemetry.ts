// ─── Telemetry Routes ──────────────────────────────────────────────────────────
// Handles: POST /v1/telemetry/submit
//
// Ingests behavioral telemetry events from external agent runtimes (e.g. Springdrift).
// Events are stored as shared_observations so they feed directly into the trust score
// computed by GET /v1/trust/:agentId.
//
// Accepts TWO payload formats:
//
//   1. Single bare event (Springdrift default):
//      {
//        "event":       "axiom.committed",
//        "agent_id":    "<springdrift-agent-id>",
//        "timestamp":   "2026-04-14T10:23:45Z",
//        "axiom_hash":  "<sha256 of axiom content>",
//        "action_type": "tool_call|memory_update|decision|external_request",
//        "outcome":     "success|failure|anomaly",
//        "context_ref": "<optional correlation ref>"
//      }
//
//   2. Batched array (original spec):
//      {
//        "agent_id":    "<springdrift-agent-id>",
//        "events": [
//          {
//            "event":       "axiom.committed",
//            "timestamp":   "2026-04-14T10:23:45Z",
//            "axiom_hash":  "<sha256>",
//            "action_type": "tool_call",
//            "outcome":     "success",
//            "context_ref": "<optional>"
//          },
//          ...
//        ]
//      }
//
// Auth: requires API key (same as other /v1/* endpoints).
// Observation layout:
//   agent_id     = authenticated AgentLair account ID (acc_*)
//   account_id   = authenticated AgentLair account ID (acc_*)
//   topic        = "telemetry.<event>" (e.g. "telemetry.axiom.committed")
//   content      = JSON of full payload (external_agent_id, axiom_hash, action_type, outcome, context_ref)
//   shared       = 1 (telemetry is always cross-org visible — that's the point)
//   display_name = "springdrift" (integration source; future: from API key metadata)

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv } from '../types.js';
import { tursoExecute } from '../email-provider.js';

export const telemetryRoutes = new Hono<HonoEnv>();

// ─── Types ─────────────────────────────────────────────────────────────────────

type ActionType = 'tool_call' | 'memory_update' | 'decision' | 'external_request';
type Outcome = 'success' | 'failure' | 'anomaly';

interface TelemetryEvent {
  event: string;
  timestamp: string;
  axiom_hash: string;
  action_type: ActionType;
  outcome: Outcome;
  context_ref?: string;
}

const VALID_ACTION_TYPES: ActionType[] = ['tool_call', 'memory_update', 'decision', 'external_request'];
const VALID_OUTCOMES: Outcome[] = ['success', 'failure', 'anomaly'];

const MAX_BATCH_SIZE = 100;

// ─── Validation ────────────────────────────────────────────────────────────────

interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Validates a single telemetry event. Returns null if valid, or a ValidationError.
 */
function validateEvent(ev: Partial<TelemetryEvent>, index?: number): ValidationError | null {
  const prefix = index !== undefined ? `events[${index}].` : '';

  if (!ev.event || typeof ev.event !== 'string') {
    return { field: `${prefix}event`, message: 'Required: event (string, e.g. "axiom.committed").', code: 'missing_event' };
  }
  if (!ev.timestamp || typeof ev.timestamp !== 'string') {
    return { field: `${prefix}timestamp`, message: 'Required: timestamp (ISO 8601 string).', code: 'missing_timestamp' };
  }
  const ts = new Date(ev.timestamp);
  if (isNaN(ts.getTime())) {
    return { field: `${prefix}timestamp`, message: 'timestamp must be a valid ISO 8601 date string.', code: 'invalid_timestamp' };
  }
  if (!ev.axiom_hash || typeof ev.axiom_hash !== 'string') {
    return { field: `${prefix}axiom_hash`, message: 'Required: axiom_hash (SHA-256 hex string).', code: 'missing_axiom_hash' };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(ev.axiom_hash)) {
    return { field: `${prefix}axiom_hash`, message: 'axiom_hash must be a 64-character hex string (SHA-256).', code: 'invalid_axiom_hash' };
  }
  if (!ev.action_type || !VALID_ACTION_TYPES.includes(ev.action_type as ActionType)) {
    return { field: `${prefix}action_type`, message: `Required: action_type. One of: ${VALID_ACTION_TYPES.join(', ')}.`, code: 'invalid_action_type' };
  }
  if (!ev.outcome || !VALID_OUTCOMES.includes(ev.outcome as Outcome)) {
    return { field: `${prefix}outcome`, message: `Required: outcome. One of: ${VALID_OUTCOMES.join(', ')}.`, code: 'invalid_outcome' };
  }
  if (ev.context_ref !== undefined && (typeof ev.context_ref !== 'string' || ev.context_ref.length > 512)) {
    return { field: `${prefix}context_ref`, message: 'context_ref must be a string, max 512 characters.', code: 'invalid_context_ref' };
  }
  return null;
}

/**
 * Detect payload format and normalize to { agent_id, events[] }.
 * Returns an error response string if the payload is malformed, or the normalized shape.
 */
function normalizePayload(body: Record<string, unknown>): { agent_id: string; events: Partial<TelemetryEvent>[] } | Response {
  // Batched format: { agent_id, events: [...] }
  if (Array.isArray(body.events)) {
    const agent_id = body.agent_id;
    if (!agent_id || typeof agent_id !== 'string') {
      return err('Required: agent_id (string) at top level for batched format.', 400, 'missing_agent_id');
    }
    if ((agent_id as string).length > 256) {
      return err('agent_id must be ≤ 256 characters.', 400, 'invalid_agent_id');
    }
    if (body.events.length === 0) {
      return err('events array must contain at least one event.', 400, 'empty_events');
    }
    if (body.events.length > MAX_BATCH_SIZE) {
      return err(`events array exceeds maximum batch size of ${MAX_BATCH_SIZE}.`, 400, 'batch_too_large');
    }
    return { agent_id: agent_id as string, events: body.events as Partial<TelemetryEvent>[] };
  }

  // Single bare event format: { event, agent_id, ... }
  const agent_id = body.agent_id;
  if (!agent_id || typeof agent_id !== 'string') {
    return err('Required: agent_id (string — the external runtime\'s agent identifier).', 400, 'missing_agent_id');
  }
  if ((agent_id as string).length > 256) {
    return err('agent_id must be ≤ 256 characters.', 400, 'invalid_agent_id');
  }

  // Extract event fields (everything except agent_id)
  const { agent_id: _, ...eventFields } = body;
  return { agent_id: agent_id as string, events: [eventFields as Partial<TelemetryEvent>] };
}

// ─── POST /v1/telemetry/submit ────────────────────────────────────────────────
// Accept single events or batched arrays. Store as shared observations.
// Returns: { accepted: true, agent_token: <AgentLair account ID>, ... }

telemetryRoutes.post('/submit', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return err('Request body must be valid JSON.', 400, 'invalid_json');
  }

  // ── Normalize payload ───────────────────────────────────────────────────────

  const normalized = normalizePayload(body);
  if (normalized instanceof Response) return normalized;

  const { agent_id, events } = normalized;

  // ── Validate all events ───────────────────────────────────────────────────

  const isBatch = events.length > 1 || Array.isArray(body.events);
  for (let i = 0; i < events.length; i++) {
    const validationError = validateEvent(events[i], isBatch ? i : undefined);
    if (validationError) {
      return err(validationError.message, 400, validationError.code);
    }
  }

  // ── Store each event as a shared observation ──────────────────────────────

  const display_name = 'springdrift';
  const results: { observation_id: string; event: string; ingested_at: string }[] = [];

  try {
    for (const ev of events as TelemetryEvent[]) {
      const topic = `telemetry.${ev.event.replace(/[^a-z0-9._-]/gi, '_').slice(0, 100)}`;
      const content = JSON.stringify({
        external_agent_id: agent_id,
        axiom_hash: ev.axiom_hash,
        action_type: ev.action_type,
        outcome: ev.outcome,
        context_ref: ev.context_ref ?? null,
        source_timestamp: ev.timestamp,
      });

      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      const created_at = new Date().toISOString();

      await tursoExecute(
        c.env,
        'INSERT INTO shared_observations (id, agent_id, topic, content, created_at, account_id, shared, display_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, account.id, topic, content, created_at, account.id, '1', display_name],
      );

      results.push({ observation_id: id, event: ev.event, ingested_at: created_at });
    }

    // Single event: flat response (backward-compatible)
    if (results.length === 1) {
      return json({
        accepted: true,
        agent_token: account.id,
        observation_id: results[0].observation_id,
        ingested_at: results[0].ingested_at,
      }, 201);
    }

    // Batched: array of results
    return json({
      accepted: true,
      agent_token: account.id,
      count: results.length,
      observations: results,
    }, 201);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to store telemetry event: ${message}`, 502, 'storage_error');
  }
});

// ─── GET /v1/telemetry/status ──────────────────────────────────────────────────
// Quick health check for the telemetry integration.
// Returns event counts for the authenticated account.

telemetryRoutes.get('/status', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  try {
    const result = await tursoExecute(
      c.env,
      `SELECT COUNT(*) as total, MAX(created_at) as last_seen
       FROM shared_observations
       WHERE account_id = ? AND topic LIKE 'telemetry.%'`,
      [account.id],
    );

    const row = result.rows[0] ?? {};
    const total = typeof row.total === 'number' ? row.total : parseInt(String(row.total ?? 0), 10);

    return json({
      ok: true,
      account_id: account.id,
      telemetry_events: isNaN(total) ? 0 : total,
      last_seen: row.last_seen ?? null,
      trust_url: `/v1/trust/${account.id}`,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to query telemetry status: ${message}`, 502, 'storage_error');
  }
});
