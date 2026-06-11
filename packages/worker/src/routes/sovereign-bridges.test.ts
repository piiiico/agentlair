import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { sovereignBridgesRoutes } from './sovereign-bridges.js';

// Hermetic integration tests — no live network, purely static handler
const app = new Hono();
app.route('/v1/sovereign-bridges', sovereignBridgesRoutes);

async function get(path: string) {
  const req = new Request(`http://localhost${path}`);
  return app.fetch(req);
}

describe('GET /v1/sovereign-bridges', () => {
  it('responds 200 with application/json', async () => {
    const res = await get('/v1/sovereign-bridges');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('cache-control header is public max-age=300', async () => {
    const res = await get('/v1/sovereign-bridges');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('anchors array has exactly 5 entries', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    expect(Array.isArray(body.anchors)).toBe(true);
    expect(body.anchors.length).toBe(5);
  });

  it('all anchor entries have required fields', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    for (const anchor of body.anchors) {
      expect(typeof anchor.kind).toBe('string');
      expect(typeof anchor.name).toBe('string');
      expect(anchor.status === 'live' || anchor.status === 'roadmap').toBe(true);
      expect('claim_endpoint' in anchor).toBe(true);
      expect('verify_doc' in anchor).toBe(true);
      expect(typeof anchor.evidence).toBe('string');
      expect(typeof anchor.notes).toBe('string');
    }
  });

  it('live anchors include radicle-nid and did-web with non-null claim_endpoint and verify_doc', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    const liveAnchors = body.anchors.filter((a: { status: string }) => a.status === 'live');
    expect(liveAnchors.length).toBe(2);
    const kinds = liveAnchors.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(['did-web', 'radicle-nid']);
    for (const anchor of liveAnchors) {
      expect(typeof anchor.claim_endpoint).toBe('string');
      expect(typeof anchor.verify_doc).toBe('string');
    }
  });

  it('roadmap anchors include ens, github-commit-signing, npm-trusted-publishing with null claim_endpoint', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    const roadmapAnchors = body.anchors.filter((a: { status: string }) => a.status === 'roadmap');
    expect(roadmapAnchors.length).toBe(3);
    const kinds = roadmapAnchors.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(['ens', 'github-commit-signing', 'npm-trusted-publishing']);
    for (const anchor of roadmapAnchors) {
      expect(anchor.claim_endpoint).toBeNull();
      expect(anchor.verify_doc).toBeNull();
    }
  });

  it('substrate fields match spec', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    expect(body.substrate.name).toBe('AgentLair');
    expect(body.substrate.did).toBe('did:web:agentlair.dev');
    expect(body.substrate.jwks_url).toBe('https://agentlair.dev/.well-known/jwks.json');
    expect(body.substrate.leaderboard_endpoint).toBe(
      'https://agentlair.dev/leaderboard/a2a.json',
    );
  });

  it('generated_at parses as a valid ISO-8601 Date', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    expect(typeof body.generated_at).toBe('string');
    expect(new Date(body.generated_at).toString()).not.toBe('Invalid Date');
  });

  it('kind values are unique', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    const kinds = body.anchors.map((a: { kind: string }) => a.kind);
    const uniqueKinds = new Set(kinds);
    expect(uniqueKinds.size).toBe(kinds.length);
  });

  it('evidence is a valid HTTPS URL for every anchor', async () => {
    const res = await get('/v1/sovereign-bridges');
    const body = await res.json();
    for (const anchor of body.anchors) {
      expect(() => new URL(anchor.evidence)).not.toThrow();
      expect(anchor.evidence.startsWith('https://')).toBe(true);
    }
  });
});
