// ─── Types ───────────────────────────────────────────────────────────────────
// Core types for @agentlair/audit-logger

/** A single agent action to log */
export interface AuditLogEntry {
  /** Name/ID of the agent performing the action */
  agent: string;
  /** High-level action category (e.g. "tool_call", "llm_response", "decision") */
  action: string;
  /** Tool name, if this is a tool call */
  tool?: string;
  /** Input passed to the tool or LLM */
  input?: unknown;
  /** Output from the tool or LLM */
  output?: unknown;
  /** ISO 8601 timestamp — defaults to now */
  timestamp?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** A log entry with all fields resolved (timestamp guaranteed) */
export interface ResolvedAuditEntry extends AuditLogEntry {
  timestamp: string;
}

/** Sink: where to write audit logs */
export interface AuditSink {
  write(entry: ResolvedAuditEntry): Promise<void> | void;
}

/** Options for configuring the audit logger */
export interface AuditLoggerOptions {
  /**
   * AgentLair API key. If set (or AGENTLAIR_API_KEY env var), logs are also
   * shipped to AgentLair for persistent querying.
   */
  apiKey?: string;
  /** Base URL for AgentLair API. Defaults to https://agentlair.dev */
  baseUrl?: string;
  /**
   * Local sinks to write to in addition to (or instead of) console.
   * Pass an empty array to suppress console output.
   */
  sinks?: AuditSink[];
  /** If false, suppress console output. Default: true */
  console?: boolean;
  /** If true, suppress all output (useful in tests) */
  silent?: boolean;
  /** HMAC secret for signing AAR receipts */
  hmacSecret?: string;
  /** Actor identity for pre-action records */
  actorId?: string;
}

// ─── AAR Before/After Split Types ─────────────────────────────────────────────

export interface AARSignature {
  alg: 'EdDSA' | 'HMAC-SHA256';
  kid: string;    // key ID
  sig: string;    // hex-encoded signature
}

export interface AARPreAction {
  id: string;                        // random 20-char ID
  version: 'aar-v1';
  phase: 'pre-action';
  toolName: string;
  toolCallId: string;
  inputDigest: string;               // 'sha256:<hex>'
  actorId: string;
  sessionId?: string;
  policyRef?: string;
  approvalDecision?: 'approved' | 'denied' | 'conditional';
  decidedBy?: string;
  issuedAt: string;                  // ISO 8601 UTC
  previousReceiptHash?: string;      // undefined for first in chain
  signature?: AARSignature;
}

export type AARTerminalPhase = 'executed' | 'failed' | 'denied' | 'expired' | 'cancelled';

export interface AARTerminalReceipt {
  id: string;
  version: 'aar-v1';
  phase: AARTerminalPhase;
  preActionId: string;
  toolCallId: string;
  terminalAt: string;                // ISO 8601 UTC — always present. For 'expired', this is the timestamp the logger noticed expiry (not the policy deadline).
  terminalReason?: string;           // optional human-readable reason
  // Execution fields — ONLY when phase is 'executed' or 'failed'
  executionStartedAt?: string;
  executionEndedAt?: string;
  // Result fields — ONLY when phase is 'executed'
  resultDigest?: string;             // 'sha256:<hex>' of canonical output
  // Error fields — ONLY when phase is 'failed'
  errorClass?: string;
  // Chain
  previousReceiptHash: string;       // REQUIRED: hash of preAction without signature
  signature?: AARSignature;
}

/** @deprecated Use AARTerminalReceipt instead */
export type AARPostAction = AARTerminalReceipt;

export interface ChainVerificationResult {
  intact: boolean;
  chainIntegrity: 'complete' | 'incomplete' | 'broken';
  breaks: Array<{ id: string; expected: string | undefined; actual: string | undefined }>;
}
