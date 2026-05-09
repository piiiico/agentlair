// ─── AgentLair Worker — Hono Router ──────────────────────────────────────────
// Clean Hono app with middleware. Route files handle business logic.
// Email handler (CF Workers email routing) is separate — not part of Hono.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';
import { nanoid, sha256hex, hmacSha256, json, err, VERBOSE_ONLY_FIELDS } from './utils.js';
import type { Env, Account, RouteContext, RouteHandler } from './types.js';
import { InboxNotifier } from './durable-objects/inbox-notifier.js';
import { API_DISCOVERY, OPENAPI_SPEC, SCALAR_DOCS_HTML } from './openapi.js';
import { buildSignedAgentCard } from './a2a.js';
import { LLMS_TXT } from './llms-txt.js';
import { ROBOTS_TXT } from './robots-txt.js';
import { RSL_XML, AGENTS_JSON } from './well-known-extras.js';
import { authenticateAny } from './middleware/auth.js';
import { buildJWKS, getPublicKey, computeKeyId, publicKeyToJWK } from './jwt.js';
import { checkRateLimit, checkPodRateLimit } from './middleware/ratelimit.js';
import { detectAgent, AGENTLAIR_MANIFEST } from './middleware/agent-detect.js';
import { securityHeaders } from './middleware/security-headers.js';
import { auditMiddleware } from './middleware/audit.js';
import { budgetMiddleware } from './middleware/budget.js';
import { encryptEmailField, encryptEmailE2E } from './platform-crypto.js';
import { make402Response, SERVICE_PRICES, X402_CONFIG, getPaymentRequirements, verifyX402Payment, settleX402Payment, trackX402Spend, autoUpgradeIfThreshold, getGlobalRevenue, checkSpendingCap, getBillingAnomalies } from './x402.js';
import type { ServicePaymentConfig } from './x402.js';

// ─── Route modules ─────────────────────────────────────────────────────────────
import { handleAuthRoutes, handleAdminRoutes } from './routes/auth.js';
import { handleVaultRoutes } from './routes/vault.js';
import { handleEmailRoutes } from './routes/email.js';
import { handleWebhookRoutes } from './routes/webhooks.js';
import { handleDomainRoutes } from './routes/domains.js';
import { stackRoutes } from './routes/stacks.js';
import { podRoutes } from './routes/pods.js';
import { handleCalendarRoutes } from './routes/calendar.js';
import { tokenRoutes, publicTokenRoutes } from './routes/tokens.js';
import { signingKeyRoutes, getSigningKey, getSigningKeyByThumbprint } from './routes/signing-keys.js';
import { auditRoutes, publicAuditRoutes } from './routes/audit.js';
import { sessionRoutes } from './routes/sessions.js';
import { budgetRoutes } from './routes/budget.js';
import { gatewayRoutes } from './routes/gateway.js';
import { handleRegisterRoute } from './routes/register.js';
import { handleRegisterVerifyRoute } from './routes/register-verify.js';
import { handleCredentialRoutes } from './routes/credentials.js';
import { approvalRoutes, chargeRoutes } from './routes/approvals.js';
import { trustRoutes, publicTrustRoutes } from './routes/trust.js';
import { discoveryRoutes } from './routes/discovery.js';
import { memoryTrustRoutes } from './routes/memory-trust.js';
import { badgeRoutes } from './routes/badge.js';
import { a2aCardRoutes } from './routes/a2a-cards.js';
import { ogA2aRoutes } from './routes/og-a2a.js';
import { sitemapA2aRoutes } from './routes/sitemap-a2a.js';
import { handleTaskRoutes } from './routes/tasks.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { eventRoutes } from './routes/events.js';
import { didRoutes } from './routes/did.js';
import { specRoutes } from './routes/spec.js';
import { idpRoutes, revokeRoutes, buildOIDCDiscovery } from './idp/index.js';
import { demoRoutes } from './routes/demo.js';
import { scittRoutes, publicScittRoutes } from './routes/scitt.js';
import { publicStatsRoutes } from './routes/stats.js';
import { popaRoutes, popaEnrollRoutes, popaAgentRoutes } from './routes/popa.js';
import { bccRoutes, bccPublicRoutes } from './routes/bcc.js';
import { skillProvenanceRoutes } from './routes/skill-provenance.js';
import { runPoPADaily } from './crons/popa-daily.js';
import { handleCheckout, handleStripeWebhook } from './routes/stripe.js';
import { EXPLORE_HTML } from './routes/explore.js';
import { computeTrustScore } from './trust-engine.js';
import { wbaRoutes } from './routes/wba.js';
import { renderAgentProfileHTML, fetchProfileExtras } from './profile-render.js';
import type { ProfileExtras } from './profile-render.js';

// ─── Hono App Type ──────────────────────────────────────────────────────────────

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    account: Account | null;
  };
};

// ─── Agent Profile HTML Template ────────────────────────────────────────────
// Rendered server-side when GET /agents/:name receives Accept: text/html.
// Free to access — no x402 required. Satisfies "Basic agent profile page" feature.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Helper: adapt legacy RouteHandler to Hono handler ──────────────────────────
// Calls the existing handler with the correct RouteContext.
// If the handler returns null (no route match), falls through to next middleware.

function legacyHandler(handler: RouteHandler) {
  return async (c: Context<HonoEnv>, next: Next): Promise<void | Response> => {
    const url = new URL(c.req.url);
    const rc: RouteContext = {
      url,
      path: url.pathname,
      method: c.req.method,
      account: c.get('account'),
    };
    const response = await handler(c.req.raw, c.env, c.executionCtx, rc);
    if (response) return response;
    await next();
  };
}

// Same as legacyHandler but always passes account: null (for public routes)
function publicHandler(handler: RouteHandler) {
  return async (c: Context<HonoEnv>, next: Next): Promise<void | Response> => {
    const url = new URL(c.req.url);
    const rc: RouteContext = {
      url,
      path: url.pathname,
      method: c.req.method,
      account: null,
    };
    const response = await handler(c.req.raw, c.env, c.executionCtx, rc);
    if (response) return response;
    await next();
  };
}


// ─── Helper: map request path to service payment config for 402 responses ──────
// Used by rate limit middleware to return correct x402 requirements per service.
// Specific write paths get per-service pricing; everything else falls back to general_api.
function getServiceForPath(path: string, method?: string): ServicePaymentConfig {
  if (method === 'GET') {
    return SERVICE_PRICES.general_api;
  }
  if (path.startsWith('/v1/email') || path.startsWith('/v1/inbox') || path.startsWith('/v1/tasks')) {
    return SERVICE_PRICES.email_send;
  }
  if (path.startsWith('/v1/vault')) {
    return SERVICE_PRICES.vault_write;
  }
  if (path.startsWith('/v1/calendar')) {
    return SERVICE_PRICES.calendar_event;
  }
  if (path.startsWith('/v1/stack')) {
    return SERVICE_PRICES.stack_create;
  }
  // Fallback: any unmatched path (inbox reads, message reads, outbox, etc.) — 0.001 USDC
  return SERVICE_PRICES.general_api;
}

// ─── x402 self-handling routes ──────────────────────────────────────────────────
// These routes verify + settle x402 payments in their own handler code.
// The middleware must NOT double-verify for these — just pass through.
const SELF_HANDLING_X402: Array<[string, string]> = [
  ['POST', '/v1/email/send'],
  ['POST', '/v1/vault'],
  ['PUT', '/v1/vault'],
  ['POST', '/v1/calendar/events'],
  ['POST', '/v1/stack'],
  ['POST', '/v1/account/upgrade'],
  ['POST', '/v1/tasks'],
  ['POST', '/v1/events'],  // RFC-003: behavioral event ingestion handles x402 internally
];

function hasOwnX402Handler(method: string, path: string): boolean {
  return SELF_HANDLING_X402.some(([m, p]) => method === m && path.startsWith(p));
}

// ─── Helper: proxy request to CF Pages (Astro landing page) ─────────────────────

const PAGES_ORIGIN = 'https://agentlair-web.pages.dev';

async function proxyToPages(c: Context<HonoEnv>, path?: string): Promise<Response> {
  const pagesBase = (c.env.PAGES_URL || PAGES_ORIGIN).replace(/\/$/, '');
  const targetPath = path ?? new URL(c.req.url).pathname;
  try {
    const upstream = await fetch(`${pagesBase}${targetPath}`, {
      headers: { 'User-Agent': 'AgentLair-Worker/1.0' },
    });
    // Follow CF Pages trailing-slash redirects transparently
    if (upstream.status === 308 || upstream.status === 301) {
      const location = upstream.headers.get('Location');
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : `${pagesBase}${location}`;
        const redirected = await fetch(redirectUrl, {
          headers: { 'User-Agent': 'AgentLair-Worker/1.0' },
        });
        const body = await redirected.arrayBuffer();
        const ct = redirected.headers.get('Content-Type') || 'text/html; charset=utf-8';
        return new Response(body, {
          status: redirected.status,
          headers: {
            'Content-Type': ct,
            'X-Powered-By': 'AgentLair',
            'Cache-Control': ct.includes('text/html') ? 'public, max-age=3600' : 'public, max-age=86400',
          },
        });
      }
    }
    const body = await upstream.arrayBuffer();
    const ct = upstream.headers.get('Content-Type') || 'text/html; charset=utf-8';
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': ct,
        'X-Powered-By': 'AgentLair',
        'Cache-Control': ct.includes('text/html') ? 'public, max-age=3600' : 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Service temporarily unavailable', { status: 503 });
  }
}

// ─── App ────────────────────────────────────────────────────────────────────────

const app = new Hono<HonoEnv>();

// ── 1. CORS ─────────────────────────────────────────────────────────────────────

app.use('*', cors({
  origin: ['https://agentlair.dev', 'https://*.agentlair.dev'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'X-PAYMENT', 'X-AGENTKIT'],
  exposeHeaders: ['X-402-Version', 'X-Payment-Response'],
  maxAge: 86400,
}));

// ── 1.5. Security Headers ────────────────────────────────────────────────────────
// Must come after CORS so CORS headers are set first, security headers layer on top.

app.use('*', securityHeaders());

// ── 2. Astro static assets — proxy to CF Pages ───────────────────────────────────
// These MUST come before any other route handlers so /_astro/*, /fonts/*, etc.
// are always served from the Astro build.

app.get('/_astro/*', (c) => proxyToPages(c));
app.get('/fonts/*', (c) => proxyToPages(c));
app.get('/favicon.svg', (c) => proxyToPages(c));
app.get('/og-image.jpg', (c) => proxyToPages(c));
app.get('/sitemap-index.xml', (c) => proxyToPages(c));

// ── 2. Static / public HTML pages ───────────────────────────────────────────────
// Most pages are handled by the proxyToPages() catch-all at the bottom.
// Only routes with special logic (agent detection, path aliases) are listed here.

// Path aliases — URL slug changed, keep backwards compatibility
app.get('/blog/security', (c) => proxyToPages(c, '/security'));
app.get('/blog/platform-lockdown', (c) => proxyToPages(c, '/blog/anthropic-platform-lockdown'));

app.get('/vault', async (c) => {
  // Agent-first content negotiation: agents get the manifest, humans get the Astro page
  const detection = detectAgent(c.req.raw.headers);
  if (detection.isAgent && (detection.confidence === 'high' || detection.confidence === 'medium')) {
    return new Response(JSON.stringify(AGENTLAIR_MANIFEST, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/agent+json',
        'X-Agent-Optimized': 'true',
        'X-Detection-Confidence': detection.confidence,
        'X-Detection-Signals': detection.signals.join(','),
        'Cache-Control': 'no-store',
      },
    });
  }
  return proxyToPages(c, '/vault');
});
app.get('/getting-started', async (c) => {
  // Always serve the Astro HTML page — this is a developer onboarding page
  // and must be human-readable even when accessed via curl or automated tools.
  return proxyToPages(c, '/getting-started');
});
app.get('/explore', (_c) => {
  // Interactive trust explorer — served inline (no CF Pages dependency).
  // Zero-friction entry point for Show HN / onboarding. Calls /v1/demo client-side.
  return new Response(EXPLORE_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Powered-By': 'AgentLair',
    },
  });
});
// Known social media unfurlers and link-preview bots.
// These send Accept: */* (no text/html) but need HTML for OG previews.
const UNFURLER_UA_PATTERNS = [
  /Twitterbot/i,
  /facebookexternalhit/i,
  /Slackbot/i,
  /LinkedInBot/i,
  /Discordbot/i,
  /TelegramBot/i,
  /WhatsApp/i,
  /Pinterest/i,
  /Googlebot/i,
  /bingbot/i,
  /DuckDuckBot/i,
  /YandexBot/i,
  /applebot/i,
];

function isUnfurler(ua: string): boolean {
  return UNFURLER_UA_PATTERNS.some((p) => p.test(ua));
}

app.get('/', async (c) => {
  const acceptHeader = c.req.raw.headers.get('Accept') || '';
  const ua = c.req.raw.headers.get('User-Agent') || '';

  // Accept: text/html always wins
  if (acceptHeader.includes('text/html')) {
    return proxyToPages(c, '/');
  }

  // Social media unfurlers / link-preview crawlers — serve HTML so share previews work.
  // These bots send Accept: */* (no text/html) and won't match agent detection patterns.
  if (isUnfurler(ua)) {
    return proxyToPages(c, '/');
  }

  // Agent-first content negotiation: agents get the manifest
  const detection = detectAgent(c.req.raw.headers);
  if (detection.isAgent && (detection.confidence === 'high' || detection.confidence === 'medium')) {
    return new Response(JSON.stringify(AGENTLAIR_MANIFEST, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/agent+json',
        'X-Agent-Optimized': 'true',
        'X-Detection-Confidence': detection.confidence,
        'X-Detection-Signals': detection.signals.join(','),
        'Cache-Control': 'no-store',
      },
    });
  }

  // No Accept header or JSON-only: API discovery
  return json(API_DISCOVERY);
});

app.get('/api', (c) => {
  const acceptHtml = c.req.raw.headers.get('Accept')?.includes('text/html');
  if (acceptHtml) {
    return new Response(SCALAR_DOCS_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Powered-By': 'AgentLair' } });
  }
  return new Response(JSON.stringify(OPENAPI_SPEC), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
});

app.get('/health', () => json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.18.3' }));

// L4 Behavioral Trust Specification — public, no auth required
app.route('/spec', specRoutes);

// Trust badges — public SVG images for embedding in READMEs (no auth — img tags can't carry headers)
app.route('/badge', badgeRoutes);

// Per-A2A-card landing pages — public HTML/JSON trust reports
app.route('/a2a', a2aCardRoutes);

// OG card images for per-A2A-card pages
app.route('/og/a2a', ogA2aRoutes);

// Dynamic A2A sitemap — /sitemap-a2a.xml lives at root
app.route('/', sitemapA2aRoutes);

app.on(['GET', 'HEAD'], '/docs', () =>
  new Response(SCALAR_DOCS_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Powered-By': 'AgentLair' } })
);

app.get('/.well-known/agent.json', async (c) => {
  const card = await buildSignedAgentCard(c.env.AUDIT_SIGNING_KEY);

  return new Response(JSON.stringify(card, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
});

app.get('/llms.txt', () =>
  new Response(LLMS_TXT, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
);

app.get('/robots.txt', () =>
  new Response(ROBOTS_TXT, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
);

app.get('/.well-known/mcp/server.json', () =>
  new Response(JSON.stringify({
    name: 'AgentLair',
    description: 'Persistent identity for AI agents — email, vault, audit, calendar',
    version: '1',
    register: 'POST https://agentlair.dev/v1/register',
    endpoints: {
      register: 'POST /v1/register',
      send_email: 'POST /v1/email/send',
      read_email: 'GET /v1/email/inbox',
      store_secret: 'PUT /v1/vault/{key}',
      get_secret: 'GET /v1/vault/{key}',
      audit_log: 'GET /v1/audit',
    },
    docs: 'https://agentlair.dev/api',
    llms_txt: 'https://agentlair.dev/llms.txt',
  }, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  })
);

// ── RSL — Really Simple Licensing ────────────────────────────────────────────
// Declares training/inference license terms per https://rslstandard.org/
// Free with CC-BY-4.0 attribution; commercial training requires license.

app.get('/.well-known/rsl.xml', () =>
  new Response(RSL_XML, {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  })
);

// ── agents.json — Agent Discovery ────────────────────────────────────────────
// First-mover convention: AAT issuer DID, citation policy, x402 receiver,
// behavioral-trust thresholds, and contact for agent inquiries.

app.get('/.well-known/agents.json', () =>
  new Response(JSON.stringify(AGENTS_JSON, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  })
);

// ── Platform JWKS — AAT verification key(s) ──────────────────────────────────
// Exposes the Ed25519 public key used to sign Agent Auth Tokens (AATs).
// Enables offline JWT verification by VWM and any third-party service.
// URL advertised in GET /v1/tokens/info jwks_uri field.
//
// Multi-key note: verifiers MUST select by kid (JWT header → JWK kid field),
// NOT by array position. A future ML-DSA key will be added alongside EdDSA
// without a breaking change. See buildJWKS() in jwt.ts for full contract.

app.get('/.well-known/jwks.json', async (c) => {
  if (!c.env.AUDIT_SIGNING_KEY) {
    return new Response(JSON.stringify({ error: 'JWKS unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const jwks = await buildJWKS(c.env.AUDIT_SIGNING_KEY);
  return new Response(JSON.stringify(jwks), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// ── Platform DID Document — did:web:agentlair.dev ────────────────────────────
// Exposes the platform-level DID Document per the W3C DID Web spec.
// DID: did:web:agentlair.dev → resolves to /.well-known/did.json
// Verification key = Ed25519 public key from AUDIT_SIGNING_KEY (same as JWKS).
// Required for MCP-I Level 2 compliance — the `did` claim in AATs anchors here.
// Per-agent DID Documents are at /agents/:id/did.json (see routes/did.ts).

app.get('/.well-known/did.json', async (c) => {
  if (!c.env.AUDIT_SIGNING_KEY) {
    return new Response(JSON.stringify({ error: 'DID Document unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const publicKeyBytes = getPublicKey(c.env.AUDIT_SIGNING_KEY);
  const kid = await computeKeyId(publicKeyBytes);
  const jwk = await publicKeyToJWK(publicKeyBytes, kid);

  const did = 'did:web:agentlair.dev';
  const keyId = `${did}#${kid}`;

  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    id: did,
    verificationMethod: [
      {
        id: keyId,
        type: 'JsonWebKey2020',
        controller: did,
        publicKeyJwk: jwk,
      },
    ],
    authentication: [keyId],
    assertionMethod: [keyId],
    service: [
      {
        id: `${did}#jwks`,
        type: 'JsonWebKeySet2020',
        serviceEndpoint: 'https://agentlair.dev/.well-known/jwks.json',
      },
      {
        id: `${did}#openid-configuration`,
        type: 'OpenIDConnect',
        serviceEndpoint: 'https://agentlair.dev/.well-known/openid-configuration',
      },
    ],
  };

  return new Response(JSON.stringify(didDocument, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/did+json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// ── OpenID Connect Discovery ───────────────────────────────────────────────────
// Standard auto-discovery for JWT library integration.
// Low-priority Gap 2 from VWM E002 integration spec.

// ── OpenID Connect Discovery (enhanced — RFC-001 Phase 1) ─────────────────────
// Replaced minimal implementation with buildOIDCDiscovery() from IdP module.
// Includes MCP-I extensions, revocation endpoint, and AgentLair L4 trust fields.
app.get('/.well-known/openid-configuration', (_c) => {
  const config = buildOIDCDiscovery();
  return new Response(JSON.stringify(config, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// ── Bazaar x402 Catalog — CDP/agentic.market auto-indexing ───────────────────
// Lists all x402-gated public endpoints with payment requirements and schemas.
// CDP catalogs like agentic.market crawl this file to auto-index paid services.
// No auth required — discovery is intentionally public.

app.get('/.well-known/bazaar.json', (_c) => {
  // Public x402-gated endpoints — payment IS authentication, no registration required
  const services = [
    {
      name: 'Agent Trust Score',
      endpoint: '/v1/trust/{agentId}',
      method: 'GET',
      requirements: getPaymentRequirements(SERVICE_PRICES.trust_query),
      discovery: SERVICE_PRICES.trust_query.discovery,
    },
    {
      name: 'Agent Discovery Lookup',
      endpoint: '/v1/agents/lookup',
      method: 'GET',
      requirements: getPaymentRequirements(SERVICE_PRICES.agent_lookup),
      discovery: SERVICE_PRICES.agent_lookup.discovery,
    },
    {
      name: 'Token Audit Lookup',
      endpoint: '/v1/audit/{jti}',
      method: 'GET',
      requirements: getPaymentRequirements(SERVICE_PRICES.audit_lookup),
      discovery: SERVICE_PRICES.audit_lookup.discovery,
    },
    {
      name: 'Token Verification',
      endpoint: '/v1/auth/verify',
      method: 'POST',
      requirements: getPaymentRequirements(SERVICE_PRICES.token_verify),
      discovery: SERVICE_PRICES.token_verify.discovery,
    },
  ];

  return new Response(JSON.stringify({
    x402Version: X402_CONFIG.x402Version,
    name: 'AgentLair',
    description: 'Persistent identity, trust scoring, and behavioral audit for AI agents. Payment IS authentication — no registration required.',
    url: 'https://agentlair.dev',
    network: X402_CONFIG.network,
    asset: X402_CONFIG.asset,
    payTo: X402_CONFIG.payTo,
    docs: 'https://agentlair.dev/api',
    services,
  }, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// ── RFC 9421 public key directory ────────────────────────────────────────────
// Unauthenticated — any verifier can look up an agent's signing key by keyid.
// Keys are immutable once registered (rotation creates a new keyid).
// Cache aggressively; check status field for revocation.

app.get('/.well-known/agent-keys/:keyid', async (c) => {
  const keyid = c.req.param('keyid');
  // Validate keyid format: base64url chars only, length 1-22
  if (!keyid || !/^[A-Za-z0-9_-]{1,22}$/.test(keyid)) {
    return err('Invalid keyid format', 400, 'invalid_keyid');
  }
  const record = await getSigningKey(c.env, keyid);
  if (!record) {
    return err('Signing key not found', 404, 'not_found');
  }
  return new Response(JSON.stringify({
    keyid: record.keyid,
    algorithm: record.algorithm,
    public_key: record.public_key,
    agent_id: record.agent_id,
    ...(record.agent_name !== undefined && { agent_name: record.agent_name }),
    ...(record.agent_email !== undefined && { agent_email: record.agent_email }),
    registered_at: record.registered_at,
    status: record.status,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Immutable key content but status may change on revocation → short cache
      'Cache-Control': 'public, max-age=300',
    },
  });
});

app.get('/.well-known/agent-keys/:keyid/jwks.json', async (c) => {
  const keyid = c.req.param('keyid');
  if (!keyid || !/^[A-Za-z0-9_-]{1,22}$/.test(keyid)) {
    return err('Invalid keyid format', 400, 'invalid_keyid');
  }
  const record = await getSigningKey(c.env, keyid);
  if (!record) {
    return err('Signing key not found', 404, 'not_found');
  }
  return new Response(JSON.stringify({
    keys: [{
      kty: 'OKP',
      crv: 'Ed25519',
      x: record.public_key,
      kid: record.keyid,
      use: 'sig',
      alg: 'EdDSA',
    }],
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
});

// ── Verifiable Intent integration: agent public key endpoints ─────────────────
// These enable VI credential providers to bind AgentLair agents to consumer
// authorization chains via cnf.jwk. Two access patterns:
//
//   1. GET /v1/agents/:id/public-key
//      Lookup by account ID (acc_xxx) — used by VI when agent_id is known.
//      Returns single JWK for the agent's active signing key.
//
//   2. GET /agents/:name/.well-known/jwks.json
//      DID Web resolution: did:web:agentlair.dev:agents:{name}
//      Resolves to https://agentlair.dev/agents/{name}/.well-known/jwks.json
//      VI credential providers use this to fetch the JWK Set via DID.

app.get('/v1/agents/:id/public-key', async (c) => {
  const agentId = c.req.param('id');
  // Validate account ID format: acc_ prefix + alphanumeric
  if (!agentId || !/^acc_[A-Za-z0-9_-]{1,32}$/.test(agentId)) {
    return err('Invalid agent ID format. Expected acc_{id}.', 400, 'invalid_agent_id');
  }

  // Look up the agent's active signing key by account ID
  const indexRaw = await c.env.KEYS.get('signing-key-by-account:' + agentId);
  if (!indexRaw) {
    return err('No signing key registered for this agent.', 404, 'no_signing_key');
  }

  const { keyid } = JSON.parse(indexRaw) as { keyid: string };
  const record = await getSigningKey(c.env, keyid);
  if (!record) {
    return err('Signing key record not found.', 404, 'signing_key_not_found');
  }

  // Return JWK for the active signing key (RFC 7517 + RFC 8037 for OKP/Ed25519)
  return new Response(JSON.stringify({
    kty: 'OKP',
    crv: 'Ed25519',
    x: record.public_key,
    kid: record.keyid,
    use: 'sig',
    alg: 'EdDSA',
    // VI-specific: agent identity context
    agent_id: record.agent_id,
    ...(record.agent_name !== undefined && { agent_name: record.agent_name }),
    status: record.status,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
});

// DID Web JWKS endpoint for Verifiable Intent cnf.jwk binding.
// did:web:agentlair.dev:agents:{name} resolves to this URL per DID Web spec.
// Accepts both agent name format (lowercase alphanumeric + hyphens) and
// acc_ ID format (acc_ prefix + alphanumeric/dash/underscore) so that DID
// Documents pointing to /agents/acc_xxx/.well-known/jwks.json resolve correctly.
app.get('/agents/:name/.well-known/jwks.json', async (c) => {
  const name = c.req.param('name');

  // Accept acc_ IDs (e.g. acc_picoclaw) OR agent names (e.g. picoclaw)
  const isAccId = /^acc_[A-Za-z0-9_-]{1,32}$/.test(name ?? '');
  const isAgentName = /^[a-z0-9][a-z0-9-]{0,29}$/.test(name ?? '');

  if (!name || (!isAccId && !isAgentName)) {
    return err('Invalid agent identifier format.', 400, 'invalid_agent_name');
  }

  let resolvedAccountId: string | null;

  if (isAccId) {
    // acc_ ID: use directly — no email resolution needed
    resolvedAccountId = name;
  } else {
    // Agent name: resolve name → accountId via canonical email address
    const emailAddress = `${name}@agentlair.dev`;
    resolvedAccountId = await c.env.EMAILS.get('email-owner:' + emailAddress);
    if (!resolvedAccountId) {
      return err('Agent not found.', 404, 'agent_not_found');
    }
  }

  // Look up active signing key
  const indexRaw = await c.env.KEYS.get('signing-key-by-account:' + resolvedAccountId);
  if (!indexRaw) {
    return err('No signing key registered for this agent.', 404, 'no_signing_key');
  }

  const { keyid } = JSON.parse(indexRaw) as { keyid: string };
  const record = await getSigningKey(c.env, keyid);
  if (!record) {
    return err('Signing key record not found.', 404, 'signing_key_not_found');
  }

  // Return JWKS (RFC 7517 JWK Set) — only active keys exposed
  return new Response(JSON.stringify({
    keys: [{
      kty: 'OKP',
      crv: 'Ed25519',
      x: record.public_key,
      kid: record.keyid,
      use: 'sig',
      alg: 'EdDSA',
    }],
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Short cache: key status may change on revocation
      'Cache-Control': 'public, max-age=300',
    },
  });
});

// ─── Agent lookup helper — shared by /agents/:name and /@:name ──────────────
// Returns agent identity data from KV. No payment required — used for free HTML profile
// and as the inner logic for the x402-gated JSON endpoint.
async function lookupAgentByHandle(env: Env, name: string): Promise<{
  id: string; name: string; email: string; did: string; jwks_url?: string;
  registered_at?: string; verified: boolean;
} | null> {
  const emailAddress = `${name}@agentlair.dev`;
  const accountId = await env.EMAILS.get('email-owner:' + emailAddress);
  if (!accountId) return null;

  const keyHash = await env.KEYS.get('account:' + accountId);
  if (!keyHash) return null;
  const raw = await env.KEYS.get('key:' + keyHash);
  if (!raw) return null;
  const account = JSON.parse(raw) as Record<string, unknown>;

  let jwksUrl: string | undefined;
  let verified = false;
  try {
    const keyIndex = await env.KEYS.get('signing-key-by-account:' + accountId);
    if (keyIndex) {
      const { keyid } = JSON.parse(keyIndex) as { keyid: string };
      const keyRecord = await env.KEYS.get('signing-key:' + keyid);
      if (keyRecord) {
        const parsed = JSON.parse(keyRecord) as { status?: string };
        if (parsed.status === 'active') {
          jwksUrl = `https://agentlair.dev/agents/${accountId}/.well-known/jwks.json`;
          verified = true;
        }
      }
    }
  } catch { /* best-effort */ }

  const did = `did:web:agentlair.dev:agents:${accountId}`;
  return {
    id: accountId,
    name: (account.name as string) || name,
    email: emailAddress,
    did,
    ...(jwksUrl ? { jwks_url: jwksUrl } : {}),
    registered_at: (account.created_at || account.registered_at) as string | undefined,
    verified,
  };
}

// GET /@<name> — Twitter-style handle URL for agent profiles (browser-friendly, free).
// Serves the same HTML profile page as /agents/:name with Accept: text/html.
// NOTE: Hono does not support @ as a literal prefix in parameterized routes (/@:name fails to
// match). Using /:handle instead, then checking for the @ prefix and calling next() for non-@
// paths so other routes still work correctly.
app.get('/:handle', async (c, next) => {
  const handle = c.req.param('handle');
  if (!handle.startsWith('@')) return next();
  const name = handle.slice(1);
  const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;
  if (!name || !HANDLE_RE.test(name)) {
    return c.redirect('/agents', 302);
  }
  const agent = await lookupAgentByHandle(c.env, name);
  if (!agent) {
    return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found — AgentLair</title></head><body style="font-family:monospace;background:#0a0a0f;color:#64748b;padding:2rem"><p>Agent <strong style="color:#e2e8f0">@${escapeHtml(name)}</strong> not found.</p><p><a href="/explore" style="color:#22c55e">Browse agents →</a></p></body></html>`, {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Fetch trust score (best-effort — no x402 required for profile page)
  let trustScore: number | undefined;
  let trustLevel: string | undefined;
  try {
    if (c.env.AUDIT) {
      const profile = await computeTrustScore(c.env.AUDIT, agent.id, 'free');
      if (profile.observationCount > 0) {
        trustScore = profile.score;
        trustLevel = profile.atfLevel.charAt(0).toUpperCase() + profile.atfLevel.slice(1);
      }
    }
  } catch { /* best-effort */ }

  let profileExtras: ProfileExtras = { bccCount: null, popaStreakDays: null, popaLastAttestedAt: null, auditCount30d: null, signingKeyThumbprint: null };
  try {
    profileExtras = await fetchProfileExtras(c.env, agent);
  } catch { /* best-effort */ }
  const html = renderAgentProfileHTML({ ...agent, trustScore, trustLevel }, profileExtras);
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
});

// Redirect /agent/:name (singular) to /agents/:name (plural) — common user mistake.
app.get('/agent/:name', (c) => {
  const name = c.req.param('name');
  return Response.redirect(`https://agentlair.dev/agents/${name}`, 301);
});

// Web Bot Auth: Agent key directory by JWK thumbprint (RFC 8037).
// GET /agents/:thumbprint — returns the public JWK for Signature-Agent header resolution.
// Param routing logic:
//   - 43-char base64url (uppercase + underscore allowed) → thumbprint lookup (this handler)
//   - Valid agent handle (lowercase a-z0-9 + hyphens only) → fall through to /agents/:name
//   - Neither (e.g. uppercase/underscore but wrong length, or invalid chars for both) → 400
app.get('/agents/:thumbprint', async (c, next) => {
  const thumbprint = c.req.param('thumbprint');
  const THUMBPRINT_RE = /^[A-Za-z0-9_-]{43}$/;
  const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;
  // RFC 8037 thumbprint = base64url(SHA-256(canonical JWK)) = always exactly 43 chars
  if (!thumbprint || !THUMBPRINT_RE.test(thumbprint)) {
    if (HANDLE_RE.test(thumbprint || '')) {
      return next(); // Valid agent handle — fall through to /agents/:name
    }
    return c.json({ error: 'invalid_thumbprint', message: 'Thumbprint must be a 43-character base64url RFC 8037 SHA-256 hash. The kid field from JWKS is not the thumbprint.' }, 400);
  }
  const record = await getSigningKeyByThumbprint(c.env, thumbprint);
  if (!record) {
    return next(); // Not a registered thumbprint — fall through to /agents/:name
  }
  return new Response(JSON.stringify({
    kty: 'OKP',
    crv: 'Ed25519',
    x: record.public_key,
    kid: thumbprint,
    use: 'sig',
    alg: 'EdDSA',
    agent_id: record.agent_id,
    ...(record.agent_name !== undefined && { agent_name: record.agent_name }),
    status: record.status,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// Agent identity discovery — x402-gated, no API key required.
// GET /agents/:name — look up agent identity by handle, pay 0.005 USDC.
// Browser requests (Accept: text/html) get a free HTML profile page instead.
// Payment IS the authentication for anonymous API (JSON) lookups.
// Registered AFTER /agents/:name/.well-known/jwks.json (more specific path wins).
// /agents/:name/did.json (via didRoutes below) also remains free — different path depth.
app.get('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;
  if (!name || !HANDLE_RE.test(name)) {
    return err('Invalid agent name. Use lowercase letters, numbers, hyphens only.', 400, 'invalid_name');
  }

  // Content negotiation: browsers get a free HTML profile page (no x402 required).
  const acceptHeader = c.req.raw.headers.get('Accept') || '';
  if (acceptHeader.includes('text/html')) {
    const agent = await lookupAgentByHandle(c.env, name);
    if (!agent) {
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found — AgentLair</title></head><body style="font-family:monospace;background:#0a0a0f;color:#64748b;padding:2rem"><p>Agent <strong style="color:#e2e8f0">${escapeHtml(name)}</strong> not found on AgentLair.</p><p><a href="/explore" style="color:#22c55e">Browse agents →</a></p></body></html>`, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Fetch trust score (best-effort — no x402 required for profile page)
    let trustScore: number | undefined;
    let trustLevel: string | undefined;
    try {
      if (c.env.AUDIT) {
        const profile = await computeTrustScore(c.env.AUDIT, agent.id, 'free');
        if (profile.observationCount > 0) {
          trustScore = profile.score;
          trustLevel = profile.atfLevel.charAt(0).toUpperCase() + profile.atfLevel.slice(1);
        }
      }
    } catch { /* best-effort */ }

    let profileExtras: ProfileExtras = { bccCount: null, popaStreakDays: null, popaLastAttestedAt: null, auditCount30d: null, signingKeyThumbprint: null };
    try {
      profileExtras = await fetchProfileExtras(c.env, agent);
    } catch { /* best-effort */ }
    const html = renderAgentProfileHTML({ ...agent, trustScore, trustLevel }, profileExtras);
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    });
  }

  // API path: require x402 payment for JSON response
  const xPayment = c.req.header('X-PAYMENT');
  if (!xPayment) {
    return make402Response(SERVICE_PRICES.agent_lookup);
  }

  const verification = await verifyX402Payment(xPayment, SERVICE_PRICES.agent_lookup);
  if (!verification.valid) {
    return make402Response(SERVICE_PRICES.agent_lookup, { payment_error: verification.error });
  }

  const settlement = await settleX402Payment(xPayment, SERVICE_PRICES.agent_lookup, verification.facilitatorUrl);
  if (!settlement.settled) {
    return make402Response(SERVICE_PRICES.agent_lookup, { payment_error: settlement.error });
  }

  if (settlement.receipt) c.header('X-Payment-Response', settlement.receipt);

  c.executionCtx.waitUntil(
    trackX402Spend(c.env, 'anonymous', SERVICE_PRICES.agent_lookup.amount, {
      payer: verification.payer,
      service: 'agent_lookup',
    }).catch(() => {})
  );

  // Resolve agent by name via email address index
  const agent = await lookupAgentByHandle(c.env, name);
  if (!agent) {
    return err('Agent not found.', 404, 'agent_not_found');
  }

  return json({
    id: agent.id,
    name: agent.name,
    email: agent.email,
    did: agent.did,
    ...(agent.jwks_url ? { jwks_url: agent.jwks_url } : {}),
    registered_at: agent.registered_at,
    verified: agent.verified,
  });
});

// DID Web document endpoint: did:web:agentlair.dev:agents:acc_xxx → /agents/acc_xxx/did.json
// Per W3C DID Web spec (https://w3c-ccg.github.io/did-method-web/)
// Public endpoint — no auth required. Enables MCP-I Level 2 DID resolution.
app.route('/agents', didRoutes);

// ── IdP routes — public (no auth required) ───────────────────────────────────
// Mounted before auth middleware per RFC-001: IdP status and discovery are public.
app.route('/v1/idp', idpRoutes);

// ── 3. Public API routes (no auth required) ──────────────────────────────────

// Auth: login, verify, key creation, agent-register
app.use('/v1/auth/login', publicHandler(handleAuthRoutes));
app.use('/v1/auth/verify', publicHandler(handleAuthRoutes));
app.use('/v1/auth/keys', publicHandler(handleAuthRoutes));
app.use('/v1/keys', publicHandler(handleAuthRoutes));
app.use('/v1/auth/agent-register', publicHandler(handleAuthRoutes));

// Agent self-provisioning: canonical registration endpoint
app.post('/v1/register', publicHandler(handleRegisterRoute));

// Vault: store, recover, recover/verify
app.use('/v1/vault/store', publicHandler(handleVaultRoutes));
app.use('/v1/vault/recover', publicHandler(handleVaultRoutes));
app.use('/v1/vault/recover/verify', publicHandler(handleVaultRoutes));

// Calendar: public iCal feed
app.use('/v1/calendar/feed.ics', publicHandler(handleCalendarRoutes));

// Trust scoring: public routes — optional auth + x402 for anonymous callers (0.01 USDC/query)
// Mounted before auth middleware so anonymous agents can access GET /v1/trust/:agentId
// Handlers call authenticateAny internally: authenticated callers pay nothing.
app.route('/v1/trust', publicTrustRoutes);

// Agent discovery: always public, always requires x402 (0.005 USDC)
// GET /v1/agents/lookup?handle=<name>&email=<email>&id=<acc_...>
app.route('/v1/agents', discoveryRoutes);

// Memory trust: always public, always requires x402 (0.01 USDC)
// GET /v1/agents/:id/memory-trust — verified memory behavioral patterns
app.route('/v1/agents', memoryTrustRoutes);

// Demo endpoint: public trust profile explorer (no auth, IP rate limited)
app.route('/v1/demo', demoRoutes);

// Public PoPA endpoint: GET /v1/popa/:did — Proof-of-Presence streak metrics.
// No auth required: external verifiers read attestation chains by DID.
// Mounted BEFORE auth middleware so the /:did handler runs unauthenticated.
app.route('/v1/popa', popaRoutes);

// Agent self-service PoPA: POST /v1/popa/self-attest — AAT-gated (not account key).
// Mounted BEFORE the global auth middleware so the handler does its own JWT
// verification (global middleware only handles al_* API keys, not AAT JWTs).
app.route('/v1/popa', popaAgentRoutes);

// Public SCITT corpus: GET /v1/scitt/corpus, /v1/scitt/corpus/stats, /v1/scitt/corpus.atom
// No auth required: public verifiable feed of all issued receipts.
// Mounted BEFORE auth middleware and the authenticated scittRoutes.
app.route('/v1/scitt', publicScittRoutes);

// Public BCC retrieval: GET /v1/bcc/:id — Bonded Credibility Credential lookup.
// No auth required: external verifiers fetch a signed BCC by credential id.
// Mounted BEFORE auth middleware so the /:id handler runs unauthenticated.
// POST /v1/bcc/issue is registered separately on bccRoutes after auth (below).
app.route('/v1/bcc', bccPublicRoutes);

// Public Web Bot Auth verifier: POST /v1/wba/verify — RFC 9421 verification + L4 enrichment.
// No auth required: anonymous public endpoint, x402-payable above free tier.
// Mounted BEFORE auth middleware so anonymous callers are not rejected.
app.route('/v1/wba', wbaRoutes);

// Public substrate stats: GET /v1/stats/agents
// No auth required: aggregate counts and 24h/7d deltas for the live trust dashboard.
// Mounted BEFORE auth middleware so anonymous browsers can poll it.
app.route('/v1/stats', publicStatsRoutes);

// Public SPA verifier: POST /v1/verify-skill
// No auth required: anyone can verify a Skill Provenance Attestation JWT.
// Mounted BEFORE auth middleware so anonymous callers can verify skills.
app.route('/v1', skillProvenanceRoutes);

// ── Waitlist: lead capture for paid tiers (no auth required) ────────────────
// Captures email + company before Stripe checkout is live.
// Stores in AUDIT D1 (waitlist table). Sends confirmation via Resend.
app.post('/v1/waitlist', async (c) => {
  let body: { email?: string; company?: string; tier?: string };
  try {
    body = await c.req.json() as { email?: string; company?: string; tier?: string };
  } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }

  const { email, company, tier } = body;

  // Validate email
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return err('Valid email is required.', 400, 'invalid_email');
  }

  // Validate tier
  const validTiers = ['starter', 'pro', 'enterprise'];
  const normalizedTier = (tier || '').toLowerCase().trim();
  if (!validTiers.includes(normalizedTier)) {
    return err('Tier must be starter, pro, or enterprise.', 400, 'invalid_tier');
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanCompany = (company || '').trim().slice(0, 100);

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');
  const safeCompany = cleanCompany ? escapeHtml(cleanCompany) : '';

  // Insert into D1 waitlist table (deduplicated per email+tier)
  if (c.env.AUDIT) {
    try {
      const id = nanoid(21);
      await c.env.AUDIT.prepare(
        'INSERT INTO waitlist (id, email, company, tier) VALUES (?, ?, ?, ?) ON CONFLICT(email, tier) DO NOTHING'
      ).bind(id, cleanEmail, cleanCompany || null, normalizedTier).run();
    } catch (dbErr) {
      // Log but don't fail — email still goes out
      console.error('Waitlist D1 insert error:', dbErr);
    }
  }

  // Send confirmation email via Resend
  const { getEmailProvider } = await import('./email-provider.js');
  const provider = getEmailProvider(c.env);
  if (provider) {
    const tierDisplay = normalizedTier.charAt(0).toUpperCase() + normalizedTier.slice(1);
    const priceMap: Record<string, string> = { starter: '$29/mo', pro: '$149/mo', enterprise: 'custom pricing' };
    try {
      await provider.send({
        from: 'AgentLair <noreply@agentlair.dev>',
        to: [cleanEmail],
        subject: `You're on the AgentLair ${tierDisplay} waitlist`,
        text: [
          `Hi${cleanCompany ? ` from ${cleanCompany}` : ''},`,
          ``,
          `Thanks for your interest in AgentLair ${tierDisplay} (${priceMap[normalizedTier] || normalizedTier}).`,
          ``,
          `You're on the waitlist. We'll reach out as soon as checkout is ready — you'll be first in line.`,
          ``,
          `In the meantime, you can start with the free tier at agentlair.dev/register — it includes agent identity, AAT issuance, and 1,000 verifications/month.`,
          ``,
          `— Håkon, AgentLair`,
        ].join('\n'),
        html: `<p>Hi${safeCompany ? ` from <strong>${safeCompany}</strong>` : ''},</p>
<p>Thanks for your interest in <strong>AgentLair ${tierDisplay}</strong> (${priceMap[normalizedTier] || normalizedTier}).</p>
<p>You're on the waitlist. We'll reach out as soon as checkout is ready — you'll be first in line.</p>
<p>In the meantime, you can <a href="https://agentlair.dev/register">start with the free tier</a> — it includes agent identity, AAT issuance, and 1,000 verifications/month.</p>
<p>— Håkon, AgentLair</p>`,
      }, c.env);
    } catch (emailErr) {
      console.error('Waitlist confirmation email error:', emailErr);
    }
  }

  return json({ ok: true, message: `You're on the ${normalizedTier} waitlist. Check your email for confirmation.` });
});

// ── Stripe Webhook: POST /v1/stripe/webhook — process Stripe events ──────────
// No auth — Stripe signature verification (STRIPE_WEBHOOK_SECRET required).
// Handles: checkout.session.completed → tier upgrade.
// Registered BEFORE auth middleware so Stripe can call it without an API key.
app.post('/v1/stripe/webhook', async (c) => {
  return handleStripeWebhook(c.req.raw, c.env);
});

// Admin routes: own auth via ADMIN_KEY (not user API keys)
app.post('/v1/admin/tier', async (c) => {
  const response = await handleAdminRoutes(c.req.raw, c.env);
  if (response) return response;
  return err('Not found.', 404, 'not_found');
});
app.get('/v1/admin/account/:id', async (c) => {
  const response = await handleAdminRoutes(c.req.raw, c.env);
  if (response) return response;
  return err('Not found.', 404, 'not_found');
});
app.get('/v1/admin/revenue', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const adminKey = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!c.env.ADMIN_KEY || !adminKey || adminKey !== c.env.ADMIN_KEY) {
    return err('Unauthorized. Admin key required.', 403, 'admin_unauthorized');
  }
  const revenue = await getGlobalRevenue(c.env);
  const totalUsdc = (revenue.total / 1_000_000).toFixed(6);
  const uniquePayers = Object.keys(revenue.by_payer).length;
  const uniqueAccounts = Object.keys(revenue.by_account).length;
  // Format by_service with human-readable USDC amounts
  const serviceBreakdown: Record<string, { total_usdc: string; payments: number }> = {};
  for (const [svc, data] of Object.entries(revenue.by_service)) {
    serviceBreakdown[svc] = { total_usdc: (data.total / 1_000_000).toFixed(6), payments: data.payments };
  }
  const payerBreakdown: Record<string, { total_usdc: string; payments: number; first_at: string; last_at: string }> = {};
  for (const [addr, data] of Object.entries(revenue.by_payer)) {
    payerBreakdown[addr] = { total_usdc: (data.total / 1_000_000).toFixed(6), payments: data.payments, first_at: data.first_at, last_at: data.last_at };
  }
  return json({
    total_usdc: totalUsdc,
    total_atomic: revenue.total,
    total_payments: revenue.payments,
    unique_payers: uniquePayers,
    unique_accounts: uniqueAccounts,
    first_payment_at: revenue.first_at,
    last_payment_at: revenue.last_at,
    by_service: serviceBreakdown,
    by_payer: payerBreakdown,
    by_account: revenue.by_account,
  });
});

app.get('/v1/admin/billing-anomalies', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const adminKey = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!c.env.ADMIN_KEY || !adminKey || adminKey !== c.env.ADMIN_KEY) {
    return err('Unauthorized. Admin key required.', 403, 'admin_unauthorized');
  }
  if (!c.env.AUDIT) {
    return err('Database not configured.', 503, 'db_unavailable');
  }
  const url = new URL(c.req.url);
  const accountId = url.searchParams.get('account_id') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const anomalies = await getBillingAnomalies(c.env.AUDIT, { limit, accountId });
  return json({
    count: anomalies.length,
    anomalies: anomalies.map(a => ({
      ...a,
      amount_usdc_human: (a.amount_usdc / 1_000_000).toFixed(6),
      rolling_avg_usdc_human: (a.rolling_avg_usdc / 1_000_000).toFixed(6),
    })),
  });
});

// ── 4. WebSocket: real-time inbox notifications ─────────────────────────────────
// WebSocket handshake cannot carry Authorization headers — token in ?token= param.

app.get('/v1/ws', async (c) => {
  const url = new URL(c.req.url);
  const token = url.searchParams.get('token') || '';
  if (!token.startsWith('al_')) {
    return err('Authentication required. Pass API key as: ?token=al_live_...', 401, 'unauthorized');
  }
  const hash = await sha256hex(token);
  const accountJson = await c.env.KEYS.get('key:' + hash);
  if (!accountJson) {
    return err('Invalid or expired token.', 401, 'unauthorized');
  }
  const wsAccount = JSON.parse(accountJson) as Account;
  const notifierId = c.env.INBOX_NOTIFIER.idFromName(wsAccount.id);
  const notifier = c.env.INBOX_NOTIFIER.get(notifierId);
  return notifier.fetch(c.req.raw);
});

// ── 5. Auth + Rate Limit middleware (for all /v1/* protected routes) ─────────

app.use('/v1/*', async (c: Context<HonoEnv>, next: Next): Promise<void | Response> => {
  // Skip auth for public token endpoints (RFC 7662 introspect — no API key required)
  if (c.req.path === '/v1/tokens/introspect') {
    await next();
    return;
  }

  // Credential approval page — public (validated via operator_email binding)
  if (c.req.path === '/v1/credentials/approve') {
    await next();
    return;
  }

  // Public audit JTI endpoint — external verifiers check AAT metadata without needing an account.
  // Only bypass for JTI format (aat_[A-Za-z0-9]{16}); literal paths like /log fall through to auditRoutes.
  if (c.req.method === 'GET' && /^\/v1\/audit\/aat_[A-Za-z0-9]{16}$/.test(c.req.path)) {
    await next();
    return;
  }

  // Anonymous event submission — events.ts handler requires x402 payment for anonymous callers.
  // Authenticated callers: auth runs normally and account is set.
  // Anonymous callers: account stays null, events.ts checks X-PAYMENT header.
  if (c.req.path === '/v1/events' && c.req.method === 'POST') {
    const account = await authenticateAny(c.req.raw, c.env);
    if (account) {
      c.set('account', account);
    }
    // Whether authenticated or not, proceed — events.ts handles both cases
    await next();
    return;
  }

  // Authenticate: API key (al_live_...) or session token (session_...)
  const account = await authenticateAny(c.req.raw, c.env);
  if (!account) {
    return err('Authentication required. Pass API key as: Authorization: Bearer al_live_...', 401, 'unauthorized');
  }
  c.set('account', account);

  // Lazy tier downgrade: if paid tier has expired, silently revert to free.
  // Persisted asynchronously (non-blocking, fail-open) so the current request
  // sees the correct tier without adding latency.
  if (account.tier === 'paid' && account.tier_expires_at) {
    const expiresAt = new Date(account.tier_expires_at as string);
    if (expiresAt < new Date()) {
      account.tier = 'free';
      const expiredAt = account.tier_expires_at;
      delete account.tier_upgraded_at;
      delete account.tier_expires_at;
      // Persist downgrade asynchronously
      c.executionCtx.waitUntil((async () => {
        try {
          const kh = await c.env.KEYS.get('account:' + account.id);
          if (kh) {
            const raw = await c.env.KEYS.get('key:' + kh);
            if (raw) {
              const acct = JSON.parse(raw);
              acct.tier = 'free';
              delete acct.tier_upgraded_at;
              delete acct.tier_expires_at;
              acct.tier_downgraded_at = new Date().toISOString();
              acct.tier_downgrade_reason = 'expired';
              acct.tier_previous_expiry = expiredAt;
              await c.env.KEYS.put('key:' + kh, JSON.stringify(acct));
            }
          }
        } catch { /* fail-open */ }
      })());
    }
  }

  // Checkout is never rate-limited — a user trying to pay should never be blocked.
  if (c.req.path === '/v1/checkout' && c.req.method === 'POST') {
    await next();
    return;
  }

  // Rate limit: unified account-level daily check
  const allowed = await checkRateLimit(c.env, account.id, account.tier || 'free');
  if (!allowed) {
    const xPayment = c.req.header('X-PAYMENT');
    if (xPayment) {
      // Routes that verify+settle x402 in their own handler — pass through
      if (hasOwnX402Handler(c.req.method, c.req.path)) {
        await next();
        return;
      }

      // All other routes: middleware verifies and settles the payment
      const service = getServiceForPath(c.req.path, c.req.method);
      const verification = await verifyX402Payment(xPayment, service);
      if (!verification.valid) {
        return make402Response(service, {
          rate_limit: {
            reason: 'payment_verification_failed',
            error: verification.error,
            hint: 'X-PAYMENT header is invalid or expired. See https://agentlair.dev/docs#x402',
          },
        });
      }

      // Check spending caps if this is a pod account
      if (account.type === 'pod' && account.pod_id) {
        try {
          const podRaw = await c.env.KEYS.get('pod:' + account.pod_id);
          if (podRaw) {
            const pod = JSON.parse(podRaw);
            if (pod.spending_caps) {
              const capCheck = await checkSpendingCap(c.env, account.id, service.amount, pod.spending_caps);
              if (!capCheck.allowed) {
                const periodLabel = capCheck.exceeded || 'period';
                const capUsdc = ((capCheck.cap || 0) / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0';
                const currentUsdc = ((capCheck.current || 0) / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0';
                return new Response(JSON.stringify({
                  error: `Spending cap exceeded: ${periodLabel} limit of ${capUsdc} USDC reached (current: ${currentUsdc} USDC). Payment blocked by pod spending cap.`,
                  code: 'spending_cap_exceeded',
                  cap: { period: periodLabel, limit_usdc: capUsdc, current_usdc: currentUsdc },
                }), {
                  status: 402,
                  headers: { 'Content-Type': 'application/json' },
                });
              }
            }
          }
        } catch { /* fail-open: don't block payment for cap check error */ }
      }

      // Settle the payment before serving the request
      const settlement = await settleX402Payment(xPayment, service, verification.facilitatorUrl);
      if (!settlement.settled) {
        return make402Response(service, {
          rate_limit: {
            reason: 'payment_settlement_failed',
            error: settlement.error,
          },
        });
      }

      // Track spend and auto-upgrade (fire-and-forget)
      if (account.id) {
        const payerAddr = verification.payer;
        const serviceName = Object.entries(SERVICE_PRICES).find(([, v]) => v === service)?.[0] || 'general_api';
        c.executionCtx.waitUntil((async () => {
          try {
            const spend = await trackX402Spend(c.env, account.id, service.amount, { payer: payerAddr, service: serviceName });
            await autoUpgradeIfThreshold(c.env, account, spend);
          } catch { /* non-critical */ }
        })());
      }

      // Add settlement receipt to response
      if (settlement.receipt) {
        c.header('X-Payment-Response', settlement.receipt);
      }

      await next();
      return;
    }
    // No payment → return 402 with x402 payment requirements.
    return make402Response(getServiceForPath(c.req.path, c.req.method), {
      rate_limit: {
        reason: 'daily_limit_exceeded',
        tier: account.tier || 'free',
        hint: 'Include X-PAYMENT header with signed USDC authorization to continue. See https://agentlair.dev/docs#x402',
      },
    });
  }

  // Pod suspension guard + pod-specific rate limiting
  if (account.type === 'pod' && account.pod_id) {
    try {
      const podRaw = await c.env.KEYS.get('pod:' + account.pod_id);
      if (podRaw) {
        const pod = JSON.parse(podRaw);
        if (pod.status === 'suspended') {
          return err('This pod has been suspended. Contact your platform operator to restore access.', 403, 'pod_suspended');
        }
        // Enforce pod-specific rate limits if configured
        if (pod.rate_limits) {
          const podRl = await checkPodRateLimit(c.env, account.pod_id, pod.rate_limits);
          if (!podRl.allowed) {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (podRl.retry_after) headers['Retry-After'] = podRl.retry_after;
            if (podRl.rl_limit != null) headers['X-RateLimit-Limit'] = String(podRl.rl_limit);
            if (podRl.rl_remaining != null) headers['X-RateLimit-Remaining'] = String(podRl.rl_remaining);
            if (podRl.rl_reset != null) headers['X-RateLimit-Reset'] = String(podRl.rl_reset);
            return new Response(JSON.stringify({
              error: 'rate_limited',
              message: `Pod rate limit exceeded (${podRl.window} window). Limit: ${podRl.limit}.`,
            }), { status: 429, headers });
          }
        }
      }
    } catch { /* fail open — don't block on KV read error */ }
  }

  await next();
});

// ── 5.5. Audit middleware — runs after auth, captures all /v1/* actions ─────────
// Intercepts all authenticated API calls and writes a cryptographically signed
// audit log entry to D1. Non-blocking (waitUntil). Gracefully skips if bindings absent.

app.use('/v1/*', auditMiddleware());

// ── 6.5. Budget Middleware ───────────────────────────────────────────────────────
// Checks per-agent D1 spending caps before processing paid operations.
// Runs after auth+rate-limit, before route handlers. Fail-open on D1 errors.
app.use('/v1/*', budgetMiddleware());

// ── 6. Protected API routes (auth required) ─────────────────────────────────────

// Stripe Checkout: POST /v1/checkout — create Stripe checkout session (auth required)
// Body: { tier: "starter" | "pro" } → returns { url } for client-side redirect to Stripe.
// Returns 503 { stripe_available: false } when STRIPE_SECRET_KEY not configured (graceful fallback).
app.post('/v1/checkout', async (c) => {
  const account = c.get('account');
  if (!account) {
    return err('Authentication required.', 401, 'unauthorized');
  }
  return handleCheckout(c.req.raw, c.env, account);
});

// Register verify: OTP verification to unlock restricted accounts (requires auth)
app.post('/v1/register/verify', legacyHandler(handleRegisterVerifyRoute));

// Auth routes: key management, account info, E2E key rotation
// These prefixes are handled by handleAuthRoutes (protected branch)
app.use('/v1/auth/*', legacyHandler(handleAuthRoutes));
app.use('/v1/account/*', legacyHandler(handleAuthRoutes));
app.use('/v1/e2e/*', legacyHandler(handleAuthRoutes));

// Pod management
app.route('/v1/pods', podRoutes);

// Stacks, usage, billing, observations
app.route('/v1', stackRoutes);

// Email webhooks (before general email routes — more specific prefix first)
app.use('/v1/email/webhooks', legacyHandler(handleWebhookRoutes));
app.use('/v1/email/webhooks/*', legacyHandler(handleWebhookRoutes));

// Custom domain management (before general email routes)
app.use('/v1/email/domains', legacyHandler(handleDomainRoutes));
app.use('/v1/email/domains/*', legacyHandler(handleDomainRoutes));

// Email routes
app.use('/v1/email/*', legacyHandler(handleEmailRoutes));
app.use('/v1/inbox/*', legacyHandler(handleEmailRoutes));

// Task delegation routes
app.use('/v1/tasks', legacyHandler(handleTaskRoutes));

// Vault routes (protected)
app.use('/v1/vault', legacyHandler(handleVaultRoutes));
app.use('/v1/vault/*', legacyHandler(handleVaultRoutes));

// Calendar routes (protected)
app.use('/v1/calendar/*', legacyHandler(handleCalendarRoutes));

// Token routes: introspect (public — auth skipped in section 5), issue + info (auth required)
// revokeRoutes: POST /v1/tokens/revoke — auth required (RFC-001 Phase 1)
app.route('/v1/tokens', publicTokenRoutes);
app.route('/v1/tokens', tokenRoutes);
app.route('/v1/tokens', revokeRoutes);

// Signing key routes (RFC 9421): register, get, delete per-agent Ed25519 keys
app.route('/v1/agents', signingKeyRoutes);

// Audit routes: /v1/audit/log, /v1/audit/verification-key (mounted at /v1/audit)
// Also mount at /v1 so /v1/attestations resolves correctly (separate from /v1/audit/attestations)
app.route('/v1/audit', auditRoutes);
app.route('/v1', auditRoutes);

// Public audit JTI endpoint: GET /v1/audit/:jti — per-token metadata for al_audit_url in AATs.
// Mounted AFTER auditRoutes so specific paths (/log, /verification-key, /attestations) match first.
// Auth middleware bypasses this route for the JTI format (aat_[A-Za-z0-9]{16}) — see section 5.
app.route('/v1/audit', publicAuditRoutes);

// SCITT Transparency Service routes: POST /v1/scitt/entries, GET /v1/scitt/entries/:id, GET /v1/scitt/entries/:id/receipt
app.route('/v1/scitt', scittRoutes);

// PoPA enrollment: POST /v1/popa/enroll — auth-gated. The public popaRoutes
// mount above (line ~1091) handles GET /v1/popa/:did before auth. Hono falls
// through that public mount on POST (no method match), the /v1/* auth
// middleware runs, and lands here.
app.route('/v1/popa', popaEnrollRoutes);

// BCC issuance: POST /v1/bcc/issue — auth-gated. The public bccPublicRoutes
// mount above handles GET /v1/bcc/:id before auth (POST has no method match
// there, so Hono falls through to the /v1/* auth middleware → bccRoutes here).
app.route('/v1/bcc', bccRoutes);

// Session lifecycle routes (PicoClaw agent session tracking)
app.route('/v1/sessions', sessionRoutes);

// Budget routes: per-agent spending caps (GET /v1/budget, PUT /v1/budget, GET /v1/budget/history)
app.route('/v1/budget', budgetRoutes);

// Gateway routes: governed x402 proxy (GET/PUT /policy, GET /budget, GET /history, POST /proxy, GET /wallet)
app.route('/v1/gateway', gatewayRoutes);

// Charge route: declare spending intent (POST /v1/charge)
app.route('/v1/charge', chargeRoutes);

// Approval routes: list/approve/reject pending approval requests
app.route('/v1/approvals', approvalRoutes);

// Credential provisioning routes (device flow): request, approve, poll
app.use('/v1/credentials/*', legacyHandler(handleCredentialRoutes));
app.use('/v1/credentials', legacyHandler(handleCredentialRoutes));

// Trust scoring routes: GET /v1/trust/:agentId — behavioral trust score from observations
app.route('/v1/trust', trustRoutes);

// Telemetry ingestion routes: POST /v1/telemetry/submit — ingest behavioral events from external runtimes
// GET /v1/telemetry/status — integration health check (event count, last seen)
// Integration: Springdrift (seamus-brady/springdrift issue #27) — first external partner
app.route('/v1/telemetry', telemetryRoutes);

// Behavioral event ingestion routes (RFC-003 Phase 2a):
// POST /v1/events — ingest structured behavioral events from agent runtimes
// Stored in behavioral_events D1 table; feeds trust engine (Phase 2b).
app.route('/v1/events', eventRoutes);

// ── 7. Stubbed routes ───────────────────────────────────────────────────────────

app.all('/v1/dns/*', () => json({
  error: 'coming_soon',
  message: 'DNS management via Cloudflare API — live Q2 2026.',
  roadmap: 'https://agentlair.dev/roadmap',
}, 503));

app.all('/v1/hosting/*', () => json({
  error: 'coming_soon',
  message: 'Static site hosting via Cloudflare Pages — live Q2 2026.',
  roadmap: 'https://agentlair.dev/roadmap',
}, 503));

// ── 8. Catch-alls ───────────────────────────────────────────────────────────────

// API clients hitting unknown /v1/* routes get a JSON 404 (not an HTML page)
app.all('/v1/*', () => err('Route not found. See GET / for available endpoints.', 404, 'not_found'));

// Specific page route for the leaderboard so the /popa/* SPA shell catch-all
// below does NOT swallow this path (it would treat "leaderboard" as a DID).
app.get('/popa/leaderboard', (c) => proxyToPages(c, '/popa/leaderboard'));

// PoPA freshness dashboard — serve SPA shell for any /popa/[did] path.
// The Astro page at /popa/ is a React island that reads window.location.pathname
// to extract the DID and fetches attestation data client-side.
app.get('/popa/*', (c) => proxyToPages(c, '/popa/'));

// All other routes proxy to CF Pages (Astro) — handles /security, /blog/*, /pricing, /privacy,
// /calendar, /integrations, /dashboard, and any future Astro pages automatically.
app.all('*', (c) => proxyToPages(c));

// ─── CF Email Message Type ──────────────────────────────────────────────────────
interface CfEmailMessage {
  to?: string;
  from?: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
}

// ─── Email Authentication: DMARC/SPF/DKIM validation ─────────────────────────
// Parses email authentication status from available signals.
//
// IMPORTANT: CF Email Workers does NOT expose Authentication-Results headers.
// Tested 2026-03-30: message.raw contains only original sender headers (From,
// DKIM-Signature, etc). CF strips/doesn't inject Authentication-Results or
// ARC-Authentication-Results into either message.raw or message.headers.
//
// Strategy (3 layers):
// 1. Try Authentication-Results from raw headers or message.headers (future-proofing)
// 2. Infer from DKIM-Signature presence in raw headers
// 3. CF Email Routing requires SPF or DKIM pass since July 2025 — delivery itself
//    implies the email passed authentication. Emails that fail are rejected before
//    reaching the Worker.

interface AuthResult {
  spf: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'unknown';
  dkim: 'pass' | 'fail' | 'none' | 'temperror' | 'permerror' | 'unknown';
  dmarc: 'pass' | 'fail' | 'none' | 'temperror' | 'permerror' | 'unknown';
  authenticated: boolean;         // true if SPF=pass OR DKIM=pass
  spoofed_internal: boolean;      // true if From: is @agentlair.dev but didn't pass auth
  raw_header: string | null;      // original header for debugging
  method: 'header' | 'cf_inferred';  // how auth was determined
}

// Extract a header value from raw RFC 5322 header text, handling header folding
// (continuation lines starting with whitespace per RFC 5322 §2.2.3).
function extractRawHeader(headerSection: string, headerName: string): string | null {
  const regex = new RegExp(
    `^${headerName}:\\s*(.+(?:\\r?\\n[ \\t]+.+)*)`,
    'im'
  );
  const match = headerSection.match(regex);
  if (!match) return null;
  // Unfold continuation lines into single line
  return match[1].replace(/\r?\n[ \t]+/g, ' ').trim();
}

// Parse auth results from an Authentication-Results header value
function parseAuthHeader(raw: string): { spf: AuthResult['spf']; dkim: AuthResult['dkim']; dmarc: AuthResult['dmarc'] } {
  const lower = raw.toLowerCase();
  const spfMatch = lower.match(/\bspf\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/);
  const dkimMatch = lower.match(/\bdkim\s*=\s*(pass|fail|none|temperror|permerror)\b/);
  const dmarcMatch = lower.match(/\bdmarc\s*=\s*(pass|fail|none|temperror|permerror)\b/);
  return {
    spf: spfMatch ? spfMatch[1] as AuthResult['spf'] : 'none',
    dkim: dkimMatch ? dkimMatch[1] as AuthResult['dkim'] : 'none',
    dmarc: dmarcMatch ? dmarcMatch[1] as AuthResult['dmarc'] : 'none',
  };
}

function parseAuthenticationResults(
  rawHeaderSection: string,
  fromAddr: string,
  messageHeaders?: Headers,
): AuthResult {
  const result: AuthResult = {
    spf: 'unknown',
    dkim: 'unknown',
    dmarc: 'unknown',
    authenticated: false,
    spoofed_internal: false,
    raw_header: null,
    method: 'cf_inferred',
  };

  // ── Layer 1: Try explicit Authentication-Results headers ──────────────
  // Check raw header section first, then message.headers API
  let raw =
    extractRawHeader(rawHeaderSection, 'Authentication-Results') ||
    extractRawHeader(rawHeaderSection, 'ARC-Authentication-Results') ||
    null;

  // Also try message.headers.get() — CF may expose these in future updates
  if (!raw && messageHeaders) {
    raw =
      messageHeaders.get('Authentication-Results') ||
      messageHeaders.get('ARC-Authentication-Results') ||
      null;
  }

  if (raw) {
    // Found explicit auth header — parse it
    const parsed = parseAuthHeader(raw);
    result.spf = parsed.spf;
    result.dkim = parsed.dkim;
    result.dmarc = parsed.dmarc;
    result.raw_header = raw;
    result.method = 'header';
    result.authenticated = result.spf === 'pass' || result.dkim === 'pass';
  } else {
    // ── Layer 2: Infer from available signals ─────────────────────────────
    // CF Email Routing enforces authentication (SPF or DKIM) since July 2025.
    // If the email reached this Worker, CF already verified it passed.
    //
    // We can further refine by checking for DKIM-Signature header presence:
    // - DKIM-Signature present → DKIM was used and CF verified it
    // - No DKIM-Signature → CF verified via SPF instead
    const hasDkimSignature = !!extractRawHeader(rawHeaderSection, 'DKIM-Signature');

    if (hasDkimSignature) {
      result.dkim = 'pass';
      result.spf = 'none';  // Can't determine SPF without sender IP
    } else {
      // No DKIM-Signature → CF must have verified via SPF
      result.spf = 'pass';
      result.dkim = 'none';
    }
    result.dmarc = 'none';  // Can't determine DMARC without explicit header
    result.authenticated = true;  // CF delivery guarantees authentication
    result.raw_header = `cf_inferred:dkim_sig=${hasDkimSignature}`;
    result.method = 'cf_inferred';
  }

  // ── Spoofed @agentlair.dev detection ──────────────────────────────────
  // Internal addresses should NEVER arrive through external email routing.
  // Any email claiming to be from @agentlair.dev that arrives via CF Email Routing
  // is either spoofed or misconfigured. Flag it regardless of SPF/DKIM.
  const fromLower = fromAddr.toLowerCase();
  const isInternalSender = fromLower.includes('@agentlair.dev');
  if (isInternalSender) {
    // Internal emails are sent via Resend API, not through inbound SMTP.
    // Any @agentlair.dev sender arriving here is spoofed.
    result.spoofed_internal = true;
    result.authenticated = false;
  }

  return result;
}

// ─── Cloudflare Email Workers: inbound delivery ─────────────────────────────────
// Triggered by Cloudflare Email Routing when a message arrives for @agentlair.dev
// or any custom domain configured to route through this worker.
// Stores encrypted message body in EMAILS KV and fires registered webhooks.
// NOT part of Hono — this is a separate CF Workers entry point.

async function handleInboundEmail(message: CfEmailMessage, env: Env, ctx: ExecutionContext) {
  try {
    const toAddr = message.to ? message.to.toLowerCase().trim() : null;
    // Use header From (human-readable) over envelope from (SES relay address)
    const headerFrom = message.headers.get('From') || '';
    const fromAddr = headerFrom || message.from || '';
    const subject = message.headers.get('Subject') || '';
    const messageId = message.headers.get('Message-ID') || ('inbound_' + nanoid(20));
    const now = new Date().toISOString();

    // ── Read raw email stream FIRST ────────────────────────────────────────
    // Raw stream is read before body parsing. Also used for auth inference:
    // CF Email Workers does NOT inject Authentication-Results into message.raw
    // or message.headers (verified 2026-03-30). Auth is inferred from
    // DKIM-Signature presence + CF delivery guarantee instead.
    let rawEmail = '';
    let rawHeaderSection = '';  // Original-case header section for auth parsing
    try {
      const reader = message.raw.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const combined = new Uint8Array(chunks.reduce((a: number, c: Uint8Array) => a + c.length, 0));
      let off = 0;
      for (const chunk of chunks) {
        combined.set(chunk, off);
        off += chunk.length;
      }
      rawEmail = new TextDecoder().decode(combined);
      // Extract header section (before first blank line)
      let headerEnd = rawEmail.indexOf('\r\n\r\n');
      if (headerEnd === -1) headerEnd = rawEmail.indexOf('\n\n');
      if (headerEnd !== -1) {
        rawHeaderSection = rawEmail.substring(0, headerEnd);
      }
    } catch {
      // If raw stream fails, we continue with empty headers — auth will be 'unknown'
      rawEmail = '';
      rawHeaderSection = '';
    }

    // ── DMARC/SPF/DKIM validation (raw headers + message.headers + CF inference) ──
    const authResult = parseAuthenticationResults(rawHeaderSection, fromAddr, message.headers);

    // Reject spoofed @agentlair.dev senders — these NEVER arrive via inbound SMTP legitimately
    if (authResult.spoofed_internal) {
      // Log the rejection attempt for monitoring
      if (env.EMAILS) {
        ctx.waitUntil(env.EMAILS.put('debug:rejected-spoofed-internal', JSON.stringify({
          from: fromAddr, to: toAddr, subject,
          auth: { spf: authResult.spf, dkim: authResult.dkim, dmarc: authResult.dmarc, method: authResult.method },
          rejected_at: now,
        })));
      }
      // Silently drop — do not store, do not deliver, do not fire webhooks
      return;
    }

    // ── Parse email body from raw stream (already read above) ──────────────
    let rawBody = '';
    try {
      // Find MIME header/body boundary
      let bodyStart = rawEmail.indexOf('\r\n\r\n');
      if (bodyStart === -1) bodyStart = rawEmail.indexOf('\n\n');
      if (bodyStart !== -1) {
        const sep = rawEmail[bodyStart] === '\r' ? 4 : 2;
        let bodyContent = rawEmail.substring(bodyStart + sep);

        // Check Content-Transfer-Encoding from headers
        const headerSection = rawHeaderSection.toLowerCase();
        const isQuotedPrintable = headerSection.includes('content-transfer-encoding: quoted-printable');
        const isBase64 = headerSection.includes('content-transfer-encoding: base64');

        // For multipart MIME, extract the text/plain part
        const ctMatch = rawEmail.substring(0, bodyStart).match(/Content-Type:\s*multipart\/\w+;\s*boundary="?([^"\r\n;]+)"?/i);
        if (ctMatch) {
          const boundary = ctMatch[1];
          const parts = bodyContent.split('--' + boundary);
          let textPart = '';
          let htmlPart = '';
          for (const part of parts) {
            if (part.trim() === '--' || part.trim() === '') continue;
            const partHeaderEnd = part.indexOf('\r\n\r\n');
            const partHeaderEndAlt = part.indexOf('\n\n');
            const phEnd = partHeaderEnd !== -1 ? partHeaderEnd : partHeaderEndAlt;
            if (phEnd === -1) continue;
            const partHeaders = part.substring(0, phEnd).toLowerCase();
            const phSep = partHeaderEnd !== -1 ? 4 : 2;
            let partBody = part.substring(phEnd + phSep);
            if (partHeaders.includes('content-transfer-encoding: quoted-printable')) {
              partBody = partBody.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            } else if (partHeaders.includes('content-transfer-encoding: base64')) {
              try { partBody = atob(partBody.replace(/\s/g, '')); } catch {}
            }
            if (partHeaders.includes('content-type: text/plain') || (partHeaders.includes('content-type:') && partHeaders.includes('text/plain'))) {
              textPart = partBody;
            } else if (partHeaders.includes('content-type: text/html') || (partHeaders.includes('content-type:') && partHeaders.includes('text/html'))) {
              htmlPart = partBody;
            }
          }
          if (textPart) bodyContent = textPart;
          else if (htmlPart) bodyContent = htmlPart;
        }

        // Decode transfer encoding for non-multipart
        if (!ctMatch) {
          if (isQuotedPrintable) {
            bodyContent = bodyContent.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          } else if (isBase64) {
            try { bodyContent = atob(bodyContent.replace(/\s/g, '')); } catch {}
          }
        }

        // Strip HTML tags if content is HTML
        if (bodyContent.includes('<html') || bodyContent.includes('<body') || bodyContent.includes('<div') || bodyContent.includes('<p>') || bodyContent.includes('<br')) {
          bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                           .replace(/<br\s*\/?>/gi, '\n')
                           .replace(/<\/p>/gi, '\n')
                           .replace(/<[^>]+>/g, ' ')
                           .replace(/&nbsp;/g, ' ')
                           .replace(/&amp;/g, '&')
                           .replace(/&lt;/g, '<')
                           .replace(/&gt;/g, '>')
                           .replace(/&quot;/g, '"')
                           .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
                           .replace(/[ \t]+/g, ' ')
                           .replace(/\n\s*\n/g, '\n')
                           .trim();
        }

        rawBody = bodyContent.trim();
      } else {
        rawBody = rawEmail.trim();
      }
    } catch {
      rawBody = '[email body could not be parsed]';
    }

    // Check if recipient has registered an E2E public key
    let e2ePubKey: string | null = null;
    if (env.EMAILS && toAddr) {
      try { e2ePubKey = await env.EMAILS.get(`email-pubkey:${toAddr}`); } catch {}
    }

    const msgId = nanoid(16);
    const msgKey = `msg:${toAddr}:${msgId}`;
    let msg: Record<string, unknown> | null = null;

    if (e2ePubKey && rawBody) {
      try {
        const { body: e2eBody, ephemeral_public_key } = await encryptEmailE2E(e2ePubKey, rawBody);
        msg = {
          message_id: messageId, from: fromAddr, to: toAddr, subject,
          body: e2eBody, body_encrypted: true, e2e_encrypted: true, ephemeral_public_key,
          body_preview: '[E2E encrypted]',
          received_at: now, read: false,
        };
      } catch { e2ePubKey = null; }
    }

    // Extract threading headers
    const rawInReplyTo = message.headers.get('In-Reply-To') || '';
    const rawReferences = message.headers.get('References') || '';
    const normalizedInReplyTo = rawInReplyTo.replace(/[<>]/g, '').trim();
    const normalizedReferences = rawReferences.trim();

    let threadId: string;
    if (normalizedInReplyTo) {
      threadId = normalizedInReplyTo;
    } else if (normalizedReferences) {
      const firstRef = normalizedReferences.split(/\s+/)[0].replace(/[<>]/g, '').trim();
      threadId = firstRef || messageId.replace(/[<>]/g, '').trim();
    } else {
      threadId = messageId.replace(/[<>]/g, '').trim();
    }

    if (!msg) {
      const { value: encBody, encrypted } = await encryptEmailField(env, rawBody);
      msg = {
        message_id: messageId, from: fromAddr, to: toAddr, subject,
        body: encBody, body_encrypted: encrypted,
        body_preview: rawBody.substring(0, 120).replace(/\n/g, ' '),
        received_at: now, read: false,
      };
    }

    if (normalizedInReplyTo) msg.in_reply_to = normalizedInReplyTo;
    if (normalizedReferences) msg.references = normalizedReferences;
    msg.thread_id = threadId;

    // ── Attach email authentication results ──────────────────────────────
    msg.auth = {
      spf: authResult.spf,
      dkim: authResult.dkim,
      dmarc: authResult.dmarc,
      authenticated: authResult.authenticated,
      method: authResult.method,
    };

    if (env.EMAILS) {
      try {
        await env.EMAILS.put(msgKey, JSON.stringify(msg), { expirationTtl: 30 * 24 * 3600 });
        const indexKey = `index:${toAddr}`;
        const indexRaw = await env.EMAILS.get(indexKey);
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        index.unshift(msgKey);
        const trimmedIndex = index.slice(0, 500);
        await env.EMAILS.put(indexKey, JSON.stringify(trimmedIndex), { expirationTtl: 30 * 24 * 3600 });

        if (toAddr && threadId) {
          const threadIdxKey = `thread-idx:${toAddr}:${threadId}`;
          const threadIdxRaw = await env.EMAILS.get(threadIdxKey);
          const threadIdx = threadIdxRaw ? JSON.parse(threadIdxRaw) : [];
          threadIdx.unshift(msgKey);
          const trimmedThreadIdx = threadIdx.slice(0, 100);
          await env.EMAILS.put(threadIdxKey, JSON.stringify(trimmedThreadIdx), { expirationTtl: 30 * 24 * 3600 });
        }
      } catch { /* KV write failed — email is lost but we don't bounce */ }

      try { await env.EMAILS.get(`email-owner:${toAddr}`); } catch {}

      // Notify connected WebSocket clients (non-blocking, fail-open)
      ctx.waitUntil((async () => {
        try {
          const accountId = await env.EMAILS.get(`email-owner:${toAddr}`);
          if (accountId) {
            const notifierId = env.INBOX_NOTIFIER.idFromName(accountId);
            const notifier = env.INBOX_NOTIFIER.get(notifierId);
            await notifier.fetch(new Request('https://internal/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'new_email', email_id: msgId, from: fromAddr, subject, received_at: now }),
            }));
          }
        } catch { /* Fail-open */ }
      })());

      // Fire registered webhooks (non-blocking)
      ctx.waitUntil((async () => {
        try {
          const addrIndexKey = `webhook-addr:${toAddr}`;
          const hookIdsRaw = await env.EMAILS.get(addrIndexKey);
          if (!hookIdsRaw) return;
          const hookIds = JSON.parse(hookIdsRaw);
          const payload = {
            event: 'email.received',
            address: toAddr,
            message: {
              message_id: messageId, from: fromAddr, subject,
              body_preview: msg!.body_preview, received_at: now,
              auth: { spf: authResult.spf, dkim: authResult.dkim, dmarc: authResult.dmarc, authenticated: authResult.authenticated, method: authResult.method },
            },
          };
          await Promise.allSettled(hookIds.map(async (hookId: string) => {
            const hookRaw = await env.EMAILS.get(`webhook:${hookId}`);
            if (!hookRaw) return;
            const hook = JSON.parse(hookRaw);
            if (!hook.url || hook.status === 'paused') return;
            const body = JSON.stringify(payload);
            // Use HMAC-SHA256 instead of sha256(secret+body) to prevent length-extension attacks
            const sig = hook.secret ? await hmacSha256(hook.secret, body) : null;
            const ts = Math.floor(Date.now() / 1000).toString();
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (sig) {
              headers['X-AgentLair-Signature'] = `sha256=${sig}`;
              headers['X-AgentLair-Timestamp'] = ts;
            }
            await fetch(hook.url, { method: 'POST', headers, body }).catch(() => {});
          }));
        } catch { /* Webhook delivery failed — best effort */ }
      })());
    }
  } catch (e: unknown) {
    try {
      if (env.EMAILS) {
        await env.EMAILS.put('debug:last-email-error', JSON.stringify({
          error: String(e),
          stack: e instanceof Error ? e.stack || 'n/a' : 'n/a',
          from: message?.from || 'unknown',
          to: message?.to || 'unknown',
          ts: new Date().toISOString(),
        }));
      }
    } catch { /* swallow */ }
  }
}

// ─── Outer wrapper: analytics, error handling, verbose stripping ─────────────────
// Hono's app.fetch is wrapped to add cross-cutting concerns that run
// AFTER route handlers return (post-processing).

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const t0 = Date.now();
    if (!env.PLATFORM_ENCRYPTION_KEY) {
      console.warn('[AgentLair] WARNING: PLATFORM_ENCRYPTION_KEY is not set — platform-level email encryption is disabled');
    }
    const url = new URL(request.url);
    let response: Response;
    try {
      response = await app.fetch(request, env, ctx);
    } catch (e: unknown) {
      // Global error handler — prevents CF 1101 error pages
      const message = e instanceof Error ? e.message : 'Internal server error';
      const isKvLimit = message.includes('free usage limit') || message.includes('KV') || message.includes('quota');
      response = new Response(JSON.stringify({
        error: 'internal_error',
        message: isKvLimit
          ? 'Service temporarily unavailable due to platform limits. Please try again later.'
          : 'An unexpected error occurred. Please try again.',
        timestamp: new Date().toISOString(),
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      });
    }

    // ── Verbose stripping ─────────────────────────────────────────────────────
    // ?verbose=false → strip human-readable fields from all JSON responses.
    if (url.searchParams.get('verbose') === 'false') {
      const ct = response.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        try {
          const body = await response.clone().json() as Record<string, unknown>;
          let modified = false;
          for (const f of VERBOSE_ONLY_FIELDS) {
            if (f in body) { delete body[f]; modified = true; }
          }
          if (modified) {
            const newHeaders = new Headers(response.headers);
            response = new Response(JSON.stringify(body), {
              status: response.status,
              headers: newHeaders,
            });
          }
        } catch { /* If parsing fails, return original response unchanged */ }
      }
    }

    // ── Analytics Engine ──────────────────────────────────────────────────────
    try {
      env.AE_ANALYTICS?.writeDataPoint({
        blobs: [request.method, url.pathname, String(response.status)],
        doubles: [Date.now() - t0],
        indexes: [url.pathname],
      });
    } catch {}

    return response;
  },

  async email(message: CfEmailMessage, env: Env, ctx: ExecutionContext) {
    return handleInboundEmail(message, env, ctx);
  },

  /**
   * Cron triggers (registered in wrangler.toml [triggers]).
   *  - "0 0 * * *" → daily PoPA emission for all enabled subscribers.
   *
   * Cron runs are non-blocking from the platform's view; we use waitUntil
   * to keep the isolate alive long enough to finish.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 0 * * *') {
      ctx.waitUntil(runPoPADaily(env));
    }
  },
};

// Required by CF Workers runtime to locate the DO class by name
export { InboxNotifier };
export { TransparencyService } from './durable-objects/transparency-service.js';
