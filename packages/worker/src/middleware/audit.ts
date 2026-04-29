// ─── Audit Middleware ────────────────────────────────────────────────────────
// Intercepts all authenticated API calls and writes a cryptographically signed
// audit log entry to D1. Runs AFTER auth middleware so c.get('account') is set.
//
// Design principles:
// - Zero latency impact: all D1 writes via waitUntil (non-blocking)
// - Graceful degradation: if AUDIT binding or AUDIT_SIGNING_KEY is missing, skip silently
// - Privacy-preserving: IP hashed with daily salt (correlatable within day, not across)
// - Hash chain: SHA-256 of previous entry, per-isolate (known limitation — see below)
//
// KNOWN LIMITATION: The hash chain is maintained per-isolate. Cloudflare may spin up
// multiple isolates concurrently, each maintaining its own chain. This creates parallel
// chains. Phase 2 can use a Durable Object to serialize writes and maintain a single chain.

import type { Context, Next } from 'hono';
import type { HonoEnv } from '../types.js';
import { nanoid, sha256hex } from '../utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';

// ─── AuditEntry interface ────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  account_id: string;
  actor_type: 'account' | 'pod' | 'system';
  actor_id: string;
  actor_ip_hash: string | null;
  category: string;
  action: string;
  method: string;
  path: string;
  resource_type: string | null;
  resource_id: string | null;
  status: number;
  result: 'success' | 'failure' | 'denied' | 'rate_limited';
  error_code: string | null;
  details: Record<string, string | number | boolean> | null;
  prev_hash: string;
  signature: string;
}

// ─── Module-level hash chain state (per-isolate) ─────────────────────────────

let lastEntryHash: string | null = null;
let hashChainInitialized = false;

// ─── Category determination ───────────────────────────────────────────────────

export function getCategory(path: string, status: number): string {
  if (status === 429 || status === 401) return 'system';
  if (path.startsWith('/v1/auth/')) return 'auth';
  if (path.startsWith('/v1/email/webhooks')) return 'webhook';
  if (path.startsWith('/v1/email/') || path.startsWith('/v1/inbox/')) return 'email';
  if (path.startsWith('/v1/vault/')) return 'vault';
  if (path.startsWith('/v1/pods/') || path === '/v1/pods') return 'pod';
  if (path.startsWith('/v1/calendar/')) return 'calendar';
  if (path.startsWith('/v1/tokens/') || path === '/v1/tokens') return 'auth';
  if (path.match(/^\/v1\/agents\/[^/]+\/memory-trust$/)) return 'memory';
  if (path.startsWith('/v1/sessions/') || path === '/v1/sessions') return 'session';
  if (path.startsWith('/v1/budget') || path === '/v1/budget') return 'budget';
  return 'system';
}

// ─── Action derivation ────────────────────────────────────────────────────────

export function getAction(category: string, method: string, path: string): string {
  // Specific well-known paths
  const pathLower = path.toLowerCase();

  // Auth actions
  if (pathLower === '/v1/auth/login' || pathLower.endsWith('/auth/login')) return 'auth.login';
  if (pathLower === '/v1/auth/verify' || pathLower.endsWith('/auth/verify')) return 'auth.verify';
  if (pathLower === '/v1/auth/keys' || pathLower === '/v1/keys') return 'auth.create_key';
  if (pathLower === '/v1/auth/agent-register') return 'auth.agent_register';
  if (pathLower === '/v1/tokens/issue') return 'auth.token_issue';
  if (pathLower === '/v1/tokens/info') return 'auth.token_info';
  if (pathLower === '/v1/tokens/introspect') return 'auth.token_introspect';
  if (pathLower.match(/^\/v1\/agents\/[^/]+\/memory-trust$/)) return 'memory.trust_query';
  if (pathLower.startsWith('/v1/auth/') && method === 'DELETE') return 'auth.revoke_key';
  if (pathLower.startsWith('/v1/account/')) return 'auth.account';
  if (pathLower.startsWith('/v1/e2e/')) return 'auth.e2e';

  // Email actions
  if (pathLower.includes('/email/send')) return 'email.send';
  if (pathLower.includes('/email/inbox') || pathLower.startsWith('/v1/inbox/')) {
    return method === 'GET' ? 'email.list' : 'email.delete';
  }
  if (pathLower.includes('/email/claim')) return 'email.claim';
  if (pathLower.includes('/email/webhooks')) {
    if (method === 'POST') return 'webhook.create';
    if (method === 'DELETE') return 'webhook.delete';
    return 'webhook.list';
  }

  // Vault actions
  if (pathLower.includes('/vault/store')) return 'vault.store';
  if (pathLower.includes('/vault/recover')) return 'vault.recover';
  if (category === 'vault') {
    if (method === 'GET') return 'vault.retrieve';
    if (method === 'DELETE') return 'vault.delete';
    if (method === 'POST') return 'vault.store';
    return 'vault.read';
  }

  // Pod actions
  if (category === 'pod') {
    if (pathLower.includes('/keys') && method === 'POST') return 'pod.create_key';
    if (method === 'POST') return 'pod.create';
    if (method === 'DELETE') return 'pod.delete';
    if (method === 'GET') return 'pod.read';
    return 'pod.update';
  }

  // Calendar actions
  if (category === 'calendar') {
    if (method === 'POST') return 'calendar.create';
    if (method === 'DELETE') return 'calendar.delete';
    return 'calendar.list';
  }

  // Session lifecycle actions (PicoClaw agent sessions)
  if (category === 'session') {
    if (pathLower.includes('/sessions/start')) return 'session.start';
    if (pathLower.includes('/sessions/end')) return 'session.end';
    if (pathLower.includes('/sessions/event')) return 'session.event';
    return 'session.action';
  }

  // Budget actions
  if (category === 'budget') {
    if (method === 'GET' && pathLower.includes('/history')) return 'budget.history';
    if (method === 'GET') return 'budget.read';
    if (method === 'PUT') return 'budget.cap_set';
    return 'budget.action';
  }

  // Fallback: category.verb
  const verbMap: Record<string, string> = {
    GET: 'read',
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
    HEAD: 'read',
    OPTIONS: 'read',
  };
  const verb = verbMap[method.toUpperCase()] || 'action';
  return `${category}.${verb}`;
}

// ─── Result mapping ───────────────────────────────────────────────────────────

export function getResult(status: number): 'success' | 'failure' | 'denied' | 'rate_limited' {
  if (status >= 200 && status < 300) return 'success';
  if (status === 401 || status === 403) return 'denied';
  if (status === 429) return 'rate_limited';
  return 'failure';
}

// ─── Ed25519 signing ──────────────────────────────────────────────────────────

export async function signEntry(
  entry: Omit<AuditEntry, 'signature'>,
  signingKeyB64: string,
): Promise<string> {
  const privateKeyBytes = Uint8Array.from(atob(signingKeyB64), c => c.charCodeAt(0));
  const contentToSign = JSON.stringify(entry);
  const messageBytes = new TextEncoder().encode(contentToSign);
  const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);
  return btoa(String.fromCharCode(...signatureBytes));
}

// ─── Hash chain ───────────────────────────────────────────────────────────────

async function getPrevHash(env: NonNullable<HonoEnv['Bindings']>): Promise<string> {
  // Return cached value if available
  if (hashChainInitialized && lastEntryHash !== null) {
    return lastEntryHash;
  }

  // Query D1 for the most recent entry's hash on cold start
  if (env.AUDIT) {
    try {
      const result = await env.AUDIT
        .prepare('SELECT id, timestamp, account_id, actor_type, actor_id, actor_ip_hash, category, action, method, path, resource_type, resource_id, status, result, error_code, details, prev_hash, signature FROM audit_log ORDER BY timestamp DESC LIMIT 1')
        .first<AuditEntry>();
      if (result) {
        // Hash the entire previous entry (excluding signature field as in write)
        const prevHash = await sha256hex(JSON.stringify(result));
        hashChainInitialized = true;
        lastEntryHash = prevHash;
        return prevHash;
      }
    } catch {
      // D1 query failed — use genesis hash
    }
  }

  // Genesis hash — no previous entry
  hashChainInitialized = true;
  lastEntryHash = '0'.repeat(64);
  return lastEntryHash;
}

// ─── Audit Middleware Factory ─────────────────────────────────────────────────

export function auditMiddleware() {
  return async (c: Context<HonoEnv>, next: Next): Promise<void> => {
    const env = c.env;

    // Skip silently if AUDIT binding or signing key is missing
    if (!env.AUDIT || !env.AUDIT_SIGNING_KEY) {
      await next();
      return;
    }

    // Capture request info BEFORE route handler runs
    const method = c.req.method;
    const url = new URL(c.req.url);
    const path = url.pathname;
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const dailySalt = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Run the route handler
    await next();

    // Capture response info AFTER handler returns
    const status = c.res.status;
    const account = c.get('account');

    // Determine account/actor info
    const accountId = account?.id ?? 'anonymous';
    const actorType: 'account' | 'pod' | 'system' = account?.type === 'pod' ? 'pod' : 'account';
    const actorId = account?.id ?? 'anonymous';

    // Categorize and derive action
    const category = getCategory(path, status);
    const action = getAction(category, method, path);
    const result = getResult(status);

    // Write audit entry asynchronously (non-blocking)
    c.executionCtx.waitUntil((async () => {
      try {
        const ipHash = await sha256hex(ip + dailySalt);
        const prevHash = await getPrevHash(env);
        const now = new Date().toISOString();

        const entryWithoutSignature: Omit<AuditEntry, 'signature'> = {
          id: nanoid(20),
          timestamp: now,
          account_id: accountId,
          actor_type: actorType,
          actor_id: actorId,
          actor_ip_hash: ipHash,
          category,
          action,
          method,
          path,
          resource_type: null,
          resource_id: null,
          status,
          result,
          error_code: status >= 400 ? null : null, // Could be enriched per-route in Phase 3
          details: null,
          prev_hash: prevHash,
        };

        const signature = await signEntry(entryWithoutSignature, env.AUDIT_SIGNING_KEY!);

        const entry: AuditEntry = { ...entryWithoutSignature, signature };

        // Update hash chain state
        lastEntryHash = await sha256hex(JSON.stringify(entry));

        // Write to D1
        await env.AUDIT!.prepare(
          `INSERT INTO audit_log (id, timestamp, account_id, actor_type, actor_id, actor_ip_hash, category, action, method, path, resource_type, resource_id, status, result, error_code, details, prev_hash, signature)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            entry.id,
            entry.timestamp,
            entry.account_id,
            entry.actor_type,
            entry.actor_id,
            entry.actor_ip_hash,
            entry.category,
            entry.action,
            entry.method,
            entry.path,
            entry.resource_type,
            entry.resource_id,
            entry.status,
            entry.result,
            entry.error_code,
            entry.details !== null ? JSON.stringify(entry.details) : null,
            entry.prev_hash,
            entry.signature,
          )
          .run();
      } catch (e) {
        // Audit log write failed — do NOT affect the API response
        console.error('Audit log write failed:', e instanceof Error ? e.message : String(e));
      }
    })());
  };
}

// ─── writeBudgetAuditEvent — standalone signed audit event for budget changes ──
// Called directly by budget routes (not via middleware) for budget.cap_set events.
// These are first-class signed events in the hash chain.

export async function writeBudgetAuditEvent(
  env: import('../types.js').Env,
  params: {
    action: string;
    accountId: string;
    details?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  if (!env.AUDIT || !env.AUDIT_SIGNING_KEY) return;
  try {
    const prevHash = await getPrevHash(env);
    const now = new Date().toISOString();
    const entryWithoutSignature: Omit<AuditEntry, 'signature'> = {
      id: nanoid(20),
      timestamp: now,
      account_id: params.accountId,
      actor_type: 'account',
      actor_id: params.accountId,
      actor_ip_hash: null,
      category: 'budget',
      action: params.action,
      method: 'PUT',
      path: '/v1/budget',
      resource_type: 'budget',
      resource_id: params.accountId,
      status: 200,
      result: 'success',
      error_code: null,
      details: params.details
        ? Object.fromEntries(
            Object.entries(params.details)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, v as string | number | boolean])
          )
        : null,
      prev_hash: prevHash,
    };
    const signature = await signEntry(entryWithoutSignature, env.AUDIT_SIGNING_KEY);
    const entry: AuditEntry = { ...entryWithoutSignature, signature };
    lastEntryHash = await sha256hex(JSON.stringify(entry));
    await env.AUDIT.prepare(
      `INSERT INTO audit_log (id, timestamp, account_id, actor_type, actor_id, actor_ip_hash, category, action, method, path, resource_type, resource_id, status, result, error_code, details, prev_hash, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entry.id, entry.timestamp, entry.account_id, entry.actor_type, entry.actor_id,
      entry.actor_ip_hash, entry.category, entry.action, entry.method, entry.path,
      entry.resource_type, entry.resource_id, entry.status, entry.result,
      entry.error_code, entry.details !== null ? JSON.stringify(entry.details) : null,
      entry.prev_hash, entry.signature,
    ).run();
  } catch (e) {
    console.error('Budget audit event write failed:', e instanceof Error ? e.message : String(e));
  }
}

// ─── writeMemoryAuditEvent — signed audit event for memory-scoped AAT issuance ──
// Called from tokens.ts when an AAT with memory:read or memory:write scope is issued.
// Enables the /v1/agents/:id/memory-trust endpoint to analyze behavioral patterns.

export async function writeMemoryAuditEvent(
  env: import('../types.js').Env,
  params: {
    accountId: string;
    memoryRead: boolean;
    memoryWrite: boolean;
    audience: string;
    jti: string;
  },
): Promise<void> {
  if (!env.AUDIT || !env.AUDIT_SIGNING_KEY) return;
  try {
    const prevHash = await getPrevHash(env);
    const now = new Date().toISOString();
    const details: Record<string, boolean | string> = {
      memory_read: params.memoryRead,
      memory_write: params.memoryWrite,
      audience: params.audience,
      jti: params.jti,
    };
    const entryWithoutSignature: Omit<AuditEntry, 'signature'> = {
      id: nanoid(20),
      timestamp: now,
      account_id: params.accountId,
      actor_type: 'account',
      actor_id: params.accountId,
      actor_ip_hash: null,
      category: 'memory',
      action: 'memory.token_issue',
      method: 'POST',
      path: '/v1/tokens/issue',
      resource_type: 'memory_token',
      resource_id: params.jti,
      status: 201,
      result: 'success',
      error_code: null,
      details,
      prev_hash: prevHash,
    };
    const signature = await signEntry(entryWithoutSignature, env.AUDIT_SIGNING_KEY);
    const entry: AuditEntry = { ...entryWithoutSignature, signature };
    lastEntryHash = await sha256hex(JSON.stringify(entry));
    await env.AUDIT.prepare(
      `INSERT INTO audit_log (id, timestamp, account_id, actor_type, actor_id, actor_ip_hash, category, action, method, path, resource_type, resource_id, status, result, error_code, details, prev_hash, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entry.id, entry.timestamp, entry.account_id, entry.actor_type, entry.actor_id,
      entry.actor_ip_hash, entry.category, entry.action, entry.method, entry.path,
      entry.resource_type, entry.resource_id, entry.status, entry.result,
      entry.error_code, entry.details !== null ? JSON.stringify(entry.details) : null,
      entry.prev_hash, entry.signature,
    ).run();
  } catch (e) {
    console.error('Memory audit event write failed:', e instanceof Error ? e.message : String(e));
  }
}
