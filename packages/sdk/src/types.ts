/**
 * @agentlair/sdk — Type definitions
 */

// ─── Account ──────────────────────────────────────────────────────────────────

export interface AgentLairOptions {
  /**
   * AgentLair API key (al_live_...).
   * Not required for `AgentLair.createAccount()` which is called statically.
   */
  apiKey: string;
  /**
   * Base URL for the AgentLair API.
   * @default "https://agentlair.dev"
   */
  baseUrl?: string;
}

/** @deprecated Use AgentLairOptions */
export type AgentLairClientOptions = AgentLairOptions;

export interface CreateAccountOptions {
  /** Optional display name for this account/agent */
  name?: string;
  /** Optional recovery email — enables dashboard login */
  email?: string;
}

export interface CreateAccountResult {
  /** API key — save this immediately, it will not be shown again */
  api_key: string;
  /** Short prefix of the API key (safe to log) */
  key_prefix: string;
  /** Unique account identifier */
  account_id: string;
  /** Account tier */
  tier: 'free' | 'paid';
  /** ISO timestamp of creation */
  created_at: string;
  /** Human-readable warning */
  warning: string;
  /** Rate/usage limits for this tier */
  limits: {
    stacks: number;
    addresses: number;
    dns_records: number;
    emails_per_day: number;
    requests_per_day: number;
  };
}

export interface AccountMeResult {
  account_id: string;
  tier: 'free' | 'paid';
  created_at: string;
  name?: string;
  recovery_email?: string;
}

export interface UsageResult {
  account_id: string;
  tier: string;
  /** Date string YYYY-MM-DD */
  period: string;
  requests: { used: number; limit: number };
  stacks: { used: number; limit: number };
  emails: {
    daily_used: number;
    daily_limit: number;
    daily_remaining: number;
    hourly_limit: number;
    reset_at: string;
  };
}

export interface BillingResult {
  account_id: string;
  tier: string;
  [key: string]: unknown;
}

// ─── Email ────────────────────────────────────────────────────────────────────

export interface ClaimAddressOptions {
  /** Full address to claim, e.g. "my-agent@agentlair.dev", or short name e.g. "my-agent" */
  address: string;
  /**
   * Optional base64url-encoded X25519 public key (32 bytes).
   * When provided, enables end-to-end encryption for inbound messages.
   */
  public_key?: string;
}

export interface ClaimAddressResult {
  address: string;
  claimed: boolean;
  already_owned: boolean;
  account_id: string;
  /** Whether E2E encryption is enabled for this address */
  e2e_enabled: boolean;
}

export interface ListAddressesResult {
  addresses: string[];
  count: number;
}

export interface SendEmailOptions {
  /** Sender address — must be a claimed @agentlair.dev address you own */
  from: string;
  /** Recipient address or array of addresses */
  to: string | string[];
  /** Email subject */
  subject: string;
  /** Plain text body (required if html not provided) */
  text?: string;
  /** HTML body (required if text not provided) */
  html?: string;
  /** Message-ID of the email being replied to (for threading) */
  in_reply_to?: string;
}

export interface SendEmailResult {
  /** Internal message ID */
  id: string;
  /** Delivery status */
  status: 'sent' | 'queued';
  /** Provider message ID (if delivered) */
  provider_id?: string;
  /** Delivery timestamp */
  sent_at?: string;
  /** Warning if provider not configured */
  warning?: string;
  /** Rate limit info */
  rate_limit?: {
    daily_remaining: number;
    hourly_remaining: number;
  };
}

export interface InboxMessage {
  /** Full Message-ID header (may contain angle brackets) */
  message_id: string;
  /** URL-encoded message_id (use this in readMessage calls) */
  message_id_url: string;
  /** Sender address */
  from: string;
  /** Recipient address */
  to: string;
  /** Email subject */
  subject: string;
  /** Up to 120-char preview of the body */
  snippet: string;
  /** ISO timestamp when received */
  received_at: string;
  /** Whether the message has been read */
  read: boolean;
  /** True if inbound E2E encryption is enabled for this address */
  e2e_encrypted?: boolean;
}

export interface GetInboxOptions {
  /** The @agentlair.dev address to read (or short name auto-expanded) */
  address: string;
  /** Max messages to return (default: 20, max: 100) */
  limit?: number;
}

export interface GetInboxResult {
  messages: InboxMessage[];
  has_more: boolean;
  count: number;
  address: string;
}

export interface ReadMessageOptions {
  /** Message ID — use message_id_url from inbox for safety, or raw message_id */
  messageId: string;
  /** The @agentlair.dev address that received the message */
  address: string;
}

export interface FullMessage extends InboxMessage {
  /** Full message body (platform-decrypted). For E2E messages, see `ciphertext`. */
  body?: string;
  /**
   * Raw E2E ciphertext (base64url). Only present when `e2e_encrypted: true`.
   */
  ciphertext?: string;
  /**
   * Ephemeral sender public key for E2E decryption (base64url X25519).
   * Only present when `e2e_encrypted: true`.
   */
  ephemeral_public_key?: string;
  /** Thread/reply context */
  in_reply_to?: string;
  /** HTML version of the body, if available */
  html?: string;
}

export interface DeleteMessageResult {
  deleted: boolean;
  message_id: string;
}

export interface UpdateMessageOptions {
  /** Mark as read (true) or unread (false) */
  read?: boolean;
}

export interface UpdateMessageResult {
  updated: boolean;
  message_id: string;
  read: boolean;
}

export interface OutboxMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  status: 'pending' | 'sent' | 'failed';
  queued_at: string;
  sent_at: string | null;
  error: string | null;
}

export interface OutboxResult {
  messages: OutboxMessage[];
  count: number;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export interface RegisterWebhookOptions {
  /** The @agentlair.dev address to receive events for */
  address: string;
  /** Your webhook endpoint URL */
  url: string;
  /** Optional HMAC secret for signature verification */
  secret?: string;
}

export interface Webhook {
  id: string;
  address: string;
  url: string;
  created_at: string;
}

export interface ListWebhooksOptions {
  /** Filter by address */
  address?: string;
}

export interface ListWebhooksResult {
  webhooks: Webhook[];
  count: number;
}

export interface DeleteWebhookResult {
  deleted: boolean;
  id: string;
}

// ─── Stacks ───────────────────────────────────────────────────────────────────

export interface CreateStackOptions {
  /** Domain to provision, e.g. "myagent.dev" */
  domain: string;
}

export interface Stack {
  id: string;
  domain: string;
  status: string;
  nameservers?: string[];
  next_steps?: string[];
}

export interface ListStacksResult {
  stacks: Stack[];
  count: number;
}

// ─── Observations ─────────────────────────────────────────────────────────────

export interface WriteObservationOptions {
  /** Topic to write under */
  topic: string;
  /** Content (max 10,000 chars) */
  content: string;
  /** If true, visible to all authenticated agents (default: false) */
  shared?: boolean;
  /** Optional display name for the writing agent */
  display_name?: string;
}

export interface Observation {
  id: string;
  topic: string;
  content: string;
  shared: boolean;
  agent_id: string;
  display_name?: string;
  created_at: string;
}

export interface ReadObservationsOptions {
  /** Filter by topic */
  topic?: string;
  /** Filter by agent_id */
  agent_id?: string;
  /** Only return observations created at or after this ISO timestamp */
  since?: string;
  /** Scope: 'mine' | 'shared' | 'all' (default: 'all') */
  scope?: 'mine' | 'shared' | 'all';
  /** Max results (default: 50, max: 200) */
  limit?: number;
}

export interface ReadObservationsResult {
  observations: Observation[];
  count: number;
  filters: Record<string, unknown>;
}

export interface ObservationTopic {
  topic: string;
  count: number;
  latest: string;
}

export interface ObservationsTopicsResult {
  topics: ObservationTopic[];
  count: number;
}

// ─── Vault ────────────────────────────────────────────────────────────────────

export interface VaultPutOptions {
  /**
   * Encrypted blob to store (typically base64url-encoded ciphertext).
   * The server stores this opaque blob — it never sees plaintext.
   * Use @agentlair/vault-crypto for client-side encryption.
   */
  ciphertext: string;
  /** Optional metadata object (max 4KB) — stored in plaintext, visible in index */
  metadata?: Record<string, unknown>;
}

export interface VaultPutResult {
  key: string;
  stored: boolean;
  /** New version number (increments on each PUT) */
  version: number;
  created_at: string;
  updated_at: string;
}

export interface VaultGetOptions {
  /** Specific version to retrieve (default: latest) */
  version?: number;
}

export interface VaultGetResult {
  key: string;
  /** The encrypted blob as stored */
  ciphertext: string;
  /** Same as ciphertext — v1 compatibility alias */
  value: string;
  metadata: Record<string, unknown> | null;
  version: number;
  latest_version: number;
  created_at: string;
  updated_at: string;
}

export interface VaultKeyInfo {
  key: string;
  version: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface VaultListResult {
  keys: VaultKeyInfo[];
  count: number;
  /** Maximum keys allowed on this tier */
  limit: number;
  tier: string;
}

export interface VaultDeleteOptions {
  /**
   * Specific version to delete. If omitted, all versions are deleted.
   */
  version?: number;
}

export interface VaultDeleteResult {
  key: string;
  deleted: boolean;
  /** Number of versions removed (when deleting all) */
  versions_removed?: number;
  /** Version removed (when deleting a single version) */
  version_removed?: number;
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export interface CreateCalendarEventOptions {
  /** Event title / summary */
  summary: string;
  /** ISO 8601 date ("2026-03-20") or datetime ("2026-03-20T14:00:00Z") */
  start: string;
  /** ISO 8601 date or datetime */
  end: string;
  /** Optional event description */
  description?: string;
  /** Optional location string */
  location?: string;
  /** Optional list of attendee email addresses */
  attendees?: string[];
}

export interface CalendarEvent {
  id: string;
  summary: string;
  /** ISO 8601 date or datetime */
  start: string;
  /** ISO 8601 date or datetime */
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateCalendarEventResult {
  event_id: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  created_at: string;
  note?: string;
}

export interface ListCalendarEventsOptions {
  /** ISO 8601 date — only return events starting on or after this */
  from?: string;
  /** ISO 8601 date — only return events starting on or before this */
  to?: string;
  /** Max results (default: 50, max: 200) */
  limit?: number;
}

export interface ListCalendarEventsResult {
  events: CalendarEvent[];
  count: number;
  total: number;
  limit: number;
  note?: string;
}

export interface CalendarFeedResult {
  /** Public iCal subscription URL — subscribe from Google Calendar, Apple Calendar, etc. */
  feed_url: string;
  /** The cal_token embedded in the feed_url */
  cal_token: string;
  note: string;
  how_to_subscribe: string;
}

export interface DeleteCalendarEventResult {
  event_id: string;
  deleted: boolean;
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export interface BudgetSetOptions {
  /** Daily spending cap in atomic USDC (1e-6; 1 USDC = 1_000_000) */
  daily?: number;
  /** Weekly spending cap in atomic USDC */
  weekly?: number;
  /** Monthly spending cap in atomic USDC */
  monthly?: number;
  /** What happens when the limit is hit: 'reject' (HTTP 402, default) or 'approve' (HTTP 202, awaits principal) */
  on_limit?: 'reject' | 'approve';
  /** Per-transaction hard limit in cents. Charges above this always require approval or are rejected. */
  single_tx_limit_cents?: number;
}

export interface BudgetCap {
  /** Cap limit in atomic USDC */
  limit_usdc: number;
  /** Amount spent so far in the current period (atomic USDC) */
  spent_usdc: number;
}

export interface BudgetResult {
  caps: {
    daily?: BudgetCap;
    weekly?: BudgetCap;
    monthly?: BudgetCap;
    [period: string]: BudgetCap | undefined;
  };
  on_limit: 'reject' | 'approve';
}

export interface BudgetChargeOptions {
  /** Amount to charge in atomic USDC (1e-6; 1 USDC = 1_000_000) */
  amount: number;
  /** Optional spending category (e.g. 'inference', 'storage') */
  category?: string;
  /** Human-readable description */
  description?: string;
  /** Optional reference ID — tie to your own request ID */
  reference_id?: string;
  /** Optional arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface BudgetExceededPeriod {
  period: string;
  spent_usdc: number;
  limit_usdc: number;
}

export interface BudgetChargeResult {
  /** Present when charge was completed immediately (HTTP 200) */
  charge_id?: string;
  /** Present when approval is required (HTTP 202) */
  approval_id?: string;
  /** Reason for pending approval: 'budget_exceeded' | 'single_tx_limit_exceeded' */
  reason?: string;
  /** ISO timestamp when the approval request expires */
  expires_at?: string;
  /** Which budget periods were exceeded */
  exceeded?: BudgetExceededPeriod[];
}

export interface BudgetApproval {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  amount_usdc: number;
  category?: string;
  description?: string;
  reference_id?: string;
  /** Rejection reason (if status is 'rejected') */
  reason?: string;
  created_at: string;
  expires_at: string;
  resolved_at?: string;
}

export interface ListApprovalsResult {
  approvals: BudgetApproval[];
  count: number;
}

export interface ApprovalActionResult {
  ok: boolean;
  id: string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Behavioral event category (RFC-003).
 * - tool: SDK/tool invocations
 * - resource: resource access (files, APIs)
 * - auth: authentication/authorization
 * - session: session lifecycle (start/end)
 * - escalation: escalations to humans
 * - delegation: sub-agent delegation
 * - error: error conditions
 */
export type EventCategory = 'tool' | 'resource' | 'auth' | 'session' | 'escalation' | 'delegation' | 'error';

/** Behavioral event outcome */
export type EventResult = 'success' | 'failure' | 'denied' | 'timeout';

/** Behavioral event to emit to the AgentLair trust engine (RFC-003 § 2.1). */
export interface EmitEventOptions {
  /** Behavioral category */
  category: EventCategory;
  /** Specific action (e.g. 'session_start', 'tool_call', 'email_send') */
  action: string;
  /** Outcome */
  result: EventResult;
  /** Optional resource type (e.g. 'tool', 'email', 'file') */
  resource_type?: string;
  /** Optional duration in milliseconds */
  duration_ms?: number;
  /** Optional error code (for result: 'failure') */
  error_code?: string;
  /** Optional scope used */
  scope_used?: string;
  /** Optional metadata (max 10 keys, string/number/boolean values, max 256 chars each) */
  metadata?: Record<string, string | number | boolean>;
  /** Optional Ed25519 signature for signed events */
  signature?: string;
  /** Optional event ID (UUID) — auto-generated if omitted */
  event_id?: string;
  /** Optional ISO 8601 timestamp — defaults to now if omitted */
  timestamp?: string;
  /** Optional session ID for grouping related events */
  session_id?: string;
}

/** Detail for a rejected event */
export interface EventError {
  event_id: string;
  reason: 'invalid_schema' | 'duplicate' | 'too_old' | 'future_timestamp' | 'rate_limited';
}

/** Response from POST /v1/events */
export interface EmitEventResult {
  accepted: number;
  rejected: number;
  errors?: EventError[];
  rate_limit: {
    remaining: number;
    reset_at: string;
  };
}

// ─── Trust ────────────────────────────────────────────────────────────────────

/** Trust dimension with score and confidence */
export interface TrustDimension {
  /** Score 0–100 */
  score: number;
  /** Confidence 0–1 */
  confidence: number;
}

/** Agent trust profile from GET /badge/{agentId}/score.json */
export interface TrustScoreResult {
  /** Agent account ID */
  agentId: string;
  /** Composite trust score 0–100 */
  score: number;
  /** Confidence 0–1 */
  confidence: number;
  /** AgentLair Trust Framework level */
  atfLevel: 'intern' | 'junior' | 'senior' | 'principal';
  /** Score trend (e.g. 'stable', 'improving', 'declining') */
  trend: string;
  /** Per-dimension breakdown */
  dimensions: {
    /** Behavioral consistency over time */
    consistency: TrustDimension;
    /** Restraint in resource/capability use */
    restraint: TrustDimension;
    /** Transparency in actions and reporting */
    transparency: TrustDimension;
  };
  /** Number of behavioral observations used */
  observationCount: number;
  /** ISO timestamp of last score computation */
  computedAt: string;
}

/** Badge style for trust badge SVG */
export type TrustBadgeStyle = 'flat' | 'flat-square' | 'for-the-badge';

// ─── Errors ───────────────────────────────────────────────────────────────────

export interface AgentLairErrorBody {
  error: string;
  message: string;
}
