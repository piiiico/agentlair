// ─── /__build — edge-propagation marker ────────────────────────────────────
// Returns the commit SHA + deploy timestamp baked into THIS bundle. Used by
// /workspace/tools/agentlair-deploy.ts to confirm Cloudflare's edge POPs are
// serving the freshly-deployed worker (not stale-cached content) before the
// deploy script declares success.
//
// Why a dedicated endpoint:
//   - Hot-path /api openapi response is heavy + cached for an hour; piggybacking
//     would force cache-busting on every deploy and add weight to every spec read.
//   - /health is too generic — adding a commit field to it would break callers
//     that depend on its current shape (timestamp, version, status).
//   - The "__" prefix signals "infrastructure endpoint, not part of the
//     public agent API surface."
//
// No auth, no rate-limit, no x402. The endpoint is intentionally trivial so
// edge propagation completes as fast as possible.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { BUILD_COMMIT, BUILD_DEPLOYED_AT } from '../build-info.js';

export const buildRoutes = new Hono<HonoEnv>();

buildRoutes.get('/', (_c) =>
  new Response(
    JSON.stringify({ commit: BUILD_COMMIT, deployed_at: BUILD_DEPLOYED_AT }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Critical: edge MUST NOT cache the marker — the whole point is to
        // observe the fresh value the moment CF promotes the new bundle.
        'Cache-Control': 'no-store',
        'X-Powered-By': 'AgentLair',
      },
    },
  ),
);
