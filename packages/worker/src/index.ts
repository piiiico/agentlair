// ─── AgentLair Worker — Hono Router ──────────────────────────────────────────
// Clean Hono app with middleware. Route files handle business logic.
// Email handler (CF Workers email routing) is separate — not part of Hono.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';
import { nanoid, sha256hex, json, err, VERBOSE_ONLY_FIELDS } from './utils.js';
import type { Env, Account, RouteContext, RouteHandler } from './types.js';
import { InboxNotifier } from './durable-objects/inbox-notifier.js';
import { API_DISCOVERY, OPENAPI_SPEC, SCALAR_DOCS_HTML } from './openapi.js';
import { AGENT_CARD } from './a2a.js';
import { authenticateAny } from './middleware/auth.js';
import { checkRateLimit } from './middleware/ratelimit.js';
import { detectAgent, AGENTLAIR_MANIFEST } from './middleware/agent-detect.js';
import { encryptEmailField, encryptEmailE2E } from './platform-crypto.js';

// ─── Route modules ─────────────────────────────────────────────────────────────
import { handleAuthRoutes } from './routes/auth.js';
import { handleVaultRoutes } from './routes/vault.js';
import { handleEmailRoutes } from './routes/email.js';
import { handleWebhookRoutes } from './routes/webhooks.js';
import { handleStackRoutes } from './routes/stacks.js';
import { handlePodRoutes } from './routes/pods.js';
import { handleCalendarRoutes } from './routes/calendar.js';

// ─── Hono App Type ──────────────────────────────────────────────────────────────

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    account: Account | null;
  };
};

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
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'X-PAYMENT', 'X-AGENTKIT'],
  exposeHeaders: ['X-402-Version', 'X-Payment-Response'],
  maxAge: 86400,
}));

// ── 1.5. Astro static assets — proxy to CF Pages ────────────────────────────────
// These MUST come before any other route handlers so /_astro/*, /fonts/*, etc.
// are always served from the Astro build.

app.get('/_astro/*', (c) => proxyToPages(c));
app.get('/fonts/*', (c) => proxyToPages(c));
app.get('/favicon.svg', (c) => proxyToPages(c));
app.get('/og-image.jpg', (c) => proxyToPages(c));
app.get('/sitemap-index.xml', (c) => proxyToPages(c));

// ── 2. Static / public HTML pages ───────────────────────────────────────────────

// Blog + security pages — proxied to CF Pages (Astro)
app.get('/security', (c) => proxyToPages(c, '/security'));
app.get('/blog/security', (c) => proxyToPages(c, '/security'));
app.get('/blog/agent-first-web', (c) => proxyToPages(c, '/blog/agent-first-web'));
app.get('/blog/human-verified-agent-email', (c) => proxyToPages(c, '/blog/human-verified-agent-email'));
app.get('/blog/anthropic-platform-lockdown', (c) => proxyToPages(c, '/blog/anthropic-platform-lockdown'));
app.get('/blog/platform-lockdown', (c) => proxyToPages(c, '/blog/anthropic-platform-lockdown'));
// Astro landing page routes — proxied to CF Pages
app.get('/pricing', (c) => proxyToPages(c));
app.get('/pricing/', (c) => proxyToPages(c));
app.get('/privacy', (c) => proxyToPages(c));
app.get('/privacy/', (c) => proxyToPages(c));

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
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  return proxyToPages(c, '/vault');
});
app.get('/calendar', (c) => proxyToPages(c, '/calendar'));
app.get('/getting-started', async (c) => {
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
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  return proxyToPages(c, '/getting-started');
});
// Astro pages — proxied to CF Pages
app.get('/integrations', (c) => proxyToPages(c, '/integrations'));
app.get('/dashboard', (c) => proxyToPages(c, '/dashboard'));

app.get('/', async (c) => {
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
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  // Non-browser API clients get JSON API discovery
  const acceptHtml = c.req.raw.headers.get('Accept')?.includes('text/html');
  if (!acceptHtml) return json(API_DISCOVERY);
  // Human visitors get the Astro landing page
  return proxyToPages(c, '/');
});

app.get('/api', (c) => {
  const acceptHtml = c.req.raw.headers.get('Accept')?.includes('text/html');
  if (acceptHtml) {
    return new Response(SCALAR_DOCS_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Powered-By': 'AgentLair' } });
  }
  return new Response(JSON.stringify(OPENAPI_SPEC), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
});

app.get('/health', () => json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.18.0' }));

app.on(['GET', 'HEAD'], '/docs', () =>
  new Response(SCALAR_DOCS_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Powered-By': 'AgentLair' } })
);

app.get('/.well-known/agent.json', () =>
  new Response(JSON.stringify(AGENT_CARD, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  })
);

// ── 3. Public API routes (no auth required) ──────────────────────────────────

// Auth: login, verify, key creation, agent-register
app.use('/v1/auth/login', publicHandler(handleAuthRoutes));
app.use('/v1/auth/verify', publicHandler(handleAuthRoutes));
app.use('/v1/auth/keys', publicHandler(handleAuthRoutes));
app.use('/v1/keys', publicHandler(handleAuthRoutes));
app.use('/v1/auth/agent-register', publicHandler(handleAuthRoutes));

// Vault: store, recover, recover/verify
app.use('/v1/vault/store', publicHandler(handleVaultRoutes));
app.use('/v1/vault/recover', publicHandler(handleVaultRoutes));
app.use('/v1/vault/recover/verify', publicHandler(handleVaultRoutes));

// Calendar: public iCal feed
app.use('/v1/calendar/feed.ics', publicHandler(handleCalendarRoutes));

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
  // Authenticate: API key (al_live_...) or session token (session_...)
  const account = await authenticateAny(c.req.raw, c.env);
  if (!account) {
    return err('Authentication required. Pass API key as: Authorization: Bearer al_live_...', 401, 'unauthorized');
  }
  c.set('account', account);

  // Rate limit: unified account-level daily check
  const allowed = await checkRateLimit(c.env, account.id, account.tier || 'free');
  if (!allowed) {
    return err('Rate limit exceeded. Free tier: 100 requests/day.', 429, 'rate_limited');
  }

  // Pod suspension guard
  if (account.type === 'pod' && account.pod_id) {
    try {
      const podRaw = await c.env.KEYS.get('pod:' + account.pod_id);
      if (podRaw) {
        const pod = JSON.parse(podRaw);
        if (pod.status === 'suspended') {
          return err('This pod has been suspended. Contact your platform operator to restore access.', 403, 'pod_suspended');
        }
      }
    } catch { /* fail open — don't block on KV read error */ }
  }

  await next();
});

// ── 6. Protected API routes (auth required) ─────────────────────────────────────

// Auth routes: key management, account info, E2E key rotation
// These prefixes are handled by handleAuthRoutes (protected branch)
app.use('/v1/auth/*', legacyHandler(handleAuthRoutes));
app.use('/v1/account/*', legacyHandler(handleAuthRoutes));
app.use('/v1/e2e/*', legacyHandler(handleAuthRoutes));

// Pod management
app.use('/v1/pods', legacyHandler(handlePodRoutes));
app.use('/v1/pods/*', legacyHandler(handlePodRoutes));

// Stacks, usage, billing, observations
app.use('/v1/stack', legacyHandler(handleStackRoutes));
app.use('/v1/stack/*', legacyHandler(handleStackRoutes));
app.use('/v1/usage', legacyHandler(handleStackRoutes));
app.use('/v1/billing', legacyHandler(handleStackRoutes));
app.use('/v1/observations', legacyHandler(handleStackRoutes));
app.use('/v1/observations/*', legacyHandler(handleStackRoutes));

// Email webhooks (before general email routes — more specific prefix first)
app.use('/v1/email/webhooks', legacyHandler(handleWebhookRoutes));
app.use('/v1/email/webhooks/*', legacyHandler(handleWebhookRoutes));

// Email routes
app.use('/v1/email/*', legacyHandler(handleEmailRoutes));
app.use('/v1/inbox/*', legacyHandler(handleEmailRoutes));

// Vault routes (protected)
app.use('/v1/vault', legacyHandler(handleVaultRoutes));
app.use('/v1/vault/*', legacyHandler(handleVaultRoutes));

// Calendar routes (protected)
app.use('/v1/calendar/*', legacyHandler(handleCalendarRoutes));

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

// ── 8. 404 catch-all ────────────────────────────────────────────────────────────

app.all('*', () => err('Route not found. See GET / for available endpoints.', 404, 'not_found'));

// ─── CF Email Message Type ──────────────────────────────────────────────────────
interface CfEmailMessage {
  to?: string;
  from?: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
}

// ─── Cloudflare Email Workers: inbound delivery ─────────────────────────────────
// Triggered by Cloudflare Email Routing when an @agentlair.dev message arrives.
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

    // Read email body from raw stream (only documented API on CF EmailMessage)
    let rawBody = '';
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
      const rawEmail = new TextDecoder().decode(combined);

      // Find MIME header/body boundary
      let bodyStart = rawEmail.indexOf('\r\n\r\n');
      if (bodyStart === -1) bodyStart = rawEmail.indexOf('\n\n');
      if (bodyStart !== -1) {
        const sep = rawEmail[bodyStart] === '\r' ? 4 : 2;
        let bodyContent = rawEmail.substring(bodyStart + sep);

        // Check Content-Transfer-Encoding from headers
        const headerSection = rawEmail.substring(0, bodyStart).toLowerCase();
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
          body_preview: rawBody.substring(0, 120).replace(/\n/g, ' '),
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
            message: { message_id: messageId, from: fromAddr, subject, body_preview: msg!.body_preview, received_at: now },
          };
          await Promise.allSettled(hookIds.map(async (hookId: string) => {
            const hookRaw = await env.EMAILS.get(`webhook:${hookId}`);
            if (!hookRaw) return;
            const hook = JSON.parse(hookRaw);
            if (!hook.url || hook.status === 'paused') return;
            const body = JSON.stringify(payload);
            const sig = hook.secret ? await sha256hex(hook.secret + body) : null;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (sig) headers['X-AgentLair-Signature'] = sig;
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
          'Access-Control-Allow-Origin': '*',
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
};

// Required by CF Workers runtime to locate the DO class by name
export { InboxNotifier };
