// ─── Operator Profile Routes ──────────────────────────────────────────────────
// Phase 2.5 Components 2 + 3: operator-declared attestation workflow + review bandwidth.
//
// Endpoints:
//   PUT /v1/operator/profile — upsert caller's operator profile (auth required)
//   GET /v1/operator/profile — read caller's operator profile (auth required, 404 if unset)
//
// Mounted in index.ts as: app.route('/v1/operator', operatorProfileRoutes)

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';
import {
  getOperatorProfile,
  putOperatorProfile,
  validatePutOperatorProfileBody,
} from '../lib/operator-profile.js';

export const operatorProfileRoutes = new Hono<HonoEnv>();

// PUT /v1/operator/profile — auth required. Body: { attestationWorkflow, reviewBandwidth }.
operatorProfileRoutes.put('/profile', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Audit DB not configured.', 503, 'audit_unavailable');

  const raw = await c.req.text();
  if (raw.length > 8 * 1024) {
    return err('Request body exceeds 8 KB.', 413, 'body_too_large');
  }

  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { return err('Body is not valid JSON.', 400, 'invalid_json'); }

  const result = validatePutOperatorProfileBody(body);
  if (!result.ok) {
    return c.json({ error: result.error, message: result.message, hint: result.hint }, 400);
  }

  try {
    const stored = await putOperatorProfile(c.env, account.id, result.value);
    return json(stored, 200);
  } catch {
    return err('Audit DB unavailable.', 503, 'audit_unavailable');
  }
});

// GET /v1/operator/profile — auth required. Returns 404 when not yet set.
operatorProfileRoutes.get('/profile', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Audit DB not configured.', 503, 'audit_unavailable');

  try {
    const profile = await getOperatorProfile(c.env, account.id);
    if (!profile) {
      return err('No operator profile set for this account.', 404, 'not_found');
    }
    return json(profile, 200);
  } catch {
    return err('Audit DB unavailable.', 503, 'audit_unavailable');
  }
});
