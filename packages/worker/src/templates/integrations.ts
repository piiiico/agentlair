export const INTEGRATIONS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Framework Integrations &mdash; AgentLair</title>
  <meta name="description" content="Integrate AgentLair email with LangChain, CrewAI, Vercel AI SDK, and Claude MCP. Give your AI agents a real email address in minutes." />
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
    nav .links a:hover { color: var(--text); text-decoration: none; }
    nav .links a.active { color: var(--accent); }
    .container { max-width: 760px; margin: 0 auto; padding: 3rem 2rem; }
    h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.75rem; }
    h1 em { color: var(--accent); font-style: normal; }
    .subtitle { font-size: 1.1rem; color: var(--muted); margin-bottom: 3rem; }
    .tab-bar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .tab { padding: 0.45rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted); transition: all 0.15s; }
    .tab.active { background: rgba(99,102,241,0.15); border-color: var(--accent); color: var(--accent); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .section-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem; margin-bottom: 1.5rem; }
    .section-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem; }
    .section-desc { color: var(--muted); font-size: 0.95rem; margin-bottom: 1.25rem; }
    .code-block { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 0.82rem; line-height: 1.75; overflow-x: auto; margin-bottom: 0.75rem; white-space: pre; }
    .c-muted { color: #555570; } .c-cmd { color: #c0a0e0; } .c-str { color: #a8d0a0; } .c-key { color: #7c9dce; } .c-ok { color: var(--green); } .c-fn { color: #e0c880; }
    .install-label { font-size: 0.78rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.4rem; }
    .note { background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: 8px; padding: 0.9rem 1.1rem; font-size: 0.88rem; color: var(--muted); margin-top: 0.75rem; }
    .note strong { color: var(--text); }
    .facts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; }
    @media (max-width: 560px) { .facts-grid { grid-template-columns: 1fr; } }
    .fact-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; font-size: 0.88rem; }
    .fact-item strong { color: var(--accent); display: block; margin-bottom: 0.25rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .next-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem; }
    @media (max-width: 560px) { .next-steps { grid-template-columns: 1fr; } }
    .next-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; text-decoration: none; transition: border-color 0.15s; display: block; }
    .next-card:hover { border-color: var(--accent); text-decoration: none; }
    .next-card h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.4rem; color: var(--text); }
    .next-card p { font-size: 0.85rem; color: var(--muted); }
    footer { padding: 3rem 2rem; border-top: 1px solid var(--border); text-align: center; font-size: 0.85rem; color: var(--muted); margin-top: 2rem; }
    footer a { color: var(--muted); }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><div class="logo-mark">&#x2B21;</div> AgentLair</a>
  <div class="links">
    <a href="/">Home</a>
    <a href="/integrations" class="active">Integrations</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/security">Security</a>
    <a href="/getting-started">Getting Started</a>
  </div>
</nav>

<div class="container">
  <h1>Framework <em>Integrations</em></h1>
  <p class="subtitle">Give your AI agents email with 3 lines of code. Works with every major agent framework.</p>

  <div class="tab-bar">
    <button class="tab active" onclick="showTab('langchain')">LangChain</button>
    <button class="tab" onclick="showTab('crewai')">CrewAI</button>
    <button class="tab" onclick="showTab('vercel')">Vercel AI SDK</button>
    <button class="tab" onclick="showTab('mcp')">MCP</button>
  </div>

  <!-- Tab: LangChain -->
  <div id="tab-langchain" class="tab-panel active">
    <div class="section-card">
      <div class="section-title">LangChain (TypeScript)</div>
      <div class="section-desc">Add email tools to any LangChain agent. Agents can send and receive email from a dedicated <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">@agentlair.dev</code> address.</div>

      <div class="install-label">Install</div>
      <div class="code-block"><span class="c-cmd">npm</span> install langchain @langchain/openai</div>

      <div class="install-label">Code</div>
      <div class="code-block"><span class="c-key">import</span> { tool } <span class="c-key">from</span> <span class="c-str">"@langchain/core/tools"</span>;
<span class="c-key">import</span> { z } <span class="c-key">from</span> <span class="c-str">"zod"</span>;

<span class="c-muted">// 1. Register your agent (one-time, no human required)</span>
<span class="c-key">const</span> reg = <span class="c-key">await</span> <span class="c-fn">fetch</span>(<span class="c-str">\`https://agentlair.dev/v1/auth/agent-register\`</span>, {
  method: <span class="c-str">"POST"</span>,
  headers: { <span class="c-str">"Content-Type"</span>: <span class="c-str">"application/json"</span> },
  body: <span class="c-fn">JSON.stringify</span>({ name: <span class="c-str">"my-langchain-agent"</span> }),
}).<span class="c-fn">then</span>(r =&gt; r.<span class="c-fn">json</span>());
<span class="c-muted">// =&gt; { api_key: "al_live_...", email_address: "my-langchain-agent@agentlair.dev" }</span>

<span class="c-muted">// 2. Define email tools</span>
<span class="c-key">const</span> sendEmail = <span class="c-fn">tool</span>(
  <span class="c-key">async</span> ({ to, subject, body }) =&gt; {
    <span class="c-key">const</span> res = <span class="c-key">await</span> <span class="c-fn">fetch</span>(<span class="c-str">\`https://agentlair.dev/v1/email/send\`</span>, {
      method: <span class="c-str">"POST"</span>,
      headers: {
        <span class="c-str">"Authorization"</span>: <span class="c-str">\`Bearer \${reg.api_key}\`</span>,
        <span class="c-str">"Content-Type"</span>: <span class="c-str">"application/json"</span>,
      },
      body: <span class="c-fn">JSON.stringify</span>({
        from: reg.email_address,
        to: [to], subject, text: body,
      }),
    });
    <span class="c-key">return</span> <span class="c-str">\`Sent! ID: \${(await res.json()).id}\`</span>;
  },
  {
    name: <span class="c-str">"send_email"</span>,
    description: <span class="c-str">"Send email from the agent's inbox"</span>,
    schema: z.<span class="c-fn">object</span>({
      to: z.<span class="c-fn">string</span>(), subject: z.<span class="c-fn">string</span>(), body: z.<span class="c-fn">string</span>(),
    }),
  }
);</div>

      <div class="note">
        <strong>How it works:</strong> <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">agent-register</code> creates a persistent agent identity with a real email address. No human verification required &mdash; your agent owns its inbox from the first request.
      </div>
    </div>
  </div>

  <!-- Tab: CrewAI -->
  <div id="tab-crewai" class="tab-panel">
    <div class="section-card">
      <div class="section-title">CrewAI (Python)</div>
      <div class="section-desc">Equip CrewAI agents with full send/receive email capabilities. Each agent gets its own <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">@agentlair.dev</code> mailbox.</div>

      <div class="install-label">Install</div>
      <div class="code-block"><span class="c-cmd">pip</span> install crewai requests</div>

      <div class="install-label">Code</div>
      <div class="code-block"><span class="c-key">import</span> requests
<span class="c-key">from</span> crewai <span class="c-key">import</span> Agent, Task, Crew
<span class="c-key">from</span> crewai.tools <span class="c-key">import</span> tool

BASE = <span class="c-str">"https://agentlair.dev"</span>

<span class="c-muted"># 1. Register your agent (one-time, no human required)</span>
reg = requests.<span class="c-fn">post</span>(<span class="c-str">f"{BASE}/v1/auth/agent-register"</span>,
    json={<span class="c-str">"name"</span>: <span class="c-str">"my-crewai-agent"</span>}).<span class="c-fn">json</span>()
<span class="c-muted"># =&gt; {"api_key": "al_live_...", "email_address": "my-crewai-agent@agentlair.dev"}</span>

HEADERS = {<span class="c-str">"Authorization"</span>: <span class="c-str">f"Bearer {reg['api_key']}"</span>,
           <span class="c-str">"Content-Type"</span>: <span class="c-str">"application/json"</span>}

<span class="c-muted"># 2. Define email tools</span>
<span class="c-fn">@tool</span>(<span class="c-str">"send_email"</span>)
<span class="c-key">def</span> <span class="c-fn">send_email</span>(to: str, subject: str, body: str) -&gt; str:
    <span class="c-str">"""Send an email from the agent's inbox."""</span>
    resp = requests.<span class="c-fn">post</span>(<span class="c-str">f"{BASE}/v1/email/send"</span>, headers=HEADERS,
        json={<span class="c-str">"from"</span>: reg[<span class="c-str">"email_address"</span>], <span class="c-str">"to"</span>: [to],
              <span class="c-str">"subject"</span>: subject, <span class="c-str">"text"</span>: body})
    <span class="c-key">return</span> <span class="c-str">f"Sent! ID: {resp.json()['id']}"</span>

<span class="c-fn">@tool</span>(<span class="c-str">"check_inbox"</span>)
<span class="c-key">def</span> <span class="c-fn">check_inbox</span>() -&gt; str:
    <span class="c-str">"""Check the agent's inbox for new messages."""</span>
    resp = requests.<span class="c-fn">get</span>(<span class="c-str">f"{BASE}/v1/email/inbox"</span>,
        headers=HEADERS,
        params={<span class="c-str">"address"</span>: reg[<span class="c-str">"email_address"</span>]})
    msgs = resp.<span class="c-fn">json</span>().<span class="c-fn">get</span>(<span class="c-str">"messages"</span>, [])
    <span class="c-key">return</span> <span class="c-str">"\n"</span>.<span class="c-fn">join</span>(<span class="c-str">f"From: {m['from']} | {m['subject']}"</span> <span class="c-key">for</span> m <span class="c-key">in</span> msgs)

<span class="c-muted"># 3. Create agent with email tools</span>
agent = <span class="c-fn">Agent</span>(
    role=<span class="c-str">"Email Agent"</span>,
    goal=<span class="c-str">"Monitor inbox and send responses"</span>,
    tools=[send_email, check_inbox],
)</div>

      <div class="note">
        <strong>How it works:</strong> Each tool is a plain Python function decorated with <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">@tool</code>. CrewAI picks up tool descriptions automatically &mdash; no manual schema required.
      </div>
    </div>
  </div>

  <!-- Tab: Vercel AI SDK -->
  <div id="tab-vercel" class="tab-panel">
    <div class="section-card">
      <div class="section-title">Vercel AI SDK (TypeScript)</div>
      <div class="section-desc">Drop-in email tool for any <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">generateText</code> or <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">streamText</code> call. Works with GPT-4o, Claude, Gemini &mdash; any model.</div>

      <div class="install-label">Install</div>
      <div class="code-block"><span class="c-cmd">npm</span> install ai @ai-sdk/openai</div>

      <div class="install-label">Code</div>
      <div class="code-block"><span class="c-key">import</span> { generateText, tool } <span class="c-key">from</span> <span class="c-str">"ai"</span>;
<span class="c-key">import</span> { openai } <span class="c-key">from</span> <span class="c-str">"@ai-sdk/openai"</span>;
<span class="c-key">import</span> { z } <span class="c-key">from</span> <span class="c-str">"zod"</span>;

<span class="c-key">const</span> BASE = <span class="c-str">"https://agentlair.dev"</span>;

<span class="c-muted">// 1. Register your agent</span>
<span class="c-key">const</span> reg = <span class="c-key">await</span> <span class="c-fn">fetch</span>(<span class="c-str">\`\${BASE}/v1/auth/agent-register\`</span>, {
  method: <span class="c-str">"POST"</span>,
  headers: { <span class="c-str">"Content-Type"</span>: <span class="c-str">"application/json"</span> },
  body: <span class="c-fn">JSON.stringify</span>({ name: <span class="c-str">"my-vercel-agent"</span> }),
}).<span class="c-fn">then</span>(r =&gt; r.<span class="c-fn">json</span>());

<span class="c-muted">// 2. Use as an AI SDK tool</span>
<span class="c-key">const</span> { text } = <span class="c-key">await</span> <span class="c-fn">generateText</span>({
  model: <span class="c-fn">openai</span>(<span class="c-str">"gpt-4o"</span>),
  tools: {
    sendEmail: <span class="c-fn">tool</span>({
      description: <span class="c-str">"Send email from the agent's inbox"</span>,
      parameters: z.<span class="c-fn">object</span>({
        to: z.<span class="c-fn">string</span>(), subject: z.<span class="c-fn">string</span>(), body: z.<span class="c-fn">string</span>(),
      }),
      execute: <span class="c-key">async</span> ({ to, subject, body }) =&gt; {
        <span class="c-key">const</span> res = <span class="c-key">await</span> <span class="c-fn">fetch</span>(<span class="c-str">\`\${BASE}/v1/email/send\`</span>, {
          method: <span class="c-str">"POST"</span>,
          headers: {
            <span class="c-str">"Authorization"</span>: <span class="c-str">\`Bearer \${reg.api_key}\`</span>,
            <span class="c-str">"Content-Type"</span>: <span class="c-str">"application/json"</span>,
          },
          body: <span class="c-fn">JSON.stringify</span>({
            from: reg.email_address,
            to: [to], subject, text: body,
          }),
        });
        <span class="c-key">return</span> (<span class="c-key">await</span> res.<span class="c-fn">json</span>());
      },
    }),
  },
  prompt: <span class="c-str">"Send a welcome email to user@example.com"</span>,
});</div>

      <div class="note">
        <strong>How it works:</strong> The <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">tool()</code> helper from the AI SDK wraps the AgentLair REST call. Works with any model that supports tool use &mdash; just swap <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">openai()</code> for <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">anthropic()</code>, <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">google()</code>, etc.
      </div>
    </div>
  </div>

  <!-- Tab: MCP -->
  <div id="tab-mcp" class="tab-panel">
    <div class="section-card">
      <div class="section-title">MCP (Claude Desktop / Cursor)</div>
      <div class="section-desc">Add AgentLair as an MCP server. Your AI assistant gets 13 tools automatically — email (<code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">send_email</code>, <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">check_inbox</code>, <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">claim_address</code>) and calendar (<code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">create_event</code>, <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">list_events</code>, <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">update_event</code>, <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">delete_event</code>, <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">get_ical_feed</code>).</div>

      <div class="install-label">Install</div>
      <div class="code-block"><span class="c-cmd">npx</span> @agentlair/mcp@latest</div>

      <div class="install-label">Claude Desktop / Cursor config</div>
      <div class="code-block">{
  <span class="c-key">"mcpServers"</span>: {
    <span class="c-key">"agentlair"</span>: {
      <span class="c-key">"command"</span>: <span class="c-str">"npx"</span>,
      <span class="c-key">"args"</span>: [<span class="c-str">"@agentlair/mcp@latest"</span>],
      <span class="c-key">"env"</span>: {
        <span class="c-key">"AGENTLAIR_API_KEY"</span>: <span class="c-str">"al_live_..."</span>
      }
    }
  }
}</div>

      <div class="note">
        <strong>How it works:</strong> Add this to your <code style="background:var(--code-bg);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">claude_desktop_config.json</code> or Cursor MCP settings. Restart the app and AgentLair tools appear automatically in Claude's tool list. Get your API key at <a href="/#web-signup">agentlair.dev</a>.
      </div>
    </div>
  </div>

  <!-- Key Facts -->
  <h2 style="font-size:1.1rem; font-weight:700; margin-bottom:1rem; margin-top:2rem;">Key Facts</h2>
  <div class="facts-grid">
    <div class="fact-item">
      <strong>Self-registration</strong>
      <code style="font-size:0.85em; background:var(--code-bg); padding:0.1em 0.3em; border-radius:3px;">POST /v1/auth/agent-register</code> &mdash; no human verification needed
    </div>
    <div class="fact-item">
      <strong>Free Tier</strong>
      100 API requests/day, 50 emails/day, 10 addresses
    </div>
    <div class="fact-item">
      <strong>API Docs</strong>
      Full reference at <a href="/api">/api</a>
    </div>
    <div class="fact-item">
      <strong>Need Help?</strong>
      <a href="mailto:hello@agentlair.dev">hello@agentlair.dev</a>
    </div>
  </div>

  <!-- Next Steps -->
  <h2 style="font-size:1.1rem; font-weight:700; margin-bottom:1rem; margin-top:1rem;">Next Steps</h2>
  <div class="next-steps">
    <a href="/api" class="next-card">
      <h3>&#x1F4D6; API Reference</h3>
      <p>Full endpoint documentation with request/response examples.</p>
    </a>
    <a href="/getting-started" class="next-card">
      <h3>&#x1F680; Getting Started</h3>
      <p>Step-by-step guide to claiming your first agent email address.</p>
    </a>
    <a href="/vault" class="next-card">
      <h3>&#x1F510; Vault (Secret Storage)</h3>
      <p>Store API keys and secrets securely for your agents.</p>
    </a>
    <a href="/calendar" class="next-card">
      <h3>&#x1F4C5; Agent Calendar</h3>
      <p>Create events via REST. Share an iCal feed. Humans subscribe in any calendar app.</p>
    </a>
  </div>
</div>

<footer>
  <a href="/">AgentLair</a> &nbsp;&middot;&nbsp;
  <a href="/integrations">Integrations</a> &nbsp;&middot;&nbsp;
  <a href="/getting-started">Getting Started</a> &nbsp;&middot;&nbsp;
  <a href="/api">API</a> &nbsp;&middot;&nbsp;
  <a href="/dashboard">Dashboard</a> &nbsp;&middot;&nbsp;
  <a href="/calendar">Calendar</a> &nbsp;&middot;&nbsp;
  <a href="/security">Security</a> &nbsp;&middot;&nbsp;
  <a href="mailto:hello@agentlair.dev">Contact</a>
</footer>

<script>
  function showTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    event.currentTarget.classList.add('active');
  }
</script>
</body>
</html>
`;
