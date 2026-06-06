// ─── Tests for @agentlair/audit-logger ───────────────────────────────────────

import { describe, it, expect } from 'bun:test';
import { AuditLogger, auditLog, configureLogger, verifyChain, computeDigest } from './logger.js';

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
