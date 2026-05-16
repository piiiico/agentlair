/**
 * GET /v1/integrations — Machine-readable substrate integration manifest
 *
 * Public companion to the human-readable /docs/integrations page.
 * Returns a JSON manifest of all verified AgentLair integrations: npm packages,
 * GitHub repos, GitHub Actions, and public endpoints.
 *
 * Free public read — no API key, no x402, no auth required.
 * Mounted BEFORE the /v1/* auth middleware in index.ts.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';

export const integrationsRoutes = new Hono<HonoEnv>();

interface Integration {
  kind: 'npm-package' | 'github-repo' | 'github-action' | 'public-endpoint';
  name: string;
  url: string;
  status: 'live';
  evidence: string;
  notes: string;
}

export const INTEGRATIONS: readonly Integration[] = [
  {
    kind: 'npm-package',
    name: '@agentlair/mastra',
    url: 'https://www.npmjs.com/package/@agentlair/mastra',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/mastra',
    notes:
      'Mastra AAT adapter — captures agent calls, tool use, token usage; builds behavioral trust profile.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/sdk',
    url: 'https://www.npmjs.com/package/@agentlair/sdk',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/sdk',
    notes: 'Canonical TypeScript SDK for AgentLair — identity, email, vault, audit, trust.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/mcp',
    url: 'https://www.npmjs.com/package/@agentlair/mcp',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/mcp',
    notes:
      'MCP server exposing AgentLair identity + trust primitives to MCP-capable agents (Claude Code, Cursor, etc.).',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/verify',
    url: 'https://www.npmjs.com/package/@agentlair/verify',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/verify',
    notes: 'AAT verifier library — JWKS fetch + EdDSA verify; pure helper for downstream services.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/audit-logger',
    url: 'https://www.npmjs.com/package/@agentlair/audit-logger',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/audit-logger',
    notes: 'Append-only signed audit log primitive for agent action receipts.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/defenseclaw',
    url: 'https://www.npmjs.com/package/@agentlair/defenseclaw',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/defenseclaw',
    notes:
      'Defensive middleware bundle (rate limit, x402 gating, AAT verify) — drop into Hono/Cloudflare Workers.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/x402-trust-gate',
    url: 'https://www.npmjs.com/package/@agentlair/x402-trust-gate',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/x402-trust-gate',
    notes: 'HTTP-402 paywall + trust-score gate for pay-per-use agent endpoints.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/vault-crypto',
    url: 'https://www.npmjs.com/package/@agentlair/vault-crypto',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/vault-crypto',
    notes:
      'Client-side AES-256-GCM encryption for AgentLair Vault — zero-knowledge, no dependencies.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/spa-verifier',
    url: 'https://www.npmjs.com/package/@agentlair/spa-verifier',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/spa-verifier',
    notes: 'Browser-side AAT verifier for SPAs — JWKS cache + EdDSA verify in the browser.',
  },
  {
    kind: 'npm-package',
    name: '@agentlair/flue',
    url: 'https://www.npmjs.com/package/@agentlair/flue',
    status: 'live',
    evidence: 'https://registry.npmjs.org/@agentlair/flue',
    notes:
      'Flue — utility primitives used across AgentLair packages (kebab-case key helpers, error envelopes).',
  },
  {
    kind: 'github-repo',
    name: 'piiiico/agentlair',
    url: 'https://github.com/piiiico/agentlair',
    status: 'live',
    evidence: 'https://api.github.com/repos/piiiico/agentlair',
    notes: 'AgentLair monorepo — infrastructure for AI agent identity, communication, and capability exchange.',
  },
  {
    kind: 'github-action',
    name: 'piiiico/a2a-trust-audit-action',
    url: 'https://github.com/piiiico/a2a-trust-audit-action',
    status: 'live',
    evidence: 'https://api.github.com/repos/piiiico/a2a-trust-audit-action',
    notes:
      'GitHub Action — audits A2A agent cards across L1-L4 trust dimensions on every PR. Wraps the public a2a-trust-audit CLI.',
  },
  {
    kind: 'github-repo',
    name: 'piiiico/a2a-trust-audit',
    url: 'https://github.com/piiiico/a2a-trust-audit',
    status: 'live',
    evidence: 'https://api.github.com/repos/piiiico/a2a-trust-audit',
    notes:
      'Standalone CLI for auditing A2A agent cards — L1 (presence) → L4 (behavioral). AgentLair is the L4 reference.',
  },
  {
    kind: 'public-endpoint',
    name: '/v1/sovereign-bridges',
    url: 'https://api.agentlair.dev/v1/sovereign-bridges',
    status: 'live',
    evidence: 'https://agentlair.dev/docs/sovereign-bridges',
    notes:
      'Machine-readable substrate↔anchor map (Radicle NID, DID:Web, ENS, GitHub-commit-signing, npm Trusted Publishing).',
  },
  {
    kind: 'public-endpoint',
    name: '/leaderboard/a2a.json',
    url: 'https://agentlair.dev/leaderboard/a2a.json',
    status: 'live',
    evidence: 'https://agentlair.dev/leaderboard/a2a',
    notes: 'Daily-refreshed a2a-card audit leaderboard — public corpus of behavioral trust grades.',
  },
];

integrationsRoutes.get('/', (c) => {
  const body = {
    generated_at: new Date().toISOString(),
    substrate: {
      name: 'AgentLair',
      did: 'did:web:agentlair.dev',
      homepage: 'https://agentlair.dev',
      jwks_url: 'https://agentlair.dev/.well-known/jwks.json',
    },
    integrations: INTEGRATIONS,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
