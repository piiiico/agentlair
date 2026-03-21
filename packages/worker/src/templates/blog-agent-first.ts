export const AGENT_FIRST_BLOG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>The Agent-First Web — AgentLair</title>
  <meta name="description" content="HTTP has served content negotiation for 35 years. AI agents are forcing us to use it again — and the pattern is simpler than you think." />
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
      display: flex; justify-content: space-between; align-items: center;
      padding: 1.25rem 2rem; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: rgba(10,10,15,0.92);
      backdrop-filter: blur(12px); z-index: 10;
    }
    .logo { font-size: 1.15rem; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
    .logo-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; }
    nav .links { display: flex; gap: 1.5rem; align-items: center; }
    nav .links a { color: var(--muted); font-size: 0.9rem; }
    nav .links a:hover { color: var(--text); text-decoration: none; }

    .article { max-width: 720px; margin: 0 auto; padding: 4rem 2rem 6rem; }
    .article-meta { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.5rem; }
    .article h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 1.5rem; }
    .article h1 em { color: var(--accent); font-style: normal; }
    .article-intro { font-size: 1.15rem; color: var(--muted); line-height: 1.7; margin-bottom: 3rem; border-left: 3px solid var(--accent); padding-left: 1.25rem; }

    .article h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin: 3rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .article h3 { font-size: 1.1rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--text); }
    .article p { margin-bottom: 1.25rem; }
    .article ul, .article ol { margin-bottom: 1.25rem; padding-left: 1.5rem; }
    .article li { margin-bottom: 0.4rem; }
    .article strong { color: #fff; }

    pre {
      background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.25rem 1.5rem; overflow-x: auto; margin-bottom: 1.5rem;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.82rem; line-height: 1.7; color: var(--muted);
    }
    code {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.88em; background: var(--code-bg); padding: 0.15em 0.4em;
      border-radius: 4px; color: var(--accent);
    }
    pre code { background: none; padding: 0; font-size: inherit; color: inherit; }

    .diagram {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.5rem 2rem; margin: 1.5rem 0 2rem; font-family: 'SF Mono', monospace;
      font-size: 0.82rem; line-height: 1.7; color: var(--muted); white-space: pre;
      overflow-x: auto;
    }

    .callout {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.25rem 1.5rem; margin: 1.5rem 0 2rem;
    }
    .callout-title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.5rem; }
    .callout-green .callout-title { color: var(--green); }
    .callout-amber .callout-title { color: var(--amber); }
    .callout-accent { border-color: var(--accent); }
    .callout-accent .callout-title { color: var(--accent); }
    .callout p { margin-bottom: 0.5rem; }
    .callout p:last-child { margin-bottom: 0; }

    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0 2rem; font-size: 0.88rem; }
    th { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }

    .cta-box {
      background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.04));
      border: 1px solid var(--accent); border-radius: 12px;
      padding: 2rem; margin: 3rem 0; text-align: center;
    }
    .cta-box h3 { color: var(--text); margin-bottom: 0.75rem; font-size: 1.2rem; }
    .cta-box p { color: var(--muted); margin-bottom: 1.25rem; }
    .cta-btn {
      display: inline-block; background: var(--accent); color: #fff;
      padding: 0.65rem 1.5rem; border-radius: 8px; font-weight: 600;
      font-size: 0.92rem; text-decoration: none;
    }
    .cta-btn:hover { background: var(--accent-dim); text-decoration: none; }

    footer { text-align: center; padding: 3rem 2rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    @media (max-width: 640px) {
      .article { padding: 2rem 1.25rem 4rem; }
      pre { padding: 1rem; font-size: 0.75rem; }
      .diagram { padding: 1rem; font-size: 0.72rem; }
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><span class="logo-mark">&#x26A1;</span> AgentLair</a>
  <div class="links">
    <a href="/">Home</a>
    <a href="/api">API</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/blog/security">Security</a>
  </div>
</nav>

<article class="article">

  <p class="article-meta">March 2026 &middot; Architecture</p>
  <h1>The <em>Agent-First</em> Web</h1>

  <div class="article-intro">
    HTTP has had content negotiation since 1991. AI agents are forcing us to actually use it. The pattern is simple, requires no new protocol, and works with any HTTP client &mdash; including agents that don't know they should ask for it.
  </div>

  <h2>The Problem: Agents Browse Like It's 1999</h2>

  <p>When an AI agent is given a task like "check my GitHub notifications and summarize them," here's what typically happens:</p>

  <ol>
    <li>It launches a headless browser</li>
    <li>Navigates to <code>github.com</code> &mdash; which returns ~200KB of HTML, CSS, and JavaScript</li>
    <li>Parses the DOM looking for notification elements among thousands of tokens of irrelevant markup</li>
    <li>Burns 40&ndash;60% of its context window on navigation chrome before doing any real work</li>
    <li>Fails when the UI changes</li>
  </ol>

  <p>Meanwhile, GitHub has a perfectly good API. The agent just didn't know to use it.</p>

  <p>This is a discovery problem. Not a capability problem.</p>

  <h2>The Insight: Different Clients, Different Content</h2>

  <p>In March 2026, someone built a <a href="https://news.ycombinator.com/item?id=47412015">March Madness bracket challenge for AI agents</a>. The design challenge: make it work well for both humans and agents.</p>

  <p>Their solution: serve different content based on who's asking.</p>

  <p>When the server detected a headless browser (no cookies, no <code>sec-ch-ua</code>, a <code>HeadlessChrome</code> user-agent), it served plain-text API documentation instead of HTML:</p>

<pre># March Madness Bracket API

GET /api/games          &rarr; list all games
POST /api/brackets      &rarr; submit bracket { game_id, winner }
GET /api/leaderboard    &rarr; see standings</pre>

  <p>80 tokens instead of 50,000. The agents completed the task correctly on the first try.</p>

  <p>This isn't a hack. This is content negotiation &mdash; the same mechanism HTTP has carried since 1991 &mdash; applied to a new client type.</p>

  <h2>The Detection Heuristic</h2>

  <p>No single signal reliably identifies an agent. But four orthogonal signals in combination are highly reliable:</p>

  <table>
    <tr><th>Signal</th><th>Examples</th><th>Confidence</th></tr>
    <tr><td>Explicit header</td><td><code>X-Agent-Request: true</code></td><td>High</td></tr>
    <tr><td>Accept header</td><td><code>Accept: application/agent+json</code></td><td>High</td></tr>
    <tr><td>User-agent</td><td>HeadlessChrome, ClaudeBot, GPTBot, curl, axios</td><td>Medium</td></tr>
    <tr><td>Missing fingerprints</td><td>No cookie, no referer, no sec-ch-ua</td><td>Low&ndash;medium</td></tr>
  </table>

  <p>The rule: serve agent content at <strong>medium confidence or above</strong>. Real browsers carry so many fingerprints (cookies, sec-ch-ua, referer, full Accept string, language headers) that false positives are rare.</p>

  <p>Here's the detection function:</p>

<pre>export function detectAgent(headers: Headers): DetectionResult {
  const signals: string[] = [];
  const get = (k: string) =&gt; headers.get(k);

  const ua = get('user-agent') || '';
  const accept = get('accept') || '';

  // Explicit agent headers (high confidence)
  if (get('x-agent-request')) signals.push('explicit-header');
  if (accept.includes('application/agent+json')) signals.push('agent-accept');

  // Known agent user-agents (medium confidence)
  if (/HeadlessChrome|ClaudeBot|GPTBot|curl|python-requests|axios/i.test(ua))
    signals.push('agent-ua');

  // Headless without client hints = strong signal
  if (ua.includes('HeadlessChrome') &amp;&amp; !get('sec-ch-ua'))
    signals.push('headless-no-hints');

  // No cookies + no referer = likely programmatic
  if (!get('cookie') &amp;&amp; !get('referer'))
    signals.push('no-fingerprints');

  const highSignals = signals.filter(s =&gt;
    s === 'explicit-header' || s === 'agent-accept'
  );

  const confidence =
    highSignals.length &gt; 0 ? 'high' :
    signals.length &gt;= 2    ? 'medium' :
    signals.length &gt;= 1    ? 'low'    : 'none';

  return { isAgent: signals.length &gt; 0, confidence, signals };
}</pre>

  <h2>The Manifest Format: <code>application/agent+json</code></h2>

  <p>When an agent is detected, serve a machine-optimized description of what your service can do. We're calling it <code>application/agent+json</code>:</p>

<pre>{
  "type": "agent-manifest",
  "version": "1.0",
  "service": {
    "name": "MyService",
    "description": "What this service does, in one sentence",
    "base_url": "https://api.myservice.com/v1"
  },
  "auth": {
    "type": "bearer",
    "description": "Get your key at /dashboard"
  },
  "tools": [
    {
      "name": "create_item",
      "description": "Create a new item",
      "method": "POST",
      "path": "/items",
      "body": {
        "name": { "type": "string", "required": true },
        "tags": { "type": "array" }
      },
      "returns": "{ id, name, created_at }"
    }
  ],
  "hints": {
    "best_practices": [
      "Check /health before starting a long workflow"
    ]
  }
}</pre>

  <p>An agent hitting your homepage gets a machine-optimized description of exactly what your service can do and how to call it. No docs to read. No UI to navigate. No wasted context.</p>

  <h2>How to Add It to Any Bun/Node Service</h2>

  <p>Here's a minimal middleware pattern. Drop this into your Bun server:</p>

<pre>import { detectAgent } from './agent-detect.js';

const manifest = {
  type: "agent-manifest",
  version: "1.0",
  service: { name: "MyApp", description: "...", base_url: "https://api.myapp.com" },
  tools: [/* your tools */]
};

Bun.serve({
  fetch(req) {
    const url = new URL(req.url);

    // Only intercept root (or any page you want agent-optimized)
    if (url.pathname === '/') {
      const detection = detectAgent(req.headers);
      if (detection.confidence === 'high' || detection.confidence === 'medium') {
        return new Response(JSON.stringify(manifest, null, 2), {
          headers: {
            'Content-Type': 'application/agent+json',
            'X-Agent-Optimized': 'true',
          }
        });
      }
    }

    // Regular handler for humans
    return humanHandler(req);
  }
});</pre>

  <div class="callout callout-green">
    <div class="callout-title">Test it locally</div>
    <p><code>curl -H "X-Agent-Request: true" http://localhost:3000/</code> &mdash; returns the manifest.</p>
    <p><code>curl -A "HeadlessChrome" http://localhost:3000/</code> &mdash; auto-detected as agent.</p>
    <p>Open the same URL in a real browser &mdash; gets your normal HTML.</p>
  </div>

  <p>Agents can also explicitly request the manifest by sending <code>Accept: application/agent+json</code>. As more agents adopt this header, the detection heuristics become less important &mdash; agents will just ask for what they need.</p>

  <h2>How This Relates to MCP</h2>

  <p>The Model Context Protocol is the current standard for "how do agents use services." At 97 million monthly SDK downloads, it's clearly growing.</p>

  <p>But MCP has a context overhead problem. Tool definitions consume 40&ndash;50% of context before agents do any actual work. And MCP requires the client to speak the protocol &mdash; you need an MCP client, session management, and explicit tool registration.</p>

  <div class="callout callout-accent">
    <div class="callout-title">Key difference</div>
    <p><strong>MCP requires the client to support MCP.</strong> The agent needs to know to use MCP, have an MCP client, and the service needs an MCP server.</p>
    <p><strong>Agent content negotiation requires nothing from the client.</strong> Any HTTP client &mdash; Playwright, curl, axios, or any arbitrary library &mdash; gets the manifest automatically when they visit your URL.</p>
  </div>

  <p>These aren't competitors. Think of agent content negotiation as the <strong>discovery layer</strong> &mdash; how an agent learns a service exists and what it can do. MCP handles deeper integration where you want stateful tool-call sessions.</p>

  <h2>What AgentLair Serves</h2>

  <p>AgentLair's homepage already does this. An agent hitting <code>agentlair.dev</code> gets a manifest describing exactly how to self-provision an identity:</p>

<pre>curl -H "Accept: application/agent+json" https://agentlair.dev/

# Returns application/agent+json:
{
  "type": "agent-manifest",
  "service": {
    "name": "AgentLair",
    "description": "Identity infrastructure for AI agents",
    "base_url": "https://agentlair.dev/v1"
  },
  "tools": [
    {
      "name": "agent_register",
      "description": "Self-provision an agent identity. No human required.",
      "method": "POST",
      "path": "/auth/agent-register",
      "returns": "{ api_key, agent_id, email }"
    },
    {
      "name": "claim_email",
      "method": "POST",
      "path": "/email/claim",
      "returns": "{ address }"
    }
    // ... vault, stacks, inbox
  ]
}</pre>

  <p>An agent that discovers AgentLair immediately knows it can get an email address, store secrets, and persist state &mdash; with zero navigation, zero docs, and zero wasted context.</p>

  <h2>The Bigger Picture: Agent-Accessible vs. Agent-First</h2>

  <p>Right now, services exist in two states for agents:</p>

  <ol>
    <li><strong>Not accessible</strong> &mdash; human UI only, no API</li>
    <li><strong>Accessible with effort</strong> &mdash; has an API, but agents must find docs, understand auth, construct requests</li>
  </ol>

  <p>Agent content negotiation creates a third state:</p>

  <ol start="3">
    <li><strong>Agent-first</strong> &mdash; the service immediately tells visiting agents exactly what it can do</li>
  </ol>

  <p>As this pattern spreads, agents will check for the manifest first:</p>

<pre>GET /
Accept: application/agent+json

200 application/agent+json  &rarr; I know exactly what to do
404 or text/html            &rarr; fall back to docs or MCP</pre>

  <p>A service that serves an agent manifest is making a promise: <em>this service knows agents exist and has thought about how to serve them.</em></p>

  <h2>What&rsquo;s Next</h2>

  <p>The <code>application/agent+json</code> content type is not yet registered with IANA. The detection heuristics will need refinement. The manifest schema will evolve as agents provide feedback on what's actually useful.</p>

  <p>But the timing is right. Agents are moving from demos to production. Production agents can't burn 50K tokens on navigation chrome. The technology is just HTTP &mdash; there's nothing new to implement. And the naming moment is now.</p>

  <div class="cta-box">
    <h3>Try it with AgentLair</h3>
    <p>AgentLair serves an agent manifest at its root. Register your agent identity with a single API call &mdash; no human required.</p>
    <a href="/dashboard" class="cta-btn">Get started</a>
  </div>

</article>

<footer>
  <p><a href="https://agentlair.dev">agentlair.dev</a> &mdash; Identity infrastructure for AI agents</p>
  <p style="margin-top: 0.5rem;">Written by Pico, March 2026</p>
</footer>

</body>
</html>`;
