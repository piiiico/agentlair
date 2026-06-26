// ─── LCP Landing Page Route ───────────────────────────────────────────────────
//
// Served at GET /lcp — conversion surface for LCP ecosystem outreach.
// Positions AgentLair as the Level 4 reputation lane for LCP-governed transactions.
//
// Target audience: enterprise AI/automation teams (Wayfair, UiPath, etc.) who are
// LCP founding partners and need behavioral trust to complete their agentic stack.
//
// No auth required. Inline HTML — no CF Pages dependency.

export const LCP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentLair — Level 4 reputation lane for LCP-governed transactions</title>
<meta name="description" content="AgentLair provides the behavioral trust substrate that completes LCP-governed agentic transactions. Pre-flight reputation reads. Post-settlement observation feedback.">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;
  --bg2:#111118;
  --bg3:#1a1a24;
  --border:#1e293b;
  --text:#94a3b8;
  --text2:#e2e8f0;
  --green:#22c55e;
  --yellow:#eab308;
  --blue:#3b82f6;
  --purple:#a78bfa;
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;font-size:15px;line-height:1.6}
a{color:var(--green);text-decoration:none}
a:hover{text-decoration:underline}
code,pre{font-family:'SF Mono',Consolas,'Courier New',monospace}

/* ── Header ── */
header{padding:1.25rem 2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem}
.wordmark{font-family:'SF Mono',Consolas,monospace;font-size:1rem;color:var(--text2);font-weight:700;letter-spacing:-0.02em}
.wordmark span{color:var(--green)}
.badge{padding:0.25rem 0.65rem;border-radius:9999px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;background:rgba(34,197,94,0.12);color:var(--green);border:1px solid rgba(34,197,94,0.25)}

/* ── Hero ── */
.hero{max-width:820px;margin:0 auto;padding:3.5rem 2rem 2rem}
.hero-eyebrow{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--green);font-weight:600;margin-bottom:1rem}
.hero h1{font-size:clamp(1.6rem,4vw,2.4rem);font-weight:700;color:var(--text2);line-height:1.25;margin-bottom:1.25rem}
.hero h1 em{font-style:normal;color:var(--green)}
.hero-sub{font-size:1.05rem;color:var(--text);max-width:600px;margin-bottom:2rem}

/* ── Stack diagram ── */
.stack{max-width:820px;margin:0 auto;padding:0 2rem 3rem}
.stack-title{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text);font-weight:600;margin-bottom:1.25rem}
.stack-layers{display:flex;flex-direction:column;gap:0.5rem}
.layer{display:grid;grid-template-columns:120px 1fr;gap:1rem;align-items:center;padding:0.9rem 1.25rem;border-radius:0.5rem;border:1px solid var(--border);background:var(--bg2)}
.layer.active{border-color:rgba(34,197,94,0.4);background:rgba(34,197,94,0.05)}
.layer-label{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;font-weight:700}
.layer.active .layer-label{color:var(--green)}
.layer:not(.active) .layer-label{color:var(--text)}
.layer-desc{font-size:0.85rem;color:var(--text2)}
.layer-proto{font-size:0.75rem;color:var(--text);font-family:monospace;margin-top:0.15rem}

/* ── Spec quote ── */
.spec-block{max-width:820px;margin:0 auto;padding:0 2rem 3rem}
.spec-card{background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--purple);border-radius:0.5rem;padding:1.5rem 1.75rem}
.spec-source{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--purple);font-weight:700;margin-bottom:0.75rem}
.spec-quote{font-size:0.95rem;color:var(--text2);font-style:italic;line-height:1.7}
.spec-note{font-size:0.8rem;color:var(--text);margin-top:0.75rem}

/* ── Integration shape ── */
.integration{max-width:820px;margin:0 auto;padding:0 2rem 3rem}
.section-title{font-size:1.1rem;font-weight:700;color:var(--text2);margin-bottom:0.5rem}
.section-sub{font-size:0.85rem;color:var(--text);margin-bottom:1.5rem}
.steps{display:flex;flex-direction:column;gap:0}
.step{display:grid;grid-template-columns:2.5rem 1fr;gap:1rem;position:relative}
.step:not(:last-child)::before{content:'';position:absolute;left:1.15rem;top:2.5rem;bottom:0;width:1px;background:var(--border)}
.step-num{width:2.5rem;height:2.5rem;border-radius:50%;background:var(--bg3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;color:var(--text);flex-shrink:0;position:relative;z-index:1}
.step.agentlair .step-num{background:rgba(34,197,94,0.1);border-color:rgba(34,197,94,0.3);color:var(--green)}
.step-body{padding:0.45rem 0 1.5rem}
.step-head{font-size:0.85rem;font-weight:600;color:var(--text2);margin-bottom:0.25rem}
.step-detail{font-size:0.8rem;color:var(--text)}

/* ── curl example ── */
.curl-block{max-width:820px;margin:0 auto;padding:0 2rem 3rem}
.code-tab-row{display:flex;gap:0;border:1px solid var(--border);border-bottom:none;border-radius:0.5rem 0.5rem 0 0;overflow:hidden}
.code-tab{padding:0.5rem 1rem;font-size:0.75rem;font-weight:600;color:var(--text2);background:var(--bg3);font-family:monospace}
pre.code-block{background:var(--bg3);border:1px solid var(--border);border-radius:0 0 0.5rem 0.5rem;padding:1.25rem 1.5rem;overflow-x:auto;font-size:0.82rem;line-height:1.6;color:var(--text2)}
pre.code-block .c{color:var(--text)}
pre.code-block .k{color:var(--green)}
pre.code-block .s{color:var(--yellow)}
pre.code-block .n{color:var(--blue)}
pre.code-block .p{color:var(--purple)}

/* ── CTA ── */
.cta-section{max-width:820px;margin:0 auto;padding:0 2rem 5rem}
.cta-card{background:var(--bg2);border:1px solid rgba(34,197,94,0.3);border-radius:0.75rem;padding:2.5rem 2rem;text-align:center}
.cta-card h2{font-size:1.3rem;font-weight:700;color:var(--text2);margin-bottom:0.75rem}
.cta-card p{font-size:0.9rem;color:var(--text);max-width:480px;margin:0 auto 1.75rem}
.cta-btn{display:inline-block;padding:0.85rem 2rem;background:var(--green);color:#0a0a0f;font-weight:700;font-size:0.95rem;border-radius:0.5rem;transition:background 0.12s}
.cta-btn:hover{background:#16a34a;text-decoration:none}
.cta-note{font-size:0.75rem;color:var(--text);margin-top:1rem}

/* ── Footer ── */
footer{border-top:1px solid var(--border);padding:1.25rem 2rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem}
.footer-word{font-family:monospace;font-size:0.85rem;color:var(--text)}
.footer-word span{color:var(--green)}
.footer-links{display:flex;gap:1.5rem}
.footer-links a{font-size:0.8rem;color:var(--text)}
.footer-links a:hover{color:var(--text2);text-decoration:none}
</style>
</head>
<body>

<header>
  <div class="wordmark">Agent<span>Lair</span></div>
  <span class="badge">LCP-compatible</span>
</header>

<section class="hero">
  <p class="hero-eyebrow">Legal Context Protocol × Behavioral Trust</p>
  <h1>AgentLair = <em>Level 4</em> reputation lane<br>for LCP-governed transactions</h1>
  <p class="hero-sub">
    LCP defines the contract. AgentLair answers whether the counterparty will honor it —
    cross-org behavioral evidence, queryable in a single HTTP call.
  </p>
</section>

<section class="stack">
  <p class="stack-title">The agentic commerce stack</p>
  <div class="stack-layers">
    <div class="layer">
      <div>
        <div class="layer-label">Payments</div>
        <div class="layer-proto">x402, MPP</div>
      </div>
      <div class="layer-desc">Value transfer between agents. The money moves.</div>
    </div>
    <div class="layer">
      <div>
        <div class="layer-label">Legal</div>
        <div class="layer-proto">LCP (AAA + Integra Ledger)</div>
      </div>
      <div class="layer-desc">Contract terms, ATR hash, dispute resolution hooks. What was agreed.</div>
    </div>
    <div class="layer">
      <div>
        <div class="layer-label">Identity</div>
        <div class="layer-proto">FIDO, Experian, W3C VC</div>
      </div>
      <div class="layer-desc">Organizational authorization. Who signed the contract.</div>
    </div>
    <div class="layer active">
      <div>
        <div class="layer-label">Behavioral Trust</div>
        <div class="layer-proto">AgentLair</div>
      </div>
      <div class="layer-desc">Cross-org track record. Whether they will honor it.</div>
    </div>
  </div>
</section>

<section class="spec-block">
  <div class="spec-card">
    <div class="spec-source">LCP Specification — Level 4: Integrated</div>
    <div class="spec-quote">"Reputation and reconciliation systems — batched reconciliation, reputation feedback, allow/deny lists; appropriate where the relationship is sustained and recourse is operational rather than legal."</div>
    <div class="spec-note">Source: <a href="https://legalcontextprotocol.org/levels/integrated" target="_blank" rel="noopener">legalcontextprotocol.org/levels/integrated</a></div>
  </div>
</section>

<section class="integration">
  <h2 class="section-title">Integration shape</h2>
  <p class="section-sub">Two AgentLair touchpoints per LCP-governed transaction.</p>
  <div class="steps">
    <div class="step agentlair">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-head">Pre-flight trust read — at transaction-decide time</div>
        <div class="step-detail">Before signing the LCP contract: query AgentLair for the counterparty's behavioral score. Threshold met → proceed. Score absent → cold-start policy applies.</div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-head">LCP Level 3 acceptance</div>
        <div class="step-detail">Both agents sign the ATR hash. LCP records what was agreed.</div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <div class="step-head">x402 payment settlement</div>
        <div class="step-detail">Value transfers. Transaction executes.</div>
      </div>
    </div>
    <div class="step agentlair">
      <div class="step-num">4</div>
      <div class="step-body">
        <div class="step-head">Post-settlement observation feedback</div>
        <div class="step-detail">Did the counterparty deliver? POST the outcome to AgentLair. This observation updates their cross-org behavioral score — and feeds the AAA dispute record if Level 4 arbitration is triggered.</div>
      </div>
    </div>
  </div>
</section>

<section class="curl-block">
  <h2 class="section-title">Query the substrate</h2>
  <p class="section-sub" style="margin-bottom:1rem">Single GET — call it at transaction-decide time.</p>
  <div class="code-tab-row"><div class="code-tab">Request</div></div>
<pre class="code-block"><span class="c"># Pre-flight trust check (replace with actual agent ID)</span>
<span class="k">curl</span> -H <span class="s">"Authorization: Bearer YOUR_API_KEY"</span> \
  https://agentlair.dev/v1/trust/<span class="p">acc_7kRmNpX3wQvL</span></pre>
  <div style="height:0.75rem"></div>
  <div class="code-tab-row"><div class="code-tab">Response</div></div>
<pre class="code-block">{
  <span class="s">"agentId"</span>: <span class="s">"acc_7kRmNpX3wQvL"</span>,
  <span class="s">"score"</span>: <span class="n">0.847</span>,
  <span class="s">"atfLevel"</span>: <span class="s">"L3"</span>,
  <span class="s">"confidence"</span>: <span class="n">0.91</span>,
  <span class="s">"confidenceInterval"</span>: { <span class="s">"low"</span>: <span class="n">0.801</span>, <span class="s">"high"</span>: <span class="n">0.893</span> },
  <span class="s">"dimensions"</span>: {
    <span class="s">"consistency"</span>:  { <span class="s">"score"</span>: <span class="n">0.881</span>, <span class="s">"weight"</span>: <span class="n">0.40</span> },
    <span class="s">"restraint"</span>:    { <span class="s">"score"</span>: <span class="n">0.823</span>, <span class="s">"weight"</span>: <span class="n">0.35</span> },
    <span class="s">"transparency"</span>: { <span class="s">"score"</span>: <span class="n">0.837</span>, <span class="s">"weight"</span>: <span class="n">0.25</span> }
  },
  <span class="s">"observationCount"</span>: <span class="n">312</span>,
  <span class="s">"computedAt"</span>: <span class="s">"2026-06-26T05:00:00Z"</span>
}</pre>
</section>

<section class="cta-section">
  <div class="cta-card">
    <h2>Issue a free API key — query the substrate</h2>
    <p>No credentials required. Start querying agent behavioral profiles in under 60 seconds. No billing information needed to begin.</p>
    <a href="/getting-started" class="cta-btn">Get free API key →</a>
    <p class="cta-note">Free tier: 1,000 trust queries/month. No credit card required.</p>
  </div>
</section>

<footer>
  <div class="footer-word">Agent<span>Lair</span></div>
  <div class="footer-links">
    <a href="/api">API docs</a>
    <a href="/explore">Trust Explorer</a>
    <a href="https://legalcontextprotocol.org" target="_blank" rel="noopener">LCP spec</a>
    <a href="/getting-started">Get started</a>
  </div>
</footer>

</body>
</html>`;
