// ─── Session Event Routes ─────────────────────────────────────────────────────
// Records PicoClaw agent session lifecycle events into the audit trail.
// These routes are intentionally thin — the audit middleware captures
// the event automatically. The body is echoed back for confirmation.
//
// Routes:
//   POST /v1/sessions/start — session started
//   POST /v1/sessions/end   — session ended
//   POST /v1/sessions/event — generic event (email sent, deployment, etc.)
//
// All routes require authentication. Captured by audit middleware as:
//   category: 'session'
//   action:   'session.start' | 'session.end' | 'session.event'

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';

export const sessionRoutes = new Hono<HonoEnv>();

// ─── POST /sessions/start ─────────────────────────────────────────────────────
// Called when a PicoClaw agent session begins.

sessionRoutes.post('/start', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const {
    session_id,
    model,
    session_type,
    source,
  } = body as {
    session_id?: string;
    model?: string;
    session_type?: string;
    source?: string;
  };

  if (!session_id) return err('session_id is required.', 400, 'missing_session_id');

  return json({
    ok: true,
    event: 'session.start',
    session_id,
    model: model ?? null,
    session_type: session_type ?? null,
    source: source ?? null,
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /sessions/end ───────────────────────────────────────────────────────
// Called when a PicoClaw agent session ends.

sessionRoutes.post('/end', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const {
    session_id,
    summary,
    tasks_completed,
    tasks_created,
    reflections_count,
    end_reason,
  } = body as {
    session_id?: string;
    summary?: string;
    tasks_completed?: number;
    tasks_created?: number;
    reflections_count?: number;
    end_reason?: string;
  };

  if (!session_id) return err('session_id is required.', 400, 'missing_session_id');

  return json({
    ok: true,
    event: 'session.end',
    session_id,
    summary: summary ?? null,
    tasks_completed: tasks_completed ?? null,
    tasks_created: tasks_created ?? null,
    reflections_count: reflections_count ?? null,
    end_reason: end_reason ?? null,
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /sessions/event ─────────────────────────────────────────────────────
// Generic event log (email sent, git push, deployment, etc.)

sessionRoutes.post('/event', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const {
    session_id,
    event_type,
    description,
    metadata,
  } = body as {
    session_id?: string;
    event_type?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  };

  if (!session_id) return err('session_id is required.', 400, 'missing_session_id');
  if (!event_type) return err('event_type is required.', 400, 'missing_event_type');

  return json({
    ok: true,
    event: 'session.event',
    session_id,
    event_type,
    description: description ?? null,
    metadata: metadata ?? null,
    timestamp: new Date().toISOString(),
  });
});
