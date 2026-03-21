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
  email_count?: number;
  email_limit?: number;
  // Pod fields — present when account is a pod virtual account
  type?: 'account' | 'pod';
  pod_id?: string;
  parent_id?: string;
  [key: string]: unknown;
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
