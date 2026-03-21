export const GETTING_STARTED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Getting Started \u2014 AgentLair</title>
  <meta name="description" content="Set up your AI agent's email in under 2 minutes. Step-by-step guide for both browser and API." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --bg: #0a0a0f; --surface: #111118; --border: #1e1e2e; --accent: #6366f1; --accent-dim: #4f52c8; --text: #e8e8f0; --muted: #888898; --green: #22c55e; --red: #ef4444; --code-bg: #0d0d17; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.7; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 2rem; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(10,10,15,0.95); backdrop-filter: blur(12px); z-index: 10; }
    .logo { font-size: 1.15rem; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 0.5rem; text-decoration: none; }
    .logo-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; }
    nav .links { display: flex; gap: 1.5rem; align-items: center; }
    nav .links a { color: var(--muted); font-size: 0.9rem; }
    .container { max-width: 720px; margin: 0 auto; padding: 3rem 2rem; }
    h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.75rem; }
    h1 em { color: var(--accent); font-style: normal; }
    .subtitle { font-size: 1.1rem; color: var(--muted); margin-bottom: 3rem; }
    .step-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem; margin-bottom: 1.5rem; }
    .step-number { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); border-radius: 8px; font-weight: 700; font-size: 0.9rem; color: var(--accent); margin-right: 0.75rem; flex-shrink: 0; }
    .step-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; display: flex; align-items: center; }
    .step-desc { color: var(--muted); font-size: 0.95rem; margin-bottom: 1rem; }
    .method-tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .method-tab { padding: 0.4rem 0.85rem; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted); }
    .method-tab.active { background: rgba(99,102,241,0.15); border-color: var(--accent); color: var(--accent); }
    .code-block { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 0.83rem; line-height: 1.7; overflow-x: auto; margin-bottom: 0.75rem; }
    .c-muted { color: #555570; } .c-cmd { color: #c0a0e0; } .c-str { color: #a8d0a0; } .c-key { color: #7c9dce; } .c-ok { color: var(--green); }
    .web-path { background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.2); border-radius: 8px; padding: 1rem 1.25rem; font-size: 0.9rem; }
    .web-path strong { color: var(--green); }
    .tip { background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: 8px; padding: 1rem 1.25rem; font-size: 0.88rem; color: var(--muted); margin-top: 1rem; }
    .tip strong { color: var(--text); }
    .next-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem; }
    @media (max-width: 560px) { .next-steps { grid-template-columns: 1fr; } }
    .next-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; text-decoration: none; transition: border-color 0.15s; }
    .next-card:hover { border-color: var(--accent); text-decoration: none; }
    .next-card h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.4rem; color: var(--text); }
    .next-card p { font-size: 0.85rem; color: var(--muted); }
    footer { padding: 3rem 2rem; border-top: 1px solid var(--border); text-align: center; font-size: 0.85rem; color: var(--muted); margin-top: 2rem; }
    footer a { color: var(--muted); }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><div class="logo-mark">\u2B21</div> AgentLair</a>
  <div class="links">
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/security">Security</a>
    <a href="/integrations">Integrations</a>
  </div>
</nav>

<div class="container">
  <h1>Getting Started with <em>AgentLair</em></h1>
  <p class="subtitle">Set up your agent's email in under 2 minutes. Works from browser or terminal.</p>

  <!-- STEP 1 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">1</span> Create your account</div>
    <p class="step-desc">Get an API key that identifies your agent. No email, no credit card, no verification.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> Go to the <a href="/#web-signup">homepage signup</a> and click <strong>"Create Free Account"</strong>. Your key appears immediately.
    </div>

    <div class="code-block">
      <span class="c-muted"># Terminal:</span><br/>
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/auth/keys<br/>
      <span class="c-muted">\u2192 { "api_key": "al_live_k7x9m2p4...", "tier": "free" }</span>
    </div>

    <div class="tip">
      <strong>\u26A0\uFE0F Save your API key!</strong> It's shown only once. If you lose it, set a recovery email (step 4) to regain access via the dashboard.
    </div>
  </div>

  <!-- STEP 2 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">2</span> Claim an email address</div>
    <p class="step-desc">Pick any available <code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">name@agentlair.dev</code> address. First come, first served.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> After creating your account on the homepage, the claim form appears automatically. Or use the <a href="/dashboard">dashboard</a> \u2192 "Claim New Address".
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/claim \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span> \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Content-Type: application/json"</span> \\<br/>
      &nbsp;&nbsp;-d <span class="c-str">'{"address": "my-agent@agentlair.dev"}'</span><br/>
      <span class="c-muted">\u2192 { "address": "my-agent@agentlair.dev", "claimed": true }</span>
    </div>

    <div class="tip">
      <strong>Naming tips:</strong> Use descriptive names like <code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">research-agent</code>, <code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">outreach-bot</code>, or your project name. You get 10 addresses on the free tier.
    </div>
  </div>

  <!-- STEP 3 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">3</span> Send your first email</div>
    <p class="step-desc">Send a test email to yourself to verify everything works.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> Open the <a href="/dashboard">dashboard</a>, find the <strong>Compose Email</strong> section, fill in the form, and click <strong>Send</strong>.
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/send \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span> \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Content-Type: application/json"</span> \\<br/>
      &nbsp;&nbsp;-d <span class="c-str">'{"from": "my-agent@agentlair.dev",</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"to": ["your-real-email@gmail.com"],</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"subject": "Hello from AgentLair!",</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"text": "This is my agent speaking."}'</span>
    </div>
  </div>

  <!-- STEP 4 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">4</span> Check your inbox</div>
    <p class="step-desc">Reply to the email you just sent, then check your agent's inbox.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> The <a href="/dashboard">dashboard</a> shows your inbox under each address. Click a message to read it.
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> https://agentlair.dev/v1/email/inbox?address=my-agent@agentlair.dev \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span>
    </div>
  </div>

  <!-- STEP 5 (optional) -->
  <div class="step-card" style="border-color: rgba(99,102,241,0.3);">
    <div class="step-title"><span class="step-number">\u2606</span> Set a recovery email <span style="color:var(--muted); font-weight:400; font-size:0.85rem; margin-left:0.5rem;">(recommended)</span></div>
    <p class="step-desc">Attach a personal email to your account. This enables magic-link dashboard login and key recovery.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> On the <a href="/dashboard">dashboard</a>, click <strong>"Update recovery email"</strong> in the account card.
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/account/recovery-email \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span> \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Content-Type: application/json"</span> \\<br/>
      &nbsp;&nbsp;-d <span class="c-str">'{"email": "you@example.com"}'</span>
    </div>
  </div>

  <!-- STEP 6 (optional) -->
  <div class="step-card" style="border-color: rgba(99,102,241,0.3);">
    <div class="step-title"><span class="step-number">\u2606</span> Store secrets in Vault <span style="color:var(--muted); font-weight:400; font-size:0.85rem; margin-left:0.5rem;">(optional)</span></div>
    <p class="step-desc">Keep your agent's API keys and credentials safe across container restarts. Client-side encrypted &mdash; AgentLair never sees the plaintext.</p>


    <div class="code-block">
      <span class="c-muted"># Install the crypto library (zero dependencies)</span><br/>
      <span class="c-cmd">npm</span> install @agentlair/vault-crypto
    </div>

    <div class="code-block">
      <span class="c-muted">// Encrypt &rarr; store &rarr; retrieve &rarr; decrypt</span><br/>
      <span class="c-key">import</span> { VaultCrypto } <span class="c-key">from</span> <span class="c-str">'@agentlair/vault-crypto'</span>;<br/><br/>
      <span class="c-key">const</span> seed = VaultCrypto.generateSeed();<br/>
      <span class="c-key">const</span> vc = VaultCrypto.fromSeed(seed);<br/><br/>
      <span class="c-muted">// Encrypt before storing</span><br/>
      <span class="c-key">const</span> ct = <span class="c-key">await</span> vc.encrypt(<span class="c-str">'sk-openai-abc123'</span>, <span class="c-str">'openai-key'</span>);<br/>
      <span class="c-key">await</span> fetch(<span class="c-str">'https://agentlair.dev/v1/vault/openai-key'</span>, {<br/>
      &nbsp;&nbsp;method: <span class="c-str">'PUT'</span>,<br/>
      &nbsp;&nbsp;headers: { <span class="c-str">'Authorization'</span>: <span class="c-str">\`Bearer \${apiKey}\`</span>, <span class="c-str">'Content-Type'</span>: <span class="c-str">'application/json'</span> },<br/>
      &nbsp;&nbsp;body: JSON.stringify({ ciphertext: ct }),<br/>
      });<br/><br/>
      <span class="c-muted">// Retrieve and decrypt</span><br/>
      <span class="c-key">const</span> res = <span class="c-key">await</span> fetch(<span class="c-str">'https://agentlair.dev/v1/vault/openai-key'</span>, {<br/>
      &nbsp;&nbsp;headers: { <span class="c-str">'Authorization'</span>: <span class="c-str">\`Bearer \${apiKey}\`</span> },<br/>
      });<br/>
      <span class="c-key">const</span> plain = <span class="c-key">await</span> vc.decrypt((<span class="c-key">await</span> res.json()).ciphertext, <span class="c-str">'openai-key'</span>);
    </div>

    <div class="tip">
      <strong>Tip:</strong> Save the hex seed (<code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">vc.seedHex()</code>) in an env var. Or use <code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">encryptSeedBackup()</code> with a passphrase for recovery.
      <a href="/vault">Learn more about Vault &rarr;</a>
    </div>
  </div>

  <!-- STEP 7 (optional) -->
  <div class="step-card" style="border-color: rgba(99,102,241,0.3);">
    <div class="step-title"><span class="step-number">\u2606</span> Set up your Agent Calendar <span style="color:var(--muted); font-weight:400; font-size:0.85rem; margin-left:0.5rem;">(optional)</span></div>
    <p class="step-desc">Every agent address has a built-in calendar. Create events via REST, then share a public iCal URL &mdash; humans subscribe in Google Calendar, Apple Calendar, or any calendar app. The agent owns the schedule; humans just follow it.</p>

    <div class="code-block">
      <span class="c-muted"># Create an event</span><br/>
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/calendar/events \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span> \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Content-Type: application/json"</span> \\<br/>
      &nbsp;&nbsp;-d <span class="c-str">'{"address": "my-agent@agentlair.dev",</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"title": "Weekly sync",</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"start": "2026-04-01T10:00:00Z",</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"end": "2026-04-01T11:00:00Z"}'</span><br/>
      <span class="c-muted">\u2192 { "event_id": "evt_abc123", "ical_url": "https://agentlair.dev/v1/calendar/my-agent@agentlair.dev/ical" }</span>
    </div>

    <div class="code-block">
      <span class="c-muted"># Get the iCal feed URL (subscribe in any calendar app)</span><br/>
      <span class="c-cmd">curl</span> https://agentlair.dev/v1/calendar/my-agent@agentlair.dev/ical<br/>
      <span class="c-muted">\u2192 text/calendar &mdash; paste this URL into Google Calendar</span>
    </div>

    <div class="tip">
      <strong>Subscribe in Google Calendar:</strong> Open Google Calendar &rarr; click <strong>+</strong> next to "Other calendars" &rarr; "From URL" &rarr; paste the iCal URL above. Your agent's schedule appears in real-time, updated automatically as the agent creates or modifies events.
      <a href="/calendar">Learn more about Agent Calendar &rarr;</a>
    </div>
  </div>

  <div style="text-align:center; margin:3rem 0 1rem; padding:2rem; background:var(--surface); border:1px solid var(--border); border-radius:12px;">
    <h2 style="font-size:1.3rem; font-weight:700; margin-bottom:0.5rem;">\u2705 You're all set!</h2>
    <p style="color:var(--muted); font-size:0.95rem; margin-bottom:1.5rem;">Your agent has email, encrypted secret storage, and a calendar. Here's what to explore next:</p>
    <div class="next-steps">
      <a href="/dashboard" class="next-card">
        <h3>\u{1F4CA} Dashboard</h3>
        <p>Manage addresses, read inbox, compose emails, and monitor usage.</p>
      </a>
      <a href="/api" class="next-card">
        <h3>\u{1F4D6} API Reference</h3>
        <p>Full API documentation with all endpoints, parameters, and examples.</p>
      </a>
      <a href="/vault" class="next-card">
        <h3>\u{1F512} Vault</h3>
        <p>Zero-knowledge encrypted secret store. Versioned. Recoverable.</p>
      </a>
      <a href="/calendar" class="next-card">
        <h3>\u{1F4C5} Agent Calendar</h3>
        <p>Create events via REST. Share an iCal feed. Humans subscribe in any calendar app.</p>
      </a>
    </div>
  </div>

  <div class="tip" style="text-align:center;">
    <strong>Need help?</strong> Email <a href="mailto:hello@agentlair.dev">hello@agentlair.dev</a> \u2014 we respond within 24 hours.
  </div>
</div>

<footer>
  <p>\u00A9 2026 AgentLair \u2014 Identity infrastructure for the agentic web.</p>
  <p style="margin-top:0.5rem;">
    <a href="/">Home</a> &nbsp;\u00B7&nbsp;
    <a href="/api">API</a> &nbsp;\u00B7&nbsp;
    <a href="/dashboard">Dashboard</a> &nbsp;\u00B7&nbsp;
    <a href="/security">Security</a> &nbsp;\u00B7&nbsp;
    <a href="/integrations">Integrations</a> &nbsp;\u00B7&nbsp;
    <a href="mailto:hello@agentlair.dev">Contact</a>
  </p>
</footer>

</body>
</html>`;
