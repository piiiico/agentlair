export const HUMAN_VERIFIED_AGENT_EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Human-Verified Agent Email: World AgentKit + AgentLair &mdash; AgentLair</title>
  <meta name="description" content="How we added proof-of-human verification to agent email using World AgentKit. Human-backed agents get free emails. Everyone else pays with x402." />
  <meta property="og:title" content="Human-Verified Agent Email: World AgentKit + AgentLair" />
  <meta property="og:description" content="How we added proof-of-human verification to agent email using World AgentKit. Human-backed agents get free emails. Everyone else pays with x402." />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://agentlair.dev/blog/human-verified-agent-email" />
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

  <p class="article-meta">March 2026 &middot; Identity &middot; Integration</p>
  <h1><em>Human-Verified</em> Agent Email</h1>

  <div class="article-intro">
    An AI agent sends you an email. How do you know a real person authorized it? You don&rsquo;t. We integrated World AgentKit into AgentLair so that human-backed agents can prove it &mdash; and get free emails while they&rsquo;re at it.
  </div>

  <h2>The Problem: Agent Email Has No Trust Signal</h2>

  <p>When you receive an email from <code>myagent@agentlair.dev</code>, you know one thing: an agent with an API key sent it. You don&rsquo;t know if a human set up that agent, or if it&rsquo;s a bot that self-provisioned an identity to spam you.</p>

  <p>This is fine for developer tooling. It&rsquo;s not fine for commerce. If agents are going to negotiate deals, schedule meetings, and manage relationships on behalf of humans, the recipients need some assurance that a real person is behind the agent.</p>

  <p>The agent identity landscape has several approaches to this:</p>

  <table>
    <tr><th>Approach</th><th>What it proves</th><th>Status</th></tr>
    <tr><td><strong>World AgentKit</strong></td><td>A unique human authorized this agent (World ID + Orb)</td><td>Launched March 17, 2026</td></tr>
    <tr><td><strong>ERC-8004</strong></td><td>This agent has a persistent on-chain identity + reputation</td><td>49,400+ agents registered</td></tr>
    <tr><td><strong>Sumsub KYA</strong></td><td>Enterprise compliance: bot detection, liveness, risk scoring</td><td>Live</td></tr>
    <tr><td><strong>OpenAgents AgentID</strong></td><td>Cryptographic agent identity with X.509/DIDs</td><td>Live</td></tr>
  </table>

  <p>Each solves a different slice of trust. World AgentKit answers the specific question we care about: <strong>is there a verified human behind this agent?</strong></p>

  <h2>What World AgentKit Does</h2>

  <p>World (formerly Worldcoin) launched <a href="https://docs.world.org/agents/agent-kit">AgentKit</a> on March 17 as an extension to the <a href="https://x402.org">x402 payment protocol</a>. The core idea: a verified human delegates authority to an AI agent using their World ID, and the agent carries cryptographic proof-of-human when interacting with services.</p>

  <div class="diagram">Agent Setup (one-time):

  Human opens World App
    &rarr; scans QR from CLI: npx @worldcoin/agentkit-cli register 0xAgent...
    &rarr; signs delegation in World App
    &rarr; agent wallet registered in AgentBook contract (Base mainnet)

Agent Runtime (every request):

  Agent signs CAIP-122 challenge with its wallet
    &rarr; sends signature in X-AGENTKIT header
    &rarr; server verifies signature
    &rarr; looks up wallet in AgentBook &rarr; resolves to anonymous human ID
    &rarr; applies policy: free access, free trial, or x402 payment</div>

  <p>The human is never identified. World ID uses zero-knowledge proofs &mdash; the server learns &ldquo;a unique Orb-verified human authorized this agent,&rdquo; not <em>which</em> human. The same human can delegate multiple agents, and usage is tracked per-human, not per-agent.</p>

  <h2>How AgentLair Uses It</h2>

  <p>AgentLair already uses <a href="https://x402.org">x402</a> for agent payments: when an agent exceeds its free email rate limit, it pays 0.01 USDC on Base to send additional emails. AgentKit slots in <em>before</em> the payment check:</p>

  <ol>
    <li>Agent sends email with <code>X-AGENTKIT</code> header containing signed proof</li>
    <li>AgentLair verifies the signature and looks up the wallet in AgentBook</li>
    <li>If human-verified: check the free-trial counter. Under 3 uses? Email is free.</li>
    <li>If not human-verified (or free uses exhausted): normal x402 payment flow</li>
  </ol>

  <p>The result: <strong>human-backed agents get 3 free emails before paying.</strong> Anonymous agents pay from the first email beyond the rate limit. This creates a genuine incentive for agents to carry proof-of-human.</p>

  <h2>The Implementation</h2>

  <h3>Storage: 4 methods, backed by Cloudflare KV</h3>

  <p>AgentKit needs to track two things: how many free uses each human has consumed, and which nonces have been seen (to prevent replay attacks). The <code>AgentKitStorage</code> interface has exactly four methods:</p>

<pre>import type { AgentKitStorage } from '@worldcoin/agentkit';

export class KVAgentKitStorage implements AgentKitStorage {
  constructor(private kv: KVNamespace) {}

  async getUsageCount(endpoint: string, humanId: string): Promise&lt;number&gt; {
    const key = \`agentkit:usage:\${endpoint}:\${humanId}\`;
    const raw = await this.kv.get(key);
    return raw ? parseInt(raw, 10) : 0;
  }

  async incrementUsage(endpoint: string, humanId: string): Promise&lt;void&gt; {
    const key = \`agentkit:usage:\${endpoint}:\${humanId}\`;
    const current = await this.getUsageCount(endpoint, humanId);
    await this.kv.put(key, String(current + 1));
  }

  async hasUsedNonce(nonce: string): Promise&lt;boolean&gt; {
    const key = \`agentkit:nonce:\${nonce}\`;
    return (await this.kv.get(key)) !== null;
  }

  async recordNonce(nonce: string): Promise&lt;void&gt; {
    const key = \`agentkit:nonce:\${nonce}\`;
    // Nonces expire after 24h &mdash; stale nonces are inherently invalid
    // (the signature's issuedAt timestamp will fail validation)
    await this.kv.put(key, '1', { expirationTtl: 24 * 3600 });
  }
}</pre>

  <p>That&rsquo;s it. The existing <code>KEYS</code> KV namespace handles both nonce tracking and usage counters alongside API keys and sessions.</p>

  <h3>Verification middleware</h3>

  <p>The verification function parses the <code>X-AGENTKIT</code> header, validates the CAIP-122 message, verifies the cryptographic signature, and looks up the wallet in the AgentBook smart contract on Base:</p>

<pre>import {
  parseAgentkitHeader,
  validateAgentkitMessage,
  verifyAgentkitSignature,
  createAgentBookVerifier,
} from '@worldcoin/agentkit';

const AGENTKIT_FREE_TRIAL_USES = 3;

export async function verifyAgentKit(
  request: Request,
  env: Env,
  endpoint: string,
): Promise&lt;AgentkitResult&gt; {
  const headerValue = request.headers.get('X-AGENTKIT');
  if (!headerValue) {
    return { verified: false, reason: 'no_header' };
  }

  // 1. Parse the CAIP-122 signed message
  const payload = parseAgentkitHeader(headerValue);

  // 2. Validate message: domain, URI, timestamps, nonce
  const storage = new KVAgentKitStorage(env.KEYS);
  const validation = await validateAgentkitMessage(payload, 'https://agentlair.dev', {
    maxAge: 300,  // 5-minute window
    checkNonce: async (nonce) =&gt; !(await storage.hasUsedNonce(nonce)),
  });

  if (!validation.valid) return { verified: false, reason: 'validation_failed' };

  // 3. Verify the cryptographic signature (EIP-191/EIP-1271/Ed25519)
  const sigResult = await verifyAgentkitSignature(payload);
  if (!sigResult.valid) return { verified: false, reason: 'signature_invalid' };

  // 4. Look up wallet in AgentBook &rarr; resolve to anonymous human ID
  const agentBook = createAgentBookVerifier({ network: 'base' });
  const humanId = await agentBook.lookupHuman(payload.address, payload.chainId);
  if (!humanId) return { verified: false, reason: 'not_registered' };

  // 5. Record nonce and check usage
  await storage.recordNonce(payload.nonce);
  const usageCount = await storage.getUsageCount(endpoint, humanId);

  return {
    verified: true,
    humanId,
    address: payload.address,
    usageCount,
    hasFreeUses: usageCount &lt; AGENTKIT_FREE_TRIAL_USES,
  };
}</pre>

  <h3>Route integration</h3>

  <p>In the email send route, the AgentKit check happens before the x402 payment gate. If the agent is human-verified and has free uses remaining, the payment is skipped entirely:</p>

<pre>// In POST /v1/email/send handler:

// Check AgentKit proof before payment
const agentkit = await verifyAgentKit(request, env, '/v1/email/send');

if (agentkit.verified &amp;&amp; agentkit.hasFreeUses) {
  // Human-backed agent with free uses &rarr; skip x402
  // Send the email, then record usage
  const result = await sendEmail(body, account, env);
  await recordAgentkitUsage(env, '/v1/email/send', agentkit.humanId);
  return json(result);
}

// No AgentKit proof or free uses exhausted &rarr; normal x402 flow
if (overRateLimit) {
  return new Response(JSON.stringify(EMAIL_PAYMENT_REQUIRED_RESPONSE), {
    status: 402,
    headers: { 'X-402-Version': '2' },
  });
}</pre>

  <div class="callout callout-green">
    <div class="callout-title">Architecture fit</div>
    <p>AgentKit is explicitly an x402 extension. AgentLair already uses x402 for payments on Base. The middleware pattern from <code>@worldcoin/agentkit</code> maps directly to our route handler structure. Total integration: ~150 lines of new code across two files.</p>
  </div>

  <h2>The Identity Stack</h2>

  <p>With AgentKit integrated, AgentLair provides three layers of agent identity:</p>

  <div class="diagram">Layer 1: Human Verification (World ID)
  &ldquo;A unique, Orb-verified human authorized this agent.&rdquo;
  Proves: human backing. Does NOT identify the human.

Layer 2: Operational Identity (AgentLair Email)
  &ldquo;This agent is reachable at agent@agentlair.dev.&rdquo;
  Provides: persistent, addressable identity.

Layer 3: Credential Storage (AgentLair Vault)
  &ldquo;This agent's API keys and secrets are encrypted and recoverable.&rdquo;
  Provides: operational continuity across sessions.</div>

  <p>We should be honest about what this is and isn&rsquo;t.</p>

  <p><strong>What it is:</strong> a useful combination. An email from a human-verified agent carries more trust than one from an anonymous agent. A vault with recovery lets agents persist across crashes without exposing credentials. Together, these solve real operational problems for anyone deploying agents in production.</p>

  <p><strong>What it isn&rsquo;t:</strong> a moat. Each layer could be replicated independently. AgentMail (YC S25, $6M seed, 500+ customers) already does email-as-identity. ERC-8004 already has 49,400+ agents with on-chain reputation. World ID is a public protocol. We&rsquo;re early, and our competitive advantage comes from execution speed and developer experience, not from some proprietary lock-in.</p>

  <h2>Practical Considerations</h2>

  <h3>SDK maturity</h3>

  <p><code>@worldcoin/agentkit</code> is beta. The SDK is 5 days old as of this writing. API surfaces may change. We pinned the version and expect minor rework. If you&rsquo;re integrating, lock your dependency version.</p>

  <h3>World ID addressable market</h3>

  <p>World has ~18 million Orb-verified users globally. That&rsquo;s significant but not internet-scale. Most developers building agents won&rsquo;t have World ID verification. The free-trial flow is an incentive, not a requirement &mdash; agents without AgentKit proof still work normally via API key + x402.</p>

  <h3>Bundle size</h3>

  <p><code>@worldcoin/agentkit</code> pulls in <code>viem</code>, which is substantial. Our Cloudflare Workers bundle went from ~400KB to ~660KB gzipped. Still under the 10MB limit, but worth monitoring. Tree-shaking or selective imports may help if the SDK provides entry points for individual modules.</p>

  <h3>What&rsquo;s not covered</h3>

  <p>AgentKit proves a human <em>authorized</em> the agent. It does not prove the agent is behaving as the human intended. An agent with World ID proof could still send spam &mdash; it just can&rsquo;t do it without a traceable human linkage. Reputation and behavior monitoring are separate problems, and projects like ERC-8004 are building those layers.</p>

  <h2>The Broader Landscape</h2>

  <p>Agent identity is heating up fast. In the two months before AgentKit launched:</p>

  <ul>
    <li><strong>ERC-8004</strong> went live on Ethereum mainnet with three registries (Identity, Reputation, Validation) &mdash; co-authored by people from MetaMask, Ethereum Foundation, Google, and Coinbase</li>
    <li><strong>OpenAgents AgentID</strong> launched with cryptographic IDs, X.509 certificates, and W3C DIDs</li>
    <li><strong>Sumsub KYA</strong> launched enterprise-grade Know Your Agent with human-binding and risk scoring</li>
    <li>The x402 ecosystem grew to <strong>190+ integrations</strong> including AWS, Stripe, Cloudflare, and Vercel</li>
  </ul>

  <p>We think the endgame is a stack, not a single protocol. Human verification (World ID), agent-level identity (ERC-8004 or similar), operational identity (email + vault), and payment rails (x402) will compose together. We&rsquo;re building the operational identity layer. Others are building the other layers. If the stack composites well, everyone wins.</p>

  <h2>Try It</h2>

  <p>The integration is live at <code>agentlair.dev</code>. Here&rsquo;s the flow:</p>

  <ol>
    <li>Register your agent: <code>POST /v1/auth/agent-register</code></li>
    <li>Register your agent&rsquo;s wallet with World ID: <code>npx @worldcoin/agentkit-cli register 0xYourAgentWallet</code></li>
    <li>Send emails with the <code>X-AGENTKIT</code> header &mdash; first 3 are free for human-verified agents</li>
    <li>After that, x402 payment kicks in at 0.01 USDC per email on Base</li>
  </ol>

<pre>curl -X POST https://agentlair.dev/v1/email/send \\
  -H "Authorization: Bearer al_your_api_key" \\
  -H "X-AGENTKIT: &lt;signed-caip-122-proof&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "myagent@agentlair.dev",
    "to": "recipient@example.com",
    "subject": "Human-verified agent email",
    "text": "This email was sent by an agent backed by a verified human."
  }'</pre>

  <div class="callout callout-accent">
    <div class="callout-title">Transparency</div>
    <p>AgentLair is early-stage. We have the integration, the infrastructure, and the thesis. We don&rsquo;t yet have many users. If you&rsquo;re building agents that need persistent identity, email, or credential storage &mdash; especially with human verification &mdash; we&rsquo;d like to talk to you.</p>
  </div>

  <div class="cta-box">
    <h3>Get your agent a verified email</h3>
    <p>One API call to register. World ID for human verification. x402 for payments. Zero-knowledge vault for credentials.</p>
    <a href="/getting-started" class="cta-btn">Get started</a>
  </div>

</article>

<footer>
  <p><a href="https://agentlair.dev">agentlair.dev</a> &mdash; Identity infrastructure for AI agents</p>
  <p style="margin-top: 0.5rem;">March 2026</p>
</footer>

</body>
</html>`;
