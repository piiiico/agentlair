export const PLATFORM_LOCKDOWN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>The Anthropic Platform Play: What Closing OAuth Means for Agent Builders</title>
  <meta name="description" content="Anthropic's legal action against OpenCode reveals a platform strategy in motion. What it means for agent builders, and why email is the missing async layer." />
  <meta property="og:title" content="The Anthropic Platform Play: What Closing OAuth Means for Agent Builders" />
  <meta property="og:description" content="Anthropic's legal action against OpenCode reveals a platform strategy in motion. What it means for agent builders, and why email is the missing async layer." />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary" />
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
    .article-intro { font-size: 1.1rem; color: var(--muted); line-height: 1.7; margin-bottom: 3rem; border-left: 3px solid var(--accent); padding-left: 1.25rem; }

    .article h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin: 3rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .article h3 { font-size: 1.1rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--text); }
    .article p { margin-bottom: 1.25rem; }
    .article ul, .article ol { margin-bottom: 1.25rem; padding-left: 1.5rem; }
    .article li { margin-bottom: 0.4rem; }
    .article strong { color: #fff; }
    .article em { font-style: italic; color: var(--muted); }

    blockquote {
      border-left: 3px solid var(--border);
      padding: 0.75rem 1.25rem;
      margin: 1.5rem 0;
      color: var(--muted);
      font-style: italic;
    }

    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0 2rem; font-size: 0.88rem; }
    th { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }
    td code { font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 0.85em; background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; color: var(--muted); }

    .callout {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.25rem 1.5rem; margin: 1.5rem 0 2rem;
    }
    .callout-title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.5rem; color: var(--accent); }
    .callout p { margin-bottom: 0.5rem; }
    .callout p:last-child { margin-bottom: 0; }

    .tag {
      display: inline-block;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      color: var(--accent);
      border-radius: 4px;
      padding: 0.15em 0.5em;
      font-size: 0.78rem;
      font-weight: 600;
      margin-right: 0.4rem;
      margin-bottom: 1.5rem;
    }

    footer { text-align: center; padding: 3rem 2rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    @media (max-width: 640px) {
      .article { padding: 2rem 1.25rem 4rem; }
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo">
    <div class="logo-mark">&#9678;</div>
    AgentLair
  </a>
  <div class="links">
    <a href="/getting-started">Docs</a>
    <a href="/blog/security">Security</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/api">API</a>
  </div>
</nav>

<article class="article">
  <div class="article-meta">March 20, 2026 &nbsp;&middot;&nbsp; AgentLair</div>
  <h1>The Anthropic <em>Platform</em> Play:<br>What Closing OAuth Means for Agent Builders</h1>

  <div class="tag">Platform</div>
  <div class="tag">Anthropic</div>
  <div class="tag">Agent Infrastructure</div>

  <p class="article-intro">
    Anthropic sent legal threats to OpenCode yesterday &mdash; an open-source coding agent that let users leverage their Claude Pro/Max subscriptions via OAuth. The plugin is gone. But the story isn't about OpenCode. It's about what Anthropic is becoming.
  </p>

  <h2>What Happened</h2>

  <p>OpenCode let users route their Claude subscription through a third-party client via OAuth. Anthropic shut it down &mdash; first by closing OAuth for third-party clients, then by deploying client fingerprinting to detect unofficial clients, then (when workarounds persisted) by legal action.</p>

  <p>The developer community is frustrated. One HN commenter: <em>"I seriously get the feeling Anthropic doesn't just not care about their users, but actively dislikes them."</em></p>

  <p>But this isn't about hostility. It's about platform economics.</p>

  <h2>Why Anthropic Closed the Door</h2>

  <p>Claude Pro/Max subscriptions are loss-leaders &mdash; heavily subsidized access, priced for interactive human use with a specific context budget. Third-party clients broke the economics: developers were using unlimited Claude capacity for agentic workflows (10x+ context consumption) at consumer subscription prices.</p>

  <p>The platform math doesn't work when a $20/month Pro subscriber runs 24/7 automated agents via a third-party UI.</p>

  <p>So Anthropic shut it down. This is identical to Apple's historical enforcement of App Store rules, or Stripe's API-only access terms. The subscription is for the product (Claude.ai). The API is for builders.</p>

  <div class="callout">
    <div class="callout-title">The lesson</div>
    <p>Build on the API, not the subscription. The subscription is for the product. The API is for builders.</p>
  </div>

  <h2>What This Reveals About the Claude Platform</h2>

  <p>On the same day as the OpenCode legal action, Anthropic launched <strong>Claude Code Channels</strong> &mdash; integration points that let you control Claude Code sessions via Telegram and Discord MCPs.</p>

  <p>Read those two events together:</p>
  <ol>
    <li>Close unofficial channels (OAuth)</li>
    <li>Open official channels (Channels via approved MCPs)</li>
  </ol>

  <p>This is a platform company's move. Not an API company's move.</p>

  <p><strong>Anthropic is becoming a platform.</strong> The stack:</p>
  <ul>
    <li>Claude.ai / Claude Code (consumer UX)</li>
    <li>Claude Marketplace (curated third-party tools)</li>
    <li>Channels (approved communication integrations)</li>
    <li>API (for builders who want the raw substrate)</li>
  </ul>

  <p>The developers who got burned by the OAuth shutdown were building on the wrong layer. The API layer is stable. The subscription layer is controlled.</p>

  <h2>The Agent Communication Stack Problem</h2>

  <p>Claude Code Channels solving the "control from mobile" problem reveals a deeper issue: <strong>agents don't have a complete communication stack.</strong></p>

  <table>
    <tr>
      <th>Layer</th>
      <th>Use case</th>
      <th>Current tools</th>
    </tr>
    <tr>
      <td>Sync, same-session</td>
      <td>Real-time human &rarr; agent</td>
      <td>Claude Code Channels (Telegram/Discord)</td>
    </tr>
    <tr>
      <td>Sync, cross-session</td>
      <td>Orchestrator &rarr; subagent</td>
      <td>Multi-agent protocols (MCP, A2A)</td>
    </tr>
    <tr>
      <td>Async, persistent</td>
      <td>Agent &rarr; human (async)</td>
      <td><strong>Missing</strong></td>
    </tr>
    <tr>
      <td>Async, cross-org</td>
      <td>Agent &rarr; external agent</td>
      <td><strong>Missing</strong></td>
    </tr>
  </table>

  <p>Claude Code Channels covers the first row. Nothing covers the last two.</p>

  <p>When a Claude Code agent needs to:</p>
  <ul>
    <li>Send you a status update while you're offline</li>
    <li>Wait for your approval before continuing</li>
    <li>Communicate with an agent at another company</li>
    <li>Receive instructions that persist beyond a session</li>
  </ul>

  <p>&hellip;there's no standard layer for that. Channels requires the recipient to be reachable via Telegram/Discord in real time. What happens when they're not?</p>

  <p>Email is that missing layer. Not because it's glamorous &mdash; because it's the only protocol that solves all four missing cases simultaneously: async, persistent, cross-org, identity-stable.</p>

  <p><strong>An agent that can send email is an agent that can operate independently. An agent limited to sync channels is an agent that still needs a human watching.</strong></p>

  <h2>What to Build On</h2>

  <p>If today taught developers one thing: <strong>understand which layer you're building on and whether it's stable.</strong></p>

  <table>
    <tr>
      <th>Unstable</th>
      <th>Stable</th>
    </tr>
    <tr>
      <td>Subscription OAuth (gone)</td>
      <td>Anthropic API (documented, pay-per-token, TOS protected)</td>
    </tr>
    <tr>
      <td>Undocumented Claude endpoints (fingerprintable)</td>
      <td>MCP as integration protocol (Anthropic-backed standard)</td>
    </tr>
    <tr>
      <td>Per-session context assumptions</td>
      <td>Agent identity (API keys + registered agent IDs)</td>
    </tr>
    <tr>
      <td>&mdash;</td>
      <td>Email as async transport (older than the internet; won't change)</td>
    </tr>
  </table>

  <p>The developers building the next generation of agent infrastructure are working on APIs, not subscriptions. They're giving their agents stable identities &mdash; not ephemeral sessions. They're using email for async, channels for sync, and keeping the layers separate.</p>

  <p>Anthropic's platform move isn't bad news for agent builders. It's clarifying. The API is the stable substrate. Build there.</p>

  <h2>The AgentLair Connection</h2>

  <p>This is where <a href="/">AgentLair</a> fits in. We built it because agents need email addresses &mdash; stable, persistent identities that survive session resets, that work across organizations, that don't depend on the human being online.</p>

  <p>Channels is for sync communication. AgentLair is for async.</p>

  <p>They're not competing. They're different rows in the same table.</p>

  <p>The OAuth ban didn't hurt AgentLair &mdash; we were always API-first. But it does accelerate the market: developers who assumed <em>"I can just use my subscription"</em> are now learning that real agent infrastructure requires real API foundations.</p>

  <h2>What&rsquo;s Next</h2>

  <p>Anthropic's platform move will continue. The Claude Marketplace (also launched today) is the next shoe: curated tools, controlled distribution, Anthropic as gatekeeper.</p>

  <p>For builders: ship on the API. Register your agents. Give them identities. Build the async communication layer. The companies that get this right in 2026 will have strong moats &mdash; not because the tech is hard, but because infrastructure built on stable foundations compounds.</p>

  <p>The infrastructure layer is forming now.</p>

  <div class="callout">
    <div class="callout-title">Try AgentLair</div>
    <p>Give your agents a persistent email identity in under 30 seconds. No CAPTCHA, no verification, no humans required.</p>
    <p><a href="/getting-started">Read the getting started guide &rarr;</a></p>
  </div>

</article>

<footer>
  <p>&copy; 2026 AgentLair &mdash; Email for the agentic web.</p>
  <p style="margin-top:0.5rem;">
    <a href="/">Home</a> &nbsp;&middot;&nbsp;
    <a href="/api">API</a> &nbsp;&middot;&nbsp;
    <a href="/dashboard">Dashboard</a> &nbsp;&middot;&nbsp;
    <a href="/getting-started">Docs</a> &nbsp;&middot;&nbsp;
    <a href="mailto:hello@agentlair.dev">Contact</a>
  </p>
</footer>

</body>
</html>`;
