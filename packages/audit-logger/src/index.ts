/**
 * @agentlair/audit-logger
 *
 * Framework-agnostic agent action logger. Zero runtime dependencies.
 * Works in Node ≥ 18, Bun, Deno, and modern browsers.
 *
 * --- Quick start ---
 *
 * import { auditLog } from '@agentlair/audit-logger';
 *
 * // Just log locally:
 * await auditLog({ agent: 'my-agent', action: 'tool_call', tool: 'search', input: query });
 *
 * // Connect to AgentLair (set AGENTLAIR_API_KEY env var):
 * await auditLog({ agent: 'my-agent', action: 'decision', output: result });
 *
 * --- Framework adapters ---
 *
 * import { AuditLoggerCallbackHandler } from '@agentlair/audit-logger/langchain';
 * import { wrapAnthropicClient }        from '@agentlair/audit-logger/anthropic';
 *
 * @see https://agentlair.dev/docs/audit-logger
 */

export { AuditLogger, auditLog, configureLogger, verifyChain, computeDigest } from './logger.js';
export type {
  AuditLogEntry,
  ResolvedAuditEntry,
  AuditSink,
  AuditLoggerOptions,
  AARSignature,
  AARPreAction,
  AARTerminalPhase,
  AARTerminalReceipt,
  /** @deprecated Use AARTerminalReceipt */
  AARPostAction,
  ChainVerificationResult,
} from './types.js';
