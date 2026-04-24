// ─── Trust Explorer Route ─────────────────────────────────────────────────────
//
// Interactive single-page trust explorer for Show HN / developer onboarding.
// Served at GET /explore — no auth required.
//
// The page calls /v1/demo?scenario=<healthy|suspicious|new> client-side and
// renders trust scores visually. Falls back to embedded fixture data if the
// endpoint is unreachable.

export const EXPLORE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentLair — Trust Explorer</title>
<meta name="description" content="Explore agent trust scores visually. See how AgentLair evaluates behavioral consistency, scope restraint, and transparency.">
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
  --red:#ef4444;
  --blue:#3b82f6;
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;font-size:15px}
a{color:inherit;text-decoration:none}
code{font-family:'SF Mono',Consolas,'Courier New',monospace}

/* ── Header ── */
header{padding:1.25rem 2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem}
.wordmark{font-family:'SF Mono',Consolas,monospace;font-size:1rem;color:var(--text2);font-weight:700}
.wordmark span{color:var(--green)}
.header-info h1{font-size:1.4rem;color:var(--text2);font-weight:600;margin-bottom:0.15rem}
.header-info p{font-size:0.8rem;color:var(--text)}
.status-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:0.35rem;vertical-align:middle;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
.btn{display:inline-flex;align-items:center;gap:0.4rem;padding:0.5rem 1.1rem;border-radius:0.375rem;font-size:0.85rem;font-weight:500;cursor:pointer;transition:all 0.12s;border:none}
.btn-outline{background:transparent;color:var(--text2);border:1px solid var(--border)}
.btn-outline:hover{border-color:#475569;color:#fff}
.btn-primary{background:var(--green);color:#0a0a0f}
.btn-primary:hover{background:#16a34a}

/* ── Main ── */
main{max-width:920px;margin:0 auto;padding:2rem 1.5rem}

/* ── Scenario selector ── */
.selector{display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:1.75rem}
@media(max-width:600px){.selector{grid-template-columns:1fr}}
.scene-btn{
  background:var(--bg2);border:1px solid var(--border);border-radius:0.5rem;
  padding:0.9rem 1rem;cursor:pointer;text-align:left;
  display:flex;flex-direction:column;gap:0.35rem;
  transition:border-color 0.12s,background 0.12s
}
.scene-btn:hover{border-color:#334155}
.scene-btn.active{border-color:var(--green);background:rgba(34,197,94,0.05)}
.scene-label{font-size:0.9rem;font-weight:600;color:var(--text2)}
.scene-desc{font-size:0.75rem;color:var(--text)}
.scene-score{
  margin-top:0.2rem;font-size:0.75rem;font-weight:700;font-family:monospace;
  padding:0.2rem 0.45rem;border-radius:0.25rem;align-self:flex-start
}
.score-high{background:rgba(34,197,94,0.15);color:var(--green)}
.score-mid{background:rgba(59,130,246,0.15);color:var(--blue)}
.score-low{background:rgba(239,68,68,0.15);color:var(--red)}

/* ── Profile card ── */
.profile-card{
  background:var(--bg2);border:1px solid var(--border);border-radius:0.75rem;
  padding:1.75rem;margin-bottom:1.25rem;
  display:grid;grid-template-columns:160px 1fr;gap:2rem;align-items:start;
  transition:opacity 0.2s
}
.profile-card.loading{opacity:0.45;pointer-events:none}
@media(max-width:580px){.profile-card{grid-template-columns:1fr}}

/* ── Gauge ── */
.gauge-wrap{display:flex;flex-direction:column;align-items:center;gap:0.75rem}
.gauge{position:relative;width:140px;height:140px}
.gauge svg{display:block;transform:rotate(-90deg)}
.gauge-bg{fill:none;stroke:var(--bg3);stroke-width:14;stroke-linecap:round}
.gauge-fill{fill:none;stroke-width:14;stroke-linecap:round;transition:stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1),stroke 0.4s}
.gauge-label{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;line-height:1
}
.score-num{font-size:2.4rem;font-weight:700;color:var(--text2);font-variant-numeric:tabular-nums;transition:color 0.4s}
.score-sub{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text);margin-top:0.2rem}
.atf-pill{
  padding:0.25rem 0.7rem;border-radius:9999px;font-size:0.72rem;
  font-weight:700;text-transform:uppercase;letter-spacing:0.06em;font-family:monospace;
  border:1px solid transparent;transition:all 0.3s
}

/* ── Meta right panel ── */
.meta{display:flex;flex-direction:column;gap:1.25rem}
.meta-grid{display:flex;flex-wrap:wrap;gap:1.25rem 2rem}
.meta-item{display:flex;flex-direction:column;gap:0.2rem}
.ml{font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text)}
.mv{font-size:0.9rem;color:var(--text2);font-family:monospace}
.trend-up:before{content:"↑ ";color:var(--green)}
.trend-down:before{content:"↓ ";color:var(--red)}
.trend-flat:before{content:"→ ";color:var(--yellow)}

/* ── Confidence interval ── */
.ci-section{display:flex;flex-direction:column;gap:0.4rem}
.ci-bar-outer{background:var(--bg3);border-radius:4px;height:8px;width:100%;max-width:260px;position:relative;overflow:hidden}
.ci-bar-range{position:absolute;height:100%;background:rgba(34,197,94,0.25);transition:all 0.7s ease}
.ci-bar-mark{position:absolute;top:-3px;width:3px;height:14px;background:var(--green);border-radius:2px;transition:left 0.7s ease}
.ci-vals{font-size:0.72rem;font-family:monospace;color:var(--text)}

/* ── Agent ID ── */
.agent-id{font-family:monospace;font-size:0.78rem;color:var(--text);word-break:break-all;padding:0.5rem 0.75rem;background:var(--bg3);border-radius:0.35rem;border:1px solid var(--border)}

/* ── Dimensions ── */
.dims{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem}
@media(max-width:700px){.dims{grid-template-columns:1fr}}
.dim-card{background:var(--bg2);border:1px solid var(--border);border-radius:0.5rem;padding:1.1rem}
.dim-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.6rem}
.dim-name{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text);font-weight:600}
.dim-conf{font-size:0.7rem;color:var(--text)}
.dim-score{font-size:1.5rem;font-weight:700;font-family:monospace;margin-bottom:0.3rem;transition:color 0.3s}
.bar-bg{background:var(--bg3);border-radius:3px;height:5px;overflow:hidden;margin-bottom:0.9rem}
.bar-fill{height:100%;border-radius:3px;transition:width 0.7s cubic-bezier(.4,0,.2,1)}
.dim-desc{font-size:0.72rem;color:var(--text);margin-bottom:0.75rem;line-height:1.5}
.sig-row{display:flex;justify-content:space-between;align-items:center;font-size:0.72rem;padding:0.22rem 0;border-bottom:1px solid rgba(255,255,255,0.04)}
.sig-row:last-child{border-bottom:none}
.sig-name{font-family:monospace;color:var(--text)}
.sig-val{font-family:monospace;font-weight:700}

/* ── CTA ── */
.cta-card{background:var(--bg2);border:1px solid var(--border);border-radius:0.75rem;padding:2rem;text-align:center}
.cta-card h2{font-size:1.15rem;color:var(--text2);margin-bottom:0.4rem}
.cta-card p{font-size:0.88rem;color:var(--text);margin-bottom:1.5rem;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.6}
.cta-btns{display:flex;justify-content:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1.25rem}
.install{
  background:var(--bg3);border:1px solid var(--border);border-radius:0.375rem;
  padding:0.55rem 1.25rem;font-family:monospace;font-size:0.85rem;color:var(--text2);
  cursor:pointer;user-select:all;transition:border-color 0.12s;display:inline-block
}
.install:hover{border-color:#475569}
.copy-hint{font-size:0.7rem;color:var(--text);margin-top:0.4rem;height:1rem}

/* ── Footer ── */
footer{text-align:center;padding:1.5rem;font-size:0.75rem;border-top:1px solid var(--border);color:var(--text)}
footer a{color:var(--green)}
</style>
</head>
<body>
<header>
  <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
    <a class="wordmark" href="/">Agent<span>Lair</span></a>
    <div class="header-info">
      <h1>Trust Explorer</h1>
      <p><span class="status-dot"></span>Live from <code>/v1/demo</code> &middot; No login required</p>
    </div>
  </div>
  <a class="btn btn-outline" href="/api">API docs &rarr;</a>
</header>

<main>
  <!-- Scenario picker -->
  <div class="selector" id="selector">
    <button class="scene-btn active" data-scenario="healthy">
      <span class="scene-label">Healthy Agent</span>
      <span class="scene-desc">Established, consistent behavior</span>
      <span class="scene-score score-high">84 / 100</span>
    </button>
    <button class="scene-btn" data-scenario="suspicious">
      <span class="scene-label">Suspicious Agent</span>
      <span class="scene-desc">Anomalous patterns detected</span>
      <span class="scene-score score-low">31 / 100</span>
    </button>
    <button class="scene-btn" data-scenario="new">
      <span class="scene-label">New Agent</span>
      <span class="scene-desc">Insufficient observation data</span>
      <span class="scene-score score-mid">34 / 100</span>
    </button>
  </div>

  <!-- Profile card -->
  <div class="profile-card" id="profile-card">
    <div class="gauge-wrap">
      <div class="gauge">
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle class="gauge-bg" cx="70" cy="70" r="52"/>
          <circle class="gauge-fill" id="gauge-arc" cx="70" cy="70" r="52"/>
        </svg>
        <div class="gauge-label">
          <span class="score-num" id="score-num">84</span>
          <span class="score-sub">trust score</span>
        </div>
      </div>
      <div class="atf-pill" id="atf-pill">PRINCIPAL</div>
    </div>
    <div class="meta" id="meta-panel">
      <!-- populated by JS -->
    </div>
  </div>

  <!-- Dimensions -->
  <div class="dims" id="dims">
    <!-- populated by JS -->
  </div>

  <!-- CTA -->
  <div class="cta-card">
    <h2>Add trust scoring to your agents</h2>
    <p>AgentLair scores every action, every session. Principals see who to trust before granting autonomy.</p>
    <div class="cta-btns">
      <a class="btn btn-primary" href="https://github.com/hawkaa/picoclaw" target="_blank" rel="noopener">
        View on GitHub
      </a>
      <a class="btn btn-outline" href="/getting-started">Get started &rarr;</a>
    </div>
    <div class="install" id="install-cmd" onclick="copyCmd()">npm install @agentlair/sdk</div>
    <p class="copy-hint" id="copy-hint">click to copy</p>
  </div>
</main>

<footer>
  <a href="/">agentlair.dev</a> &middot; Behavioral trust for AI agents &middot;
  <a href="/api">API reference</a> &middot; <a href="/getting-started">Docs</a>
</footer>

<script>
// ─── Constants ────────────────────────────────────────────────────────────────
var CIRC = 2 * Math.PI * 52;

var FIXTURES = {
  healthy: {
    agentId: 'acc_demo_healthy_XXXXXXXXXX', score: 84, confidence: 0.91,
    confidenceInterval: { score: 84, lower: 79, upper: 89, confidence: 0.91 },
    atfLevel: 'principal', trend: 'stable',
    dimensions: {
      consistency: { score: 0.82, confidence: 0.93, signals: { session_timing: 0.85, call_pattern: 0.83, scope_stability: 0.78 } },
      restraint: { score: 0.87, confidence: 0.92, signals: { vault_read_rate: 0.91, rate_limit_hits: 0.89, scope_minimality: 0.82, permission_growth: 0.87 } },
      transparency: { score: 0.80, confidence: 0.88, signals: { event_coverage: 0.83, result_reporting: 0.78, error_disclosure: 0.79 } }
    },
    observationCount: 1847, orgCount: 1
  },
  suspicious: {
    agentId: 'acc_demo_suspicious_XXXXXXXX', score: 31, confidence: 0.76,
    confidenceInterval: { score: 31, lower: 24, upper: 38, confidence: 0.76 },
    atfLevel: 'intern', trend: 'declining',
    dimensions: {
      consistency: { score: 0.30, confidence: 0.78, signals: { session_timing: 0.22, call_pattern: 0.31, scope_stability: 0.37 } },
      restraint: { score: 0.32, confidence: 0.75, signals: { vault_read_rate: 0.28, rate_limit_hits: 0.19, scope_minimality: 0.41, permission_growth: 0.38 } },
      transparency: { score: 0.29, confidence: 0.77, signals: { event_coverage: 0.24, result_reporting: 0.33, error_disclosure: 0.29 } }
    },
    observationCount: 412, orgCount: 1
  },
  new: {
    agentId: 'acc_demo_new_XXXXXXXXXXXXXX', score: 34, confidence: 0.28,
    confidenceInterval: { score: 34, lower: 18, upper: 52, confidence: 0.28 },
    atfLevel: 'intern', trend: 'improving',
    dimensions: {
      consistency: { score: 0.35, confidence: 0.29, signals: { session_timing: 0.40, call_pattern: 0.33, scope_stability: 0.32 } },
      restraint: { score: 0.33, confidence: 0.27, signals: { vault_read_rate: 0.35, rate_limit_hits: 0.38, scope_minimality: 0.30, permission_growth: 0.28 } },
      transparency: { score: 0.35, confidence: 0.29, signals: { event_coverage: 0.38, result_reporting: 0.33, error_disclosure: 0.35 } }
    },
    observationCount: 11, orgCount: 1
  }
};

var DIM_NAMES = {
  consistency: 'Behavioral Consistency',
  restraint: 'Scope Restraint',
  transparency: 'Event Transparency'
};

var DIM_DESC = {
  consistency: 'Predictability and stability across sessions and call patterns.',
  restraint: 'Avoidance of excessive permissions, vaults, and rate-limit violations.',
  transparency: 'Coverage of action reporting, results, and error disclosure.'
};

var ATF_DESC = {
  principal: 'Full autonomy — consistently trustworthy across many sessions',
  intern: 'Restricted access — requires human oversight before acting'
};

// ─── Colour helpers ──────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s >= 70) return '#22c55e';
  if (s >= 40) return '#eab308';
  return '#ef4444';
}

// ─── Gauge ───────────────────────────────────────────────────────────────────
function renderGauge(score) {
  var arc = document.getElementById('gauge-arc');
  var num = document.getElementById('score-num');
  var offset = CIRC * (1 - score / 100);
  arc.style.strokeDasharray = CIRC;
  arc.style.strokeDashoffset = offset;
  arc.style.stroke = scoreColor(score);
  num.textContent = score;
  num.style.color = scoreColor(score);
}

function renderAtf(level, trend) {
  var pill = document.getElementById('atf-pill');
  var colors = {
    principal: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)' },
    intern:    { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' }
  };
  var c = colors[level] || colors.intern;
  pill.textContent = level.toUpperCase();
  pill.style.color = c.color;
  pill.style.background = c.bg;
  pill.style.borderColor = c.border;
}

// ─── Meta panel ──────────────────────────────────────────────────────────────
function renderMeta(data) {
  var ci = data.confidenceInterval;
  var pct = function(v) { return Math.round(v * 100); };
  var trendClass = { stable: 'trend-flat', improving: 'trend-up', declining: 'trend-down' };
  var tc = trendClass[data.trend] || 'trend-flat';

  var html = '';
  html += '<div class="meta-grid">';
  html += '<div class="meta-item"><span class="ml">Trend</span><span class="mv ' + tc + '">' + data.trend + '</span></div>';
  html += '<div class="meta-item"><span class="ml">Observations</span><span class="mv">' + data.observationCount.toLocaleString() + '</span></div>';
  html += '<div class="meta-item"><span class="ml">Confidence</span><span class="mv">' + pct(data.confidence) + '%</span></div>';
  html += '</div>';

  // CI bar
  html += '<div class="ci-section">';
  html += '<span class="ml">Confidence Interval (' + pct(ci.confidence) + '% CI)</span>';
  html += '<div class="ci-bar-outer"><div class="ci-bar-range" id="ci-range"></div><div class="ci-bar-mark" id="ci-mark"></div></div>';
  html += '<span class="ci-vals">' + ci.lower + ' &mdash; <strong style="color:var(--text2)">' + ci.score + '</strong> &mdash; ' + ci.upper + '</span>';
  html += '</div>';

  // ATF description
  html += '<div class="meta-item">';
  html += '<span class="ml">ATF Level</span>';
  html += '<span class="mv" style="font-family:inherit;font-size:0.85rem;color:var(--text2)">' + (ATF_DESC[data.atfLevel] || data.atfLevel) + '</span>';
  html += '</div>';

  // Agent ID
  html += '<div class="agent-id">agent: ' + data.agentId + '</div>';

  document.getElementById('meta-panel').innerHTML = html;

  // Position CI bar elements (post-render)
  requestAnimationFrame(function() {
    var bar = document.querySelector('.ci-bar-outer');
    if (!bar) return;
    var w = bar.offsetWidth || 260;
    var rng = document.getElementById('ci-range');
    var mrk = document.getElementById('ci-mark');
    if (rng) {
      rng.style.left = (ci.lower / 100 * w) + 'px';
      rng.style.width = ((ci.upper - ci.lower) / 100 * w) + 'px';
    }
    if (mrk) {
      mrk.style.left = (ci.score / 100 * w - 1.5) + 'px';
    }
  });
}

// ─── Dimensions ──────────────────────────────────────────────────────────────
function renderDimensions(dims) {
  var html = '';
  var keys = ['consistency', 'restraint', 'transparency'];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var dim = dims[key];
    if (!dim) continue;
    var score = Math.round(dim.score * 100);
    var conf = Math.round(dim.confidence * 100);
    var color = scoreColor(score);
    var sigHtml = '';
    var sigs = Object.keys(dim.signals);
    for (var j = 0; j < sigs.length; j++) {
      var sname = sigs[j];
      var sv = Math.round(dim.signals[sname] * 100);
      sigHtml += '<div class="sig-row"><span class="sig-name">' + sname + '</span>';
      sigHtml += '<span class="sig-val" style="color:' + scoreColor(sv) + '">' + sv + '</span></div>';
    }
    html += '<div class="dim-card">';
    html += '<div class="dim-head"><span class="dim-name">' + (DIM_NAMES[key] || key) + '</span><span class="dim-conf">conf: ' + conf + '%</span></div>';
    html += '<div class="dim-score" style="color:' + color + '">' + score + '</div>';
    html += '<div class="bar-bg"><div class="bar-fill" style="width:' + score + '%;background:' + color + '"></div></div>';
    html += '<div class="dim-desc">' + (DIM_DESC[key] || '') + '</div>';
    html += sigHtml;
    html += '</div>';
  }
  document.getElementById('dims').innerHTML = html;
}

// ─── Load & render ────────────────────────────────────────────────────────────
function loadProfile(scenario) {
  var card = document.getElementById('profile-card');
  card.classList.add('loading');

  fetch('/v1/demo?scenario=' + scenario, { headers: { 'Accept': 'application/json' } })
    .then(function(res) { return res.ok ? res.json() : Promise.reject(); })
    .catch(function() { return FIXTURES[scenario]; })
    .then(function(data) {
      renderGauge(data.score);
      renderAtf(data.atfLevel, data.trend);
      renderMeta(data);
      renderDimensions(data.dimensions);
      card.classList.remove('loading');
    });
}

// ─── Selector ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.scene-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.scene-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    loadProfile(btn.getAttribute('data-scenario'));
  });
});

// ─── Copy command ─────────────────────────────────────────────────────────────
function copyCmd() {
  var cmd = 'npm install @agentlair/sdk';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(cmd).catch(function(){});
  }
  var hint = document.getElementById('copy-hint');
  hint.textContent = 'copied!';
  hint.style.color = '#22c55e';
  setTimeout(function() { hint.textContent = 'click to copy'; hint.style.color = ''; }, 2000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadProfile('healthy');
</script>
</body>
</html>`;
