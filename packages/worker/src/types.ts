// AgentLair Worker — Shared Types

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
  // Pod fields — present when account is a pod virtual account
  type?: 'account' | 'pod';
  pod_id?: string;
  parent_id?: string;
  // Dashboard session token (set when auth via session token)
  _session?: string;
  [key: string]: unknown;
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
}

export interface X402SettleResult {
  settled: boolean;
  error?: string;
  receipt?: string;
}

export interface Pod {
  id: string;
  parent_id: string;
  name?: string | null;
  created_at: string;
  status: 'active' | 'suspended';
  suspended_at?: string;
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
