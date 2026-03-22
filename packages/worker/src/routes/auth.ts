// ─── Auth Routes ──────────────────────────────────────────────────────────────
// Handles: /v1/auth/* (login, verify, key creation, key management)
//          /v1/keys (v0.2 alias)
//          /v1/account/* (account info, recovery email)
//          /v1/e2e/* (E2E key rotation)
//
// Public routes (account === null): login, verify, key creation
// Protected routes (account !== null): account info, key rotation, backup, e2e

import { nanoid, sha256hex, json, err, html } from '../utils.js';
import type { Env, RouteContext, KeyEntry, KeyHistoryEntry } from '../types.js';
import { sendMagicLinkEmail } from '../middleware/auth.js';
import { checkIpRateLimit } from '../middleware/ratelimit.js';
import { saveKeysList, ensureKeysList } from '../platform-crypto.js';
import { validateLocalPart, isReservedAddress } from '../reserved.js';

export async function handleAuthRoutes(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  { url, path, method, account }: RouteContext,
): Promise<Response | null> {

  // ── Public routes (no auth required) ────────────────────────────────────────

  if (!account) {
    // POST /v1/auth/login — request magic link by recovery email
    if (path === '/v1/auth/login' && method === 'POST') {
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}
      const email = (typeof body.email === 'string' ? body.email : '').toLowerCase().trim();
      if (!email || !email.includes('@')) return err('email required', 400, 'invalid_email');

      // Look up account by recovery email index
      const accountId = await env.KEYS.get('recovery-email:' + email);
      if (!accountId) {
        // Don't reveal whether email is registered
        return json({ sent: true, message: 'If this email is registered, a magic link has been sent.' });
      }

      // Generate magic link token (15min TTL)
      const token = nanoid(40);
      const tokenHash = await sha256hex(token);
      await env.KEYS.put(
        'magic:' + tokenHash,
        JSON.stringify({ account_id: accountId, email, expires: Date.now() + 15 * 60 * 1000 }),
        { expirationTtl: 900 },
      );

      const baseUrl = new URL(request.url).origin;
      try {
        await sendMagicLinkEmail(email, token, baseUrl, env);
      } catch (e: unknown) {
        return err('Failed to send magic link: ' + (e instanceof Error ? e.message : String(e)), 502, 'email_error');
      }

      return json({ sent: true, message: 'Magic link sent. Check your inbox — expires in 15 minutes.' });
    }

    // GET /v1/auth/verify?token=... — verify magic link, create session, redirect to dashboard
    if (path === '/v1/auth/verify' && method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) return err('token required', 400, 'invalid_token');

      const tokenHash = await sha256hex(token);
      const magicJson = await env.KEYS.get('magic:' + tokenHash);
      if (!magicJson) return html('<h2 style="font-family:sans-serif;color:#ef4444;padding:2rem;">Invalid or expired magic link. <a href="/dashboard">Try again</a>.</h2>', 400);

      const magic = JSON.parse(magicJson);
      if (Date.now() > magic.expires) {
        await env.KEYS.delete('magic:' + tokenHash);
        return html('<h2 style="font-family:sans-serif;color:#ef4444;padding:2rem;">Magic link expired. <a href="/dashboard">Request a new one</a>.</h2>', 400);
      }

      // Single-use: delete token
      await env.KEYS.delete('magic:' + tokenHash);

      // Create session token (24h)
      const sessionToken = 'session_' + nanoid(40);
      const sessionHash = await sha256hex(sessionToken);
      await env.KEYS.put(
        'session:' + sessionHash,
        JSON.stringify({ account_id: magic.account_id, created_at: new Date().toISOString(), expires: Date.now() + 24 * 60 * 60 * 1000 }),
        { expirationTtl: 86400 },
      );

      // Redirect to dashboard with session cookie
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/dashboard',
          'Set-Cookie': `al_session=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // POST /v1/auth/keys — create a new API key (public, no auth needed)
    if (path === '/v1/auth/keys' && method === 'POST') {
      const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      const ipCheck = await checkIpRateLimit(env, clientIp, 'key-create', 5);
      if (!ipCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'rate_limited',
          message: 'Too many key creation requests. Try again later.',
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Retry-After': '3600',
          },
        });
      }

      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}
      const name = typeof body.name === 'string' ? body.name : 'default';

      const keyValue = 'al_live_' + nanoid(32);
      const keyHash = await sha256hex(keyValue);
      const keyPrefix = keyValue.slice(0, 12);
      const accountId = 'acc_' + nanoid(16);
      const now = new Date().toISOString();

      const newAccount = {
        id: accountId,
        key_prefix: keyPrefix,
        name,
        tier: 'free',
        email: body.email || null,
        created_at: now,
        stacks: [],
      };

      // KV writes — wrapped in try/catch to handle quota limits gracefully.
      // saveKeysList skipped: ensureKeysList lazily bootstraps on first access.
      try {
        await env.KEYS.put('key:' + keyHash, JSON.stringify(newAccount));
        await env.KEYS.put('account:' + accountId, keyHash);
        if (newAccount.email) {
          await env.KEYS.put('recovery-email:' + newAccount.email.toLowerCase(), accountId);
        }
      } catch (kvErr: unknown) {
        const msg = kvErr instanceof Error ? kvErr.message : '';
        if (msg.includes('free usage limit') || msg.includes('KV') || msg.includes('quota')) {
          return err('Key creation temporarily unavailable — KV write quota exceeded. Try again later.', 503, 'kv_quota_exceeded');
        }
        throw kvErr;
      }

      return json({
        api_key: keyValue,
        key_prefix: keyPrefix,
        account_id: accountId,
        tier: 'free',
        created_at: now,
        warning: 'Save this key — it will not be shown again. Set a recovery email at POST /v1/account/recovery-email to enable dashboard login.',
        limits: {
          stacks: 1,
          addresses: 10,
          dns_records: 10,
          emails_per_day: 10,
          requests_per_day: 100,
        },
      }, 201);
    }

    // POST /v1/keys — v0.2 alias for /v1/auth/keys
    if (path === '/v1/keys' && method === 'POST') {
      const clientIp2 = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      const ipCheck2 = await checkIpRateLimit(env, clientIp2, 'key-create', 5);
      if (!ipCheck2.allowed) {
        return new Response(JSON.stringify({
          error: 'rate_limited',
          message: 'Too many key creation requests. Try again later.',
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Retry-After': '3600',
          },
        });
      }

      const keyValue = 'al_live_' + nanoid(32);
      const keyHash = await sha256hex(keyValue);
      const keyPrefix = keyValue.slice(0, 12);
      const accountId = 'acc_' + nanoid(16);
      const now = new Date().toISOString();
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}
      const acc = { id: accountId, key_prefix: keyPrefix, name: typeof body.name === 'string' ? body.name : 'default', tier: 'free', email: typeof body.email === 'string' ? body.email : null, created_at: now, stacks: [] as string[] };
      await env.KEYS.put('key:' + keyHash, JSON.stringify(acc));
      await env.KEYS.put('account:' + accountId, keyHash);
      return json({ key: keyValue, account_id: accountId, created_at: now, note: 'Save this key — not shown again.' }, 201);
    }

    // POST /v1/auth/agent-register — zero-human agent onboarding
    if (path === '/v1/auth/agent-register' && method === 'POST') {
      const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      const ipCheck = await checkIpRateLimit(env, clientIp, 'agent-register', 5);
      if (!ipCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'rate_limited',
          message: 'Too many registration requests. Try again later.',
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Retry-After': '3600',
          },
        });
      }

      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}
      const name = typeof body.name === 'string' ? body.name : undefined;
      const address = typeof body.address === 'string' ? body.address : undefined;
      const public_key = typeof body.public_key === 'string' ? body.public_key : undefined;
      const recovery_email = typeof body.recovery_email === 'string' ? body.recovery_email : undefined;

      let emailAddress = '';

      if (address) {
        // Explicit address path
        if (!address.endsWith('@agentlair.dev')) {
          return err('Address must end with @agentlair.dev.', 400, 'invalid_address');
        }
        const localPartError = validateLocalPart(address);
        if (localPartError) {
          return err(localPartError, 400, 'invalid_address');
        }
        if (isReservedAddress(address)) {
          return err('This address is reserved and cannot be claimed.', 403, 'address_reserved');
        }
        if (!env.EMAILS) return err('Email service unavailable.', 503, 'service_unavailable');
        const existing = await env.EMAILS.get('email-owner:' + address);
        if (existing) {
          return err('This address is already taken.', 409, 'address_taken');
        }
        emailAddress = address;
      } else if (name) {
        // Name-derived path
        const sanitized = name.toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 30)
          .replace(/^-|-$/g, '');
        const candidate = `${sanitized}@agentlair.dev`;
        // Check reserved BEFORE any KV lookup
        if (isReservedAddress(candidate)) {
          return err('This address is reserved and cannot be claimed.', 403, 'address_reserved');
        }
        if (!env.EMAILS) return err('Email service unavailable.', 503, 'service_unavailable');
        const existing = await env.EMAILS.get('email-owner:' + candidate);
        if (existing) {
          // Try 4-digit suffix fallback
          const suffix = Math.floor(1000 + Math.random() * 9000).toString();
          const fallback = `${sanitized.slice(0, 25)}-${suffix}@agentlair.dev`;
          const fallbackExisting = await env.EMAILS.get('email-owner:' + fallback);
          if (fallbackExisting) {
            return err('Could not find an available address for this name. Specify an explicit address.', 409, 'address_taken');
          }
          emailAddress = fallback;
        } else {
          emailAddress = candidate;
        }
      } else {
        // Random path — agent- prefix is not reserved
        emailAddress = `agent-${nanoid(8)}@agentlair.dev`;
      }

      // Create account (same pattern as POST /v1/auth/keys)
      const keyValue = 'al_live_' + nanoid(32);
      const keyHash = await sha256hex(keyValue);
      const keyPrefix = keyValue.slice(0, 12);
      const accountId = 'acc_' + nanoid(16);
      const now = new Date().toISOString();

      const newAccount = {
        id: accountId,
        key_prefix: keyPrefix,
        name: name || emailAddress.split('@')[0],
        tier: 'free',
        email: recovery_email || null,
        created_at: now,
        stacks: [] as string[],
      };

      // KV writes — wrapped in try/catch to handle quota limits gracefully.
      // saveKeysList skipped: ensureKeysList lazily bootstraps on first access.
      try {
        await env.KEYS.put('key:' + keyHash, JSON.stringify(newAccount));
        await env.KEYS.put('account:' + accountId, keyHash);

        // Claim email address
        if (!env.EMAILS) return err('Email service unavailable.', 503, 'service_unavailable');
        await env.EMAILS.put('email-owner:' + emailAddress, accountId);

        // Optional: register E2E public key
        if (public_key) {
          await env.EMAILS.put('email-pubkey:' + emailAddress, public_key);
        }

        // Optional: index by recovery email for magic link lookup
        if (recovery_email) {
          await env.KEYS.put('recovery-email:' + recovery_email.toLowerCase(), accountId);
        }
      } catch (kvErr: unknown) {
        const msg = kvErr instanceof Error ? kvErr.message : '';
        if (msg.includes('free usage limit') || msg.includes('KV') || msg.includes('quota')) {
          return err('Registration temporarily unavailable — KV write quota exceeded. Try again later.', 503, 'kv_quota_exceeded');
        }
        throw kvErr; // re-throw non-KV errors to global handler
      }

      return json({
        api_key: keyValue,
        account_id: accountId,
        email_address: emailAddress,
        tier: 'free',
        e2e_enabled: !!public_key,
        created_at: now,
        warning: 'Save your API key — it will not be shown again.',
        limits: { emails_per_day: 10, requests_per_day: 100, stacks: 1, addresses: 10 },
      }, 201);
    }

    return null; // no public auth route matched
  }

  // ── Protected routes (account required) ──────────────────────────────────────

  // Pod keys cannot manage account keys or recovery email (use parent platform key)
  if (account.type === 'pod' && (
    path === '/v1/auth/keys/rotate' ||
    path === '/v1/auth/keys/generate-backup' ||
    path === '/v1/auth/keys/activate-backup' ||
    path === '/v1/auth/keys/list' ||
    path === '/v1/account/recovery-email' ||
    path === '/v1/e2e/rotate-key'
  )) {
    return err('Pod keys cannot manage account keys. Use your platform API key.', 403, 'pod_auth_forbidden');
  }

  // GET /v1/account/me — return current account info
  if (path === '/v1/account/me' && method === 'GET') {
    return json({
      id: account.id,
      key_prefix: account.key_prefix,
      name: account.name,
      tier: account.tier,
      created_at: account.created_at,
      recovery_email: account.recovery_email
        ? (account.recovery_email_encrypted ? '[encrypted]' : account.recovery_email)
        : null,
      stacks: account.stacks || [],
      e2e_enabled: !!account.e2e_public_key,
      e2e_public_key: account.e2e_public_key || null,
    });
  }

  // POST /v1/account/recovery-email — set or update recovery email
  if (path === '/v1/account/recovery-email' && method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}
    const newEmail = (body.email || '').toLowerCase().trim();
    if (!newEmail || !newEmail.includes('@')) return err('email required', 400, 'invalid_email');

    // Update account with new recovery email
    const keyHash = await env.KEYS.get('account:' + account.id);
    if (!keyHash) return err('Account not found.', 404, 'not_found');

    const updatedAccount = { ...account, recovery_email: newEmail };
    delete (updatedAccount as any)._session;
    await env.KEYS.put('key:' + keyHash, JSON.stringify(updatedAccount));

    // Index by recovery email for magic link lookup
    await env.KEYS.put('recovery-email:' + newEmail, account.id);

    return json({ ok: true, recovery_email: newEmail });
  }

  // POST /v1/auth/keys/rotate — generate new API key for same account
  if (path === '/v1/auth/keys/rotate' && method === 'POST') {
    const oldKeyHash = await env.KEYS.get('account:' + account.id);

    const newKeyValue = 'al_live_' + nanoid(32);
    const newKeyHash = await sha256hex(newKeyValue);
    const newKeyPrefix = newKeyValue.slice(0, 12);
    const now = new Date().toISOString();

    const updatedAccount = { ...account, key_prefix: newKeyPrefix, rotated_at: now };
    delete (updatedAccount as any)._session;

    await env.KEYS.put('key:' + newKeyHash, JSON.stringify(updatedAccount));
    await env.KEYS.put('account:' + account.id, newKeyHash);
    if (oldKeyHash && oldKeyHash !== newKeyHash) {
      await env.KEYS.delete('key:' + oldKeyHash);
    }

    const keys = await ensureKeysList(env, account.id);
    for (const k of keys) {
      if (k.status === 'active') k.status = 'revoked';
    }
    keys.push({ hash: newKeyHash, status: 'active', prefix: newKeyPrefix, created_at: now, label: 'primary' });
    await saveKeysList(env, account.id, keys);

    return json({
      api_key: newKeyValue,
      key_prefix: newKeyPrefix,
      account_id: account.id,
      rotated_at: now,
      warning: 'Save this key — it will not be shown again. Old key is now invalid.',
    });
  }

  // POST /v1/auth/keys/generate-backup — create a backup key (dormant until activated)
  if (path === '/v1/auth/keys/generate-backup' && method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}
    const label = body.label || 'backup';

    const keys = await ensureKeysList(env, account.id);

    const existingBackup = keys.find((k: any) => k.status === 'backup');
    if (existingBackup) {
      return err('A backup key already exists (prefix: ' + existingBackup.prefix + '...). Activate or revoke it first.', 409, 'backup_exists');
    }

    const backupKeyValue = 'al_live_' + nanoid(32);
    const backupKeyHash = await sha256hex(backupKeyValue);
    const backupKeyPrefix = backupKeyValue.slice(0, 12);
    const now = new Date().toISOString();

    keys.push({
      hash: backupKeyHash,
      status: 'backup',
      prefix: backupKeyPrefix,
      created_at: now,
      label,
    });
    await saveKeysList(env, account.id, keys);

    return json({
      backup_key: backupKeyValue,
      key_prefix: backupKeyPrefix,
      status: 'backup',
      created_at: now,
      warning: 'Save this backup key securely — it will not be shown again. It cannot authenticate until activated via POST /v1/auth/keys/activate-backup.',
    }, 201);
  }

  // POST /v1/auth/keys/activate-backup — promote backup key to active, revoke old primary
  if (path === '/v1/auth/keys/activate-backup' && method === 'POST') {
    const keys = await ensureKeysList(env, account.id);
    const backupKey = keys.find((k: any) => k.status === 'backup');
    if (!backupKey) {
      return err('No backup key found. Generate one first with POST /v1/auth/keys/generate-backup.', 404, 'no_backup');
    }

    const now = new Date().toISOString();
    const oldKeyHash = await env.KEYS.get('account:' + account.id);

    const updatedAccount = { ...account, key_prefix: backupKey.prefix, rotated_at: now };
    delete (updatedAccount as any)._session;

    await env.KEYS.put('key:' + backupKey.hash, JSON.stringify(updatedAccount));
    await env.KEYS.put('account:' + account.id, backupKey.hash);
    if (oldKeyHash && oldKeyHash !== backupKey.hash) {
      await env.KEYS.delete('key:' + oldKeyHash);
    }

    for (const k of keys) {
      if (k.status === 'active') k.status = 'revoked';
      if (k.hash === backupKey.hash) {
        k.status = 'active';
        k.label = 'primary';
        (k as any).activated_at = now;
      }
    }
    await saveKeysList(env, account.id, keys);

    return json({
      activated_key_prefix: backupKey.prefix,
      account_id: account.id,
      activated_at: now,
      message: 'Backup key is now the active primary key. Old key has been revoked.',
    });
  }

  // GET /v1/auth/keys/list — list all keys for the account with status
  if (path === '/v1/auth/keys/list' && method === 'GET') {
    const keys = await ensureKeysList(env, account.id);

    return json({
      account_id: account.id,
      keys: keys.map((k: any) => ({
        prefix: k.prefix,
        status: k.status,
        label: k.label || null,
        created_at: k.created_at,
        activated_at: k.activated_at || null,
      })),
    });
  }

  // POST /v1/e2e/rotate-key — register or rotate E2E public key for this account
  if (path === '/v1/e2e/rotate-key' && method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}
    const { master_seed, new_public_key } = body;

    if (!master_seed) return err('master_seed required in body', 400, 'missing_master_seed');
    if (!new_public_key) return err('new_public_key required in body', 400, 'missing_public_key');
    if (typeof new_public_key !== 'string' || new_public_key.length < 10) {
      return err('new_public_key must be a non-empty string (base64 or hex encoded public key)', 400, 'invalid_public_key');
    }

    const seedHash = await sha256hex(master_seed);
    const now = new Date().toISOString();
    const isFirstSetup = !account.e2e_master_seed_hash;

    if (!isFirstSetup && account.e2e_master_seed_hash !== seedHash) {
      return err('master_seed does not match. Key rotation denied.', 403, 'seed_mismatch');
    }

    const existingHistory = Array.isArray(account.e2e_key_history) ? account.e2e_key_history : [];
    const updatedHistory = account.e2e_public_key
      ? [{ public_key: account.e2e_public_key, rotated_at: now }, ...existingHistory]
      : existingHistory;

    account.e2e_master_seed_hash = seedHash;
    account.e2e_public_key = new_public_key;
    account.e2e_key_history = updatedHistory;
    account.e2e_updated_at = now;
    if (isFirstSetup) account.e2e_created_at = now;
    delete (account as any)._session;

    const keyHash = await env.KEYS.get('account:' + account.id);
    if (!keyHash) return err('Account key not found. Cannot persist update.', 500, 'account_error');
    await env.KEYS.put('key:' + keyHash, JSON.stringify(account));

    return json({
      ok: true,
      account_id: account.id,
      active_public_key: new_public_key,
      key_history_count: (updatedHistory as any[]).length,
      key_history: (updatedHistory as any[]).map((k: any) => ({ public_key: k.public_key, rotated_at: k.rotated_at })),
      first_setup: isFirstSetup,
      updated_at: now,
      note: isFirstSetup
        ? 'E2E public key registered. New messages will be encrypted with this key. Use master_seed to rotate in the future.'
        : 'E2E public key rotated. Old messages retain their previous encryption and remain decryptable with the corresponding private key derived from your master_seed.',
    });
  }

  return null; // no auth route matched
}
