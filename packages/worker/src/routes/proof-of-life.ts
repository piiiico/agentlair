/**
 * GET /v1/proof-of-life — Behavioural heartbeat
 *
 * Machine-readable live signal: AgentLair is alive RIGHT NOW, anchored to a
 * specific deployed commit. Companion to /v1/integrations (nouns) — this is
 * the verb: a single curl proves deployment recency and substrate identity.
 *
 * Free public read — no API key, no x402, no auth required.
 * Mounted BEFORE the /v1/* auth middleware in index.ts.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { BUILD_COMMIT, BUILD_DEPLOYED_AT } from '../build-info.js';
import { INTEGRATIONS } from './integrations.js';

export const proofOfLifeRoutes = new Hono<HonoEnv>();

proofOfLifeRoutes.get('/', (_c) => {
  const now = Date.now();
  const deployedMs = new Date(BUILD_DEPLOYED_AT).getTime();
  const ageSeconds = Math.max(0, Math.floor((now - deployedMs) / 1000));

  const body = {
    generated_at: new Date(now).toISOString(),
    status: 'live' as const,
    substrate: {
      name: 'AgentLair',
      did: 'did:web:agentlair.dev',
      homepage: 'https://agentlair.dev',
    },
    last_deploy: {
      commit_sha: BUILD_COMMIT === 'dev' ? 'dev' : BUILD_COMMIT.slice(0, 7),
      commit_full: BUILD_COMMIT,
      deployed_at: BUILD_DEPLOYED_AT,
      age_seconds: ageSeconds,
    },
    integrations_count: INTEGRATIONS.length,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=10',
    },
  });
});
