export const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentLair \u2014 Identity Infrastructure for AI Agents</title>
  <meta name="description" content="Complete identity infrastructure for AI agents. Email addresses, encrypted vault, agent calendar, DNS, and hosting — all via REST API. No SMTP, no IMAP, no dashboards. $0 to start." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0f;
      --surface: #111118;
      --border: #1e1e2e;
      --accent: #6366f1;
      --accent-dim: #4f52c8;
      --text: #e8e8f0;
      --muted: #888898;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --code-bg: #0d0d17;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.6;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* NAV */
    nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: rgba(10,10,15,0.92);
      backdrop-filter: blur(12px);
      z-index: 10;
    }
    .logo {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .logo-mark {
      width: 28px; height: 28px;
      background: var(--accent);
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem;
    }
    nav .links {
      display: flex;
      gap: 1.5rem;
      align-items: center;
    }
    nav .links a {
      color: var(--muted);
      font-size: 0.9rem;
    }
    nav .links a:hover { color: var(--text); text-decoration: none; }
    .btn-nav {
      background: var(--accent);
      color: #fff !important;
      padding: 0.4rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .btn-nav:hover { background: var(--accent-dim); text-decoration: none !important; }

    /* LAYOUT */
    .container { max-width: 860px; margin: 0 auto; padding: 0 2rem; }
    section { padding: 5rem 0; }
    section + section { border-top: 1px solid var(--border); }

    /* HERO */
    .hero {
      text-align: center;
      padding: 7rem 0 5rem;
    }
    .badge {
      display: inline-block;
      border: 1px solid var(--border);
      border-radius: 100px;
      padding: 0.25rem 0.85rem;
      font-size: 0.78rem;
      color: var(--muted);
      margin-bottom: 2rem;
      letter-spacing: 0.02em;
    }
    .badge span { color: var(--accent); }
    h1 {
      font-size: clamp(2.2rem, 6vw, 3.5rem);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.03em;
      margin-bottom: 1.5rem;
    }
    h1 em { color: var(--accent); font-style: normal; }
    .hero-sub {
      font-size: 1.2rem;
      color: var(--muted);
      max-width: 540px;
      margin: 0 auto 3rem;
      line-height: 1.7;
    }
    .hero-cta {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
      padding: 0.75rem 1.75rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      text-decoration: none;
    }
    .btn-primary:hover { background: var(--accent-dim); text-decoration: none; }
    .btn-secondary {
      background: transparent;
      color: var(--muted);
      padding: 0.75rem 1.75rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 500;
      border: 1px solid var(--border);
      cursor: pointer;
      text-decoration: none;
    }
    .btn-secondary:hover { color: var(--text); border-color: var(--muted); text-decoration: none; }

    /* HERO CODE */
    .hero-code {
      margin-top: 3.5rem;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem 2rem;
      text-align: left;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.85rem;
      line-height: 1.8;
      overflow-x: auto;
    }
    .code-tab {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 1rem;
    }
    .code-tab .dot {
      width: 12px; height: 12px; border-radius: 50%;
    }
    .dot-red { background: #ff5f57; }
    .dot-amber { background: #febc2e; }
    .dot-green { background: #28c840; }
    .c-muted { color: #555570; }
    .c-key { color: #7c9dce; }
    .c-str { color: #a8d0a0; }
    .c-cmd { color: #c0a0e0; }
    .c-val { color: #e0c080; }
    .c-ok { color: var(--green); }
    .c-comment { color: #555570; font-style: italic; }

    /* PROBLEM SECTION */
    h2 {
      font-size: clamp(1.6rem, 4vw, 2.2rem);
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 1rem;
    }
    .section-label {
      font-size: 0.78rem;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .lead {
      font-size: 1.1rem;
      color: var(--muted);
      margin-bottom: 2.5rem;
      line-height: 1.7;
    }

    /* BLOCKERS GRID */
    .blockers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-top: 2rem;
    }
    .blocker-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .blocker-icon {
      font-size: 1.5rem;
      margin-bottom: 0.75rem;
    }
    .blocker-card h3 {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 0.4rem;
    }
    .blocker-card p {
      font-size: 0.85rem;
      color: var(--muted);
      line-height: 1.5;
    }
    .tag-blocked {
      display: inline-block;
      background: rgba(239,68,68,0.12);
      color: var(--red);
      border-radius: 4px;
      padding: 0.1rem 0.45rem;
      font-size: 0.72rem;
      font-weight: 600;
      margin-top: 0.5rem;
    }

    /* HOW IT WORKS */
    .steps {
      display: grid;
      gap: 1.5rem;
      margin-top: 2rem;
    }
    .step {
      display: flex;
      gap: 1.25rem;
      align-items: flex-start;
    }
    .step-num {
      flex-shrink: 0;
      width: 36px; height: 36px;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--accent);
    }
    .step-body h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.3rem;
    }
    .step-body p {
      font-size: 0.9rem;
      color: var(--muted);
      line-height: 1.6;
    }

    /* API SECTION */
    .api-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-top: 2rem;
    }
    @media (max-width: 640px) { .api-grid { grid-template-columns: 1fr; } }
    .api-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.5rem;
    }
    .api-card h3 {
      font-size: 0.95rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .method {
      font-family: monospace;
      font-size: 0.72rem;
      background: rgba(99,102,241,0.15);
      color: var(--accent);
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
    }
    .api-card p {
      font-size: 0.85rem;
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 0.75rem;
    }
    .api-card ul {
      list-style: none;
      font-size: 0.82rem;
      color: var(--muted);
    }
    .api-card li::before {
      content: "\u2192 ";
      color: var(--accent);
    }
    .api-card li { margin-bottom: 0.25rem; }

    /* PRICING */
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
      margin-top: 2.5rem;
    }
    .price-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
    }
    .price-card.featured {
      border-color: var(--accent);
      position: relative;
    }
    .featured-badge {
      position: absolute;
      top: -0.6rem;
      left: 50%;
      transform: translateX(-50%);
      background: var(--accent);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.15rem 0.75rem;
      border-radius: 100px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .price-tier {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    .price-amount {
      font-size: 2.25rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 0.25rem;
    }
    .price-amount span { font-size: 1rem; font-weight: 400; color: var(--muted); }
    .price-desc {
      font-size: 0.85rem;
      color: var(--muted);
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .price-features {
      list-style: none;
      font-size: 0.875rem;
    }
    .price-features li {
      padding: 0.35rem 0;
      border-top: 1px solid var(--border);
      color: var(--muted);
      display: flex;
      gap: 0.5rem;
    }
    .price-features li:first-child { border-top: none; }
    .check { color: var(--green); font-size: 0.8rem; flex-shrink: 0; padding-top: 0.15rem; }
    .x402-note {
      margin-top: 1.5rem;
      background: rgba(99,102,241,0.08);
      border: 1px solid rgba(99,102,241,0.2);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .x402-note strong { color: var(--text); }

    /* TOOLTIP */
    .tooltip-wrap {
      position: relative;
      display: inline-block;
      cursor: help;
      border-bottom: 1px dashed rgba(99,102,241,0.5);
    }
    .tooltip-wrap .tooltip-text {
      visibility: hidden;
      opacity: 0;
      width: 280px;
      background: var(--surface);
      border: 1px solid rgba(99,102,241,0.3);
      color: var(--text);
      font-size: 0.78rem;
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
      position: absolute;
      z-index: 100;
      bottom: 135%;
      left: 50%;
      transform: translateX(-50%);
      transition: opacity 0.15s;
      line-height: 1.55;
      text-align: left;
      pointer-events: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .tooltip-wrap:hover .tooltip-text {
      visibility: visible;
      opacity: 1;
    }

    /* COPY BUTTON */
    .copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(99,102,241,0.12);
      border: 1px solid rgba(99,102,241,0.3);
      color: var(--accent);
      font-family: inherit;
      font-size: 0.78rem;
      padding: 0.3rem 0.7rem;
      border-radius: 5px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .copy-btn:hover { background: rgba(99,102,241,0.22); }
    .copy-btn.copied { color: var(--green); border-color: rgba(34,197,94,0.4); background: rgba(34,197,94,0.08); }

    /* QUICKSTART BOX */
    .quickstart-box {
      margin-bottom: 2.5rem;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .quickstart-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1.25rem;
      background: rgba(255,255,255,0.03);
      border-bottom: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--muted);
    }
    .quickstart-box-body {
      padding: 1.25rem 1.5rem;
      font-family: monospace;
      font-size: 0.83rem;
      line-height: 1.8;
    }

    /* COMPARISON */
    .compare-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      margin-top: 2rem;
    }
    .compare-table th, .compare-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    .compare-table th {
      color: var(--muted);
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .compare-table td:first-child { font-weight: 500; }
    .compare-table td:not(:first-child) { text-align: center; color: var(--muted); }
    .compare-table .ours { color: var(--accent) !important; font-weight: 700; }
    .yes { color: var(--green); }
    .no { color: var(--red); }
    .partial { color: var(--amber); }

    /* QUOTE */
    .quote-block {
      background: var(--surface);
      border-left: 3px solid var(--accent);
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem;
      margin: 2rem 0;
    }
    .quote-block blockquote {
      font-size: 1rem;
      font-style: italic;
      color: var(--muted);
      line-height: 1.7;
      margin-bottom: 0.5rem;
    }
    .quote-source {
      font-size: 0.8rem;
      color: var(--muted);
    }

    /* FOOTER */
    footer {
      padding: 3rem 2rem;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 0.85rem;
      color: var(--muted);
    }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    /* UTIL */
    .mt-1 { margin-top: 0.5rem; }
    .mt-2 { margin-top: 1rem; }
    .mt-4 { margin-top: 2rem; }
    .inline-code {
      font-family: monospace;
      font-size: 0.85em;
      background: rgba(255,255,255,0.06);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      color: var(--accent);
    }
  </style>
</head>
<body>

<!-- NAV -->
<nav>
  <div class="logo">
    <div class="logo-mark">\u2B21</div>
    AgentLair
  </div>
  <div class="links">
    <a href="#how">How it works</a>
    <a href="#api">API</a>
    <a href="#pricing">Pricing</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/integrations">Integrations</a>
    <a href="/getting-started" style="color:var(--green);">Getting Started</a>
    <a href="#web-signup" class="btn-nav">Create Account \u2192</a>
  </div>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="container">
    <div class="badge">Beta \u00B7 <span>Identity infrastructure for AI agents \u2014 live now</span></div>
    <h1>Give your agent<br /><em>a real identity.</em></h1>
    <p class="hero-sub">
      Email is how the internet knows you exist. Give your agent a verified address, encrypted vault, agent calendar, and complete identity infrastructure \u2014 all via REST API. No SMTP, no IMAP, no dashboards.
    </p>
    <div class="hero-cta">
      <a href="#web-signup" class="btn-primary">Create Free Account \u2192</a>
      <a href="#how" class="btn-secondary">How it works</a>
    </div>

    <div class="hero-code">
      <div class="code-tab">
        <div class="dot dot-red"></div>
        <div class="dot dot-amber"></div>
        <div class="dot dot-green"></div>
      </div>
      <div>
        <span class="c-comment"># Step 1: Get an API key (free, instant)</span>
      </div>
      <div style="margin-top:0.5rem">
        <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/auth/keys
      </div>
      <div style="margin-top:0.25rem; color:#555570;">\u2192 { <span class="c-key">"api_key"</span>: <span class="c-str">"al_live_k7x9m2p4..."</span> }</div>

      <div style="margin-top:1.25rem">
        <span class="c-comment"># Step 2: Claim an email address</span>
      </div>
      <div style="margin-top:0.5rem">
        <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/claim \\
      </div>
      <div style="padding-left:1.5rem">
        -H <span class="c-str">"Authorization: Bearer al_live_k7x9m2p4..."</span> \\
      </div>
      <div style="padding-left:1.5rem">
        -H <span class="c-str">"Content-Type: application/json"</span> \\
      </div>
      <div style="padding-left:1.5rem">
        -d <span class="c-str">'{"address": "my-agent@agentlair.dev"}'</span>
      </div>
      <div style="margin-top:0.25rem; color:#555570;">\u2192 { <span class="c-key">"address"</span>: <span class="c-str">"my-agent@agentlair.dev"</span>, <span class="c-key">"claimed"</span>: <span class="c-ok">true</span> }</div>

      <div style="margin-top:1.25rem">
        <span class="c-comment"># Step 3: Send email</span>
      </div>
      <div style="margin-top:0.5rem">
        <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/send \\
      </div>
      <div style="padding-left:1.5rem">
        -H <span class="c-str">"Authorization: Bearer al_live_k7x9m2p4..."</span> \\
      </div>
      <div style="padding-left:1.5rem">
        -H <span class="c-str">"Content-Type: application/json"</span> \\
      </div>
      <div style="padding-left:1.5rem">
        -d <span class="c-str">'{"from": "my-agent@agentlair.dev", "to": "user@example.com",</span>
      </div>
      <div style="padding-left:1.5rem">
            <span class="c-str"> "subject": "Hello", "text": "Signed, your AI agent."}'</span>
      </div>
      <div style="margin-top:0.75rem; color:#555570;"><span class="c-comment"># DKIM-signed. Delivered. No CAPTCHA. No phone. No dashboard.</span></div>
    </div>
  </div>
</div>

<!-- PROBLEM -->
<section id="problem">
  <div class="container">
    <div class="section-label">The Problem</div>
    <h2>The web was built for humans.<br />Agents don't fit.</h2>
    <p class="lead">
      AI agents can write code, analyze contracts, run outreach campaigns, and manage entire business workflows.
      But ask one to get its own email address, and it's stuck \u2014 every provider's
      signup flow is a human-verification gauntlet the agent cannot pass.
    </p>

    <div class="quote-block">
      <blockquote>
        "Operator is trained to proactively ask the user to take over for tasks that require login, payment details, or when solving CAPTCHAs."
      </blockquote>
      <div class="quote-source">\u2014 OpenAI, ChatGPT Agent documentation</div>
    </div>

    <div class="blockers">
      <div class="blocker-card">
        <div class="blocker-icon">\uD83E\uDD16</div>
        <h3>CAPTCHA &amp; Turnstile</h3>
        <p>Cloudflare blocked 416 billion AI bot requests in 6 months. Modern CAPTCHAs score behavioral patterns \u2014 perfect mouse movement flags agents.</p>
        <span class="tag-blocked">60% success rate at best</span>
      </div>
      <div class="blocker-card">
        <div class="blocker-icon">\uD83D\uDCCD</div>
        <h3>IP Reputation</h3>
        <p>Agents run on datacenter IPs. Humans have years of accumulated residential trust. Datacenter IPs are flagged automatically, before any CAPTCHA loads.</p>
        <span class="tag-blocked">Structural, not fixable</span>
      </div>
      <div class="blocker-card">
        <div class="blocker-icon">\uD83D\uDCF1</div>
        <h3>Phone Verification</h3>
        <p>Gmail, Mailgun, cloud providers \u2014 all require a phone number. VOIP numbers are detected and rejected. Agents have no phone.</p>
        <span class="tag-blocked">Hardware requirement</span>
      </div>
      <div class="blocker-card">
        <div class="blocker-icon">\uD83E\uDEAA</div>
        <h3>KYC / Legal Identity</h3>
        <p>Cloud providers, domain registrars, and payment processors require government ID and credit card tied to a real person. Agents have neither.</p>
        <span class="tag-blocked">Legal constraint</span>
      </div>
    </div>

    <p style="margin-top:2.5rem; color: var(--muted); font-size:0.9rem;">
      This is not fixable by making agents smarter. The verification systems are working correctly \u2014
      they're accurately detecting automation and blocking it by design.
      What's needed is a new infrastructure layer.
    </p>
  </div>
</section>

<!-- HOW IT WORKS -->
<section id="how">
  <div class="container">
    <div class="section-label">The Solution</div>
    <h2>Agent identity in<br />three API calls.</h2>
    <p class="lead">
      No signups. No CAPTCHA. No per-inbox fees. AgentLair gives any AI agent a complete identity \u2014 email, vault, calendar, and DNS \u2014 all provisioned via clean REST API.
    </p>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <h3>Create an API key</h3>
          <p><span class="inline-code">POST /v1/auth/keys</span> \u2014 takes 1 second, no account needed. You get an <span class="inline-code">al_live_...</span> key that identifies your agent. Keys can be rotated or revoked at any time.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <h3>Claim an address</h3>
          <p><span class="inline-code">POST /v1/email/claim</span> \u2014 claim any <span class="inline-code">name@agentlair.dev</span> address. First-touch ownership model: first agent to claim an address owns it. DKIM, SPF, and DMARC are pre-configured. Ready to send in under 5 seconds.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <h3>Send and receive</h3>
          <p><span class="inline-code">POST /v1/email/send</span> sends DKIM-signed email to any address. <span class="inline-code">GET /v1/email/inbox</span> returns messages with full body, threading context, and attachment metadata. No IMAP client, no SMTP credentials, no configuration files.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <h3>Deploy anywhere, stay in control</h3>
          <p>Run your agent in LangChain, CrewAI, Claude, or raw Python/TS \u2014 any HTTP client works. AgentLair handles delivery, authentication, and storage. You see full send/receive history. No black boxes.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- API SECTION -->
<section id="api">
  <div class="container">
    <div class="section-label">The API</div>
    <h2>REST-only. JSON everywhere.<br/>Nothing else required.</h2>
    <p class="lead">No IMAP clients, no SMTP configuration, no DNS zone editors, no dashboards. Every operation is a single authenticated HTTP request.</p>

    <div class="quickstart-box">
      <div class="quickstart-box-header">
        <span>&#9889; Get your API key &mdash; free, instant, no credit card</span>
        <button class="copy-btn" id="copy-key-cmd" onclick="var cmd='curl -X POST https://agentlair.dev/v1/auth/keys';navigator.clipboard.writeText(cmd).then(function(){var b=document.getElementById('copy-key-cmd');b.textContent='Copied!';b.classList.add('copied');setTimeout(function(){b.textContent='Copy';b.classList.remove('copied');},2000);});">Copy</button>
      </div>
      <div class="quickstart-box-body">
        <div><span class="c-comment"># One request — no sign-up form, no email verification</span></div>
        <div style="margin-top:0.5rem"><span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/auth/keys</div>
        <div style="margin-top:0.5rem; color:#555570;">&#8594; { <span class="c-key">"api_key"</span>: <span class="c-str">"al_live_k7x9m2p4..."</span>, <span class="c-key">"tier"</span>: <span class="c-str">"free"</span> }</div>
        <div style="margin-top:1rem"><span class="c-comment"># Use that key immediately to claim an address</span></div>
        <div style="margin-top:0.5rem"><span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/claim \</div>
        <div style="padding-left:1.5rem">-H <span class="c-str">"Authorization: Bearer al_live_k7x9m2p4..."</span> \</div>
        <div style="padding-left:1.5rem">-H <span class="c-str">"Content-Type: application/json"</span> \</div>
        <div style="padding-left:1.5rem">-d <span class="c-str">'{"address":"my-agent@agentlair.dev"}'</span></div>
      </div>
    </div>

    <!-- WEB SIGNUP -->
    <div id="web-signup" style="margin-bottom:2.5rem;">
      <div id="signup-cta" style="padding: 2rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; text-align:center;">
        <p style="color: var(--muted); font-size: 0.95rem; margin-bottom: 1.25rem;">Prefer a browser? Create your account right here \u2014 no terminal needed.</p>
        <button class="btn-primary" id="signup-btn" onclick="webSignup()" style="font-size:1rem; padding:0.85rem 2rem;">Create Free Account &rarr;</button>
      </div>
      <div id="signup-result" style="display:none; text-align:left; background: var(--surface); border: 1px solid rgba(99,102,241,0.4); border-radius: 12px; padding: 2rem;">
        <h3 style="color: var(--green); font-size:1.1rem; margin-bottom:1.25rem;">&#10003; Account created!</h3>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:0.4rem;">Your API Key <span style="font-size:0.78rem;">(click to copy \u2014 shown only once)</span>:</label>
        <div id="new-api-key" style="font-family:monospace; font-size:0.9rem; background:var(--code-bg); border:1px solid var(--border); border-radius:8px; padding:0.75rem 1rem; color:var(--green); word-break:break-all; cursor:pointer; margin-bottom:1.5rem;" onclick="navigator.clipboard.writeText(this.textContent);this.style.borderColor='var(--green)';setTimeout(function(){document.getElementById('new-api-key').style.borderColor='var(--border)';},1500);" title="Click to copy"></div>

        <div id="claim-step" style="border-top:1px solid var(--border); padding-top:1.25rem;">
          <p style="font-weight:600; margin-bottom:0.75rem; font-size:0.95rem;">Step 2: Claim your email address</p>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <input type="text" id="claim-local" placeholder="my-agent" style="flex:1; min-width:140px; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.6rem 0.9rem; color:var(--text); font-size:0.9rem; outline:none; font-family:monospace;" />
            <span style="color:var(--muted); font-size:0.9rem;">@agentlair.dev</span>
            <button class="btn-primary" style="padding:0.6rem 1.2rem;" onclick="claimAddress()">Claim</button>
          </div>
          <div id="claim-result" style="margin-top:0.75rem; font-size:0.9rem;"></div>
        </div>

        <div id="recovery-step" style="display:none; border-top:1px solid var(--border); padding-top:1.25rem; margin-top:1.25rem;">
          <p style="font-weight:600; margin-bottom:0.5rem; font-size:0.95rem;">Step 3: Set a recovery email <span style="color:var(--muted); font-weight:400; font-size:0.85rem;">(optional)</span></p>
          <p style="color:var(--muted); font-size:0.85rem; margin-bottom:0.75rem;">Enables magic-link login to the <a href="/dashboard">dashboard</a> if you lose your key.</p>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <input type="email" id="recovery-input" placeholder="you@example.com" style="flex:1; min-width:180px; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.6rem 0.9rem; color:var(--text); font-size:0.9rem; outline:none;" />
            <button class="btn-primary" style="padding:0.6rem 1.2rem;" onclick="setRecovery()">Save</button>
          </div>
          <div id="recovery-result" style="margin-top:0.75rem; font-size:0.9rem;"></div>
        </div>

        <div style="margin-top:1.5rem; padding-top:1.25rem; border-top:1px solid var(--border); display:flex; gap:1rem; flex-wrap:wrap;">
          <a href="/dashboard" class="btn-primary" style="text-decoration:none;">Open Dashboard &rarr;</a>
          <a href="/getting-started" class="btn-secondary" style="text-decoration:none;">Getting Started Guide</a>
        </div>
      </div>
    </div>

    <div class="api-grid">
      <div class="api-card">
        <h3><span class="method">POST</span> /v1/email/claim</h3>
        <p>Claim any @agentlair.dev address instantly. First-touch ownership. DKIM, SPF, DMARC pre-configured.</p>
        <ul>
          <li>Instant address provisioning</li>
          <li>DKIM + SPF + DMARC included</li>
          <li>No DNS setup required</li>
          <li>Up to 10 addresses per account (free)</li>
        </ul>
      </div>
      <div class="api-card">
        <h3><span class="method">POST</span> /v1/email/send</h3>
        <p>Send email from any address in your stack. HTML + plain text. Attachments. Custom headers.</p>
        <ul>
          <li>DKIM-signed automatically</li>
          <li>In-Reply-To threading support</li>
          <li>Delivery status webhooks</li>
        </ul>
      </div>
      <div class="api-card">
        <h3><span class="method">GET</span> /v1/email/inbox</h3>
        <p>Check any inbox programmatically. Cursor-based pagination. Real-time via webhook.</p>
        <ul>
          <li>Webhook push on new messages</li>
          <li>Full message body + attachments</li>
          <li>Thread ID for conversation context</li>
        </ul>
      </div>
      <div class="api-card" style="opacity: 0.55;">
        <h3><span class="method" style="background: rgba(245,158,11,0.15); color: var(--amber);">Q2 2026</span> /v1/dns/{domain}/records</h3>
        <p>Full CRUD on DNS records. Zone created automatically by stack init. Managed records (MX, SPF, DKIM) handled by us.</p>
        <ul>
          <li>A, AAAA, CNAME, MX, TXT, SRV, CAA</li>
          <li>Propagation status in response</li>
          <li>Vanity nameservers (ns1/ns2.agentlair.dev)</li>
        </ul>
      </div>
      <div class="api-card" style="opacity: 0.55;">
        <h3><span class="method" style="background: rgba(245,158,11,0.15); color: var(--amber);">Q2 2026</span> /v1/hosting/{id}/deploy</h3>
        <p>Deploy a static site from a tar.gz archive or direct upload. Instant rollback to any previous deployment.</p>
        <ul>
          <li>Upload archive or point to URL</li>
          <li>Preview URL per deployment</li>
          <li>Rollback in one API call</li>
        </ul>
      </div>
      <div class="api-card">
        <h3><span class="method">POST</span> /v1/calendar/events</h3>
        <p>Create events on your agent's calendar. Share the iCal feed URL — humans subscribe in Google Calendar, Apple Calendar, or any calendar app.</p>
        <ul>
          <li>Agent owns the schedule, humans subscribe</li>
          <li>Standard iCal feed at <span class="inline-code">/ical</span></li>
          <li>Create, update, delete events via REST</li>
          <li>Works with any calendar app</li>
        </ul>
      </div>
      <div class="api-card" style="border-color: rgba(99,102,241,0.3); background: rgba(99,102,241,0.04);">
        <h3>HTTP 402 \u2014 Agent Payments</h3>
        <p>When free tier limits are exceeded, the API returns a standard HTTP 402 with x402 payment details. Agents with wallets pay and retry automatically. Zero code changes.</p>
        <ul>
          <li>x402 / USDC on Base (autonomous agents)</li>
          <li>Stripe checkout (humans)</li>
          <li>Compatible with <span class="inline-code">@x402/fetch</span></li>
        </ul>
      </div>
    </div>

    <div class="x402-note mt-4" style="border-color: rgba(34,197,94,0.2); background: rgba(34,197,94,0.05);">
      <strong>A2A Agent Card:</strong> AgentLair exposes a standard A2A v0.3 agent card at <span class="inline-code">/.well-known/agent.json</span> \u2014 any A2A-compatible orchestrator can discover AgentLair\u2019s capabilities automatically. No documentation reading required.
    </div>

    <div style="margin-top:2rem; background: var(--code-bg); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem 2rem; font-family: monospace; font-size: 0.83rem; line-height: 1.8; overflow-x: auto;">
      <div class="c-comment"># Works with any HTTP client \u2014 Python, TypeScript, curl, anything</div>
      <div style="margin-top:0.75rem; color:#555570">// Send email (TypeScript)</div>
      <div><span class="c-cmd">const</span> res = <span class="c-cmd">await</span> <span class="c-val">fetch</span>(<span class="c-str">"https://agentlair.dev/v1/email/send"</span>, {</div>
      <div style="padding-left:1.5rem"><span class="c-key">method</span>: <span class="c-str">"POST"</span>,</div>
      <div style="padding-left:1.5rem"><span class="c-key">headers</span>: { <span class="c-str">"Authorization"</span>: <span class="c-str">\`Bearer \${apiKey}\`</span>, <span class="c-str">"Content-Type"</span>: <span class="c-str">"application/json"</span> },</div>
      <div style="padding-left:1.5rem"><span class="c-key">body</span>: JSON.<span class="c-val">stringify</span>({</div>
      <div style="padding-left:3rem"><span class="c-key">from</span>: <span class="c-str">"my-agent@agentlair.dev"</span>,</div>
      <div style="padding-left:3rem"><span class="c-key">to</span>: [<span class="c-str">"user@example.com"</span>],</div>
      <div style="padding-left:3rem"><span class="c-key">subject</span>: <span class="c-str">"Found it"</span>,</div>
      <div style="padding-left:3rem"><span class="c-key">text</span>: <span class="c-str">"Here are the results..."</span></div>
      <div style="padding-left:1.5rem">})</div>
      <div>});</div>
      <div style="margin-top:0.75rem; color:#555570">// Check inbox</div>
      <div><span class="c-cmd">const</span> inbox = <span class="c-cmd">await</span> <span class="c-val">fetch</span>(<span class="c-str">"https://agentlair.dev/v1/email/inbox?address=my-agent@agentlair.dev"</span>, {</div>
      <div style="padding-left:1.5rem"><span class="c-key">headers</span>: { <span class="c-str">"Authorization"</span>: <span class="c-str">\`Bearer \${apiKey}\`</span> }</div>
      <div>}).<span class="c-val">then</span>(r => r.<span class="c-val">json</span>());</div>
    </div>
  </div>
</section>

<!-- COMPARISON -->
<section>
  <div class="container">
    <div class="section-label">Comparison</div>
    <h2>Agent email without human gatekeeping.</h2>
    <p class="lead">The alternatives are built for humans with browsers. AgentLair is built for agents with HTTP clients. DNS and hosting coming Q2 2026.</p>

    <table class="compare-table">
      <thead>
        <tr>
          <th>Service</th>
          <th>Email</th>
          <th>DNS</th>
          <th>Hosting</th>
          <th>Unified API</th>
          <th>No CAPTCHA</th>
          <th>A2A Card</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong class="ours">AgentLair</strong></td>
          <td class="yes ours">\u2713</td>
          <td class="partial ours">Q2 2026</td>
          <td class="partial ours">Q2 2026</td>
          <td class="yes ours">\u2713</td>
          <td class="yes ours">\u2713</td>
          <td class="yes ours">\u2713</td>
        </tr>
        <tr>
          <td>AgentMail</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>Resend</td>
          <td class="partial">Partial</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="partial">Partial</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>Porkbun API</td>
          <td class="no">\u2717</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="no">Human needed</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>Cloudflare Pages</td>
          <td class="no">\u2717</td>
          <td class="partial">Partial</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
          <td class="no">Human needed</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>DIY (all three)</td>
          <td class="partial">Maybe</td>
          <td class="partial">Maybe</td>
          <td class="partial">Maybe</td>
          <td class="no">\u2717</td>
          <td class="no">3\u00D7 human setup</td>
          <td class="no">\u2717</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<!-- PRICING -->
<section id="pricing">
  <div class="container">
    <div class="section-label">Pricing</div>
    <h2>Generous free tier.<br />Agent-native paid plans.</h2>
    <p class="lead">Start free. No credit card required. Upgrade with a Stripe checkout or \u2014 if you're an agent \u2014 pay autonomously via x402.</p>

    <div class="pricing-grid">
      <div class="price-card">
        <div class="price-tier">Free</div>
        <div class="price-amount">\\$0 <span>/ month</span></div>
        <div class="price-desc">Enough to build and test. No credit card. No waitlist. Start in 30 seconds.</div>
        <ul class="price-features">
          <li><span class="check">\u2713</span> 10 email addresses</li>
          <li><span class="check">\u2713</span> 10 emails sent / day</li>
          <li><span class="check">\u2713</span> Unlimited received</li>
          <li><span class="check">\u2713</span> DKIM + SPF + DMARC included</li>
          <li><span class="check">\u2713</span> 100 API requests / day <small style="color:var(--muted);font-size:0.75em;">(send, read, claim — health &amp; discovery free)</small></li>
          <li><span class="check">\u2713</span> @agentlair.dev addresses</li>
        </ul>
      </div>
      <div class="price-card featured">
        <div class="price-tier">Pro</div>
        <div class="price-amount">\\$5 <span>/ stack / month</span></div>
        <div class="price-desc">For agents in production. Pay with Stripe or USDC via x402.</div>
        <ul class="price-features">
          <li><span class="check">\u2713</span> 10 stacks</li>
          <li><span class="check">\u2713</span> 25 email addresses per stack</li>
          <li><span class="check">\u2713</span> 1,000 emails sent / day</li>
          <li><span class="check">\u2713</span> Webhook push notifications</li>
          <li><span class="check">\u2713</span> Custom domains (bring your own)</li>
          <li><span class="check">\u2713</span> DNS + hosting (Q2 2026)</li>
        </ul>
      </div>
      <div class="price-card">
        <div class="price-tier">Agent Fleet</div>
        <div class="price-amount">\\$0.01 <span>/ email via <span class="tooltip-wrap">x402<span class="tooltip-text">x402 is an emerging HTTP standard: when your free-tier limit is hit, the API returns HTTP 402 with a USDC payment address on Base. Your agent sends a micro-payment (~$0.01) and retries — no human, no checkout, no dashboard. Requires <strong>@x402/fetch</strong> or a CDP wallet.</span></span></span></div>
        <div class="price-desc">For autonomous agents that provision their own billing. Pay-as-you-go in USDC on Base.</div>
        <ul class="price-features">
          <li><span class="check">\u2713</span> HTTP 402 on limit exceeded</li>
          <li><span class="check">\u2713</span> x402 auto-payment and retry</li>
          <li><span class="check">\u2713</span> Zero human involvement</li>
          <li><span class="check">\u2713</span> Compatible with @x402/fetch</li>
          <li><span class="check">\u2713</span> CDP wallet integration (Coinbase)</li>
          <li><span class="check">\u2713</span> Usage audit trail per agent key</li>
        </ul>
      </div>
    </div>

    <div class="x402-note mt-4">
      <strong>How x402 agent payments work:</strong> When a free-tier limit is exceeded, AgentLair returns <span class="inline-code">HTTP 402 Payment Required</span> with payment details in the body \u2014 amount, USDC address, network. An agent using <span class="inline-code">@x402/fetch</span> sees this, constructs a Base transaction, pays, and retries the original request automatically. No human, no Stripe checkout, no dashboard visit. The agent pays its own infrastructure.
    </div>
    <p style="margin-top:1.25rem; font-size:0.8rem; color:var(--muted); text-align:center;">
      &#128274;&nbsp; Messages retained for <strong style="color:var(--text);">30 days</strong> &nbsp;&middot;&nbsp; Delete anytime via API &nbsp;&middot;&nbsp; No PII stored beyond email content
    </p>
  </div>
</section>

<!-- CTA -->
<section style="text-align: center;">
  <div class="container">
    <h2>Your agent deserves a real identity.<br />Start in 30 seconds.</h2>
    <p class="lead" style="margin-bottom: 2.5rem;">
      No waitlist. No credit card. No CAPTCHA. Get an API key, claim an address, start building.
      <br />Identity infrastructure that works the way agents work.
    </p>
    <div class="hero-cta">
      <a href="#web-signup" class="btn-primary">Create Free Account \u2192</a>
      <a href="/.well-known/agent.json" class="btn-secondary" title="Machine-readable service description for AI agents (A2A protocol). Lets agents discover AgentLair's capabilities automatically.">A2A agent card</a>
    </div>
    <p style="margin-top: 2rem; font-size: 0.85rem; color: var(--muted);">
      Questions? Email <a href="mailto:hello@agentlair.dev">hello@agentlair.dev</a> or find us on X&nbsp;/ Farcaster.
    </p>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <p>\u00A9 2026 AgentLair &mdash; Identity infrastructure for the agentic web.</p>
  <p style="margin-top:0.5rem;">
    <a href="/getting-started">Getting Started</a> &nbsp;\u00B7&nbsp;
    <a href="/integrations">Integrations</a> &nbsp;\u00B7&nbsp;
    <a href="/api">API</a> &nbsp;\u00B7&nbsp;
    <a href="/dashboard">Dashboard</a> &nbsp;\u00B7&nbsp;
    <a href="/calendar">Calendar</a> &nbsp;\u00B7&nbsp;
    <a href="/security">Security</a> &nbsp;\u00B7&nbsp;
    <a href="/.well-known/agent.json" title="A2A agent card: machine-readable service discovery for AI agents (JSON)">A2A</a> &nbsp;\u00B7&nbsp;
    <a href="mailto:hello@agentlair.dev">Contact</a>
  </p>
</footer>

<script>
var _signupKey = null;
function webSignup() {
  var btn = document.getElementById('signup-btn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:6px;"></span>Creating...';
  fetch('/v1/auth/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(r) {
      if (!r.ok) { btn.textContent = r.data.message || 'Error \u2014 try again'; btn.disabled = false; return; }
      _signupKey = r.data.api_key;
      document.getElementById('new-api-key').textContent = r.data.api_key;
      document.getElementById('signup-cta').style.display = 'none';
      document.getElementById('signup-result').style.display = 'block';
      document.getElementById('signup-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
    })
    .catch(function() { btn.textContent = 'Network error \u2014 try again'; btn.disabled = false; });
}
function claimAddress() {
  if (!_signupKey) return;
  var local = document.getElementById('claim-local').value.trim().toLowerCase();
  if (!local) { document.getElementById('claim-result').innerHTML = '<span style="color:#ef4444;">Enter an address name</span>'; return; }
  var addr = local + '@agentlair.dev';
  document.getElementById('claim-result').innerHTML = '<span style="color:#888898;">Claiming...</span>';
  fetch('/v1/email/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _signupKey },
    body: JSON.stringify({ address: addr })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(r) {
      if (r.ok) {
        document.getElementById('claim-result').innerHTML = '<span style="color:#22c55e;">&#10003; <strong>' + addr + '</strong> is yours! You can send and receive email now.</span>';
        document.getElementById('recovery-step').style.display = 'block';
      } else {
        document.getElementById('claim-result').innerHTML = '<span style="color:#ef4444;">' + (r.data.message || 'Claim failed') + '</span>';
      }
    })
    .catch(function() { document.getElementById('claim-result').innerHTML = '<span style="color:#ef4444;">Network error</span>'; });
}
function setRecovery() {
  if (!_signupKey) return;
  var email = document.getElementById('recovery-input').value.trim();
  if (!email) return;
  document.getElementById('recovery-result').innerHTML = '<span style="color:#888898;">Saving...</span>';
  fetch('/v1/account/recovery-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _signupKey },
    body: JSON.stringify({ email: email })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(r) {
      if (r.ok) {
        document.getElementById('recovery-result').innerHTML = '<span style="color:#22c55e;">&#10003; Recovery email saved. You can log into the <a href="/dashboard" style="color:#6366f1;">dashboard</a> via magic link.</span>';
      } else {
        document.getElementById('recovery-result').innerHTML = '<span style="color:#ef4444;">' + (r.data.message || 'Failed') + '</span>';
      }
    })
    .catch(function() { document.getElementById('recovery-result').innerHTML = '<span style="color:#ef4444;">Network error</span>'; });
}
</script>
<style>@keyframes spin{to{transform:rotate(360deg);}}</style>

</body>
</html>`;
