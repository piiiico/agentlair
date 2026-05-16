/**
 * GET /v1/sovereign-bridges — Machine-readable sovereign bridge registry
 *
 * Public companion to the human-readable /docs/sovereign-bridges page.
 * Returns a JSON map of substrate metadata + all anchor entries (live + roadmap).
 *
 * Free public read — no API key, no x402, no auth required.
 * Mounted BEFORE the /v1/* auth middleware in index.ts.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';

export const sovereignBridgesRoutes = new Hono<HonoEnv>();

interface Anchor {
  kind: 'radicle-nid' | 'did-web' | 'ens' | 'github-commit-signing' | 'npm-trusted-publishing';
  name: string;
  status: 'live' | 'roadmap';
  claim_endpoint: string | null;
  verify_doc: string | null;
  evidence: string;
  notes: string;
}

const ANCHORS: readonly Anchor[] = [
  {
    kind: 'radicle-nid',
    name: 'AAT × Radicle NID',
    status: 'live',
    claim_endpoint: 'https://agentlair.dev/v1/agents/by-nid/{al_nid}',
    verify_doc: 'https://agentlair.dev/docs/aat-to-radicle',
    evidence: 'https://agentlair.dev/blog/aat-radicle-round-trip-shipped/',
    notes:
      'Radicle delegate Ed25519 key encoded as did:key:z6Mk... — same primitive as AAT al_nid claim.',
  },
  {
    kind: 'did-web',
    name: 'AAT × DID:Web',
    status: 'live',
    claim_endpoint: 'https://agentlair.dev/agents/{account_id}/did.json',
    verify_doc: 'https://agentlair.dev/docs/web-bot-auth',
    evidence: 'https://agentlair.dev/blog/aat-radicle-round-trip-shipped/',
    notes: 'W3C DID document with alsoKnownAs cross-link to did:key Node ID.',
  },
  {
    kind: 'ens',
    name: 'ENS DID anchors',
    status: 'roadmap',
    claim_endpoint: null,
    verify_doc: null,
    evidence: 'https://agentlair.dev/docs/sovereign-bridges',
    notes: 'ENS text record bridges al_ens claim to .eth names. Not built.',
  },
  {
    kind: 'github-commit-signing',
    name: 'GitHub commit-signing anchors',
    status: 'roadmap',
    claim_endpoint: null,
    verify_doc: null,
    evidence: 'https://agentlair.dev/docs/sovereign-bridges',
    notes:
      'Sigstore/Gitsign — derive agent ID from SSH/GPG commit signer. Bridges to getcommit.dev. Not built.',
  },
  {
    kind: 'npm-trusted-publishing',
    name: 'npm Trusted Publishing anchors',
    status: 'roadmap',
    claim_endpoint: null,
    verify_doc: null,
    evidence: 'https://agentlair.dev/docs/sovereign-bridges',
    notes: 'npm Trusted Publishing OIDC binding to GitHub repo. Not built.',
  },
];

sovereignBridgesRoutes.get('/', (c) => {
  const body = {
    generated_at: new Date().toISOString(),
    substrate: {
      name: 'AgentLair',
      did: 'did:web:agentlair.dev',
      jwks_url: 'https://agentlair.dev/.well-known/jwks.json',
      leaderboard_endpoint: 'https://agentlair.dev/leaderboard/a2a.json',
    },
    anchors: ANCHORS,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
