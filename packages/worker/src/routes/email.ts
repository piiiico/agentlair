// ─── Email Routes ─────────────────────────────────────────────────────────────
// Handles: /v1/email/* (claim, inbox, messages, addresses, outbox, send)
//          /v1/inbox/* (v0.2 API — inbox create and access)
//
// All routes require authentication (account !== null).
// Webhook routes (/v1/email/webhooks) are handled separately in webhooks.ts.

import { nanoid, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';
import { isReservedAddress, validateLocalPart } from '../reserved.js';
import { checkEmailRateLimit, recordEmailBounce, recordEmailSent, ADDRESS_LIMITS, countOwnedAddresses } from '../middleware/ratelimit.js';

// ─── Account address index ────────────────────────────────────────────────────
// Maintains an explicit per-account address list in KV for instant consistency.
// Cloudflare KV list() is eventually consistent (up to 60s lag), so we can't
// rely on prefix-scanning email-owner:* keys for the addresses endpoint.

async function addToAccountAddresses(env: Env, accountId: string, address: string): Promise<void> {
  if (!env.EMAILS) return;
  const key = `account-addresses:${accountId}`;
  const raw = await env.EMAILS.get(key);
  const addresses: string[] = raw ? JSON.parse(raw) : [];
  if (!addresses.includes(address)) {
    addresses.push(address);
    await env.EMAILS.put(key, JSON.stringify(addresses));
  }
}

async function getAccountAddresses(env: Env, accountId: string): Promise<string[]> {
  if (!env.EMAILS) return [];
  const key = `account-addresses:${accountId}`;
  const raw = await env.EMAILS.get(key);
  if (raw) return JSON.parse(raw);

  // Fallback: scan email-owner:* keys for accounts without the index
  // (addresses claimed before the index was introduced)
  const list = await env.EMAILS.list({ prefix: 'email-owner:' });
  const addresses: string[] = [];
  for (const k of list.keys) {
    const owner = await env.EMAILS.get(k.name);
    if (owner === accountId) {
      // Extract address from key: "email-owner:foo@agentlair.dev" → "foo@agentlair.dev"
      addresses.push(k.name.slice('email-owner:'.length));
    }
  }

  // Rebuild the index so future reads are instant
  if (addresses.length > 0) {
    await env.EMAILS.put(key, JSON.stringify(addresses));
  }

  return addresses;
}
import { decryptEmailField } from '../platform-crypto.js';
import { getEmailProvider } from '../email-provider.js';
import { X402_CONFIG, EMAIL_PAYMENT_REQUIRED_RESPONSE, verifyX402Payment, settleX402Payment, trackX402Spend, autoUpgradeIfThreshold, SERVICE_PRICES, checkSpendingCap } from '../x402.js';
import { verifyAgentKit, recordAgentkitUsage, AGENTKIT_FREE_TRIAL_USES } from '../middleware/agentkit.js';

// ─── Request body types ─────────────────────────────────────────────────────

interface EmailClaimBody {
  address?: string;
  public_key?: string;
}

interface EmailSendBody {
  from?: string;
  to?: unknown;
  subject?: string;
  text?: string;
  html?: string;
  in_reply_to?: string;
  references?: string;
  client_id?: unknown;
}

interface EmailDraftBody {
  from?: string;
  to?: unknown;
  subject?: string;
  text?: string;
  html?: string;
  in_reply_to?: string;
}

interface InboxCreateBody {
  name?: string;
}

interface MessagePatchBody {
  read?: boolean;
  archived?: boolean;
}

// ─── Stored message shape (from KV) ─────────────────────────────────────────

interface StoredMessage {
  message_id?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  body_preview?: string;
  body_encrypted?: boolean;
  e2e_encrypted?: boolean;
  received_at?: string;
  read?: boolean;
  archived?: boolean;
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
  [key: string]: unknown;
}

interface OutboxEntry {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string | null;
  html: string | null;
  in_reply_to: string | null;
  queued_at: string;
  status: string;
  sent_at?: string;
  provider?: string;
  provider_id?: string;
  paid_via?: string;
  error?: string;
  error_at?: string;
  draft_id?: string;
  [key: string]: unknown;
}

export async function handleEmailRoutes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  { url, path, method, account }: RouteContext,
): Promise<Response | null> {

  // All email routes require auth
  if (!account) return null;

  // Only match /v1/email/* and /v1/inbox/* paths
  if (!path.startsWith('/v1/email') && !path.startsWith('/v1/inbox')) return null;

  // ── /v1/email/* routes ───────────────────────────────────────────────────────

  // POST /v1/email/claim — explicitly claim an @agentlair.dev address
  if (path === '/v1/email/claim' && method === 'POST') {
    let body: EmailClaimBody = {};
    try { body = (await request.json()) as EmailClaimBody; } catch { /* empty body OK */ }
    const { address, public_key } = body;

    if (!address) {
      return err('address required in body. Example: {"address": "myagent@agentlair.dev"}', 400, 'missing_address');
    }
    if (!address.endsWith('@agentlair.dev')) {
      return err('Only @agentlair.dev addresses can be claimed.', 400, 'invalid_address');
    }
    const localPartError = validateLocalPart(address);
    if (localPartError) {
      return err(localPartError, 400, 'invalid_address');
    }
    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    if (public_key !== undefined) {
      if (typeof public_key !== 'string' || public_key.length < 10) {
        return err('public_key must be a base64url-encoded X25519 public key (32 bytes)', 400, 'invalid_public_key');
      }
    }

    // H1 fix: unified error for reserved and already-claimed addresses
    // to prevent address state enumeration.
    if (isReservedAddress(address)) {
      return err('This address is not available.', 409, 'address_unavailable');
    }

    const ownerKey = `email-owner:${address}`;
    const pubKeyKvKey = `email-pubkey:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (currentOwner && currentOwner !== account.id) {
      return err('This address is not available.', 409, 'address_unavailable');
    }

    if (public_key) {
      await env.EMAILS.put(pubKeyKvKey, public_key);
    }

    if (currentOwner === account.id) {
      return json({ address, claimed: true, already_owned: true, account_id: account.id, e2e_enabled: !!public_key });
    }

    const addrLimit = ADDRESS_LIMITS[account.tier as keyof typeof ADDRESS_LIMITS] || ADDRESS_LIMITS.free;
    const owned = await countOwnedAddresses(env, account.id);
    if (owned >= addrLimit) {
      return err(`Address limit reached (${owned}/${addrLimit}). Upgrade to claim more addresses.`, 403, 'address_limit');
    }

    await env.EMAILS.put(ownerKey, account.id);
    await addToAccountAddresses(env, account.id, address);
    return json({ address, claimed: true, already_owned: false, account_id: account.id, e2e_enabled: !!public_key }, 201);
  }

  // GET /v1/email/inbox?address=...&limit=20&archived=true&include_archived=true
  if (path === '/v1/email/inbox' && method === 'GET') {
    const address = url.searchParams.get('address');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    // archived=true: show ONLY archived. include_archived=true: show all. Default: hide archived.
    const showArchived = url.searchParams.get('archived') === 'true';
    const includeArchived = url.searchParams.get('include_archived') === 'true';

    if (!address) {
      return err('address query parameter required. Example: ?address=myagent@agentlair.dev', 400, 'missing_address');
    }

    if (!address.endsWith('@agentlair.dev')) {
      return err('Only @agentlair.dev addresses supported in beta.', 400, 'invalid_address');
    }

    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    // M4 fix: no auto-claim on GET. Must explicitly POST /v1/email/claim first.
    // H1 fix: unified error for unclaimed/reserved/other-owner (prevent enumeration).
    if (!currentOwner) {
      return err('This address is not claimed. Use POST /v1/email/claim to register it first.', 404, 'address_not_claimed');
    } else if (currentOwner !== account.id) {
      return err('This address is not available.', 409, 'address_unavailable');
    }

    const indexKey = `index:${address}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    if (!indexRaw) {
      return json({ messages: [], has_more: false, count: 0, address });
    }

    const index: string[] = JSON.parse(indexRaw);
    // Iterate index, fetch and filter until we have `limit` messages
    const messages: Record<string, unknown>[] = [];
    let hasMore = false;
    for (let i = 0; i < index.length; i++) {
      const key = index[i];
      const raw = await env.EMAILS.get(key);
      if (!raw) continue;
      const msg = JSON.parse(raw) as StoredMessage;
      const isArchived = msg.archived === true;
      // Apply archive filter
      if (!includeArchived) {
        if (showArchived && !isArchived) continue;   // only archived: skip non-archived
        if (!showArchived && isArchived) continue;   // default: skip archived
      }
      if (messages.length >= limit) {
        hasMore = true;
        break;
      }
      const snippet = msg.body_preview !== undefined
        ? msg.body_preview
        : (msg.body_encrypted ? '[encrypted]' : (msg.body || '').substring(0, 120).replace(/\n/g, ' '));
      const entry: Record<string, unknown> = {
        message_id: msg.message_id,
        message_id_url: encodeURIComponent(msg.message_id || ''),
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        snippet,
        received_at: msg.received_at,
        read: msg.read,
        archived: isArchived,
      };
      if (msg.e2e_encrypted) entry.e2e_encrypted = true;
      if (msg.auth) entry.auth = msg.auth;
      messages.push(entry);
    }

    return json({ messages, has_more: hasMore, count: messages.length, address });
  }

  // GET /v1/email/messages/:id?address=...
  if (path.startsWith('/v1/email/messages/') && method === 'GET') {
    const msgId = decodeURIComponent(path.replace('/v1/email/messages/', ''));
    const address = url.searchParams.get('address');

    if (!address || !msgId) {
      return err('address and message_id required.', 400, 'missing_params');
    }

    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (!currentOwner || currentOwner !== account.id) {
      return err('Address not owned by this account.', 403, 'forbidden');
    }

    const indexKey = `index:${address}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    if (!indexRaw) return err('No inbox found for this address.', 404, 'not_found');

    const index = JSON.parse(indexRaw);
    const normalizedQuery = msgId.replace(/[<>]/g, '').trim();
    let foundKey: string | null = null;
    let foundMsg: StoredMessage | null = null;
    for (const key of index.slice(0, 50)) {
      const raw = await env.EMAILS.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredMessage;
      const normalizedStored = (parsed.message_id || '').replace(/[<>]/g, '').trim();
      if (normalizedStored === normalizedQuery || parsed.message_id === msgId) {
        foundKey = key;
        foundMsg = parsed;
        break;
      }
    }

    if (!foundMsg) return err('Message not found.', 404, 'not_found');

    foundMsg.read = true;
    await env.EMAILS.put(foundKey!, JSON.stringify(foundMsg), { expirationTtl: 30 * 24 * 3600 });

    if (foundMsg.e2e_encrypted) {
      return json({
        ...foundMsg,
        body_preview: undefined,
      });
    }

    const plainBody = await decryptEmailField(env, foundMsg.body || '', !!foundMsg.body_encrypted);
    return json({ ...foundMsg, body: plainBody, body_encrypted: undefined, body_preview: undefined });
  }

  // DELETE /v1/email/messages/:id?address=...
  if (path.startsWith('/v1/email/messages/') && method === 'DELETE') {
    const msgId = decodeURIComponent(path.replace('/v1/email/messages/', ''));
    const address = url.searchParams.get('address');

    if (!address || !msgId) {
      return err('address and message_id required.', 400, 'missing_params');
    }
    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (!currentOwner || currentOwner !== account.id) {
      return err('Address not owned by this account.', 403, 'forbidden');
    }

    const indexKey = `index:${address}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    if (!indexRaw) return err('No inbox found for this address.', 404, 'not_found');

    const index = JSON.parse(indexRaw);
    const normalizedQuery = msgId.replace(/[<>]/g, '').trim();
    let foundKey: string | null = null;
    for (const key of index.slice(0, 100)) {
      const raw = await env.EMAILS.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const normalizedStored = (parsed.message_id || '').replace(/[<>]/g, '').trim();
      if (normalizedStored === normalizedQuery || parsed.message_id === msgId) {
        foundKey = key;
        break;
      }
    }

    if (!foundKey) return err('Message not found.', 404, 'not_found');

    await env.EMAILS.delete(foundKey);
    const newIndex = index.filter((k: string) => k !== foundKey);
    await env.EMAILS.put(indexKey, JSON.stringify(newIndex), { expirationTtl: 30 * 24 * 3600 });

    return json({ deleted: true, message_id: msgId });
  }

  // PATCH /v1/email/messages/:id?address=... — update message (mark read/unread)
  if (path.startsWith('/v1/email/messages/') && method === 'PATCH') {
    const msgId = decodeURIComponent(path.replace('/v1/email/messages/', ''));
    const address = url.searchParams.get('address');
    let body: MessagePatchBody = {};
    try { body = (await request.json()) as MessagePatchBody; } catch { /* empty body OK */ }

    if (!address || !msgId) {
      return err('address and message_id required.', 400, 'missing_params');
    }
    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (!currentOwner || currentOwner !== account.id) {
      return err('Address not owned by this account.', 403, 'forbidden');
    }

    const indexKey = `index:${address}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    if (!indexRaw) return err('No inbox found.', 404, 'not_found');

    const index = JSON.parse(indexRaw);
    const normalizedQuery = msgId.replace(/[<>]/g, '').trim();
    let foundKey: string | null = null;
    let foundMsg: StoredMessage | null = null;
    for (const key of index.slice(0, 100)) {
      const raw = await env.EMAILS.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredMessage;
      const normalizedStored = (parsed.message_id || '').replace(/[<>]/g, '').trim();
      if (normalizedStored === normalizedQuery || parsed.message_id === msgId) {
        foundKey = key;
        foundMsg = parsed;
        break;
      }
    }

    if (!foundMsg) return err('Message not found.', 404, 'not_found');

    if (typeof body.read === 'boolean') foundMsg.read = body.read;
    if (typeof body.archived === 'boolean') foundMsg.archived = body.archived;

    await env.EMAILS.put(foundKey!, JSON.stringify(foundMsg), { expirationTtl: 30 * 24 * 3600 });
    return json({ updated: true, message_id: msgId, read: foundMsg.read, archived: foundMsg.archived });
  }

  // GET /v1/email/addresses — list claimed addresses for this account
  if (path === '/v1/email/addresses' && method === 'GET') {
    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    // Use per-account address index for instant consistency (KV list() is eventually consistent)
    const myAddresses = await getAccountAddresses(env, account.id);

    return json({
      addresses: myAddresses,
      count: myAddresses.length,
      note: 'Claimed @agentlair.dev addresses for your account.',
      how_to_claim: 'POST /v1/email/claim {"address":"yourname@agentlair.dev"} to register a new address.',
    });
  }

  // GET /v1/email/outbox?limit=20 — list sent messages
  if (path === '/v1/email/outbox' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    if (!env.EMAILS) {
      return err('Email storage not available.', 503, 'email_unavailable');
    }

    const list = await env.EMAILS.list({ prefix: `outbox:${account.id}:`, limit });
    const entries = await Promise.all(
      list.keys.map(async (k) => {
        const raw = await env.EMAILS.get(k.name);
        if (!raw) return null;
        const entry = JSON.parse(raw) as OutboxEntry;
        return {
          id: entry.id,
          from: entry.from,
          to: entry.to,
          subject: entry.subject,
          text: entry.text || null,
          status: entry.status,
          queued_at: entry.queued_at,
          sent_at: entry.sent_at || null,
          provider_id: entry.provider_id || null,
          error: entry.error || null,
        };
      }),
    );

    const filtered = entries.filter((e): e is NonNullable<typeof e> => e !== null).sort((a, b) =>
      new Date(b.queued_at).getTime() - new Date(a.queued_at).getTime(),
    );

    return json({
      messages: filtered,
      count: filtered.length,
      has_more: list.list_complete === false,
    });
  }

  // POST /v1/email/send — send email from an @agentlair.dev address
  if (path === '/v1/email/send' && method === 'POST') {
    let body: EmailSendBody = {};
    try { body = (await request.json()) as EmailSendBody; } catch {
      return err('Invalid JSON body', 400, 'invalid_body');
    }

    const { from, to, subject, text, html: htmlBody, in_reply_to, references: clientReferences, client_id } = body;

    if (!from || !to || !subject || (!text && !htmlBody)) {
      return err('Required: from, to, subject, and text or html', 400, 'missing_fields');
    }

    // Server-side header injection prevention — validate all header-injectable fields for CRLF
    if (typeof subject === 'string' && /[\r\n]/.test(subject)) {
      return err('Subject must not contain newline or carriage return characters.', 400, 'invalid_subject');
    }
    // Validate to field(s) for CRLF injection
    const toList = Array.isArray(to) ? to : [to];
    for (const addr of toList) {
      if (typeof addr === 'string' && /[\r\n]/.test(addr)) {
        return err('Recipient address must not contain newline or carriage return characters.', 400, 'invalid_to');
      }
    }
    // Validate in_reply_to and references for CRLF injection (header injection via threading headers)
    if (typeof in_reply_to === 'string' && /[\r\n]/.test(in_reply_to)) {
      return err('in_reply_to must not contain newline or carriage return characters.', 400, 'invalid_in_reply_to');
    }
    if (typeof clientReferences === 'string' && /[\r\n]/.test(clientReferences)) {
      return err('references must not contain newline or carriage return characters.', 400, 'invalid_references');
    }

    const fromAddr = String(from);
    if (!fromAddr.endsWith('@agentlair.dev') && !fromAddr.match(/<[^>]+@agentlair\.dev>/)) {
      return err('Sender must be an @agentlair.dev address', 403, 'invalid_sender');
    }

    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

    const normalizedFromAddr = fromAddr.match(/<([^>]+)>/) ? fromAddr.match(/<([^>]+)>/)![1] : fromAddr;
    const addrOwner = await env.EMAILS.get(`email-owner:${normalizedFromAddr}`);
    if (!addrOwner || addrOwner !== account.id) {
      return err('You do not own this sender address. Claim it first via POST /v1/email/claim.', 403, 'not_your_address');
    }

    // ── Restricted mode check ─────────────────────────────────────────────────
    // Accounts in restricted mode can only email their registered operator.
    if (account.status === 'restricted') {
      const operatorEmail = (account.operator_email || account.email) as string | undefined;
      const toAddrsForCheck = Array.isArray(to) ? to : [to];
      const allRecipientsAllowed = operatorEmail && toAddrsForCheck.every(
        (r) => typeof r === 'string' && r.toLowerCase() === operatorEmail.toLowerCase(),
      );
      if (!allRecipientsAllowed) {
        return err(
          'Account is in restricted mode. Outbound email is limited to your registered operator email. POST /v1/register/verify with your OTP to unlock.',
          403,
          'restricted_mode',
        );
      }
    }

    // ── Approval gate (P1 OWASP ASI01) ───────────────────────────────────────
    // Backward compat: keys without approval_required field default to false.
    // New keys default to approval_required: true — send saves as draft instead.
    const keyApprovalRequired = typeof account.approval_required === 'boolean' ? account.approval_required : false;
    if (keyApprovalRequired) {
      const toAddrsForDraft = Array.isArray(to) ? to : [to];
      const draftId = 'draft_' + nanoid(16);
      const nowDraft = new Date().toISOString();
      const draftKey = `draft:${account.id}:${draftId}`;

      const draft = {
        id: draftId,
        from: fromAddr,
        to: toAddrsForDraft,
        subject: subject || '',
        text: text || null,
        html: htmlBody || null,
        in_reply_to: in_reply_to || null,
        status: 'draft',
        created_at: nowDraft,
        updated_at: nowDraft,
        queued_by: 'approval_gate',
      };

      await env.EMAILS.put(draftKey, JSON.stringify(draft), { expirationTtl: 30 * 24 * 3600 });

      // Update draft index (newest first)
      const draftIndexKey = `draft-index:${account.id}`;
      const draftIndexRaw = await env.EMAILS.get(draftIndexKey);
      const draftIndex = draftIndexRaw ? JSON.parse(draftIndexRaw) : [];
      draftIndex.unshift(draftKey);
      await env.EMAILS.put(draftIndexKey, JSON.stringify(draftIndex.slice(0, 200)), { expirationTtl: 30 * 24 * 3600 });

      return json({
        status: 'queued_for_approval',
        draft_id: draftId,
        message: 'This email requires human approval. Use POST /v1/email/drafts/' + draftId + '/send to approve.',
      }, 202);
    }

    // ── Idempotency check ─────────────────────────────────────────────────────
    // client_id prevents duplicate emails on agent retries (network failures,
    // container restarts). Check BEFORE rate limits — replay is free.
    if (client_id !== undefined) {
      if (typeof client_id !== 'string' || client_id.length === 0 || client_id.length > 128) {
        return err('client_id must be a non-empty string of max 128 characters', 400, 'invalid_client_id');
      }
      const idemKey = `idempotency:${account.id}:${client_id}`;
      const cached = await env.EMAILS.get(idemKey);
      if (cached) {
        const cachedResponse = JSON.parse(cached);
        return json({ ...cachedResponse, idempotent_replayed: true }, 200);
      }
    }

    const emailRateCheck = await checkEmailRateLimit(env, account.id, account.tier || 'free', fromAddr);
    let paidViaX402 = false;
    let paidViaAgentKit = false;
    let agentkitHumanId: string | null = null;
    let agentkitUsageCount = 0;
    let x402PaymentHeader: string | null = null;
    let x402Payer: string | undefined;

    if (!emailRateCheck.allowed) {
      if (emailRateCheck.reason === 'address_suspended') {
        return new Response(JSON.stringify({
          error: emailRateCheck.reason,
          message: emailRateCheck.upgrade_hint || 'Address suspended.',
          limit: emailRateCheck.limit,
          reset_at: emailRateCheck.reset_at,
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ── AgentKit free-trial check ──────────────────────────────────────────
      // Human-verified agents (World ID) get free emails before x402 kicks in.
      // Check AgentKit BEFORE x402 payment — it's cheaper for the agent.
      const agentkitResult = await verifyAgentKit(request, env, '/v1/email/send');
      if (agentkitResult.verified) {
        if (agentkitResult.hasFreeUses) {
          // Human-verified agent with remaining free-trial — bypass payment
          paidViaAgentKit = true;
          agentkitHumanId = agentkitResult.humanId;
          agentkitUsageCount = agentkitResult.usageCount;
        }
        // If no free uses left, fall through to x402 payment below
      } else if (agentkitResult.reason !== 'no_header') {
        // AgentKit header was present but verification failed — tell the caller why
        return new Response(JSON.stringify({
          error: 'agentkit_verification_failed',
          reason: agentkitResult.reason,
          message: agentkitResult.reason === 'nonce_replay'
            ? 'This AgentKit nonce has already been used. Generate a fresh signature.'
            : agentkitResult.reason === 'not_registered'
            ? 'Agent wallet not registered in AgentBook. Register via: npx @worldcoin/agentkit-cli register <address>'
            : `AgentKit verification failed: ${('error' in agentkitResult && agentkitResult.error) || agentkitResult.reason}`,
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ── x402 payment check ─────────────────────────────────────────────────
      if (!paidViaAgentKit) {
        x402PaymentHeader = request.headers.get('X-PAYMENT');

        if (!x402PaymentHeader) {
          const retryAfter = emailRateCheck.reset_at
            ? String(Math.max(1, Math.floor((new Date(emailRateCheck.reset_at).getTime() - Date.now()) / 1000)))
            : '60';
          return new Response(JSON.stringify({
            ...EMAIL_PAYMENT_REQUIRED_RESPONSE,
            rate_limit: {
              reason: emailRateCheck.reason,
              limit: emailRateCheck.limit,
              reset_at: emailRateCheck.reset_at,
              upgrade_url: 'https://agentlair.dev/pricing',
            },
            agentkit: {
              hint: 'Human-verified agents get ' + AGENTKIT_FREE_TRIAL_USES + ' free emails. Pass X-AGENTKIT header with signed proof.',
              docs: 'https://docs.world.org/agents/agent-kit',
            },
          }), {
            status: 402,
            headers: {
              'Content-Type': 'application/json',
              'X-402-Version': String(X402_CONFIG.x402Version),
              'X-RateLimit-Limit': String(emailRateCheck.limit),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': emailRateCheck.reset_at || '',
              'Retry-After': retryAfter,
            },
          });
        }

        const verification = await verifyX402Payment(x402PaymentHeader);
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
                const capCheck = await checkSpendingCap(env, account.id, SERVICE_PRICES.email_send.amount, pod.spending_caps);
                if (!capCheck.allowed) {
                  const periodLabel = capCheck.exceeded || 'period';
                  const capUsdc = ((capCheck.cap || 0) / 1_000_000).toFixed(2);
                  const currentUsdc = ((capCheck.current || 0) / 1_000_000).toFixed(2);
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

        x402Payer = verification.payer;
        paidViaX402 = true;
      }
    }

    const toAddrs = Array.isArray(to) ? to : [to];
    if (toAddrs.length === 0) {
      return err('to must be a non-empty email address or array', 400, 'invalid_to');
    }
    const maxRecipients = account.tier === 'paid' ? 50 : 10;
    if (toAddrs.length > maxRecipients) {
      return err(`Too many recipients. Max ${maxRecipients} per send on ${account.tier} tier.`, 400, 'too_many_recipients');
    }

    const msgId = 'out_' + nanoid(16);
    const outboxTs = Date.now();
    const now = new Date(outboxTs).toISOString();
    const outboxKey = `outbox:${account.id}:${outboxTs}:${msgId}`;

    const outboxEntry: OutboxEntry = {
      id: msgId,
      from: fromAddr,
      to: toAddrs,
      subject: subject || '',
      text: text || null,
      html: htmlBody || null,
      in_reply_to: in_reply_to || null,
      queued_at: now,
      status: 'pending',
    };

    if (env.EMAILS) {
      await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), { expirationTtl: 30 * 24 * 3600 });
    }

    const provider = getEmailProvider(env);
    if (!provider) {
      return json({
        id: msgId,
        status: 'queued',
        warning: 'No email provider configured. Message stored in outbox but not sent.',
        setup: 'Set RESEND_API_KEY in Worker environment variables. See agentlair.dev/docs/email.',
      }, 202);
    }

    // Build References header for threaded replies
    let referencesHeader: string | undefined;
    if (in_reply_to && env.EMAILS) {
      try {
        // Look up the referenced message to get its References header chain
        const fromNorm = normalizedFromAddr;
        const indexKey = `index:${fromNorm}`;
        const indexRaw = await env.EMAILS.get(indexKey);
        if (indexRaw) {
          const indexEntries: string[] = JSON.parse(indexRaw);
          const normalizedReplyTo = in_reply_to.replace(/[<>]/g, '').trim();
          for (const key of indexEntries.slice(0, 100)) {
            const raw = await env.EMAILS.get(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            const parsedMsgId = (parsed.message_id || '').replace(/[<>]/g, '').trim();
            if (parsedMsgId === normalizedReplyTo) {
              // Found the referenced message — chain its References
              const existingRefs = parsed.references || '';
              const parts = existingRefs ? [existingRefs, in_reply_to] : [in_reply_to];
              // Deduplicate while preserving order
              const seen = new Set<string>();
              const dedupedParts: string[] = [];
              for (const p of parts) {
                const norm = p.replace(/[<>]/g, '').trim();
                if (!seen.has(norm)) { seen.add(norm); dedupedParts.push(p); }
              }
              referencesHeader = dedupedParts.join(' ');
              break;
            }
          }
        }
      } catch {
        // Non-fatal: fall back to in_reply_to as references
      }
      // Fallback: if we couldn't look up the chain, use caller-provided or just in_reply_to
      if (!referencesHeader) {
        referencesHeader = clientReferences || in_reply_to;
      }
    } else if (clientReferences) {
      referencesHeader = clientReferences;
    }

    try {
      const result = await provider.send({
        from: fromAddr,
        to: toAddrs,
        subject,
        text: text || undefined,
        html: htmlBody || undefined,
        in_reply_to: in_reply_to || undefined,
        references: referencesHeader,
      }, env);

      if (env.EMAILS) {
        outboxEntry.status = 'sent';
        outboxEntry.sent_at = new Date().toISOString();
        outboxEntry.provider = provider.name;
        outboxEntry.provider_id = result.provider_id;
        if (paidViaX402) outboxEntry.paid_via = 'x402';
        if (paidViaAgentKit) outboxEntry.paid_via = 'agentkit';
        await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), { expirationTtl: 30 * 24 * 3600 });
      }

      if (env.EMAILS) ctx.waitUntil(recordEmailSent(env, fromAddr));

      // Record AgentKit free-trial usage AFTER successful send
      if (paidViaAgentKit && agentkitHumanId) {
        ctx.waitUntil(recordAgentkitUsage(env, '/v1/email/send', agentkitHumanId));
      }

      const responseHeaders: Record<string, string> = {};
      if (paidViaX402 && x402PaymentHeader) {
        const settlement = await settleX402Payment(x402PaymentHeader);
        if (settlement.settled && settlement.receipt) {
          responseHeaders['X-Payment-Response'] = settlement.receipt;
        }
        // Track spend and auto-upgrade if threshold reached (fire-and-forget)
        try {
          const spend = await trackX402Spend(env, account.id, SERVICE_PRICES.email_send.amount, { payer: x402Payer, service: 'email_send' });
          await autoUpgradeIfThreshold(env, account, spend);
        } catch {
          // Non-critical — don't fail the send
        }
      }

      const responseBody: Record<string, unknown> = {
        id: msgId,
        provider_id: result.provider_id,
        provider: provider.name,
        status: 'sent',
        from: fromAddr,
        to: toAddrs,
        subject,
        sent_at: outboxEntry.sent_at,
        paid_via: paidViaX402 ? 'x402' : paidViaAgentKit ? 'agentkit' : undefined,
        rate_limit: (paidViaX402 || paidViaAgentKit)
          ? { note: paidViaAgentKit
              ? 'Sent via AgentKit human verification — free-trial access.'
              : 'Sent via x402 payment — rate limits bypassed.' }
          : {
              daily_remaining: emailRateCheck.daily_remaining,
              hourly_remaining: emailRateCheck.hourly_remaining,
              reset_at: emailRateCheck.reset_at,
            },
      };

      // Include AgentKit usage info in response so agents can track remaining free uses
      if (paidViaAgentKit && agentkitHumanId) {
        responseBody.agentkit = {
          human_verified: true,
          free_uses_remaining: Math.max(0, AGENTKIT_FREE_TRIAL_USES - agentkitUsageCount - 1),
          total_free_uses: AGENTKIT_FREE_TRIAL_USES,
        };
      }

      // Store idempotency record so retries with same client_id return cached response
      if (client_id && env.EMAILS) {
        const idemKey = `idempotency:${account.id}:${client_id}`;
        ctx.waitUntil(env.EMAILS.put(idemKey, JSON.stringify(responseBody), { expirationTtl: 24 * 3600 }));
      }

      return json(responseBody, 201, responseHeaders);

    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (env.EMAILS) {
        outboxEntry.status = 'failed';
        outboxEntry.error = message;
        outboxEntry.error_at = new Date().toISOString();
        await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), { expirationTtl: 30 * 24 * 3600 });
        if (message.toLowerCase().includes('bounce') || message.toLowerCase().includes('invalid') || message.toLowerCase().includes('reject')) {
          ctx.waitUntil(recordEmailBounce(env, fromAddr));
        }
      }
      return err(`Send failed: ${message}`, 502, 'send_failed');
    }
  }

  // ── Draft routes (HITL trust-calibration primitive) ─────────────────────────
  // Drafts let agents compose email without sending. Humans review and approve.
  // KV pattern:
  //   draft:{account.id}:{draftId}    → Draft JSON
  //   draft-index:{account.id}        → Array of draft keys (newest first)

  // POST /v1/email/drafts — compose a draft (save without sending)
  if (path === '/v1/email/drafts' && method === 'POST') {
    let body: EmailDraftBody = {};
    try { body = (await request.json()) as EmailDraftBody; } catch {
      return err('Invalid JSON body', 400, 'invalid_body');
    }

    const { from, to, subject, text, html: htmlBody, in_reply_to } = body;

    if (!from || !to || !subject) {
      return err('Required: from, to, subject', 400, 'missing_fields');
    }

    const fromAddr = String(from);
    if (!fromAddr.endsWith('@agentlair.dev') && !fromAddr.match(/<[^>]+@agentlair\.dev>/)) {
      return err('Sender must be an @agentlair.dev address', 403, 'invalid_sender');
    }

    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

    const normalizedFromAddr = fromAddr.match(/<([^>]+)>/) ? fromAddr.match(/<([^>]+)>/)![1] : fromAddr;
    const addrOwner = await env.EMAILS.get(`email-owner:${normalizedFromAddr}`);
    if (!addrOwner || addrOwner !== account.id) {
      return err('You do not own this sender address. Claim it first via POST /v1/email/claim.', 403, 'not_your_address');
    }

    // ── Restricted mode check (drafts) ────────────────────────────────────────
    if (account.status === 'restricted') {
      const operatorEmail = (account.operator_email || account.email) as string | undefined;
      const toAddrsForCheck = Array.isArray(to) ? to : [to];
      const allRecipientsAllowed = operatorEmail && toAddrsForCheck.every(
        (r) => typeof r === 'string' && r.toLowerCase() === operatorEmail.toLowerCase(),
      );
      if (!allRecipientsAllowed) {
        return err(
          'Account is in restricted mode. Outbound email is limited to your registered operator email. POST /v1/register/verify with your OTP to unlock.',
          403,
          'restricted_mode',
        );
      }
    }

    const toAddrs = Array.isArray(to) ? to : [to];
    if (toAddrs.length === 0) {
      return err('to must be a non-empty email address or array', 400, 'invalid_to');
    }
    const maxRecipients = account.tier === 'paid' ? 50 : 10;
    if (toAddrs.length > maxRecipients) {
      return err(`Too many recipients. Max ${maxRecipients} per draft on ${account.tier} tier.`, 400, 'too_many_recipients');
    }

    const draftId = 'draft_' + nanoid(16);
    const now = new Date().toISOString();
    const draftKey = `draft:${account.id}:${draftId}`;

    const draft = {
      id: draftId,
      from: fromAddr,
      to: toAddrs,
      subject,
      text: text || null,
      html: htmlBody || null,
      in_reply_to: in_reply_to || null,
      status: 'draft',
      created_at: now,
      updated_at: now,
    };

    await env.EMAILS.put(draftKey, JSON.stringify(draft), { expirationTtl: 30 * 24 * 3600 });

    // Update draft index (newest first)
    const indexKey = `draft-index:${account.id}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    const index = indexRaw ? JSON.parse(indexRaw) : [];
    index.unshift(draftKey);
    const trimmedIndex = index.slice(0, 200);
    await env.EMAILS.put(indexKey, JSON.stringify(trimmedIndex), { expirationTtl: 30 * 24 * 3600 });

    return json(draft, 201);
  }

  // GET /v1/email/drafts — list drafts for this account
  if (path === '/v1/email/drafts' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

    const indexKey = `draft-index:${account.id}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    if (!indexRaw) {
      return json({ drafts: [], count: 0, has_more: false });
    }

    const index = JSON.parse(indexRaw);
    const pageKeys = index.slice(0, limit);
    const hasMore = index.length > limit;

    const drafts = await Promise.all(
      pageKeys.map(async (key: string) => {
        const raw = await env.EMAILS.get(key);
        if (!raw) return null;
        return JSON.parse(raw);
      }),
    );

    const filtered = drafts.filter(Boolean);
    return json({ drafts: filtered, count: filtered.length, has_more: hasMore });
  }

  // POST /v1/email/drafts/:id/send — approve + send a draft
  const draftSendMatch = path.match(/^\/v1\/email\/drafts\/([^/]+)\/send$/);
  if (draftSendMatch && method === 'POST') {
    const draftId = draftSendMatch[1];

    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

    const draftKey = `draft:${account.id}:${draftId}`;
    const draftRaw = await env.EMAILS.get(draftKey);
    if (!draftRaw) return err('Draft not found.', 404, 'not_found');

    const draft = JSON.parse(draftRaw);

    // Verify ownership (key already scoped to account.id, but double-check)
    if (draft.status !== 'draft') {
      return err(`Draft is not in draft status (current: ${draft.status}).`, 409, 'invalid_status');
    }

    const emailRateCheck = await checkEmailRateLimit(env, account.id, account.tier || 'free', draft.from);
    if (!emailRateCheck.allowed) {
      return err(emailRateCheck.upgrade_hint || 'Email rate limit exceeded.', 429, 'rate_limited');
    }

    const msgId = 'out_' + nanoid(16);
    const outboxTs = Date.now();
    const now = new Date(outboxTs).toISOString();
    const outboxKey = `outbox:${account.id}:${outboxTs}:${msgId}`;

    const outboxEntry: OutboxEntry = {
      id: msgId,
      from: draft.from,
      to: draft.to,
      subject: draft.subject,
      text: draft.text || null,
      html: draft.html || null,
      in_reply_to: draft.in_reply_to || null,
      draft_id: draftId,
      queued_at: now,
      status: 'pending',
    };

    await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), { expirationTtl: 30 * 24 * 3600 });

    const provider = getEmailProvider(env);
    if (!provider) {
      // Mark draft as queued (no provider configured)
      draft.status = 'queued';
      draft.updated_at = now;
      await env.EMAILS.put(draftKey, JSON.stringify(draft), { expirationTtl: 30 * 24 * 3600 });
      return json({
        id: msgId,
        draft_id: draftId,
        status: 'queued',
        warning: 'No email provider configured. Message stored in outbox but not sent.',
      }, 202);
    }

    try {
      const result = await provider.send({
        from: draft.from,
        to: draft.to,
        subject: draft.subject,
        text: draft.text || undefined,
        html: draft.html || undefined,
        in_reply_to: draft.in_reply_to || undefined,
      }, env);

      outboxEntry.status = 'sent';
      outboxEntry.sent_at = new Date().toISOString();
      outboxEntry.provider = provider.name;
      outboxEntry.provider_id = result.provider_id;
      await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), { expirationTtl: 30 * 24 * 3600 });

      // Delete draft from index and KV
      await env.EMAILS.delete(draftKey);
      const indexKey = `draft-index:${account.id}`;
      const indexRaw = await env.EMAILS.get(indexKey);
      if (indexRaw) {
        const index = JSON.parse(indexRaw);
        const newIndex = index.filter((k: string) => k !== draftKey);
        await env.EMAILS.put(indexKey, JSON.stringify(newIndex), { expirationTtl: 30 * 24 * 3600 });
      }

      ctx.waitUntil(recordEmailSent(env, draft.from));

      return json({
        id: msgId,
        provider_id: result.provider_id,
        provider: provider.name,
        status: 'sent',
        draft_id: draftId,
        from: draft.from,
        to: draft.to,
        subject: draft.subject,
        sent_at: outboxEntry.sent_at,
      }, 200);

    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      outboxEntry.status = 'failed';
      outboxEntry.error = message;
      outboxEntry.error_at = new Date().toISOString();
      await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), { expirationTtl: 30 * 24 * 3600 });
      if (message.toLowerCase().includes('bounce') || message.toLowerCase().includes('invalid') || message.toLowerCase().includes('reject')) {
        ctx.waitUntil(recordEmailBounce(env, draft.from));
      }
      return err(`Send failed: ${message}`, 502, 'send_failed');
    }
  }

  // DELETE /v1/email/drafts/:id — discard a draft
  const draftDeleteMatch = path.match(/^\/v1\/email\/drafts\/([^/]+)$/);
  if (draftDeleteMatch && method === 'DELETE') {
    const draftId = draftDeleteMatch[1];

    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

    const draftKey = `draft:${account.id}:${draftId}`;
    const draftRaw = await env.EMAILS.get(draftKey);
    if (!draftRaw) return err('Draft not found.', 404, 'not_found');

    await env.EMAILS.delete(draftKey);

    const indexKey = `draft-index:${account.id}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    if (indexRaw) {
      const index = JSON.parse(indexRaw);
      const newIndex = index.filter((k: string) => k !== draftKey);
      await env.EMAILS.put(indexKey, JSON.stringify(newIndex), { expirationTtl: 30 * 24 * 3600 });
    }

    return json({ deleted: true, draft_id: draftId });
  }

  // GET /v1/email/threads?address=...&limit=20 — list threads for an inbox
  if (path === '/v1/email/threads' && method === 'GET') {
    const address = url.searchParams.get('address');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    if (!address) {
      return err('address query parameter required. Example: ?address=myagent@agentlair.dev', 400, 'missing_address');
    }
    if (!address.endsWith('@agentlair.dev')) {
      return err('Only @agentlair.dev addresses supported in beta.', 400, 'invalid_address');
    }
    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (!currentOwner || currentOwner !== account.id) {
      return err('Address not owned by this account.', 403, 'address_not_yours');
    }

    const indexKey = `index:${address}`;
    const indexRaw = await env.EMAILS.get(indexKey);
    if (!indexRaw) {
      return json({ threads: [], count: 0, has_more: false, address });
    }

    const index: string[] = JSON.parse(indexRaw);

    // Walk address index, group messages by thread_id
    const threadMap = new Map<string, { thread_id: string; subject: string; last_message_at: string; message_count: number; participants: Set<string>; snippet: string }>();
    const threadOrder: string[] = []; // track insertion order (newest first already from index)

    for (const key of index) {
      const raw = await env.EMAILS.get(key);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      const tid = msg.thread_id || msg.message_id || key;
      const snippet = msg.body_preview !== undefined
        ? msg.body_preview
        : (msg.body_encrypted ? '[encrypted]' : (msg.body || '').substring(0, 120).replace(/\n/g, ' '));

      if (!threadMap.has(tid)) {
        threadMap.set(tid, {
          thread_id: tid,
          subject: msg.subject || '',
          last_message_at: msg.received_at,
          message_count: 1,
          participants: new Set([msg.from, msg.to].filter(Boolean)),
          snippet,
        });
        threadOrder.push(tid);
      } else {
        const existing = threadMap.get(tid)!;
        existing.message_count++;
        if (msg.from) existing.participants.add(msg.from);
        if (msg.to) existing.participants.add(msg.to);
        // index is newest-first so last_message_at is already set from first occurrence
      }
    }

    const paginated = threadOrder.slice(0, limit);
    const hasMore = threadOrder.length > limit;

    const threads = paginated.map(tid => {
      const t = threadMap.get(tid)!;
      return {
        thread_id: t.thread_id,
        subject: t.subject,
        last_message_at: t.last_message_at,
        message_count: t.message_count,
        participants: Array.from(t.participants),
        snippet: t.snippet,
      };
    });

    return json({ threads, count: threads.length, has_more: hasMore, address });
  }

  // GET /v1/email/threads/:thread_id?address=... — get all messages in a thread
  const threadMsgMatch = path.match(/^\/v1\/email\/threads\/(.+)$/);
  if (threadMsgMatch && method === 'GET') {
    const threadId = decodeURIComponent(threadMsgMatch[1]);
    const address = url.searchParams.get('address');

    if (!address) {
      return err('address query parameter required.', 400, 'missing_address');
    }
    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (!currentOwner || currentOwner !== account.id) {
      return err('Address not owned by this account.', 403, 'address_not_yours');
    }

    // Try thread index first (efficient)
    const threadIdxKey = `thread-idx:${address}:${threadId}`;
    const threadIdxRaw = await env.EMAILS.get(threadIdxKey);
    let msgKeys: string[] = [];

    if (threadIdxRaw) {
      msgKeys = JSON.parse(threadIdxRaw);
    } else {
      // Fallback: scan address index (backward compat for messages stored before threading)
      const indexKey = `index:${address}`;
      const indexRaw = await env.EMAILS.get(indexKey);
      if (indexRaw) {
        const index: string[] = JSON.parse(indexRaw);
        for (const key of index) {
          const raw = await env.EMAILS.get(key);
          if (!raw) continue;
          const msg = JSON.parse(raw);
          const tid = msg.thread_id || msg.message_id || '';
          if (tid === threadId) {
            msgKeys.push(key);
          }
        }
      }
    }

    if (msgKeys.length === 0) {
      return err('Thread not found.', 404, 'not_found');
    }

    // Load all messages; thread index is newest-first, so reverse for chronological order
    const messages = (await Promise.all(msgKeys.map(async (key: string) => {
      const raw = await env.EMAILS.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    }))).filter(Boolean);

    // Sort oldest-first for reading
    messages.sort((a, b) =>
      new Date(String(a.received_at || '')).getTime() - new Date(String(b.received_at || '')).getTime()
    );

    return json({ thread_id: threadId, messages, count: messages.length });
  }

  // Catch-all for /v1/email/* (before /v1/inbox handling below)
  if (path.startsWith('/v1/email')) {
    return json({
      available: [
        'POST /v1/email/claim — register an @agentlair.dev address to your account',
        'GET /v1/email/addresses — list your claimed addresses',
        'GET /v1/email/inbox?address={addr}&limit={n} — read inbox (address must be claimed first)',
        'GET /v1/email/messages/{id}?address={addr} — read + mark as read',
        'PATCH /v1/email/messages/{id}?address={addr} — update (body: {"read":true})',
        'DELETE /v1/email/messages/{id}?address={addr} — delete message',
        'POST /v1/email/send — send from @agentlair.dev address',
        'GET /v1/email/outbox?limit={n} — list sent messages',
        'GET /v1/email/threads?address={addr}&limit={n} — list conversation threads',
        'GET /v1/email/threads/{thread_id}?address={addr} — get all messages in a thread',
        'POST /v1/email/drafts — compose a draft (save without sending)',
        'GET /v1/email/drafts?limit={n} — list your drafts',
        'POST /v1/email/drafts/{id}/send — approve and send a draft',
        'DELETE /v1/email/drafts/{id} — discard a draft',
        'POST /v1/email/webhooks — register webhook for real-time email notifications',
        'GET /v1/email/webhooks?address={addr} — list webhooks for your account',
        'DELETE /v1/email/webhooks/{id} — remove a webhook',
      ],
      note: 'Use POST /v1/email/claim to register an @agentlair.dev address before accessing its inbox.',
    }, 200);
  }

  // ── /v1/inbox/* routes (v0.2 API) ───────────────────────────────────────────

  // POST /v1/inbox — create inbox
  if (path === '/v1/inbox' && method === 'POST') {
    let body: InboxCreateBody = {};
    try { body = (await request.json()) as InboxCreateBody; } catch { /* empty body OK */ }
    const slug = body.name || nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
    const address = slug.includes('@') ? slug : `${slug}@agentlair.dev`;
    if (!address.endsWith('@agentlair.dev')) {
      return err('Only @agentlair.dev addresses can be created.', 400, 'invalid_address');
    }
    if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
    // H1 fix: unified error for reserved and already-claimed (prevent enumeration)
    if (isReservedAddress(address)) return err('This address is not available.', 409, 'address_unavailable');
    const ownerKey = `email-owner:${address}`;
    const currentOwner = await env.EMAILS.get(ownerKey);
    if (currentOwner && currentOwner !== account.id) {
      return err('This address is not available.', 409, 'address_unavailable');
    }
    if (!currentOwner) await env.EMAILS.put(ownerKey, account.id);
    return json({ address, created: true, already_owned: !!currentOwner, account_id: account.id }, currentOwner ? 200 : 201);
  }

  // GET/POST /v1/inbox/:address[/*] — v0.2 inbox access
  const inboxMatch = path.match(/^\/v1\/inbox\/([^/]+@agentlair\.dev)(\/.*)?$/);
  if (inboxMatch) {
    const inboxAddr = decodeURIComponent(inboxMatch[1]);
    const subPath = inboxMatch[2] || '';

    if (method === 'GET' && subPath === '') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
      const unreadOnly = url.searchParams.get('unread') === 'true';
      if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
      const ownerKey = `email-owner:${inboxAddr}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      // M4 fix: no auto-claim on GET. Must explicitly POST /v1/email/claim first.
      // H1 fix: unified error for unclaimed/reserved/other-owner (prevent enumeration).
      if (!currentOwner) {
        return err('This address is not claimed. Use POST /v1/email/claim to register it first.', 404, 'address_not_claimed');
      } else if (currentOwner !== account.id) return err('This address is not available.', 409, 'address_unavailable');
      const indexKey = `index:${inboxAddr}`;
      const indexRaw = await env.EMAILS.get(indexKey);
      if (!indexRaw) return json({ messages: [], total: 0, address: inboxAddr });
      const index = JSON.parse(indexRaw);
      const pageKeys = index.slice(0, limit);
      const messages = (await Promise.all(pageKeys.map(async (key: string) => {
        const raw = await env.EMAILS.get(key);
        if (!raw) return null;
        const msg = JSON.parse(raw);
        if (unreadOnly && msg.read) return null;
        const preview = msg.body_preview !== undefined
          ? msg.body_preview
          : (msg.body_encrypted ? '[encrypted]' : (msg.body || '').substring(0, 120).replace(/\n/g, ' '));
        return { id: msg.message_id, from: msg.from, subject: msg.subject, preview, received_at: msg.received_at, read: !!msg.read };
      }))).filter(Boolean);
      return json({ messages, total: messages.length, address: inboxAddr });
    }

    const msgMatch = subPath.match(/^\/messages\/(.+)$/);
    if (method === 'GET' && msgMatch) {
      const msgId = decodeURIComponent(msgMatch[1]);
      if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
      const ownerKey = `email-owner:${inboxAddr}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (!currentOwner || currentOwner !== account.id) return err('Address not owned by this account.', 403, 'address_not_yours');
      const msgKey = `msg:${inboxAddr}:${msgId}`;
      const raw = await env.EMAILS.get(msgKey);
      if (!raw) return err('Message not found.', 404, 'not_found');
      const msg = JSON.parse(raw);
      if (!msg.read) {
        msg.read = true;
        await env.EMAILS.put(msgKey, JSON.stringify(msg));
      }
      if (msg.e2e_encrypted) {
        return json({
          id: msg.message_id, from: msg.from, to: msg.to, subject: msg.subject,
          body: msg.body,
          e2e_encrypted: true,
          ephemeral_public_key: msg.ephemeral_public_key,
          html: msg.html || null,
          received_at: msg.received_at,
          headers: msg.headers || {},
        });
      }
      const plainBody = await decryptEmailField(env, msg.body, msg.body_encrypted);
      return json({ id: msg.message_id, from: msg.from, to: msg.to, subject: msg.subject, body: plainBody, html: msg.html || null, received_at: msg.received_at, headers: msg.headers || {} });
    }

    if (method === 'POST' && subPath === '/send') {
      let body: Record<string, unknown> = {};
      try { body = (await request.json()) as Record<string, unknown>; } catch { /* empty body OK */ }
      body.from = inboxAddr;
      const { to, subject, body: emailBody, html, reply_to } = body as { to?: string; subject?: string; body?: string; html?: string; reply_to?: string };
      if (!to || !subject) return err('to and subject required.', 400, 'missing_params');
      if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
      const ownerKey = `email-owner:${inboxAddr}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (!currentOwner || currentOwner !== account.id) return err('You do not own this address.', 403, 'address_not_yours');
      const resendKey = env.RESEND_API_KEY;
      if (!resendKey) return err('Email sending not configured.', 503, 'send_unavailable');
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: inboxAddr, to: Array.isArray(to) ? to : [to], subject, text: emailBody || '', html: html || undefined, reply_to: reply_to || undefined }),
        });
        const result = (await resp.json()) as { message?: string; id?: string };
        if (!resp.ok) return err(result.message || 'Send failed', resp.status, 'send_failed');
        return json({ sent: true, id: result.id, from: inboxAddr, to, subject }, 200);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return err(`Send failed: ${message}`, 502, 'send_failed');
      }
    }
  }

  return null; // no email route matched
}
