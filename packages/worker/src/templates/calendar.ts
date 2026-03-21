export const CALENDAR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentLair Calendar — Your agent's own calendar</title>
  <meta name="description" content="Agent-native calendar infrastructure. Create events via API, publish iCal feeds, send invites — no Google account required. Your agent gets its own calendar in 30 seconds." />
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
      line-height: 1.7;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
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
    .logo { font-size: 1.15rem; font-weight: 700; color: var(--text); }
    .logo span { color: var(--accent); }
    .nav-links { display: flex; gap: 1.5rem; align-items: center; }
    .nav-links a { color: var(--muted); font-size: 0.9rem; }
    .nav-links a:hover { color: var(--text); }
    .container { max-width: 800px; margin: 0 auto; padding: 0 2rem; }
    .hero {
      text-align: center;
      padding: 5rem 2rem 3rem;
    }
    .hero h1 {
      font-size: clamp(2rem, 5vw, 3.25rem);
      line-height: 1.15;
      margin-bottom: 1.5rem;
      font-weight: 800;
    }
    .hero h1 .accent { color: var(--accent); }
    .hero p.tagline {
      font-size: 1rem;
      color: var(--muted);
      margin-bottom: 0.75rem;
    }
    .hero p.lead {
      font-size: 1.15rem;
      color: var(--muted);
      max-width: 620px;
      margin: 0 auto 2rem;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid var(--green);
      color: var(--green);
      margin-bottom: 1.5rem;
    }
    .cta-buttons {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 1.5rem;
    }
    section {
      padding: 3rem 0;
      border-top: 1px solid var(--border);
    }
    section h2 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      font-weight: 700;
    }
    section h3 {
      font-size: 1.1rem;
      color: var(--muted);
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    section p, section li {
      color: var(--muted);
      margin-bottom: 0.75rem;
    }
    section ul { padding-left: 1.5rem; }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.5;
      margin: 1rem 0;
      color: var(--text);
    }
    code {
      background: var(--code-bg);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.85em;
    }
    pre code { background: none; padding: 0; }
    .comment { color: var(--muted); }
    .string { color: var(--green); }
    .kw { color: var(--accent); }
    .num { color: var(--amber); }
    /* Problem section */
    .problem-stats {
      background: var(--surface);
      border: 1px solid #3a1515;
      border-radius: 12px;
      padding: 1.5rem 2rem;
      margin: 1.5rem 0;
    }
    .problem-stat {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
      padding: 0.6rem 0;
      border-bottom: 1px solid var(--border);
    }
    .problem-stat:last-child { border-bottom: none; }
    .stat-number {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--red);
      min-width: 3.5rem;
    }
    .stat-text { color: var(--muted); font-size: 0.95rem; }
    /* How it works */
    .flow-steps {
      margin: 1.5rem 0;
    }
    .flow-step {
      display: flex;
      gap: 1.25rem;
      align-items: flex-start;
      padding: 1rem 0;
      border-bottom: 1px solid var(--border);
    }
    .flow-step:last-child { border-bottom: none; }
    .step-num {
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      font-weight: 700;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 0.15rem;
    }
    .step-body h4 {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.25rem;
    }
    .step-body p { font-size: 0.9rem; color: var(--muted); margin: 0; }
    .step-body code { font-size: 0.82rem; }
    /* Code tabs */
    .code-tabs {
      margin: 1.5rem 0;
    }
    .tab-buttons {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--muted);
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      font-family: inherit;
      margin-bottom: -1px;
    }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .tab-btn:hover { color: var(--text); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    /* Pricing */
    .pricing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin: 1.5rem 0;
    }
    @media (max-width: 600px) {
      .pricing-grid { grid-template-columns: 1fr; }
    }
    .pricing-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
    }
    .pricing-card.highlighted {
      border-color: var(--accent);
      position: relative;
    }
    .pricing-card.highlighted::before {
      content: 'Popular';
      position: absolute;
      top: -0.65rem;
      left: 1.25rem;
      background: var(--accent);
      color: white;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
    }
    .pricing-card h3 {
      color: var(--text);
      margin-bottom: 0.25rem;
    }
    .pricing-card .price {
      font-size: 2rem;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 1rem;
    }
    .pricing-card .price span {
      font-size: 0.9rem;
      font-weight: 400;
      color: var(--muted);
    }
    .pricing-card ul {
      list-style: none;
      padding: 0;
    }
    .pricing-card li {
      padding: 0.3rem 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .pricing-card li::before {
      content: '\\2713 ';
      color: var(--green);
      margin-right: 0.5rem;
    }
    .pricing-note {
      margin-top: 1rem;
      font-size: 0.85rem;
      color: var(--muted);
      text-align: center;
    }
    /* Trust / feature grid */
    .trust-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      margin: 1.5rem 0;
    }
    @media (max-width: 600px) {
      .trust-grid { grid-template-columns: 1fr; }
    }
    .trust-item {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      padding: 0.5rem 0;
      font-size: 0.9rem;
      color: var(--muted);
    }
    .trust-check {
      color: var(--green);
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 0.1rem;
    }
    /* Feature grid */
    .feature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin: 1.5rem 0;
    }
    @media (max-width: 600px) {
      .feature-grid { grid-template-columns: 1fr; }
    }
    .feature-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .feature-card h4 {
      font-size: 0.95rem;
      margin-bottom: 0.5rem;
      color: var(--text);
    }
    .feature-card p {
      font-size: 0.85rem;
      color: var(--muted);
      margin: 0;
    }
    /* CTA */
    .cta-section {
      text-align: center;
      padding: 3rem 0 5rem;
    }
    .cta-section h2 { margin-bottom: 1rem; }
    .btn {
      display: inline-block;
      padding: 0.75rem 2rem;
      background: var(--accent);
      color: white;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      margin-top: 1rem;
    }
    .btn:hover { background: var(--accent-dim); text-decoration: none; }
    .btn-outline {
      display: inline-block;
      padding: 0.75rem 2rem;
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      margin-top: 1rem;
    }
    .btn-outline:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem;
      text-align: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
    /* Calendar-specific: subscribe pill */
    .cal-clients {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin: 1.25rem 0;
    }
    .cal-badge {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.4rem 0.85rem;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .ical-url-box {
      background: var(--surface);
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 0.9rem 1.25rem;
      margin: 1rem 0;
      font-family: monospace;
      font-size: 0.88rem;
      color: var(--green);
      word-break: break-all;
    }
    .integration-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
      color: var(--muted);
    }
    .integration-row:last-child { border-bottom: none; }
    .integration-icon {
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 6px;
      background: var(--surface);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo">Agent<span>Lair</span> Calendar</a>
  <div class="nav-links">
    <a href="/">Email</a>
    <a href="/vault">Vault</a>
    <a href="/integrations">Integrations</a>
    <a href="/getting-started">Get Started</a>
    <a href="/dashboard">Dashboard</a>
  </div>
</nav>

<div class="container">

  <div class="hero">
    <div class="badge">Live &mdash; iCal standard</div>
    <h1>Your agent's<br/><span class="accent">own calendar.</span></h1>
    <p class="tagline">No Google account. No OAuth dance. No human in the loop.</p>
    <p class="lead">Agents create events via API. A public iCal feed URL is generated instantly.
    Users subscribe from Google Calendar, Apple Calendar, or Outlook &mdash; no setup on their end.</p>
    <div class="cta-buttons">
      <a href="/getting-started" class="btn">Get API Key &mdash; Free &rarr;</a>
      <a href="#how-it-works" class="btn-outline">See how it works</a>
    </div>
  </div>

  <section>
    <h2>Calendar apps are built for humans</h2>
    <p>Every major calendar API assumes the entity scheduling the meeting is a human with a Google account.
    That assumption breaks the moment an AI agent needs to manage time.</p>
    <div class="problem-stats">
      <div class="problem-stat">
        <span class="stat-number">OAuth</span>
        <span class="stat-text">Google Calendar API requires a human user to authorize access &mdash; there is no service account path for consumer accounts</span>
      </div>
      <div class="problem-stat">
        <span class="stat-number">~0</span>
        <span class="stat-text">AI agent frameworks include a calendar primitive &mdash; scheduling is left as an exercise for the developer</span>
      </div>
      <div class="problem-stat">
        <span class="stat-number">1 hr+</span>
        <span class="stat-text">typical setup time for a calendar integration &mdash; OAuth app registration, consent screen, token refresh logic, all before the first event is created</span>
      </div>
    </div>
    <p>Your agent needs to schedule. It should take one API call.</p>
  </section>

  <section id="how-it-works">
    <h2>How it works</h2>
    <p>Three steps. Your agent handles all three.</p>
    <div class="flow-steps">
      <div class="flow-step">
        <div class="step-num">1</div>
        <div class="step-body">
          <h4>Agent creates events via JSON API</h4>
          <p><code>POST /v1/calendar/events</code> with <code>summary</code>, <code>start</code>, <code>end</code>.
          Optional: <code>description</code>, <code>location</code>, <code>attendees</code>.
          Returns the event ID immediately.</p>
        </div>
      </div>
      <div class="flow-step">
        <div class="step-num">2</div>
        <div class="step-body">
          <h4>Public iCal feed URL generated automatically</h4>
          <p>Every account gets a permanent <code>https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=...</code>
          URL. No configuration needed &mdash; it exists from the moment you create your account.</p>
        </div>
      </div>
      <div class="flow-step">
        <div class="step-num">3</div>
        <div class="step-body">
          <h4>Users subscribe from their existing calendar app</h4>
          <p>Paste the iCal URL into Google Calendar &rarr; &ldquo;Other calendars &rsaquo; From URL&rdquo;.
          Events appear within minutes. No app install. No account creation. Works on every device.</p>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>Get started in 60 seconds</h2>
    <p>Pick your tool:</p>
    <div class="code-tabs">
      <div class="tab-buttons">
        <button class="tab-btn active" onclick="showTab('curl')">curl</button>
        <button class="tab-btn" onclick="showTab('ts')">TypeScript</button>
        <button class="tab-btn" onclick="showTab('subscribe')">Subscribe URL</button>
      </div>

      <div id="tab-curl" class="tab-panel active">
<pre><code><span class="comment"># 1. Get an API key (30 seconds)</span>
API_KEY=$(curl -s -X POST https://api.agentlair.dev/v1/auth/keys | jq -r .api_key)

<span class="comment"># 2. Create an event</span>
curl -s -X POST https://api.agentlair.dev/v1/calendar/events \\
  -H <span class="string">"Authorization: Bearer $API_KEY"</span> \\
  -H <span class="string">"Content-Type: application/json"</span> \\
  -d <span class="string">'{
    "summary": "Product demo — Acme Corp",
    "start": "2026-04-01T14:00:00Z",
    "end": "2026-04-01T15:00:00Z",
    "description": "Quarterly review call",
    "location": "https://meet.example.com/demo"
  }'</span>
<span class="comment"># → { "id": "evt_01JNXK...", "summary": "Product demo — Acme Corp", ... }</span>

<span class="comment"># 3. Get the public iCal subscription URL</span>
curl -s https://api.agentlair.dev/v1/calendar/feed \\
  -H <span class="string">"Authorization: Bearer $API_KEY"</span>
<span class="comment"># → { "feed_url": "https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=..." }</span>

<span class="comment"># 4. Share feed_url with anyone — they add it to their calendar app, done</span></code></pre>
      </div>

      <div id="tab-ts" class="tab-panel">
<pre><code><span class="comment">// Create an event — works from any agent, LLM runner, or Cloudflare Worker</span>
<span class="kw">const</span> event = <span class="kw">await</span> fetch(<span class="string">'https://api.agentlair.dev/v1/calendar/events'</span>, {
  method: <span class="string">'POST'</span>,
  headers: {
    <span class="string">'Authorization'</span>: <span class="string">\`Bearer \${apiKey}\`</span>,
    <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span>,
  },
  body: JSON.stringify({
    summary: <span class="string">'Product demo — Acme Corp'</span>,
    start: <span class="string">'2026-04-01T14:00:00Z'</span>,
    end: <span class="string">'2026-04-01T15:00:00Z'</span>,
    description: <span class="string">'Quarterly review call'</span>,
    location: <span class="string">'https://meet.example.com/demo'</span>,
    attendees: [<span class="string">'ceo@acme.com'</span>],
  }),
}).then(r =&gt; r.json());
<span class="comment">// event.id → "evt_01JNXK..."</span>

<span class="comment">// Fetch the subscription URL once, share it in your onboarding flow</span>
<span class="kw">const</span> { feed_url } = <span class="kw">await</span> fetch(
  <span class="string">'https://api.agentlair.dev/v1/calendar/feed'</span>,
  { headers: { <span class="string">'Authorization'</span>: <span class="string">\`Bearer \${apiKey}\`</span> } },
).then(r =&gt; r.json());
<span class="comment">// feed_url → "https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=..."</span>

<span class="comment">// List upcoming events</span>
<span class="kw">const</span> { events } = <span class="kw">await</span> fetch(
  <span class="string">\`https://api.agentlair.dev/v1/calendar/events?from=\${new Date().toISOString()}\`</span>,
  { headers: { <span class="string">'Authorization'</span>: <span class="string">\`Bearer \${apiKey}\`</span> } },
).then(r =&gt; r.json());</code></pre>
      </div>

      <div id="tab-subscribe" class="tab-panel">
        <p style="margin-bottom:0.5rem;">After creating your first event, get your subscription URL:</p>
        <div class="ical-url-box">https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=<span style="color:var(--accent)">your_token</span></div>
        <p>Share this URL anywhere. Here&rsquo;s how users subscribe:</p>
        <div class="integration-row">
          <div class="integration-icon">🗓</div>
          <div><strong style="color:var(--text)">Google Calendar</strong> &mdash; Other calendars &rarr; From URL &rarr; paste link &rarr; Add calendar</div>
        </div>
        <div class="integration-row">
          <div class="integration-icon">🍎</div>
          <div><strong style="color:var(--text)">Apple Calendar</strong> &mdash; File &rarr; New Calendar Subscription &rarr; paste link &rarr; OK</div>
        </div>
        <div class="integration-row">
          <div class="integration-icon">📧</div>
          <div><strong style="color:var(--text)">Outlook</strong> &mdash; Add calendar &rarr; Subscribe from web &rarr; paste link &rarr; Import</div>
        </div>
        <div class="integration-row">
          <div class="integration-icon">⚡</div>
          <div><strong style="color:var(--text)">Any iCal-compatible app</strong> &mdash; The feed URL is a standard <code>.ics</code> file. If it speaks iCal (RFC 5545), it works.</div>
        </div>
        <p style="font-size:0.85rem;margin-top:0.75rem;">The token is in the URL. No authentication required for subscribers &mdash; paste and go.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Compatible with everything</h2>
    <p>The feed is a standard iCalendar file (RFC 5545). If it speaks iCal, it subscribes.</p>
    <div class="cal-clients">
      <span class="cal-badge">Google Calendar</span>
      <span class="cal-badge">Apple Calendar</span>
      <span class="cal-badge">Outlook</span>
      <span class="cal-badge">Thunderbird</span>
      <span class="cal-badge">Fantastical</span>
      <span class="cal-badge">Notion Calendar</span>
      <span class="cal-badge">Cron</span>
      <span class="cal-badge">Any .ics client</span>
    </div>
    <p style="font-size:0.9rem;">Building a calendar integration? <a href="https://github.com/piiiico/agentlair">Open a PR &rarr;</a></p>
  </section>

  <section>
    <h2>Key features</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <h4>Agent-owned identity</h4>
        <p>No Google account. No user OAuth. Your agent is the calendar owner &mdash; events appear under its name, not yours.</p>
      </div>
      <div class="feature-card">
        <h4>Email invite notifications</h4>
        <p>Add <code>attendees</code> to any event. Invite emails sent automatically via AgentLair Email &mdash; no SMTP setup required.</p>
      </div>
      <div class="feature-card">
        <h4>iCal standard (RFC 5545)</h4>
        <p>Events rendered as valid VEVENT blocks. All-day events, date-time events, UTC and floating times all supported.</p>
      </div>
      <div class="feature-card">
        <h4>Vault integration</h4>
        <p>Store Google/Outlook OAuth tokens in Vault, use them to write to a user&rsquo;s calendar &mdash; without touching your own infra.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Pricing</h2>
    <div class="pricing-grid">
      <div class="pricing-card">
        <h3>Free</h3>
        <div class="price">$0</div>
        <ul>
          <li>100 events</li>
          <li>Public iCal feed URL</li>
          <li>Email invites (via AgentLair Email)</li>
          <li>All calendar clients</li>
          <li>No credit card required</li>
        </ul>
      </div>
      <div class="pricing-card highlighted">
        <h3>Pro</h3>
        <div class="price">$9<span>/month</span></div>
        <ul>
          <li>10,000 events</li>
          <li>Multiple calendars per account</li>
          <li>Event filtering by date range</li>
          <li>x402 autonomous payments</li>
          <li>Priority support</li>
        </ul>
      </div>
    </div>
    <p class="pricing-note">
      Pro tier coming soon. Free tier is permanent &mdash; no expiry, no bait-and-switch.<br/>
      Autonomous agents: <strong>x402 payments</strong> available &mdash; agents pay per-call at $0.001/request when limits are hit.
    </p>
  </section>

  <section>
    <h2>What&rsquo;s included</h2>
    <p>Built on open standards. No vendor lock-in, no proprietary format.</p>
    <div class="trust-grid">
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>iCalendar (RFC 5545) compliant feed</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Permanent, stable subscription URL</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>All-day and date-time events</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>UTC and floating time support</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Attendee fields (email invites)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Location and description fields</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Edge-deployed on Cloudflare (200+ PoPs)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Works with existing AgentLair API key</span>
      </div>
    </div>
  </section>

  <section>
    <h2>API reference</h2>
    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);text-align:left;">
          <th style="padding:0.5rem 0;color:var(--muted);">Method</th>
          <th style="padding:0.5rem 0;color:var(--muted);">Endpoint</th>
          <th style="padding:0.5rem 0;color:var(--muted);">Description</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>POST</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/calendar/events</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Create an event (body: <code>summary, start, end, description?, location?, attendees?</code>)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>GET</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/calendar/events</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">List events (<code>?from=ISO&amp;to=ISO</code> optional date range filter)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>DELETE</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/calendar/events/{id}</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Delete a single event by ID</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>GET</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/calendar/feed</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Get (or create) public iCal subscription URL</td>
        </tr>
        <tr>
          <td style="padding:0.5rem 0;"><code>GET</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/calendar/feed.ics</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Public iCal feed (<code>?cal_token=</code>, no auth required)</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Why not just use&hellip;?</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <h4>vs Google Calendar API</h4>
        <p>Requires a human OAuth consent flow. No service account path for consumer accounts. Domain-wide delegation needs Google Workspace ($6+/user/mo).</p>
      </div>
      <div class="feature-card">
        <h4>vs Cronofy / Nylas</h4>
        <p>Connect to <em>existing</em> human calendars — they don&rsquo;t provision new ones. Enterprise pricing. We give your agent its own calendar with one API call.</p>
      </div>
      <div class="feature-card">
        <h4>vs Cal.com</h4>
        <p>Scheduling platform for humans, not agents. Requires a UI and a human on the other side. We&rsquo;re infrastructure — your agent is in control.</p>
      </div>
      <div class="feature-card">
        <h4>vs self-hosted CalDAV</h4>
        <p>Radicale/Baikal require persistent storage, ops, and deployment. We handle the infra — your agent gets a calendar endpoint, not a server to manage.</p>
      </div>
    </div>
  </section>

  <div class="cta-section">
    <h2>Your agent's own calendar.</h2>
    <p style="color:var(--muted);">Free tier. No Google account. No OAuth. No human setup.</p>
    <div class="cta-buttons">
      <a href="/getting-started" class="btn">Get API Key &mdash; Free &rarr;</a>
      <a href="/vault" class="btn-outline">Store OAuth tokens in Vault</a>
    </div>
    <p style="margin-top:1.5rem;font-size:0.85rem;color:var(--muted);">
      <a href="/v1/calendar/events">API reference</a> &middot;
      <a href="/dashboard">Dashboard</a> &middot;
      <a href="/">Email</a> &middot;
      <a href="/vault">Vault</a>
    </p>
  </div>

</div>

<footer>
  &copy; 2026 AgentLair &mdash; Infrastructure for autonomous agents.
</footer>

<script>
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
}
</script>

</body>
</html>`;
