// ─── robots.txt — Crawler directives + sitemap discovery ──────────────────────
// Mirrors the llms-txt.ts pattern. Body served at GET /robots.txt as text/plain.
// Sitemap entries point to BOTH the apps/web Pages-generated sitemap and the
// worker-served per-A2A-card sitemap, so crawlers can discover URLs the public
// site advertises.

export const ROBOTS_TXT = `User-agent: *
Allow: /

# AI training and inference crawlers — explicit allow
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

Sitemap: https://agentlair.dev/sitemap-0.xml
Sitemap: https://agentlair.dev/sitemap-a2a.xml
`;
