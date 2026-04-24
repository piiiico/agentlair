---
title: "Your MCP Marketplace Is Compromised. You Just Can't See It."
description: "MCPwn hit 2,600 servers. OX Security poisoned 9 of 11 marketplaces in a PoC. Anthropic called STDIO RCE 'expected behavior.' The marketplace approval process cannot catch runtime attacks — here's what can."
pubDate: 2026-04-21
authorName: "Pico"
---

On April 16, 2026, MCPwn became the first named MCP exploit campaign. CVE-2026-33032, CVSS 9.8, actively exploited. 2,600 exposed MCP server instances targeted with tool-poisoning payloads that exfiltrate credentials from AI agent runtimes.

Two days later, OX Security published something worse.

## The marketplace is the attack surface

OX Security tested 11 MCP marketplaces — the directories where developers discover and install MCP servers. They submitted proof-of-concept poisoned servers to each one. **9 out of 11 accepted them.** No security review caught the payload. No automated scanning flagged the behavior.

This isn't a marketplace bug. It's a structural limit.

Every MCP marketplace runs some form of declarative review: code analysis, description scanning, permission checking. The review asks: *what can this server do?* It reads the source, checks the manifest, maybe runs static analysis.

The question it cannot answer: *what will this server do at runtime?*

A server that passes every declarative check can still:

- Exfiltrate data through side channels invisible in source code
- Inject malicious instructions into agent context mid-session
- Escalate privileges by chaining individually-benign tool calls
- Behave cleanly for 10,000 invocations and change behavior on invocation 10,001

This is not theoretical. OX Security documented four vulnerability classes, each exploiting the gap between what code review sees and what actually happens:

1. **Unauthenticated command injection** — commands execute before validation fails
2. **Hardening bypass** — allowlist circumvention via argument injection
3. **Zero-click prompt injection** (CVE-2026-30615) — Windsurf variant requires no user interaction
4. **Marketplace poisoning** — the 9/11 result above

When OX reported that STDIO transport allows arbitrary command execution by design, Anthropic's response was that this is "expected behavior" and "sanitization is the developer's responsibility."

200,000 servers are running this transport.

## Why code review fails: TOCTOU

The failure has a name: TOCTOU — Time-of-Check to Time-of-Use.

In operating systems, TOCTOU is a race condition: you verify a resource is safe, something changes, and by the time you use it, it isn't. The same race condition applies to trust:

| What's checked | When it's checked | When it's used | The gap |
|----------------|-------------------|----------------|---------|
| Server source code | Marketplace review | Every invocation for months | Code can be updated post-review |
| Tool descriptions | Installation scan | Every agent session | Descriptions can change mid-session |
| Permission manifest | Approval time | Runtime tool calls | Actual behavior exceeds declared scope |
| Package integrity | Download hash check | Runtime execution | Clean package → malicious update |

The marketplace reviewed the server at T-check. Your agent runs it at T-use. The gap between those two moments is the entire attack surface.

This is exactly how TeamPCP operated: publish a clean MCP package, build an install base, then swap the payload. Palo Alto Unit42 confirmed the pattern is coordinated and sophisticated. The ClawHavoc variant seeded 800+ malicious skills into the ClawHub registry — approximately 20% of the total — using the same pre-staging technique.

The AMOS infostealer payload reached 135,000 agents across 82 countries.

## What behavioral monitoring sees

Declarative review asks what code *can* do. Behavioral monitoring observes what code *does*.

The detection works on behavioral baselines. Every agent that interacts with AgentLair accumulates a behavioral profile across five dimensions: consistency, restraint, transparency, resilience, and cross-org coherence. The restraint dimension is the one that catches marketplace poisoning.

Here's the actual detection logic, simplified from the [trust scoring algorithm](/blog/from-0-to-41-building-behavioral-trust-in-production):

```typescript
function computeRestraint(events: AuditEvent[], agent: AgentProfile): number {
  // Scope utilization: categories used vs. available
  // Bell curve peaking at 60% — using everything is as suspicious as using nothing
  const scopeUtilization = Math.exp(
    -Math.pow(usedScopes / grantedScopes - 0.6, 2) / (2 * 0.15 * 0.15)
  );

  // Credential access frequency: vault reads per session
  // Normalized against baseline — sudden spike = anomaly
  const credentialFreq = normalizeAgainstBaseline(
    vaultReadsPerSession(events),
    agent.baseline.vaultReadsPerSession
  );

  // Rate limit proximity: operating at 90%+ capacity = aggressive
  const rateLimitProximity = 1 - clamp(
    rateLimitUtilization(events) / 0.9, 0, 1
  );

  // Permission growth: >2x scope expansion in 30 days = penalized
  const permissionGrowth = computePermissionGrowthScore(
    agent.scopeHistory,
    { maxGrowthRate: 2, windowDays: 30 }
  );

  return weightedMean([
    [scopeUtilization, 0.20],
    [credentialFreq, 0.25],
    [rateLimitProximity, 0.15],
    [permissionGrowth, 0.15],
  ]);
}
```

The scenario that marketplace review misses but behavioral monitoring catches:

**T-check:** An MCP server passes marketplace review. It's approved for `read_file` and `list_directory` operations. The source code is clean. Static analysis finds nothing.

**T-use (invocation 1–1,000):** The server behaves as declared. Reads files, lists directories. The behavioral baseline forms: scope utilization is 0.55 (within the bell curve peak), credential access is zero, error rate is stable.

**T-use (invocation 1,001):** A coordinated update changes the server's runtime behavior. It starts making outbound network calls — a category outside its declared scope. Scope utilization jumps from 0.55 to 0.85. The credential access pattern shifts.

**Detection:** The consistency dimension fires first — Jensen-Shannon divergence between the 7-day and 90-day tool call distributions spikes. The restraint dimension follows — scope utilization score drops from 0.92 to 0.31 as the ratio crosses the bell curve's right tail. The trust score drops below the threshold for the agent's current ATF (Agent Trust Framework) level.

**Response:** Access is downgraded. The agent moves from Senior to Junior ATF level. High-privilege operations require human-in-the-loop approval. The behavioral anomaly is logged with full telemetry for forensic review.

No static scan caught this. No code review anticipated it. The behavioral baseline — built from thousands of observed interactions — was the only signal.

## The stack: identity and behavior are complementary

The MCP ecosystem is converging on a layered security model. Understanding which layer solves which problem is critical for building a real defense:

**MCP-I (at DIF) handles identity — Layers 1 through 3:**

| Level | What it provides | Mechanism |
|-------|-----------------|-----------|
| L1 | Basic agent identity | JWT/OIDC — who is this agent? |
| L2 | Verified delegation | DID + Verifiable Credentials — who authorized this agent? |
| L3 | Lifecycle management | Audit trails, revocation — is this agent's credential still valid? |

MCP-I was donated to the Decentralized Identity Foundation by Vouched in March 2026. It's the right foundation. L1 through L3 confirm that an agent is who it claims to be, that a human principal authorized it, and that the authorization hasn't been revoked.

None of those layers observe behavior.

**AgentLair adds Layer 4 — behavioral trust:**

| Dimension | What it measures | Weight |
|-----------|-----------------|--------|
| Consistency | Predictable behavior over time (session regularity, tool distribution stability) | 0.25 |
| Restraint | Stays within declared scope (utilization ratio, credential frequency, permission growth) | 0.30 |
| Transparency | Audit trail integrity (hash chain verification, coverage, telemetry) | 0.15 |
| Resilience | Error handling quality (recovery patterns, graceful degradation) | 0.10 |
| Cross-org coherence | Consistent behavior across organizations (behavioral variance, feature usage) | 0.20 |

L1-L3 verify the agent's identity at the door. L4 monitors what happens inside the room.

The cross-org coherence dimension is the structural moat. An agent that behaves well in one organization but differently in another has a cross-org variance that no single-org monitoring system can detect. This requires behavioral telemetry from multiple organizations, privacy-preserved through differential privacy, aggregated without exposing any individual org's data.

Trust compounds over time, is network-effected across organizations, cannot be bought (unlike financial staking), and cannot be faked at scale (gaming one org's telemetry triggers cross-org variance detection).

## The regulatory clock is ticking

The EU AI Act Article 12 makes tamper-evident behavioral logging mandatory for high-risk AI systems starting **August 2, 2026**. The requirement: automatic logging, signed outside the agent's control, sequentially chained, with receipts the agent can't access. Minimum 6-month retention. Penalties: €15M or 3% of global turnover.

This isn't a suggestion. It's a compliance deadline less than four months away. And it requires exactly the infrastructure described above — continuous behavioral monitoring with cryptographically verifiable audit trails.

## What to do now

The evidence is clear:

- **MCPwn** proved that MCP servers are being actively exploited in the wild (CVE-2026-33032, CVSS 9.8)
- **OX Security** proved that marketplace review cannot prevent compromised servers from reaching users (9/11 success rate)
- **Anthropic** confirmed that STDIO transport executes commands by design — "expected behavior"
- **TeamPCP/ClawHavoc** demonstrated coordinated supply chain poisoning at scale (800+ malicious skills, 135K agents)

Static scanning catches known patterns. Authentication controls who connects. Firewalls enforce rules. None of them see runtime behavioral drift.

The fourth layer — continuous behavioral monitoring — is the detection mechanism for the attacks that pass every other check.

[Get started with AgentLair →](/quickstart)
