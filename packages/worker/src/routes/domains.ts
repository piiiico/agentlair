// ─── Custom Domain Routes ─────────────────────────────────────────────────────
// Handles: /v1/email/domains/* (register, verify, list, delete custom domains)
//
// Custom domains allow agents to receive and send email at their own domain
// (e.g. commit@getcommit.dev) instead of only @agentlair.dev.
//
// Flow:
// 1. POST /v1/email/domains — register domain, get verification token
// 2. Add TXT record: _agentlair-verify.{domain} → agentlair-site-verification={token}
// 3. POST /v1/email/domains/{domain}/verify — verify TXT record via DoH
// 4. POST /v1/email/claim {"address": "you@yourdomain.com"} — claim address
//
// For inbound: domain owner configures Cloudflare Email Routing catch-all → AgentLair worker
// For outbound: domain must be verified in Resend (DKIM/SPF) — contact support or use API

import { nanoid, json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';

// ─── Data model ───────────────────────────────────────────────────────────────
// KV keys:
//   domain:{domain}              → DomainEntry JSON
//   account-domains:{account_id} → string[] of domain names

export interface DomainEntry {
  domain: string;
  account_id: string;
  verified: boolean;
  verification_token: string;
  created_at: string;
  verified_at: string | null;
}

// ─── DNS over HTTPS lookup ────────────────────────────────────────────────────
// Uses Cloudflare's DoH resolver to check TXT records. Works inside CF Workers
// without any special bindings.

interface DohResponse {
  Answer?: Array<{ type: number; data: string }>;
}

async function lookupTxtRecords(name: string): Promise<string[]> {
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
      { headers: { Accept: 'application/dns-json' } },
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as DohResponse;
    if (!data.Answer) return [];
    return data.Answer
      .filter((a) => a.type === 16) // TXT record type
      .map((a) => a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '')); // strip DNS quoting
  } catch {
    return [];
  }
}

// ─── Account domain index ─────────────────────────────────────────────────────

async function getAccountDomains(env: Env, accountId: string): Promise<string[]> {
  const raw = await env.EMAILS.get(`account-domains:${accountId}`);
  return raw ? JSON.parse(raw) : [];
}

async function addToAccountDomains(env: Env, accountId: string, domain: string): Promise<void> {
  const domains = await getAccountDomains(env, accountId);
  if (!domains.includes(domain)) {
    domains.push(domain);
    await env.EMAILS.put(`account-domains:${accountId}`, JSON.stringify(domains));
  }
}

async function removeFromAccountDomains(env: Env, accountId: string, domain: string): Promise<void> {
  const domains = await getAccountDomains(env, accountId);
  const filtered = domains.filter((d) => d !== domain);
  await env.EMAILS.put(`account-domains:${accountId}`, JSON.stringify(filtered));
}

// ─── Exported helpers (used by email.ts) ──────────────────────────────────────

/** Check if a domain is verified for a specific account */
export async function isVerifiedDomainForAccount(env: Env, domain: string, accountId: string): Promise<boolean> {
  const raw = await env.EMAILS.get(`domain:${domain}`);
  if (!raw) return false;
  const entry = JSON.parse(raw) as DomainEntry;
  return entry.verified && entry.account_id === accountId;
}

/** Check if an email address is on a valid domain for the account
 *  (either @agentlair.dev or a verified custom domain) */
export async function isValidDomainForAccount(env: Env, address: string, accountId: string): Promise<boolean> {
  if (address.endsWith('@agentlair.dev')) return true;
  const domain = address.split('@')[1];
  if (!domain) return false;
  return isVerifiedDomainForAccount(env, domain, accountId);
}

/** Check if an address belongs to a verified custom domain (any account) */
export async function isCustomDomainAddress(env: Env, address: string): Promise<boolean> {
  const domain = address.split('@')[1];
  if (!domain || domain === 'agentlair.dev') return false;
  const raw = await env.EMAILS.get(`domain:${domain}`);
  if (!raw) return false;
  const entry = JSON.parse(raw) as DomainEntry;
  return entry.verified;
}

// ─── Domain validation ────────────────────────────────────────────────────────

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const BLOCKED_DOMAINS = new Set([
  'agentlair.dev',
  'agentlair.com',
  // Common public email providers — custom domain feature is for owned domains
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com',
  'icloud.com', 'protonmail.com', 'proton.me',
]);

// ─── Route handler ────────────────────────────────────────────────────────────

export async function handleDomainRoutes(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  { path, method, account }: RouteContext,
): Promise<Response | null> {
  if (!account) return null;
  if (!path.startsWith('/v1/email/domains')) return null;
  if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

  // ── POST /v1/email/domains — register a new custom domain ─────────────────
  if (path === '/v1/email/domains' && method === 'POST') {
    let body: { domain?: string } = {};
    try {
      body = (await request.json()) as { domain?: string };
    } catch {
      /* empty body OK */
    }

    const domain = body.domain?.toLowerCase().trim();
    if (!domain) return err('domain required. Example: {"domain": "yourdomain.com"}', 400, 'missing_domain');

    if (!DOMAIN_REGEX.test(domain)) {
      return err('Invalid domain format. Example: yourdomain.com', 400, 'invalid_domain');
    }

    if (BLOCKED_DOMAINS.has(domain)) {
      return err('This domain cannot be registered.', 400, 'reserved_domain');
    }

    // Check if already registered
    const existing = await env.EMAILS.get(`domain:${domain}`);
    if (existing) {
      const entry = JSON.parse(existing) as DomainEntry;
      if (entry.account_id !== account.id) {
        return err('This domain is registered to another account.', 409, 'domain_taken');
      }
      // Return existing entry with setup instructions
      return json({
        domain: entry.domain,
        verified: entry.verified,
        verification_token: entry.verification_token,
        dns_setup: buildDnsSetup(entry.domain, entry.verification_token),
        created_at: entry.created_at,
        verified_at: entry.verified_at,
      });
    }

    // Limit: 5 domains per account (generous for now)
    const accountDomains = await getAccountDomains(env, account.id);
    if (accountDomains.length >= 5) {
      return err('Domain limit reached (5 domains per account).', 403, 'domain_limit');
    }

    // Create domain entry
    const token = nanoid(32);
    const entry: DomainEntry = {
      domain,
      account_id: account.id,
      verified: false,
      verification_token: token,
      created_at: new Date().toISOString(),
      verified_at: null,
    };

    await env.EMAILS.put(`domain:${domain}`, JSON.stringify(entry));
    await addToAccountDomains(env, account.id, domain);

    return json(
      {
        domain,
        verified: false,
        verification_token: token,
        dns_setup: buildDnsSetup(domain, token),
        created_at: entry.created_at,
      },
      201,
    );
  }

  // ── GET /v1/email/domains — list domains for this account ─────────────────
  if (path === '/v1/email/domains' && method === 'GET') {
    const domainNames = await getAccountDomains(env, account.id);
    const entries: Array<{
      domain: string;
      verified: boolean;
      created_at: string;
      verified_at: string | null;
    }> = [];

    for (const d of domainNames) {
      const raw = await env.EMAILS.get(`domain:${d}`);
      if (raw) {
        const e = JSON.parse(raw) as DomainEntry;
        entries.push({
          domain: e.domain,
          verified: e.verified,
          created_at: e.created_at,
          verified_at: e.verified_at,
        });
      }
    }

    return json({ domains: entries, count: entries.length });
  }

  // ── POST /v1/email/domains/:domain/verify — verify TXT record ────────────
  const verifyMatch = path.match(/^\/v1\/email\/domains\/([^/]+)\/verify$/);
  if (verifyMatch && method === 'POST') {
    const domain = decodeURIComponent(verifyMatch[1]).toLowerCase();

    const raw = await env.EMAILS.get(`domain:${domain}`);
    if (!raw) return err('Domain not registered. POST /v1/email/domains first.', 404, 'domain_not_found');

    const entry = JSON.parse(raw) as DomainEntry;
    if (entry.account_id !== account.id) {
      return err('Domain not found.', 404, 'domain_not_found');
    }

    if (entry.verified) {
      return json({ domain, verified: true, already_verified: true, verified_at: entry.verified_at });
    }

    // Look up TXT record via DoH
    const expectedValue = `agentlair-site-verification=${entry.verification_token}`;
    const txtRecords = await lookupTxtRecords(`_agentlair-verify.${domain}`);
    const found = txtRecords.some((txt) => txt.includes(expectedValue));

    if (!found) {
      return err(
        `TXT record not found. Add this DNS record and try again:\n` +
          `  Name: _agentlair-verify.${domain}\n` +
          `  Type: TXT\n` +
          `  Value: ${expectedValue}\n` +
          `Found records: ${txtRecords.length > 0 ? txtRecords.join('; ') : '(none)'}`,
        422,
        'verification_failed',
      );
    }

    // ✓ Verified
    entry.verified = true;
    entry.verified_at = new Date().toISOString();
    await env.EMAILS.put(`domain:${domain}`, JSON.stringify(entry));

    return json({
      domain,
      verified: true,
      verified_at: entry.verified_at,
      next_steps: {
        claim_address: `POST /v1/email/claim {"address": "you@${domain}"}`,
        inbound: `Configure Cloudflare Email Routing catch-all for ${domain} → AgentLair worker`,
        outbound: `Domain must be verified in Resend for DKIM/SPF to send from @${domain}`,
      },
    });
  }

  // ── DELETE /v1/email/domains/:domain — unregister domain ──────────────────
  const deleteMatch = path.match(/^\/v1\/email\/domains\/([^/]+)$/);
  if (deleteMatch && method === 'DELETE') {
    const domain = decodeURIComponent(deleteMatch[1]).toLowerCase();

    const raw = await env.EMAILS.get(`domain:${domain}`);
    if (!raw) return err('Domain not found.', 404, 'domain_not_found');

    const entry = JSON.parse(raw) as DomainEntry;
    if (entry.account_id !== account.id) {
      return err('Domain not found.', 404, 'domain_not_found');
    }

    await env.EMAILS.delete(`domain:${domain}`);
    await removeFromAccountDomains(env, account.id, domain);

    // Note: addresses claimed on this domain are NOT automatically deleted.
    // They become orphaned but are still owned by the account. The domain
    // owner can reclaim or the addresses will naturally expire if unused.

    return json({ deleted: true, domain });
  }

  // ── GET /v1/email/domains/:domain — get domain details ────────────────────
  const getMatch = path.match(/^\/v1\/email\/domains\/([^/]+)$/);
  if (getMatch && method === 'GET') {
    const domain = decodeURIComponent(getMatch[1]).toLowerCase();

    const raw = await env.EMAILS.get(`domain:${domain}`);
    if (!raw) return err('Domain not found.', 404, 'domain_not_found');

    const entry = JSON.parse(raw) as DomainEntry;
    if (entry.account_id !== account.id) {
      return err('Domain not found.', 404, 'domain_not_found');
    }

    return json({
      domain: entry.domain,
      verified: entry.verified,
      verification_token: entry.verification_token,
      dns_setup: buildDnsSetup(entry.domain, entry.verification_token),
      created_at: entry.created_at,
      verified_at: entry.verified_at,
    });
  }

  return null;
}

// ─── DNS setup instructions builder ───────────────────────────────────────────

function buildDnsSetup(domain: string, token: string) {
  return {
    verification: {
      record_type: 'TXT',
      name: `_agentlair-verify.${domain}`,
      value: `agentlair-site-verification=${token}`,
      note: 'Add this TXT record to verify domain ownership.',
    },
    inbound_email: {
      option_a: 'If domain is on Cloudflare: Enable Email Routing → Add catch-all rule → Forward to AgentLair worker',
      option_b: `If domain is elsewhere: Set MX record for ${domain} to route.agentlair.dev (priority 10)`,
      note: 'Inbound routing ensures email sent to @' + domain + ' reaches your AgentLair inbox.',
    },
    outbound_email: {
      note: `To send FROM @${domain}, the domain needs DKIM/SPF records for Resend. Contact support or use the Resend API.`,
    },
    verify_endpoint: `POST /v1/email/domains/${domain}/verify`,
  };
}
