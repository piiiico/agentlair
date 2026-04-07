// ─── Vault Routes ─────────────────────────────────────────────────────────────
// Handles: /v1/vault/* — both public (seed storage/recovery) and protected (key CRUD)
//
// Public routes (account === null):
//   POST /v1/vault/store        — store an encrypted seed blob
//   POST /v1/vault/recover      — request recovery magic link
//   GET  /v1/vault/recover/verify — verify token, return blobs
//
// Protected routes (account !== null):
//   POST /v1/vault/recovery-email     — register recovery email for account
//   GET  /v1/vault/ or /v1/vault      — list vault keys
//   PUT  /v1/vault/{key}              — store versioned encrypted blob
//   GET  /v1/vault/{key}              — retrieve encrypted blob
//   DELETE /v1/vault/{key}            — delete blob

import { nanoid, sha256hex, json, err } from '../utils.js';
import type { Env, RouteContext, VaultIndexEntry } from '../types.js';
import { sendVaultRecoveryEmail } from '../middleware/auth.js';
import { SERVICE_PRICES, X402_CONFIG, verifyX402Payment, settleX402Payment, make402Response, trackX402Spend, autoUpgradeIfThreshold, checkSpendingCap } from '../x402.js';
import { recordBudgetSpend } from '../middleware/budget.js';

const VAULT_LIMITS = {
  free:  { max_keys: 10, max_versions: 3, max_blob_size: 16384 },   // 16 KB
  paid:  { max_keys: 999999, max_versions: 100, max_blob_size: 65536 }, // 64 KB
};

export async function handleVaultRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  { url, path, method, account }: RouteContext,
): Promise<Response | null> {

  // Only match /v1/vault paths
  if (!path.startsWith('/v1/vault')) return null;

  // ── Public routes (no auth required) ────────────────────────────────────────

  if (!account) {
    // POST /v1/vault/store — store an encrypted seed blob
    if (path === '/v1/vault/store' && method === 'POST') {
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}
      const encryptedSeed = body.encrypted_seed;
      const recoveryEmail = (typeof body.recovery_email === 'string' ? body.recovery_email : '').toLowerCase().trim();

      if (!encryptedSeed || typeof encryptedSeed !== 'string') {
        return err('encrypted_seed required (base64 or hex encoded ciphertext)', 400, 'invalid_encrypted_seed');
      }
      if (encryptedSeed.length > 50000) {
        return err('encrypted_seed too large (max 50KB)', 400, 'payload_too_large');
      }
      if (!recoveryEmail || !recoveryEmail.includes('@')) {
        return err('recovery_email required (valid email address)', 400, 'invalid_email');
      }

      const emailHash = await sha256hex(recoveryEmail);
      const today = new Date().toISOString().slice(0, 10);
      const storeRlKey = 'vault-rl:' + emailHash + ':' + today;
      const storeCount = parseInt(await env.KEYS.get(storeRlKey) || '0');
      if (storeCount >= 5) {
        return err('Too many vault entries for this email today. Try again tomorrow.', 429, 'rate_limited');
      }
      try { await env.KEYS.put(storeRlKey, String(storeCount + 1), { expirationTtl: 86400 }); } catch { /* fail-open */ }

      const vaultId = 'vlt_' + nanoid(24);
      const createdAt = new Date().toISOString();
      await env.KEYS.put('vault:' + vaultId, JSON.stringify({
        encrypted_seed: encryptedSeed,
        recovery_email: recoveryEmail,
        created_at: createdAt,
      }));

      const emailIndexKey = 'vault-email:' + emailHash;
      const existingRaw = await env.KEYS.get(emailIndexKey);
      const vaultIds = existingRaw ? JSON.parse(existingRaw) : [];
      vaultIds.push(vaultId);
      await env.KEYS.put(emailIndexKey, JSON.stringify(vaultIds));

      return json({
        vault_id: vaultId,
        stored_at: createdAt,
        message: 'Encrypted seed stored. Use POST /v1/vault/recover with your recovery email to retrieve it.',
      });
    }

    // POST /v1/vault/recover — request a magic link to recover encrypted seed(s)
    if (path === '/v1/vault/recover' && method === 'POST') {
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}
      const email = (typeof body.email === 'string' ? body.email : '').toLowerCase().trim();
      if (!email || !email.includes('@')) return err('email required', 400, 'invalid_email');

      const emailHash = await sha256hex(email);
      const hour = new Date().toISOString().slice(0, 13);
      const recoverRlKey = 'vault-recover-rl:' + emailHash + ':' + hour;
      const recoverCount = parseInt(await env.KEYS.get(recoverRlKey) || '0');
      if (recoverCount >= 3) {
        return err('Too many recovery attempts. Try again in an hour.', 429, 'rate_limited');
      }
      try { await env.KEYS.put(recoverRlKey, String(recoverCount + 1), { expirationTtl: 3600 }); } catch { /* fail-open */ }

      const vaultIdsRaw = await env.KEYS.get('vault-email:' + emailHash);
      const vaultIds = vaultIdsRaw ? JSON.parse(vaultIdsRaw) : [];

      const accountIdsRaw = await env.VAULT.get('recovery-idx:' + emailHash);
      const accountIds = accountIdsRaw ? JSON.parse(accountIdsRaw) : [];

      if (vaultIds.length === 0 && accountIds.length === 0) {
        // Security: return same message as success to prevent email enumeration
        return json({ sent: true, message: 'Recovery link sent. Check your inbox — expires in 15 minutes.' });
      }

      const token = nanoid(40);
      const tokenHash = await sha256hex(token);
      await env.KEYS.put(
        'vault-magic:' + tokenHash,
        JSON.stringify({ vault_ids: vaultIds, account_ids: accountIds, email, expires: Date.now() + 15 * 60 * 1000 }),
        { expirationTtl: 900 },
      );

      const baseUrl = new URL(request.url).origin;
      try {
        await sendVaultRecoveryEmail(email, token, baseUrl, env);
      } catch (e: unknown) {
        return err('Failed to send recovery email: ' + (e instanceof Error ? e.message : String(e)), 502, 'email_error');
      }

      return json({ sent: true, message: 'Recovery link sent. Check your inbox — expires in 15 minutes.' });
    }

    // GET /v1/vault/recover/verify?token=... — verify recovery token, return encrypted seeds
    if (path === '/v1/vault/recover/verify' && method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) return err('token required', 400, 'invalid_token');

      const tokenHash = await sha256hex(token);
      const magicJson = await env.KEYS.get('vault-magic:' + tokenHash);
      if (!magicJson) return err('Invalid or expired recovery token.', 400, 'invalid_token');

      const magic = JSON.parse(magicJson);
      if (Date.now() > magic.expires) {
        await env.KEYS.delete('vault-magic:' + tokenHash);
        return err('Recovery token expired. Request a new one via POST /v1/vault/recover.', 400, 'token_expired');
      }

      await env.KEYS.delete('vault-magic:' + tokenHash);

      const legacyEntries: Array<{ vault_id: string; encrypted_seed: string; created_at: string }> = [];
      for (const vaultId of (magic.vault_ids || [])) {
        const entryJson = await env.KEYS.get('vault:' + vaultId);
        if (entryJson) {
          const entry = JSON.parse(entryJson) as Record<string, unknown>;
          legacyEntries.push({
            vault_id: vaultId as string,
            encrypted_seed: entry.encrypted_seed as string,
            created_at: entry.created_at as string,
          });
        }
      }

      const v2Entries: Array<{ account_id: string; key: string; ciphertext: string; metadata: unknown; version: number; created_at: string }> = [];
      for (const accountId of (magic.account_ids || [])) {
        const indexRaw = await env.VAULT.get('vault-index:' + accountId);
        if (!indexRaw) continue;
        const keyIndex = JSON.parse(indexRaw);
        for (const keyMeta of keyIndex) {
          const latestVersion = keyMeta.version;
          const entryJson = await env.VAULT.get('vault:' + accountId + ':' + keyMeta.key + ':' + latestVersion);
          if (entryJson) {
            const entry = JSON.parse(entryJson);
            v2Entries.push({
              account_id: accountId,
              key: keyMeta.key,
              ciphertext: entry.ciphertext,
              metadata: entry.metadata || null,
              version: latestVersion,
              created_at: entry.created_at,
            });
          }
        }
      }

      return json({
        recovered: true,
        entries: v2Entries,
        count: v2Entries.length,
        legacy_entries: legacyEntries,
        legacy_count: legacyEntries.length,
        note: 'Decrypt each entry with your recovery passphrase or master seed. AgentLair never stored the plaintext.',
      });
    }

    return null; // no public vault route matched
  }

  // ── Protected routes (account required) ──────────────────────────────────────

  // POST /v1/vault/recovery-email — register recovery email + encrypted seed for this account
  if (path === '/v1/vault/recovery-email' && method === 'POST') {
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch {}
    const recoveryEmail = (typeof body.email === 'string' ? body.email : '').toLowerCase().trim();
    const encryptedSeed = body.encrypted_seed;

    if (!recoveryEmail || !recoveryEmail.includes('@')) {
      return err('email required (valid email address)', 400, 'invalid_email');
    }
    if (!encryptedSeed || typeof encryptedSeed !== 'string') {
      return err('encrypted_seed required (base64 or hex encoded ciphertext)', 400, 'invalid_encrypted_seed');
    }
    if (encryptedSeed.length > 100000) {
      return err('encrypted_seed too large (max 100KB)', 400, 'payload_too_large');
    }

    const storedAt = new Date().toISOString();
    const recoveryKey = 'recovery:' + account.id;
    await env.VAULT.put(recoveryKey, JSON.stringify({
      email: recoveryEmail,
      encrypted_seed: encryptedSeed,
      stored_at: storedAt,
    }));

    const emailHash = await sha256hex(recoveryEmail);
    const emailIndexKey = 'recovery-idx:' + emailHash;
    const existingIdx = await env.VAULT.get(emailIndexKey);
    const accountIds = existingIdx ? JSON.parse(existingIdx) : [];
    if (!accountIds.includes(account.id)) {
      accountIds.push(account.id);
      await env.VAULT.put(emailIndexKey, JSON.stringify(accountIds));
    }

    return json({
      ok: true,
      email: recoveryEmail,
      stored_at: storedAt,
      note: 'Recovery email registered. Your encrypted seed can be recovered via POST /v1/vault/recover using this email.',
    });
  }

  // GET /v1/vault/ — list all vault keys (metadata only, never ciphertext)
  if ((path === '/v1/vault' || path === '/v1/vault/') && method === 'GET') {
    const limits = VAULT_LIMITS[account.tier as keyof typeof VAULT_LIMITS] || VAULT_LIMITS.free;
    const indexKey = 'vault-index:' + account.id;
    const indexRaw = await env.VAULT.get(indexKey);
    const keys = indexRaw ? JSON.parse(indexRaw) : [];
    return json({
      keys,
      count: keys.length,
      limit: limits.max_keys,
      tier: account.tier,
    });
  }

  // Vault key routes — match /v1/vault/{key}
  const vaultKeyMatch = path.match(/^\/v1\/vault\/([A-Za-z0-9_\-.]{1,128})$/);
  if (vaultKeyMatch) {
    const vaultKey = vaultKeyMatch[1];
    const limits = VAULT_LIMITS[account.tier as keyof typeof VAULT_LIMITS] || VAULT_LIMITS.free;
    const indexKey = 'vault-index:' + account.id;
    const latestKey = 'vault:' + account.id + ':' + vaultKey + ':latest';

    async function getVaultIndex(): Promise<VaultIndexEntry[]> {
      const raw = await env.VAULT.get(indexKey);
      return raw ? JSON.parse(raw) : [];
    }

    async function saveVaultIndex(idx: VaultIndexEntry[]) {
      await env.VAULT.put(indexKey, JSON.stringify(idx));
    }

    // PUT /v1/vault/{key} — store an encrypted blob (versioned)
    if (method === 'PUT') {
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch {}

      const ciphertext = body.ciphertext || body.value;
      const metadata = body.metadata || null;

      if (ciphertext === undefined || ciphertext === null) {
        return err('ciphertext required in request body: {"ciphertext": "<encrypted_blob>"}. Also accepts "value" for backward compatibility.', 400, 'invalid_ciphertext');
      }
      if (typeof ciphertext !== 'string') {
        return err('ciphertext must be a string (base64url or hex encoded)', 400, 'invalid_ciphertext');
      }
      if (ciphertext.length > limits.max_blob_size) {
        const maxKB = Math.round(limits.max_blob_size / 1024);
        return err('ciphertext too large (max ' + maxKB + 'KB on ' + account.tier + ' tier)', 400, 'payload_too_large');
      }
      if (metadata !== null && typeof metadata !== 'object') {
        return err('metadata must be an object (or omitted)', 400, 'invalid_metadata');
      }
      if (metadata && JSON.stringify(metadata).length > 4096) {
        return err('metadata too large (max 4KB)', 400, 'metadata_too_large');
      }

      const now = new Date().toISOString();

      const latestRaw = await env.VAULT.get(latestKey);
      const currentVersion = latestRaw ? parseInt(latestRaw) : 0;
      const isNew = currentVersion === 0;

      let vaultPaymentReceipt: string | undefined;
      if (isNew) {
        const index = await getVaultIndex();
        if (index.length >= limits.max_keys) {
          // Free tier limit reached — allow bypass via x402 payment
          const paymentHeader = request.headers.get('X-PAYMENT');
          if (!paymentHeader) {
            return make402Response(SERVICE_PRICES.vault_write, {
              vault_limit: {
                current: index.length,
                limit: limits.max_keys,
                tier: account.tier,
                upgrade_url: 'https://agentlair.dev/pricing',
              },
            });
          }
          // Verify the x402 payment
          const verification = await verifyX402Payment(paymentHeader, SERVICE_PRICES.vault_write);
          if (!verification.valid) {
            return new Response(JSON.stringify({
              error: 'payment_invalid',
              message: verification.error,
            }), {
              status: 402,
              headers: { 'Content-Type': 'application/json', 'X-402-Version': String(X402_CONFIG.x402Version) },
            });
          }
          // Check spending caps if this is a pod account
          if (account.type === 'pod' && account.pod_id) {
            try {
              const podRaw = await env.KEYS.get('pod:' + account.pod_id);
              if (podRaw) {
                const pod = JSON.parse(podRaw);
                if (pod.spending_caps) {
                  const capCheck = await checkSpendingCap(env, account.id, SERVICE_PRICES.vault_write.amount, pod.spending_caps);
                  if (!capCheck.allowed) {
                    const periodLabel = capCheck.exceeded || 'period';
                    const capUsdc = ((capCheck.cap || 0) / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0';
                    const currentUsdc = ((capCheck.current || 0) / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0';
                    return new Response(JSON.stringify({
                      error: `Spending cap exceeded: ${periodLabel} limit of ${capUsdc} USDC reached (current: ${currentUsdc} USDC). Payment blocked by pod spending cap.`,
                      code: 'spending_cap_exceeded',
                      cap: { period: periodLabel, limit_usdc: capUsdc, current_usdc: currentUsdc },
                    }), {
                      status: 402,
                      headers: { 'Content-Type': 'application/json' },
                    });
                  }
                }
              }
            } catch { /* fail-open: don't block payment for cap check error */ }
          }

          // Payment verified — settle and track spend
          try {
            const settlement = await settleX402Payment(paymentHeader, SERVICE_PRICES.vault_write);
            if (settlement.settled && settlement.receipt) {
              vaultPaymentReceipt = settlement.receipt;
            }
          } catch {
            // Settlement is non-critical — proceed
          }
          try {
            const spend = await trackX402Spend(env, account.id, SERVICE_PRICES.vault_write.amount, { payer: verification.payer, service: 'vault_write' });
            await autoUpgradeIfThreshold(env, account, spend);
          } catch {
            // Non-critical
          }
        }
      }

      const newVersion = currentVersion + 1;
      const versionKey = 'vault:' + account.id + ':' + vaultKey + ':' + newVersion;

      await env.VAULT.put(versionKey, JSON.stringify({
        ciphertext,
        metadata,
        created_at: now,
      }));

      await env.VAULT.put(latestKey, String(newVersion));

      if (newVersion > limits.max_versions) {
        const pruneVersion = newVersion - limits.max_versions;
        const pruneKey = 'vault:' + account.id + ':' + vaultKey + ':' + pruneVersion;
        await env.VAULT.delete(pruneKey);
      }

      const index = await getVaultIndex();
      const existingIdx = index.findIndex((e: VaultIndexEntry) => e.key === vaultKey);
      const createdAt = isNew ? now : (existingIdx >= 0 ? index[existingIdx].created_at : now);
      const indexEntry: VaultIndexEntry = {
        key: vaultKey,
        version: newVersion,
        metadata: (metadata as Record<string, unknown> | null) || (existingIdx >= 0 ? index[existingIdx].metadata : null),
        created_at: createdAt,
        updated_at: now,
      };
      if (existingIdx >= 0) {
        index[existingIdx] = indexEntry;
      } else {
        index.push(indexEntry);
      }
      await saveVaultIndex(index);

      const vaultResponseBody = JSON.stringify({
        key: vaultKey,
        stored: true,
        version: newVersion,
        created_at: createdAt,
        updated_at: now,
      });
      const vaultResponseHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (vaultPaymentReceipt) vaultResponseHeaders['X-Payment-Response'] = vaultPaymentReceipt;

      // Record budget spend (fire-and-forget — non-critical)
      ctx.waitUntil(recordBudgetSpend(env, account.id, parseInt(SERVICE_PRICES.vault_write.amount)));

      return new Response(vaultResponseBody, { status: isNew ? 201 : 200, headers: vaultResponseHeaders });
    }

    // GET /v1/vault/{key} — retrieve an encrypted blob
    if (method === 'GET') {
      const requestedVersion = url.searchParams.get('version');

      const latestRaw = await env.VAULT.get(latestKey);
      if (latestRaw) {
        const latestVersion = parseInt(latestRaw);
        const version = requestedVersion ? parseInt(requestedVersion) : latestVersion;
        if (isNaN(version) || version < 1) {
          return err('Invalid version number', 400, 'invalid_version');
        }
        const versionKey = 'vault:' + account.id + ':' + vaultKey + ':' + version;
        const raw = await env.VAULT.get(versionKey);
        if (!raw) {
          return err('Version ' + version + ' not found (may have been pruned). Latest: ' + latestVersion, 404, 'version_not_found');
        }
        const entry = JSON.parse(raw);

        const index = await getVaultIndex();
        const idxEntry = index.find((e: VaultIndexEntry) => e.key === vaultKey);

        return json({
          key: vaultKey,
          ciphertext: entry.ciphertext,
          value: entry.ciphertext, // v1 compat
          metadata: entry.metadata,
          version,
          latest_version: latestVersion,
          created_at: idxEntry ? idxEntry.created_at : entry.created_at,
          updated_at: entry.created_at,
        });
      }

      // Backward compat: try old kv: format
      const oldKvKey = 'kv:' + account.id + ':' + vaultKey;
      const oldRaw = await env.VAULT.get(oldKvKey);
      if (oldRaw) {
        const entry = JSON.parse(oldRaw);
        return json({
          key: vaultKey,
          ciphertext: entry.value,
          value: entry.value,
          metadata: null,
          version: 1,
          latest_version: 1,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          _migrated: false,
        });
      }

      return err('Key not found', 404, 'not_found');
    }

    // DELETE /v1/vault/{key} — delete a secret
    if (method === 'DELETE') {
      const requestedVersion = url.searchParams.get('version');

      const latestRaw = await env.VAULT.get(latestKey);

      if (latestRaw) {
        const latestVersion = parseInt(latestRaw);

        if (requestedVersion) {
          const version = parseInt(requestedVersion);
          if (isNaN(version) || version < 1) {
            return err('Invalid version number', 400, 'invalid_version');
          }
          const versionKey = 'vault:' + account.id + ':' + vaultKey + ':' + version;
          const raw = await env.VAULT.get(versionKey);
          if (!raw) {
            return err('Version ' + version + ' not found', 404, 'version_not_found');
          }
          await env.VAULT.delete(versionKey);

          if (version === latestVersion) {
            let newLatest = latestVersion - 1;
            while (newLatest > 0) {
              const checkKey = 'vault:' + account.id + ':' + vaultKey + ':' + newLatest;
              const exists = await env.VAULT.get(checkKey);
              if (exists) break;
              newLatest--;
            }
            if (newLatest > 0) {
              await env.VAULT.put(latestKey, String(newLatest));
              const index = await getVaultIndex();
              const idx = index.findIndex((e: VaultIndexEntry) => e.key === vaultKey);
              if (idx >= 0) {
                index[idx].version = newLatest;
                index[idx].updated_at = new Date().toISOString();
                await saveVaultIndex(index);
              }
            } else {
              await env.VAULT.delete(latestKey);
              const index = await getVaultIndex();
              await saveVaultIndex(index.filter((e: VaultIndexEntry) => e.key !== vaultKey));
            }
          }

          return json({ key: vaultKey, deleted: true, version_removed: version });
        }

        // Delete all versions
        const deletePromises = [];
        for (let v = 1; v <= latestVersion; v++) {
          deletePromises.push(env.VAULT.delete('vault:' + account.id + ':' + vaultKey + ':' + v));
        }
        deletePromises.push(env.VAULT.delete(latestKey));
        await Promise.all(deletePromises);

        const index = await getVaultIndex();
        await saveVaultIndex(index.filter((e: VaultIndexEntry) => e.key !== vaultKey));

        return json({ key: vaultKey, deleted: true, versions_removed: latestVersion });
      }

      // Backward compat: try old kv: format
      const oldKvKey = 'kv:' + account.id + ':' + vaultKey;
      const oldRaw = await env.VAULT.get(oldKvKey);
      if (oldRaw) {
        await env.VAULT.delete(oldKvKey);
        return json({ key: vaultKey, deleted: true, versions_removed: 1 });
      }

      return err('Key not found', 404, 'not_found');
    }

    return err('Method not allowed. Vault key supports: GET, PUT, DELETE.', 405, 'method_not_allowed');
  }

  // Catch-all for other /v1/vault/* routes
  return json({
    available: [
      'GET /v1/vault/ — list all keys (metadata only, no ciphertext)',
      'PUT /v1/vault/{key} — store encrypted blob (body: {ciphertext: string, metadata?: object})',
      'GET /v1/vault/{key} — retrieve encrypted blob (query: ?version=N for specific version)',
      'DELETE /v1/vault/{key} — delete all versions (query: ?version=N for specific version)',
      'POST /v1/vault/recovery-email — register recovery email + encrypted seed',
    ],
    limits: account ? (VAULT_LIMITS[account.tier as keyof typeof VAULT_LIMITS] || VAULT_LIMITS.free) : null,
    tier: account?.tier,
    note: 'Zero-knowledge secret store. Client encrypts before storing. Server stores opaque blobs. Version history is append-only.',
  }, 200);
}
