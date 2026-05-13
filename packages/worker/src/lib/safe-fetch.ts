// ─── CF Workers self-fetch guard ───────────────────────────────────────────
//
// Cloudflare Workers cannot fetch their own origin. The request leaves the
// edge, hits the route, gets sent back to the same worker, exceeds CPU
// budget, and CF returns 522 to the client. The bug is invisible in
// `bun test` (the production runtime is the only place it manifests) and
// hard to spot in code review because the calling code looks fine.
//
// Concrete failure (2026-05-13): the A2A audit handler self-fetched
// `https://agentlair.dev/.well-known/agent.json` for the demo card. Bun
// tests passed, pipeline review APPROVED, deploy succeeded — the live
// endpoint returned 522 to every request that hit the self-card path.
// Fix was to bypass the fetch and assemble the card in-memory. Nothing
// prevents the next self-fetch from shipping the same way.
//
// This module is defense-in-depth (ratchet 2). Ratchet 1 is the static
// pre-deploy check at tools/check-cf-self-fetch.ts which refuses to build
// when worker source contains an unannotated self-fetch.
//
// Usage:
//   import { safeFetch } from '../lib/safe-fetch.js';
//
//   // Normal call — throws SelfFetchError if URL host is one of ours.
//   const res = await safeFetch('https://api.resend.com/emails', { ... });
//
//   // Intentional self-fetch override (rare, requires audit):
//   const res = await safeFetch('https://agentlair.dev/.well-known/agent.json', {
//     allowSelfFetch: true,
//     allowSelfFetchReason: 'cron job hitting public health check',
//   });
//
// SELF_HOSTS is the union of:
//   - the production custom domain and its wildcard subdomain
//   - the worker's workers.dev hostname (account-subdomain agnostic)
// Mirror in tools/check-cf-self-fetch.ts when adding hosts.

/** Hostnames the worker must NOT fetch. Patterns: exact or `*.` prefix. */
export const SELF_HOSTS: readonly string[] = [
  'agentlair.dev',
  '*.agentlair.dev',
  'agentlair-api.workers.dev',
  'agentlair-api.*.workers.dev',
];

/** True iff `host` matches one of the SELF_HOSTS patterns. */
export function isSelfHost(host: string, patterns: readonly string[] = SELF_HOSTS): boolean {
  if (!host) return false;
  // Strip port and IPv6 brackets — same normalization as routes/badge.ts.
  let h = host.toLowerCase();
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    h = close > 0 ? h.slice(1, close) : h.slice(1);
  } else if ((h.match(/:/g) || []).length === 1) {
    h = h.split(':')[0]!;
  }
  if (!h) return false;
  for (const p of patterns) {
    if (matchHost(h, p.toLowerCase())) return true;
  }
  return false;
}

/**
 * Match a normalized host against a pattern.
 *
 * Pattern syntax:
 *   foo.com           — exact match
 *   *.foo.com         — any 1+ label prefix (api.foo.com, x.y.foo.com)
 *   foo.*.bar.com     — wildcard in the middle (foo.<one-label>.bar.com)
 *
 * `*` matches ONE OR MORE labels at the leftmost position; exactly ONE
 * label elsewhere. Intentionally narrow — broader matches risk false
 * positives on unrelated hosts (e.g. `*.workers.dev` would catch every
 * CF customer's worker).
 */
export function matchHost(host: string, pattern: string): boolean {
  if (pattern === host) return true;
  if (!pattern.includes('*')) return false;
  const pLabels = pattern.split('.');
  const hLabels = host.split('.');
  // Leftmost wildcard: 1+ labels at the head of the host.
  if (pLabels[0] === '*') {
    const tailPattern = pLabels.slice(1);
    if (hLabels.length < tailPattern.length + 1) return false;
    const hTail = hLabels.slice(hLabels.length - tailPattern.length);
    // Remaining wildcards in the tail consume one label each.
    return tailPattern.every((p, i) => (p === '*' ? true : p === hTail[i]));
  }
  // No leftmost wildcard: each `*` in the middle consumes exactly one label.
  if (pLabels.length !== hLabels.length) return false;
  return pLabels.every((p, i) => p === '*' || p === hLabels[i]);
}

/** Extract hostname from a URL string. Returns '' on parse failure. */
export function urlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Error thrown by safeFetch when the URL host is a self-host without override. */
export class SelfFetchError extends Error {
  readonly url: string;
  readonly host: string;
  constructor(url: string, host: string) {
    super(
      `safeFetch refused: ${host} is a self-host (full URL: ${url}). ` +
      `CF Workers cannot fetch their own origin — the request returns HTTP 522. ` +
      `If you genuinely need this fetch, pass { allowSelfFetch: true, allowSelfFetchReason: '...' }.`,
    );
    this.name = 'SelfFetchError';
    this.url = url;
    this.host = host;
  }
}

/** RequestInit augmented with the self-fetch escape hatch. */
export interface SafeFetchInit extends RequestInit {
  /** Set true to bypass the self-host check. Caller takes responsibility. */
  allowSelfFetch?: boolean;
  /** Short reason for the override. Required (≥8 chars) when allowSelfFetch is true. */
  allowSelfFetchReason?: string;
}

/**
 * Drop-in fetch() wrapper that refuses to call the worker's own origin.
 *
 * Throws SelfFetchError before issuing the request when the URL host is in
 * SELF_HOSTS (unless allowSelfFetch is true). The override path requires
 * allowSelfFetchReason — a missing or short reason throws SelfFetchError
 * with a hint.
 *
 * `url` may be a string, URL, or Request — same input set as global fetch.
 *
 * `fetchImpl` is the underlying fetch used after the self-host gate. Tests
 * can inject a stub; production callers should rely on the default (the
 * global `fetch` bound at call time).
 */
export async function safeFetch(
  url: string | URL | Request,
  init?: SafeFetchInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const urlStr =
    typeof url === 'string' ? url :
    url instanceof URL ? url.toString() :
    url.url;
  const host = urlHost(urlStr);
  if (host && isSelfHost(host)) {
    if (!init?.allowSelfFetch) {
      throw new SelfFetchError(urlStr, host);
    }
    if (!init.allowSelfFetchReason || init.allowSelfFetchReason.length < 8) {
      throw new SelfFetchError(
        urlStr,
        host + ' (override missing/short allowSelfFetchReason — provide ≥8 chars)',
      );
    }
  }
  // Strip the safe-fetch-only fields before passing to the underlying fetch.
  let nativeInit: RequestInit | undefined = init;
  if (init && ('allowSelfFetch' in init || 'allowSelfFetchReason' in init)) {
    const { allowSelfFetch: _a, allowSelfFetchReason: _r, ...rest } = init;
    nativeInit = rest;
  }
  return fetchImpl(url as RequestInfo, nativeInit);
}
