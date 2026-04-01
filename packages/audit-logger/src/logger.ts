// ─── AuditLogger ─────────────────────────────────────────────────────────────
// Core logger class. Logs agent actions locally and optionally ships to AgentLair.
//
// Usage:
//   import { AuditLogger } from '@agentlair/audit-logger';
//   const logger = new AuditLogger(); // reads AGENTLAIR_API_KEY automatically
//   await logger.log({ agent: 'my-agent', action: 'tool_call', tool: 'search', input: query, output: results });

import type { AuditLogEntry, AuditLoggerOptions, AuditSink, ResolvedAuditEntry } from './types.js';

export class AuditLogger {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly sinks: AuditSink[];
  private readonly useConsole: boolean;
  private readonly silent: boolean;

  constructor(options: AuditLoggerOptions = {}) {
    // Resolve API key from options or env
    this.apiKey = options.apiKey ?? (
      typeof process !== 'undefined' ? process.env.AGENTLAIR_API_KEY : undefined
    );
    this.baseUrl = (options.baseUrl ?? 'https://agentlair.dev').replace(/\/$/, '');
    this.sinks = options.sinks ?? [];
    this.useConsole = options.console !== false;
    this.silent = options.silent ?? false;
  }

  /**
   * Log a single agent action.
   * - Always writes to console (unless silent/disabled)
   * - Writes to any configured sinks
   * - If apiKey is present, ships to AgentLair async (non-blocking)
   */
  async log(entry: AuditLogEntry): Promise<ResolvedAuditEntry> {
    const resolved: ResolvedAuditEntry = {
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };

    if (!this.silent) {
      // Console output
      if (this.useConsole) {
        this.writeConsole(resolved);
      }

      // Custom sinks
      for (const sink of this.sinks) {
        await sink.write(resolved);
      }

      // AgentLair backend (fire-and-forget, non-blocking)
      if (this.apiKey) {
        this.shipToAgentLair(resolved).catch((err) => {
          // Non-fatal — log locally but don't throw
          console.warn('[audit-logger] AgentLair upload failed:', (err as Error).message);
        });
      }
    }

    return resolved;
  }

  /** Convenience: log multiple entries in sequence */
  async logAll(entries: AuditLogEntry[]): Promise<ResolvedAuditEntry[]> {
    const results: ResolvedAuditEntry[] = [];
    for (const entry of entries) {
      results.push(await this.log(entry));
    }
    return results;
  }

  private writeConsole(entry: ResolvedAuditEntry): void {
    const tool = entry.tool ? ` [${entry.tool}]` : '';
    const ts = entry.timestamp.slice(11, 19); // HH:MM:SS
    console.log(`[audit ${ts}] ${entry.agent} → ${entry.action}${tool}`);
  }

  private async shipToAgentLair(entry: ResolvedAuditEntry): Promise<void> {
    // Use AgentLair Observations API with topic "audit-log"
    // Content is serialized JSON of the full entry
    const payload = {
      topic: 'audit-log',
      content: JSON.stringify(entry),
    };

    const res = await fetch(`${this.baseUrl}/v1/observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AgentLair ${res.status}: ${text}`);
    }
  }
}

// ─── Module-level convenience API ────────────────────────────────────────────
// Uses a default logger instance (lazy-initialized on first call).

let _defaultLogger: AuditLogger | null = null;

function getDefaultLogger(): AuditLogger {
  if (!_defaultLogger) {
    _defaultLogger = new AuditLogger();
  }
  return _defaultLogger;
}

/**
 * Log an agent action using the default logger.
 * Reads AGENTLAIR_API_KEY from environment automatically.
 *
 * @example
 * import { auditLog } from '@agentlair/audit-logger';
 * await auditLog({ agent: 'researcher', action: 'tool_call', tool: 'web_search', input: query });
 */
export async function auditLog(entry: AuditLogEntry): Promise<ResolvedAuditEntry> {
  return getDefaultLogger().log(entry);
}

/**
 * Configure the default logger instance.
 * Call this once at startup before any auditLog() calls.
 */
export function configureLogger(options: AuditLoggerOptions): void {
  _defaultLogger = new AuditLogger(options);
}
