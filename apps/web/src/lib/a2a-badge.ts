export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge';

const BADGE_BASE = 'https://agentlair.dev/badge/a2a';

export function encodeCardUrl(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function validateCardUrl(url: string): { ok: true } | { ok: false; error: string } {
  if (!url || !url.trim()) return { ok: false, error: 'Enter an A2A card URL.' };
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return { ok: false, error: 'Not a valid URL.' }; }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only https:// URLs are accepted.' };
  }
  return { ok: true };
}

export function buildBadgeUrl(opts: { encoded: string; style: BadgeStyle; label?: string }): string {
  const params = new URLSearchParams();
  if (opts.style !== 'flat') params.set('style', opts.style);
  if (opts.label) params.set('label', opts.label);
  const qs = params.toString();
  return `${BADGE_BASE}/${opts.encoded}${qs ? `?${qs}` : ''}`;
}

export function buildScoreUrl(encoded: string): string {
  return `${BADGE_BASE}/${encoded}/score.json`;
}

export function buildMarkdownSnippet(opts: { badgeUrl: string; cardUrl: string }): string {
  return `[![A2A Trust Audit](${opts.badgeUrl})](${opts.cardUrl})`;
}

export function buildHtmlSnippet(opts: { badgeUrl: string; cardUrl: string }): string {
  return `<a href="${opts.cardUrl}"><img src="${opts.badgeUrl}" alt="A2A Trust Audit Badge" /></a>`;
}

export function buildAsciidocSnippet(opts: { badgeUrl: string; cardUrl: string }): string {
  return `image:${opts.badgeUrl}[A2A Trust Audit Badge,link=${opts.cardUrl}]`;
}

export function buildGithubActionYaml(cardUrl: string): string {
  return `name: A2A Trust Audit
on:
  pull_request:
    paths: ['.well-known/agent-card.json', 'agent-card.json']
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: piiiico/a2a-trust-audit-action@v1
        with:
          card-url: '${cardUrl}'
          fail-on: 'critical'`;
}
