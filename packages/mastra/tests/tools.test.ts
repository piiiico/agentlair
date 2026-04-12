import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentLairTools } from '../src/tools.js';

describe('createAgentLairTools', () => {
  it('returns all tool categories by default', () => {
    const tools = createAgentLairTools({ apiKey: 'test-key' });
    expect(Object.keys(tools)).toContain('agentlair-verify-agent');
    expect(Object.keys(tools)).toContain('agentlair-trust-score');
    expect(Object.keys(tools)).toContain('agentlair-trust-gate');
    expect(Object.keys(tools)).toContain('agentlair-record-observation');
    expect(Object.keys(tools)).toContain('agentlair-send-email');
    expect(Object.keys(tools)).toContain('agentlair-check-inbox');
  });

  it('respects includeIdentity=false', () => {
    const tools = createAgentLairTools({ apiKey: 'test-key', includeIdentity: false });
    expect(Object.keys(tools)).not.toContain('agentlair-verify-agent');
    expect(Object.keys(tools)).toContain('agentlair-trust-score');
  });

  it('respects includeTrust=false', () => {
    const tools = createAgentLairTools({ apiKey: 'test-key', includeTrust: false });
    expect(Object.keys(tools)).not.toContain('agentlair-trust-score');
    expect(Object.keys(tools)).not.toContain('agentlair-trust-gate');
    expect(Object.keys(tools)).not.toContain('agentlair-record-observation');
    expect(Object.keys(tools)).toContain('agentlair-verify-agent');
  });

  it('respects includeCommunication=false', () => {
    const tools = createAgentLairTools({ apiKey: 'test-key', includeCommunication: false });
    expect(Object.keys(tools)).not.toContain('agentlair-send-email');
    expect(Object.keys(tools)).not.toContain('agentlair-check-inbox');
    expect(Object.keys(tools)).toContain('agentlair-trust-score');
  });

  it('each tool has required Mastra-compatible fields', () => {
    const tools = createAgentLairTools({ apiKey: 'test-key' });
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.id).toBe(key);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('uses custom baseUrl', () => {
    const tools = createAgentLairTools({
      apiKey: 'test-key',
      baseUrl: 'https://custom.agentlair.dev',
    });
    // Tool creation should succeed with custom URL
    expect(Object.keys(tools).length).toBeGreaterThan(0);
  });
});

describe('tool execution', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('agentlair-send-email calls the API correctly', async () => {
    const mockResponse = { id: 'msg_123', status: 'sent' };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const tools = createAgentLairTools({ apiKey: 'test-key' });
    const result = await tools['agentlair-send-email'].execute({
      from: 'agent@agentlair.dev',
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(result.id).toBe('msg_123');
    expect(result.status).toBe('sent');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://agentlair.dev/v1/email/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('agentlair-check-inbox returns formatted messages', async () => {
    const mockResponse = {
      messages: [
        {
          message_id: 'mid_1',
          from: 'sender@example.com',
          subject: 'Hello',
          snippet: 'Hi there...',
          received_at: '2026-04-12T00:00:00Z',
          read: false,
        },
      ],
      count: 1,
      has_more: false,
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const tools = createAgentLairTools({ apiKey: 'test-key' });
    const result = await tools['agentlair-check-inbox'].execute({
      address: 'agent@agentlair.dev',
      limit: 20,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].messageId).toBe('mid_1');
    expect(result.messages[0].from).toBe('sender@example.com');
    expect(result.count).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('agentlair-trust-score handles API errors gracefully', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Agent not found' }),
    });

    const tools = createAgentLairTools({ apiKey: 'test-key' });
    const result = await tools['agentlair-trust-score'].execute({
      agentId: 'nonexistent',
    });

    expect(result.score).toBe(0);
    expect(result.tier).toBe('untrusted');
    expect(result.error).toBeDefined();
  });

  it('agentlair-trust-gate denies low-score agents', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          agentId: 'agent_123',
          score: 300,
          tier: 'provisional',
          breakdown: { behavioral: 100, consistency: 50, reputation: 100, transparency: 50 },
          computedAt: '2026-04-12T00:00:00Z',
          observationCount: 10,
        }),
    });

    const tools = createAgentLairTools({ apiKey: 'test-key' });
    const result = await tools['agentlair-trust-gate'].execute({
      agentId: 'agent_123',
      minimumScore: 500,
    });

    expect(result.allowed).toBe(false);
    expect(result.score).toBe(300);
    expect(result.reason).toContain('below minimum');
  });

  it('agentlair-trust-gate allows high-score agents', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          agentId: 'agent_123',
          score: 800,
          tier: 'trusted',
          breakdown: { behavioral: 200, consistency: 200, reputation: 200, transparency: 200 },
          computedAt: '2026-04-12T00:00:00Z',
          observationCount: 50,
        }),
    });

    const tools = createAgentLairTools({ apiKey: 'test-key' });
    const result = await tools['agentlair-trust-gate'].execute({
      agentId: 'agent_123',
      minimumScore: 500,
    });

    expect(result.allowed).toBe(true);
    expect(result.score).toBe(800);
  });

  it('agentlair-record-observation calls observations API', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ id: 'obs_123', topic: 'behavioral-anomaly' }),
    });

    const tools = createAgentLairTools({ apiKey: 'test-key' });
    const result = await tools['agentlair-record-observation'].execute({
      topic: 'behavioral-anomaly',
      content: 'Agent attempted unauthorized resource access',
      shared: true,
    });

    expect(result.recorded).toBe(true);
    expect(result.id).toBe('obs_123');
  });
});
