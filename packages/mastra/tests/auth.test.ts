import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLairAuth } from '../src/auth.js';
import { clearJWKSCache } from '../src/jwks.js';

describe('AgentLairAuth', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearJWKSCache();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('constructs with default options', () => {
    const auth = new AgentLairAuth();
    expect(auth).toBeInstanceOf(AgentLairAuth);
  });

  it('constructs with custom options', () => {
    const auth = new AgentLairAuth({
      baseUrl: 'https://custom.agentlair.dev',
      apiKey: 'test-key',
      audience: 'https://my-service.com',
      fetchTrustScore: true,
      minimumTrustScore: 500,
    });
    expect(auth).toBeInstanceOf(AgentLairAuth);
  });

  it('hasScope returns true for matching scope', () => {
    const auth = new AgentLairAuth();
    const agent = {
      accountId: 'test',
      scopes: ['read', 'write'],
      auditUrl: '',
      token: '',
      claims: {} as any,
    };
    expect(auth.hasScope(agent as any, 'read')).toBe(true);
    expect(auth.hasScope(agent as any, 'admin')).toBe(false);
  });

  it('hasScope returns true for wildcard scope', () => {
    const auth = new AgentLairAuth();
    const agent = {
      accountId: 'test',
      scopes: ['*'],
      auditUrl: '',
      token: '',
      claims: {} as any,
    };
    expect(auth.hasScope(agent as any, 'anything')).toBe(true);
  });

  it('meetsTrustTier compares tiers correctly', () => {
    const auth = new AgentLairAuth();
    const agent = {
      accountId: 'test',
      scopes: [],
      auditUrl: '',
      token: '',
      claims: {} as any,
      trustScore: {
        agentId: 'test',
        score: 600,
        tier: 'trusted' as const,
        breakdown: { behavioral: 150, consistency: 150, reputation: 150, transparency: 150 },
        computedAt: '2026-04-12T00:00:00Z',
        observationCount: 20,
      },
    };

    expect(auth.meetsTrustTier(agent as any, 'provisional')).toBe(true);
    expect(auth.meetsTrustTier(agent as any, 'trusted')).toBe(true);
    expect(auth.meetsTrustTier(agent as any, 'verified')).toBe(false);
  });

  it('meetsTrustTier returns false when no trust score', () => {
    const auth = new AgentLairAuth();
    const agent = {
      accountId: 'test',
      scopes: [],
      auditUrl: '',
      token: '',
      claims: {} as any,
    };
    expect(auth.meetsTrustTier(agent as any, 'provisional')).toBe(false);
  });

  it('middleware returns correct structure', () => {
    const auth = new AgentLairAuth();
    const mw = auth.middleware();
    expect(mw.path).toBe('/api/*');
    expect(typeof mw.handler).toBe('function');
  });

  it('middleware accepts custom path', () => {
    const auth = new AgentLairAuth();
    const mw = auth.middleware('/v1/*');
    expect(mw.path).toBe('/v1/*');
  });

  it('middleware rejects missing Authorization header', async () => {
    const auth = new AgentLairAuth();
    const mw = auth.middleware();

    const mockContext = {
      req: { header: () => undefined },
      set: vi.fn(),
    };

    const result = await mw.handler(mockContext as any, vi.fn());
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('getTrustScore requires API key', async () => {
    const auth = new AgentLairAuth(); // no apiKey
    await expect(auth.getTrustScore('agent_123')).rejects.toThrow('API key required');
  });

  it('getTrustScore calls trust API', async () => {
    const mockScore = {
      agentId: 'agent_123',
      score: 750,
      tier: 'trusted',
      breakdown: { behavioral: 200, consistency: 200, reputation: 200, transparency: 150 },
      computedAt: '2026-04-12T00:00:00Z',
      observationCount: 42,
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockScore),
    });

    const auth = new AgentLairAuth({ apiKey: 'test-key' });
    const score = await auth.getTrustScore('agent_123');

    expect(score.score).toBe(750);
    expect(score.tier).toBe('trusted');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://agentlair.dev/v1/trust/agent_123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });
});
