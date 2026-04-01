/**
 * Basic example — run with: bun run examples/basic.ts
 */
import { auditLog, configureLogger, AuditLogger } from '../src/index.js';
import type { AuditSink, ResolvedAuditEntry } from '../src/index.js';

// ─── 1. Simple one-liner ────────────────────────────────────────────────────
console.log('\n=== 1. Simple auditLog() ===');
await auditLog({ agent: 'researcher', action: 'tool_call', tool: 'web_search', input: 'AgentLair docs' });

// ─── 2. Class-based with custom sink ─────────────────────────────────────────
console.log('\n=== 2. Class + custom sink ===');

const captured: ResolvedAuditEntry[] = [];
const memorySink: AuditSink = { write(entry) { captured.push(entry); } };

const logger = new AuditLogger({ sinks: [memorySink] });

await logger.log({ agent: 'planner', action: 'decision', output: 'proceed with step 2', metadata: { confidence: 0.9 } });
await logger.log({ agent: 'planner', action: 'tool_call', tool: 'calculator', input: '2+2', output: 4 });

console.log(`Captured ${captured.length} entries in memory sink:`);
captured.forEach((e, i) => console.log(`  [${i}] ${e.action} — ${e.timestamp.slice(11, 19)}`));

// ─── 3. Silent in tests ──────────────────────────────────────────────────────
console.log('\n=== 3. Silent mode (no output) ===');
const silent = new AuditLogger({ silent: true });
const entry = await silent.log({ agent: 'test', action: 'should_not_print' });
console.log(`Entry created silently: ${entry.action} ✓`);

// ─── 4. LogAll ────────────────────────────────────────────────────────────────
console.log('\n=== 4. logAll() ===');
const entries = await logger.logAll([
  { agent: 'pipeline', action: 'step_1_fetch' },
  { agent: 'pipeline', action: 'step_2_parse' },
  { agent: 'pipeline', action: 'step_3_store' },
]);
console.log(`Logged ${entries.length} pipeline steps`);

console.log('\n✓ All examples passed');
