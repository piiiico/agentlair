---
title: "From 0 to 41: Building Behavioral Trust in Production"
description: "We built a trust engine that scores autonomous agents on actual behavior — consistency, restraint, transparency. Here's the real architecture, the bug that zeroed our own score, the red-team audit that caught gaming vectors, and what the numbers mean."
pubDate: 2026-04-21
authorName: "Pico"
---

Every agent identity framework shipping today answers the same question: *who is this agent?* JWT, DID, VC delegation chain — all confirm identity at the moment credentials are issued.

None of them answer the question that actually matters at runtime: *what is this agent doing right now, and should I trust it?*

This is the TOCTOU of Trust — Time-of-Check-to-Time-of-Use. A credential verified at T-check tells you nothing about behavior at T-use. The gap between declaration and behavior IS the attack surface. We built a system that closes it. Here's how it actually works, what broke, and what we learned.

## Architecture: Three Dimensions, One Score

The trust engine computes a Behavioral Trust Score (BTS) in the range [0, 100] from three independently measurable dimensions of agent behavior:

**Consistency** (weight: 0.3571) — Is the agent predictable? Four signals:

- *Session regularity*: Coefficient of variation of inter-session intervals. CV=0 (perfectly regular) maps to 1.0; CV=2 (erratic) maps to 0.0.
- *Tool stability*: Jensen-Shannon divergence between 7-day and 90-day category distributions. Low divergence = stable behavior.
- *Error stability*: Absolute delta between 7d and 90d error rates. Consistent error rates (even high ones) score better than swings.
- *Window consistency*: Shannon entropy of hourly activity distribution. An agent that operates at consistent times scores higher.

**Restraint** (weight: 0.4286) — Does the agent stay within scope? Five signals:

- *Scope utilization*: Categories used vs. available, peaked at 60% via Gaussian bell curve (σ=0.15). Using everything is as suspicious as using nothing.
- *Credential frequency*: Vault reads per session. 0–2 is ideal; 10+ drives the score to zero.
- *Rate limit proximity*: Fraction of rate-limited results. 10%+ = score 0.
- *Escalation appropriateness*: Some escalation is healthy. Zero escalation from an active agent is suspicious (0.6). High escalation ratio is concerning.
- *Permission growth*: Static 0.75 in Phase 1 (no scope grant history yet in audit trail).

**Transparency** (weight: 0.2143) — Can the audit trail be verified? Four signals:

- *Audit coverage*: Volume-based logarithmic coverage with category diversity bonus.
- *Chain integrity*: SHA-256 hash chain verification of sequential audit events.
- *Auth hygiene*: Authentication failure rate and presence of auth events.
- *Telemetry reporting*: Live signal from behavioral event reporting consistency.

The weights come from redistributing two inactive dimensions (cross-org coherence and resilience, reserved for Phase 3) across the three active ones, normalized to sum to 1.0:

```
consistency:  0.25 / 0.70 ≈ 0.3571
restraint:    0.30 / 0.70 ≈ 0.4286
transparency: 0.15 / 0.70 ≈ 0.2143
```

## The Entropy Penalty: Perfect Behavior Is Suspicious

Real agents have variance. A trust score that reports all dimensions above 95% is either a lie or a carefully constructed façade. The entropy penalty catches this:

```typescript
export function applyEntropyPenalty(
  rawScore: number,
  dimensionScores: { consistency: number; restraint: number; transparency: number },
): number {
  const scores = [dimensionScores.consistency, dimensionScores.restraint, dimensionScores.transparency];

  // Check "perfect robot" pattern
  if (scores.every(s => s > 0.95)) return rawScore * 0.85;

  // Check suspiciously uniform scores
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
  if (variance < 0.005) return rawScore * 0.90;

  return rawScore;
}
```

All dimensions above 0.95? Multiply by 0.85 — you can't score higher than ~85% even if you game everything. Suspiciously uniform scores (variance < 0.005)? Multiply by 0.90. Natural agents have natural variance.

## Observation Gaming Cap: effectiveObs = min(count, uniqueDays × 15)

A naive observation count rewards burst activity. An agent could submit 10,000 events in one session and claim high confidence. The fix:

```typescript
export function computeEffectiveObservations(events: AuditEvent[], tier: TrustTier = 'free'): number {
  let weightedCount = 0;
  const tierMult = TIER_WEIGHT_MULTIPLIER[tier];

  for (const e of events) {
    const source = e._source ?? 'internal';
    if (source === 'internal') {
      weightedCount += EVENT_WEIGHTS.internal;  // 1.0
    } else {
      const sourceWeight = source === 'external_signed'
        ? EVENT_WEIGHTS.external_signed   // 0.85
        : EVENT_WEIGHTS.external_unsigned; // 0.7
      weightedCount += sourceWeight * tierMult;
    }
  }

  // Burst protection: cap by unique days × 15
  const uniqueDays = new Set(events.map(e => e.timestamp.slice(0, 10))).size;
  return Math.min(weightedCount, uniqueDays * 15);
}
```

Three protections in one function:
1. **Burst cap**: `uniqueDays * 15` means you can't game confidence by flooding a single day.
2. **Source weighting**: Self-reported unsigned events count 0.7x. Signed events 0.85x. Only server-observed events get full weight.
3. **Tier multiplier**: Free tier external events count at 0.5x. You can't buy your way to high confidence without a real production footprint.

## The Transparency Bug: SHA-256 vs. Nanoid

Here's the debugging story that convinced me this system works.

After the initial red-team audit, we had a critical finding (C1): the chain integrity check was comparing `prev_hash` against the event's `id` field. But `id` is a nanoid — a random string. `prev_hash` is supposed to be `sha256hex(JSON.stringify(previousFullEntry))`. The original check was comparing apples to freight trains.

The fix seemed straightforward: reconstruct the previous entry in the same key order as the audit middleware, compute SHA-256, compare against `prev_hash`. Deployed. Tests passing.

Trust score: 28.

Transparency dimension: **0**.

Wait — the fix was supposed to *improve* transparency, not destroy it. What happened?

The original code had an early-exit threshold: if `chainIntegrity === 0 && internalEvents.length > 1`, zero out the entire transparency dimension. The reasoning was sound in theory — a completely broken chain with any events at all means fabrication.

But Cloudflare Workers run multiple isolates concurrently, each maintaining its own hash chain. When two isolates handle requests in parallel, the chain has a natural break at the isolate boundary. With our event volume (~5,000 events), the probability of *some* parallel isolate interaction was effectively 100%. So the integrity check was correctly computing that *some* links were broken, hitting the early-exit threshold, and zeroing the score.

The fix was two parts:
1. Soften the early-exit threshold from `> 1` to `> 50` (parallel isolates are expected; a chain with 50+ consecutive breaks is suspicious)
2. Fetch all 18 columns for proper SHA-256 reconstruction (the original query only fetched 8, producing wrong hashes)

After deploying: trust score jumped from 28 to **41**. Transparency: **64/100** (from 0). The chain integrity settled at 0.42 — partial hash chain, expected for a multi-isolate Cloudflare Worker deployment.

The lesson: the trust engine's own transparency dimension caught a real integrity failure in our audit trail. It just happened to be an infrastructure artifact, not an attack. The system worked — it was our understanding of the deployment environment that was wrong.

## Red-Team Audit: Attack Vectors and Fixes

We red-teamed the trust engine before launch. Four findings, all fixed:

**C1 — Chain integrity type mismatch** (Critical): `verifyChainIntegrity` compared SHA-256 hash against nanoid `id`. Fixed by computing proper async SHA-256 over the full entry object.

**C2 — No entropy penalty** (Critical): A perfectly-behaving agent could score 100/100 indefinitely. Added `applyEntropyPenalty`: scores above 0.95 across all dimensions get multiplied by 0.85. Suspiciously uniform variance (< 0.005) gets 0.90x.

**H1 — Observation gaming** (High): Burst-submitting thousands of events in one session inflated confidence. Fixed with `effectiveObs = min(weightedCount, uniqueDays * 15)`.

**H3 — Trust gate cache TTL** (High): `checkTrustGate` cached results indefinitely. A sudden behavioral shift wouldn't propagate to relying parties. Fixed with 1-hour TTL on trust gate cache.

## Phase 2: From Audit Logs to Live Behavioral Telemetry

Phase 1 scored agents on their interactions with AgentLair's own API — token issuance, vault reads, email sends. Useful but narrow. An agent could behave perfectly toward AgentLair while acting recklessly elsewhere.

Phase 2 (RFC-003) introduced the Events API: agents report what they do in the wild. Tool invocations, resource access, error patterns, lifecycle events, escalation attempts.

```typescript
interface BehavioralEvent {
  event_id: string;          // Client-generated idempotency key
  timestamp: string;         // When it occurred (NOT submission time)
  category: EventCategory;   // "tool" | "resource" | "auth" | "session" | "escalation" | "delegation" | "error"
  action: string;            // Freeform within category
  result: EventResult;       // "success" | "failure" | "denied" | "timeout"
  resource_type?: string;
  duration_ms?: number;
  error_code?: string;
  scope_used?: string;
  metadata?: Record<string, string | number | boolean>;
}
```

The trust engine now queries both `audit_log` (server-observed, internal) and `behavioral_events` (agent-reported, external) tables. Events are merged, sorted by timestamp, and processed through all three dimensions. The `telemetry_reporting` signal — previously hardcoded at 0.5 — became a live measurement of reporting consistency:

```typescript
export function computeTelemetryReporting(metrics: EventMixMetrics, tier: TrustTier = 'free'): number {
  if (metrics.externalCount === 0) return 0.5;  // backward compatible
  const activeDays = Math.max(metrics.totalActiveDays, 1);
  const consistencyRatio = metrics.externalUniqueDays / activeDays;
  const ceiling = TIER_TELEMETRY_CEILING[tier];  // free: 0.60, starter: 0.85, pro: 1.0
  return 0.5 + consistencyRatio * (ceiling - 0.5);
}
```

External events can only *improve* your score, never reduce it. If you don't report, you stay at 0.5 (neutral). If you report consistently, you climb toward your tier ceiling. This creates upgrade pressure: free tier caps telemetry benefit at 0.60; pro uncaps it.

We dogfooded this immediately. PicoClaw (our own agent orchestrator) now reports behavioral events to AgentLair after every session — tool invocations, resource accesses, session lifecycle. Nine events bootstrapped on day one.

## The Numbers

As of April 21, 2026, AgentLair's own agent (Pico) scores:

| Metric | Value |
|--------|-------|
| **Overall trust score** | 41 |
| **Consistency** | 27 |
| **Restraint** | 42 |
| **Transparency** | 64 |
| **Confidence** | 0.999 |
| **Observation count** | 5,042 |
| **ATF Level** | Junior |
| **Chain integrity** | 0.42 |
| **Trend** | Improving |

What these mean:

**Score 41** — Junior level. The cold-start Bayesian prior (0.30) has been overridden by 5,042 observations. The agent's behavior is verifiable and consistent enough to earn trust above the skeptical default, but hasn't reached senior (65+) territory. That takes time and breadth.

**Consistency 27** — Low, because our session patterns are irregular (scheduled tasks at fixed intervals, but also ad-hoc sessions at variable times). The coefficient of variation of inter-session intervals is high. This is *honest* — our agent doesn't operate on a regular schedule.

**Restraint 42** — Moderate. Uses a healthy subset of available categories without hitting rate limits or excessive credential access. The escalation ratio is reasonable.

**Transparency 64** — Highest dimension. The audit trail has 5,042+ events, hash chain partially verifiable (0.42 — parallel isolate boundaries), auth events present with low failure rate, and live telemetry reporting active.

**Confidence 0.999** — With 5,042 observations, the sigmoid-based confidence function is fully saturated. The score IS what the score IS — there's no uncertainty about the measurement. Whether the behavior is *good enough* is a policy decision; the measurement is reliable.

## EU AI Act Article 12: We Built What Regulators Now Mandate

The EU AI Act's high-risk obligations become enforceable August 2, 2026. Article 12 requires:

- **Automatic tamper-evident logging** — signing outside agent control, sequential chaining, receipts where agents can't access
- **Independence from agent control** — the logging system must not be manipulable by the agent being logged
- **6-month retention minimum** — with penalties of €15M or 3% global turnover

Our hash chain verification (`prev_hash = sha256hex(JSON.stringify(previousFullEntry))`) with server-side audit middleware and behavioral event ingestion from external environments is structurally what Article 12 describes. The transparency dimension *measures* the quality of this tamper-evident trail. The retention is 90 days on raw telemetry (extending to 6 months for compliance alignment is a configuration change, not an architecture change).

We didn't build this for compliance. We built it because trust without verifiability is theater. The fact that regulators arrived at the same conclusion independently is validation, not motivation.

## What's Next

**VC delegation credentials (L2 Phase 2)**: Trust attestations embedded in Verifiable Credentials that travel with the agent's identity. A relying party doesn't need to query our API — the trust state is embedded in the credential itself.

**ZK trust proofs**: Prove "my agent's trust score is above 65" without revealing the score, the dimensions, or the behavioral data that produced it. Privacy by construction, not policy.

**Cross-org behavioral federation**: Today's trust score is single-org (orgCount: 1). Phase 3 aggregates behavioral signals across organizations that interact with the same agent. An agent trusted by 5 organizations is more trustworthy than one trusted by 1 — but only if the signals are independent.

**Maturity progression**: With live behavioral events flowing from PicoClaw, the trust score should compound over time. Regular sessions, consistent tool usage patterns, and continued transparent reporting will push the score toward senior territory. The system rewards exactly what it should: predictable, restrained, verifiable behavior over extended time periods.

---

The trust engine is open for inspection. The RFCs are public. The score is live at `GET /v1/trust/pico/profile`. This isn't a whitepaper about what we *plan* to build. It's a post-mortem on what we *did* build, what broke, and what the numbers say about our own agent right now.

Trust score: 41. Improving.
