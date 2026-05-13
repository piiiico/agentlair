/**
 * Synthetic fixture for tools/check-cf-self-fetch.ts.
 *
 * This file exists to prove the static check works against a real path
 * under packages/worker/src/. It is:
 *   - NOT exported from src/index.ts (no route registration, no import).
 *   - Excluded from the worker build via tsconfig `exclude: ["src/**\/*.test.ts"]`
 *     and the `__test__/` directory convention.
 *   - Excluded from the default scan of tools/check-cf-self-fetch.ts
 *     (`.test.ts` files and `__test__/` dirs are skipped to avoid mock
 *     URLs in tests producing false positives).
 *
 * The static check's own unit tests programmatically scan this file (with
 * test-files explicitly enabled) and assert that both self-fetch sites
 * below are flagged. If you change this file, update the assertions in
 * tools/check-cf-self-fetch.test.ts to match.
 *
 * DO NOT remove the deliberate self-fetches below. They are test data.
 */

import { describe, test, expect } from 'bun:test';

describe('self-fetch fixture — DO NOT USE IN PRODUCTION', () => {
  test('this file is inert (no route registration)', () => {
    // The expectations live in tools/check-cf-self-fetch.test.ts; this
    // body just keeps `bun test` happy when it accidentally picks the
    // fixture up.
    expect(true).toBe(true);
  });
});

// Site 1: literal-URL self-fetch. The static check must flag this line.
async function _siteLiteral(): Promise<Response> {
  return fetch('https://agentlair.dev/.well-known/agent.json');
}

// Site 2: template-literal self-fetch (constant host prefix, dynamic path).
// The static check must flag this line.
async function _siteTemplate(id: string): Promise<Response> {
  return fetch(`https://api.agentlair.dev/v1/items/${id}`);
}

// Suppress unused-export warnings when this file is type-checked alone.
void _siteLiteral;
void _siteTemplate;
