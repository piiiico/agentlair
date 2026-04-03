// ─── Pod Routes ────────────────────────────────────────────────────────────────
// Handles: /v1/pods/* (create, list, get, delete isolated environments)
//
// Pods provide multi-tenant isolation for platform builders (B2B2B play).
// Each pod gets its own API key and isolated email/webhook/vault namespace.
//
// KEY DESIGN: A pod acts as a "virtual account" — its pod_id is used as
// account.id for ALL ownership checks (email-owner, webhook bindings, vault).
// This means existing isolation logic works without modification: a pod key
// can only access resources owned by that pod_id.
//
// KV layout:
//   KEYS namespace:
//     pod:<pod_id>              → Pod JSON object
//     account-pods:<account_id> → JSON array of pod_ids (index)
//     key:<apiKeyHash>          → {id: pod_id, type: "pod", pod_id, parent_id, ...}
//
// Pod key format: al_pod_<nanoid(32)>
//
// All routes require authentication (account !== null).
// Pod keys (account.type === 'pod') cannot create pods — no infinite nesting.

import { Hono } from 'hono';
import { nanoid, sha256hex, json, err } from '../utils.js';
import type { Pod, HonoEnv, PodRateLimits, SpendingCaps } from '../types.js';
import { getPeriodSpend } from '../x402.js';

// ── Validate rate_limits input ────────────────────────────────────────────────
// Returns parsed PodRateLimits or throws an error Response.
// All fields optional, must be positive integers ≤ 1,000,000.
// Validates cross-field ordering: per_minute <= per_hour <= per_day.

function parseRateLimits(raw: unknown): { rateLimits: PodRateLimits | null | undefined; error?: Response } {
  if (raw === undefined) return { rateLimits: undefined }; // not provided — leave unchanged
  if (raw === null) return { rateLimits: null };           // explicitly unset
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { rateLimits: undefined, error: err('rate_limits must be an object or null.', 400, 'invalid_rate_limits') };
  }
  const obj = raw as Record<string, unknown>;
  const parsed: PodRateLimits = {};

  for (const field of ['requests_per_day', 'requests_per_hour', 'requests_per_minute'] as const) {
    const val = obj[field];
    if (val === undefined) continue;
    if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0 || val > 1_000_000) {
      return { rateLimits: undefined, error: err(`${field} must be a positive integer ≤ 1,000,000.`, 400, 'invalid_rate_limits') };
    }
    parsed[field] = val;
  }

  // Cross-field ordering validation
  if (parsed.requests_per_minute != null && parsed.requests_per_hour != null) {
    if (parsed.requests_per_minute > parsed.requests_per_hour) {
      return { rateLimits: undefined, error: err('requests_per_minute must be ≤ requests_per_hour.', 400, 'invalid_rate_limits') };
    }
  }
  if (parsed.requests_per_hour != null && parsed.requests_per_day != null) {
    if (parsed.requests_per_hour > parsed.requests_per_day) {
      return { rateLimits: undefined, error: err('requests_per_hour must be ≤ requests_per_day.', 400, 'invalid_rate_limits') };
    }
  }

  return { rateLimits: Object.keys(parsed).length > 0 ? parsed : {} };
}

// ── Validate spending_caps input ──────────────────────────────────────────────
// Returns parsed SpendingCaps or error Response.
// All fields optional, must be positive integers (atomic USDC, 6 decimals).
// Max cap: 1,000,000,000 (1000 USDC per period — sanity limit).

function parseSpendingCaps(raw: unknown): { caps: SpendingCaps | null | undefined; error?: Response } {
  if (raw === undefined) return { caps: undefined };   // not provided — leave unchanged
  if (raw === null) return { caps: null };              // explicitly unset
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { caps: undefined, error: err('spending_caps must be an object or null.', 400, 'invalid_spending_caps') };
  }
  const obj = raw as Record<string, unknown>;
  const parsed: SpendingCaps = {};

  for (const field of ['daily', 'weekly', 'monthly'] as const) {
    const val = obj[field];
    if (val === undefined) continue;
    if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0 || val > 1_000_000_000) {
      return { caps: undefined, error: err(`spending_caps.${field} must be a positive integer \u2264 1,000,000,000 (atomic USDC).`, 400, 'invalid_spending_caps') };
    }
    parsed[field] = val;
  }

  // Cross-field ordering: daily <= weekly <= monthly (makes logical sense)
  if (parsed.daily != null && parsed.weekly != null && parsed.daily > parsed.weekly) {
    return { caps: undefined, error: err('spending_caps.daily must be \u2264 spending_caps.weekly.', 400, 'invalid_spending_caps') };
  }
  if (parsed.weekly != null && parsed.monthly != null && parsed.weekly > parsed.monthly) {
    return { caps: undefined, error: err('spending_caps.weekly must be \u2264 spending_caps.monthly.', 400, 'invalid_spending_caps') };
  }
  if (parsed.daily != null && parsed.monthly != null && parsed.daily > parsed.monthly) {
    return { caps: undefined, error: err('spending_caps.daily must be \u2264 spending_caps.monthly.', 400, 'invalid_spending_caps') };
  }

  return { caps: Object.keys(parsed).length > 0 ? parsed : {} };
}

export const podRoutes = new Hono<HonoEnv>();

// ── POST /v1/pods — create a new pod ───────────────────────────────────────

podRoutes.post('/', async (c) => {
  const account = c.get('account');

  // All pod routes require auth (belt-and-suspenders: middleware already ensures this)
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Pod keys cannot create pods (no infinite nesting)
  if (account.type === 'pod') {
    return err('Pod keys cannot create pods. Use your platform API key.', 403, 'pod_nested_forbidden');
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) || null : null;

  // Validate rate_limits if provided
  const { rateLimits, error: rlError } = parseRateLimits(body.rate_limits);
  if (rlError) return rlError;

  // Validate spending_caps if provided
  const { caps: spendingCaps, error: scError } = parseSpendingCaps(body.spending_caps);
  if (scError) return scError;

  const podId = 'pod_' + nanoid(16);
  const apiKey = 'al_pod_' + nanoid(32);
  const apiKeyHash = await sha256hex(apiKey);
  const now = new Date().toISOString();

  const pod: Pod = {
    id: podId,
    parent_id: account.id,
    name: name,
    created_at: now,
    status: 'active',
    ...(rateLimits !== undefined ? { rate_limits: rateLimits } : {}),
    ...(spendingCaps !== undefined ? { spending_caps: spendingCaps } : {}),
  };

  // Store pod metadata
  await c.env.KEYS.put('pod:' + podId, JSON.stringify(pod));

  // Update parent account's pod index
  const podsIndexKey = 'account-pods:' + account.id;
  const podsRaw = await c.env.KEYS.get(podsIndexKey);
  const podIds: string[] = podsRaw ? JSON.parse(podsRaw) : [];
  podIds.push(podId);
  await c.env.KEYS.put(podsIndexKey, JSON.stringify(podIds));

  // Store pod API key — id = pod_id so all ownership checks use pod namespace
  const keyEntry = {
    id: podId,           // virtual account ID (used for all resource ownership)
    type: 'pod',
    pod_id: podId,
    parent_id: account.id,
    prefix: apiKey.slice(0, 10),
    created_at: now,
    tier: account.tier || 'free',
    status: 'active',
  };
  await c.env.KEYS.put('key:' + apiKeyHash, JSON.stringify(keyEntry));

  return json({
    id: podId,
    name: pod.name,
    api_key: apiKey,
    created_at: now,
    status: 'active',
    ...(pod.rate_limits != null ? { rate_limits: pod.rate_limits } : {}),
    ...(pod.spending_caps != null ? { spending_caps: pod.spending_caps } : {}),
    warning: 'Store this API key securely — it will not be shown again.',
  }, 201);
});

// ── GET /v1/pods — list pods for this account ───────────────────────────────

podRoutes.get('/', async (c) => {
  const account = c.get('account');

  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Pod keys: return their own pod info
  if (account.type === 'pod' && account.pod_id) {
    const podRaw = await c.env.KEYS.get('pod:' + account.pod_id);
    if (!podRaw) return json({ pods: [], count: 0 });
    const pod: Pod = JSON.parse(podRaw);
    return json({
      pods: [{ id: pod.id, name: pod.name, created_at: pod.created_at, status: pod.status }],
      count: 1,
    });
  }

  const podsIndexKey = 'account-pods:' + account.id;
  const podsRaw = await c.env.KEYS.get(podsIndexKey);
  if (!podsRaw) return json({ pods: [], count: 0 });

  const podIds: string[] = JSON.parse(podsRaw);
  const podObjects = await Promise.all(
    podIds.map(async (id) => {
      const raw = await c.env.KEYS.get('pod:' + id);
      if (!raw) return null;
      const pod: Pod = JSON.parse(raw);
      return { id: pod.id, name: pod.name, created_at: pod.created_at, status: pod.status };
    }),
  );

  const pods = podObjects.filter(Boolean);
  return json({ pods, count: pods.length });
});

// ── GET /v1/pods/:id — get pod info ───────────────────────────────────────

podRoutes.get('/:id', async (c) => {
  const account = c.get('account');
  const podId = c.req.param('id');

  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const podRaw = await c.env.KEYS.get('pod:' + podId);
  if (!podRaw) return err('Pod not found.', 404, 'pod_not_found');

  const pod: Pod = JSON.parse(podRaw);

  // Only parent account or the pod itself can view
  if (pod.parent_id !== account.id && account.pod_id !== podId) {
    return err('Pod not found.', 404, 'pod_not_found'); // don't reveal existence
  }

  // Fetch current usage counters (for rate_limits display)
  let usage: { today: number; this_hour: number; this_minute: number } | undefined;
  if (pod.rate_limits) {
    try {
      const now = new Date();
      const day    = now.toISOString().slice(0, 10);
      const hour   = now.toISOString().slice(0, 13);
      const minute = now.toISOString().slice(0, 16);
      const [dayRaw, hourRaw, minRaw] = await Promise.all([
        c.env.KEYS.get(`pod-rl:${pod.id}:day:${day}`),
        c.env.KEYS.get(`pod-rl:${pod.id}:hour:${hour}`),
        c.env.KEYS.get(`pod-rl:${pod.id}:min:${minute}`),
      ]);
      usage = {
        today:       parseInt(dayRaw  || '0'),
        this_hour:   parseInt(hourRaw || '0'),
        this_minute: parseInt(minRaw  || '0'),
      };
    } catch { /* fail-open: usage is informational */ }
  }

  // Fetch current period spend (for spending_caps display)
  let periodSpend: { daily: number; weekly: number; monthly: number } | undefined;
  if (pod.spending_caps) {
    try {
      periodSpend = await getPeriodSpend(c.env, pod.id);
    } catch { /* fail-open */ }
  }

  return json({
    id: pod.id,
    name: pod.name,
    created_at: pod.created_at,
    status: pod.status,
    parent_id: pod.parent_id,
    ...(pod.suspended_at ? { suspended_at: pod.suspended_at } : {}),
    ...(pod.rate_limits != null ? { rate_limits: pod.rate_limits } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(pod.spending_caps != null ? { spending_caps: pod.spending_caps } : {}),
    ...(periodSpend !== undefined ? { spend: periodSpend } : {}),
  });
});

// ── DELETE /v1/pods/:id — suspend a pod ──────────────────────────────────

podRoutes.delete('/:id', async (c) => {
  const account = c.get('account');
  const podId = c.req.param('id');

  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Pod keys cannot delete pods
  if (account.type === 'pod') {
    return err('Pod keys cannot delete pods. Use your platform API key.', 403, 'pod_delete_forbidden');
  }

  const podRaw = await c.env.KEYS.get('pod:' + podId);
  if (!podRaw) return err('Pod not found.', 404, 'pod_not_found');

  const pod: Pod = JSON.parse(podRaw);
  if (pod.parent_id !== account.id) {
    return err('Pod not found.', 404, 'pod_not_found');
  }

  // Soft delete — suspend the pod, preserve data
  pod.status = 'suspended';
  pod.suspended_at = new Date().toISOString();
  await c.env.KEYS.put('pod:' + podId, JSON.stringify(pod));

  return json({
    id: podId,
    status: 'suspended',
    message: 'Pod suspended. Email addresses and data are preserved. Use POST /v1/pods to create a new pod.',
  });
});

// ── PATCH /v1/pods/:id — update pod name and/or rate_limits ──────────────────

podRoutes.patch('/:id', async (c) => {
  const account = c.get('account');
  const podId = c.req.param('id');

  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Pod keys cannot modify their own rate limits
  if (account.type === 'pod') {
    return err('Pod keys cannot update pod settings. Use your platform API key.', 403, 'pod_update_forbidden');
  }

  const podRaw = await c.env.KEYS.get('pod:' + podId);
  if (!podRaw) return err('Pod not found.', 404, 'pod_not_found');

  const pod: Pod = JSON.parse(podRaw);
  if (pod.parent_id !== account.id) {
    return err('Pod not found.', 404, 'pod_not_found');
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}

  // Update name if provided
  if (body.name !== undefined) {
    pod.name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) || null : null;
  }

  // Update rate_limits if provided (null = remove, object = set/update)
  if ('rate_limits' in body) {
    const { rateLimits, error: rlError } = parseRateLimits(body.rate_limits);
    if (rlError) return rlError;
    if (rateLimits !== undefined) {
      pod.rate_limits = rateLimits;
    }
  }

  // Update spending_caps if provided (null = remove, object = set/update)
  if ('spending_caps' in body) {
    const { caps, error: scError } = parseSpendingCaps(body.spending_caps);
    if (scError) return scError;
    if (caps !== undefined) {
      pod.spending_caps = caps;
    }
  }

  await c.env.KEYS.put('pod:' + podId, JSON.stringify(pod));

  return json({
    id: pod.id,
    name: pod.name,
    status: pod.status,
    ...(pod.rate_limits != null ? { rate_limits: pod.rate_limits } : { rate_limits: null }),
    ...(pod.spending_caps != null ? { spending_caps: pod.spending_caps } : { spending_caps: null }),
    updated: true,
  });
});

// ── POST /v1/pods/:id/keys — rotate / create a new API key for the pod ────

podRoutes.post('/:id/keys', async (c) => {
  const account = c.get('account');
  const podId = c.req.param('id');

  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Only parent account can issue pod keys
  if (account.type === 'pod') {
    return err('Pod keys cannot issue new pod keys. Use your platform API key.', 403, 'pod_key_forbidden');
  }

  const podRaw = await c.env.KEYS.get('pod:' + podId);
  if (!podRaw) return err('Pod not found.', 404, 'pod_not_found');

  const pod: Pod = JSON.parse(podRaw);
  if (pod.parent_id !== account.id) {
    return err('Pod not found.', 404, 'pod_not_found');
  }
  if (pod.status !== 'active') {
    return err('Cannot issue keys for a suspended pod.', 403, 'pod_suspended');
  }

  const apiKey = 'al_pod_' + nanoid(32);
  const apiKeyHash = await sha256hex(apiKey);
  const now = new Date().toISOString();

  const keyEntry = {
    id: podId,
    type: 'pod',
    pod_id: podId,
    parent_id: account.id,
    prefix: apiKey.slice(0, 10),
    created_at: now,
    tier: account.tier || 'free',
    status: 'active',
  };
  await c.env.KEYS.put('key:' + apiKeyHash, JSON.stringify(keyEntry));

  return json({
    api_key: apiKey,
    pod_id: podId,
    created_at: now,
    warning: 'Store this API key securely — it will not be shown again.',
  }, 201);
});
