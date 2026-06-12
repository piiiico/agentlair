// ─── Tests for @agentlair/audit-logger ───────────────────────────────────────

import { describe, it, expect } from 'bun:test';
import {
  AuditLogger,
  auditLog,
  configureLogger,
  verifyChain,
  computeDigest,
  InMemoryPolicyProfileBindingRegistry,
  BeginActionRefusal,
  computeCanonicalizerProfileHash,
  computePolicySurfaceHash,
} from './logger.js';
import type { CanonicalizerProfile, PolicySurface } from './types.js';

describe('AuditLogger', () => {
  it('resolves timestamp when not provided', async () => {
    const logger = new AuditLogger({ silent: true });
    const entry = await logger.log({ agent: 'test', action: 'test_action' });
    expect(entry.timestamp).toBeDefined();
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it('preserves provided timestamp', async () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const logger = new AuditLogger({ silent: true });
    const entry = await logger.log({ agent: 'test', action: 'test_action', timestamp: ts });
    expect(entry.timestamp).toBe(ts);
  });

  it('passes through all fields', async () => {
    const logger = new AuditLogger({ silent: true });
    const entry = await logger.log({
      agent: 'researcher',
      action: 'tool_call',
      tool: 'web_search',
      input: 'AgentLair docs',
      output: ['result1', 'result2'],
      metadata: { source: 'test' },
    });
    expect(entry.agent).toBe('researcher');
    expect(entry.action).toBe('tool_call');
    expect(entry.tool).toBe('web_search');
    expect(entry.input).toBe('AgentLair docs');
    expect(Array.isArray(entry.output)).toBe(true);
    expect(entry.metadata?.source).toBe('test');
  });

  it('logAll processes multiple entries', async () => {
    const logger = new AuditLogger({ silent: true });
    const entries = await logger.logAll([
      { agent: 'a', action: 'step_1' },
      { agent: 'a', action: 'step_2' },
      { agent: 'a', action: 'step_3' },
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0].action).toBe('step_1');
    expect(entries[2].action).toBe('step_3');
  });

  it('writes to custom sinks', async () => {
    const collected: string[] = [];
    const logger = new AuditLogger({
      silent: false,
      console: false,
      sinks: [{
        write(entry) { collected.push(entry.action); }
      }],
    });

    await logger.log({ agent: 'x', action: 'alpha' });
    await logger.log({ agent: 'x', action: 'beta' });
    expect(collected).toEqual(['alpha', 'beta']);
  });
});

describe('module-level auditLog', () => {
  it('works without configuration', async () => {
    // Configure to be silent so tests don't spam console
    configureLogger({ silent: true });
    const entry = await auditLog({ agent: 'test', action: 'module_level_test' });
    expect(entry.agent).toBe('test');
    expect(entry.action).toBe('module_level_test');
  });
});

describe('AAR beginAction/endAction', () => {
  it('missing pre-action → terminal receipt detected as incomplete chain', async () => {
    const logger = new AuditLogger({ silent: true });
    const preAction = await logger.beginAction({
      toolName: 'send_email',
      toolCallId: 'call-001',
      input: { to: 'test@example.com' },
    });
    const terminal = await logger.endAction({
      preAction,
      startedAt: new Date(0),
      endedAt: new Date(100),
      output: { messageId: 'msg-1' },
    });

    // Verify chain with only the terminal (pre-action "missing")
    const result = await verifyChain([terminal]);
    expect(result.intact).toBe(false);
    expect(result.chainIntegrity).toBe('incomplete');
    expect(result.breaks.length).toBeGreaterThan(0);
    expect(result.breaks[0].id).toBe(terminal.id);
  });

  it('input digest mismatch is detectable', async () => {
    const logger = new AuditLogger({ silent: true });
    const originalInput = { query: 'search for cats', limit: 10 };
    const tamperedInput = { query: 'search for cats', limit: 99 };

    const preAction = await logger.beginAction({
      toolName: 'search',
      toolCallId: 'call-002',
      input: originalInput,
    });

    const originalDigest = preAction.inputDigest;
    const tamperedDigest = await computeDigest(tamperedInput);

    // If input was tampered, digests differ — mismatch is detectable
    expect(originalDigest).not.toBe(tamperedDigest);
    // Original input matches
    expect(await computeDigest(originalInput)).toBe(originalDigest);
  });

  it('failed tool still emits terminal receipt with errorClass', async () => {
    const logger = new AuditLogger({ silent: true });
    const preAction = await logger.beginAction({
      toolName: 'risky_tool',
      toolCallId: 'call-003',
      input: { target: 'x' },
    });

    const toolError = new TypeError('network timeout');
    const terminal = await logger.endAction({
      preAction,
      startedAt: new Date(0),
      endedAt: new Date(500),
      error: toolError,
    });

    expect(terminal.phase).toBe('failed');
    expect(terminal.errorClass).toBe('TypeError');
    expect(terminal.resultDigest).toBeUndefined();
    expect(terminal.preActionId).toBe(preAction.id);
    expect(terminal.terminalAt).toBeDefined();
  });

  it('removing a receipt from multi-step chain is detectable via hash mismatch', async () => {
    const logger = new AuditLogger({ silent: true });

    const pre1 = await logger.beginAction({ toolName: 'step1', toolCallId: 'c1', input: 'a' });
    const term1 = await logger.endAction({ preAction: pre1, startedAt: new Date(0), endedAt: new Date(10), output: 'r1' });
    const pre2 = await logger.beginAction({ toolName: 'step2', toolCallId: 'c2', input: 'b' });
    const term2 = await logger.endAction({ preAction: pre2, startedAt: new Date(10), endedAt: new Date(20), output: 'r2' });

    // Complete chain verifies intact
    const completeResult = await verifyChain([pre1, term1, pre2, term2]);
    expect(completeResult.intact).toBe(true);

    // Remove term1 → chain breaks at pre2 (its previousReceiptHash points to term1)
    const brokenResult = await verifyChain([pre1, pre2, term2]);
    expect(brokenResult.intact).toBe(false);
    expect(brokenResult.chainIntegrity).toBe('broken');
    expect(brokenResult.breaks.length).toBeGreaterThan(0);
    // pre2's previousReceiptHash should now be wrong
    expect(brokenResult.breaks[0].id).toBe(pre2.id);
  });
});

describe('AAR v0.3 terminal-receipt regressions', () => {
  it('Test 1: denied without terminal = incomplete', async () => {
    const logger = new AuditLogger({ silent: true });
    const preAction = await logger.beginAction({
      toolName: 'delete_file',
      toolCallId: 'call-d1',
      input: { path: '/important.txt' },
      approvalDecision: 'denied',
      decidedBy: 'policy-engine',
    });

    // No endAction called — pre-action has no terminal receipt
    const result = await verifyChain([preAction]);
    expect(result.intact).toBe(false);
    expect(result.chainIntegrity).toBe('incomplete');
    expect(result.breaks.some(b => b.id === preAction.id && b.expected === 'terminal-receipt')).toBe(true);
  });

  it('Test 2: executed-after-denied = throw', async () => {
    const logger = new AuditLogger({ silent: true });
    const preAction = await logger.beginAction({
      toolName: 'delete_file',
      toolCallId: 'call-d2',
      input: { path: '/important.txt' },
      approvalDecision: 'denied',
    });

    await expect(
      logger.endAction({ preAction, phase: 'executed', output: 'result' })
    ).rejects.toThrow();
  });

  it('Test 3: inputDigest mismatch is detectable (tampered input)', async () => {
    const logger = new AuditLogger({ silent: true });
    const inputA = { query: 'hello', limit: 10 };
    const inputB = { query: 'hello', limit: 99 };

    const preAction = await logger.beginAction({
      toolName: 'search',
      toolCallId: 'call-d3',
      input: inputA,
    });

    const digestA = preAction.inputDigest;
    const digestB = await computeDigest(inputB);

    expect(digestA).not.toBe(digestB);
    expect(await computeDigest(inputA)).toBe(digestA);
  });

  it('Test 4: omitted denial terminal = hash mismatch on successor', async () => {
    const logger = new AuditLogger({ silent: true });

    // pre1 (approved) → term1 (executed)
    const pre1 = await logger.beginAction({ toolName: 'step1', toolCallId: 'c-d4-1', input: 'a', approvalDecision: 'approved' });
    const term1 = await logger.endAction({ preAction: pre1, phase: 'executed', output: 'r1' });

    // pre2 (denied) → term2 (denied)
    const pre2 = await logger.beginAction({ toolName: 'step2', toolCallId: 'c-d4-2', input: 'b', approvalDecision: 'denied' });
    const term2 = await logger.endAction({ preAction: pre2, phase: 'denied', terminalReason: 'Policy: denied' });

    // pre3 (approved) → term3 (executed)
    const pre3 = await logger.beginAction({ toolName: 'step3', toolCallId: 'c-d4-3', input: 'c', approvalDecision: 'approved' });
    const term3 = await logger.endAction({ preAction: pre3, phase: 'executed', output: 'r3' });

    // Full chain should be intact
    const fullResult = await verifyChain([pre1, term1, pre2, term2, pre3, term3]);
    expect(fullResult.intact).toBe(true);
    expect(fullResult.chainIntegrity).toBe('complete');

    // Omit term2 (the denied terminal) → pre3's hash should now be wrong
    const omittedResult = await verifyChain([pre1, term1, pre2, pre3, term3]);
    expect(omittedResult.intact).toBe(false);
    expect(omittedResult.chainIntegrity).toBe('broken');
    expect(omittedResult.breaks.some(b => b.id === pre3.id)).toBe(true);
  });
});

describe('AAR v0.4 expiresAt authority data', () => {
  it('Test 1: expired terminal with terminalAt > expiresAt verifies', async () => {
    const logger = new AuditLogger({ silent: true });
    const expiresAt = '2026-06-06T20:00:00.000Z';
    const noticedAt = new Date('2026-06-06T20:00:01.500Z'); // 1.5s after deadline

    const preAction = await logger.beginAction({
      toolName: 'send_email',
      toolCallId: 'c-e1',
      input: { to: 'a@b.com' },
      expiresAt,
    });
    expect(preAction.expiresAt).toBe(expiresAt);

    const terminal = await logger.endAction({
      preAction,
      phase: 'expired',
      endedAt: noticedAt,
      terminalReason: 'authority window elapsed before execution started',
    });

    const result = await verifyChain([preAction, terminal]);
    expect(result.intact).toBe(true);
    expect(result.chainIntegrity).toBe('complete');
  });

  it('Test 2: executed with executionEndedAt > expiresAt throws at sign time', async () => {
    const logger = new AuditLogger({ silent: true });
    const expiresAt = '2026-06-06T20:00:00.000Z';
    const lateEnd = new Date('2026-06-06T20:00:05.000Z'); // 5s past authority

    const preAction = await logger.beginAction({
      toolName: 'send_email',
      toolCallId: 'c-e2',
      input: { to: 'a@b.com' },
      expiresAt,
    });

    await expect(
      logger.endAction({
        preAction,
        phase: 'executed',
        startedAt: new Date('2026-06-06T19:59:59.000Z'),
        endedAt: lateEnd,
        output: { sent: true },
      })
    ).rejects.toThrow(/expiresAt/);
  });

  it('Test 3: tampered expiresAt on signed pre-action breaks the chain (proves expiresAt is hashed in)', async () => {
    const logger = new AuditLogger({ silent: true });
    const preAction = await logger.beginAction({
      toolName: 'send_email',
      toolCallId: 'c-e3',
      input: { to: 'a@b.com' },
      expiresAt: '2026-06-06T20:00:00.000Z',
    });
    const terminal = await logger.endAction({
      preAction,
      phase: 'executed',
      startedAt: new Date('2026-06-06T19:59:00.000Z'),
      endedAt: new Date('2026-06-06T19:59:30.000Z'),
      output: { sent: true },
    });

    // Tamper with expiresAt AFTER signing — verifier must catch it via the hash chain.
    const tamperedPre: typeof preAction = {
      ...preAction,
      expiresAt: '2099-01-01T00:00:00.000Z',
    };

    const result = await verifyChain([tamperedPre, terminal]);
    expect(result.intact).toBe(false);
    expect(result.chainIntegrity).toBe('broken');
    // The terminal's previousReceiptHash points to the ORIGINAL pre-action.
    expect(result.breaks.some(b => b.id === terminal.id)).toBe(true);
  });

  it('Test 4: expired terminal whose pre-action lacks expiresAt = chain broken', async () => {
    const logger = new AuditLogger({ silent: true });
    const preAction = await logger.beginAction({
      toolName: 'send_email',
      toolCallId: 'c-e4',
      input: { to: 'a@b.com' },
      // no expiresAt
    });

    const terminal = await logger.endAction({
      preAction,
      phase: 'expired',
      terminalReason: 'somehow expired despite no deadline',
    });

    const result = await verifyChain([preAction, terminal]);
    expect(result.intact).toBe(false);
    expect(result.chainIntegrity).toBe('broken');
    expect(result.breaks.some(b =>
      b.id === terminal.id &&
      typeof b.expected === 'string' &&
      b.expected.includes('expiresAt set for expired terminal')
    )).toBe(true);
  });

  it('Test 5: historical executed terminal whose executionEndedAt > expiresAt is flagged by verifyChain', async () => {
    // Cannot construct via endAction (sign-time invariant blocks it). Hand-construct a chain
    // representing a pre-v0.4 logger that did not enforce the invariant, then verify it.
    const logger = new AuditLogger({ silent: true });
    const preAction = await logger.beginAction({
      toolName: 'send_email',
      toolCallId: 'c-e5',
      input: { to: 'a@b.com' },
      expiresAt: '2026-06-06T20:00:00.000Z',
    });

    // Manually build a "v0.3-style" executed terminal that overruns expiresAt.
    // We compute previousReceiptHash the same way endAction does, so the hash chain
    // is intact — the only break is the authority invariant.
    const canonicalJsonOf = (v: any): string => {
      if (v === null || v === undefined) return 'null';
      if (typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(canonicalJsonOf).join(',') + ']';
      const keys = Object.keys(v).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJsonOf(v[k])).join(',') + '}';
    };
    const sha256Hex = async (s: string): Promise<string> => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    };
    const { signature: _sig, ...preWithoutSig } = preAction;
    const preHash = 'sha256:' + await sha256Hex(canonicalJsonOf(preWithoutSig));

    const overrunTerminal: any = {
      id: 'TestHistorical00000A',
      version: 'aar-v1',
      phase: 'executed',
      preActionId: preAction.id,
      toolCallId: preAction.toolCallId,
      terminalAt: '2026-06-06T20:00:10.000Z',
      executionStartedAt: '2026-06-06T19:59:30.000Z',
      executionEndedAt: '2026-06-06T20:00:10.000Z', // 10s past expiresAt
      resultDigest: 'sha256:' + await sha256Hex('"r5"'),
      previousReceiptHash: preHash,
    };

    const result = await verifyChain([preAction, overrunTerminal]);
    expect(result.intact).toBe(false);
    expect(result.chainIntegrity).toBe('broken');
    expect(result.breaks.some(b =>
      b.id === overrunTerminal.id &&
      typeof b.expected === 'string' &&
      b.expected.includes('executionEndedAt <=')
    )).toBe(true);
    // Suppress unused-binding lint
    void logger;
  });
});

// ─── v0.5: envelope-binding gate ─────────────────────────────────────────────
// Six negative tests rpelevin proposed on vercel/ai#13215 for the
// approved-vs-effective envelope hash gate.
describe('AAR v0.5 envelope binding', () => {
  // Test 1: metadata-only provider normalization keeps approved and effective
  // envelope hashes equal. The canonical envelope is the *consequential subset*;
  // transport/runtime noise (retry IDs, trace headers) lives outside that subset.
  it('Test 1: metadata-only normalization preserves envelope-hash equality', async () => {
    const logger = new AuditLogger({ silent: true });
    const canonical = {
      toolName: 'http_post',
      target: 'https://api.example.com/v1/charges',
      arguments: { amount: 500, currency: 'usd' },
      scope: 'payments:write',
      actorId: 'agent-001',
    };
    const pre = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T1',
      input: { ...canonical, _trace: 'trace-abc' },          // raw bytes include trace
      canonicalInput: canonical,
      approvalDecision: 'approved',
      policyRef: 'policy:t1',
    });
    expect(pre.approvedEnvelopeHash).toBeDefined();
    expect(pre.canonicalizationVersion).toBe('cv1');

    // Effective execution carries DIFFERENT non-consequential metadata. The canonical
    // envelope is unchanged, so the gate must pass.
    const term = await logger.endAction({
      preAction: pre,
      phase: 'executed',
      startedAt: new Date(0),
      endedAt: new Date(50),
      output: { id: 'ch_1' },
      effectiveCanonicalInput: canonical,
    });
    expect(term.effectiveEnvelopeHash).toBe(pre.approvedEnvelopeHash);
    expect(term.canonicalizationVersion).toBe('cv1');

    const result = await verifyChain([pre, term]);
    expect(result.intact).toBe(true);
    expect(result.chainIntegrity).toBe('complete');
  });

  // Test 2: target/resource change after approval refuses 'executed' and the only
  // legal close is `cancelled` with `effective_call_changed`. A new beginAction
  // for the mutated envelope is its own approval cycle.
  it('Test 2: target change rejects executed; cancelled effective_call_changed is the path', async () => {
    const logger = new AuditLogger({ silent: true });
    const approvedEnvelope = {
      toolName: 'http_post',
      target: 'https://api.example.com/v1/charges',
      arguments: { amount: 500 },
      actorId: 'agent-001',
    };
    const pre = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T2',
      input: approvedEnvelope,
      canonicalInput: approvedEnvelope,
      approvalDecision: 'approved',
      policyRef: 'policy:t2-original',
    });

    // Different target = different envelope → endAction(executed) must throw.
    const mutated = { ...approvedEnvelope, target: 'https://api.example.com/v1/transfers' };
    let threw = false;
    try {
      await logger.endAction({
        preAction: pre,
        phase: 'executed',
        output: { id: 'tr_1' },
        effectiveCanonicalInput: mutated,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('effective envelope hash differs');
    }
    expect(threw).toBe(true);

    // The legal close: cancelled + effective_call_changed.
    const cancelTerm = await logger.endAction({
      preAction: pre,
      phase: 'cancelled',
      terminalReason: 'effective_call_changed',
    });
    expect(cancelTerm.phase).toBe('cancelled');
    expect(cancelTerm.terminalReason).toBe('effective_call_changed');

    // New approval cycle for the mutated envelope (must carry a different policyRef).
    const pre2 = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T2-mutated',
      input: mutated,
      canonicalInput: mutated,
      approvalDecision: 'approved',
      policyRef: 'policy:t2-mutated',                       // different policy
    });
    const term2 = await logger.endAction({
      preAction: pre2,
      phase: 'executed',
      startedAt: new Date(100),
      endedAt: new Date(150),
      output: { id: 'tr_2' },
      effectiveCanonicalInput: mutated,
    });

    const result = await verifyChain([pre, cancelTerm, pre2, term2]);
    expect(result.intact).toBe(true);
    expect(result.chainIntegrity).toBe('complete');
  });

  // Test 3: a defaulted argument that changes the call's effect must appear in the
  // approval — if it only surfaces at execution time, the gate rejects.
  it('Test 3: execution-time default that changes effect is rejected', async () => {
    const logger = new AuditLogger({ silent: true });
    const approved = {
      toolName: 'http_post',
      target: 'https://api.example.com/v1/charges',
      arguments: { amount: 500 },                          // currency NOT in approval
      actorId: 'agent-001',
    };
    const pre = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T3',
      input: approved,
      canonicalInput: approved,
      approvalDecision: 'approved',
      policyRef: 'policy:t3',
    });

    // Execution defaults currency:'jpy' — that's effect-changing, not transport noise.
    const effective = {
      ...approved,
      arguments: { amount: 500, currency: 'jpy' },
    };
    let threw = false;
    try {
      await logger.endAction({
        preAction: pre,
        phase: 'executed',
        output: { id: 'ch_3' },
        effectiveCanonicalInput: effective,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('effective envelope hash differs');
    }
    expect(threw).toBe(true);
  });

  // Test 4: carrying the cancelled pre-action's policyRef into a new beginAction is
  // detected by verifyChain — a different envelope is a different decision.
  it('Test 4: policyRef carried into a new beginAction across effective_call_changed is rejected', async () => {
    const logger = new AuditLogger({ silent: true });
    const env1 = {
      toolName: 'http_post',
      target: 'https://api.example.com/v1/charges',
      arguments: { amount: 500 },
      actorId: 'agent-001',
    };
    const pre = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T4',
      input: env1,
      canonicalInput: env1,
      approvalDecision: 'approved',
      policyRef: 'policy:t4-shared',
    });
    const cancel = await logger.endAction({
      preAction: pre,
      phase: 'cancelled',
      terminalReason: 'effective_call_changed',
    });
    // Reapproval cycle reuses the SAME policyRef — that's the rule rpelevin's gate forbids.
    const env2 = { ...env1, target: 'https://api.example.com/v1/transfers' };
    const pre2 = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T4-2',
      input: env2,
      canonicalInput: env2,
      approvalDecision: 'approved',
      policyRef: 'policy:t4-shared',                       // reuses cancelled policyRef
    });
    const term2 = await logger.endAction({
      preAction: pre2,
      phase: 'executed',
      startedAt: new Date(0),
      endedAt: new Date(10),
      output: { id: 'tr_4' },
      effectiveCanonicalInput: env2,
    });

    const result = await verifyChain([pre, cancel, pre2, term2]);
    expect(result.intact).toBe(false);
    expect(result.chainIntegrity).toBe('broken');
    expect(result.breaks.some(b =>
      b.id === pre2.id &&
      typeof b.expected === 'string' &&
      b.expected.startsWith('policyRef differs from cancelled pre-action')
    )).toBe(true);
  });

  // Test 5: verifier distinguishes approved-envelope drift, effective-envelope drift,
  // and raw-input byte drift via three different `expected` strings.
  it('Test 5: verifier distinguishes approved-envelope drift, effective-envelope drift, and raw-input drift', async () => {
    const logger = new AuditLogger({ silent: true });

    // (a) Effective-envelope drift: pre-action and terminal are constructed
    // out-of-band so the canonicalJson hashes don't match. We use a logger that does
    // NOT enforce the sign-time gate by skipping endAction's gate (write the terminal
    // directly). Easiest: build a v0.5 pre-action via beginAction, then manually
    // construct a terminal with effectiveEnvelopeHash != approvedEnvelopeHash that
    // still chains correctly.
    const env = {
      toolName: 'http_post', target: 'https://example.com', arguments: { x: 1 }, actorId: 'a',
    };
    const pre = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T5',
      input: env,
      canonicalInput: env,
      approvalDecision: 'approved',
      policyRef: 'policy:t5',
    });
    // Manually build a tampered terminal (effectiveEnvelopeHash drifted)
    const canonicalJsonOf = (v: any): string => {
      if (v === null || v === undefined) return 'null';
      if (typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(canonicalJsonOf).join(',') + ']';
      const keys = Object.keys(v).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJsonOf(v[k])).join(',') + '}';
    };
    const sha256Hex = async (s: string): Promise<string> => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    };
    const { signature: _sig, ...preWithoutSig } = pre;
    const preHash = 'sha256:' + await sha256Hex(canonicalJsonOf(preWithoutSig));
    const driftedTerminal: any = {
      id: 'T5driftTerminal0001',
      version: 'aar-v1',
      phase: 'executed',
      preActionId: pre.id,
      toolCallId: pre.toolCallId,
      terminalAt: '2026-06-12T00:00:01.000Z',
      executionStartedAt: '2026-06-12T00:00:00.000Z',
      executionEndedAt: '2026-06-12T00:00:01.000Z',
      resultDigest: 'sha256:' + await sha256Hex('"r"'),
      effectiveEnvelopeHash: 'sha256:' + await sha256Hex('"DIFFERENT"'),
      canonicalizationVersion: 'cv1',
      previousReceiptHash: preHash,
    };

    const r1 = await verifyChain([pre, driftedTerminal]);
    expect(r1.intact).toBe(false);
    expect(r1.breaks.some(b =>
      typeof b.expected === 'string' && b.expected.startsWith('effectiveEnvelopeHash === approvedEnvelopeHash')
    )).toBe(true);

    // (b) Approved-envelope drift: replay a tampered canonical envelope for the
    // pre-action. The verifier reports the third category.
    const tamperedCanonical = { ...env, arguments: { x: 999 } };  // different effect
    const r2 = await verifyChain([pre, driftedTerminal], {
      replayedCanonicalInputs: { [pre.id]: tamperedCanonical },
    });
    expect(r2.breaks.some(b =>
      b.id === pre.id && b.expected === 'approvedEnvelopeHash matches replay'
    )).toBe(true);

    // (c) Raw-input byte drift: replay a tampered raw input for the pre-action.
    const tamperedRaw = { ...env, _trace: 'after-the-fact' }; // changes the byte stream
    const r3 = await verifyChain([pre, driftedTerminal], {
      replayedRawInputs: { [pre.id]: tamperedRaw },
    });
    expect(r3.breaks.some(b =>
      b.id === pre.id && b.expected === 'inputDigest matches replay'
    )).toBe(true);

    // All three categories are distinct strings — the verifier names which side drifted.
    const allExpectedStrings = new Set([
      ...r1.breaks.map(b => b.expected),
      ...r2.breaks.map(b => b.expected),
      ...r3.breaks.map(b => b.expected),
    ]);
    expect(allExpectedStrings.size).toBeGreaterThanOrEqual(3);
  });

  // Test 6: replaying an executed terminal under a different canonicalizationVersion
  // fails closed unless an explicit migration verifier is selected.
  it('Test 6: cross-version replay fails closed; explicit migration verifier permits it', async () => {
    const logger = new AuditLogger({ silent: true });
    const env = {
      toolName: 'http_post', target: 'https://example.com', arguments: { x: 1 }, actorId: 'a',
    };
    const pre = await logger.beginAction({
      toolName: 'http_post',
      toolCallId: 'call-T6',
      input: env,
      canonicalInput: env,
      canonicalizationVersion: 'cv1',
      approvalDecision: 'approved',
      policyRef: 'policy:t6',
    });
    const term = await logger.endAction({
      preAction: pre,
      phase: 'executed',
      startedAt: new Date(0),
      endedAt: new Date(10),
      output: { id: 'r' },
      effectiveCanonicalInput: env,
    });

    // (a) Replay under cv2 with NO migration verifier → fails closed.
    const r1 = await verifyChain([pre, term], {
      replayedCanonicalInputs: { [pre.id]: env },
      canonicalizationVersion: 'cv2',
    });
    expect(r1.intact).toBe(false);
    expect(r1.breaks.some(b =>
      b.id === pre.id &&
      typeof b.expected === 'string' &&
      b.expected.startsWith('canonicalizationVersion match or migration verifier')
    )).toBe(true);

    // (b) Replay under cv2 WITH an explicit cv1 migration verifier → permitted.
    const r2 = await verifyChain([pre, term], {
      replayedCanonicalInputs: { [pre.id]: env },
      canonicalizationVersion: 'cv2',
      migrationVerifiers: {
        cv1: (v) => v,  // identity migration: cv2 is a superset of cv1 in this stub
      },
    });
    expect(r2.intact).toBe(true);
    expect(r2.chainIntegrity).toBe('complete');
  });
});

describe('AAR v0.6 canonicalizer accountability (three-hash decomposition)', () => {
  // Test helpers — build a profile + surface pair for the http tool family.
  async function buildHttpProfile(overrides: Partial<CanonicalizerProfile> = {}): Promise<CanonicalizerProfile> {
    const base = {
      profileId: 'http.v1',
      version: '1.0.0',
      toolFamily: 'http',
      includedConsequentialFields: ['method', 'url', 'host', 'body', 'authScope'],
      excludedFields: ['traceId', 'retryId', 'userAgent'],
      normalizationRules: { url: { percentEncoded: true }, host: { caseSensitive: false } },
      ...overrides,
    };
    const profileHash = await computeCanonicalizerProfileHash(base);
    return { ...base, profileHash };
  }
  async function buildPolicySurface(overrides: Partial<PolicySurface> = {}): Promise<PolicySurface> {
    const base = {
      policyRef: 'policy:write-tenant',
      gatedFields: ['method', 'url', 'authScope'],
      ...overrides,
    };
    const surfaceHash = await computePolicySurfaceHash(base);
    return { ...base, surfaceHash };
  }

  it('case 0 — unbound (policy, profile) pair refuses beginAction with reason=unbound_policy_profile', async () => {
    const logger = new AuditLogger({ silent: true });
    const profile = await buildHttpProfile();
    const surface = await buildPolicySurface();
    const registry = new InMemoryPolicyProfileBindingRegistry();
    // Note: NO registry.register(surface, profile) call → binding does not exist.
    let caught: BeginActionRefusal | undefined;
    try {
      await logger.beginAction({
        toolName: 'http.fetch',
        toolCallId: 't0',
        input: { method: 'POST', url: 'https://api.example.com/x' },
        canonicalInput: { method: 'POST', url: 'https://api.example.com/x', host: 'api.example.com', body: '', authScope: 'tenant-A' },
        canonicalizerProfile: profile,
        policySurface: surface,
        bindingRegistry: registry,
      });
    } catch (e) {
      if (e instanceof BeginActionRefusal) caught = e;
    }
    expect(caught).toBeInstanceOf(BeginActionRefusal);
    expect(caught?.reason).toBe('unbound_policy_profile');
  });

  it('case 1 — policy gates on a field absent from profile.includedConsequentialFields → registry.register refuses (policy_surface_unbound)', async () => {
    const profile = await buildHttpProfile({
      includedConsequentialFields: ['method', 'url', 'host'],  // 'authScope' missing
    });
    // recompute hash after override
    profile.profileHash = await computeCanonicalizerProfileHash(profile);
    const surface = await buildPolicySurface({
      gatedFields: ['method', 'url', 'authScope'],  // gates on missing 'authScope'
    });
    surface.surfaceHash = await computePolicySurfaceHash(surface);
    const registry = new InMemoryPolicyProfileBindingRegistry();
    let caught: BeginActionRefusal | undefined;
    try {
      await registry.register(surface, profile);
    } catch (e) {
      if (e instanceof BeginActionRefusal) caught = e;
    }
    expect(caught).toBeInstanceOf(BeginActionRefusal);
    expect(caught?.reason).toBe('policy_surface_unbound');
    expect(caught?.message).toContain("'authScope'");
  });

  it('case 2 — profile declares normalization rule for a field absent from the envelope → beginAction refuses (profile_data_incomplete)', async () => {
    const logger = new AuditLogger({ silent: true });
    const profile = await buildHttpProfile();
    const surface = await buildPolicySurface();
    const registry = new InMemoryPolicyProfileBindingRegistry();
    await registry.register(surface, profile);  // binding exists; case 0 is not the failure mode

    let caught: BeginActionRefusal | undefined;
    try {
      await logger.beginAction({
        toolName: 'http.fetch',
        toolCallId: 't2',
        input: { method: 'POST', url: 'https://api.example.com/x' },
        // Envelope is MISSING 'host' even though profile declares normalization for it.
        canonicalInput: { method: 'POST', url: 'https://api.example.com/x', body: '', authScope: 'tenant-A' },
        canonicalizerProfile: profile,
        policySurface: surface,
        bindingRegistry: registry,
      });
    } catch (e) {
      if (e instanceof BeginActionRefusal) caught = e;
    }
    expect(caught).toBeInstanceOf(BeginActionRefusal);
    expect(caught?.reason).toBe('profile_data_incomplete');
    expect(caught?.message).toContain("'host'");
  });

  it('case 3 — endAction with different canonicalizerProfile than the pre-action throws profile_incompatible', async () => {
    const logger = new AuditLogger({ silent: true });
    const profileA = await buildHttpProfile();
    const profileB = await buildHttpProfile({
      version: '1.1.0',
      normalizationRules: { url: { percentEncoded: true }, host: { caseSensitive: true } },  // different rule
    });
    profileB.profileHash = await computeCanonicalizerProfileHash(profileB);
    expect(profileA.profileHash).not.toBe(profileB.profileHash);

    const surface = await buildPolicySurface();
    const registry = new InMemoryPolicyProfileBindingRegistry();
    await registry.register(surface, profileA);

    const env = { method: 'POST', url: 'https://api.example.com/x', host: 'api.example.com', body: '', authScope: 'tenant-A' };
    const pre = await logger.beginAction({
      toolName: 'http.fetch',
      toolCallId: 't3',
      input: env,
      canonicalInput: env,
      canonicalizerProfile: profileA,
      policySurface: surface,
      bindingRegistry: registry,
      approvalDecision: 'approved',
      policyRef: surface.policyRef,
    });
    expect(pre.canonicalizerProfileHash).toBe(profileA.profileHash);
    expect(pre.policySurfaceHash).toBe(surface.surfaceHash);
    expect(pre.policyProfileBindingHash).toBeDefined();

    let caught: Error | undefined;
    try {
      await logger.endAction({
        preAction: pre,
        phase: 'executed',
        startedAt: new Date(0),
        endedAt: new Date(10),
        output: { ok: true },
        effectiveCanonicalInput: env,
        canonicalizerProfile: profileB,  // DRIFT — different profile than approval
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain('profile_incompatible');
  });

  it('case 4 — migration verifier marked preservesPolicySurface: false is rejected at verifyChain (migration_changes_policy_surface)', async () => {
    const logger = new AuditLogger({ silent: true });
    const env = { method: 'POST', url: 'https://api.example.com/x', host: 'api.example.com', body: '', authScope: 'tenant-A' };
    const pre = await logger.beginAction({
      toolName: 'http.fetch',
      toolCallId: 't4',
      input: env,
      canonicalInput: env,
      canonicalizationVersion: 'cv1',
      approvalDecision: 'approved',
      policyRef: 'policy:t4',
    });
    const term = await logger.endAction({
      preAction: pre,
      phase: 'executed',
      startedAt: new Date(0),
      endedAt: new Date(10),
      output: { ok: true },
      effectiveCanonicalInput: env,
    });
    const r = await verifyChain([pre, term], {
      replayedCanonicalInputs: { [pre.id]: env },
      canonicalizationVersion: 'cv2',
      migrationVerifiers: {
        // Declared as policy-surface-changing — verifier must refuse silent replay.
        cv1: { migrate: (v) => v, preservesPolicySurface: false },
      },
    });
    expect(r.intact).toBe(false);
    expect(r.chainIntegrity).toBe('broken');
    expect(r.breaks.some(b =>
      b.id === pre.id &&
      typeof b.expected === 'string' &&
      b.expected.startsWith('migration_preserves_policy_surface') &&
      b.actual === 'migration_changes_policy_surface'
    )).toBe(true);
  });

  it('case 5 — pre-action carrying an unregistered canonicalizerProfileHash fails closed when verifier supplies registered set', async () => {
    const logger = new AuditLogger({ silent: true });
    const profile = await buildHttpProfile();
    const surface = await buildPolicySurface();
    const registry = new InMemoryPolicyProfileBindingRegistry();
    await registry.register(surface, profile);
    const env = { method: 'POST', url: 'https://api.example.com/x', host: 'api.example.com', body: '', authScope: 'tenant-A' };
    const pre = await logger.beginAction({
      toolName: 'http.fetch',
      toolCallId: 't5',
      input: env,
      canonicalInput: env,
      canonicalizerProfile: profile,
      policySurface: surface,
      bindingRegistry: registry,
      approvalDecision: 'approved',
      policyRef: surface.policyRef,
    });
    const term = await logger.endAction({
      preAction: pre,
      phase: 'executed',
      startedAt: new Date(0),
      endedAt: new Date(10),
      output: { ok: true },
      effectiveCanonicalInput: env,
      canonicalizerProfile: profile,
    });

    // Verifier knows ONLY a different profile — pre's profileHash is not in the set.
    const otherProfile = await buildHttpProfile({ profileId: 'http.experimental' });
    otherProfile.profileHash = await computeCanonicalizerProfileHash(otherProfile);
    const r = await verifyChain([pre, term], {
      registeredCanonicalizerProfiles: {
        [otherProfile.profileHash]: otherProfile,
      },
    });
    expect(r.intact).toBe(false);
    expect(r.breaks.some(b =>
      b.id === pre.id &&
      typeof b.expected === 'string' &&
      b.expected.startsWith('canonicalizerProfileHash in registeredCanonicalizerProfiles') &&
      typeof b.actual === 'string' &&
      b.actual.startsWith('unregistered_canonicalizer_profile')
    )).toBe(true);

    // Sanity check: when the actual profile IS in the registered set, the chain is intact.
    const rOk = await verifyChain([pre, term], {
      registeredCanonicalizerProfiles: { [profile.profileHash]: profile },
    });
    expect(rOk.intact).toBe(true);
    expect(rOk.chainIntegrity).toBe('complete');
  });

  it('happy path — full three-hash chain verifies intact when binding registered and profile preserved', async () => {
    const logger = new AuditLogger({ silent: true });
    const profile = await buildHttpProfile();
    const surface = await buildPolicySurface();
    const registry = new InMemoryPolicyProfileBindingRegistry();
    const binding = await registry.register(surface, profile);

    const env = { method: 'POST', url: 'https://api.example.com/x', host: 'api.example.com', body: '', authScope: 'tenant-A' };
    const pre = await logger.beginAction({
      toolName: 'http.fetch',
      toolCallId: 'happy',
      input: env,
      canonicalInput: env,
      canonicalizerProfile: profile,
      policySurface: surface,
      bindingRegistry: registry,
      approvalDecision: 'approved',
      policyRef: surface.policyRef,
    });
    expect(pre.canonicalizerProfileHash).toBe(profile.profileHash);
    expect(pre.policySurfaceHash).toBe(surface.surfaceHash);
    expect(pre.policyProfileBindingHash).toBe(binding.bindingHash);

    const term = await logger.endAction({
      preAction: pre,
      phase: 'executed',
      startedAt: new Date(0),
      endedAt: new Date(10),
      output: { ok: true },
      effectiveCanonicalInput: env,
      canonicalizerProfile: profile,
    });
    expect(term.canonicalizerProfileHash).toBe(profile.profileHash);

    const r = await verifyChain([pre, term], {
      registeredCanonicalizerProfiles: { [profile.profileHash]: profile },
    });
    expect(r.intact).toBe(true);
    expect(r.chainIntegrity).toBe('complete');
  });
});
