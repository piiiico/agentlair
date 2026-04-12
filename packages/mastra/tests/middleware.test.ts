import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trustGated, trustGateAll } from '../src/middleware.js';
import type { VerifiedAgent, TrustScore } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockAgent(overrides: Partial<VerifiedAgent> = {}): VerifiedAgent {
  return {
    accountId: 'agent_test',
    name: 'Test Agent',
    email: 'test@agentlair.dev',
    scopes: ['read', 'write'],
    auditUrl: 'https://agentlair.dev/audit/agent_test',
    token: 'mock.jwt.token',
    claims: {
      iss: 'https://agentlair.dev',
      sub: 'agent_test',
      aud: 'https://test.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: 'jti_test',
      al_scopes: ['read', 'write'],
      al_audit_url: 'https://agentlair.dev/audit/agent_test',
    },
    trustScore: {
      agentId: 'agent_test',
      score: 750,
      tier: 'trusted',
      breakdown: { behavioral: 200, consistency: 200, reputation: 200, transparency: 150 },
      computedAt: '2026-04-12T00:00:00Z',
      observationCount: 42,
    },
    ...overrides,
  };
}

function mockTool() {
  return {
    id: 'test-tool',
    description: 'A test tool',
    inputSchema: {},
    outputSchema: {},
    execute: vi.fn().mockResolvedValue({ result: 'success' }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('trustGated', () => {
  it('allows execution when trust score meets threshold', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, { minimumScore: 500 });

    const agent = mockAgent();
    const context = { requestContext: { agent } };
    const result = await gated.execute!({ test: true }, context);

    expect(result).toEqual({ result: 'success' });
    expect(tool.execute).toHaveBeenCalledWith({ test: true }, context);
  });

  it('denies execution when trust score is below threshold', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, { minimumScore: 800, onDenied: 'return-error' });

    const agent = mockAgent({ trustScore: { ...mockAgent().trustScore!, score: 400 } });
    const context = { requestContext: { agent } };
    const result = (await gated.execute!({ test: true }, context)) as any;

    expect(result.error).toContain('Trust gate denied');
    expect(result.trustGate.allowed).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('throws when onDenied is "throw" (default)', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, { minimumScore: 800 });

    const agent = mockAgent({ trustScore: { ...mockAgent().trustScore!, score: 400 } });
    const context = { requestContext: { agent } };

    await expect(gated.execute!({ test: true }, context)).rejects.toThrow('Trust gate denied');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('denies when no agent in context', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, { minimumScore: 500, onDenied: 'return-error' });

    const result = (await gated.execute!({ test: true }, {})) as any;
    expect(result.error).toContain('no agent identity');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('checks required tier', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, {
      minimumScore: 0,
      requiredTier: 'verified',
      onDenied: 'return-error',
    });

    const agent = mockAgent(); // tier: 'trusted', not 'verified'
    const context = { requestContext: { agent } };
    const result = (await gated.execute!({ test: true }, context)) as any;

    expect(result.error).toContain('Trust gate denied');
    expect(result.trustGate.reason).toContain('tier');
  });

  it('checks required scopes', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, {
      minimumScore: 0,
      requiredScopes: ['admin'],
      onDenied: 'return-error',
    });

    const agent = mockAgent({ scopes: ['read', 'write'] }); // no 'admin' scope
    const context = { requestContext: { agent } };
    const result = (await gated.execute!({ test: true }, context)) as any;

    expect(result.error).toContain('Trust gate denied');
    expect(result.trustGate.reason).toContain('scope');
  });

  it('wildcard scope passes scope checks', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, {
      minimumScore: 0,
      requiredScopes: ['admin'],
    });

    const agent = mockAgent({ scopes: ['*'] });
    const context = { requestContext: { agent } };
    const result = await gated.execute!({ test: true }, context);

    expect(result).toEqual({ result: 'success' });
  });

  it('custom gate function overrides score checks', async () => {
    const tool = mockTool();
    const gated = trustGated(tool, {
      minimumScore: 900,
      gate: (agent) => agent.name === 'VIP Agent',
    });

    // Score is 750 (below 900) but custom gate allows
    const agent = mockAgent({ name: 'VIP Agent' });
    const context = { requestContext: { agent } };
    const result = await gated.execute!({ test: true }, context);

    expect(result).toEqual({ result: 'success' });
  });

  it('custom extractAgent function', async () => {
    const tool = mockTool();
    const agent = mockAgent();
    const gated = trustGated(tool, {
      minimumScore: 500,
      extractAgent: (ctx: any) => ctx?.myCustomAgent,
    });

    const context = { myCustomAgent: agent };
    const result = await gated.execute!({ test: true }, context);

    expect(result).toEqual({ result: 'success' });
  });

  it('updates tool description with trust gate info', () => {
    const tool = mockTool();
    const gated = trustGated(tool, { minimumScore: 700 });

    expect(gated.description).toContain('Trust-gated');
    expect(gated.description).toContain('700');
  });
});

describe('trustGateAll', () => {
  it('wraps all tools with the same gate', async () => {
    const tools = {
      'tool-a': mockTool(),
      'tool-b': mockTool(),
    };

    const gated = trustGateAll(tools, { minimumScore: 500, onDenied: 'return-error' });

    // Both tools should be gated
    expect(gated['tool-a'].description).toContain('Trust-gated');
    expect(gated['tool-b'].description).toContain('Trust-gated');

    // Execution without agent should fail
    const resultA = (await gated['tool-a'].execute!({}, {})) as any;
    const resultB = (await gated['tool-b'].execute!({}, {})) as any;

    expect(resultA.error).toContain('no agent identity');
    expect(resultB.error).toContain('no agent identity');
  });
});
