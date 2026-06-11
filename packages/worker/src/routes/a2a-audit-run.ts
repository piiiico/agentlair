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

// ─── Spread HTML helpers (module-private) ─────────────────────────────────────

function wantsHtml(c: any): boolean {
  if (c.req.query('spread') === '1') return true;
  const accept = c.req.header('Accept') || c.req.header('accept') || '';
  if (/\btext\/html\b/i.test(accept)) return true;
  return false;
}

function b64url(s: string): string {
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

function escapeMarkdownInline(s: string): string {
  return String(s).replace(/[\[\]\n\r]/g, '');
}

function gradeColor(grade: string): string {
  const g = String(grade).toUpperCase();
  if (g === 'A' || g === 'A+') return '#2d9e4a';
  if (g === 'B') return '#5a7fd4';
  if (g === 'C') return '#d4a017';
  if (g === 'D') return '#d46b17';
  return '#c0392b';
}

function renderSpreadHtml(target: string, audit: any, rawPayload: object): string {
  const hostname = new URL(target).hostname;
  const displayName = (audit?.card?.name) ? String(audit.card.name) : hostname;
  const grade = String(audit?.grade ?? '?');
  const scores = audit?.scores ?? {};
  const overall = scores.overall ?? 0;
  const l1 = scores.L1_identity ?? scores.l1 ?? 0;
  const l2 = scores.L2_authentication ?? scores.l2 ?? 0;
  const l3 = scores.L3_authorization ?? scores.l3 ?? 0;
  const l4 = scores.L4_behavioral ?? scores.l4 ?? 0;
  const slug = b64url(target);
  const tweetText = `I audited my A2A agent on @agentlair_dev — grade ${grade}, ${overall}/100. Audit yours: agentlair.dev/a2a-audit`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>A2A Trust Audit — ${escapeHtml(hostname)} — agentlair.dev</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,follow">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 1.5rem; color: #1a1a1a; line-height: 1.5; }
    header { font-size: 1rem; margin-bottom: 1rem; padding: 0.75rem; background: #f5f7ff; border-left: 3px solid #4c6ef5; border-radius: 0 4px 4px 0; }
    .grade { display: inline-block; padding: 2px 10px; border-radius: 10px; color: #fff; font-weight: 700; background: ${gradeColor(grade)}; }
    section[data-spread] { margin: 1.5rem 0; }
    section[data-spread] > a, section[data-spread] > details { display: block; margin: 0.5rem 0; }
    pre[data-raw-json] { background: #f5f5f5; padding: 0.75rem; font-size: 0.75rem; max-height: 300px; overflow: auto; border-radius: 4px; white-space: pre-wrap; word-break: break-all; }
    details summary { cursor: pointer; font-weight: 600; color: #555; }
    pre code { display: block; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <header>
    Grade: <span class="grade">${escapeHtml(grade)}</span> &middot; Score: ${overall}/100 &middot; Layers: L1=${l1} L2=${l2} L3=${l3} L4=${l4}
  </header>
  <section data-spread>
    <a href="/a2a/${slug}">View this audit on AgentLair</a>
    <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}">Tweet your grade</a>
    <details>
      <summary>Embed your trust badge</summary>
      <pre><code>![AgentLair L4 — ${escapeHtml(escapeMarkdownInline(displayName))}](https://agentlair.dev/badge/a2a/${slug}.svg)
[${escapeHtml(escapeMarkdownInline(displayName))} on AgentLair Leaderboard](https://agentlair.dev/leaderboard/a2a)</code></pre>
    </details>
    <a href="/blog/agents-are-shrinking-trust-problem-isnt/">Improve your L4 →</a>
  </section>
  <pre data-raw-json>${escapeHtml(JSON.stringify(rawPayload))}</pre>
</body>
</html>`;
}

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
    p.lede{font-size:1rem;background:#f5f7ff;border-left:3px solid #4c6ef5;padding:.75rem;border-radius:0 4px 4px 0;margin-bottom:1rem}
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
    #grade-card{display:flex;align-items:center;gap:.75rem;padding:.75rem;background:#fff;border:1px solid #ddd;border-radius:4px;margin-bottom:.75rem}
    #grade-card .grade{font-size:2rem;font-weight:700;line-height:1;padding:.25rem .5rem;border-radius:4px;color:#fff}
    #grade-card .grade-A{background:#4caf50}
    #grade-card .grade-B{background:#8bc34a}
    #grade-card .grade-C{background:#ff9800}
    #grade-card .grade-D{background:#ff5722}
    #grade-card .grade-F{background:#f44336}
    #grade-card .summary{font-size:.95rem}
    #grade-card .summary strong{font-size:1.1rem}
    #grade-card .breakdown{display:block;margin-top:.25rem;font-size:.8rem;color:#666;font-variant-numeric:tabular-nums}
    #permalink-row{margin-bottom:.5rem;font-size:.9rem}
    #permalink-row a{color:#1a1a1a;text-decoration:underline;margin-right:.5rem}
    #share-row{display:flex;gap:.5rem;margin-bottom:1rem}
    .share-btn{padding:.5rem .75rem;border-radius:4px;text-decoration:none;font-size:.85rem;color:#fff;display:inline-block}
    .share-x{background:#000}
    .share-fc{background:#7c65c1}
    .copy-btn{padding:.25rem .5rem;background:#eee;border:1px solid #ccc;border-radius:4px;font-size:.8rem;cursor:pointer}
    .copy-btn:hover{background:#ddd}
    .embed-row{margin:.5rem 0;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
    .embed-row label{font-size:.8rem;font-weight:600;width:5rem;flex-shrink:0;margin-bottom:0}
    .embed-row code{flex:1;font-size:.75rem;background:#f5f5f5;padding:.4rem;border-radius:4px;word-break:break-all;min-width:0}
    #audit-another{margin-top:.75rem;background:#1a1a1a;color:#fff;padding:.5rem 1rem;border:none;border-radius:4px;cursor:pointer;font-size:.9rem}
    #audit-another:hover{background:#000}
    details summary{cursor:pointer;font-size:.9rem;font-weight:600;padding:.25rem 0;color:#555}
    #copy-toast{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:.5rem 1rem;border-radius:4px;font-size:.85rem;z-index:1000}
    details.sample-panel summary{cursor:pointer;font-size:.9rem;font-weight:600;color:#555;padding:.5rem 0}
    details.sample-panel pre{background:#f5f5f5;padding:.75rem;font-size:.75rem;max-height:300px;overflow:auto;border-radius:4px}
    .sample-note{font-size:.8rem;color:#666;margin-top:.5rem}
    .checks-list{list-style:none;padding:0;margin:.5rem 0;font-size:.85rem}
    .checks-list li{padding:.25rem 0;border-bottom:1px solid #f0f0f0;display:flex;flex-direction:column;gap:.15rem}
    .checks-list li:last-child{border-bottom:none}
    .check-row{display:flex;align-items:baseline;gap:.4rem}
    .check-pass{color:#4caf50;font-size:.8rem;flex-shrink:0}
    .check-fail{color:#e74c3c;font-size:.8rem;flex-shrink:0}
    .check-name{flex:1}
    .check-severity{font-size:.75rem;color:#999;flex-shrink:0}
    .fix-hint{font-size:.8rem;color:#c0392b;padding-left:1.4rem}
    .fix-hint::before{content:"Fix: ";font-weight:600}
  </style>
</head>
<body>
  <header>
    <a href="/">agentlair.dev</a> · <a href="/blog/a2a-trust-leaderboard-may-2026/">leaderboard</a> · <a href="/blog/payment-rails-trust-rails/">why x402</a>
  </header>
  <main>
    <h1>A2A Trust Audit</h1>
    <p class="lede"><strong>Your AgentCard is your skin in the game.</strong> Integrators check it before they trust your agent. The audit grades L1 identity, L2 authentication, L3 authorization, and cross-org behavioral — and gives you an embeddable badge so integrators can see the score at a glance.</p>
    <p>Paste an A2A AgentCard URL. Get an L1–L4 audit with grade, score, and badge embed code. <strong>0.001 USDC per run</strong> via x402. The agentlair.dev self-card is a free demo.</p>
    <form id="audit-form">
      <label for="card-url">AgentCard URL</label>
      <input type="url" id="card-url" name="url" placeholder="https://example.com/.well-known/agent.json" required>
      <button type="submit">Run audit</button>
      <button type="button" id="demo-btn">Try demo (agentlair.dev)</button>
    </form>
    <details class="sample-panel">
      <summary>What does an audit look like?</summary>
      <pre>{
  "target": "https://agentlair.dev/.well-known/agent.json",
  "grade": "B",
  "scores": {
    "L1_identity": 100, "L2_authentication": 71,
    "L3_authorization": 100, "L4_behavioral": 87, "overall": 87
  },
  "checks": [
    {"id":"l1-name","layer":"L1","name":"Agent name declared","pass":true,"severity":"critical","detail":"Name: \\"AgentLair\\""},
    {"id":"l1-description","layer":"L1","name":"Description present","pass":true,"severity":"high","detail":"140 chars"},
    {"id":"l1-url","layer":"L1","name":"Base URL declared","pass":true,"severity":"critical","detail":"https://agentlair.dev"},
    {"id":"l1-https","layer":"L1","name":"HTTPS endpoint","pass":true,"severity":"critical","detail":"HTTPS"},
    {"id":"l1-version","layer":"L1","name":"Version specified","pass":true,"severity":"medium","detail":"v0.18.3"},
    {"id":"l1-contact","layer":"L1","name":"Contact information","pass":true,"severity":"low","detail":"Email: api@agentlair.dev"},
    {"id":"l1-provider","layer":"L1","name":"Provider/organization declared","pass":true,"severity":"medium","detail":"Org: Amdal Solutions AS"},
    {"id":"l1-did","layer":"L1","name":"DID (Decentralized Identifier)","pass":true,"severity":"high","detail":"DID present."},
    {"id":"l2-auth-declared","layer":"L2","name":"Authentication scheme declared","pass":true,"severity":"critical","detail":"Auth declared."},
    {"id":"l2-oauth","layer":"L2","name":"OAuth 2.0 or OpenID Connect","pass":false,"severity":"medium","detail":"No OAuth/OIDC."},
    {"id":"l2-jwks","layer":"L2","name":"JWKS endpoint referenced","pass":true,"severity":"high","detail":"JWKS: https://agentlair.dev/.well-known/jwks.json"},
    {"id":"l2-card-signed","layer":"L2","name":"Agent card is signed","pass":true,"severity":"critical","detail":"Legacy card_signature."},
    {"id":"l2-x402","layer":"L2","name":"x402 payment-gated (skin in the game)","pass":false,"severity":"high","detail":"No x402."},
    {"id":"l2-mtls","layer":"L2","name":"Mutual TLS support","pass":false,"severity":"low","detail":"No mTLS."},
    {"id":"l3-skills","layer":"L3","name":"Skills/capabilities defined","pass":true,"severity":"high","detail":"5 skills."},
    {"id":"l3-skill-ids","layer":"L3","name":"Skills have required fields","pass":true,"severity":"medium","detail":"All skills complete."},
    {"id":"l3-io-modes","layer":"L3","name":"Input/output modes specified","pass":true,"severity":"medium","detail":"I/O modes set."},
    {"id":"l3-capabilities","layer":"L3","name":"Capabilities explicitly declared","pass":true,"severity":"medium","detail":"Capabilities set."},
    {"id":"l4-trust-attestation","layer":"L4","name":"Trust attestation present","pass":true,"severity":"critical","detail":"Trust attestation declared."},
    {"id":"l4-audit-trail","layer":"L4","name":"Audit trail URL","pass":true,"severity":"high","detail":"Audit trail set."},
    {"id":"l4-behavioral-ref","layer":"L4","name":"Behavioral monitoring reference","pass":true,"severity":"high","detail":"Behavioral monitoring referenced."},
    {"id":"l4-delegation","layer":"L4","name":"Delegation/provenance chain","pass":false,"severity":"medium","detail":"No delegation chain."}
  ]
}</pre>
      <p class="sample-note">This is the live result for agentlair.dev's own AgentCard. Yours will return the same shape.</p>
    </details>
    <section id="result" hidden>
      <h2 id="result-heading">Result</h2>
      <div id="grade-card"><!-- runAudit fills this --></div>
      <div id="permalink-row">
        <a id="permalink-link" href="" target="_blank" rel="noopener">View on AgentLair</a>
        <button type="button" id="copy-permalink" class="copy-btn">Copy link</button>
      </div>
      <div id="share-row">
        <a id="share-x" href="" target="_blank" rel="noopener" class="share-btn share-x">Share on X</a>
        <a id="share-fc" href="" target="_blank" rel="noopener" class="share-btn share-fc">Cast on Farcaster</a>
      </div>
      <details id="embed-panel">
        <summary>Embed your badge</summary>
        <div class="embed-row">
          <label>Markdown</label>
          <code id="embed-md"></code>
          <button type="button" data-copy-target="embed-md" class="copy-btn">Copy</button>
        </div>
        <div class="embed-row">
          <label>HTML</label>
          <code id="embed-html"></code>
          <button type="button" data-copy-target="embed-html" class="copy-btn">Copy</button>
        </div>
        <div class="embed-row">
          <label>SVG</label>
          <code id="embed-svg"></code>
          <button type="button" data-copy-target="embed-svg" class="copy-btn">Copy</button>
        </div>
      </details>
      <details id="checks-detail-panel">
        <summary>All checks</summary>
        <ul id="checks-list" class="checks-list"><!-- renderSuccess fills this --></ul>
      </details>
      <details id="raw-json-panel">
        <summary>Raw audit JSON</summary>
        <pre id="result-json"></pre>
      </details>
      <button type="button" id="audit-another">Audit another card</button>
      <div id="copy-toast" hidden></div>
    </section>
    <div id="error-panel" hidden></div>
    <section id="x402-help">
      <h2>About x402 payments</h2>
      <p>x402 is the HTTP 402 Payment Required protocol — agents pay USDC on Base in response to a 402 challenge. Browsers can't pay x402 today; this form is for agents and CLI clients with a wallet. <a href="/blog/x402-settles-payment-agentlair-answers-who-pays/">Learn more</a></p>
    </section>
  </main>
  <footer>
    <a href="/blog/a2a-trust-leaderboard-may-2026/">All audited cards · methodology</a>
  </footer>
  <script>
(function(){
  var form=document.getElementById('audit-form');
  var input=document.getElementById('card-url');
  var demoBtn=document.getElementById('demo-btn');
  var resultEl=document.getElementById('result');
  var jsonEl=document.getElementById('result-json');
  var gradeCardEl=document.getElementById('grade-card');
  var permaEl=document.getElementById('permalink-link');
  var shareXEl=document.getElementById('share-x');
  var shareFcEl=document.getElementById('share-fc');
  var embedMdEl=document.getElementById('embed-md');
  var embedHtmlEl=document.getElementById('embed-html');
  var embedSvgEl=document.getElementById('embed-svg');
  var auditAnotherBtn=document.getElementById('audit-another');
  var copyPermalinkBtn=document.getElementById('copy-permalink');
  var copyToast=document.getElementById('copy-toast');
  var errorEl=document.getElementById('error-panel');
  var submitBtn=form.querySelector('button[type=submit]');
  var checksListEl=document.getElementById('checks-list');

  var REMEDIATIONS={
    'l1-name':"Add a 'name' field (≤64 chars) to your AgentCard.",
    'l1-description':"Add a 'description' field (50-300 chars) explaining what the agent does.",
    'l1-url':"Add a 'url' field with your agent's base endpoint URL.",
    'l1-https':"Change your 'url' to start with 'https://' — plaintext HTTP is not accepted.",
    'l1-version':"Add a 'version' field (e.g. '1.0.0') to your AgentCard.",
    'l1-contact':"Add a 'contact' object with 'email' or 'url' for vulnerability disclosure.",
    'l1-provider':"Add a 'provider' object with 'organization' and/or 'url' declaring the operator.",
    'l1-did':"Add a 'did' field like 'did:web:yourdomain.com' tied to your domain.",
    'l2-auth-declared':"Add an 'authentication' object with at least one entry in 'schemes' (e.g. 'bearer').",
    'l2-oauth':"Add 'oauth2' or 'openid_connect' to your authentication.schemes array.",
    'l2-jwks':"Add a 'jwks_uri' field pointing to /.well-known/jwks.json and serve your public signing keys there.",
    'l2-card-signed':"Sign your AgentCard with EdDSA and add a 'card_signature' field (compact JWS). See agentlair.dev/a2a-audit for tooling.",
    'l2-x402':"Add x402 payment gating to at least one skill endpoint — signals real skin in the game.",
    'l2-mtls':"Add 'mtls' to authentication.schemes if your endpoint supports mutual TLS client certificates.",
    'l3-skills':"Declare at least one capability under 'skills[]' with id, name, description, and tags.",
    'l3-skill-ids':"Each skill must have 'id', 'name', 'description', and 'tags' fields — all four are required.",
    'l3-io-modes':"Set 'defaultInputModes' and 'defaultOutputModes' to list supported MIME types (e.g. ['application/json']).",
    'l3-capabilities':"Add a 'capabilities' object declaring streaming, pushNotifications, and stateTransitionHistory booleans.",
    'l4-trust-attestation':"Add a 'trust_attestation' object with 'self_reported: true' and a 'trust_endpoint_template' URL.",
    'l4-audit-trail':"Add 'audit_trail_url_template' pointing to a verifiable per-request audit endpoint.",
    'l4-behavioral-ref':"Add a 'behavioral_monitoring' object referencing a runtime trust provider (provider, type, description).",
    'l4-delegation':"Add a 'delegation' or 'provenance' field with signed delegation tokens for agent-to-agent trust chains."
  };

  function b64url(s){return btoa(s).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_')}
  function escHtml(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

  function showToast(msg){
    copyToast.textContent=msg;copyToast.hidden=false;
    setTimeout(function(){copyToast.hidden=true},1200);
  }

  function copyText(text){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(
        function(){showToast('Copied!');},
        function(){fallbackCopy(text);}
      );
    }else{fallbackCopy(text);}
  }
  function fallbackCopy(text){
    var ta=document.createElement('textarea');
    ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');showToast('Copied!');}
    catch(e){showToast('Copy failed — select and Cmd+C');}
    finally{document.body.removeChild(ta);}
  }

  function showError(msg){
    errorEl.textContent=msg;errorEl.hidden=false;resultEl.hidden=true;
  }

  function getDomain(url){
    try{return new URL(url).hostname.toLowerCase();}catch(e){return url;}
  }

  function renderSuccess(audit,originalUrl){
    var grade=audit.grade||'F';
    var score=(audit.scores&&audit.scores.overall!=null)?audit.scores.overall:0;
    var l1=(audit.scores&&audit.scores.L1_identity!=null)?audit.scores.L1_identity:0;
    var l2=(audit.scores&&audit.scores.L2_authentication!=null)?audit.scores.L2_authentication:0;
    var l3=(audit.scores&&audit.scores.L3_authorization!=null)?audit.scores.L3_authorization:0;
    var l4=(audit.scores&&audit.scores.L4_behavioral!=null)?audit.scores.L4_behavioral:0;
    var domain=getDomain(originalUrl);
    var encoded=b64url(originalUrl);
    var permalink='https://agentlair.dev/a2a/'+encoded;
    var badgeUrl='https://agentlair.dev/badge/a2a/'+encoded;

    gradeCardEl.innerHTML=
      '<span class="grade grade-'+escHtml(grade)+'">'+escHtml(grade)+'</span>'+
      '<div class="summary"><strong>'+escHtml(score)+'/100</strong> overall'+
      '<span class="breakdown">L1='+escHtml(l1)+' L2='+escHtml(l2)+' L3='+escHtml(l3)+' L4='+escHtml(l4)+'</span></div>';

    permaEl.href=permalink;
    permaEl.textContent='View on AgentLair';
    copyPermalinkBtn.onclick=function(){copyText(permalink);};

    var xText='I audited my A2A agent card on @agentlair_dev — grade '+grade+', '+score+'/100. Audit yours: agentlair.dev/a2a-audit';
    var fcText='Audited '+domain+' — A2A trust grade '+grade+', '+score+'/100, L1 to L4 broken down. Run yours at agentlair.dev/a2a-audit';
    shareXEl.href='https://twitter.com/intent/tweet?text='+encodeURIComponent(xText);
    shareFcEl.href='https://warpcast.com/~/compose?text='+encodeURIComponent(fcText)+'&embeds[]='+encodeURIComponent(permalink);

    embedMdEl.textContent='![A2A Trust]('+badgeUrl+')';
    embedHtmlEl.textContent='<img src="'+badgeUrl+'" alt="A2A Trust audit badge">';
    embedSvgEl.textContent='<object data="'+badgeUrl+'" type="image/svg+xml" aria-label="A2A Trust audit badge"></object>';

    jsonEl.textContent=JSON.stringify(audit,null,2);

    // Render checks list with per-failed-check remediation hints
    var checks=audit.checks||[];
    var passCount=checks.filter(function(c){return c.pass;}).length;
    var failCount=checks.length-passCount;
    var checksSummaryEl=document.querySelector('#checks-detail-panel summary');
    if(checksSummaryEl)checksSummaryEl.textContent='All checks ('+checks.length+') — '+passCount+' passed, '+failCount+' failed';
    if(checksListEl){
      checksListEl.innerHTML=checks.map(function(c){
        var icon=c.pass
          ?'<span class="check-pass">✓</span>'
          :'<span class="check-fail">✗</span>';
        var fixHint=(c.pass||!REMEDIATIONS[c.id])
          ?''
          :'<div class="fix-hint">'+escHtml(REMEDIATIONS[c.id])+'</div>';
        return '<li>'
          +'<div class="check-row">'+icon+'<span class="check-name">'+escHtml(c.name)+'</span>'
          +'<span class="check-severity">'+escHtml(c.severity)+'</span></div>'
          +fixHint
          +'</li>';
      }).join('');
    }

    resultEl.hidden=false;
  }

  function resetForm(){
    resultEl.hidden=true;errorEl.hidden=true;
    input.value='';
    window.scrollTo(0,0);
    input.focus();
  }

  async function runAudit(url){
    submitBtn.disabled=true;demoBtn.disabled=true;
    errorEl.hidden=true;resultEl.hidden=true;
    try{
      var res=await fetch('/a2a-audit/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url})});
      var data=await res.json();
      if(res.status===200){
        renderSuccess(data.audit||data,url);
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

  document.querySelectorAll('.copy-btn[data-copy-target]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var t=document.getElementById(btn.getAttribute('data-copy-target'));
      if(t)copyText(t.textContent);
    });
  });

  auditAnotherBtn.addEventListener('click',resetForm);
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
    if (wantsHtml(c)) {
      const rawPayload = { audit, demo: true };
      return new Response(renderSpreadHtml(normalized, audit, rawPayload), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, max-age=60',
        },
      });
    }
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

  // 8. x402 verify (mirror routes/audit.ts:381–401)
  const cdpCreds = (c.env.CDP_API_KEY_ID && c.env.CDP_API_KEY_SECRET)
    ? { keyId: c.env.CDP_API_KEY_ID, keySecret: c.env.CDP_API_KEY_SECRET }
    : undefined;
  const verification = await verifyX402Payment(xPayment, SERVICE_PRICES.a2a_audit_run, cdpCreds);
  if (!verification.valid) {
    return make402Response(SERVICE_PRICES.a2a_audit_run, { payment_error: verification.error });
  }

  // 8b. Pre-flight reachability probe — HEAD target before settle to prevent settle-then-fail.
  // If the target is unreachable, return 402 without settling (refund-by-not-charging).
  // Special case: a 522 from a *.agentlair.dev subdomain means CF inside-zone routing failure
  // (the worker cannot fetch its own zone subdomains via public DNS). Return a clear error
  // so buyers don't lose payment — this is a structural limitation, not a transient error.
  {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let reachable = false;
    let headStatus: number | null = null;
    try {
      const headRes = await fetch(normalized, { method: 'HEAD', signal: controller.signal });
      headStatus = headRes.status;
      reachable = headRes.status < 400;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
    }
    if (!reachable) {
      const cfInsideZone = headStatus === 522 && normalizedHost.endsWith('.agentlair.dev');
      if (cfInsideZone) {
        return c.json({
          error: 'cf_inside_zone_limit',
          message: 'CF inside-zone fetch: this audit worker cannot fetch targets on the same Cloudflare zone (agentlair.dev subdomains). Audit from an external origin or use the free demo for agentlair.dev.',
        }, 400);
      }
      return make402Response(SERVICE_PRICES.a2a_audit_run, { payment_error: 'target_unreachable' });
    }
  }

  // 8c. x402 settle — only runs on reachable targets
  const settlement = await settleX402Payment(xPayment, SERVICE_PRICES.a2a_audit_run, verification.facilitatorUrl, cdpCreds);
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
      // Detect CF inside-zone 522: worker fetching its own zone subdomain via public DNS fails
      // with "Failed to fetch …: 522". Return 400 (not 502) since this is a client-correctable
      // issue — the target is unreachable from inside CF's zone, not a server fault.
      if (message.includes(': 522') && normalizedHost.endsWith('.agentlair.dev')) {
        return c.json({
          error: 'cf_inside_zone_limit',
          message: 'CF inside-zone fetch: this audit worker cannot fetch targets on the same Cloudflare zone (agentlair.dev subdomains). Audit from an external origin or use the free demo for agentlair.dev.',
          payment_receipt: settlement.receipt ?? null,
        }, 400, settlement.receipt ? { 'X-Payment-Response': settlement.receipt } : {});
      }
      // Change B: post-settle audit failure — include settlement receipt so buyer has in-band proof.
      // Decode txHash from receipt (receipt = btoa(JSON.stringify(facilitator response))).
      let settlement_tx: string | null = null;
      try {
        if (settlement.receipt) {
          const decoded = JSON.parse(atob(settlement.receipt)) as Record<string, unknown>;
          if (typeof decoded.txHash === 'string') settlement_tx = decoded.txHash;
        }
      } catch { /* receipt decode failure — omit tx */ }
      return c.json(
        {
          error: 'audit_failed',
          message,
          payment_receipt: settlement.receipt ?? null,
          settlement_tx,
          refund_note:
            'Payment settled on-chain before fetch failure. Contact api@agentlair.dev with tx hash for manual refund; auto-refund flow tracked in F1-followup.',
        },
        502,
        settlement.receipt ? { 'X-Payment-Response': settlement.receipt } : {},
      );
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
  if (wantsHtml(c)) {
    const rawPayload = { audit, payment_receipt: settlement.receipt, demo: false };
    const htmlHeaders: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    };
    if (settlement.receipt) {
      htmlHeaders['X-Payment-Response'] = settlement.receipt;
    }
    return new Response(renderSpreadHtml(normalized, audit, rawPayload), {
      status: 200,
      headers: htmlHeaders,
    });
  }
  return c.json({ audit, payment_receipt: settlement.receipt, demo: false });
});
