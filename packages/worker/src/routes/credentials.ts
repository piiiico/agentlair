// ─── Credential Provisioning Routes (Device Flow) ─────────────────────────────
// RFC 8628-inspired device flow for agents to request credentials from operators.
//
// Flow:
//   1. Agent POST /v1/credentials/request  → gets device_code + user_code
//   2. Agent shows user_code to operator (via message, UI, etc.)
//   3. Operator GET  /v1/credentials/approve?code=XXXX-XXXX → sees request details
//   4. Operator POST /v1/credentials/approve → submits credential value
//   5. Agent   POST /v1/credentials/poll    → receives credential (one-time), KV deleted
//
// KV keys:
//   credreq:{device_code}          — Full request state, TTL 300s
//   credreq-code:{sha256(user_code)} — Maps user_code hash → device_code, TTL 300s
//   credreq-active:{account_id}    — Active request count for rate limiting, TTL 300s
//
// Security model:
//   - Operator endpoint requires operator auth (API key or session token)
//   - At-rest encryption intentionally skipped: device_code is AgentLair-generated,
//     so AgentLair-operator-derived encryption offers no real protection. The
//     credential is only in KV for ~60s during handoff. TTL is the protection.
//   - One-time delivery: KV entry deleted immediately after successful poll.
//   - Max 5 active requests per account, max 5 approval attempts per code.

import { nanoid, sha256hex, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type CredentialType = 'api_key' | 'password' | 'token' | 'certificate';

interface CredentialRequest {
  request_id: string;
  account_id: string;
  device_code: string;
  user_code: string;
  user_code_hash: string;
  credential_type: CredentialType;
  service_name: string;
  description?: string;
  status: 'pending' | 'approved' | 'denied' | 'completed';
  created_at: string;
  expires_at: string;

  // Set after operator approval
  credential_value?: string;
  approved_at?: string;
  approved_by_email?: string;

  // Anti-abuse counters
  poll_count: number;
  last_poll_at?: string;
  approval_attempts: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TTL_SECONDS = 300; // 5 minutes
const MAX_ACTIVE_PER_ACCOUNT = 5;
const MAX_APPROVAL_ATTEMPTS = 5;
const POLL_INTERVAL = 5;

// ─── User code generation ─────────────────────────────────────────────────────
// 8 chars from ambiguity-free charset (no 0/O/I/1/l). Format: XXXX-XXXX.
// ~2B combinations, adequate for 5-minute windows.

function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const left = Array.from(bytes.slice(0, 4)).map(b => chars[b % chars.length]).join('');
  const right = Array.from(bytes.slice(4, 8)).map(b => chars[b % chars.length]).join('');
  return `${left}-${right}`;
}

// ─── Audit event helper ───────────────────────────────────────────────────────
// Reuses writeBudgetAuditEvent pattern (standalone signed D1 write) with
// category: 'credentials' and custom action strings.

async function writeCredentialAuditEvent(
  env: Env,
  params: {
    action: string;
    accountId: string;
    resourceId: string;
    details?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  // Delegate to the generic standalone audit writer with overridden category/path
  // writeBudgetAuditEvent hardcodes category='budget'; we need 'credentials'.
  // Since we can't extend it cleanly without modifying audit.ts, we inline
  // the pattern (same approach, same imports).
  if (!env.AUDIT || !env.AUDIT_SIGNING_KEY) return;

  try {
    // Import dynamically to avoid circular dep issues at module load time
    const { nanoid: nid } = await import('../utils.js');
    const { ed25519 } = await import('@noble/curves/ed25519.js');

    const now = new Date().toISOString();
    const id = nid(20);
    // Use genesis hash — cross-isolate chain continuity not critical for credential events
    const prevHash = '0'.repeat(64);

    const entryWithoutSig = {
      id,
      timestamp: now,
      account_id: params.accountId,
      actor_type: 'account' as const,
      actor_id: params.accountId,
      actor_ip_hash: null,
      category: 'credentials',
      action: params.action,
      method: 'POST',
      path: '/v1/credentials',
      resource_type: 'credential_request',
      resource_id: params.resourceId,
      status: 200,
      result: 'success' as const,
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

    const privateKeyBytes = Uint8Array.from(atob(env.AUDIT_SIGNING_KEY), c => c.charCodeAt(0));
    const contentToSign = JSON.stringify(entryWithoutSig);
    const messageBytes = new TextEncoder().encode(contentToSign);
    const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);
    const signature = btoa(String.fromCharCode(...signatureBytes));

    const entry = { ...entryWithoutSig, signature };

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
    console.error('Credential audit event write failed:', e instanceof Error ? e.message : String(e));
  }
}

// ─── Email notification ───────────────────────────────────────────────────────

async function sendCredentialRequestEmail(
  env: Env,
  operatorEmail: string,
  agentName: string,
  agentId: string,
  userCode: string,
  serviceName: string,
  description: string | undefined,
  credentialType: CredentialType,
): Promise<void> {
  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) return;

  const approveUrl = `https://agentlair.dev/v1/credentials/approve?code=${encodeURIComponent(userCode)}`;
  const descLine = description ? `\nDescription: ${description}` : '';
  const textBody = [
    `Your agent '${agentName}' (${agentId}) is requesting a credential.`,
    ``,
    `Credential type: ${credentialType}`,
    `Service: ${serviceName}${descLine}`,
    `User code: ${userCode}`,
    ``,
    `To approve or deny this request, visit:`,
    `${approveUrl}`,
    ``,
    `This request expires in 5 minutes.`,
    ``,
    `If you did not initiate this or do not recognize the agent, ignore this email.`,
    `The request will expire automatically.`,
    ``,
    `— AgentLair`,
  ].join('\n');

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@agentlair.dev',
        to: [operatorEmail],
        subject: `AgentLair: Agent '${agentName}' is requesting a credential`,
        text: textBody,
      }),
    });
  } catch (e) {
    // Email is non-fatal — log and continue
    console.error('[credentials] notification email failed:', e instanceof Error ? e.message : String(e));
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function handleCredentialRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  { url, path, method, account }: RouteContext,
): Promise<Response | null> {
  if (!path.startsWith('/v1/credentials')) return null;

  // ── POST /v1/credentials/request ─────────────────────────────────────────────
  // Agent requests a credential. Requires agent auth.

  if (path === '/v1/credentials/request' && method === 'POST') {
    if (!account) return err('Authentication required.', 401, 'unauthorized');

    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}

    const credential_type = typeof body.credential_type === 'string'
      ? body.credential_type as CredentialType
      : undefined;
    const service_name = typeof body.service_name === 'string' ? body.service_name.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 200) : undefined;

    if (!credential_type || !['api_key', 'password', 'token', 'certificate'].includes(credential_type)) {
      return err('credential_type is required: api_key | password | token | certificate', 400, 'invalid_credential_type');
    }
    if (!service_name || service_name.length === 0) {
      return err('service_name is required', 400, 'missing_service_name');
    }
    if (service_name.length > 100) {
      return err('service_name too long (max 100 chars)', 400, 'invalid_service_name');
    }

    // Rate limit: max 5 active requests per account
    const activeKey = 'credreq-active:' + account.id;
    const activeRaw = await env.KEYS.get(activeKey);
    const activeCount = activeRaw ? parseInt(activeRaw, 10) : 0;
    if (activeCount >= MAX_ACTIVE_PER_ACCOUNT) {
      return err(
        `Too many active credential requests (max ${MAX_ACTIVE_PER_ACCOUNT}). Wait for existing requests to expire or be fulfilled.`,
        429,
        'rate_limited',
      );
    }

    // Generate codes
    const deviceCode = 'dc_' + nanoid(32);
    const userCode = generateUserCode();
    const userCodeHash = await sha256hex(userCode);
    const requestId = 'credreq_' + nanoid(16);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

    const credReq: CredentialRequest = {
      request_id: requestId,
      account_id: account.id,
      device_code: deviceCode,
      user_code: userCode,
      user_code_hash: userCodeHash,
      credential_type,
      service_name,
      ...(description !== undefined && { description }),
      status: 'pending',
      created_at: now,
      expires_at: expiresAt,
      poll_count: 0,
      approval_attempts: 0,
    };

    // Write KV state
    await env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: TTL_SECONDS });
    await env.KEYS.put('credreq-code:' + userCodeHash, deviceCode, { expirationTtl: TTL_SECONDS });
    await env.KEYS.put(activeKey, String(activeCount + 1), { expirationTtl: TTL_SECONDS });

    // Send email notification to operator (non-blocking, non-fatal)
    const operatorEmail = (account.operator_email || account.recovery_email || '') as string;
    const agentName = (account.name || account.id) as string;
    if (operatorEmail) {
      ctx.waitUntil(
        sendCredentialRequestEmail(env, operatorEmail, agentName, account.id, userCode, service_name, description, credential_type)
      );
    }

    // Audit trail
    ctx.waitUntil(
      writeCredentialAuditEvent(env, {
        action: 'request.created',
        accountId: account.id,
        resourceId: requestId,
        details: { service_name, credential_type },
      })
    );

    return json({
      device_code: deviceCode,
      user_code: userCode,
      expires_in: TTL_SECONDS,
      interval: POLL_INTERVAL,
      message: `Ask operator to visit https://agentlair.dev/v1/credentials/approve?code=${userCode}`,
    }, 201);
  }

  // ── GET /v1/credentials/approve?code=XXXX-XXXX ───────────────────────────────
  // Operator retrieves pending request details. Requires operator auth.

  if (path === '/v1/credentials/approve' && method === 'GET') {
    if (!account) return err('Authentication required. Operator must authenticate.', 401, 'unauthorized');

    const code = url.searchParams.get('code');
    if (!code) return err('code query parameter required (user code from agent)', 400, 'missing_code');

    const normalizedCode = code.trim().toUpperCase();
    const codeHash = await sha256hex(normalizedCode);
    const deviceCode = await env.KEYS.get('credreq-code:' + codeHash);
    if (!deviceCode) {
      return err('Invalid or expired user code.', 404, 'invalid_code');
    }

    const credReqRaw = await env.KEYS.get('credreq:' + deviceCode);
    if (!credReqRaw) {
      return err('Credential request not found or expired.', 404, 'request_expired');
    }

    const credReq = JSON.parse(credReqRaw) as CredentialRequest;

    if (credReq.status !== 'pending') {
      return err(`Request is already ${credReq.status}.`, 400, 'request_not_pending');
    }

    // Load agent account for display
    let agentName: string = credReq.account_id;
    let agentEmail: string | undefined;
    try {
      const keyHash = await env.KEYS.get('account:' + credReq.account_id);
      if (keyHash) {
        const agentRaw = await env.KEYS.get('key:' + keyHash);
        if (agentRaw) {
          const agentAccount = JSON.parse(agentRaw) as Record<string, unknown>;
          agentName = (agentAccount.name as string) || credReq.account_id;
          agentEmail = agentAccount.email as string | undefined;
        }
      }
    } catch { /* fail-open */ }

    return json({
      device_code: credReq.device_code,
      credential_type: credReq.credential_type,
      service_name: credReq.service_name,
      description: credReq.description || null,
      requested_at: credReq.created_at,
      expires_at: credReq.expires_at,
      agent_id: credReq.account_id,
      agent_name: agentName,
      agent_email: agentEmail || null,
      status: credReq.status,
    });
  }

  // ── POST /v1/credentials/approve ─────────────────────────────────────────────
  // Operator approves or denies a credential request. Requires operator auth.

  if (path === '/v1/credentials/approve' && method === 'POST') {
    if (!account) return err('Authentication required. Operator must authenticate.', 401, 'unauthorized');

    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}

    const userCodeRaw = typeof body.user_code === 'string' ? body.user_code.trim().toUpperCase() : undefined;
    const credentialValue = typeof body.credential_value === 'string' ? body.credential_value : undefined;
    const approved = typeof body.approved === 'boolean' ? body.approved : undefined;

    if (!userCodeRaw) return err('user_code is required', 400, 'missing_user_code');
    if (approved === undefined) return err('approved (boolean) is required', 400, 'missing_approved');
    if (approved && !credentialValue) {
      return err('credential_value is required when approved is true', 400, 'missing_credential_value');
    }
    if (credentialValue && credentialValue.length > 8192) {
      return err('credential_value too large (max 8192 bytes)', 400, 'payload_too_large');
    }

    const codeHash = await sha256hex(userCodeRaw);
    const deviceCode = await env.KEYS.get('credreq-code:' + codeHash);
    if (!deviceCode) {
      return err('Invalid or expired user code.', 400, 'invalid_code');
    }

    const credReqRaw = await env.KEYS.get('credreq:' + deviceCode);
    if (!credReqRaw) {
      return err('Credential request has expired.', 400, 'code_expired');
    }

    const credReq = JSON.parse(credReqRaw) as CredentialRequest;

    // Check max approval attempts (anti-brute-force)
    if (credReq.approval_attempts >= MAX_APPROVAL_ATTEMPTS) {
      return err('Max approval attempts exceeded for this code.', 429, 'max_attempts_exceeded');
    }

    // Only allow pending requests to be approved/denied
    if (credReq.status !== 'pending') {
      return err(`Request is already ${credReq.status}.`, 400, 'request_not_pending');
    }

    // Compute remaining TTL from expires_at
    const remainingMs = new Date(credReq.expires_at).getTime() - Date.now();
    if (remainingMs <= 0) {
      // Already expired — clean up
      await env.KEYS.delete('credreq:' + deviceCode);
      await env.KEYS.delete('credreq-code:' + codeHash);
      return err('Credential request has expired.', 400, 'code_expired');
    }
    const remainingTtlSec = Math.max(1, Math.floor(remainingMs / 1000));

    const now = new Date().toISOString();

    if (!approved) {
      // Denial path: update state, keep in KV briefly so agent can poll the denial
      credReq.status = 'denied';
      credReq.approved_at = now;
      credReq.approved_by_email = (account.operator_email || account.email || account.id) as string;
      credReq.approval_attempts += 1;

      await env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: remainingTtlSec });

      ctx.waitUntil(
        writeCredentialAuditEvent(env, {
          action: 'request.denied',
          accountId: credReq.account_id,
          resourceId: credReq.request_id,
          details: { denied_by: credReq.approved_by_email },
        })
      );

      return json({ status: 'denied', message: 'Credential request denied.' });
    }

    // Approval path: store credential value in KV (plaintext — see module header on trust model)
    credReq.status = 'approved';
    credReq.credential_value = credentialValue;
    credReq.approved_at = now;
    credReq.approved_by_email = (account.operator_email || account.email || account.id) as string;
    credReq.approval_attempts += 1;

    await env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: remainingTtlSec });

    ctx.waitUntil(
      writeCredentialAuditEvent(env, {
        action: 'request.approved',
        accountId: credReq.account_id,
        resourceId: credReq.request_id,
        details: { approved_by: credReq.approved_by_email, service_name: credReq.service_name },
      })
    );

    return json({
      status: 'approved',
      message: 'Credential will be delivered to the agent on next poll.',
    });
  }

  // ── POST /v1/credentials/poll ─────────────────────────────────────────────────
  // Agent polls for credential availability. Requires agent auth.

  if (path === '/v1/credentials/poll' && method === 'POST') {
    if (!account) return err('Authentication required.', 401, 'unauthorized');

    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}

    const deviceCode = typeof body.device_code === 'string' ? body.device_code.trim() : undefined;
    if (!deviceCode) return err('device_code is required', 400, 'missing_device_code');

    const credReqRaw = await env.KEYS.get('credreq:' + deviceCode);
    if (!credReqRaw) {
      // KV TTL expired or device_code never existed
      return json({ status: 'expired' });
    }

    const credReq = JSON.parse(credReqRaw) as CredentialRequest;

    // Verify the polling agent owns this request
    if (credReq.account_id !== account.id) {
      return err('Device code does not belong to this account.', 403, 'forbidden');
    }

    // Slow-down heuristic: if poll_count is high, nudge the agent to back off
    const now = new Date().toISOString();
    credReq.poll_count += 1;
    credReq.last_poll_at = now;

    const remainingMs = new Date(credReq.expires_at).getTime() - Date.now();
    if (remainingMs <= 0) {
      // Expired — clean up
      await env.KEYS.delete('credreq:' + deviceCode);
      return json({ status: 'expired' });
    }
    const remainingTtlSec = Math.max(1, Math.floor(remainingMs / 1000));

    if (credReq.status === 'pending') {
      // Slow down if polling too aggressively (>60 polls in a 5-minute window)
      if (credReq.poll_count > 60) {
        // Don't persist the updated count to avoid expensive writes on every slow_down
        return json({ status: 'slow_down', interval: 30 });
      }
      // Update poll count non-blocking (fail-open)
      ctx.waitUntil(
        env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: remainingTtlSec })
          .catch(() => { /* non-critical */ })
      );
      return json({ status: 'pending' });
    }

    if (credReq.status === 'denied') {
      // Clean up both KV keys — the agent has seen the denial
      ctx.waitUntil(Promise.all([
        env.KEYS.delete('credreq:' + deviceCode),
        env.KEYS.delete('credreq-code:' + credReq.user_code_hash),
        writeCredentialAuditEvent(env, {
          action: 'request.polled_denied',
          accountId: account.id,
          resourceId: credReq.request_id,
          details: {},
        }),
      ]));
      return json({ status: 'denied' });
    }

    if (credReq.status === 'approved') {
      const credentialValue = credReq.credential_value;

      // One-time delivery: delete from KV immediately before returning
      await Promise.all([
        env.KEYS.delete('credreq:' + deviceCode),
        env.KEYS.delete('credreq-code:' + credReq.user_code_hash),
      ]);

      // Audit trail for delivery
      ctx.waitUntil(
        writeCredentialAuditEvent(env, {
          action: 'request.completed',
          accountId: account.id,
          resourceId: credReq.request_id,
          details: { service_name: credReq.service_name, credential_type: credReq.credential_type },
        })
      );

      return json({
        status: 'approved',
        credential: credentialValue,
      });
    }

    // Catch-all for unexpected states
    return json({ status: 'expired' });
  }

  return null;
}
