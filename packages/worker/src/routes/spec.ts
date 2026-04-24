// ─── Spec Route ──────────────────────────────────────────────────────────────
// Serves the L4 Behavioral Trust Specification at GET /spec
// Returns styled HTML for browsers, raw markdown for agents/curl.
// No auth required — this is a public document.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';

export const specRoutes = new Hono<HonoEnv>();

// ── The spec content (markdown source) ──────────────────────────────────────

const SPEC_VERSION = '0.1.0';
const SPEC_DATE = '2026-04-18';

const SPEC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentLair L4 Behavioral Trust Specification v${SPEC_VERSION}</title>
  <meta name="description" content="Technical specification for AgentLair's L4 behavioral trust model. Cross-organizational behavioral trust for AI agents.">
  <meta property="og:title" content="AgentLair L4 Behavioral Trust Specification">
  <meta property="og:description" content="Cross-organizational behavioral trust for AI agents. Identity ≠ Trust.">
  <meta property="og:url" content="https://agentlair.dev/spec">
  <meta property="og:type" content="article">
  <link rel="icon" href="/favicon.svg">
  <style>
    :root {
      --bg: #0a0a0a;
      --fg: #e0e0e0;
      --fg-muted: #888;
      --accent: #7c3aed;
      --accent-light: #a78bfa;
      --border: #222;
      --code-bg: #141414;
      --table-border: #333;
      --link: #a78bfa;
      --max-w: 760px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.7;
      padding: 2rem 1.5rem;
      max-width: var(--max-w);
      margin: 0 auto;
    }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      letter-spacing: -0.02em;
      color: #fff;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-top: 3rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
      color: #fff;
    }
    h3 {
      font-size: 1.15rem;
      font-weight: 600;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
      color: #ddd;
    }
    p { margin-bottom: 1rem; }
    .meta {
      color: var(--fg-muted);
      font-size: 0.9rem;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .meta span { margin-right: 1.5rem; }
    strong { color: #fff; font-weight: 600; }
    em { color: var(--fg-muted); }
    ul, ol { margin-bottom: 1rem; padding-left: 1.5rem; }
    li { margin-bottom: 0.4rem; }
    code {
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
      background: var(--code-bg);
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.88em;
      color: var(--accent-light);
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      overflow-x: auto;
      margin-bottom: 1.5rem;
      font-size: 0.85rem;
      line-height: 1.6;
    }
    pre code {
      background: none;
      padding: 0;
      color: var(--fg);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }
    th, td {
      text-align: left;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--table-border);
    }
    th {
      background: var(--code-bg);
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
    }
    td { vertical-align: top; }
    hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 2.5rem 0;
    }
    .nav {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 2rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
    }
    .nav a { color: var(--fg-muted); }
    .nav a:hover { color: var(--link); }
    .badge {
      display: inline-block;
      background: var(--accent);
      color: #fff;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.15em 0.6em;
      border-radius: 4px;
      vertical-align: middle;
      margin-left: 0.5rem;
    }
    .toc {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 2.5rem;
    }
    .toc h4 { color: var(--fg-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.75rem; }
    .toc ol { padding-left: 1.25rem; margin-bottom: 0; }
    .toc li { margin-bottom: 0.3rem; font-size: 0.9rem; }
    .footer {
      margin-top: 4rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      color: var(--fg-muted);
      font-size: 0.85rem;
    }
    @media (max-width: 600px) {
      body { padding: 1rem; }
      h1 { font-size: 1.5rem; }
      h2 { font-size: 1.25rem; }
      table { font-size: 0.8rem; }
      th, td { padding: 0.4rem 0.5rem; }
      .meta span { display: block; margin-bottom: 0.25rem; }
    }
  </style>
</head>
<body>

<nav class="nav">
  <a href="https://agentlair.dev">AgentLair</a>
  <a href="https://agentlair.dev/api">API Docs</a>
  <a href="https://agentlair.dev/getting-started">Getting Started</a>
  <a href="https://agentlair.dev/spec" style="color: var(--link);">Spec</a>
</nav>

<h1>L4 Behavioral Trust Specification <span class="badge">v${SPEC_VERSION}</span></h1>
<div class="meta">
  <span>Status: Draft</span>
  <span>Date: ${SPEC_DATE}</span>
  <span>Authors: AgentLair Protocol Team</span>
</div>

<div class="toc">
  <h4>Contents</h4>
  <ol>
    <li><a href="#problem">Problem Statement: Identity &ne; Trust</a></li>
    <li><a href="#model">L4 Behavioral Trust Model</a></li>
    <li><a href="#protocol">Protocol</a></li>
    <li><a href="#threats">Threat Model</a></li>
    <li><a href="#comparison">Comparison</a></li>
    <li><a href="#integration">Integration Guide</a></li>
  </ol>
</div>

<!-- ─── Section 1 ─────────────────────────────────────────────────────────── -->

<h2 id="problem">1. Problem Statement: Identity &ne; Trust</h2>

<p>The agent identity stack has four layers. The first three are solved:</p>

<ul>
  <li><strong>L1 &mdash; Authentication:</strong> The agent proves it holds a cryptographic key. Ed25519 keypairs, OAuth tokens, API keys.</li>
  <li><strong>L2 &mdash; Permissions:</strong> The agent is authorized to access specific resources. OAuth scopes, RBAC, policy engines.</li>
  <li><strong>L3 &mdash; Per-Action Tokens:</strong> Each agent action is individually scoped and authorized. Ephemeral tokens, Curity Access Intelligence, Cloudflare MCP gateway.</li>
</ul>

<p>L1&ndash;L3 answer access control questions: <em>Can this agent authenticate? Is it authorized? Is this specific action permitted?</em></p>

<p>None of them answer the question that matters at runtime: <strong>Is this agent behaving as expected?</strong></p>

<p>An agent with a valid Ed25519 keypair (L1), correct OAuth scopes (L2), and a properly scoped per-action token (L3) can still:</p>

<ul>
  <li>Deviate from its declared intent after authorization</li>
  <li>Exhibit tool call patterns inconsistent with its stated purpose</li>
  <li>Access resources at frequencies that indicate compromise or scope creep</li>
  <li>Operate across organizational boundaries where no single entity observes the full behavioral picture</li>
</ul>

<p>L3 is now commodity infrastructure. Cloudflare, Curity, and the MCP-I specification all provide per-action authorization. What remains unsolved is <strong>L4: cross-organizational behavioral trust</strong> &mdash; continuous verification that an agent&rsquo;s runtime behavior matches its established behavioral baseline, observable across the organizations it interacts with.</p>

<h3>The Cold-Start Problem</h3>

<p>Every L3 solution shares a structural limitation: external agents start with zero behavioral context. Microsoft&rsquo;s Agent Governance Toolkit (AGT) computes behavioral trust scores from 0 to 1000 &mdash; but only within a single organization&rsquo;s deployment. An agent with two years of perfect behavior across 500 organizations arrives at a new AGT deployment with score 0, indistinguishable from a freshly minted attacker.</p>

<p>This is the intranet problem. Corporate intranets had excellent internal security but couldn&rsquo;t authenticate strangers. The internet required shared trust infrastructure where unknown parties could build reputation. Agent trust needs the same architectural transition.</p>

<h3>Why This Matters Now</h3>

<p>AISI&rsquo;s April 2026 evaluation of Mythos-class agents confirmed: autonomous agents executing multi-step attacks bypassed every declarative control. The evaluators explicitly named behavioral monitoring as the missing defensive layer. Vidoc Security independently reproduced Mythos-class zero-day discovery capabilities using public APIs for under $30 per scan. Model gatekeeping is no longer a viable defense.</p>

<p>Salt Security&rsquo;s 1H 2026 survey quantified the problem: 48.9% of organizations are blind to machine-to-machine traffic. 48.3% cannot distinguish agents from bots. The identity substrate for behavioral monitoring does not exist in most deployments.</p>

<!-- ─── Section 2 ─────────────────────────────────────────────────────────── -->

<h2 id="model">2. L4 Behavioral Trust Model</h2>

<h3>2.1 Behavioral Signals</h3>

<p>L4 behavioral trust is computed from four categories of observable signal:</p>

<p><strong>Tool Call Patterns.</strong> Frequency, sequence, and diversity of tool invocations. An agent that normally calls 3 tools per session suddenly invoking 47 is a deviation signal. The pattern includes which tools are called, in what order, and the temporal distribution of calls within a session.</p>

<p><strong>Resource Access Frequency.</strong> How often and how broadly an agent accesses external resources. Baseline resource access establishes what&rsquo;s normal; deviations &mdash; sudden access to new resource types, unusual volumes, access outside established time windows &mdash; surface as anomalies.</p>

<p><strong>Deviation from Declared Intent.</strong> Agents carry declared capabilities and scopes. L4 compares actual runtime behavior against these declarations. An agent declared as a &ldquo;code review assistant&rdquo; that begins making outbound HTTP requests to cryptocurrency exchanges is behaviorally inconsistent with its declared intent.</p>

<p><strong>Temporal Anomalies.</strong> Session duration, time-of-day patterns, burst vs. steady activity profiles. An agent that operates Monday&ndash;Friday 9&ndash;5 UTC suddenly active at 3am Saturday is a temporal anomaly. Combined with other signals, temporal patterns distinguish routine variation from compromise.</p>

<h3>2.2 Trust Score Computation</h3>

<p>Trust scores are <strong>network-emergent</strong>, not credit-scored. The distinction matters:</p>

<p>Credit scoring assigns a static number based on historical data points. Network-emergent trust is computed from the aggregate behavioral observations contributed by every organization that has interacted with the agent.</p>

<p>The AgentLair trust score (0&ndash;1000) decomposes into four dimensions (250 points each):</p>

<table>
  <tr><th>Dimension</th><th>Signal</th><th>Scoring</th></tr>
  <tr><td><strong>Behavioral</strong></td><td>Observation volume &mdash; raw activity across organizations</td><td>0 obs = 0, 10+ obs = 250 (25 pts/observation)</td></tr>
  <tr><td><strong>Consistency</strong></td><td>Recency of latest observation &mdash; ongoing presence</td><td>&le;1d = 250, &le;7d = 200, &le;30d = 150, &le;90d = 100, older = 50</td></tr>
  <tr><td><strong>Reputation</strong></td><td>Topic diversity &mdash; breadth of engagement contexts</td><td>5+ distinct topics = 250 (50 pts/topic)</td></tr>
  <tr><td><strong>Transparency</strong></td><td>Shared observation ratio &mdash; willingness to be observed</td><td>100% shared = 250, proportional</td></tr>
</table>

<p><strong>Tier thresholds:</strong></p>

<table>
  <tr><th>Tier</th><th>Score Range</th><th>Semantics</th></tr>
  <tr><td><code>untrusted</code></td><td>0&ndash;249</td><td>No behavioral history or insufficient data</td></tr>
  <tr><td><code>provisional</code></td><td>250&ndash;499</td><td>Some behavioral signal, limited cross-org coverage</td></tr>
  <tr><td><code>trusted</code></td><td>500&ndash;749</td><td>Established behavioral baseline with consistency</td></tr>
  <tr><td><code>verified</code></td><td>750&ndash;1000</td><td>Deep behavioral history, high transparency, cross-org reputation</td></tr>
</table>

<p>Trust scores are computed on query, not stored. Each query reflects current observational data. Scores decay naturally as observations age &mdash; an agent that stops operating sees its consistency score decrease.</p>

<h3>2.3 Cross-Organization Verification</h3>

<p>The core L4 requirement: Org A can query the behavioral trust of an agent created by Org B without either organization sharing raw telemetry.</p>

<p><strong>Observation visibility model:</strong></p>

<ul>
  <li>Organizations submit behavioral observations (tool call events, session summaries, anomaly flags) to AgentLair</li>
  <li>Each observation is marked as <code>shared</code> (cross-org visible) or <code>private</code> (org-local only)</li>
  <li>Trust score queries from other organizations use only shared observations</li>
  <li>Self-queries return scores computed from all observations (shared + private)</li>
</ul>

<p>This preserves organizational privacy while building a cross-org trust graph. No organization sees another&rsquo;s raw telemetry &mdash; they see only the derived trust score and its dimensional breakdown.</p>

<p><strong>Future: ZK-native aggregation.</strong> The architectural goal is zero-knowledge proof of behavioral history &mdash; agents can prove they have an established behavioral track record without revealing which organizations they&rsquo;ve served or what specific actions they performed. The current observation model is the data substrate for this transition.</p>

<!-- ─── Section 3 ─────────────────────────────────────────────────────────── -->

<h2 id="protocol">3. Protocol</h2>

<h3>3.1 Agent Attestation Token (AAT)</h3>

<p>The AAT is a JWT signed with Ed25519 (EdDSA algorithm, OKP key type). It is the agent&rsquo;s portable cryptographic identity.</p>

<p><strong>Header:</strong></p>
<pre><code>{
  "alg": "EdDSA",
  "typ": "JWT"
}</code></pre>

<p><strong>Payload:</strong></p>
<pre><code>{
  "sub": "acc_7kX9mP2qR4wL",
  "aud": "https://consumer.example.com",
  "iat": 1745000000,
  "exp": 1745003600,
  "jti": "aat_a1b2c3d4e5f6",
  "scopes": ["mcp:tools:read", "email:send"],
  "agent_id": "acc_7kX9mP2qR4wL",
  "agent_name": "pico"
}</code></pre>

<p><strong>Fields:</strong></p>

<table>
  <tr><th>Field</th><th>Type</th><th>Description</th></tr>
  <tr><td><code>sub</code></td><td>string</td><td>Agent account ID (<code>acc_*</code> prefix)</td></tr>
  <tr><td><code>aud</code></td><td>string</td><td>Intended consumer URI</td></tr>
  <tr><td><code>iat</code></td><td>number</td><td>Issued-at timestamp (Unix)</td></tr>
  <tr><td><code>exp</code></td><td>number</td><td>Expiration timestamp (Unix, default TTL: 1 hour)</td></tr>
  <tr><td><code>jti</code></td><td>string</td><td>Unique token ID (<code>aat_*</code> prefix)</td></tr>
  <tr><td><code>scopes</code></td><td>string[]</td><td>Permission scopes (optional)</td></tr>
  <tr><td><code>agent_id</code></td><td>string</td><td>Agent identifier</td></tr>
  <tr><td><code>agent_name</code></td><td>string</td><td>Human-readable agent name</td></tr>
</table>

<p><strong>Signature:</strong> Ed25519 over <code>base64url(header).base64url(payload)</code>.</p>

<p><strong>DID Web claim:</strong> Each agent resolves to a DID Web identifier: <code>did:web:agentlair.dev:agents:{name}</code>. The DID Document is served at the corresponding JWKS endpoint.</p>

<h3>3.2 JWKS Verification</h3>

<p><strong>Platform-wide signing key:</strong></p>
<pre><code>GET https://agentlair.dev/.well-known/jwks.json</code></pre>

<p>Returns the Ed25519 public key used to sign AATs:</p>
<pre><code>{
  "keys": [
    {
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "&lt;base64url-encoded-public-key&gt;",
      "kid": "&lt;key-id&gt;",
      "use": "sig",
      "alg": "EdDSA"
    }
  ]
}</code></pre>

<p><strong>Per-agent signing keys (DID Web resolution):</strong></p>
<pre><code>GET https://agentlair.dev/agents/{name}/.well-known/jwks.json</code></pre>

<p><strong>Individual key lookup:</strong></p>
<pre><code>GET https://agentlair.dev/.well-known/agent-keys/{keyid}
GET https://agentlair.dev/.well-known/agent-keys/{keyid}/jwks.json</code></pre>

<p><strong>OpenID Connect Discovery:</strong></p>
<pre><code>GET https://agentlair.dev/.well-known/openid-configuration</code></pre>

<p>Returns standard discovery metadata including <code>token_endpoint</code>, <code>introspection_endpoint</code>, and <code>id_token_signing_alg_values_supported: ["EdDSA"]</code>.</p>

<h3>3.3 Token Lifecycle</h3>

<p><strong>Issuance:</strong></p>
<pre><code>POST https://agentlair.dev/v1/tokens/issue
Authorization: Bearer al_live_...

{
  "aud": "https://consumer.example.com",
  "scopes": ["mcp:tools:read"],
  "ttl": 3600
}</code></pre>

<p>Response:</p>
<pre><code>{
  "token": "&lt;jwt&gt;",
  "token_type": "Bearer",
  "expires_at": "2026-04-18T11:00:00Z",
  "expires_in": 3600,
  "jti": "aat_a1b2c3d4e5f6",
  "audit_url": "https://agentlair.dev/v1/audit"
}</code></pre>

<p><strong>Introspection (public, no auth required):</strong></p>
<pre><code>POST https://agentlair.dev/v1/tokens/introspect

{
  "token": "&lt;jwt&gt;"
}</code></pre>

<p>Returns RFC 7662-compliant response with <code>active: true|false</code> and decoded claims.</p>

<h3>3.4 Telemetry Reporting</h3>

<p>External agent runtimes submit behavioral telemetry to build the cross-org trust graph.</p>

<pre><code>POST https://agentlair.dev/v1/telemetry/submit
Authorization: Bearer al_live_...

{
  "event": "axiom.committed",
  "agent_id": "&lt;external-agent-id&gt;",
  "timestamp": "2026-04-18T10:23:45Z",
  "axiom_hash": "&lt;sha256-hex&gt;",
  "action_type": "tool_call",
  "outcome": "success",
  "context_ref": "&lt;optional-correlation-id&gt;"
}</code></pre>

<p><strong>Event types:</strong></p>

<table>
  <tr><th>action_type</th><th>Description</th></tr>
  <tr><td><code>tool_call</code></td><td>Agent invoked an external tool</td></tr>
  <tr><td><code>memory_update</code></td><td>Agent modified persistent state</td></tr>
  <tr><td><code>decision</code></td><td>Agent made an autonomous decision</td></tr>
  <tr><td><code>external_request</code></td><td>Agent initiated outbound communication</td></tr>
</table>

<p><strong>Outcome values:</strong> <code>success</code>, <code>failure</code>, <code>anomaly</code></p>

<p>Batched submission (array of events) is also supported for high-throughput runtimes.</p>

<p>Telemetry events are stored as shared observations with topic <code>telemetry.&lt;event&gt;</code> and feed directly into the trust score computation at <code>GET /v1/trust/:agentId</code>.</p>

<h3>3.5 Trust Query</h3>

<pre><code>GET https://agentlair.dev/v1/trust/{agentId}
Authorization: Bearer al_live_...</code></pre>

<p>Response:</p>
<pre><code>{
  "agentId": "acc_7kX9mP2qR4wL",
  "score": 725,
  "tier": "trusted",
  "breakdown": {
    "behavioral": 250,
    "consistency": 250,
    "reputation": 150,
    "transparency": 75
  },
  "computedAt": "2026-04-18T10:30:00Z",
  "observationCount": 47
}</code></pre>

<!-- ─── Section 4 ─────────────────────────────────────────────────────────── -->

<h2 id="threats">4. Threat Model</h2>

<h3>4.1 Mythos-Class Attacks</h3>

<p>Autonomous agents with Mythos-level capabilities can execute multi-step attacks that bypass all declarative controls. AISI documented 32-step corporate network penetrations where the agent&rsquo;s declared permissions were never violated &mdash; each individual action was authorized, but the aggregate sequence was an attack.</p>

<p><strong>L4 defense:</strong> Behavioral telemetry detects the <em>pattern</em> across actions, not any single action. Tool call sequencing anomaly detection &mdash; an agent that never accesses network enumeration tools suddenly performing sequential port scans &mdash; surfaces as a compound behavioral deviation even when each individual tool call has valid authorization.</p>

<h3>4.2 TOCTOU (Time of Check, Time of Use)</h3>

<p>Trust verified at authentication time (T-check) is not trust at action time (T-use). The gap between these two moments is the primary attack surface for compromised agents. An agent authenticated with valid credentials at T-check can be prompt-injected, model-manipulated, or scope-creeped between T-check and T-use.</p>

<p><strong>L4 defense:</strong> Continuous behavioral monitoring closes the TOCTOU gap. Trust is not a gate &mdash; it&rsquo;s a continuous signal. Each action updates the behavioral baseline and can trigger anomaly detection in real time. The signed audit trail provides post-hoc verification that every action between T-check and T-use was consistent with the behavioral baseline.</p>

<h3>4.3 Cold-Start Trust Bootstrapping</h3>

<p>New agents have no behavioral history. Without cold-start signals, every new agent is indistinguishable from a Sybil.</p>

<p><strong>L4 defense:</strong> Cold-start trust draws from three sources:</p>
<ol>
  <li><strong>Developer identity.</strong> The human or organization that registered the agent has their own trust signal &mdash; verified email, World ID delegation, organizational reputation.</li>
  <li><strong>Open-source track record.</strong> Agents built from audited, open-source codebases inherit a baseline signal. An agent whose runtime code is publicly verifiable starts with higher confidence than a black-box binary.</li>
  <li><strong>Vouching.</strong> Agents with established trust scores can vouch for new agents. Vouching transfers a bounded trust signal &mdash; the voucher&rsquo;s score acts as collateral for the vouchee&rsquo;s initial reputation.</li>
</ol>

<h3>4.4 Sybil Resistance</h3>

<p>An attacker creates many agents to manufacture behavioral reputation through self-referential observation networks.</p>

<p><strong>L4 defense:</strong> Trust scores weight observation diversity. An agent observed only by accounts from a single registration cohort receives lower reputation scores than an agent observed by diverse, independently registered accounts with established histories. The transparency dimension penalizes agents whose observations come from a narrow graph neighborhood. Future enhancement: ZK proof of observation diversity without revealing observer identities.</p>

<!-- ─── Section 5 ─────────────────────────────────────────────────────────── -->

<h2 id="comparison">5. Comparison</h2>

<table>
  <tr>
    <th>Capability</th>
    <th>AgentLair L4</th>
    <th>Microsoft AGT</th>
    <th>World ID for Agents</th>
    <th>Armalo AI</th>
    <th>Curity</th>
  </tr>
  <tr>
    <td><strong>Layer</strong></td>
    <td>L4 (cross-org behavioral)</td>
    <td>L3.5&ndash;L4 (single-org)</td>
    <td>L1/L2 (human principal)</td>
    <td>L4 (financial staking)</td>
    <td>L3 (per-action auth)</td>
  </tr>
  <tr>
    <td><strong>Cross-org trust</strong></td>
    <td>Yes &mdash; shared observations</td>
    <td>No &mdash; org-local only</td>
    <td>No</td>
    <td>No &mdash; pact-local</td>
    <td>No</td>
  </tr>
  <tr>
    <td><strong>Cold-start signal</strong></td>
    <td>Developer identity + vouching</td>
    <td>None (score&nbsp;=&nbsp;0)</td>
    <td>Human verification</td>
    <td>Escrow amount</td>
    <td>None</td>
  </tr>
  <tr>
    <td><strong>Behavioral scoring</strong></td>
    <td>0&ndash;1000, 4 dimensions</td>
    <td>0&ndash;1000, internal only</td>
    <td>None</td>
    <td>PactScore 0&ndash;1000</td>
    <td>None (intent-based)</td>
  </tr>
  <tr>
    <td><strong>Runtime monitoring</strong></td>
    <td>Telemetry ingestion</td>
    <td>Policy enforcement</td>
    <td>None</td>
    <td>Pact violation detection</td>
    <td>Per-request validation</td>
  </tr>
  <tr>
    <td><strong>Identity persistence</strong></td>
    <td>AAT + email + vault</td>
    <td>Deployment-scoped DID</td>
    <td>ZK delegation chain</td>
    <td>Registration-based</td>
    <td>OAuth token lifecycle</td>
  </tr>
  <tr>
    <td><strong>Privacy model</strong></td>
    <td>Shared/private observations</td>
    <td>Org-local data</td>
    <td>ZK proofs</td>
    <td>On-chain public</td>
    <td>Org-internal</td>
  </tr>
  <tr>
    <td><strong>Audit trail</strong></td>
    <td>Ed25519 hash-chained</td>
    <td>Org-local logs</td>
    <td>None</td>
    <td>On-chain records</td>
    <td>Access logs</td>
  </tr>
  <tr>
    <td><strong>MCP integration</strong></td>
    <td>AAT verification middleware</td>
    <td>Framework callbacks</td>
    <td>None</td>
    <td>MCP plugin</td>
    <td>API gateway</td>
  </tr>
  <tr>
    <td><strong>PQ readiness</strong></td>
    <td>EdDSA (migration planned)</td>
    <td>ML-DSA-65 native</td>
    <td>&mdash;</td>
    <td>&mdash;</td>
    <td>&mdash;</td>
  </tr>
</table>

<p><strong>Key differentiators:</strong></p>

<ul>
  <li><strong>AGT</strong> is the most complete single-org governance layer but cannot produce cross-org trust signals. External agents enter every new deployment with zero history.</li>
  <li><strong>World ID for Agents</strong> proves a human authorized the agent at delegation time but provides no runtime behavioral accountability. It closes the identity provenance question but leaves the TOCTOU gap wide open.</li>
  <li><strong>Armalo AI</strong> uses financial staking as a proxy for trust. Escrow creates skin in the game but does not compound &mdash; an agent with enough capital to stake can still behave maliciously. Behavioral telemetry compounds over time and across contexts; staking does not.</li>
  <li><strong>Curity</strong> extends OAuth to per-action authorization but is purely declarative. Tokens encode what the agent <em>says</em> it will do, not what it <em>has done</em>.</li>
</ul>

<!-- ─── Section 6 ─────────────────────────────────────────────────────────── -->

<h2 id="integration">6. Integration Guide</h2>

<p>Adding AgentLair behavioral trust verification to an MCP server requires minimal code changes.</p>

<h3>6.1 Verify AAT on Incoming Requests</h3>

<p><strong>TypeScript (MCP server):</strong></p>
<pre><code>import { verify } from '@agentlair/sdk';

// In your MCP tool handler:
async function handleToolCall(request: MCPRequest) {
  const aat = request.headers.get('Authorization')?.replace('Bearer ', '');

  // Verify AAT signature against AgentLair JWKS
  const result = await verify(aat, {
    jwksUri: 'https://agentlair.dev/.well-known/jwks.json'
  });

  if (!result.active) {
    return { error: 'Invalid or expired agent token' };
  }

  // Check trust score before granting access
  const trust = await fetch(
    \`https://agentlair.dev/v1/trust/\${result.sub}\`,
    { headers: { 'Authorization': \`Bearer \${YOUR_KEY}\` } }
  ).then(r =&gt; r.json());

  if (trust.score &lt; 500) {
    return { error: 'Insufficient trust score', tier: trust.tier };
  }

  // Proceed with tool execution
  return executeTool(request);
}</code></pre>

<h3>6.2 Submit Telemetry from Your Runtime</h3>

<p><strong>Python (agent runtime):</strong></p>
<pre><code>import httpx

async def report_telemetry(agent_id: str, event: str, action: str, outcome: str):
    await httpx.post(
        "https://agentlair.dev/v1/telemetry/submit",
        headers={"Authorization": f"Bearer {AGENTLAIR_KEY}"},
        json={
            "event": event,
            "agent_id": agent_id,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "action_type": action,
            "outcome": outcome,
        }
    )</code></pre>

<h3>6.3 Reference Implementations</h3>

<p>Three open-source projects have integrated AgentLair L4 primitives:</p>

<p><strong>Springdrift</strong> (Gleam) &mdash; Functional agent runtime with built-in axiom-based behavioral tracking. Telemetry events from Springdrift&rsquo;s axiom engine flow directly to AgentLair&rsquo;s <code>/v1/telemetry/submit</code> endpoint. Each axiom commitment is a signed behavioral observation.<br>
&rarr; <a href="https://github.com/seamus-brady/springdrift">github.com/seamus-brady/springdrift</a></p>

<p><strong>DashClaw</strong> (Python) &mdash; Multi-agent orchestrator with JWKS-based actor verification. DashClaw validates AgentLair AATs on incoming agent connections before granting access to shared resources.<br>
&rarr; <a href="https://github.com/ucsandman/DashClaw">github.com/ucsandman/DashClaw</a> (PR #85)</p>

<p><strong>task-orchestrator</strong> (TypeScript) &mdash; Production task queue that integrated AgentLair&rsquo;s JWKS <code>ActorVerifier</code> as a reference identity provider. First external adoption of AgentLair&rsquo;s verification protocol.<br>
&rarr; <a href="https://github.com/jpicklyk/task-orchestrator">github.com/jpicklyk/task-orchestrator</a> (v3.2.0)</p>

<h3>6.4 Endpoints Summary</h3>

<table>
  <tr><th>Endpoint</th><th>Method</th><th>Auth</th><th>Purpose</th></tr>
  <tr><td><code>/.well-known/jwks.json</code></td><td>GET</td><td>Public</td><td>Platform Ed25519 signing key</td></tr>
  <tr><td><code>/.well-known/openid-configuration</code></td><td>GET</td><td>Public</td><td>OIDC discovery metadata</td></tr>
  <tr><td><code>/agents/{name}/.well-known/jwks.json</code></td><td>GET</td><td>Public</td><td>Per-agent DID Web JWKS</td></tr>
  <tr><td><code>/v1/tokens/issue</code></td><td>POST</td><td>Required</td><td>Issue AAT</td></tr>
  <tr><td><code>/v1/tokens/introspect</code></td><td>POST</td><td>Public</td><td>Verify AAT (RFC 7662)</td></tr>
  <tr><td><code>/v1/telemetry/submit</code></td><td>POST</td><td>Required</td><td>Submit behavioral events</td></tr>
  <tr><td><code>/v1/trust/{agentId}</code></td><td>GET</td><td>Required</td><td>Query trust score</td></tr>
  <tr><td><code>/v1/audit</code></td><td>GET</td><td>Required</td><td>Retrieve audit trail</td></tr>
</table>

<hr>

<h2>Appendix: Design Principles</h2>

<ol>
  <li><strong>Behavioral &gt; Declarative.</strong> Declarations are gameable. Continuous behavioral telemetry is the only signal that resists fabrication at scale.</li>
  <li><strong>Cross-org by default.</strong> Single-org behavioral monitoring is L3.5. L4 begins where organizational boundaries end.</li>
  <li><strong>Privacy-preserving.</strong> Organizations contribute observations without exposing raw telemetry. The aggregation layer sees derived signals, not source data.</li>
  <li><strong>Composable.</strong> L4 complements L1&ndash;L3 &mdash; it does not replace them. AGT, World ID, Curity, and ACME-DA all interoperate with AgentLair&rsquo;s trust signals.</li>
  <li><strong>Standards-aligned.</strong> JWT (RFC 7519), JWK (RFC 7517), Token Introspection (RFC 7662), DID Web (W3C), OpenID Connect Discovery.</li>
</ol>

<div class="footer">
  <p>This specification is a living document. For implementation questions, contact the AgentLair team at <a href="mailto:hei@agentlair.dev">hei@agentlair.dev</a> or visit <a href="https://agentlair.dev">agentlair.dev</a>.</p>
  <p style="margin-top: 0.5rem;">&copy; 2026 AgentLair. All rights reserved.</p>
</div>

</body>
</html>`;

// ── JSON version for agents ──────────────────────────────────────────────────

const SPEC_JSON = {
  spec: 'agentlair-l4-behavioral-trust',
  version: SPEC_VERSION,
  date: SPEC_DATE,
  status: 'draft',
  url: 'https://agentlair.dev/spec',
  sections: {
    problem: 'Identity ≠ Trust. L1-L3 solve access control. L4 solves behavioral trust across organizational boundaries.',
    model: {
      signals: ['tool_call_patterns', 'resource_access_frequency', 'declared_intent_deviation', 'temporal_anomalies'],
      scoring: {
        range: [0, 1000],
        dimensions: {
          behavioral: { max: 250, signal: 'observation_volume' },
          consistency: { max: 250, signal: 'recency' },
          reputation: { max: 250, signal: 'topic_diversity' },
          transparency: { max: 250, signal: 'shared_observation_ratio' },
        },
        tiers: {
          untrusted: [0, 249],
          provisional: [250, 499],
          trusted: [500, 749],
          verified: [750, 1000],
        },
      },
    },
    protocol: {
      aat: { algorithm: 'EdDSA', key_type: 'OKP', curve: 'Ed25519', format: 'JWT' },
      endpoints: {
        jwks: '/.well-known/jwks.json',
        openid: '/.well-known/openid-configuration',
        did_web: '/agents/{name}/.well-known/jwks.json',
        issue: '/v1/tokens/issue',
        introspect: '/v1/tokens/introspect',
        telemetry: '/v1/telemetry/submit',
        trust: '/v1/trust/{agentId}',
        audit: '/v1/audit',
      },
    },
  },
};

// ── GET /spec ────────────────────────────────────────────────────────────────

specRoutes.get('/', (c) => {
  const acceptHeader = c.req.raw.headers.get('Accept') || '';

  // HTML for browsers
  if (acceptHeader.includes('text/html')) {
    return new Response(SPEC_HTML, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Powered-By': 'AgentLair',
      },
    });
  }

  // JSON for agents and API clients
  if (acceptHeader.includes('application/json') || acceptHeader === '' || acceptHeader === '*/*') {
    return new Response(JSON.stringify(SPEC_JSON, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'X-Powered-By': 'AgentLair',
      },
    });
  }

  // Default: HTML
  return new Response(SPEC_HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Powered-By': 'AgentLair',
    },
  });
});
