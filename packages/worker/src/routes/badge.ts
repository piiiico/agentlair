// ─── Trust Badge Routes ───────────────────────────────────────────────────────
//
// Public endpoints that return shields.io-style SVG badges showing an agent's
// real-time behavioral trust status. Designed to be embedded in GitHub READMEs
// as <img src="https://agentlair.dev/badge/{agentId}"> tags.
//
// Public — no auth required. Badge images cannot carry Authorization headers.
//
// Endpoints:
//   GET /badge/:agentId        — SVG badge (image/svg+xml)
//   GET /badge/:agentId.svg    — Same, explicit extension
//
// Query params:
//   style   — flat (default), flat-square, for-the-badge
//   label   — Left-side label text (default: "AgentLair Trust")
//   compact — If "true", use short label "AL" (for space-constrained contexts)
//
// Cache: 5-minute max-age for near-real-time scores without hammering D1.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import type { ATFLevel, TrustProfile } from '../trust-engine.js';
import { computeTrustScore } from '../trust-engine.js';
import { auditCardUrl, gradeColor, type Grade } from '../lib/a2a-audit.js';
import { buildSignedAgentCard } from '../a2a.js';

export const badgeRoutes = new Hono<HonoEnv>();

// ─── ATF Level → Badge Display ───────────────────────────────────────────────

interface BadgeConfig {
  tierLabel: string;
  color: string;      // Right-side background
  textColor: string;  // Right-side text (always white for contrast)
}

function getBadgeConfig(profile: TrustProfile): BadgeConfig {
  // No observations at all → pending
  if (profile.observationCount === 0) {
    return { tierLabel: 'Pending', color: '#9e9e9e', textColor: '#fff' };
  }

  const level = profile.atfLevel;
  const score = Math.round(profile.score);

  switch (level) {
    case 'principal':
      return { tierLabel: `Verified ${score}`, color: '#2196f3', textColor: '#fff' };
    case 'senior':
      return { tierLabel: `High ${score}`, color: '#4caf50', textColor: '#fff' };
    case 'junior':
      return { tierLabel: `Medium ${score}`, color: '#ff9800', textColor: '#fff' };
    case 'intern':
    default:
      return { tierLabel: `Low ${score}`, color: '#f44336', textColor: '#fff' };
  }
}

// ─── Text Width Estimation ──────────────────────────────────────────────────
// Approximate character widths for Verdana 11px (shields.io convention).
// More accurate than monospace assumption. Based on shields.io's own width table.

export const CHAR_WIDTHS: Record<string, number> = {
  ' ': 3.3, '!': 3.65, '"': 4.55, '#': 7.5, '$': 5.95, '%': 8.0, '&': 7.3,
  "'": 2.75, '(': 3.65, ')': 3.65, '*': 5.0, '+': 7.5, ',': 3.3, '-': 3.65,
  '.': 3.3, '/': 4.55, '0': 5.95, '1': 5.95, '2': 5.95, '3': 5.95,
  '4': 5.95, '5': 5.95, '6': 5.95, '7': 5.95, '8': 5.95, '9': 5.95,
  ':': 3.65, ';': 3.65, '<': 7.5, '=': 7.5, '>': 7.5, '?': 5.45,
  '@': 9.5, 'A': 6.8, 'B': 6.55, 'C': 6.55, 'D': 7.2, 'E': 5.95,
  'F': 5.55, 'G': 7.3, 'H': 7.2, 'I': 3.65, 'J': 4.55, 'K': 6.55,
  'L': 5.45, 'M': 8.15, 'N': 7.2, 'O': 7.3, 'P': 5.95, 'Q': 7.3,
  'R': 6.55, 'S': 6.55, 'T': 5.95, 'U': 7.2, 'V': 6.8, 'W': 9.3,
  'X': 5.95, 'Y': 5.95, 'Z': 6.1, 'a': 5.55, 'b': 5.95, 'c': 5.0,
  'd': 5.95, 'e': 5.55, 'f': 3.3, 'g': 5.95, 'h': 5.95, 'i': 2.75,
  'j': 3.3, 'k': 5.45, 'l': 2.75, 'm': 8.8, 'n': 5.95, 'o': 5.55,
  'p': 5.95, 'q': 5.95, 'r': 4.05, 's': 5.0, 't': 3.65, 'u': 5.95,
  'v': 5.45, 'w': 7.6, 'x': 5.45, 'y': 5.45, 'z': 4.95,
};

export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += CHAR_WIDTHS[ch] ?? 6.0;
  }
  return w;
}

// ─── SVG Rendering ──────────────────────────────────────────────────────────

export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge';

export function renderBadgeSVG(
  label: string,
  value: string,
  valueColor: string,
  style: BadgeStyle = 'flat',
): string {
  const isForTheBadge = style === 'for-the-badge';
  const fontSize = isForTheBadge ? 10 : 11;
  const horizPad = isForTheBadge ? 9 : 6;
  const height = isForTheBadge ? 28 : 20;

  const displayLabel = isForTheBadge ? label.toUpperCase() : label;
  const displayValue = isForTheBadge ? value.toUpperCase() : value;

  const labelWidth = Math.round(textWidth(displayLabel) + horizPad * 2);
  const valueWidth = Math.round(textWidth(displayValue) + horizPad * 2);
  const totalWidth = labelWidth + valueWidth;

  const labelBg = '#555';
  const valueBg = valueColor;

  const r = style === 'flat-square' ? 0 : 3;
  const textY = isForTheBadge ? 17.5 : 14;
  const shadowY = isForTheBadge ? 16.5 : 13;

  // Build gradient for flat style (subtle 3D effect)
  const gradientDef = style === 'flat'
    ? `<linearGradient id="s" x2="0" y2="100%">
        <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
        <stop offset="1" stop-opacity=".1"/>
      </linearGradient>`
    : '';
  const gradientRect = style === 'flat'
    ? `<rect rx="${r}" width="${totalWidth}" height="${height}" fill="url(#s)"/>`
    : '';

  const letterSpacing = isForTheBadge ? '.6' : '.5';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${height}" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <!-- Live leaderboard: https://agentlair.dev/leaderboard/a2a -->
  <title>${escapeXml(label)}: ${escapeXml(value)}</title>
  ${gradientDef}
  <clipPath id="r">
    <rect width="${totalWidth}" height="${height}" rx="${r}" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="${height}" fill="${labelBg}"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${height}" fill="${valueBg}"/>
    ${gradientRect}
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="${fontSize}">
    <text aria-hidden="true" x="${labelWidth / 2}" y="${shadowY + 1}" fill="#010101" fill-opacity=".3" letter-spacing="${letterSpacing}">${escapeXml(displayLabel)}</text>
    <text x="${labelWidth / 2}" y="${textY}" fill="#fff" letter-spacing="${letterSpacing}">${escapeXml(displayLabel)}</text>
    <text aria-hidden="true" x="${labelWidth + valueWidth / 2}" y="${shadowY + 1}" fill="#010101" fill-opacity=".3" letter-spacing="${letterSpacing}">${escapeXml(displayValue)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="${textY}" fill="#fff" letter-spacing="${letterSpacing}">${escapeXml(displayValue)}</text>
  </g>
</svg>`;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Error Badge ─────────────────────────────────────────────────────────────

export function renderErrorBadge(label: string, message: string, style: BadgeStyle): string {
  return renderBadgeSVG(label, message, '#9e9e9e', style);
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

export function parseStyle(raw: string | undefined): BadgeStyle {
  if (raw === 'flat-square' || raw === 'flat_square') return 'flat-square';
  if (raw === 'for-the-badge' || raw === 'for_the_badge') return 'for-the-badge';
  return 'flat';
}

const AGENT_ID_RE = /^acc_[A-Za-z0-9_-]{1,64}$/;

async function handleBadgeRequest(c: any): Promise<Response> {
  // Extract agentId — strip optional .svg extension
  let agentId = c.req.param('agentId') || '';
  if (agentId.endsWith('.svg')) {
    agentId = agentId.slice(0, -4);
  }

  const style = parseStyle(c.req.query('style'));
  const compact = c.req.query('compact') === 'true';
  const customLabel = c.req.query('label');
  const label = customLabel || (compact ? 'AL' : 'AgentLair Trust');

  // Validate agent ID
  if (!agentId || !AGENT_ID_RE.test(agentId)) {
    return svgResponse(renderErrorBadge(label, 'invalid id', style));
  }

  // Check AUDIT binding
  const db = c.env.AUDIT;
  if (!db) {
    return svgResponse(renderErrorBadge(label, 'unavailable', style));
  }

  try {
    // First try cached trust_profiles for speed
    let score: number | null = null;
    let atfLevel: ATFLevel = 'intern';
    let observationCount = 0;

    try {
      const cached = await db.prepare(
        'SELECT score, confidence, atf_level, observation_count FROM trust_profiles WHERE agent_id = ? LIMIT 1'
      ).bind(agentId).first() as {
        score: number;
        confidence: number;
        atf_level: string;
        observation_count: number;
      } | null;

      if (cached) {
        score = cached.score;
        atfLevel = cached.atf_level as ATFLevel;
        observationCount = cached.observation_count ?? 0;
      }
    } catch {
      // Cache miss or table not ready — fall through to full computation
    }

    // Full computation if no cache hit
    if (score === null) {
      try {
        const profile = await computeTrustScore(db, agentId);
        score = profile.score;
        atfLevel = profile.atfLevel;
        observationCount = profile.observationCount;
      } catch {
        // Agent has no audit trail at all — show pending
        score = 0;
        atfLevel = 'intern';
        observationCount = 0;
      }
    }

    // Build badge config from a minimal TrustProfile-like object
    const config = getBadgeConfig({
      score, atfLevel, observationCount,
    } as TrustProfile);

    return svgResponse(renderBadgeSVG(label, config.tierLabel, config.color, style));
  } catch {
    return svgResponse(renderErrorBadge(label, 'error', style));
  }
}

export interface SvgResponseOpts {
  ttl?: number;       // Cache TTL in seconds. Default: 300 (5 minutes).
  status?: number;    // HTTP status. Default: 200.
}

export function svgResponse(svg: string, opts: SvgResponseOpts = {}): Response {
  const ttl = opts.ttl ?? 300;
  return new Response(svg, {
    status: opts.status ?? 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
      'X-Content-Type-Options': 'nosniff',
      // Allow embedding in any page (GitHub READMEs, docs, etc.)
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ─── Public Trust Score JSON ─────────────────────────────────────────────────
//
// GET /badge/:agentId/score.json
//
// Public endpoint returning full trust profile as JSON. No auth required.
// Designed for the /explore page and third-party integrations.
//
// Returns: { agentId, score, confidence, atfLevel, trend, dimensions, observationCount, computedAt }
// Cache: 5-minute max-age (same as badge SVGs).

async function handleScoreJsonRequest(c: any): Promise<Response> {
  const agentId = c.req.param('agentId') || '';

  if (!agentId || !AGENT_ID_RE.test(agentId)) {
    return new Response(JSON.stringify({ error: 'Invalid agent ID format. Expected: acc_<alphanumeric>.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const db = c.env.AUDIT;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Trust scoring unavailable.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const profile = await computeTrustScore(db, agentId);
    // Return public-safe subset (omit internal tier caps and raw signals)
    const publicProfile = {
      agentId: profile.agentId,
      score: Math.round(profile.score),
      confidence: Math.round(profile.confidence * 1000) / 1000,
      atfLevel: profile.atfLevel,
      trend: profile.trend,
      dimensions: {
        consistency: { score: Math.round(profile.dimensions.consistency.score), confidence: profile.dimensions.consistency.confidence },
        restraint: { score: Math.round(profile.dimensions.restraint.score), confidence: profile.dimensions.restraint.confidence },
        transparency: { score: Math.round(profile.dimensions.transparency.score), confidence: profile.dimensions.transparency.confidence },
      },
      observationCount: profile.observationCount,
      computedAt: profile.computedAt,
    };
    return new Response(JSON.stringify(publicProfile), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Trust score computation failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// ─── A2A Trust Audit Badge ───────────────────────────────────────────────────
//
// GET /badge/a2a/:encoded[.svg]    — SVG badge rendering @agentlair/a2a-trust-audit
//                                     scoring of the agent at the encoded URL.
// GET /badge/a2a/:encoded/score.json — JSON of the same audit result.
//
// :encoded = base64url-encoded card URL. Standards-compliant base64url accepts
//   chars [A-Za-z0-9_-] with optional `=` padding stripped. Examples:
//     base64url("https://agentlair.dev/.well-known/agent.json") =
//       "aHR0cHM6Ly9hZ2VudGxhaXIuZGV2Ly53ZWxsLWtub3duL2FnZW50Lmpzb24"
//
// Cache: 1h (audit is expensive — fetch + parse + 20+ checks).

const A2A_BADGE_TTL_SECONDS = 3600;

// Hosts the audit refuses to fetch. Block private/loopback nets and
// any LAN-style address. We only accept http(s) URLs (already enforced in
// fetchAgentCard) but also pre-screen the host string. Belt + suspenders for SSRF.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
  /^169\.254\./,                  // link-local
  /^0\./,                         // 0.0.0.0/8
  /\.local$/i, /\.internal$/i,    // common LAN suffixes
  /^\[?::1\]?$/,                  // IPv6 loopback
  /^\[?fc/i, /^\[?fd/i, /^\[?fe80/i, // IPv6 ULA / link-local
];

export function isPublicHost(host: string): boolean {
  // Strip port carefully — bare IPv6 has multiple colons and no port; bracketed
  // IPv6 may have a port after `]:`; hostnames/IPv4 have at most one colon.
  let h = host;
  if (h.startsWith('[')) {
    // [::1] or [::1]:8080 → ::1
    const close = h.indexOf(']');
    h = close > 0 ? h.slice(1, close) : h.slice(1);
  } else {
    const colonCount = (h.match(/:/g) || []).length;
    if (colonCount === 1) {
      // host:port (IPv4 or DNS) — strip port
      h = h.split(':')[0];
    }
    // else: bare IPv6 (multiple colons) or no colons — leave intact
  }
  if (!h) return false;
  for (const p of PRIVATE_HOST_PATTERNS) {
    if (p.test(h)) return false;
  }
  return true;
}

export function decodeBase64UrlCardUrl(encoded: string): string | null {
  try {
    // Strip optional .svg suffix
    let token = encoded;
    if (token.endsWith('.svg')) token = token.slice(0, -4);

    // base64url → base64 (replace - and _, pad to multiple of 4)
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';

    const decoded = atob(b64);
    if (!/^https?:\/\//i.test(decoded)) return null;
    // Parse to validate + extract host
    const u = new URL(decoded);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!isPublicHost(u.host)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * True when the URL points to agentlair.dev or its API subdomain.
 * CF Workers can't fetch their own zone via public DNS — these share the same
 * AgentCard (buildSignedAgentCard), so both are served without a network fetch.
 * Any other *.agentlair.dev subdomain is NOT covered; that case returns a clear
 * CF inside-zone error in the audit route.
 */
export function isSelfUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'agentlair.dev' || hostname === 'api.agentlair.dev';
  } catch {
    return false;
  }
}

async function handleA2ABadgeRequest(c: any): Promise<Response> {
  const encoded = c.req.param('encoded') || '';
  const style = parseStyle(c.req.query('style'));
  const customLabel = c.req.query('label');
  const label = customLabel || 'A2A Trust';

  const cardUrl = decodeBase64UrlCardUrl(encoded);
  if (!cardUrl) {
    return svgResponse(renderErrorBadge(label, 'invalid url', style), { ttl: 300 });
  }

  // Cloudflare Cache API — cache the rendered SVG keyed by the request URL
  // (includes query params, so different styles/labels get separate cache entries).
  // `caches` is available in CF Workers (and the worker runtime); not in bun tests.
  const cache: Cache | undefined =
    typeof caches !== 'undefined' ? (caches as any).default : undefined;
  const cacheKey = new Request(c.req.url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  try {
    // Bypass CF Worker self-fetch (returns 522) by building the card in-memory.
    // Guard: only bypass when AUDIT_SIGNING_KEY is set (always in production,
    // never in tests) — this ensures test mocks via globalThis.fetch still work.
    let fetchImpl: typeof fetch | undefined;
    if (isSelfUrl(cardUrl) && c.env?.AUDIT_SIGNING_KEY) {
      const card = await buildSignedAgentCard(c.env?.AUDIT_SIGNING_KEY);
      fetchImpl = (async () =>
        new Response(JSON.stringify(card), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch;
    }

    const result = await auditCardUrl(cardUrl, fetchImpl);
    const overall = result.scores.overall;
    const value = `${result.grade} ${overall}`;
    const color = gradeColor(result.grade as Grade);
    const svg = renderBadgeSVG(label, value, color, style);
    const response = svgResponse(svg, { ttl: A2A_BADGE_TTL_SECONDS });

    // Stash a clone in Cloudflare's edge cache (no-await — we don't want to
    // block the response on cache write).
    if (cache) {
      // c.executionCtx is a Hono helper exposing the worker's ExecutionContext.
      const ctx = c.executionCtx;
      const cloned = response.clone();
      if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cloned));
      else await cache.put(cacheKey, cloned);
    }
    return response;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'audit failed';
    // Render an "error" badge with short cache so transient failures recover quickly.
    const short = msg.length > 24 ? 'error' : msg.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 24);
    return svgResponse(renderErrorBadge(label, short || 'error', style), { ttl: 60 });
  }
}

async function handleA2AScoreJsonRequest(c: any): Promise<Response> {
  const encoded = c.req.param('encoded') || '';
  const cardUrl = decodeBase64UrlCardUrl(encoded);
  if (!cardUrl) {
    return jsonResponse({ error: 'Invalid base64url card URL.' }, 400, 60);
  }
  try {
    // Bypass CF Worker self-fetch (returns 522) by building the card in-memory.
    let fetchImpl: typeof fetch | undefined;
    if (isSelfUrl(cardUrl) && c.env?.AUDIT_SIGNING_KEY) {
      const card = await buildSignedAgentCard(c.env?.AUDIT_SIGNING_KEY);
      fetchImpl = (async () =>
        new Response(JSON.stringify(card), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch;
    }

    const result = await auditCardUrl(cardUrl, fetchImpl);
    return jsonResponse({
      target: result.target,
      fetched_from: result.fetched_from,
      agent_name: result.card.name ?? null,
      scores: result.scores,
      grade: result.grade,
      checks: result.checks.map(c => ({
        id: c.id, layer: c.layer, name: c.name, pass: c.pass, severity: c.severity,
      })),
    }, 200, A2A_BADGE_TTL_SECONDS);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'audit failed';
    return jsonResponse({ error: msg }, 502, 60);
  }
}

function jsonResponse(body: unknown, status: number, ttl: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ─── Mount Routes ────────────────────────────────────────────────────────────
// Handles both /badge/:agentId and /badge/:agentId.svg
// Also handles /badge/:agentId/score.svg for GitHub Actions / shields.io compat
//
// A2A audit routes registered FIRST so the static "a2a" segment wins over the
// catch-all `:agentId` parameter route.

badgeRoutes.get('/a2a/:encoded/score.json', handleA2AScoreJsonRequest);
badgeRoutes.get('/a2a/:encoded', handleA2ABadgeRequest);

badgeRoutes.get('/:agentId/score.json', handleScoreJsonRequest);
badgeRoutes.get('/:agentId/score.svg', handleBadgeRequest);
badgeRoutes.get('/:agentId', handleBadgeRequest);
