// ── First-party visit beacon ──────────────────────────────────────────────────
// Puts agentlair.dev on the same AI-referral meter as getcommit.dev and
// synligdigital.no (poc-backend D1 `pageviews`, read by
// /workspace/tools/metrics/ai-referrals.ts).
//
// ONE injection point: every text/html response leaving this worker — the
// proxied Astro pages (proxyToPages → agentlair-web.pages.dev) and the
// server-rendered HTML (profiles, docs, a2a pages) — gets the beacon spliced
// before its real </head>. Pages without a </head> are left alone.
//
// VISIT_BEACON_SCRIPT is copied verbatim from /workspace/synlig-site/build.ts
// (symmetry contract: same endpoint, payload, text/plain sendBeacon). Keep in sync.

import type { Context, Next } from 'hono';
import type { HonoEnv } from '../types.js';

export const VISIT_BEACON_SCRIPT = `<script>
(function(){
  try {
    var url = new URL(window.location.href);
    var params = url.searchParams;
    var payload = {
      path: url.pathname,
      referrer: document.referrer || "",
      utm_source: params.get("utm_source") || undefined,
      utm_medium: params.get("utm_medium") || undefined,
      utm_campaign: params.get("utm_campaign") || undefined,
      utm_content: params.get("utm_content") || undefined,
      utm_term: params.get("utm_term") || undefined
    };
    Object.keys(payload).forEach(function(k){ if (payload[k] === undefined) delete payload[k]; });
    var endpoint = "https://poc-backend.amdal-dev.workers.dev/api/v1/visit";
    var body = JSON.stringify(payload);
    var blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) return;
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: body, keepalive: true, credentials: "omit" }).catch(function(){});
  } catch (e) {}
})();
</script>
`;

/**
 * Index of the `</head>` that actually closes <head>. Script/style bodies are
 * blanked length-preservingly first, so a literal "</head>" inside JSON-LD or
 * an inline script cannot win (synlig-site 08-09: beacon spliced into JSON-LD).
 */
export function headCloseIndex(html: string): number {
  const blanked = html
    .replace(/<script[\s\S]*?<\/script>/gi, (m) => ' '.repeat(m.length))
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => ' '.repeat(m.length));
  return blanked.toLowerCase().indexOf('</head>');
}

/** Returns html with the beacon before the real </head>, or null if no change. */
export function injectBeacon(html: string): string | null {
  if (html.includes('/api/v1/visit')) return null; // idempotent
  const at = headCloseIndex(html);
  if (at === -1) return null;
  return html.slice(0, at) + VISIT_BEACON_SCRIPT + html.slice(at);
}

export function visitBeacon() {
  return async (c: Context<HonoEnv>, next: Next): Promise<void> => {
    await next();
    if (c.req.method !== 'GET') return;
    const res = c.res;
    const ct = res.headers.get('Content-Type') || '';
    if (!ct.includes('text/html') || !res.body) return;
    if (res.headers.get('Content-Encoding')) return; // never rewrite an encoded body
    // Read the body outright (a clone()+tee left the original empty under Bun);
    // the response is rebuilt either way, unchanged when there is no </head>.
    const html = await res.text();
    const out = injectBeacon(html) ?? html;
    const headers = new Headers(res.headers);
    headers.delete('Content-Length');
    // Hono's res setter merges the OLD response's headers into the new one —
    // that would re-add the stale Content-Length. Clear first, then set.
    c.res = undefined;
    c.res = new Response(out, { status: res.status, statusText: res.statusText, headers });
  };
}
