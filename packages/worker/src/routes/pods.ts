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

import { nanoid, sha256hex, json, err } from '../utils.js';
import type { Env, Pod, RouteContext } from '../types.js';

export async function handlePodRoutes(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  { url: _url, path, method, account }: RouteContext,
): Promise<Response | null> {

  // All pod routes require auth
  if (!account) return null;

  // Only match /v1/pods paths
  if (!path.startsWith('/v1/pods')) return null;

  // ── POST /v1/pods — create a new pod ───────────────────────────────────────

  if (path === '/v1/pods' && method === 'POST') {
    // Pod keys cannot create pods (no infinite nesting)
    if (account.type === 'pod') {
      return err('Pod keys cannot create pods. Use your platform API key.', 403, 'pod_nested_forbidden');
    }

    let body: any = {};
    try { body = await request.json(); } catch {}
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) || null : null;

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
    };

    // Store pod metadata
    await env.KEYS.put('pod:' + podId, JSON.stringify(pod));

    // Update parent account's pod index
    const podsIndexKey = 'account-pods:' + account.id;
    const podsRaw = await env.KEYS.get(podsIndexKey);
    const podIds: string[] = podsRaw ? JSON.parse(podsRaw) : [];
    podIds.push(podId);
    await env.KEYS.put(podsIndexKey, JSON.stringify(podIds));

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
    await env.KEYS.put('key:' + apiKeyHash, JSON.stringify(keyEntry));

    return json({
      id: podId,
      name: pod.name,
      api_key: apiKey,
      created_at: now,
      status: 'active',
      warning: 'Store this API key securely — it will not be shown again.',
    }, 201);
  }

  // ── GET /v1/pods — list pods for this account ───────────────────────────────

  if (path === '/v1/pods' && method === 'GET') {
    // Pod keys: return their own pod info
    if (account.type === 'pod' && account.pod_id) {
      const podRaw = await env.KEYS.get('pod:' + account.pod_id);
      if (!podRaw) return json({ pods: [], count: 0 });
      const pod: Pod = JSON.parse(podRaw);
      return json({
        pods: [{ id: pod.id, name: pod.name, created_at: pod.created_at, status: pod.status }],
        count: 1,
      });
    }

    const podsIndexKey = 'account-pods:' + account.id;
    const podsRaw = await env.KEYS.get(podsIndexKey);
    if (!podsRaw) return json({ pods: [], count: 0 });

    const podIds: string[] = JSON.parse(podsRaw);
    const podObjects = await Promise.all(
      podIds.map(async (id) => {
        const raw = await env.KEYS.get('pod:' + id);
        if (!raw) return null;
        const pod: Pod = JSON.parse(raw);
        return { id: pod.id, name: pod.name, created_at: pod.created_at, status: pod.status };
      }),
    );

    const pods = podObjects.filter(Boolean);
    return json({ pods, count: pods.length });
  }

  // ── /v1/pods/:id routes ────────────────────────────────────────────────────

  const podPathMatch = path.match(/^\/v1\/pods\/([^/]+)(\/.*)?$/);
  if (!podPathMatch) return null;

  const podId = podPathMatch[1];
  const subPath = podPathMatch[2] || '';

  // ── GET /v1/pods/:id — get pod info ───────────────────────────────────────

  if (subPath === '' && method === 'GET') {
    const podRaw = await env.KEYS.get('pod:' + podId);
    if (!podRaw) return err('Pod not found.', 404, 'pod_not_found');

    const pod: Pod = JSON.parse(podRaw);

    // Only parent account or the pod itself can view
    if (pod.parent_id !== account.id && account.pod_id !== podId) {
      return err('Pod not found.', 404, 'pod_not_found'); // don't reveal existence
    }

    return json({
      id: pod.id,
      name: pod.name,
      created_at: pod.created_at,
      status: pod.status,
      parent_id: pod.parent_id,
      ...(pod.suspended_at ? { suspended_at: pod.suspended_at } : {}),
    });
  }

  // ── DELETE /v1/pods/:id — suspend a pod ──────────────────────────────────

  if (subPath === '' && method === 'DELETE') {
    // Pod keys cannot delete pods
    if (account.type === 'pod') {
      return err('Pod keys cannot delete pods. Use your platform API key.', 403, 'pod_delete_forbidden');
    }

    const podRaw = await env.KEYS.get('pod:' + podId);
    if (!podRaw) return err('Pod not found.', 404, 'pod_not_found');

    const pod: Pod = JSON.parse(podRaw);
    if (pod.parent_id !== account.id) {
      return err('Pod not found.', 404, 'pod_not_found');
    }

    // Soft delete — suspend the pod, preserve data
    pod.status = 'suspended';
    pod.suspended_at = new Date().toISOString();
    await env.KEYS.put('pod:' + podId, JSON.stringify(pod));

    return json({
      id: podId,
      status: 'suspended',
      message: 'Pod suspended. Email addresses and data are preserved. Use POST /v1/pods to create a new pod.',
    });
  }

  // ── POST /v1/pods/:id/keys — rotate / create a new API key for the pod ────

  if (subPath === '/keys' && method === 'POST') {
    // Only parent account can issue pod keys
    if (account.type === 'pod') {
      return err('Pod keys cannot issue new pod keys. Use your platform API key.', 403, 'pod_key_forbidden');
    }

    const podRaw = await env.KEYS.get('pod:' + podId);
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
    await env.KEYS.put('key:' + apiKeyHash, JSON.stringify(keyEntry));

    return json({
      api_key: apiKey,
      pod_id: podId,
      created_at: now,
      warning: 'Store this API key securely — it will not be shown again.',
    }, 201);
  }

  return null;
}
