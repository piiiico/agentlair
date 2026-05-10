// ─── Public x402-paywalled A2A Trust Audit ──────────────────────────────────
// GET /  → HTML form (free)
// POST /run → audit endpoint (x402-paywalled, 0.001 USDC per run)
//
// Pipeline: pl-a2a-audit-run-20260510-043355

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { isPublicHost, isSelfUrl } from './badge.js';
import { auditCardUrl } from '../lib/a2a-audit.js';
import { buildSignedAgentCard } from '../a2a.js';
import {
  make402Response,
  verifyX402Payment,
  settleX402Payment,
  trackX402Spend,
  SERVICE_PRICES,
} from '../x402.js';
import { checkIpRateLimit } from '../middleware/ratelimit.js';
import { sha256hex } from '../utils.js';

export const a2aAuditRunRoutes = new Hono<HonoEnv>();

// ─── GET / — HTML form ────────────────────────────────────────────────────────

a2aAuditRunRoutes.get('/', async (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>A2A Trust Audit — agentlair.dev</title>
  <meta name="description" content="Paste an A2A AgentCard URL. Get an L1–L4 trust audit with badge embed code. Pay-per-run via x402 (0.001 USDC). agentlair.dev self-card free demo.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://agentlair.dev/a2a-audit">
  <meta property="og:title" content="A2A Trust Audit — agentlair.dev">
  <meta property="og:description" content="Pay-per-run A2A AgentCard audits. 0.001 USDC. Free agentlair.dev demo.">
  <meta property="og:url" content="https://agentlair.dev/a2a-audit">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:1.5rem;color:#1a1a1a;line-height:1.5}
    header{font-size:.85rem;color:#666;margin-bottom:1.5rem}
    header a{color:#666;text-decoration:none}
    header a:hover{text-decoration:underline}
    h1{font-size:1.5rem;margin-bottom:.5rem}
    h2{font-size:1.1rem;margin:1rem 0 .5rem}
    h3{font-size:.95rem;margin:.75rem 0 .25rem}
    p{margin-bottom:.75rem;font-size:.95rem}
    label{display:block;font-weight:600;margin-bottom:.25rem;font-size:.9rem}
    input[type=url]{width:100%;padding:.5rem;border:1px solid #ccc;border-radius:4px;font-size:.9rem;margin-bottom:.5rem}
    button{padding:.5rem 1rem;border:none;border-radius:4px;cursor:pointer;font-size:.9rem;margin-right:.5rem}
    button[type=submit]{background:#1a1a1a;color:#fff}
    button[type=button]{background:#eee;color:#333}
    button:disabled{opacity:.5;cursor:wait}
    #result{margin-top:1rem;border:1px solid #ddd;border-radius:4px;padding:1rem;background:#fafafa}
    #result-json{white-space:pre-wrap;word-break:break-all;font-size:.8rem;max-height:400px;overflow:auto}
    #embed-snippet{display:block;font-size:.8rem;background:#f5f5f5;padding:.5rem;border-radius:4px;word-break:break-all}
    #error-panel{margin-top:1rem;border:1px solid #e74c3c;border-radius:4px;padding:1rem;background:#fdf0ef;color:#c0392b;font-size:.9rem}
    #x402-help{margin-top:1.5rem;font-size:.85rem;color:#555}
    #x402-help a{color:#555}
    footer{margin-top:2rem;font-size:.8rem;color:#999;border-top:1px solid #eee;padding-top:.75rem}
    footer a{color:#999;text-decoration:none}
    footer a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <header>
    <a href="/">agentlair.dev</a> · <a href="/a2a">per-card pages</a> · <a href="/leaderboard/a2a">leaderboard</a>
  </header>
  <main>
    <h1>A2A Trust Audit</h1>
    <p>Paste an A2A AgentCard URL. Get an L1–L4 audit with grade, score, and badge embed code. <strong>0.001 USDC per run</strong> via x402. The agentlair.dev self-card is a free demo.</p>
    <form id="audit-form">
      <label for="card-url">AgentCard URL</label>
      <input type="url" id="card-url" name="url" placeholder="https://example.com/.well-known/agent.json" required>
      <button type="submit">Run audit</button>
      <button type="button" id="demo-btn">Try demo (agentlair.dev)</button>
    </form>
    <section id="result" hidden>
      <h2>Result</h2>
      <pre id="result-json"></pre>
      <h3>Embed badge</h3>
      <code id="embed-snippet"></code>
    </section>
    <div id="error-panel" hidden></div>
    <section id="x402-help">
      <h2>About x402 payments</h2>
      <p>x402 is the HTTP 402 Payment Required protocol — agents pay USDC on Base in response to a 402 challenge. Browsers can't pay x402 today; this form is for agents and CLI clients with a wallet. <a href="/blog/x402">Learn more</a></p>
    </section>
  </main>
  <footer>
    <a href="/a2a">All audited cards</a> · <a href="/blog/a2a-trust-leaderboard-may-2026/">Why we built this</a>
  </footer>
  <script>
(function(){
  var form=document.getElementById('audit-form');
  var input=document.getElementById('card-url');
  var demoBtn=document.getElementById('demo-btn');
  var resultEl=document.getElementById('result');
  var jsonEl=document.getElementById('result-json');
  var embedEl=document.getElementById('embed-snippet');
  var errorEl=document.getElementById('error-panel');
  var submitBtn=form.querySelector('button[type=submit]');

  function b64url(s){return btoa(s).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_')}

  function showError(msg){
    errorEl.textContent=msg;errorEl.hidden=false;resultEl.hidden=true;
  }

  async function runAudit(url){
    submitBtn.disabled=true;demoBtn.disabled=true;
    errorEl.hidden=true;resultEl.hidden=true;
    try{
      var res=await fetch('/a2a-audit/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url})});
      var data=await res.json();
      if(res.status===200){
        jsonEl.textContent=JSON.stringify(data.audit||data,null,2);
        embedEl.textContent='![A2A Trust](https://agentlair.dev/badge/a2a/'+b64url(url)+')';
        resultEl.hidden=false;
      }else if(res.status===402){
        showError('This audit requires 0.001 USDC payment. Use an x402-capable client to retry:\\nnpx @agentlair/a2a-trust-audit '+url);
      }else if(res.status===429){
        var ra=res.headers.get('Retry-After')||'3600';
        showError('Rate limit. Retry in '+ra+' seconds.');
      }else{
        showError((data.error||'Error')+': '+(data.message||res.statusText));
      }
    }catch(e){showError('Network error: '+e.message);}
    finally{submitBtn.disabled=false;demoBtn.disabled=false;}
  }

  form.addEventListener('submit',function(e){e.preventDefault();var v=input.value.trim();if(v)runAudit(v);});
  demoBtn.addEventListener('click',function(){input.value='https://agentlair.dev/.well-known/agent.json';runAudit(input.value);});
})();
  </script>
</body>
</html>`;
  return c.html(html);
});

// ─── POST /run — audit endpoint (x402-paywalled) ─────────────────────────────

a2aAuditRunRoutes.post('/run', async (c) => {
  // 1. Parse JSON body
  let body: { url?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body', message: 'Request body must be valid JSON with a "url" field.' }, 400);
  }

  const url = body?.url;
  if (!url || typeof url !== 'string') {
    return c.json({ error: 'invalid_body', message: 'Missing or non-string "url" field.' }, 400);
  }

  // 2. Validate URL — http(s) only, public host only (SSRF guard)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return c.json({ error: 'invalid_url', message: 'Could not parse URL.' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return c.json({ error: 'invalid_url', message: 'Only http and https URLs are supported.' }, 400);
  }
  if (!isPublicHost(parsed.host)) {
    return c.json({ error: 'invalid_url', message: 'Private/loopback/link-local hosts are not allowed.' }, 400);
  }

  // 3. Per-IP rate limit (before x402 to prevent facilitator hammering)
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const rl = await checkIpRateLimit(c.env, ip, 'a2a-audit-run', 30);
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited', message: 'Too many audit requests. Try again later.' }, 429, {
      'Retry-After': '3600',
    });
  }

  // 4. Normalize URL — lowercase host, strip trailing slash on path
  const normalizedHost = parsed.hostname.toLowerCase();
  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
  const normalized = `${parsed.protocol}//${normalizedHost}${normalizedPath}${parsed.search}`;
  const hash = await sha256hex(normalized);
  const cacheKey = `a2a-audit-run:cache:${hash}`;

  // 5. Self-card bypass — agentlair.dev is free (demo)
  if (isSelfUrl(normalized) && c.env.AUDIT_SIGNING_KEY) {
    let fetchImpl: typeof fetch | undefined;
    const card = await buildSignedAgentCard(c.env.AUDIT_SIGNING_KEY);
    fetchImpl = (async () =>
      new Response(JSON.stringify(card), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    const audit = await auditCardUrl(normalized, fetchImpl);
    return c.json({ audit, demo: true });
  }

  // 6. Cache check (cache reduces audit cost, NOT payment cost)
  let cachedAudit: unknown | null = null;
  try {
    const cached = await c.env.KEYS.get(cacheKey);
    if (cached) {
      cachedAudit = JSON.parse(cached);
    }
  } catch {
    // Cache read failure — proceed without cache
  }

  // 7. x402 challenge — no payment header = 402
  const xPayment = c.req.header('X-PAYMENT');
  if (!xPayment) {
    return make402Response(SERVICE_PRICES.a2a_audit_run);
  }

  // 8. x402 verify + settle (mirror routes/audit.ts:381–401)
  const verification = await verifyX402Payment(xPayment, SERVICE_PRICES.a2a_audit_run);
  if (!verification.valid) {
    return make402Response(SERVICE_PRICES.a2a_audit_run, { payment_error: verification.error });
  }
  const settlement = await settleX402Payment(xPayment, SERVICE_PRICES.a2a_audit_run);
  if (!settlement.settled) {
    return make402Response(SERVICE_PRICES.a2a_audit_run, { payment_error: settlement.error });
  }

  // 9. Audit (or read from cache)
  let audit: unknown;
  if (cachedAudit) {
    audit = cachedAudit;
  } else {
    try {
      audit = await auditCardUrl(normalized);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: 'audit_failed', message }, 502);
    }
  }

  // 10. Cache put (only on fresh audit — don't re-cache cached result)
  if (!cachedAudit) {
    c.executionCtx.waitUntil(
      c.env.KEYS.put(cacheKey, JSON.stringify(audit), { expirationTtl: 300 }).catch(() => {}),
    );
  }

  // 11. Track spend
  c.executionCtx.waitUntil(
    trackX402Spend(c.env, 'anonymous', SERVICE_PRICES.a2a_audit_run.amount, {
      payer: verification.payer,
      service: 'a2a_audit_run',
    }).catch(() => {}),
  );

  // 12. Set headers + return
  if (settlement.receipt) {
    c.header('X-Payment-Response', settlement.receipt);
  }
  return c.json({ audit, payment_receipt: settlement.receipt, demo: false });
});
