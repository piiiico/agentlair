// ─── AuditLogger ─────────────────────────────────────────────────────────────
// Core logger class. Logs agent actions locally and optionally ships to AgentLair.
//
// Usage:
//   import { AuditLogger } from '@agentlair/audit-logger';
//   const logger = new AuditLogger(); // reads AGENTLAIR_API_KEY automatically
//   await logger.log({ agent: 'my-agent', action: 'tool_call', tool: 'search', input: query, output: results });

import type { AuditLogEntry, AuditLoggerOptions, AuditSink, ResolvedAuditEntry, AARPreAction, AARPostAction, AARTerminalReceipt, AARTerminalPhase, AARSignature, ChainVerificationResult, CanonicalizationVersion } from './types.js';

// ─── v0.5 default canonicalization version ────────────────────────────────────
/**
 * Default canonicalization scheme version applied when a caller passes a canonical
 * envelope without specifying a version. v0.5 ships exactly one scheme: `'cv1'`.
 * Successor schemes MUST be opted into explicitly per-receipt — there is no implicit
 * upgrade path.
 */
export const DEFAULT_CANONICALIZATION_VERSION: CanonicalizationVersion = 'cv1';

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
    /** Authority deadline (ISO 8601 UTC string or Date). See AARPreAction.expiresAt. */
    expiresAt?: string | Date;
    /**
     * v0.5: Consequential subset of the call (tool name, target, arguments, scope,
     * actor, policy/approval refs, execution-affecting defaults). When supplied, the
     * pre-action commits to this *envelope*'s hash — not the raw input bytes — so
     * approval binds the *meaning* of the call. Non-consequential transport metadata
     * (retry IDs, default timeouts, trace headers) should be omitted here even if
     * present in `input`.
     */
    canonicalInput?: unknown;
    /**
     * v0.5: Canonicalization scheme version. Defaults to `'cv1'` when
     * `canonicalInput` is supplied without an explicit version. Has no effect when
     * `canonicalInput` is omitted (legacy v0.4 receipt).
     */
    canonicalizationVersion?: CanonicalizationVersion;
  }): Promise<AARPreAction> {
    const expiresAtIso = opts.expiresAt === undefined
      ? undefined
      : (opts.expiresAt instanceof Date ? opts.expiresAt.toISOString() : opts.expiresAt);

    // v0.5: envelope hash + canonicalization version. Only embedded when the caller
    // supplies a canonical envelope; absence preserves v0.4 semantics.
    const hasCanonicalInput = opts.canonicalInput !== undefined;
    const approvedEnvelopeHash = hasCanonicalInput
      ? 'sha256:' + await sha256Hex(canonicalJson(opts.canonicalInput))
      : undefined;
    const canonicalizationVersion = hasCanonicalInput
      ? (opts.canonicalizationVersion ?? DEFAULT_CANONICALIZATION_VERSION)
      : undefined;

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
      ...(expiresAtIso !== undefined && { expiresAt: expiresAtIso }),
      ...(approvedEnvelopeHash !== undefined && { approvedEnvelopeHash }),
      ...(canonicalizationVersion !== undefined && { canonicalizationVersion }),
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
    /**
     * v0.5: Consequential subset of the call *at execution time*. Required when
     * `preAction.approvedEnvelopeHash` is set AND `phase === 'executed'`. The terminal
     * embeds `effectiveEnvelopeHash` computed from this value; `endAction()` refuses to
     * seal an `executed` terminal when the hash differs from the approved envelope.
     *
     * Drift here is named, not silent: callers should pivot to `phase: 'cancelled'`
     * with `terminalReason: 'effective_call_changed'` and open a fresh `beginAction`
     * for the mutated envelope. Carrying `policyRef` forward into the new pre-action
     * is detected as a chain break at verify time.
     */
    effectiveCanonicalInput?: unknown;
    /**
     * v0.5: Canonicalization scheme version for `effectiveCanonicalInput`. Must equal
     * `preAction.canonicalizationVersion`; cross-version sealing throws.
     */
    canonicalizationVersion?: CanonicalizationVersion;
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

    // Sign-time invariant: executed phase is not allowed after the pre-action's expiresAt.
    // executionEndedAt is the source of truth here — when endedAt is omitted, fall back to now.
    if (phase === 'executed' && preAction.expiresAt !== undefined) {
      const executionEndedAt = endedAt?.toISOString() ?? now.toISOString();
      if (executionEndedAt > preAction.expiresAt) {
        throw new Error(
          `Cannot record 'executed' terminal after pre-action expiresAt ` +
          `(preActionId: ${preAction.id}, expiresAt: ${preAction.expiresAt}, executionEndedAt: ${executionEndedAt})`
        );
      }
    }

    // v0.5 Sign-time invariant: when the pre-action committed to an approved envelope,
    // sealing 'executed' requires an effective envelope that matches under the same
    // canonicalization version. Drift on any consequential field (tool name, target,
    // arguments, scope, actor, policy ref, execution-affecting defaults) fails closed.
    let effectiveEnvelopeHash: string | undefined;
    let effectiveCanonicalizationVersion: CanonicalizationVersion | undefined;
    if (phase === 'executed' && preAction.approvedEnvelopeHash !== undefined) {
      if (opts.effectiveCanonicalInput === undefined) {
        throw new Error(
          `Cannot record 'executed' terminal without effectiveCanonicalInput when the ` +
          `pre-action carries approvedEnvelopeHash ` +
          `(preActionId: ${preAction.id})`
        );
      }
      const declaredVersion =
        opts.canonicalizationVersion ?? preAction.canonicalizationVersion ?? DEFAULT_CANONICALIZATION_VERSION;
      if (preAction.canonicalizationVersion !== undefined && declaredVersion !== preAction.canonicalizationVersion) {
        throw new Error(
          `Cannot record 'executed' terminal across canonicalizationVersion boundary ` +
          `(preActionId: ${preAction.id}, ` +
          `pre-action.canonicalizationVersion: ${preAction.canonicalizationVersion}, ` +
          `terminal.canonicalizationVersion: ${declaredVersion})`
        );
      }
      effectiveCanonicalizationVersion = declaredVersion;
      effectiveEnvelopeHash = 'sha256:' + await sha256Hex(canonicalJson(opts.effectiveCanonicalInput));
      if (effectiveEnvelopeHash !== preAction.approvedEnvelopeHash) {
        throw new Error(
          `Cannot record 'executed' terminal: effective envelope hash differs from ` +
          `approved envelope hash — close this authority with ` +
          `phase: 'cancelled', terminalReason: 'effective_call_changed' and open a new ` +
          `beginAction for the mutated envelope ` +
          `(preActionId: ${preAction.id}, ` +
          `approvedEnvelopeHash: ${preAction.approvedEnvelopeHash}, ` +
          `effectiveEnvelopeHash: ${effectiveEnvelopeHash})`
        );
      }
    }

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
      // v0.5 envelope binding (only for executed phase against a v0.5 pre-action)
      ...(effectiveEnvelopeHash !== undefined && { effectiveEnvelopeHash }),
      ...(effectiveCanonicalizationVersion !== undefined && {
        canonicalizationVersion: effectiveCanonicalizationVersion,
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
 * v0.5 verifier options. Each capability is opt-in — omitting all options gives a
 * pure-structural verification (hash chain, terminal completeness, authority
 * deadlines, envelope-drift between approved/effective when both hashes are stored).
 *
 * Supplying `replayedCanonicalInputs` / `replayedRawInputs` activates byte-level
 * comparisons against the stored hashes — this is how the verifier distinguishes
 * the three drift categories rpelevin's v0.5 spec names:
 *
 * 1. **approved-envelope drift** — the canonical envelope on disk no longer hashes
 *    to `approvedEnvelopeHash`. Detected via `replayedCanonicalInputs`.
 * 2. **effective-envelope drift** — `effectiveEnvelopeHash !== approvedEnvelopeHash`.
 *    Detected without any replay (hashes are both on the receipts).
 * 3. **raw-input byte drift** — the raw input no longer hashes to `inputDigest`.
 *    Detected via `replayedRawInputs`.
 */
export interface VerifyChainOptions {
  /**
   * Map `preActionId → canonical envelope` replayed by the verifier. When supplied,
   * the verifier recomputes the approved envelope hash from each value and compares
   * it against the stored `approvedEnvelopeHash`. Mismatch is reported with
   * `expected: 'approvedEnvelopeHash matches replay'` (approved-envelope drift).
   */
  replayedCanonicalInputs?: Record<string, unknown>;
  /**
   * Map `preActionId → raw input` replayed by the verifier. When supplied, the
   * verifier recomputes `inputDigest` and reports mismatch as
   * `expected: 'inputDigest matches replay'` (raw-input byte drift).
   */
  replayedRawInputs?: Record<string, unknown>;
  /**
   * Canonicalization version the verifier intends to evaluate envelopes under. When
   * unset, each receipt's stored `canonicalizationVersion` is used. When set and it
   * differs from the receipt's stored version, replay fails closed unless
   * `migrationVerifiers[receipt-stored-version]` provides an explicit migration.
   */
  canonicalizationVersion?: CanonicalizationVersion;
  /**
   * Optional migration functions keyed by the receipt's stored canonicalization
   * version. When present, the verifier permits cross-version replay by applying the
   * migration function before re-hashing. Absent → cross-version replay is rejected.
   */
  migrationVerifiers?: Record<string, (value: unknown) => unknown>;
}

/**
 * Verify the integrity of an AAR receipt chain.
 * Each receipt's previousReceiptHash must match sha256 of the prior receipt (without signature).
 * First receipt must have previousReceiptHash = undefined.
 * Also checks that every AARPreAction has at least one corresponding AARTerminalReceipt.
 *
 * v0.5 additions: envelope-drift detection between approved and effective hashes,
 * canonicalization-version equality between pre-action and terminal, and policyRef
 * carryover rejection across `effective_call_changed` cancellations.
 */
export async function verifyChain(
  receipts: Array<AARPreAction | AARTerminalReceipt | AARPostAction>,
  options: VerifyChainOptions = {}
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

  // Authority check: verify expiresAt invariants for terminals that depend on it.
  // - phase === 'expired' MUST have a pre-action with expiresAt set, and terminalAt >= expiresAt.
  // - phase === 'executed' with executionEndedAt > pre-action.expiresAt is a chain break
  //   (catches historical chains written pre-v0.4 that violate the sign-time invariant).
  const preActionsById = new Map<string, AARPreAction>();
  for (const receipt of receipts) {
    if (receipt.phase === 'pre-action') {
      preActionsById.set(receipt.id, receipt as AARPreAction);
    }
  }
  for (const receipt of receipts) {
    if (receipt.phase === 'pre-action') continue;
    const term = receipt as AARTerminalReceipt;
    const pre = preActionsById.get(term.preActionId);
    if (!pre) continue; // missing pre-action is already accounted for above

    if (term.phase === 'expired') {
      if (pre.expiresAt === undefined) {
        breaks.push({
          id: term.id,
          expected: 'pre-action.expiresAt set for expired terminal',
          actual: 'undefined',
        });
      } else if (term.terminalAt < pre.expiresAt) {
        breaks.push({
          id: term.id,
          expected: `terminalAt >= expiresAt (${pre.expiresAt})`,
          actual: term.terminalAt,
        });
      }
    } else if (term.phase === 'executed' && pre.expiresAt !== undefined) {
      // executionEndedAt is the source of truth for "did we finish in time?".
      // Fall back to terminalAt when execution timestamps were not recorded.
      const executionEndedAt = term.executionEndedAt ?? term.terminalAt;
      if (executionEndedAt > pre.expiresAt) {
        breaks.push({
          id: term.id,
          expected: `executionEndedAt <= expiresAt (${pre.expiresAt})`,
          actual: executionEndedAt,
        });
      }
    }
  }

  // v0.5 envelope checks. Three drift categories are reported by distinct `expected`
  // strings so callers can route them differently (approved-envelope drift implies
  // tampering with stored envelopes; effective-envelope drift implies the executor
  // deviated from approval; raw-input drift implies the literal payload was rewritten).
  for (const receipt of receipts) {
    if (receipt.phase === 'pre-action') {
      const pre = receipt as AARPreAction;
      // Approved-envelope drift: replayed canonical input no longer hashes to the
      // stored approvedEnvelopeHash. Requires the verifier to supply the replay.
      if (
        pre.approvedEnvelopeHash !== undefined &&
        options.replayedCanonicalInputs !== undefined &&
        Object.prototype.hasOwnProperty.call(options.replayedCanonicalInputs, pre.id)
      ) {
        const replay = options.replayedCanonicalInputs[pre.id];
        const targetVersion = options.canonicalizationVersion ?? pre.canonicalizationVersion;
        // Cross-version replay requires an explicit migration verifier — otherwise
        // fail closed. (Test 6 of rpelevin's v0.5 gate.)
        if (
          options.canonicalizationVersion !== undefined &&
          pre.canonicalizationVersion !== undefined &&
          options.canonicalizationVersion !== pre.canonicalizationVersion
        ) {
          const migrate = options.migrationVerifiers?.[pre.canonicalizationVersion];
          if (migrate === undefined) {
            breaks.push({
              id: pre.id,
              expected: `canonicalizationVersion match or migration verifier (${pre.canonicalizationVersion} → ${options.canonicalizationVersion})`,
              actual: 'no migration verifier supplied',
            });
            continue;
          }
          const migrated = migrate(replay);
          const recomputed = 'sha256:' + await sha256Hex(canonicalJson(migrated));
          if (recomputed !== pre.approvedEnvelopeHash) {
            breaks.push({
              id: pre.id,
              expected: 'approvedEnvelopeHash matches replay',
              actual: recomputed,
            });
          }
        } else {
          void targetVersion;
          const recomputed = 'sha256:' + await sha256Hex(canonicalJson(replay));
          if (recomputed !== pre.approvedEnvelopeHash) {
            breaks.push({
              id: pre.id,
              expected: 'approvedEnvelopeHash matches replay',
              actual: recomputed,
            });
          }
        }
      }
      // Raw-input byte drift: replayed raw input no longer hashes to inputDigest.
      if (
        options.replayedRawInputs !== undefined &&
        Object.prototype.hasOwnProperty.call(options.replayedRawInputs, pre.id)
      ) {
        const rawReplay = options.replayedRawInputs[pre.id];
        const recomputedRaw = 'sha256:' + await sha256Hex(canonicalJson(rawReplay));
        if (recomputedRaw !== pre.inputDigest) {
          breaks.push({
            id: pre.id,
            expected: 'inputDigest matches replay',
            actual: recomputedRaw,
          });
        }
      }
      continue;
    }
    // Terminal-side envelope checks
    const term = receipt as AARTerminalReceipt;
    const pre = preActionsById.get(term.preActionId);
    if (!pre) continue;
    if (term.phase === 'executed' && pre.approvedEnvelopeHash !== undefined) {
      if (term.effectiveEnvelopeHash === undefined) {
        breaks.push({
          id: term.id,
          expected: 'effectiveEnvelopeHash set for executed terminal against v0.5 pre-action',
          actual: 'undefined',
        });
      } else if (term.effectiveEnvelopeHash !== pre.approvedEnvelopeHash) {
        breaks.push({
          id: term.id,
          expected: `effectiveEnvelopeHash === approvedEnvelopeHash (${pre.approvedEnvelopeHash})`,
          actual: term.effectiveEnvelopeHash,
        });
      }
      if (
        pre.canonicalizationVersion !== undefined &&
        term.canonicalizationVersion !== undefined &&
        term.canonicalizationVersion !== pre.canonicalizationVersion
      ) {
        breaks.push({
          id: term.id,
          expected: `canonicalizationVersion match (${pre.canonicalizationVersion})`,
          actual: term.canonicalizationVersion,
        });
      }
    }
  }

  // v0.5 policyRef-after-cancellation rejection. After a `cancelled` terminal whose
  // terminalReason is `effective_call_changed`, the next pre-action in the chain must
  // not reuse the cancelled pre-action's policyRef — a different envelope is a
  // different decision.
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (r.phase !== 'cancelled') continue;
    const cancelled = r as AARTerminalReceipt;
    if (cancelled.terminalReason !== 'effective_call_changed') continue;
    const cancelledPre = preActionsById.get(cancelled.preActionId);
    if (cancelledPre?.policyRef === undefined) continue;
    // Find the next pre-action after this terminal in the chain.
    for (let j = i + 1; j < receipts.length; j++) {
      const next = receipts[j];
      if (next.phase !== 'pre-action') continue;
      const nextPre = next as AARPreAction;
      if (nextPre.policyRef === cancelledPre.policyRef) {
        breaks.push({
          id: nextPre.id,
          expected: `policyRef differs from cancelled pre-action ${cancelledPre.id} (effective_call_changed)`,
          actual: nextPre.policyRef,
        });
      }
      break;
    }
  }

  const authorityBreakExpected = new Set([
    'pre-action.expiresAt set for expired terminal',
  ]);
  const envelopeBreakPrefixes = [
    'approvedEnvelopeHash matches replay',
    'effectiveEnvelopeHash set for executed terminal against v0.5 pre-action',
    'effectiveEnvelopeHash === approvedEnvelopeHash',
    'canonicalizationVersion match',
    'canonicalizationVersion match or migration verifier',
    'inputDigest matches replay',
    'policyRef differs from cancelled pre-action',
  ];
  const isEnvelopeBreak = (expected: string | undefined): boolean =>
    typeof expected === 'string' && envelopeBreakPrefixes.some(p => expected.startsWith(p));
  const hasHashBreaks = breaks.some(b =>
    b.expected !== 'terminal-receipt' &&
    !isEnvelopeBreak(b.expected) &&
    !(typeof b.expected === 'string' && (
      b.expected.startsWith('terminalAt >=') ||
      b.expected.startsWith('executionEndedAt <=') ||
      authorityBreakExpected.has(b.expected)
    ))
  );
  const hasAuthorityBreaks = breaks.some(b =>
    typeof b.expected === 'string' && (
      b.expected.startsWith('terminalAt >=') ||
      b.expected.startsWith('executionEndedAt <=') ||
      authorityBreakExpected.has(b.expected)
    )
  );
  const hasEnvelopeBreaks = breaks.some(b => isEnvelopeBreak(b.expected));
  const hasMissingTerminals = breaks.some(b => b.expected === 'terminal-receipt');

  let chainIntegrity: 'complete' | 'incomplete' | 'broken';
  if (hasHashBreaks || hasAuthorityBreaks || hasEnvelopeBreaks) {
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
