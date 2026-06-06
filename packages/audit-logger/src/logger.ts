// ─── AuditLogger ─────────────────────────────────────────────────────────────
// Core logger class. Logs agent actions locally and optionally ships to AgentLair.
//
// Usage:
//   import { AuditLogger } from '@agentlair/audit-logger';
//   const logger = new AuditLogger(); // reads AGENTLAIR_API_KEY automatically
//   await logger.log({ agent: 'my-agent', action: 'tool_call', tool: 'search', input: query, output: results });

import type { AuditLogEntry, AuditLoggerOptions, AuditSink, ResolvedAuditEntry, AARPreAction, AARPostAction, AARTerminalReceipt, AARTerminalPhase, AARSignature, ChainVerificationResult } from './types.js';

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + (value as unknown[]).map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value as object).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPayload(payload: object): Promise<string> {
  return 'sha256:' + await sha256Hex(canonicalJson(payload));
}

function generateId(length = 20): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

export class AuditLogger {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly sinks: AuditSink[];
  private readonly useConsole: boolean;
  private readonly silent: boolean;
  private lastReceiptHash: string | undefined = undefined;
  private readonly hmacSecret: string | undefined;
  private readonly actorId: string;

  constructor(options: AuditLoggerOptions = {}) {
    // Resolve API key from options or env
    this.apiKey = options.apiKey ?? (
      typeof process !== 'undefined' ? process.env.AGENTLAIR_API_KEY : undefined
    );
    this.baseUrl = (options.baseUrl ?? 'https://agentlair.dev').replace(/\/$/, '');
    this.sinks = options.sinks ?? [];
    this.useConsole = options.console !== false;
    this.silent = options.silent ?? false;
    this.hmacSecret = options.hmacSecret;
    this.actorId = options.actorId ?? 'unknown';
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

  /**
   * Call BEFORE tool execution begins.
   * Signs and chains the pre-action authority record.
   * Returns the pre-action record — pass it to endAction().
   */
  async beginAction(opts: {
    toolName: string;
    toolCallId: string;
    input: unknown;
    policyRef?: string;
    approvalDecision?: 'approved' | 'denied' | 'conditional';
    decidedBy?: string;
    sessionId?: string;
  }): Promise<AARPreAction> {
    const preActionBase: Omit<AARPreAction, 'signature'> = {
      id: generateId(),
      version: 'aar-v1',
      phase: 'pre-action',
      toolName: opts.toolName,
      toolCallId: opts.toolCallId,
      inputDigest: 'sha256:' + await sha256Hex(canonicalJson(opts.input)),
      actorId: this.actorId,
      issuedAt: new Date().toISOString(),
      ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
      ...(opts.policyRef !== undefined && { policyRef: opts.policyRef }),
      ...(opts.approvalDecision !== undefined && { approvalDecision: opts.approvalDecision }),
      ...(opts.decidedBy !== undefined && { decidedBy: opts.decidedBy }),
      ...(this.lastReceiptHash !== undefined && { previousReceiptHash: this.lastReceiptHash }),
    };

    // Update chain state BEFORE signing (signature excluded from hash)
    this.lastReceiptHash = await hashPayload(preActionBase);

    const preAction: AARPreAction = { ...preActionBase };
    if (this.hmacSecret) {
      preAction.signature = await this.hmacSignPayload(preActionBase);
    }

    if (this.apiKey && !this.silent) {
      this.shipReceiptToAgentLair(preAction).catch((err) => {
        console.warn('[audit-logger] AgentLair receipt upload failed:', (err as Error).message);
      });
    }

    return preAction;
  }

  /**
   * Call AFTER tool execution completes (or is denied, cancelled, expired, etc.).
   * Signs and chains the terminal receipt.
   */
  async endAction(opts: {
    preAction: AARPreAction;
    phase?: AARTerminalPhase;  // defaults to 'executed' if output provided, 'failed' if error provided
    startedAt?: Date;          // only relevant for executed/failed phases
    endedAt?: Date;            // only relevant for executed/failed phases
    output?: unknown;          // only for executed phase
    error?: Error;             // implies failed phase
    terminalReason?: string;
  }): Promise<AARTerminalReceipt> {
    const { preAction, startedAt, endedAt, output, error, terminalReason } = opts;

    // Phase resolution
    let phase: AARTerminalPhase;
    if (error !== undefined) {
      phase = 'failed';
    } else if (opts.phase !== undefined) {
      phase = opts.phase;
    } else {
      phase = 'executed';
    }

    // Sign-time invariant: executed phase is not allowed for denied pre-actions
    if (phase === 'executed' && preAction.approvalDecision === 'denied') {
      throw new Error(
        `Cannot record 'executed' terminal for a denied pre-action (preActionId: ${preAction.id})`
      );
    }

    const now = new Date();
    const terminalAt = endedAt?.toISOString() ?? now.toISOString();

    // Hash the preAction without signature to create the chain link
    const { signature: _sig, ...preActionWithoutSig } = preAction;
    const preActionHash = await hashPayload(preActionWithoutSig);

    const receiptBase: Omit<AARTerminalReceipt, 'signature'> = {
      id: generateId(),
      version: 'aar-v1',
      phase,
      preActionId: preAction.id,
      toolCallId: preAction.toolCallId,
      terminalAt,
      previousReceiptHash: preActionHash,
      ...(terminalReason !== undefined && { terminalReason }),
      // Execution fields only for executed/failed phases
      ...((phase === 'executed' || phase === 'failed') && startedAt !== undefined && {
        executionStartedAt: startedAt.toISOString(),
      }),
      ...((phase === 'executed' || phase === 'failed') && endedAt !== undefined && {
        executionEndedAt: endedAt.toISOString(),
      }),
      // Result digest only for executed phase
      ...(phase === 'executed' && output !== undefined && {
        resultDigest: 'sha256:' + await sha256Hex(canonicalJson(output)),
      }),
      // Error class only for failed phase
      ...(phase === 'failed' && error !== undefined && {
        errorClass: error.constructor.name,
      }),
    };

    // Update chain state
    this.lastReceiptHash = await hashPayload(receiptBase);

    const receipt: AARTerminalReceipt = { ...receiptBase };
    if (this.hmacSecret) {
      receipt.signature = await this.hmacSignPayload(receiptBase);
    }

    if (this.apiKey && !this.silent) {
      this.shipReceiptToAgentLair(receipt).catch((err) => {
        console.warn('[audit-logger] AgentLair receipt upload failed:', (err as Error).message);
      });
    }

    return receipt;
  }

  private async hmacSignPayload(payload: object): Promise<AARSignature> {
    const canon = canonicalJson(payload);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.hmacSecret!),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canon));
    return {
      alg: 'HMAC-SHA256',
      kid: 'hmac-sha256',
      sig: Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join(''),
    };
  }

  private async shipReceiptToAgentLair(receipt: AARPreAction | AARTerminalReceipt): Promise<void> {
    const payload = {
      topic: 'aar-receipt',
      content: JSON.stringify(receipt),
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

// ─── Chain verification ───────────────────────────────────────────────────────

/**
 * Verify the integrity of an AAR receipt chain.
 * Each receipt's previousReceiptHash must match sha256 of the prior receipt (without signature).
 * First receipt must have previousReceiptHash = undefined.
 * Also checks that every AARPreAction has at least one corresponding AARTerminalReceipt.
 */
export async function verifyChain(
  receipts: Array<AARPreAction | AARTerminalReceipt | AARPostAction>
): Promise<ChainVerificationResult> {
  if (receipts.length === 0) {
    return { intact: true, chainIntegrity: 'complete', breaks: [] };
  }

  const breaks: ChainVerificationResult['breaks'] = [];

  // First receipt should have no previousReceiptHash
  const first = receipts[0];
  if (first.previousReceiptHash !== undefined) {
    return {
      intact: false,
      chainIntegrity: 'incomplete',
      breaks: [{ id: first.id, expected: undefined, actual: first.previousReceiptHash }],
    };
  }

  for (let i = 1; i < receipts.length; i++) {
    const prev = receipts[i - 1];
    const curr = receipts[i];

    // Hash prev without signature
    const { signature: _sig, ...prevWithoutSig } = prev as AARPreAction;
    const expectedHash = await hashPayload(prevWithoutSig);
    const actualHash = curr.previousReceiptHash;

    if (actualHash !== expectedHash) {
      breaks.push({ id: curr.id, expected: expectedHash, actual: actualHash });
    }
  }

  // Check that every pre-action has at least one terminal receipt
  const terminalPreActionIds = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.phase !== 'pre-action') {
      // It's a terminal receipt (AARTerminalReceipt); grab its preActionId
      terminalPreActionIds.add((receipt as AARTerminalReceipt).preActionId);
    }
  }

  for (const receipt of receipts) {
    if (receipt.phase === 'pre-action') {
      const preAction = receipt as AARPreAction;
      if (!terminalPreActionIds.has(preAction.id)) {
        breaks.push({ id: preAction.id, expected: 'terminal-receipt', actual: 'missing' });
      }
    }
  }

  const hasHashBreaks = breaks.some(b => b.expected !== 'terminal-receipt');
  const hasMissingTerminals = breaks.some(b => b.expected === 'terminal-receipt');

  let chainIntegrity: 'complete' | 'incomplete' | 'broken';
  if (hasHashBreaks) {
    chainIntegrity = 'broken';
  } else if (hasMissingTerminals) {
    chainIntegrity = 'incomplete';
  } else {
    chainIntegrity = 'complete';
  }

  return {
    intact: breaks.length === 0,
    chainIntegrity,
    breaks,
  };
}

/**
 * Compute the sha256 digest of a value (canonical JSON).
 * Useful for verifying inputDigest independently.
 */
export async function computeDigest(value: unknown): Promise<string> {
  return 'sha256:' + await sha256Hex(canonicalJson(value));
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
