import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';
import { insertFeedback, validateFeedbackPayload } from '../lib/telemetry-feedback.js';

export const telemetryFeedbackRoutes = new Hono<HonoEnv>();

// POST /v1/telemetry/feedback — auth required. Body: { claim_id, outcome_correct, evidence_type, confidence_stated? }
telemetryFeedbackRoutes.post('/feedback', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Audit DB not configured.', 503, 'audit_unavailable');

  const raw = await c.req.text();
  if (raw.length > 8 * 1024) {
    return err('Request body exceeds 8 KB.', 413, 'body_too_large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return err('Body is not valid JSON.', 400, 'invalid_json');
  }

  const validated = validateFeedbackPayload(body);
  if (!validated.ok) {
    return c.json({ error: validated.error, message: validated.message, hint: validated.hint }, 400);
  }

  const result = await insertFeedback(c.env, account.id, validated.value);
  if (!result.ok) {
    return c.json(
      {
        error: result.error,
        message: 'Feedback for this claim_id has already been recorded for this account.',
      },
      409,
    );
  }
  return json({ ok: true, id: result.row.id }, 200);
});
