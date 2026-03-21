import { nanoid, sha256hex, json, err, html, VERBOSE_ONLY_FIELDS } from './utils.js';
import type { Env } from './types.js';
import { InboxNotifier } from './durable-objects/inbox-notifier.js';
import { LANDING_HTML } from './templates/landing.js';
import { SECURITY_BLOG_HTML } from './templates/security.js';
import { AGENT_FIRST_BLOG_HTML } from './templates/blog-agent-first.js';
import { DASHBOARD_HTML } from './templates/dashboard.js';
import { VAULT_HTML } from './templates/vault.js';
import { CALENDAR_HTML } from './templates/calendar.js';
import { GETTING_STARTED_HTML } from './templates/getting-started.js';
import { INTEGRATIONS_HTML } from './templates/integrations.js';
import { PLATFORM_LOCKDOWN_HTML } from './templates/platform-lockdown.js';
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

// ─── Router ───────────────────────────────────────────────────────────────────

const _agentlairHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-PAYMENT',
          'Access-Control-Expose-Headers': 'X-402-Version, X-Payment-Response',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ── Static / public HTML pages ────────────────────────────────────────────

    // Helper: build the agent manifest response (application/agent+json)
    const agentManifestResponse = (detection: { confidence: string; signals: string[] }) =>
      new Response(JSON.stringify(AGENTLAIR_MANIFEST, null, 2), {
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

    if ((path === '/security' || path === '/blog/security') && method === 'GET') {
      // Agent-first: serve machine-optimized manifest to AI agents
      const detection = detectAgent(request.headers);
      if (detection.isAgent && (detection.confidence === 'high' || detection.confidence === 'medium')) {
        return agentManifestResponse(detection);
      }
      return new Response(SECURITY_BLOG_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (path === '/blog/agent-first-web' && method === 'GET') {
      // Agent-first: serve machine-optimized manifest to AI agents
      const detection = detectAgent(request.headers);
      if (detection.isAgent && (detection.confidence === 'high' || detection.confidence === 'medium')) {
        return agentManifestResponse(detection);
      }
      return new Response(AGENT_FIRST_BLOG_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if ((path === '/blog/anthropic-platform-lockdown' || path === '/blog/platform-lockdown') && method === 'GET') {
      return new Response(PLATFORM_LOCKDOWN_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (path === '/vault' && method === 'GET') {
      return new Response(VAULT_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (path === '/calendar' && method === 'GET') {
      return new Response(CALENDAR_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (path === '/getting-started' && method === 'GET') {
      // Agent-first: serve machine-optimized manifest to AI agents
      const detection = detectAgent(request.headers);
      if (detection.isAgent && (detection.confidence === 'high' || detection.confidence === 'medium')) {
        return agentManifestResponse(detection);
      }
      return new Response(GETTING_STARTED_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (path === '/integrations' && method === 'GET') {
      return new Response(INTEGRATIONS_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (path === '/dashboard' && method === 'GET') {
      return new Response(DASHBOARD_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair' },
      });
    }

    if (path === '/' && method === 'GET') {
      // Agent-first content negotiation: serve machine-optimized manifest to AI agents
      // This runs BEFORE the HTML/JSON check so agents with explicit signals get the manifest
      const detection = detectAgent(request.headers);
      if (detection.isAgent && (detection.confidence === 'high' || detection.confidence === 'medium')) {
        return agentManifestResponse(detection);
      }
      const acceptHtml = request.headers.get('Accept')?.includes('text/html');
      if (acceptHtml) {
        return html(LANDING_HTML);
      }
      return json(API_DISCOVERY);
    }

    if (path === '/api' && method === 'GET') {
      const acceptHtml = request.headers.get('Accept')?.includes('text/html');
      if (acceptHtml) {
        return new Response(SCALAR_DOCS_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Powered-By': 'AgentLair' } });
      }
      return new Response(JSON.stringify(OPENAPI_SPEC), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
    }

    if (path === '/health' && method === 'GET') {
      return json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.18.0' });
    }

    if (path === '/docs' && (method === 'GET' || method === 'HEAD')) {
      return new Response(SCALAR_DOCS_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Powered-By': 'AgentLair' } });
    }

    if (path === '/.well-known/agent.json' && method === 'GET') {
      return new Response(JSON.stringify(AGENT_CARD, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // ── Phase 1: public route handlers (no auth) ─────────────────────────────
    // Auth routes (login, verify, key creation) and Vault public routes (store, recover)

    const rc0 = { url, path, method, account: null };

    let response: Response | null = null;
    response = await handleAuthRoutes(request, env, ctx, rc0);
    if (!response) response = await handleVaultRoutes(request, env, ctx, rc0);
    if (!response) response = await handleCalendarRoutes(request, env, ctx, rc0); // public: feed.ics
    if (response) return response;

    // ── WebSocket: real-time inbox notifications ──────────────────────────────
    // WebSocket handshake cannot carry Authorization headers — token in ?token= param.
    // Token is NOT logged anywhere. Same hash+KEYS validation as authenticate().
    if (path === '/v1/ws' && method === 'GET') {
      const token = url.searchParams.get('token') || '';
      if (!token.startsWith('al_')) {
        return err('Authentication required. Pass API key as: ?token=al_live_...', 401, 'unauthorized');
      }
      const hash = await sha256hex(token);
      const accountJson = await env.KEYS.get('key:' + hash);
      if (!accountJson) {
        return err('Invalid or expired token.', 401, 'unauthorized');
      }
      const wsAccount = JSON.parse(accountJson);
      const notifierId = env.INBOX_NOTIFIER.idFromName(wsAccount.id);
      const notifier = env.INBOX_NOTIFIER.get(notifierId);
      return notifier.fetch(request);
    }

    // ── Auth middleware ───────────────────────────────────────────────────────
    // Accepts either: API key (al_live_...) or session token (session_...) from dashboard

    const account = await authenticateAny(request, env);
    if (!account) {
      return err('Authentication required. Pass API key as: Authorization: Bearer al_live_...', 401, 'unauthorized');
    }

    // Rate limit check
    const allowed = await checkRateLimit(env, account.id, account.tier);
    if (!allowed) {
      return err('Rate limit exceeded. Free tier: 100 requests/day.', 429, 'rate_limited');
    }

    // ── Suspended pod guard ───────────────────────────────────────────────────
    // Pod keys for suspended pods are rejected (data preserved, but no API access)
    if (account.type === 'pod' && account.pod_id) {
      try {
        const podRaw = await env.KEYS.get('pod:' + account.pod_id);
        if (podRaw) {
          const pod = JSON.parse(podRaw);
          if (pod.status === 'suspended') {
            return err('This pod has been suspended. Contact your platform operator to restore access.', 403, 'pod_suspended');
          }
        }
      } catch { /* fail open — don't block on KV read error */ }
    }

    // ── Phase 2: protected route handlers ────────────────────────────────────

    const rc = { url, path, method, account };

    response = await handleAuthRoutes(request, env, ctx, rc);
    if (!response) response = await handlePodRoutes(request, env, ctx, rc);
    if (!response) response = await handleStackRoutes(request, env, ctx, rc);
    if (!response) response = await handleWebhookRoutes(request, env, ctx, rc);
    if (!response) response = await handleEmailRoutes(request, env, ctx, rc);
    if (!response) response = await handleVaultRoutes(request, env, ctx, rc);
    if (!response) response = await handleCalendarRoutes(request, env, ctx, rc);
    if (response) return response;

    // ── Stubbed routes ────────────────────────────────────────────────────────

    if (path.startsWith('/v1/dns')) {
      return json({
        error: 'coming_soon',
        message: 'DNS management via Cloudflare API — live Q2 2026.',
        roadmap: 'https://agentlair.dev/roadmap',
      }, 503);
    }

    if (path.startsWith('/v1/hosting')) {
      return json({
        error: 'coming_soon',
        message: 'Static site hosting via Cloudflare Pages — live Q2 2026.',
        roadmap: 'https://agentlair.dev/roadmap',
      }, 503);
    }

    // ── 404 ──────────────────────────────────────────────────────────────────

    return err('Route not found. See GET / for available endpoints.', 404, 'not_found');
  },

  // ─── Cloudflare Email Workers: inbound delivery ───────────────────────────
  // Triggered by Cloudflare Email Routing when an @agentlair.dev message arrives.
  // Stores encrypted message body in EMAILS KV and fires registered webhooks.
  async email(message: any, env: Env, ctx: ExecutionContext) {
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
            // Find text/plain part first, fall back to text/html
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
              // Decode part transfer encoding
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
            if (textPart) {
              bodyContent = textPart;
            } else if (htmlPart) {
              bodyContent = htmlPart;
            }
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
          // No header/body separator found — use entire content
          rawBody = rawEmail.trim();
        }
      } catch (emailParseErr) {
        // Last resort: try to at least store something
        rawBody = '[email body could not be parsed]';
      }

      // Check if recipient has registered an E2E public key
      let e2ePubKey: string | null = null;
      if (env.EMAILS && toAddr) {
        try { e2ePubKey = await env.EMAILS.get(`email-pubkey:${toAddr}`); } catch {}
      }

      const msgId = nanoid(16);
      const msgKey = `msg:${toAddr}:${msgId}`;
      let msg: any;

      if (e2ePubKey && rawBody) {
        // E2E encrypt: only the private key holder can decrypt
        try {
          const { body: e2eBody, ephemeral_public_key } = await encryptEmailE2E(e2ePubKey, rawBody);
          msg = {
            message_id: messageId,
            from: fromAddr,
            to: toAddr,
            subject,
            body: e2eBody,
            body_encrypted: true,
            e2e_encrypted: true,
            ephemeral_public_key,
            // Unencrypted preview (first 120 chars) for fast inbox listing without decryption
            body_preview: rawBody.substring(0, 120).replace(/\n/g, ' '),
            received_at: now,
            read: false,
          };
        } catch {
          // E2E encryption failed — fall back to platform encryption
          e2ePubKey = null;
        }
      }

      // Extract threading headers
      const rawInReplyTo = message.headers.get('In-Reply-To') || '';
      const rawReferences = message.headers.get('References') || '';
      const normalizedInReplyTo = rawInReplyTo.replace(/[<>]/g, '').trim();
      const normalizedReferences = rawReferences.trim();

      // Derive thread_id: use In-Reply-To first, then first Reference, then own message_id
      let threadId: string;
      if (normalizedInReplyTo) {
        threadId = normalizedInReplyTo;
      } else if (normalizedReferences) {
        // First message-id in References chain (space-separated, strip <>)
        const firstRef = normalizedReferences.split(/\s+/)[0].replace(/[<>]/g, '').trim();
        threadId = firstRef || messageId.replace(/[<>]/g, '').trim();
      } else {
        threadId = messageId.replace(/[<>]/g, '').trim();
      }

      if (!msg) {
        // Platform encryption fallback (no E2E key, or E2E encryption failed)
        const { value: encBody, encrypted } = await encryptEmailField(env, rawBody);
        msg = {
          message_id: messageId,
          from: fromAddr,
          to: toAddr,
          subject,
          body: encBody,
          body_encrypted: encrypted,
          // Unencrypted preview (first 120 chars) for fast inbox listing without decryption
          body_preview: rawBody.substring(0, 120).replace(/\n/g, ' '),
          received_at: now,
          read: false,
        };
      }

      // Attach threading metadata
      if (normalizedInReplyTo) msg.in_reply_to = normalizedInReplyTo;
      if (normalizedReferences) msg.references = normalizedReferences;
      msg.thread_id = threadId;

      if (env.EMAILS) {
        // Store message (critical write — email is lost if this fails)
        try {
          await env.EMAILS.put(msgKey, JSON.stringify(msg), { expirationTtl: 30 * 24 * 3600 });

          // Update address index (newest first)
          const indexKey = `index:${toAddr}`;
          const indexRaw = await env.EMAILS.get(indexKey);
          const index = indexRaw ? JSON.parse(indexRaw) : [];
          index.unshift(msgKey);
          // Cap index at 500 entries to prevent unbounded growth
          const trimmedIndex = index.slice(0, 500);
          await env.EMAILS.put(indexKey, JSON.stringify(trimmedIndex), { expirationTtl: 30 * 24 * 3600 });

          // Update thread index (newest first, cap at 100)
          if (toAddr && threadId) {
            const threadIdxKey = `thread-idx:${toAddr}:${threadId}`;
            const threadIdxRaw = await env.EMAILS.get(threadIdxKey);
            const threadIdx = threadIdxRaw ? JSON.parse(threadIdxRaw) : [];
            threadIdx.unshift(msgKey);
            const trimmedThreadIdx = threadIdx.slice(0, 100);
            await env.EMAILS.put(threadIdxKey, JSON.stringify(trimmedThreadIdx), { expirationTtl: 30 * 24 * 3600 });
          }
        } catch {
          // KV write failed (quota?) — email is lost but we don't bounce
          // Workers Paid plan ($5/mo) eliminates this failure mode
        }

        // Auto-claim address ownership if unclaimed
        try {
          const ownerKey = `email-owner:${toAddr}`;
          await env.EMAILS.get(ownerKey);
        } catch {}
        // Note: unclaimed addresses just store mail silently — owner claims on first inbox access

        // Notify connected WebSocket clients (non-blocking, fail-open)
        ctx.waitUntil((async () => {
          try {
            // email-owner:{toAddr} is stored as a plain string (account.id) — use directly, no JSON.parse
            const accountId = await env.EMAILS.get(`email-owner:${toAddr}`);
            if (accountId) {
              const notifierId = env.INBOX_NOTIFIER.idFromName(accountId);
              const notifier = env.INBOX_NOTIFIER.get(notifierId);
              await notifier.fetch(new Request('https://internal/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event: 'new_email',
                  email_id: msgId,
                  from: fromAddr,
                  subject,
                  received_at: now,
                }),
              }));
            }
          } catch {
            // Fail-open: notification failure must never block email delivery
          }
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
                message_id: messageId,
                from: fromAddr,
                subject,
                body_preview: msg.body_preview,
                received_at: now,
              },
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
          } catch {
            // Webhook delivery failed — best effort, don't log to KV (saves writes)
          }
        })());
      }
    } catch (e: any) {
      // Log errors to KV for debugging — never bounce due to our own bugs
      try {
        if (env.EMAILS) {
          await env.EMAILS.put('debug:last-email-error', JSON.stringify({
            error: String(e),
            stack: e?.stack || 'n/a',
            from: message?.from || 'unknown',
            to: message?.to || 'unknown',
            ts: new Date().toISOString(),
          }));
        }
      } catch {}
    }
  },
};

// ─── Analytics Engine wrapper ─────────────────────────────────────────────────
// Logs method/path/status/latency for every HTTP request.
// AE binding is optional (?.writeDataPoint) — safe to deploy before dataset is enabled.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const t0 = Date.now();
    const url = new URL(request.url);
    let response: Response;
    try {
      response = await _agentlairHandler.fetch(request, env, ctx);
    } catch (e: any) {
      // Global error handler — prevents CF 1101 error pages
      const message = e?.message || 'Internal server error';
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
    // Agents pay per token; they don't need guidance strings, only machine codes.
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
        } catch {
          // If parsing fails, return original response unchanged
        }
      }
    }

    try {
      env.AE_ANALYTICS?.writeDataPoint({
        blobs: [request.method, url.pathname, String(response.status)],
        doubles: [Date.now() - t0],
        indexes: [url.pathname],
      });
    } catch {}
    return response;
  },
  async email(message: any, env: Env, ctx: ExecutionContext) {
    return _agentlairHandler.email(message, env, ctx);
  },
};

// Required by CF Workers runtime to locate the DO class by name
export { InboxNotifier };
