// ─── robots.txt — Crawler directives + sitemap discovery ──────────────────────
// Mirrors the llms-txt.ts pattern. Body served at GET /robots.txt as text/plain.
// Sitemap entries point to BOTH the apps/web Pages-generated sitemap and the
// worker-served per-A2A-card sitemap, so crawlers can discover URLs the public
// site advertises.

export const ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: https://agentlair.dev/sitemap-0.xml
Sitemap: https://agentlair.dev/sitemap-a2a.xml
`;
