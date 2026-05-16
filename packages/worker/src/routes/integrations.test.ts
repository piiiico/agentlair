/**
 * Hermetic integration tests for GET /v1/integrations
 * No live network — all assertions against the static handler response.
 */

import { describe, it, expect } from 'bun:test';
import { integrationsRoutes } from './integrations.js';

async function getIntegrations(): Promise<{ status: number; headers: Headers; body: unknown }> {
  const req = new Request('http://localhost/');
  const res = await integrationsRoutes.fetch(req);
  const body = await res.json();
  return { status: res.status, headers: res.headers, body };
}

describe('GET /v1/integrations', () => {
  it('responds 200 with application/json content-type', async () => {
    const { status, headers } = await getIntegrations();
    expect(status).toBe(200);
    expect(headers.get('Content-Type')).toContain('application/json');
  });

  it('cache-control header is public, max-age=300', async () => {
    const { headers } = await getIntegrations();
    expect(headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('body parses as JSON with expected top-level keys', async () => {
    const { body } = await getIntegrations();
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('generated_at');
    expect(b).toHaveProperty('substrate');
    expect(b).toHaveProperty('integrations');
  });

  it('substrate.did is did:web:agentlair.dev', async () => {
    const { body } = await getIntegrations();
    const substrate = (body as { substrate: Record<string, unknown> }).substrate;
    expect(substrate.did).toBe('did:web:agentlair.dev');
  });

  it('substrate.homepage is https://agentlair.dev', async () => {
    const { body } = await getIntegrations();
    const substrate = (body as { substrate: Record<string, unknown> }).substrate;
    expect(substrate.homepage).toBe('https://agentlair.dev');
  });

  it('substrate.jwks_url is correct', async () => {
    const { body } = await getIntegrations();
    const substrate = (body as { substrate: Record<string, unknown> }).substrate;
    expect(substrate.jwks_url).toBe('https://agentlair.dev/.well-known/jwks.json');
  });

  it('integrations array has at least 6 entries', async () => {
    const { body } = await getIntegrations();
    const integrations = (body as { integrations: unknown[] }).integrations;
    expect(integrations.length).toBeGreaterThanOrEqual(6);
  });

  it('every integration has required string fields: kind/name/url/status/evidence/notes', async () => {
    const { body } = await getIntegrations();
    const integrations = (body as { integrations: Record<string, unknown>[] }).integrations;
    for (const integration of integrations) {
      expect(typeof integration.kind).toBe('string');
      expect(typeof integration.name).toBe('string');
      expect(typeof integration.url).toBe('string');
      expect(typeof integration.status).toBe('string');
      expect(typeof integration.evidence).toBe('string');
      expect(typeof integration.notes).toBe('string');
    }
  });

  it('every integration.status is "live" (V1 invariant)', async () => {
    const { body } = await getIntegrations();
    const integrations = (body as { integrations: Record<string, unknown>[] }).integrations;
    for (const integration of integrations) {
      expect(integration.status).toBe('live');
    }
  });

  it('every integration.url and evidence start with https://', async () => {
    const { body } = await getIntegrations();
    const integrations = (body as { integrations: Record<string, unknown>[] }).integrations;
    for (const integration of integrations) {
      expect(integration.url as string).toMatch(/^https:\/\//);
      expect(integration.evidence as string).toMatch(/^https:\/\//);
    }
  });

  it('at least one npm-package, one github-repo or github-action, one public-endpoint', async () => {
    const { body } = await getIntegrations();
    const integrations = (body as { integrations: Record<string, unknown>[] }).integrations;
    const kinds = integrations.map((i) => i.kind);
    expect(kinds).toContain('npm-package');
    expect(kinds.some((k) => k === 'github-repo' || k === 'github-action')).toBe(true);
    expect(kinds).toContain('public-endpoint');
  });

  it('integrations[].name values are unique', async () => {
    const { body } = await getIntegrations();
    const integrations = (body as { integrations: Record<string, unknown>[] }).integrations;
    const names = integrations.map((i) => i.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('generated_at parses as a valid Date', async () => {
    const { body } = await getIntegrations();
    const generatedAt = (body as { generated_at: string }).generated_at;
    const d = new Date(generatedAt);
    expect(d.getTime()).not.toBeNaN();
  });

  it('no Authorization header required — handler responds 200 without auth', async () => {
    const req = new Request('http://localhost/', {
      headers: {}, // explicitly no auth headers
    });
    const res = await integrationsRoutes.fetch(req);
    expect(res.status).toBe(200);
  });
});
