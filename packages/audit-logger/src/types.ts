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
}
