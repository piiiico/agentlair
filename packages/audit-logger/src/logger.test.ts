// ─── Tests for @agentlair/audit-logger ───────────────────────────────────────

import { describe, it, expect } from 'bun:test';
import { AuditLogger, auditLog, configureLogger } from './logger.js';

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
