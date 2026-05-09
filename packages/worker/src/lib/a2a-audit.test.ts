// ─── A2A Trust Audit — Unit tests ────────────────────────────────────────────
// Tests the worker-friendly port at lib/a2a-audit.ts.
//
// The CLI (/workspace/a2a-trust-audit) is the authoritative test set for the
// rubric itself; here we verify only that the worker port produces the same
// scoring shape and handles SSRF / URL parsing correctly.

import { describe, test, expect } from 'bun:test';
import {
  fetchAgentCard,
  runChecks,
  score,
  grade,
  gradeColor,
  auditCardUrl,
  type AgentCard,
} from './a2a-audit.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// "A-grade" card — AgentLair-style with most checks passing.
const A_CARD: AgentCard = {
  name: 'AgentLair',
  description: 'Behavioral trust infrastructure for autonomous agents.',
  url: 'https://agentlair.dev',
  version: '1.0.0',
  did: 'did:web:agentlair.dev',
  contact: { email: 'security@agentlair.dev', url: 'https://agentlair.dev/security' },
  provider: { organization: 'AgentLair', url: 'https://agentlair.dev' },
  jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
  signatures: [{ protected: 'eyJhbGciOiJFZERTQSJ9', signature: 'abc' }],
  authentication: { schemes: ['oauth2', 'bearer'] },
  securitySchemes: { oauth: { type: 'oauth2' }, mtls: { type: 'mutualTLS' } },
  pricing: { perCallUsd: '0.01' },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  capabilities: { streaming: true },
  skills: [
    { id: 'audit', name: 'Audit', description: 'Run trust audit', tags: ['trust'] },
  ],
  trust_attestation: { score: 92, level: 'principal', confidence: 0.92 },
  audit_trail_url_template: 'https://agentlair.dev/v1/audit/{jti}',
  behavioral_monitoring: { endpoint: 'https://agentlair.dev/v1/telemetry' },
  delegation_chain: [{ from: 'a', to: 'b' }],
};

// "F-grade" card — minimal/missing fields.
const F_CARD: AgentCard = {
  name: 'BareAgent',
  url: 'http://example.com', // not HTTPS
};

// ─── runChecks + score ──────────────────────────────────────────────────────

describe('runChecks + score', () => {
  test('A-grade card scores ≥ 90 overall', () => {
    const checks = runChecks(A_CARD);
    const s = score(checks);
    expect(s.overall).toBeGreaterThanOrEqual(90);
    expect(grade(s.overall)).toBe('A');
  });

  test('F-grade card scores < 50 overall', () => {
    const checks = runChecks(F_CARD);
    const s = score(checks);
    expect(s.overall).toBeLessThan(50);
    expect(grade(s.overall)).toBe('F');
  });

  test('all 4 layers populated', () => {
    const checks = runChecks(A_CARD);
    const layers = new Set(checks.map(c => c.layer));
    expect(layers.has('L1')).toBe(true);
    expect(layers.has('L2')).toBe(true);
    expect(layers.has('L3')).toBe(true);
    expect(layers.has('L4')).toBe(true);
  });

  test('passes l1-https for https URL, fails for http', () => {
    const httpsChecks = runChecks({ ...F_CARD, url: 'https://example.com' });
    expect(httpsChecks.find(c => c.id === 'l1-https')!.pass).toBe(true);
    const httpChecks = runChecks(F_CARD);
    expect(httpChecks.find(c => c.id === 'l1-https')!.pass).toBe(false);
  });

  test('detects v1.0 securitySchemes for OAuth check', () => {
    const card: AgentCard = { name: 'X', securitySchemes: { o: { type: 'oauth2' } } };
    const checks = runChecks(card);
    expect(checks.find(c => c.id === 'l2-oauth')!.pass).toBe(true);
  });

  test('detects legacy authentication.schemes string array', () => {
    const card: AgentCard = { name: 'X', authentication: { schemes: ['oauth2'] } };
    const checks = runChecks(card);
    expect(checks.find(c => c.id === 'l2-oauth')!.pass).toBe(true);
  });

  test('signed card via signatures[] passes l2-card-signed', () => {
    const card: AgentCard = { name: 'X', signatures: [{ protected: 'abc', signature: 'def' }] };
    const checks = runChecks(card);
    expect(checks.find(c => c.id === 'l2-card-signed')!.pass).toBe(true);
  });

  test('audit_trail_url_template counts as audit-trail pass', () => {
    const card: AgentCard = { name: 'X', audit_trail_url_template: 'https://x/{jti}' };
    const checks = runChecks(card);
    expect(checks.find(c => c.id === 'l4-audit-trail')!.pass).toBe(true);
  });
});

// ─── grade boundaries ────────────────────────────────────────────────────────

describe('grade boundaries', () => {
  test('90 → A', () => expect(grade(90)).toBe('A'));
  test('89 → B', () => expect(grade(89)).toBe('B'));
  test('80 → B', () => expect(grade(80)).toBe('B'));
  test('79 → C', () => expect(grade(79)).toBe('C'));
  test('65 → C', () => expect(grade(65)).toBe('C'));
  test('64 → D', () => expect(grade(64)).toBe('D'));
  test('50 → D', () => expect(grade(50)).toBe('D'));
  test('49 → F', () => expect(grade(49)).toBe('F'));
  test('0 → F', () => expect(grade(0)).toBe('F'));
});

// ─── gradeColor ──────────────────────────────────────────────────────────────

describe('gradeColor', () => {
  test('all five grades map to distinct hex colors', () => {
    const colors = new Set(['A', 'B', 'C', 'D', 'F'].map(g => gradeColor(g as any)));
    expect(colors.size).toBe(5);
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// ─── fetchAgentCard ──────────────────────────────────────────────────────────

describe('fetchAgentCard', () => {
  test('rejects non-http(s) targets', async () => {
    await expect(fetchAgentCard('file:///etc/passwd')).rejects.toThrow();
    await expect(fetchAgentCard('ftp://example.com')).rejects.toThrow();
  });

  test('fetches direct .json URL', async () => {
    const fakeFetch: typeof fetch = (async () => {
      return new Response(JSON.stringify({ name: 'X', url: 'https://x.com' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const { card, from } = await fetchAgentCard('https://x.com/.well-known/agent.json', fakeFetch);
    expect(card.name).toBe('X');
    expect(from).toBe('https://x.com/.well-known/agent.json');
  });

  test('falls through well-known paths when first 404s', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = (async (url: string) => {
      calls++;
      if (url.endsWith('/agent-card.json')) return new Response('not found', { status: 404 });
      if (url.endsWith('/agent.json')) {
        return new Response(JSON.stringify({ name: 'Fallback' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as any;
    const { card } = await fetchAgentCard('https://example.com', fakeFetch);
    expect(card.name).toBe('Fallback');
    expect(calls).toBe(2);
  });
});

// ─── auditCardUrl (e2e of the lib) ──────────────────────────────────────────

describe('auditCardUrl', () => {
  test('audits a high-grade card and returns A grade', async () => {
    const fakeFetch: typeof fetch = (async () => {
      return new Response(JSON.stringify(A_CARD), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const result = await auditCardUrl('https://agentlair.dev/.well-known/agent.json', fakeFetch);
    expect(result.grade).toBe('A');
    expect(result.scores.overall).toBeGreaterThanOrEqual(90);
    expect(result.card.name).toBe('AgentLair');
  });

  test('audits a low-grade card and returns F grade', async () => {
    const fakeFetch: typeof fetch = (async () => {
      return new Response(JSON.stringify(F_CARD), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const result = await auditCardUrl('https://example.com/.well-known/agent.json', fakeFetch);
    expect(result.grade).toBe('F');
    expect(result.scores.overall).toBeLessThan(50);
  });
});
