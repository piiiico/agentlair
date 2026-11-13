// ─── Discovery Routes ──────────────────────────────────────────────────────────
//
// Public agent lookup endpoint — no API key required. Callers pay 0.005 USDC via x402.
//
// GET /v1/agents/lookup — resolve agent identity by handle, email, or account ID
//
// Query parameters (exactly one required):
//   handle=<name>       — agent name (handle part of @agentlair.dev address)
//   email=<email>       — full @agentlair.dev email address
//   id=<acc_...>        — AgentLair account ID
//
// Returns public agent info: id, name, email, DID, JWKS URL, registered_at, verified.
//
// Mounted in index.ts BEFORE the /v1/* auth middleware so any caller can access.
// Always requires x402 payment (no free tier — payment IS the authentication).

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv } from '../types.js';
import { verifyX402Only, settleOnDelivery, SERVICE_PRICES } from '../x402.js';
import { DEMO_AGENT_ID, demoAgentLookupRecord } from '../demo-records.js';

export const discoveryRoutes = new Hono<HonoEnv>();

// ─── Validation ───────────────────────────────────────────────────────────────

const ACCOUNT_ID_RE = /^acc_[A-Za-z0-9_-]{1,64}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;
const EMAIL_RE = /^[a-z0-9][a-z0-9._-]{0,61}@agentlair\.dev$/i;

// ─── Account field interface (subset we care about) ───────────────────────────

interface AccountRecord {
  id: string;
  name?: string;
  email?: string;
  created_at?: string;
  registered_at?: string;
  tier?: string;
  [key: string]: unknown;
}

// ─── GET /v1/agents/lookup ────────────────────────────────────────────────────

discoveryRoutes.get('/lookup', async (c) => {
  // ── x402 payment: verify now, settle only on delivery (a miss never charges) ─
  const paid = await verifyX402Only(c.req.header('X-PAYMENT'), SERVICE_PRICES.agent_lookup, 'agent_lookup');
  if (paid instanceof Response) return paid;
  const deliver = (res: Response) => settleOnDelivery(c.env, (p) => c.executionCtx.waitUntil(p), paid, res);

  // ── Resolve agent ID from query params ────────────────────────────────────────
  const handle = c.req.query('handle');
  const email = c.req.query('email');
  const id = c.req.query('id');

  // Exactly one query param required
  const paramCount = [handle, email, id].filter(Boolean).length;
  if (paramCount === 0) {
    return err(
      'One of: handle, email, or id query parameter is required.',
      400,
      'missing_query_param',
    );
  }
  if (paramCount > 1) {
    return err(
      'Only one of: handle, email, or id may be specified at a time.',
      400,
      'ambiguous_query',
    );
  }

  if (id === DEMO_AGENT_ID) return deliver(json(demoAgentLookupRecord()));

  let resolvedAccountId: string | null = null;

  if (id) {
    // Direct account ID lookup
    if (!ACCOUNT_ID_RE.test(id)) {
      return err('Invalid id format. Expected: acc_<alphanumeric>.', 400, 'invalid_id');
    }
    // Verify the account exists
    const keyHash = await c.env.KEYS.get('account:' + id);
    if (!keyHash) {
      return err('Agent not found.', 404, 'agent_not_found');
    }
    resolvedAccountId = id;
  } else if (handle) {
    // Handle → email → account ID
    if (!HANDLE_RE.test(handle)) {
      return err('Invalid handle format. Use lowercase letters, numbers, and hyphens only.', 400, 'invalid_handle');
    }
    const emailAddress = `${handle}@agentlair.dev`;
    resolvedAccountId = await c.env.EMAILS.get('email-owner:' + emailAddress);
    if (!resolvedAccountId) {
      return err('Agent not found.', 404, 'agent_not_found');
    }
  } else if (email) {
    // Email lookup — must be @agentlair.dev
    const normalizedEmail = email.toLowerCase().trim();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return err('email must be a valid @agentlair.dev address.', 400, 'invalid_email');
    }
    resolvedAccountId = await c.env.EMAILS.get('email-owner:' + normalizedEmail);
    if (!resolvedAccountId) {
      return err('Agent not found.', 404, 'agent_not_found');
    }
  }

  if (!resolvedAccountId) {
    return err('Agent not found.', 404, 'agent_not_found');
  }

  // ── Fetch account record ─────────────────────────────────────────────────────
  let account: AccountRecord | null = null;
  try {
    const keyHash = await c.env.KEYS.get('account:' + resolvedAccountId);
    if (keyHash) {
      const raw = await c.env.KEYS.get('key:' + keyHash);
      if (raw) {
        account = JSON.parse(raw) as AccountRecord;
      }
    }
  } catch {
    return err('Failed to retrieve agent record.', 500, 'lookup_error');
  }

  if (!account) {
    return err('Agent not found.', 404, 'agent_not_found');
  }

  // ── Check for active signing key ─────────────────────────────────────────────
  let jwksUrl: string | undefined;
  let verified = false;
  try {
    const keyIndex = await c.env.KEYS.get('signing-key-by-account:' + resolvedAccountId);
    if (keyIndex) {
      const { keyid } = JSON.parse(keyIndex) as { keyid: string };
      if (keyid) {
        const keyRecord = await c.env.KEYS.get('signing-key:' + keyid);
        if (keyRecord) {
          const parsed = JSON.parse(keyRecord) as { status?: string };
          if (parsed.status === 'active') {
            jwksUrl = `https://agentlair.dev/agents/${resolvedAccountId}/.well-known/jwks.json`;
            verified = true;
          }
        }
      }
    }
  } catch { /* fail-open — signing key lookup is best-effort */ }

  // ── Build public response (no sensitive fields) ───────────────────────────────
  const did = `did:web:agentlair.dev:agents:${resolvedAccountId}`;
  const agentEmail = account.email ?? (account.name ? `${account.name}@agentlair.dev` : undefined);
  const registeredAt = account.registered_at ?? account.created_at ?? undefined;

  const response: Record<string, unknown> = {
    id: resolvedAccountId,
    did,
  };

  if (account.name) response.name = account.name;
  if (agentEmail) response.email = agentEmail;
  if (jwksUrl) response.jwks_url = jwksUrl;
  if (registeredAt) response.registered_at = registeredAt;
  response.verified = verified;

  return deliver(json(response));
});
