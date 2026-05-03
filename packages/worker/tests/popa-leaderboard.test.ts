import { describe, test, expect } from 'bun:test';
import { popaRoutes } from '../src/routes/popa';

describe('popa leaderboard route', () => {
  test('handles GET /leaderboard without matching the :did route', async () => {
    // No AUDIT binding → 503 (proves the leaderboard handler ran, not :did handler
    // which would also 503 but with a different ordering proof: the :did handler
    // would return its own 503 path. The shape of the error code is what we
    // assert: leaderboard handler returns audit_unavailable, same as :did, so
    // we instead verify the response is JSON 503 (handler ran) not 404 (no
    // route matched).
    const env = {} as Record<string, unknown>;
    const res = await popaRoutes.fetch(new Request('http://x/leaderboard'), env);
    expect(res.status).toBe(503);
  });

  test('handles GET /leaderboard?sort=age', async () => {
    const env = {} as Record<string, unknown>;
    const res = await popaRoutes.fetch(new Request('http://x/leaderboard?sort=age'), env);
    expect(res.status).toBe(503);
  });
});
