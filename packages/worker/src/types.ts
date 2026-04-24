// AgentLair Worker — Shared Types

// ─── Hono App Environment ──────────────────────────────────────────────────────
// Defined here (not in index.ts) to avoid circular imports in route sub-apps.

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    account: Account | null;
  };
};

export interface Env {
  KEYS: KVNamespace;
  EMAILS: KVNamespace;
  VAULT: KVNamespace;
  AE_ANALYTICS: AnalyticsEngineDataset;
  INBOX_NOTIFIER: DurableObjectNamespace;
  PLATFORM_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_PROVIDER?: string;
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  // CF Pages base URL for proxying (default: https://agentlair-web.pages.dev)
  PAGES_URL?: string;
  // Audit trail D1 database (optional — graceful degradation if not bound)
  AUDIT?: D1Database;
  // Ed25519 private key for audit log signing, base64-encoded 32-byte key (CF secret)
  AUDIT_SIGNING_KEY?: string;
  // Admin API key for privileged operations (tier overrides, etc.)
  // Set via: wrangler secret put ADMIN_KEY
  ADMIN_KEY?: string;
}

export interface Account {
  id: string;
  key_prefix?: string;
  created_at?: string;
  recovery_email?: string;
  recovery_email_encrypted?: boolean;
  plan?: string;
  tier?: string;
  email_count?: number;
  email_limit?: number;
  stacks?: string[];
  // Account verification status
  status?: 'restricted' | 'unverified' | 'verified';
  // Operator email (copied from recovery_email at registration, never encrypted)
  operator_email?: string;
  // Pod fields — present when account is a pod virtual account
  type?: 'account' | 'pod';
  pod_id?: string;
  parent_id?: string;
  // Dashboard session token (set when auth via session token)
  _session?: string;
  // RFC 9421 signing key fields (set when agent has registered an Ed25519 signing key)
  signing_key_public?: string;  // base64url-encoded 32-byte Ed25519 public key
  signing_keyid?: string;        // base64url(SHA-256(pubkey)).slice(0, 22)
  // Scope ceiling — if set, POST /v1/tokens/issue validates requested scopes are a subset
  allowed_scopes?: string[];
  [key: string]: unknown;
}

// ─── Account Tier ──────────────────────────────────────────────────────────────
//
// Four-tier account system introduced in the revenue activation strategy.
// Replaces the legacy binary 'free' | 'paid' system.
//
// TIER_EVENT_WINDOW_DAYS (Gate C), TIER_WEIGHT_MULTIPLIER (Gate A),
// TIER_ATF_CAP (Gate B), and TIER_TELEMETRY_CEILING (Gate D) are in trust-engine.ts.

export type AccountTier = 'free' | 'starter' | 'pro' | 'enterprise';

/**
 * Resolves the canonical AccountTier from an Account record.
 * Handles the legacy 'paid' → 'starter' migration transparently.
 */
export function resolveAccountTier(account: Account): AccountTier {
  const raw = (account.tier ?? account.plan) as string | undefined;
  if (raw === 'starter' || raw === 'pro' || raw === 'enterprise') return raw;
  if (raw === 'paid') return 'starter';  // Legacy migration: 'paid' → 'starter'
  return 'free';
}

// ─── Email Send Options ─────────────────────────────────────────────────────

export interface EmailSendOptions {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  in_reply_to?: string;
  references?: string;
}

// ─── Email Provider ─────────────────────────────────────────────────────────

export interface EmailProvider {
  name: string;
  isConfigured: (env: Env) => boolean;
  send: (opts: EmailSendOptions, env: Env) => Promise<{ provider_id: string }>;
}

// ─── Turso Query Result ─────────────────────────────────────────────────────

export interface TursoResult {
  rows: Record<string, unknown>[];
  affected: number;
}

// ─── x402 Payment Types ─────────────────────────────────────────────────────

export interface X402VerifyResult {
  valid: boolean;
  error?: string;
  payer?: string;
  rawPayload?: unknown;
  /** Which facilitator URL was used for successful verification (for settle to use the same). */
  facilitatorUrl?: string;
}

export interface X402SettleResult {
  settled: boolean;
  error?: string;
  receipt?: string;
}

export interface PodRateLimits {
  requests_per_day?: number;
  requests_per_hour?: number;
  requests_per_minute?: number;
}

export interface PodRateLimitResult {
  allowed: boolean;
  // Present when not allowed
  limit?: number;
  window?: string;
  retry_after?: string;
  // Present when allowed and pod has rate limits (for response headers)
  rl_limit?: number;
  rl_remaining?: number;
  rl_reset?: number; // Unix epoch seconds
}

export interface SpendingCaps {
  daily?: number;    // max atomic USDC per calendar day (UTC)
  weekly?: number;   // max atomic USDC per calendar week (ISO week, UTC)
  monthly?: number;  // max atomic USDC per calendar month (UTC)
}

export interface Pod {
  id: string;
  parent_id: string;
  name?: string | null;
  created_at: string;
  status: 'active' | 'suspended';
  suspended_at?: string;
  rate_limits?: PodRateLimits | null;
  spending_caps?: SpendingCaps | null;
}

export interface EmailAuthResult {
  spf: string;
  dkim: string;
  dmarc: string;
  authenticated: boolean;
}

export interface EmailMessage {
  id: string;
  to: string;
  from: string;
  subject: string;
  body?: string;
  body_preview?: string;
  body_encrypted?: boolean;
  received_at: string;
  read?: boolean;
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
  headers?: Record<string, string>;
  auth?: EmailAuthResult;
  [key: string]: unknown;
}

export interface KeyEntry {
  hash: string;
  status: 'active' | 'backup' | 'revoked';
  prefix: string;
  created_at: string;
  label?: string;
  activated_at?: string;
}

// ─── Vault Index Entry ──────────────────────────────────────────────────────

export interface VaultIndexEntry {
  key: string;
  version: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Key History Entry (E2E rotation) ───────────────────────────────────────

export interface KeyHistoryEntry {
  public_key: string;
  rotated_at: string;
}

// ─── Webhook Entry ──────────────────────────────────────────────────────────

export interface WebhookListEntry {
  id: string;
  address: string;
  url: string;
  has_secret: boolean;
  events: string[];
  created_at: string;
}

// ─── Route Handler Context ─────────────────────────────────────────────────────

export interface RouteContext {
  url: URL;
  path: string;
  method: string;
  // null = public phase (before auth middleware); Account = protected phase
  account: Account | null;
}

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  rc: RouteContext,
) => Promise<Response | null>;
