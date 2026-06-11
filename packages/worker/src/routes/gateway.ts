// ─── Policy Gateway Routes ──────────────────────────────────────────────────────
// Handles: /v1/gateway/* — governed proxy between agents and external x402 services
//
// The gateway is an HTTP forward proxy with:
// - Policy enforcement (spending caps, service allow/blocklist)
// - AAT authentication (via existing account context)
// - Audit logging of every transaction
// - Wallet-based x402 payment forwarding (EIP-3009 / ERC-712)
//
// Storage: D1 (AUDIT binding), three tables:
//   gateway_policies, gateway_spend_ledger, gateway_wallets
//
// MVP scope (Phase 1):
//   GET  /v1/gateway/policy   — get agent's own policy
//   PUT  /v1/gateway/policy   — create/update policy
//   GET  /v1/gateway/budget   — remaining spend
//   GET  /v1/gateway/history  — spend history
//   POST /v1/gateway/proxy    — THE CORE: proxies HTTP with x402 enforcement
//   GET  /v1/gateway/wallet   — wallet balance

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { nanoid, err, json, getBudgetResetAt } from '../utils.js';
import { writeBudgetAuditEvent } from '../middleware/audit.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

// ─── EIP-712 Constants ────────────────────────────────────────────────────────

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_CHAIN_ID = 8453n;

// ─── D1 Table Init ────────────────────────────────────────────────────────────

let gatewayTablesEnsured = false;

export async function ensureGatewayTables(db: D1Database): Promise<void> {
  if (gatewayTablesEnsured) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gateway_policies (
      agent_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      daily_limit_usdc INTEGER,
      weekly_limit_usdc INTEGER,
      monthly_limit_usdc INTEGER,
      single_tx_max_usdc INTEGER,
      mode TEXT NOT NULL DEFAULT 'open',
      services TEXT NOT NULL DEFAULT '[]',
      on_limit TEXT NOT NULL DEFAULT 'reject',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gateway_spend_ledger (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      amount_usdc INTEGER NOT NULL,
      target_url TEXT NOT NULL,
      target_domain TEXT NOT NULL,
      service_description TEXT,
      x402_tx_hash TEXT,
      facilitator TEXT,
      decision TEXT NOT NULL,
      rejection_reason TEXT,
      audit_entry_id TEXT,
      aat_jti TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_gw_spend_agent_ts ON gateway_spend_ledger(agent_id, timestamp)
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gateway_wallets (
      owner_id TEXT PRIMARY KEY,
      balance_usdc INTEGER NOT NULL DEFAULT 0,
      total_deposited_usdc INTEGER NOT NULL DEFAULT 0,
      total_spent_usdc INTEGER NOT NULL DEFAULT 0,
      deposit_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  gatewayTablesEnsured = true;
}

// ─── SSRF Protection ──────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,    // link-local / AWS metadata
  /^fc[0-9a-f]{2}:/i,         // IPv6 fc00::/7
  /^fe80:/i,                   // IPv6 link-local
  /^::1$/,                     // IPv6 loopback
  /metadata\.google\.internal$/i,
];

function isBlockedHost(host: string): boolean {
  return BLOCKED_PATTERNS.some(p => p.test(host));
}

/**
 * Validate a proxy target URL. Returns an error message, or null if valid.
 */
export function validateProxyUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'Invalid URL format.';
  }
  if (parsed.protocol !== 'https:') {
    return 'Only HTTPS URLs are allowed.';
  }
  const host = parsed.hostname;
  if (isBlockedHost(host)) {
    return `Blocked URL: ${host} is a private or reserved address.`;
  }
  return null;
}

// ─── Policy Types ─────────────────────────────────────────────────────────────

interface ServiceRule {
  domain: string;
  allowed: boolean;
  max_per_tx_usdc?: number;
  daily_limit_usdc?: number;
  label?: string;
  category?: string;
}

interface GatewayPolicy {
  agent_id: string;
  enabled: boolean;
  daily_limit_usdc: number | null;
  weekly_limit_usdc: number | null;
  monthly_limit_usdc: number | null;
  single_tx_max_usdc: number | null;
  mode: 'open' | 'allowlist' | 'blocklist';
  services: ServiceRule[];
  on_limit: 'reject' | 'queue_approval';
  created_at: string;
  updated_at: string;
}

interface PolicyRow {
  agent_id: string;
  enabled: number;
  daily_limit_usdc: number | null;
  weekly_limit_usdc: number | null;
  monthly_limit_usdc: number | null;
  single_tx_max_usdc: number | null;
  mode: string;
  services: string;
  on_limit: string;
  created_at: string;
  updated_at: string;
}

function rowToPolicy(row: PolicyRow): GatewayPolicy {
  let services: ServiceRule[] = [];
  try { services = JSON.parse(row.services); } catch {}
  return {
    agent_id: row.agent_id,
    enabled: row.enabled === 1,
    daily_limit_usdc: row.daily_limit_usdc,
    weekly_limit_usdc: row.weekly_limit_usdc,
    monthly_limit_usdc: row.monthly_limit_usdc,
    single_tx_max_usdc: row.single_tx_max_usdc,
    mode: (row.mode as GatewayPolicy['mode']) || 'open',
    services,
    on_limit: (row.on_limit as GatewayPolicy['on_limit']) || 'reject',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getPolicy(db: D1Database, agentId: string): Promise<GatewayPolicy | null> {
  const row = await db.prepare(
    `SELECT * FROM gateway_policies WHERE agent_id = ?`
  ).bind(agentId).first<PolicyRow>();
  if (!row) return null;
  return rowToPolicy(row);
}

/** Default open policy — used when no explicit policy is set. */
function defaultPolicy(agentId: string): GatewayPolicy {
  const now = new Date().toISOString();
  return {
    agent_id: agentId,
    enabled: true,
    daily_limit_usdc: null,
    weekly_limit_usdc: null,
    monthly_limit_usdc: null,
    single_tx_max_usdc: null,
    mode: 'open',
    services: [],
    on_limit: 'reject',
    created_at: now,
    updated_at: now,
  };
}

// ─── Service Allow/Block Check ────────────────────────────────────────────────

function isServiceAllowed(policy: GatewayPolicy, domain: string): boolean {
  if (!policy.enabled) return false;
  if (policy.mode === 'open') return true;

  const matchRule = (rule: ServiceRule): boolean => {
    if (rule.domain.startsWith('*.')) {
      const suffix = rule.domain.slice(1); // ".example.com"
      return domain === rule.domain.slice(2) || domain.endsWith(suffix);
    }
    return domain === rule.domain;
  };

  if (policy.mode === 'allowlist') {
    return policy.services.some(r => matchRule(r) && r.allowed !== false);
  }
  if (policy.mode === 'blocklist') {
    return !policy.services.some(r => matchRule(r) && r.allowed === false);
  }
  return true;
}

// ─── Period Spend Calculation ─────────────────────────────────────────────────

async function getPeriodSpend(
  db: D1Database,
  agentId: string,
  period: 'daily' | 'weekly' | 'monthly',
): Promise<number> {
  const now = new Date();
  let startOf: Date;
  if (period === 'daily') {
    startOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else if (period === 'weekly') {
    const day = now.getUTCDay() || 7;
    startOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  } else {
    startOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const startIso = startOf.toISOString();

  const row = await db.prepare(
    `SELECT COALESCE(SUM(amount_usdc), 0) as total
     FROM gateway_spend_ledger
     WHERE agent_id = ? AND decision = 'approved' AND timestamp >= ?`
  ).bind(agentId, startIso).first<{ total: number }>();

  return row?.total ?? 0;
}

// ─── EIP-712 Signing ──────────────────────────────────────────────────────────

/** Encode a 32-byte field as Uint8Array (for ABI encoding). */
function abiEncodeAddress(hexAddr: string): Uint8Array {
  // addresses are 20 bytes, left-padded to 32
  const clean = hexAddr.replace(/^0x/i, '').toLowerCase().padStart(40, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 20; i++) {
    bytes[12 + i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function abiEncodeUint256(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function abiEncodeBytes32(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '').padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function keccak256Str(s: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(s));
}

function keccak256Bytes(b: Uint8Array): Uint8Array {
  return keccak_256(b);
}

// Pre-computed typehashes
const DOMAIN_TYPEHASH = keccak256Str(
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
);
const TRANSFER_TYPEHASH = keccak256Str(
  'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)',
);

function buildDomainSeparator(): Uint8Array {
  return keccak256Bytes(concat(
    DOMAIN_TYPEHASH,
    keccak256Str('USD Coin'),
    keccak256Str('2'),
    abiEncodeUint256(BASE_CHAIN_ID),
    abiEncodeAddress(USDC_ADDRESS),
  ));
}

const DOMAIN_SEPARATOR = buildDomainSeparator();

interface EIP3009Authorization {
  from: string;      // 0x-prefixed address
  to: string;        // 0x-prefixed address
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: string;     // 0x-prefixed 32-byte hex
}

interface SignedAuthorization extends EIP3009Authorization {
  /** EIP-712 signature: 0x-prefixed 65-byte hex (r+s+v) */
  signature: string;
}

function signTransferAuthorization(
  auth: EIP3009Authorization,
  privateKeyHex: string,
): SignedAuthorization {
  // Build struct hash
  const structHash = keccak256Bytes(concat(
    TRANSFER_TYPEHASH,
    abiEncodeAddress(auth.from),
    abiEncodeAddress(auth.to),
    abiEncodeUint256(auth.value),
    abiEncodeUint256(auth.validAfter),
    abiEncodeUint256(auth.validBefore),
    abiEncodeBytes32(auth.nonce),
  ));

  // EIP-712 final digest: \x19\x01 || domainSeparator || structHash
  const prefix = new Uint8Array([0x19, 0x01]);
  const digest = keccak256Bytes(concat(prefix, DOMAIN_SEPARATOR, structHash));

  // Sign with secp256k1.
  // @noble/curves v2 changed two relevant defaults vs. v1:
  //   1. sign() now returns raw bytes, not a {r, s, recovery} object.
  //      Use format: 'recovered' (65 bytes: r||s||recovery) + Signature.fromBytes
  //      to get the object form needed for EIP-712 (r||s||v) serialization.
  //   2. prehash defaults to TRUE in v2 (was false in v1). Our `digest` is the
  //      already-computed EIP-712 keccak256 digest — pass prehash: false so
  //      the library does not sha256 it again. Without this, the signature
  //      would be over sha256(digest), invalid for Ethereum verification.
  const privKey = privateKeyHex.replace(/^0x/i, '');
  const privKeyBytes = Uint8Array.from(privKey.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const sigBytes = secp256k1.sign(digest, privKeyBytes, {
    lowS: true,
    prehash: false,
    format: 'recovered',
  });
  const sig = secp256k1.Signature.fromBytes(sigBytes, 'recovered');

  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  // recovery is guaranteed present because we requested 'recovered' format above.
  const v = (27 + sig.recovery!).toString(16).padStart(2, '0');
  const signature = '0x' + r + s + v;

  return { ...auth, signature };
}

/** Generate random 32-byte nonce as 0x-prefixed hex. */
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── x402 Payment ─────────────────────────────────────────────────────────────

interface X402PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  extra?: { facilitator?: string; [key: string]: unknown };
}

interface X402Response {
  x402Version?: number;
  accepts: X402PaymentRequirement[];
}

function buildXPaymentHeader(
  auth: SignedAuthorization,
  requirement: X402PaymentRequirement,
): string {
  const payload = {
    scheme: 'exact',
    network: requirement.network,
    payload: {
      signature: auth.signature,
      authorization: {
        from: auth.from,
        to: auth.to,
        value: auth.value.toString(),
        validAfter: auth.validAfter.toString(),
        validBefore: auth.validBefore.toString(),
        nonce: auth.nonce,
      },
    },
  };
  return btoa(JSON.stringify(payload));
}

// ─── Ledger Write ─────────────────────────────────────────────────────────────

async function writeLedgerEntry(
  db: D1Database,
  params: {
    agentId: string;
    targetUrl: string;
    targetDomain: string;
    amountUsdc: number;
    decision: 'approved' | 'rejected' | 'free';
    rejectionReason?: string;
    serviceDescription?: string;
    x402TxHash?: string;
    facilitator?: string;
  },
): Promise<string> {
  const id = 'gw_sp_' + nanoid(16);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO gateway_spend_ledger
      (id, agent_id, timestamp, amount_usdc, target_url, target_domain,
       service_description, x402_tx_hash, facilitator, decision, rejection_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, params.agentId, now, params.amountUsdc, params.targetUrl, params.targetDomain,
    params.serviceDescription ?? null, params.x402TxHash ?? null,
    params.facilitator ?? null, params.decision, params.rejectionReason ?? null, now,
  ).run();
  return id;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const gatewayRoutes = new Hono<HonoEnv>();

// ── GET /v1/gateway/policy ─────────────────────────────────────────────────────

gatewayRoutes.get('/policy', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Gateway requires D1 binding.', 503, 'service_unavailable');

  await ensureGatewayTables(c.env.AUDIT);
  const policy = await getPolicy(c.env.AUDIT, account.id) ?? defaultPolicy(account.id);
  return json(policy);
});

// ── PUT /v1/gateway/policy ─────────────────────────────────────────────────────

gatewayRoutes.put('/policy', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Gateway requires D1 binding.', 503, 'service_unavailable');

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}

  // Validate numeric caps
  const integerOrNull = (v: unknown, field: string): number | null | Response => {
    if (v === undefined) return undefined as unknown as null; // not provided
    if (v === null) return null; // remove cap
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 1_000_000_000) {
      return err(`${field} must be a positive integer ≤ 1,000,000,000 or null.`, 400, 'invalid_request');
    }
    return v;
  };

  const daily = integerOrNull(body.daily_limit_usdc, 'daily_limit_usdc');
  if (daily instanceof Response) return daily;
  const weekly = integerOrNull(body.weekly_limit_usdc, 'weekly_limit_usdc');
  if (weekly instanceof Response) return weekly;
  const monthly = integerOrNull(body.monthly_limit_usdc, 'monthly_limit_usdc');
  if (monthly instanceof Response) return monthly;
  const singleTx = integerOrNull(body.single_tx_max_usdc, 'single_tx_max_usdc');
  if (singleTx instanceof Response) return singleTx;

  let mode: 'open' | 'allowlist' | 'blocklist' | undefined;
  if ('mode' in body) {
    if (!['open', 'allowlist', 'blocklist'].includes(body.mode as string)) {
      return err('mode must be "open", "allowlist", or "blocklist".', 400, 'invalid_request');
    }
    mode = body.mode as 'open' | 'allowlist' | 'blocklist';
  }

  let onLimit: 'reject' | 'queue_approval' | undefined;
  if ('on_limit' in body) {
    if (!['reject', 'queue_approval'].includes(body.on_limit as string)) {
      return err('on_limit must be "reject" or "queue_approval".', 400, 'invalid_request');
    }
    onLimit = body.on_limit as 'reject' | 'queue_approval';
  }

  let services: ServiceRule[] | undefined;
  if ('services' in body) {
    if (!Array.isArray(body.services)) {
      return err('services must be an array.', 400, 'invalid_request');
    }
    services = body.services as ServiceRule[];
  }

  let enabled: boolean | undefined;
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return err('enabled must be a boolean.', 400, 'invalid_request');
    }
    enabled = body.enabled;
  }

  await ensureGatewayTables(c.env.AUDIT);

  // Load existing to merge
  const existing = await getPolicy(c.env.AUDIT, account.id) ?? defaultPolicy(account.id);
  const updated: GatewayPolicy = {
    ...existing,
    ...(enabled !== undefined && { enabled }),
    ...(daily !== (undefined as unknown as null) && { daily_limit_usdc: daily }),
    ...(weekly !== (undefined as unknown as null) && { weekly_limit_usdc: weekly }),
    ...(monthly !== (undefined as unknown as null) && { monthly_limit_usdc: monthly }),
    ...(singleTx !== (undefined as unknown as null) && { single_tx_max_usdc: singleTx }),
    ...(mode !== undefined && { mode }),
    ...(onLimit !== undefined && { on_limit: onLimit }),
    ...(services !== undefined && { services }),
    updated_at: new Date().toISOString(),
  };

  await c.env.AUDIT.prepare(`
    INSERT INTO gateway_policies
      (agent_id, enabled, daily_limit_usdc, weekly_limit_usdc, monthly_limit_usdc,
       single_tx_max_usdc, mode, services, on_limit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(agent_id) DO UPDATE SET
      enabled = excluded.enabled,
      daily_limit_usdc = excluded.daily_limit_usdc,
      weekly_limit_usdc = excluded.weekly_limit_usdc,
      monthly_limit_usdc = excluded.monthly_limit_usdc,
      single_tx_max_usdc = excluded.single_tx_max_usdc,
      mode = excluded.mode,
      services = excluded.services,
      on_limit = excluded.on_limit,
      updated_at = datetime('now')
  `).bind(
    account.id,
    updated.enabled ? 1 : 0,
    updated.daily_limit_usdc,
    updated.weekly_limit_usdc,
    updated.monthly_limit_usdc,
    updated.single_tx_max_usdc,
    updated.mode,
    JSON.stringify(updated.services),
    updated.on_limit,
  ).run();

  // Audit event (fire-and-forget)
  c.executionCtx.waitUntil(
    writeBudgetAuditEvent(c.env, {
      action: 'gateway.policy_updated',
      accountId: account.id,
      details: {
        mode: updated.mode,
        on_limit: updated.on_limit,
        daily_limit_usdc: updated.daily_limit_usdc ?? 'null',
        monthly_limit_usdc: updated.monthly_limit_usdc ?? 'null',
      },
    }),
  );

  return json({ ok: true, policy: updated });
});

// ── GET /v1/gateway/budget ─────────────────────────────────────────────────────

gatewayRoutes.get('/budget', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Gateway requires D1 binding.', 503, 'service_unavailable');

  await ensureGatewayTables(c.env.AUDIT);
  const policy = await getPolicy(c.env.AUDIT, account.id) ?? defaultPolicy(account.id);

  const [daily, weekly, monthly] = await Promise.all([
    getPeriodSpend(c.env.AUDIT, account.id, 'daily'),
    getPeriodSpend(c.env.AUDIT, account.id, 'weekly'),
    getPeriodSpend(c.env.AUDIT, account.id, 'monthly'),
  ]);

  const wallet = await c.env.AUDIT.prepare(
    `SELECT balance_usdc FROM gateway_wallets WHERE owner_id = ?`
  ).bind(account.id).first<{ balance_usdc: number }>();

  return json({
    agent_id: account.id,
    daily: policy.daily_limit_usdc != null ? {
      limit_usdc: policy.daily_limit_usdc,
      spent_usdc: daily,
      remaining_usdc: Math.max(0, policy.daily_limit_usdc - daily),
      resets_at: getBudgetResetAt('daily'),
    } : null,
    weekly: policy.weekly_limit_usdc != null ? {
      limit_usdc: policy.weekly_limit_usdc,
      spent_usdc: weekly,
      remaining_usdc: Math.max(0, policy.weekly_limit_usdc - weekly),
      resets_at: getBudgetResetAt('weekly'),
    } : null,
    monthly: policy.monthly_limit_usdc != null ? {
      limit_usdc: policy.monthly_limit_usdc,
      spent_usdc: monthly,
      remaining_usdc: Math.max(0, policy.monthly_limit_usdc - monthly),
      resets_at: getBudgetResetAt('monthly'),
    } : null,
    wallet_balance_usdc: wallet?.balance_usdc ?? 0,
    status: 'active',
  });
});

// ── GET /v1/gateway/history ────────────────────────────────────────────────────

gatewayRoutes.get('/history', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Gateway requires D1 binding.', 503, 'service_unavailable');

  const period = c.req.query('period') ?? 'daily';
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  await ensureGatewayTables(c.env.AUDIT);

  const now = new Date();
  let startOf: Date;
  if (period === 'weekly') {
    const day = now.getUTCDay() || 7;
    startOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  } else if (period === 'monthly') {
    startOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else {
    startOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const startIso = startOf.toISOString();

  const rows = await c.env.AUDIT.prepare(`
    SELECT id, timestamp, amount_usdc, target_url, target_domain,
           service_description, x402_tx_hash, decision, rejection_reason
    FROM gateway_spend_ledger
    WHERE agent_id = ? AND timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).bind(account.id, startIso, limit).all();

  const entries = rows.results ?? [];
  const totalUsdc = entries
    .filter((e: Record<string, unknown>) => e.decision === 'approved')
    .reduce((sum: number, e: Record<string, unknown>) => sum + (e.amount_usdc as number), 0);

  // Aggregate by domain
  const byDomain: Record<string, number> = {};
  for (const e of entries as Record<string, unknown>[]) {
    if (e.decision === 'approved') {
      const d = e.target_domain as string;
      byDomain[d] = (byDomain[d] ?? 0) + (e.amount_usdc as number);
    }
  }

  return json({
    entries,
    summary: {
      total_usdc: totalUsdc,
      by_domain: byDomain,
      payment_count: (entries as Record<string, unknown>[]).filter((e) => e.decision === 'approved').length,
    },
  });
});

// ── GET /v1/gateway/wallet ─────────────────────────────────────────────────────

gatewayRoutes.get('/wallet', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Gateway requires D1 binding.', 503, 'service_unavailable');

  await ensureGatewayTables(c.env.AUDIT);
  const wallet = await c.env.AUDIT.prepare(
    `SELECT * FROM gateway_wallets WHERE owner_id = ?`
  ).bind(account.id).first<{
    owner_id: string;
    balance_usdc: number;
    total_deposited_usdc: number;
    total_spent_usdc: number;
    deposit_address: string | null;
  }>();

  return json({
    owner_id: account.id,
    balance_usdc: wallet?.balance_usdc ?? 0,
    deposit_address: wallet?.deposit_address ?? null,
    total_deposited_usdc: wallet?.total_deposited_usdc ?? 0,
    total_spent_usdc: wallet?.total_spent_usdc ?? 0,
    note: wallet?.deposit_address
      ? 'Send USDC (Base) to deposit_address to fund your gateway wallet.'
      : 'No deposit address configured yet. Contact support to fund the gateway.',
  });
});

// ── POST /v1/gateway/proxy — THE CORE ─────────────────────────────────────────

gatewayRoutes.post('/proxy', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Gateway requires D1 binding.', 503, 'service_unavailable');

  // Parse request body
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {
    return err('Request body must be valid JSON.', 400, 'invalid_request');
  }

  const rawUrl = body.url;
  const method = (body.method as string ?? 'GET').toUpperCase();
  const forwardHeaders = (body.headers as Record<string, string>) ?? {};
  const forwardBody = body.body;

  // Validate method
  const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];
  if (!ALLOWED_METHODS.includes(method)) {
    return err(`method must be one of: ${ALLOWED_METHODS.join(', ')}`, 400, 'invalid_request');
  }

  // Validate URL
  if (!rawUrl || typeof rawUrl !== 'string') {
    return err('url field is required.', 400, 'invalid_request');
  }
  const urlError = validateProxyUrl(rawUrl);
  if (urlError) {
    return err(urlError, 400, 'ssrf_blocked');
  }

  const targetUrl = rawUrl;
  const targetDomain = new URL(targetUrl).hostname;

  await ensureGatewayTables(c.env.AUDIT);

  // Load policy (default: open/no-limits)
  const policy = await getPolicy(c.env.AUDIT, account.id) ?? defaultPolicy(account.id);

  // Check service allow/blocklist
  if (!isServiceAllowed(policy, targetDomain)) {
    c.executionCtx.waitUntil(
      writeBudgetAuditEvent(c.env, {
        action: 'gateway.service_blocked',
        accountId: account.id,
        details: { target_domain: targetDomain, mode: policy.mode },
      }),
    );
    await writeLedgerEntry(c.env.AUDIT, {
      agentId: account.id,
      targetUrl,
      targetDomain,
      amountUsdc: 0,
      decision: 'rejected',
      rejectionReason: 'service_blocked',
    });
    return err(
      `Service ${targetDomain} is blocked by your gateway policy.`,
      403,
      'service_blocked',
    );
  }

  // Build forward request
  const reqHeaders: Record<string, string> = {
    ...forwardHeaders,
  };
  // Never forward Authorization to external services (security)
  delete reqHeaders['authorization'];
  delete reqHeaders['Authorization'];

  const reqInit: RequestInit = {
    method,
    headers: reqHeaders,
    ...(forwardBody != null && method !== 'GET' && method !== 'HEAD'
      ? { body: typeof forwardBody === 'string' ? forwardBody : JSON.stringify(forwardBody) }
      : {}),
  };

  // ── Step 1: Forward request to target ────────────────────────────────────────
  let targetResp: Response;
  try {
    targetResp = await fetch(targetUrl, reqInit);
  } catch (e) {
    return err(`Failed to reach ${targetDomain}: ${e instanceof Error ? e.message : String(e)}`, 502, 'upstream_error');
  }

  // ── Step 2: Handle 200 (no payment needed) ────────────────────────────────────
  if (targetResp.status === 200) {
    let respBody: unknown;
    const contentType = targetResp.headers.get('content-type') ?? '';
    try {
      respBody = contentType.includes('application/json')
        ? await targetResp.json()
        : await targetResp.text();
    } catch {
      respBody = await targetResp.text().catch(() => null);
    }

    const ledgerId = await writeLedgerEntry(c.env.AUDIT, {
      agentId: account.id,
      targetUrl,
      targetDomain,
      amountUsdc: 0,
      decision: 'free',
    });

    c.executionCtx.waitUntil(
      writeBudgetAuditEvent(c.env, {
        action: 'gateway.request_proxied',
        accountId: account.id,
        details: { target_domain: targetDomain, paid: false, amount_usdc: 0 },
      }),
    );

    const [dailySpent, monthlySpent] = await Promise.all([
      getPeriodSpend(c.env.AUDIT, account.id, 'daily'),
      getPeriodSpend(c.env.AUDIT, account.id, 'monthly'),
    ]);

    return json({
      status: 200,
      headers: Object.fromEntries(targetResp.headers.entries()),
      body: respBody,
      gateway: {
        paid: false,
        amount_usdc: 0,
        remaining_daily_usdc: policy.daily_limit_usdc != null
          ? Math.max(0, policy.daily_limit_usdc - dailySpent) : null,
        remaining_monthly_usdc: policy.monthly_limit_usdc != null
          ? Math.max(0, policy.monthly_limit_usdc - monthlySpent) : null,
        ledger_id: ledgerId,
      },
    });
  }

  // ── Step 3: Handle 402 (x402 payment required) ────────────────────────────────
  if (targetResp.status === 402) {
    let paymentReq: X402Response;
    try {
      paymentReq = await targetResp.json() as X402Response;
    } catch {
      return err('Upstream 402 response was not valid x402 JSON.', 502, 'upstream_error');
    }

    // Find Base mainnet option
    const baseOption = (paymentReq.accepts ?? []).find(
      (a) => a.network === 'eip155:8453' && a.scheme === 'exact',
    );
    if (!baseOption) {
      return err('No compatible payment option (eip155:8453 / exact) found in 402 response.', 502, 'payment_scheme_unsupported');
    }

    const amountUsdc = parseInt(baseOption.amount, 10);
    if (isNaN(amountUsdc) || amountUsdc <= 0) {
      return err('Invalid payment amount in 402 response.', 502, 'upstream_error');
    }

    // ── Policy check: single_tx_max ────────────────────────────────────────────
    if (policy.single_tx_max_usdc != null && amountUsdc > policy.single_tx_max_usdc) {
      c.executionCtx.waitUntil(
        writeBudgetAuditEvent(c.env, {
          action: 'gateway.payment_rejected',
          accountId: account.id,
          details: {
            reason: 'single_tx_exceeded',
            amount_usdc: amountUsdc,
            single_tx_max_usdc: policy.single_tx_max_usdc,
          },
        }),
      );
      await writeLedgerEntry(c.env.AUDIT, {
        agentId: account.id, targetUrl, targetDomain, amountUsdc,
        decision: 'rejected', rejectionReason: 'single_tx_exceeded',
        serviceDescription: baseOption.description,
      });
      return json({
        error: 'single_tx_exceeded',
        detail: {
          requested_usdc: amountUsdc,
          single_tx_max_usdc: policy.single_tx_max_usdc,
        },
        policy_url: '/v1/gateway/policy',
      }, 403);
    }

    // ── Policy check: period caps ──────────────────────────────────────────────
    const [dailySpent, weeklySpent, monthlySpent] = await Promise.all([
      getPeriodSpend(c.env.AUDIT, account.id, 'daily'),
      getPeriodSpend(c.env.AUDIT, account.id, 'weekly'),
      getPeriodSpend(c.env.AUDIT, account.id, 'monthly'),
    ]);

    const periodsToCheck: Array<{ period: string; limit: number | null; spent: number }> = [
      { period: 'daily', limit: policy.daily_limit_usdc, spent: dailySpent },
      { period: 'weekly', limit: policy.weekly_limit_usdc, spent: weeklySpent },
      { period: 'monthly', limit: policy.monthly_limit_usdc, spent: monthlySpent },
    ];

    for (const { period, limit, spent } of periodsToCheck) {
      if (limit != null && spent + amountUsdc > limit) {
        c.executionCtx.waitUntil(
          writeBudgetAuditEvent(c.env, {
            action: 'gateway.payment_rejected',
            accountId: account.id,
            details: {
              reason: 'budget_exceeded',
              period,
              spent_usdc: spent,
              limit_usdc: limit,
              requested_usdc: amountUsdc,
            },
          }),
        );
        await writeLedgerEntry(c.env.AUDIT, {
          agentId: account.id, targetUrl, targetDomain, amountUsdc,
          decision: 'rejected', rejectionReason: 'budget_exceeded',
          serviceDescription: baseOption.description,
        });
        return json({
          error: 'budget_exceeded',
          detail: {
            period,
            spent_usdc: spent,
            limit_usdc: limit,
            requested_usdc: amountUsdc,
          },
          budget_url: '/v1/gateway/budget',
        }, 403);
      }
    }

    // ── Wallet check ──────────────────────────────────────────────────────────
    const wallet = await c.env.AUDIT.prepare(
      `SELECT balance_usdc FROM gateway_wallets WHERE owner_id = ?`
    ).bind(account.id).first<{ balance_usdc: number }>();

    if ((wallet?.balance_usdc ?? 0) < amountUsdc) {
      return json({
        error: 'wallet_insufficient',
        detail: {
          required_usdc: amountUsdc,
          available_usdc: wallet?.balance_usdc ?? 0,
        },
        wallet_url: '/v1/gateway/wallet',
      }, 503);
    }

    // ── Gateway wallet key check ──────────────────────────────────────────────
    const walletKey = (c.env as unknown as { GATEWAY_WALLET_KEY?: string }).GATEWAY_WALLET_KEY;
    if (!walletKey) {
      return json({
        error: 'gateway_not_funded',
        detail: 'Gateway wallet not configured. Contact support.',
      }, 503);
    }

    // ── Sign x402 payment ─────────────────────────────────────────────────────
    let fromAddress: string;
    try {
      const privKeyBytes = Uint8Array.from(
        walletKey.replace(/^0x/i, '').match(/.{2}/g)!.map(b => parseInt(b, 16))
      );
      const pubKey = secp256k1.getPublicKey(privKeyBytes, false); // uncompressed
      // Derive address from public key: keccak256(pubKey[1:65])[12:]
      const pubKeyHash = keccak_256(pubKey.slice(1));
      fromAddress = '0x' + Array.from(pubKeyHash.slice(12))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return json({ error: 'gateway_key_invalid', detail: 'Gateway wallet key is invalid.' }, 503);
    }

    const validBefore = BigInt(Math.floor(Date.now() / 1000) + (baseOption.maxTimeoutSeconds ?? 60));
    const auth = signTransferAuthorization({
      from: fromAddress,
      to: baseOption.payTo,
      value: BigInt(amountUsdc),
      validAfter: 0n,
      validBefore,
      nonce: randomNonce(),
    }, walletKey);

    const xPaymentHeader = buildXPaymentHeader(auth, baseOption);

    // ── Retry request with X-PAYMENT header ───────────────────────────────────
    const paidHeaders: Record<string, string> = { ...reqHeaders, 'X-PAYMENT': xPaymentHeader };
    let paidResp: Response;
    try {
      paidResp = await fetch(targetUrl, { ...reqInit, headers: paidHeaders });
    } catch (e) {
      return err(`Failed to reach ${targetDomain} on payment retry: ${e instanceof Error ? e.message : String(e)}`, 502, 'upstream_error');
    }

    if (paidResp.status === 200) {
      // Deduct from wallet
      await c.env.AUDIT.prepare(`
        UPDATE gateway_wallets
        SET balance_usdc = balance_usdc - ?,
            total_spent_usdc = total_spent_usdc + ?,
            updated_at = datetime('now')
        WHERE owner_id = ?
      `).bind(amountUsdc, amountUsdc, account.id).run();

      const facilitator = baseOption.extra?.facilitator as string | undefined;
      const ledgerId = await writeLedgerEntry(c.env.AUDIT, {
        agentId: account.id, targetUrl, targetDomain,
        amountUsdc, decision: 'approved',
        serviceDescription: baseOption.description,
        facilitator,
      });

      c.executionCtx.waitUntil(
        writeBudgetAuditEvent(c.env, {
          action: 'gateway.payment_approved',
          accountId: account.id,
          details: {
            target_domain: targetDomain,
            amount_usdc: amountUsdc,
            facilitator: facilitator ?? 'unknown',
          },
        }),
      );

      let paidBody: unknown;
      const paidContentType = paidResp.headers.get('content-type') ?? '';
      try {
        paidBody = paidContentType.includes('application/json')
          ? await paidResp.json()
          : await paidResp.text();
      } catch {
        paidBody = null;
      }

      const [newDailySpent, newMonthlySpent] = await Promise.all([
        getPeriodSpend(c.env.AUDIT, account.id, 'daily'),
        getPeriodSpend(c.env.AUDIT, account.id, 'monthly'),
      ]);

      return json({
        status: 200,
        headers: Object.fromEntries(paidResp.headers.entries()),
        body: paidBody,
        gateway: {
          paid: true,
          amount_usdc: amountUsdc,
          remaining_daily_usdc: policy.daily_limit_usdc != null
            ? Math.max(0, policy.daily_limit_usdc - newDailySpent) : null,
          remaining_monthly_usdc: policy.monthly_limit_usdc != null
            ? Math.max(0, policy.monthly_limit_usdc - newMonthlySpent) : null,
          ledger_id: ledgerId,
        },
      });
    }

    // Payment retry failed
    let errBody: unknown;
    try { errBody = await paidResp.json(); } catch { errBody = null; }
    return json({
      error: 'payment_failed',
      detail: `Upstream returned ${paidResp.status} after payment.`,
      upstream_response: errBody,
    }, 502);
  }

  // ── Non-200/402 response ──────────────────────────────────────────────────────
  let errBody: unknown;
  try { errBody = await targetResp.json(); } catch { errBody = null; }
  return json({
    status: targetResp.status,
    headers: Object.fromEntries(targetResp.headers.entries()),
    body: errBody,
    gateway: { paid: false, amount_usdc: 0 },
  }, targetResp.status < 500 ? targetResp.status : 502);
});
