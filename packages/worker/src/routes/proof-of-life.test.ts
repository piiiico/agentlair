/**
 * Hermetic integration tests for GET /v1/proof-of-life
 * No live network — all assertions against the static handler response.
 */

import { describe, it, expect } from 'bun:test';
import { proofOfLifeRoutes } from './proof-of-life.js';
import { INTEGRATIONS } from './integrations.js';

async function getProofOfLife(): Promise<{ status: number; headers: Headers; body: Record<string, unknown> }> {
  const req = new Request('http://localhost/');
  const res = await proofOfLifeRoutes.fetch(req);
  const body = await res.json();
  return { status: res.status, headers: res.headers, body: body as Record<string, unknown> };
}

describe('GET /v1/proof-of-life', () => {
  it('responds 200 with application/json content-type', async () => {
    const { status, headers } = await getProofOfLife();
    expect(status).toBe(200);
    expect(headers.get('Content-Type')).toContain('application/json');
  });

  it('cache-control header is public, max-age=10', async () => {
    const { headers } = await getProofOfLife();
    expect(headers.get('Cache-Control')).toBe('public, max-age=10');
  });

  it('body parses as JSON', async () => {
    const { body } = await getProofOfLife();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('status is the literal string live', async () => {
    const { body } = await getProofOfLife();
    expect(body.status).toBe('live');
  });

  it('substrate.did is did:web:agentlair.dev', async () => {
    const { body } = await getProofOfLife();
    const substrate = body.substrate as Record<string, unknown>;
    expect(substrate.did).toBe('did:web:agentlair.dev');
  });

  it('substrate.homepage is https://agentlair.dev', async () => {
    const { body } = await getProofOfLife();
    const substrate = body.substrate as Record<string, unknown>;
    expect(substrate.homepage).toBe('https://agentlair.dev');
  });

  it('substrate.name is AgentLair', async () => {
    const { body } = await getProofOfLife();
    const substrate = body.substrate as Record<string, unknown>;
    expect(substrate.name).toBe('AgentLair');
  });

  it('last_deploy.commit_sha is length 7 or equals dev', async () => {
    const { body } = await getProofOfLife();
    const lastDeploy = body.last_deploy as Record<string, unknown>;
    const sha = lastDeploy.commit_sha as string;
    expect(typeof sha).toBe('string');
    expect(sha === 'dev' || sha.length === 7).toBe(true);
  });

  it('last_deploy.commit_full is length 40 or equals dev', async () => {
    const { body } = await getProofOfLife();
    const lastDeploy = body.last_deploy as Record<string, unknown>;
    const full = lastDeploy.commit_full as string;
    expect(typeof full).toBe('string');
    expect(full === 'dev' || full.length === 40).toBe(true);
  });

  it('last_deploy.deployed_at parses as a valid Date', async () => {
    const { body } = await getProofOfLife();
    const lastDeploy = body.last_deploy as Record<string, unknown>;
    const deployedAt = lastDeploy.deployed_at as string;
    expect(typeof deployedAt).toBe('string');
    expect(Number.isNaN(Date.parse(deployedAt))).toBe(false);
  });

  it('last_deploy.age_seconds is a non-negative integer', async () => {
    const { body } = await getProofOfLife();
    const lastDeploy = body.last_deploy as Record<string, unknown>;
    const ageSeconds = lastDeploy.age_seconds as number;
    expect(typeof ageSeconds).toBe('number');
    expect(Number.isInteger(ageSeconds)).toBe(true);
    expect(ageSeconds).toBeGreaterThanOrEqual(0);
  });

  it('integrations_count is a positive integer matching INTEGRATIONS.length', async () => {
    const { body } = await getProofOfLife();
    const count = body.integrations_count as number;
    expect(typeof count).toBe('number');
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(INTEGRATIONS.length);
  });

  it('generated_at parses as a valid Date', async () => {
    const { body } = await getProofOfLife();
    const generatedAt = body.generated_at as string;
    expect(typeof generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(generatedAt))).toBe(false);
  });

  it('no Authorization header required — handler returns 200 without auth', async () => {
    const req = new Request('http://localhost/');
    // Explicitly: no Authorization header set
    const res = await proofOfLifeRoutes.fetch(req);
    expect(res.status).toBe(200);
  });
});
