// ─── Dynamic A2A Sitemap ─────────────────────────────────────────────────────
//
// Generates /sitemap-a2a.xml from the a2aregistry.org registry.
// Each valid agent card URL gets a <url> entry pointing to /a2a/<thumbprint>.
// Uses CF Cache API for edge caching (5min), with last-known fallback on failure.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { decodeBase64UrlCardUrl } from './badge.js';

export const sitemapA2aRoutes = new Hono<HonoEnv>();

// ─── Helpers ────────────────────────────────────────────────────────────────

function toBase64Url(s: string): string {
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function xmlHeaders(maxAge: number): HeadersInit {
  return {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
  };
}

const EMPTY_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`;

function renderSitemap(cards: { url: string }[]): string {
  const today = new Date().toISOString().slice(0, 10);

  const entries: string[] = [];
  for (const card of cards) {
    const cardUrl = card.url;
    if (!cardUrl || typeof cardUrl !== 'string') continue;

    // Encode and round-trip validate (SSRF guard: only emit if decodeBase64UrlCardUrl accepts it)
    const encoded = toBase64Url(cardUrl);
    if (!decodeBase64UrlCardUrl(encoded)) continue;

    entries.push(`  <url>
    <loc>https://agentlair.dev/a2a/${encoded}</loc>
    <lastmod>${today}</lastmod>
    <priority>0.5</priority>
  </url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;
}

// ─── Route Handler ──────────────────────────────────────────────────────────

const SITEMAP_CACHE_KEY = 'sitemap-a2a:v1';
const SITEMAP_LAST_GOOD_KEY = 'sitemap-a2a:last-good';

sitemapA2aRoutes.get('/sitemap-a2a.xml', async (c) => {
  // Try KV cache first (5min TTL)
  const kv = c.env?.KEYS;
  if (kv) {
    try {
      const cached = await kv.get(SITEMAP_CACHE_KEY);
      if (cached) return new Response(cached, { headers: xmlHeaders(300) });
    } catch {
      // KV read failed — proceed to fetch
    }
  }

  // Fetch a2aregistry.org
  let cards: { url: string }[] = [];
  try {
    const r = await fetch('https://a2aregistry.org/api/agents', {
      headers: { 'User-Agent': 'agentlair-sitemap/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) {
      const j = await r.json() as any;
      // API returns { agents: [...] } — each agent has url (A2A endpoint) and
      // wellKnownURI (agent card URL). We use wellKnownURI for card pages.
      const rawAgents: any[] = Array.isArray(j) ? j : (j.agents ?? j.cards ?? []);
      cards = rawAgents
        .map((a: any) => ({ url: a.wellKnownURI || a.url || '' }))
        .filter((c: { url: string }) => c.url);
    }
  } catch {
    // Fall through to last-known cache
  }

  if (cards.length === 0) {
    // Degrade gracefully: serve last-known XML or empty sitemap
    if (kv) {
      try {
        const last = await kv.get(SITEMAP_LAST_GOOD_KEY);
        if (last) return new Response(last, { headers: xmlHeaders(60) });
      } catch {
        // KV read failed
      }
    }
    return new Response(EMPTY_SITEMAP, { headers: xmlHeaders(60) });
  }

  const xml = renderSitemap(cards);

  // Cache in KV: 5-min TTL + permanent last-good fallback
  if (kv) {
    try {
      await Promise.all([
        kv.put(SITEMAP_CACHE_KEY, xml, { expirationTtl: 300 }),
        kv.put(SITEMAP_LAST_GOOD_KEY, xml),
      ]);
    } catch {
      // KV write failed — serve the response anyway
    }
  }

  return new Response(xml, { headers: xmlHeaders(300) });
});
