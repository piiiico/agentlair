export const VAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentLair Vault — The credential store AI agents actually use</title>
  <meta name="description" content="Zero-knowledge encrypted credential storage for AI agents. Client-side AES-256-GCM. Edge-deployed. 30-second setup. Your secrets are encrypted before they leave your agent." />
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
      min-width: 3rem;
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
    /* Trust section */
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
    /* Framework badges */
    .framework-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin: 1.25rem 0;
    }
    .fw-badge {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.4rem 0.85rem;
      font-size: 0.85rem;
      color: var(--muted);
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
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo">Agent<span>Lair</span> Vault</a>
  <div class="nav-links">
    <a href="/">Email</a>
    <a href="/security">Security</a>
    <a href="/integrations">Integrations</a>
    <a href="/getting-started">Get Started</a>
    <a href="/dashboard">Dashboard</a>
  </div>
</nav>

<div class="container">

  <div class="hero">
    <div class="badge">Live &mdash; Zero-knowledge</div>
    <h1>The credential store<br/><span class="accent">AI agents actually use.</span></h1>
    <p class="tagline">Zero-knowledge. Edge-deployed. 30-second setup.</p>
    <p class="lead">Your secrets are encrypted before they leave your agent.
    We never see them. Nobody does.</p>
    <div class="cta-buttons">
      <a href="/getting-started" class="btn">Get API Key &mdash; Free &rarr;</a>
      <a href="#how-it-works" class="btn-outline">Read the Docs</a>
    </div>
  </div>

  <section>
    <h2>The state of agent credentials today</h2>
    <p>The AI agent ecosystem has a secrets problem. And nobody is solving it.</p>
    <div class="problem-stats">
      <div class="problem-stat">
        <span class="stat-number">92%</span>
        <span class="stat-text">of MCP servers store secrets in plaintext config files</span>
      </div>
      <div class="problem-stat">
        <span class="stat-number">~0</span>
        <span class="stat-text">AI agent frameworks include a credential primitive — they recommend &ldquo;use .env files&rdquo;</span>
      </div>
      <div class="problem-stat">
        <span class="stat-number">6 mo</span>
        <span class="stat-text">average enterprise secrets manager rollout — requires sales call, IAM policy, ops team</span>
      </div>
    </div>
    <p>Your agent deserves better. The bar is low &mdash; and we clear it in 30 seconds.</p>
  </section>

  <section id="how-it-works">
    <h2>How it works</h2>
    <p>Four steps. One of them is our server. The rest happen inside your agent.</p>
    <div class="flow-steps">
      <div class="flow-step">
        <div class="step-num">1</div>
        <div class="step-body">
          <h4>Your agent encrypts locally</h4>
          <p>Call <code>VaultCrypto.encrypt("sk-proj-abc123", "openai-key")</code>. The plaintext never leaves your process.</p>
        </div>
      </div>
      <div class="flow-step">
        <div class="step-num">2</div>
        <div class="step-body">
          <h4>Encrypted blob hits our API</h4>
          <p><code>PUT /v1/vault/openai-key</code> &mdash; we receive ciphertext. Opaque, meaningless without your seed.</p>
        </div>
      </div>
      <div class="flow-step">
        <div class="step-num">3</div>
        <div class="step-body">
          <h4>We store opaque ciphertext</h4>
          <p>Server stores: <code>aeGx8kF...</code> &mdash; meaningless without your seed. We literally cannot read it.</p>
        </div>
      </div>
      <div class="flow-step">
        <div class="step-num">4</div>
        <div class="step-body">
          <h4>Your agent retrieves and decrypts</h4>
          <p><code>GET /v1/vault/openai-key</code> returns the blob. You call <code>vault.decrypt()</code>. You get your secret back.</p>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>Get started in 30 seconds</h2>
    <p>Pick your language:</p>
    <div class="code-tabs">
      <div class="tab-buttons">
        <button class="tab-btn active" onclick="showTab('ts')">TypeScript</button>
        <button class="tab-btn" onclick="showTab('curl')">curl</button>
        <button class="tab-btn" onclick="showTab('python')">Python</button>
      </div>

      <div id="tab-ts" class="tab-panel active">
<pre><code><span class="comment">// Install: bun add @agentlair/vault-crypto  (or npm, pnpm, yarn)</span>
<span class="kw">import</span> { VaultCrypto } <span class="kw">from</span> <span class="string">'@agentlair/vault-crypto'</span>;

<span class="comment">// One-time setup (30 seconds)</span>
<span class="kw">const</span> apiKey = <span class="kw">await</span> fetch(<span class="string">'https://api.agentlair.dev/v1/auth/keys'</span>, {
  method: <span class="string">'POST'</span>
}).then(r =&gt; r.json()).then(r =&gt; r.api_key);

<span class="kw">const</span> seed = VaultCrypto.generateSeed();  <span class="comment">// save this!</span>
<span class="kw">const</span> vault = VaultCrypto.fromSeed(seed);

<span class="comment">// Store a secret</span>
<span class="kw">const</span> ciphertext = <span class="kw">await</span> vault.encrypt(<span class="string">'sk-proj-abc123'</span>, <span class="string">'openai'</span>);
<span class="kw">await</span> fetch(<span class="string">'https://api.agentlair.dev/v1/vault/openai'</span>, {
  method: <span class="string">'PUT'</span>,
  headers: {
    <span class="string">'Authorization'</span>: <span class="string">\`Bearer \${apiKey}\`</span>,
    <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span>,
  },
  body: JSON.stringify({ ciphertext }),
});

<span class="comment">// Retrieve it — from any agent, anywhere</span>
<span class="kw">const</span> { ciphertext: stored } = <span class="kw">await</span> fetch(
  <span class="string">'https://api.agentlair.dev/v1/vault/openai'</span>,
  { headers: { <span class="string">'Authorization'</span>: <span class="string">\`Bearer \${apiKey}\`</span> } }
).then(r =&gt; r.json());

<span class="kw">const</span> secret = <span class="kw">await</span> vault.decrypt(stored, <span class="string">'openai'</span>);
<span class="comment">// secret === 'sk-proj-abc123'</span></code></pre>
        <p style="font-size:0.85rem;color:var(--muted);">
          <a href="https://www.npmjs.com/package/@agentlair/vault-crypto">npm</a> &middot;
          <a href="https://github.com/piiiico/agentlair-vault-crypto">GitHub</a> &middot;
          AES-256-GCM + HKDF-SHA-256. Zero dependencies.
        </p>
      </div>

      <div id="tab-curl" class="tab-panel">
<pre><code><span class="comment"># Create account</span>
API_KEY=$(curl -s -X POST https://api.agentlair.dev/v1/auth/keys | jq -r .api_key)

<span class="comment"># Store (you encrypt client-side first — see TypeScript tab)</span>
curl -X PUT https://api.agentlair.dev/v1/vault/my-secret \\
  -H <span class="string">"Authorization: Bearer $API_KEY"</span> \\
  -H <span class="string">"Content-Type: application/json"</span> \\
  -d <span class="string">'{"ciphertext": "YOUR_ENCRYPTED_BLOB"}'</span>
<span class="comment"># -&gt; { "key": "my-secret", "stored": true, "version": 1 }</span>

<span class="comment"># Retrieve</span>
curl https://api.agentlair.dev/v1/vault/my-secret \\
  -H <span class="string">"Authorization: Bearer $API_KEY"</span>
<span class="comment"># -&gt; { "ciphertext": "YOUR_ENCRYPTED_BLOB", "version": 1 }</span>

<span class="comment"># List all keys</span>
curl https://api.agentlair.dev/v1/vault/ \\
  -H <span class="string">"Authorization: Bearer $API_KEY"</span>
<span class="comment"># -&gt; { "keys": [...], "count": 1, "limit": 10 }</span></code></pre>
      </div>

      <div id="tab-python" class="tab-panel">
<pre><code><span class="comment"># Coming soon: pip install agentlair</span>
<span class="comment"># Python SDK is in development. For now, use curl or the TypeScript library.</span>
<span class="comment">#</span>
<span class="comment"># What it will look like:</span>
<span class="comment">#</span>
<span class="comment"># from agentlair import Client, VaultCrypto</span>
<span class="comment">#</span>
<span class="comment"># client = Client(api_key="al_live_...")</span>
<span class="comment"># vault = VaultCrypto.from_seed(VaultCrypto.generate_seed())</span>
<span class="comment">#</span>
<span class="comment"># encrypted = vault.encrypt("sk-proj-abc123", "openai")</span>
<span class="comment"># client.vault.put("openai", ciphertext=encrypted)</span>
<span class="comment">#</span>
<span class="comment"># Want Python support? Star the repo and open an issue:</span>
<span class="comment"># github.com/piiiico/agentlair</span></code></pre>
        <p style="font-size:0.85rem;color:var(--muted);">
          <a href="https://github.com/piiiico/agentlair">Request Python SDK on GitHub &rarr;</a>
        </p>
      </div>
    </div>
  </section>

  <section>
    <h2>Works with your framework</h2>
    <p>Vault is a REST API. It works with everything that can make an HTTP request.</p>
    <div class="framework-list">
      <span class="fw-badge">LangChain</span>
      <span class="fw-badge">LangGraph</span>
      <span class="fw-badge">CrewAI</span>
      <span class="fw-badge">AutoGen</span>
      <span class="fw-badge">MCP Servers</span>
      <span class="fw-badge">Mastra</span>
      <span class="fw-badge">Claude SDK</span>
      <span class="fw-badge">OpenAI Agents</span>
      <span class="fw-badge">Any HTTP client</span>
    </div>
    <p style="font-size:0.9rem;">Building a framework integration? <a href="https://github.com/piiiico/agentlair">Open a PR &rarr;</a></p>
  </section>

  <section>
    <h2>Key features</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <h4>Version history</h4>
        <p>Every PUT auto-increments version. Roll back with <code>?version=N</code>. Old versions retained at tier limits.</p>
      </div>
      <div class="feature-card">
        <h4>Email recovery</h4>
        <p>Register a recovery email. When container dies and API key is lost &mdash; recover all secrets via magic link.</p>
      </div>
      <div class="feature-card">
        <h4>Metadata</h4>
        <p>Attach labels, algorithm hints, and agent IDs to each secret. Stored in plaintext for operational use.</p>
      </div>
      <div class="feature-card">
        <h4>Agent-native payments</h4>
        <p>Agents pay per-request via HTTP 402 + USDC on Base when free-tier limits are hit. No human billing needed.</p>
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
          <li>10 secrets</li>
          <li>3 versions per secret</li>
          <li>16 KB per value</li>
          <li>100 API calls/day</li>
          <li>Email recovery</li>
          <li>No credit card required</li>
        </ul>
      </div>
      <div class="pricing-card highlighted">
        <h3>Pro</h3>
        <div class="price">$9<span>/month</span></div>
        <ul>
          <li>Unlimited secrets</li>
          <li>100 versions per secret</li>
          <li>64 KB per value</li>
          <li>10,000 API calls/day</li>
          <li>Priority support</li>
          <li>x402 autonomous payments</li>
        </ul>
      </div>
    </div>
    <p class="pricing-note">
      Pro tier coming soon. Free tier is permanent &mdash; no expiry, no bait-and-switch.<br/>
      Autonomous agents: <strong>x402 payments</strong> available &mdash; agents pay per-call at $0.001/request.
      <a href="/security">Security details &rarr;</a>
    </p>
  </section>

  <section>
    <h2>Security model</h2>
    <p>Built on cryptographic primitives, not trust. Open-source, auditable, edge-deployed.</p>
    <div class="trust-grid">
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Client-side encryption (AES-256-GCM)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Per-key derivation (HKDF-SHA-256)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>API keys hashed server-side (SHA-256)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Zero-knowledge: server stores opaque blobs</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Single-use recovery tokens (15 min TTL)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Edge-deployed on Cloudflare (200+ PoPs)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Open-source crypto library (npm)</span>
      </div>
      <div class="trust-item">
        <span class="trust-check">&#10003;</span>
        <span>Built on Web Crypto API (no dependencies)</span>
      </div>
    </div>
    <p style="font-size:0.9rem;"><a href="/security">Read the full security architecture &rarr;</a></p>
  </section>

  <section>
    <h2>Why not just use&hellip;?</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <h4>vs AWS / GCP Secrets Manager</h4>
        <p>They see your plaintext. Require IAM setup (~1 hour). We take 30 seconds and never see your secrets.</p>
      </div>
      <div class="feature-card">
        <h4>vs HashiCorp Vault</h4>
        <p>Requires server setup (~1 day). Needs unseal keys. We're a single PUT request away from running.</p>
      </div>
      <div class="feature-card">
        <h4>vs Infisical</h4>
        <p>Server decrypts your secrets. Dashboard required. We store opaque blobs we literally cannot read.</p>
      </div>
      <div class="feature-card">
        <h4>vs .env files</h4>
        <p>Gone when the container dies. No recovery. No versioning. No audit trail. No encryption.</p>
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
          <td style="padding:0.5rem 0;"><code>/v1/auth/keys</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Create account (no auth needed)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>GET</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">List all keys (metadata, no ciphertext)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>PUT</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/{key}</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Store encrypted blob (body: <code>{ciphertext, metadata?}</code>)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>GET</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/{key}</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Retrieve secret (<code>?version=N</code> for specific version)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>DELETE</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/{key}</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Delete all versions (<code>?version=N</code> for one)</td>
        </tr>
        <tr>
          <td style="padding:0.5rem 0;"><code>POST</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/recovery-email</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Register recovery email + encrypted seed</td>
        </tr>
      </tbody>
    </table>

    <h3 style="margin-top:1.5rem;">Tier limits</h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-top:0.5rem;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);text-align:left;">
          <th style="padding:0.5rem 0;color:var(--muted);"></th>
          <th style="padding:0.5rem 0;color:var(--muted);">Free</th>
          <th style="padding:0.5rem 0;color:var(--muted);">Pro ($9/mo)</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">Secrets</td>
          <td style="padding:0.5rem 0;">10 keys</td>
          <td style="padding:0.5rem 0;">Unlimited</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">Version history</td>
          <td style="padding:0.5rem 0;">3 per key</td>
          <td style="padding:0.5rem 0;">100 per key</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">Max blob size</td>
          <td style="padding:0.5rem 0;">16 KB</td>
          <td style="padding:0.5rem 0;">64 KB</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">API requests/day</td>
          <td style="padding:0.5rem 0;">100 (shared)</td>
          <td style="padding:0.5rem 0;">10,000</td>
        </tr>
        <tr>
          <td style="padding:0.5rem 0;color:var(--muted);">Recovery emails</td>
          <td style="padding:0.5rem 0;">1</td>
          <td style="padding:0.5rem 0;">3</td>
        </tr>
      </tbody>
    </table>
  </section>

  <div class="cta-section">
    <h2>The credential store AI agents actually use.</h2>
    <p style="color:var(--muted);">Free tier. No credit card. No IAM. No human setup.</p>
    <div class="cta-buttons">
      <a href="/getting-started" class="btn">Get API Key &mdash; Free &rarr;</a>
      <a href="/security" class="btn-outline">Security details</a>
    </div>
    <p style="margin-top:1.5rem;font-size:0.85rem;color:var(--muted);">
      <a href="/v1/vault/">API reference</a> &middot;
      <a href="/dashboard">Dashboard</a> &middot;
      <a href="https://www.npmjs.com/package/@agentlair/vault-crypto">npm</a> &middot;
      <a href="https://github.com/piiiico/agentlair">GitHub</a>
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
