// ─── A2A Leaderboard Job — Unit tests ────────────────────────────────────────

import { describe, test, expect, afterEach } from 'bun:test';
import { buildRowSet, runLeaderboardRefresh, type RegistryEntry, type LeaderboardRowSet } from './a2a-leaderboard-job.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(name: string, url: string, wellKnownURI?: string): RegistryEntry {
  return { name, url, wellKnownURI: wellKnownURI ?? `${url}/.well-known/agent.json` };
}

function makeKv(initial?: LeaderboardRowSet): KVNamespace {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  return {
    get: async () => stored,
    put: async (_key: string, value: string) => { stored = value; },
    getWithMetadata: async () => ({ value: stored, metadata: null }),
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  } as unknown as KVNamespace;
}

const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });

// ─── buildRowSet ──────────────────────────────────────────────────────────────

describe('buildRowSet', () => {
  test('sorts by score DESC', () => {
    const entries: RegistryEntry[] = [
      makeEntry('Low', 'https://low.example.com'),
      makeEntry('High', 'https://high.example.com'),
      makeEntry('Mid', 'https://mid.example.com'),
    ];
    const audits = [
      { entry: entries[0], result: { ok: true as const, grade: 'F' as const, score: 20, layers: { l1: 20, l2: 10, l3: 5, l4: 5 } } },
      { entry: entries[1], result: { ok: true as const, grade: 'A' as const, score: 95, layers: { l1: 95, l2: 90, l3: 88, l4: 92 } } },
      { entry: entries[2], result: { ok: true as const, grade: 'C' as const, score: 67, layers: { l1: 70, l2: 60, l3: 65, l4: 68 } } },
    ];
    const rowSet = buildRowSet(entries, audits, '2026-05-13T04:00:00Z', 'https://reg.test');
    expect(rowSet.results[0].name).toBe('High');
    expect(rowSet.results[1].name).toBe('Mid');
    expect(rowSet.results[2].name).toBe('Low');
  });

  test('grade E rows sort after graded rows with same score', () => {
    const entries: RegistryEntry[] = [
      makeEntry('Error', 'https://err.example.com'),
      makeEntry('Good', 'https://good.example.com'),
    ];
    const audits = [
      { entry: entries[0], result: { ok: false as const, error: 'network error' } },
      { entry: entries[1], result: { ok: true as const, grade: 'F' as const, score: 0, layers: { l1: 0, l2: 0, l3: 0, l4: 0 } } },
    ];
    const rowSet = buildRowSet(entries, audits, '2026-05-13T04:00:00Z', 'https://reg.test');
    expect(rowSet.results[0].name).toBe('Good');  // F beats E even at score 0
    expect(rowSet.results[1].name).toBe('Error');
    expect(rowSet.results[1].grade).toBe('E');
  });

  test('sets total to entries.length', () => {
    const entries = [makeEntry('A1', 'https://a1.example.com'), makeEntry('A2', 'https://a2.example.com')];
    const audits = entries.map(e => ({ entry: e, result: { ok: true as const, grade: 'B' as const, score: 80, layers: { l1: 80, l2: 75, l3: 70, l4: 82 } } }));
    const rowSet = buildRowSet(entries, audits, '2026-05-13T04:00:00Z', 'https://reg.test');
    expect(rowSet.total).toBe(2);
  });

  test('error rows include error field', () => {
    const entries = [makeEntry('BadAgent', 'https://bad.example.com')];
    const audits = [{ entry: entries[0], result: { ok: false as const, error: 'fetch failed' } }];
    const rowSet = buildRowSet(entries, audits, '2026-05-13T04:00:00Z', 'https://reg.test');
    expect(rowSet.results[0].grade).toBe('E');
    expect(rowSet.results[0].error).toBe('fetch failed');
  });
});

// ─── runLeaderboardRefresh ─────────────────────────────────────────────────────

describe('runLeaderboardRefresh', () => {
  test('no-ops when registry returns empty agents array', async () => {
    const kv = makeKv();
    const initialKvState = await kv.get('v1:results');  // null

    globalThis.fetch = async () => new Response(JSON.stringify({ agents: [], total: 0 }), { status: 200 });

    const result = await runLeaderboardRefresh({ A2A_LEADERBOARD: kv });
    expect(result.skipped).toBe('registry_empty');
    // KV should still be null (not overwritten)
    expect(await kv.get('v1:results')).toBe(initialKvState);
  });

  test('writes KV when registry returns agents', async () => {
    const kv = makeKv();
    const agentCard = {
      name: 'TestAgent',
      url: 'https://test.example.com',
      description: 'A test agent with more than 10 chars',
      skills: [{ id: 's1', name: 'Skill', description: 'Does things', tags: ['test'] }],
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
    };

    globalThis.fetch = async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : (url as Request).url ?? url.toString();
      if (u.includes('a2aregistry.org')) {
        return new Response(JSON.stringify({
          agents: [{ name: 'TestAgent', url: 'https://test.example.com', wellKnownURI: 'https://test.example.com/.well-known/agent.json' }],
          total: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify(agentCard), { status: 200 });
    };

    const result = await runLeaderboardRefresh({ A2A_LEADERBOARD: kv });
    expect(result.total).toBe(1);
    expect(result.skipped).toBeUndefined();

    const stored = await kv.get('v1:results');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as LeaderboardRowSet;
    expect(parsed.results.length).toBe(1);
    expect(parsed.results[0].name).toBe('TestAgent');
  });

  test('self-host filter records grade E for agentlair.dev cards', async () => {
    const kv = makeKv();

    globalThis.fetch = async () => new Response(JSON.stringify({
      agents: [{ name: 'Self', url: 'https://agentlair.dev', wellKnownURI: 'https://agentlair.dev/.well-known/agent.json' }],
      total: 1,
    }), { status: 200 });

    await runLeaderboardRefresh({ A2A_LEADERBOARD: kv });
    const stored = await kv.get('v1:results');
    const parsed = JSON.parse(stored as string) as LeaderboardRowSet;
    expect(parsed.results[0].grade).toBe('E');
    expect(parsed.results[0].error).toBe('self-host');
  });

  test('no-ops when registry returns non-2xx', async () => {
    const kv = makeKv();
    globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });
    const result = await runLeaderboardRefresh({ A2A_LEADERBOARD: kv });
    expect(result.skipped).toBe('registry_empty');
  });
});
