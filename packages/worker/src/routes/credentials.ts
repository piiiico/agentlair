// ─── Credential Provisioning Routes (Device Flow) ─────────────────────────────
// RFC 8628-inspired device flow for agents to request credentials from operators.
//
// Flow:
//   1. Agent POST /v1/credentials/request  → gets device_code + user_code + verification_url
//   2. Agent shows user_code to operator (via message, UI, etc.)
//   3. Operator GET  /v1/credentials/approve?code=XXXX-XXXX → HTML approval page
//   4. Operator POST /v1/credentials/approve → submits credential (no auth — email binding)
//   5. Agent   POST /v1/credentials/poll    → receives credential (one-time), KV deleted
//
// KV keys:
//   credreq:{device_code}            — Full request state, TTL 600s (pending) or 60s (approved)
//   credreq-code:{sha256(user_code)} — Maps user_code hash → device_code, TTL 600s
//   credreq-active:{account_id}      — Active request count for rate limiting, TTL 600s
//
// Security model:
//   - Credential at rest: encrypted with HKDF-SHA-256(device_code, 'credreq-encryption').
//     Only the agent (who holds device_code) can decrypt. Defense-in-depth for the 60s window.
//   - One-time delivery: KV entry deleted immediately after successful poll.
//   - Max 5 active requests per account, max 5 approval attempts per code.
//   - Operator email binding: approval requires email matching account's registered email.

import { nanoid, sha256hex, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CredentialRequest {
  request_id: string;
  account_id: string;
  device_code: string;            // opaque, used by agent to poll
  user_code: string;              // short, shown to human
  user_code_hash: string;         // SHA-256 of user_code (for indexed lookup)
  description: string;            // human-readable, shown on approval page
  vault_key: string;              // suggested vault key name (human can override)
  metadata?: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'completed';
  created_at: string;
  expires_at: string;
  operator_email: string;         // account's registered email for binding

  // Set after operator approval
  credential_value_encrypted?: string;  // AES-256-GCM encrypted with device_code-derived key
  vault_key_final?: string;             // human's chosen vault key
  approved_at?: string;
  approved_by_email?: string;

  // Anti-abuse counters
  poll_count: number;
  last_poll_at?: string;
  approval_attempts: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TTL_PENDING = 600;   // 10 minutes (pending state)
const TTL_APPROVED = 60;   // 60 seconds after approval (until agent polls)
const MAX_ACTIVE_PER_ACCOUNT = 5;
const MAX_APPROVAL_ATTEMPTS = 5;
const POLL_INTERVAL = 5;
const VERIFICATION_BASE_URL = 'https://agentlair.dev/v1/credentials/approve';

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Determine whether a credential approval should be blocked due to account restriction.
 * - Denials (isDenial === true) are always allowed, regardless of account status.
 * - Approvals for a restricted account are blocked (fail-closed).
 * - Approvals for non-restricted accounts proceed normally.
 */
export function shouldBlockCredentialApproval(
  isDenial: boolean,
  agentAccount: Record<string, unknown>,
): boolean {
  if (isDenial) return false;
  return agentAccount.status === 'restricted';
}

// ─── User code generation ─────────────────────────────────────────────────────
// 8 chars from ambiguity-free charset (no 0/O/I/1/l). Format: XXXX-XXXX.
// ~2B combinations, adequate for 10-minute windows.

function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const left = Array.from(bytes.slice(0, 4)).map(b => chars[b % chars.length]).join('');
  const right = Array.from(bytes.slice(4, 8)).map(b => chars[b % chars.length]).join('');
  return `${left}-${right}`;
}

// ─── Credential encryption at rest ───────────────────────────────────────────
// HKDF-SHA-256(device_code, 'credreq-encryption') → AES-256-GCM key.
// Only the agent (who holds device_code) can derive the key and decrypt.

async function deriveEncryptionKey(deviceCode: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(deviceCode),
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('agentlair-credreq'),
      info: encoder.encode('credreq-encryption'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptCredential(value: string, deviceCode: string): Promise<string> {
  const key = await deriveEncryptionKey(deviceCode);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  // Encode as base64: iv (12 bytes) + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptCredential(encrypted: string, deviceCode: string): Promise<string> {
  const key = await deriveEncryptionKey(deviceCode);
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ─── Audit event helper ───────────────────────────────────────────────────────

async function writeCredentialAuditEvent(
  env: Env,
  params: {
    action: string;
    accountId: string;
    resourceId: string;
    details?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  if (!env.AUDIT || !env.AUDIT_SIGNING_KEY) return;

  try {
    const { nanoid: nid } = await import('../utils.js');
    const { ed25519 } = await import('@noble/curves/ed25519.js');

    const now = new Date().toISOString();
    const id = nid(20);
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
  userCode: string,
  description: string,
): Promise<void> {
  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) return;

  const approveUrl = `${VERIFICATION_BASE_URL}?code=${encodeURIComponent(userCode)}`;
  const textBody = [
    `Your agent '${agentName}' is requesting a credential.`,
    ``,
    `What's needed: ${description}`,
    `User code: ${userCode}`,
    ``,
    `To approve, visit:`,
    `${approveUrl}`,
    ``,
    `This request expires in 10 minutes.`,
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
    console.error('[credentials] notification email failed:', e instanceof Error ? e.message : String(e));
  }
}

// ─── HTML approval page ───────────────────────────────────────────────────────

function renderApprovalPage(opts: {
  prefillCode?: string;
  agentName?: string;
  agentId?: string;
  description?: string;
  vaultKeyHint?: string;
  error?: string;
}): Response {
  const { prefillCode = '', agentName, agentId, description, vaultKeyHint = '', error } = opts;

  const agentSection = agentName
    ? `
    <div class="agent-info">
      <div class="label">Requesting agent</div>
      <div class="value">${escHtml(agentName)} <span class="dim">(${escHtml(agentId || '')})</span></div>
      ${description ? `<div class="label" style="margin-top:8px">What's needed</div><div class="value">${escHtml(description)}</div>` : ''}
    </div>`
    : '';

  const errorSection = error
    ? `<div class="error">${escHtml(error)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Credential Approval — AgentLair</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; }
    h1 { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 6px; }
    .subtitle { font-size: 14px; color: #888; margin-bottom: 24px; }
    .agent-info { background: #111; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .value { font-size: 14px; color: #ccc; }
    .dim { color: #555; font-size: 12px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 6px; color: #e0e0e0; font-size: 14px; font-family: inherit; }
    input:focus { outline: none; border-color: #555; }
    .actions { display: flex; gap: 10px; margin-top: 24px; }
    button { flex: 1; padding: 11px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
    button[type="submit"] { background: #2563eb; color: #fff; }
    button[type="submit"]:hover { background: #1d4ed8; }
    button.deny { background: #1a1a1a; color: #888; border: 1px solid #333; }
    button.deny:hover { background: #222; }
    .error { background: #2a1a1a; border: 1px solid #5a2020; border-radius: 6px; padding: 12px; color: #f87171; font-size: 13px; margin-bottom: 16px; }
    .security-note { font-size: 12px; color: #555; margin-top: 20px; text-align: center; }
    .security-note strong { color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Credential Approval</h1>
    <p class="subtitle">An agent is requesting a credential from you.</p>

    ${errorSection}
    ${agentSection}

    <form method="POST" action="${VERIFICATION_BASE_URL}">
      ${!agentName ? `
      <div class="field">
        <label for="user_code">Agent code</label>
        <input type="text" id="user_code" name="user_code" value="${escHtml(prefillCode)}" placeholder="XXXX-XXXX" autocomplete="off" required>
      </div>` : `<input type="hidden" name="user_code" value="${escHtml(prefillCode)}">`}

      <div class="field">
        <label for="operator_email">Your operator email</label>
        <input type="email" id="operator_email" name="operator_email" placeholder="you@example.com" autocomplete="email" required>
      </div>

      <div class="field">
        <label for="credential_value">Credential value</label>
        <input type="password" id="credential_value" name="credential_value" placeholder="Paste the API key, token, or secret here" autocomplete="off" required>
      </div>

      <div class="field">
        <label for="vault_key">Vault key name</label>
        <input type="text" id="vault_key" name="vault_key" value="${escHtml(vaultKeyHint)}" placeholder="e.g. openai-api-key" autocomplete="off" required>
      </div>

      <div class="actions">
        <button type="submit" name="_action" value="approve">Deliver credential</button>
        <button type="submit" name="_action" value="deny" class="deny" formnovalidate>Deny request</button>
      </div>
    </form>

    <p class="security-note">
      <strong>Security:</strong> Only approve requests from agents you initiated.<br>
      Credential is delivered encrypted and deleted immediately after delivery.
    </p>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 200) : undefined;
    const vaultKey = typeof body.vault_key === 'string' ? body.vault_key.trim().slice(0, 100) : undefined;
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : undefined;

    if (!description || description.length === 0) {
      return err('description is required (max 200 chars)', 400, 'missing_description');
    }

    // Operator email required for approval binding
    // Fall back to recovery_email if not encrypted (handles accounts created before operator_email field)
    const recoveryEmailFallback = !account.recovery_email_encrypted ? account.recovery_email : undefined;
    const operatorEmail = (account.operator_email || account.email || recoveryEmailFallback || '') as string;
    if (!operatorEmail) {
      return err(
        'Account must have a registered operator email. Set it via POST /v1/account/operator-email with {"email": "you@example.com"}.',
        403,
        'no_operator_email',
      );
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
    const expiresAt = new Date(Date.now() + TTL_PENDING * 1000).toISOString();

    const credReq: CredentialRequest = {
      request_id: requestId,
      account_id: account.id,
      device_code: deviceCode,
      user_code: userCode,
      user_code_hash: userCodeHash,
      description,
      vault_key: vaultKey || '',
      ...(metadata !== undefined && { metadata }),
      status: 'pending',
      created_at: now,
      expires_at: expiresAt,
      operator_email: operatorEmail,
      poll_count: 0,
      approval_attempts: 0,
    };

    // Write KV state
    await env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: TTL_PENDING });
    await env.KEYS.put('credreq-code:' + userCodeHash, deviceCode, { expirationTtl: TTL_PENDING });
    await env.KEYS.put(activeKey, String(activeCount + 1), { expirationTtl: TTL_PENDING });

    const agentName = (account.name || account.id) as string;
    const verificationUrlComplete = `${VERIFICATION_BASE_URL}?code=${encodeURIComponent(userCode)}`;

    // Send email notification to operator (non-blocking, non-fatal)
    ctx.waitUntil(
      sendCredentialRequestEmail(env, operatorEmail, agentName, userCode, description)
    );

    // Audit trail
    ctx.waitUntil(
      writeCredentialAuditEvent(env, {
        action: 'request.created',
        accountId: account.id,
        resourceId: requestId,
        details: { description: description.slice(0, 100) },
      })
    );

    return json({
      request_id: requestId,
      device_code: deviceCode,
      user_code: userCode,
      verification_url: VERIFICATION_BASE_URL,
      verification_url_complete: verificationUrlComplete,
      expires_in: TTL_PENDING,
      interval: POLL_INTERVAL,
      message: `Ask your operator to visit ${verificationUrlComplete}`,
    }, 201);
  }

  // ── GET /v1/credentials/approve?code=XXXX-XXXX ───────────────────────────────
  // Public HTML approval page. No auth required — operator validates via email binding.

  if (path === '/v1/credentials/approve' && method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) {
      // Show blank form
      return renderApprovalPage({});
    }

    const normalizedCode = code.trim().toUpperCase();
    const codeHash = await sha256hex(normalizedCode);
    const deviceCode = await env.KEYS.get('credreq-code:' + codeHash);

    if (!deviceCode) {
      return renderApprovalPage({
        prefillCode: normalizedCode,
        error: 'Code not found or expired. Check the code and try again.',
      });
    }

    const credReqRaw = await env.KEYS.get('credreq:' + deviceCode);
    if (!credReqRaw) {
      return renderApprovalPage({
        prefillCode: normalizedCode,
        error: 'Credential request has expired.',
      });
    }

    const credReq = JSON.parse(credReqRaw) as CredentialRequest;

    if (credReq.status !== 'pending') {
      return renderApprovalPage({
        prefillCode: normalizedCode,
        error: `This request has already been ${credReq.status}.`,
      });
    }

    // Load agent display name
    let agentName: string = credReq.account_id;
    try {
      const keyHash = await env.KEYS.get('account:' + credReq.account_id);
      if (keyHash) {
        const agentRaw = await env.KEYS.get('key:' + keyHash);
        if (agentRaw) {
          const agentAccount = JSON.parse(agentRaw) as Record<string, unknown>;
          agentName = (agentAccount.name as string) || credReq.account_id;
        }
      }
    } catch { /* fail-open */ }

    return renderApprovalPage({
      prefillCode: normalizedCode,
      agentName,
      agentId: credReq.account_id,
      description: credReq.description,
      vaultKeyHint: credReq.vault_key,
    });
  }

  // ── POST /v1/credentials/approve ─────────────────────────────────────────────
  // Human submits credential. Public endpoint — validated by user_code + operator_email binding.
  // Also handles HTML form submissions (application/x-www-form-urlencoded).

  if (path === '/v1/credentials/approve' && method === 'POST') {
    const contentType = request.headers.get('Content-Type') || '';
    let userCodeRaw: string | undefined;
    let credentialValue: string | undefined;
    let vaultKeyFinal: string | undefined;
    let operatorEmail: string | undefined;
    let action: string = 'approve';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // HTML form submission
      const formData = await request.formData();
      userCodeRaw = formData.get('user_code')?.toString().trim().toUpperCase();
      credentialValue = formData.get('credential_value')?.toString();
      vaultKeyFinal = formData.get('vault_key')?.toString().trim();
      operatorEmail = formData.get('operator_email')?.toString().trim().toLowerCase();
      action = formData.get('_action')?.toString() || 'approve';
    } else {
      // JSON submission (API)
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}
      userCodeRaw = typeof body.user_code === 'string' ? body.user_code.trim().toUpperCase() : undefined;
      credentialValue = typeof body.credential_value === 'string' ? body.credential_value : undefined;
      vaultKeyFinal = typeof body.vault_key === 'string' ? body.vault_key.trim() : undefined;
      operatorEmail = typeof body.operator_email === 'string' ? body.operator_email.trim().toLowerCase() : undefined;
      // Parse deny action from JSON body — accept 'action', '_action', or legacy 'approved' bool
      if (typeof body.approved === 'boolean' && !body.approved) {
        action = 'deny';
      } else if (typeof body.action === 'string') {
        action = body.action;
      } else if (typeof body._action === 'string') {
        action = body._action;
      }
    }

    const isDenial = action === 'deny';

    if (!userCodeRaw) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ error: 'User code is required.' });
      }
      return err('user_code is required', 400, 'missing_user_code');
    }
    if (!isDenial && !credentialValue) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: 'Credential value is required.' });
      }
      return err('credential_value is required', 400, 'missing_credential_value');
    }
    if (!isDenial && (!vaultKeyFinal || vaultKeyFinal.length === 0)) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: 'Vault key name is required.' });
      }
      return err('vault_key is required', 400, 'missing_vault_key');
    }
    if (!operatorEmail) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: 'Operator email is required.' });
      }
      return err('operator_email is required', 400, 'missing_operator_email');
    }
    if (credentialValue && credentialValue.length > 8192) {
      return err('credential_value too large (max 8192 bytes)', 400, 'payload_too_large');
    }

    const codeHash = await sha256hex(userCodeRaw);
    const deviceCode = await env.KEYS.get('credreq-code:' + codeHash);
    if (!deviceCode) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: 'Invalid or expired code.' });
      }
      return err('Invalid or expired user code.', 400, 'invalid_code');
    }

    const credReqRaw = await env.KEYS.get('credreq:' + deviceCode);
    if (!credReqRaw) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: 'Request has expired.' });
      }
      return err('Credential request has expired.', 400, 'code_expired');
    }

    const credReq = JSON.parse(credReqRaw) as CredentialRequest;

    // Check max approval attempts (anti-brute-force)
    if (credReq.approval_attempts >= MAX_APPROVAL_ATTEMPTS) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: 'Too many attempts. This code is locked.' });
      }
      return err('Max approval attempts exceeded for this code.', 429, 'max_attempts_exceeded');
    }

    // Only allow pending requests
    if (credReq.status !== 'pending') {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: `This request has already been ${credReq.status}.` });
      }
      return err(`Request is already ${credReq.status}.`, 400, 'request_not_pending');
    }

    // Check TTL
    const remainingMs = new Date(credReq.expires_at).getTime() - Date.now();
    if (remainingMs <= 0) {
      await env.KEYS.delete('credreq:' + deviceCode);
      await env.KEYS.delete('credreq-code:' + codeHash);
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({ prefillCode: userCodeRaw, error: 'Request has expired.' });
      }
      return err('Credential request has expired.', 400, 'code_expired');
    }

    // Operator email binding: must match account's registered email
    const expectedEmail = credReq.operator_email.toLowerCase();
    if (operatorEmail !== expectedEmail) {
      credReq.approval_attempts += 1;
      // Persist incremented count
      ctx.waitUntil(
        env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), {
          expirationTtl: Math.max(1, Math.floor(remainingMs / 1000)),
        }).catch(() => {})
      );
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return renderApprovalPage({
          prefillCode: userCodeRaw,
          agentId: credReq.account_id,
          description: credReq.description,
          vaultKeyHint: vaultKeyFinal || credReq.vault_key,
          error: 'Email does not match the operator email registered for this agent.',
        });
      }
      return err('operator_email does not match the account\'s registered email.', 400, 'email_mismatch');
    }

    // ── Approver privilege check ──────────────────────────────────────────
    // The operator email binding above is the primary auth mechanism.
    // Additionally: verify the agent account is not restricted.
    // Restricted accounts must not receive approved credentials (fail-closed for
    // approval; denial is always allowed to let operators close stale requests).
    try {
      const agentKeyHash = await env.KEYS.get('account:' + credReq.account_id);
      if (agentKeyHash) {
        const agentRaw = await env.KEYS.get('key:' + agentKeyHash);
        if (agentRaw) {
          const agentAccount = JSON.parse(agentRaw) as Record<string, unknown>;
          if (shouldBlockCredentialApproval(isDenial, agentAccount)) {
            if (contentType.includes('application/x-www-form-urlencoded')) {
              return renderApprovalPage({
                prefillCode: userCodeRaw!,
                error: 'Cannot approve credentials for a restricted account. Contact support.',
              });
            }
            return err('Cannot approve credentials for a restricted account.', 403, 'account_restricted');
          }
        }
      }
    } catch {
      // fail-open: if account lookup fails, allow the approval to proceed.
      // The email binding check above is still enforced.
    }

    const now = new Date().toISOString();
    credReq.approval_attempts += 1;

    if (isDenial) {
      // Denial path
      credReq.status = 'denied';
      credReq.approved_at = now;
      credReq.approved_by_email = operatorEmail;

      const ttlSec = Math.max(1, Math.floor(remainingMs / 1000));
      await env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: ttlSec });

      ctx.waitUntil(
        writeCredentialAuditEvent(env, {
          action: 'request.denied',
          accountId: credReq.account_id,
          resourceId: credReq.request_id,
          details: { denied_by: operatorEmail },
        })
      );

      if (contentType.includes('application/x-www-form-urlencoded')) {
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;background:#0f0f0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;}</style></head><body><h2>Request Denied</h2><p style="color:#888;margin-top:12px">The credential request has been denied. The agent will be notified.</p></body></html>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
      return json({ status: 'denied', message: 'Credential request denied.' });
    }

    // Approval path: encrypt credential and store with 60s TTL
    const encrypted = await encryptCredential(credentialValue!, deviceCode);
    credReq.status = 'approved';
    credReq.credential_value_encrypted = encrypted;
    credReq.vault_key_final = vaultKeyFinal;
    credReq.approved_at = now;
    credReq.approved_by_email = operatorEmail;

    await env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: TTL_APPROVED });

    ctx.waitUntil(
      writeCredentialAuditEvent(env, {
        action: 'request.approved',
        accountId: credReq.account_id,
        resourceId: credReq.request_id,
        details: { approved_by: operatorEmail, vault_key: vaultKeyFinal || '' },
      })
    );

    if (contentType.includes('application/x-www-form-urlencoded')) {
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;background:#0f0f0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;}</style></head><body><h2>✓ Credential Delivered</h2><p style="color:#888;margin-top:12px">The credential will be securely delivered to the agent on its next poll.<br>It will be deleted immediately after delivery.</p></body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
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

    const now = new Date().toISOString();
    credReq.poll_count += 1;
    credReq.last_poll_at = now;

    const remainingMs = new Date(credReq.expires_at).getTime() - Date.now();
    if (remainingMs <= 0) {
      await env.KEYS.delete('credreq:' + deviceCode);
      return json({ status: 'expired' });
    }
    const remainingTtlSec = Math.max(1, Math.floor(remainingMs / 1000));

    if (credReq.status === 'pending') {
      // Slow down if polling too aggressively (>60 polls in a 10-minute window)
      if (credReq.poll_count > 60) {
        return json({ status: 'slow_down', interval: 30 });
      }
      ctx.waitUntil(
        env.KEYS.put('credreq:' + deviceCode, JSON.stringify(credReq), { expirationTtl: remainingTtlSec })
          .catch(() => {})
      );
      return json({ status: 'authorization_pending' });
    }

    if (credReq.status === 'denied') {
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

    if (credReq.status === 'approved' && credReq.credential_value_encrypted) {
      // Decrypt — only possible because the agent holds device_code
      let credentialValue: string;
      try {
        credentialValue = await decryptCredential(credReq.credential_value_encrypted, deviceCode);
      } catch (e) {
        console.error('[credentials] decrypt failed:', e instanceof Error ? e.message : String(e));
        return err('Failed to decrypt credential. Request may be corrupted.', 500, 'decrypt_failed');
      }

      // One-time delivery: delete from KV before returning
      await Promise.all([
        env.KEYS.delete('credreq:' + deviceCode),
        env.KEYS.delete('credreq-code:' + credReq.user_code_hash),
      ]);

      ctx.waitUntil(
        writeCredentialAuditEvent(env, {
          action: 'request.completed',
          accountId: account.id,
          resourceId: credReq.request_id,
          details: { vault_key: credReq.vault_key_final || credReq.vault_key },
        })
      );

      return json({
        status: 'approved',
        credential_value: credentialValue,
        vault_key: credReq.vault_key_final || credReq.vault_key,
        request_id: credReq.request_id,
      });
    }

    // Catch-all for unexpected states
    return json({ status: 'expired' });
  }

  return null;
}
