// ─── Demo records for advertised x402 examples ────────────────────────────────
//
// Every id AgentLair advertises as an example (/.well-known/x402 resources,
// /.well-known/bazaar.json + 402 `extensions.bazaar` discovery input, /api
// OpenAPI examples) must resolve to a paid 200 — index buyers such as Settled's
// scout send the listing's example input and record delivery. These are
// permanent, code-resident records (no KV seed to forget), each labelled
// `demo: true`, and each carries every key of its listing's output example.
//
// ONE demo id per id-type, used everywhere.

export const DEMO_AAT_JTI = 'aat_demo1234567890ab';
export const DEMO_AGENT_ID = 'acc_demoid12345';
export const DEMO_AGENT_NAME = 'demo-agent';

const DEMO_NOTE =
  'Demo record: the permanent example advertised in AgentLair x402 listings. It is not a real token or agent; query a real id for real data.';

export function demoAuditRecord() {
  return {
    jti: DEMO_AAT_JTI,
    issued_at: '2026-01-01T00:00:00Z',
    expires_at: '2099-12-31T23:59:59Z',
    audience: 'demo.agentlair.dev',
    scopes: ['email:send'],
    status: 'active',
    revoked_at: null,
    revocation_reason: null,
    audit_log_url: 'https://agentlair.dev/v1/audit/log?action=auth.token_issue',
    demo: true,
    note: DEMO_NOTE,
  };
}

export function demoAgentLookupRecord() {
  return {
    id: DEMO_AGENT_ID,
    name: DEMO_AGENT_NAME,
    email: `${DEMO_AGENT_NAME}@agentlair.dev`,
    did: `did:web:agentlair.dev:agents:${DEMO_AGENT_ID}`,
    jwks_url: 'https://agentlair.dev/.well-known/jwks.json',
    registered_at: '2026-01-01T00:00:00Z',
    verified: false,
    demo: true,
    note: DEMO_NOTE,
  };
}

export function demoMemoryTrustRecord() {
  return {
    agent_id: DEMO_AGENT_ID,
    memory_behavior: {
      total_memory_tokens: 47,
      memory_read_count: 38,
      memory_write_count: 9,
      read_write_ratio: 0.809,
      first_memory_access: '2026-01-02T09:00:00Z',
      last_memory_access: '2026-02-01T09:00:00Z',
      unique_memory_backends: 2,
      consistency_score: 0.87,
      access_pattern: 'read_heavy',
      behavioral_summary: 'Demo profile: 47 memory-scoped AATs over 30 day(s). Pattern: read_heavy, access cadence: consistent.',
    },
    verified_by: 'agentlair.dev',
    jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
    audit_source: `https://agentlair.dev/v1/audit?account=${DEMO_AGENT_ID}&category=memory`,
    generated_at: new Date().toISOString(),
    demo: true,
    note: DEMO_NOTE,
  };
}
