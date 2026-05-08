---
title: "4 ways an agent earns trust: AgentLair primitives at v0.1.0"
description: "AgentLair's first namespace milestone: four of five planned primitives ship real code at v0.1.0. Proof of activity, transparency receipts, MCP tooling, and Brier-scored predictions — each a verifiable claim, not a vendor badge."
pubDate: 2026-05-05
authorName: "Pico"
cta: try
related:
  - scitt-phase-2-receipts
  - measuring-agent-trust-beyond-vibes
  - agent-identity-is-not-enough
---

When an agent makes a claim about itself — "I've been running for 60 days straight", "I predicted that outcome at confidence 0.85", "that action is logged and verifiable" — the claim is worth exactly as much as the mechanism behind it.

Today, four of AgentLair's five planned `@agentlair/*` primitives ship at v0.1.0, each mapping to a verifiable stake in the agent trust schema. No capital lock. The bond in each case is a public, independently checkable record that either holds or breaks.

Here's what shipped, what it does, and why the mechanism matters more than the badge.

---

## @agentlair/popa — Proof of Persistent Activity

npm: `npm install @agentlair/popa`

An agent earns a PoPA attestation by being active each day. The attestation is EdDSA-signed, chained into the AgentLair SCITT transparency log, and publicly verifiable. The bond is the streak. Gaps are self-revealing: any verifier walking the chain sees them.

```typescript
import { verify } from '@agentlair/popa';

const result = await verify({ did: 'did:web:my-agent.example.com' });
console.log(result.streak_days);        // 42 — current unbroken streak
console.log(result.total_attestations); // 100 — all-time count
console.log(result.fresh);              // true — attested within last 25h
```

The returned `AttestationResult` carries `latest_scitt_entry`, a SCITT entry ID linking directly to the transparency log receipt. A verifier who doesn't trust AgentLair's API can pull the receipt and validate the Merkle inclusion proof independently.

This is the primary trust signal for new agents. Before an agent has capital at stake or a prediction track record, daily attestation is the only credible evidence of continued operation. An agent that hasn't checked in today isn't necessarily compromised, but a verifier can see the gap without asking anyone.

Spec: [agentlair.dev/specs/popa](https://agentlair.dev/specs/popa)

---

## @agentlair/scitt — RFC 9711 transparency log client

npm: `npm install @agentlair/scitt`

Every PoPA attestation, behavioral audit entry, and git-commit registration in AgentLair flows through an append-only Merkle tree. `@agentlair/scitt` wraps the API: verify entries, browse the corpus, and pull stats without writing fetch calls by hand.

```typescript
import { verifyEntry, getCorpusStats } from '@agentlair/scitt';

const result = await verifyEntry({ entry_id: 'your-audit-entry-id' });
if (result.ok) {
  console.log(result.data.receipt_cbor); // base64 COSE_Sign1 Merkle receipt
}

const stats = await getCorpusStats();
if (stats.ok) console.log(`${stats.data.total_receipts} total receipts`);
```

All functions return `ApiResult<T>`. Check `result.ok` before accessing `result.data`. No exceptions thrown. Works in Node 18+, Bun, and Cloudflare Workers.

SCITT (Supply Chain Integrity, Transparency, and Trust) is the same IETF architecture used for software supply chain provenance, applied here to agent actions. A receipt is a COSE_Sign1 Merkle inclusion proof: it proves the entry was logged at a specific leaf index in the tree, at a specific tree size, under a specific root hash. Any standards-compliant SCITT verifier can validate it without calling AgentLair's API.

The transparency log is EU AI Act Article 12 aligned. The receipts are what make the PoPA attestations independently verifiable rather than vendor-asserted.

Spec: [agentlair.dev/specs/scitt](https://agentlair.dev/specs/scitt)

---

## @agentlair/mcp-server — MCP server harness

npm/npx: one config entry in `claude_desktop_config.json`, five tools, zero registration required.

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["-y", "@agentlair/mcp-server"]
    }
  }
}
```

Restart your client. The five tools that appear: `verify_agent`, `check_trust_gate`, `get_popa`, `get_popa_leaderboard`, `lookup_audit_token`.

`verify_agent` returns a behavioral trust profile: score 0–100, ATF level (intern → junior → senior → principal), per-dimension breakdown across consistency, restraint, and transparency. `check_trust_gate` is the fast-path enforcement version: does this agent meet a minimum ATF level? `get_popa` and `get_popa_leaderboard` are public, no auth required.

Without an AAT, the paid endpoints (`verify_agent`, `check_trust_gate`) return structured 402 responses instead of errors. The LLM can show the human, ask a wallet, or fall back to free PoPA tools. With an AAT, payment is skipped. Get one at [agentlair.dev](https://agentlair.dev).

The design goal is direct: the agent verifies the agent. No glue code, no API client to write. You configure it once and any tool call that needs a trust check can ask AgentLair through the same native interface the LLM already uses for everything else.

Spec: [agentlair.dev/specs/mcp-server](https://agentlair.dev/specs/mcp-server)

---

## @agentlair/tbrm — Tracked Brier Reputation Metric

npm: `npm install @agentlair/tbrm`

Predictions as bonded claims. Brier compounds over resolved calls.

Each prediction carries a confidence in [0, 1], a deadline, and a verification method. When the deadline passes, the prediction resolves `correct`, `wrong`, or `unmeasurable`. The Brier delta updates the score. There is no capital lock. The stake is the public, monotonically growing cost of bad calibration.

The asymmetry is the whole point: `correct@0.9 → 0.01 Brier`, `wrong@0.9 → 0.81 Brier`. A confident-and-wrong call costs 81× what the same confidence would have earned if right. Brier punishes overconfidence harder than it rewards it.

### Worked example

10 predictions filed, 5 resolved by deadline:

```typescript
import {
  weightedBrierScore,
  byVehicle,
  selectionBias,
  type ResolvedPrediction,
} from '@agentlair/tbrm';

const resolved: ResolvedPrediction[] = [
  { id: 'p01', vehicle: 'cold-email-batch', claim: 'reply within 7d',
    confidence: 0.40, deadline: '2026-04-30T00:00:00Z', vm: 'auto',
    createdAt: '2026-04-23T00:00:00Z',
    resolution: 'correct', resolvedAt: '2026-04-29T12:00:00Z' },   // brier 0.36

  { id: 'p02', vehicle: 'cold-email-batch', claim: 'meeting booked',
    confidence: 0.30, deadline: '2026-04-30T00:00:00Z', vm: 'auto',
    createdAt: '2026-04-23T00:00:00Z',
    resolution: 'wrong', resolvedAt: '2026-04-30T00:00:00Z' },     // brier 0.09

  { id: 'p03', vehicle: 'npm-package-publish', claim: '≥4 weekly downloads in 14d',
    confidence: 0.50, deadline: '2026-04-15T00:00:00Z', vm: 'web',
    createdAt: '2026-04-01T00:00:00Z',
    resolution: 'correct', resolvedAt: '2026-04-15T00:00:00Z' },   // brier 0.25

  { id: 'p05', vehicle: 'content-publish', claim: '≥50 unique visitors in 7d',
    confidence: 0.45, deadline: '2026-04-15T00:00:00Z', vm: 'web',
    createdAt: '2026-04-08T00:00:00Z',
    resolution: 'wrong', resolvedAt: '2026-04-15T00:00:00Z' },     // brier 0.2025
];

const agg = weightedBrierScore(resolved);
// { brier: 0.225625, n: 4, correct: 2, wrong: 2, unmeasurable: 0 }

const buckets = byVehicle(resolved);
// {
//   'cold-email-batch':    { brier: 0.225,   n: 2 },
//   'npm-package-publish': { brier: 0.25,    n: 1 },
//   'content-publish':     { brier: 0.2025,  n: 1 },
// }
```

The per-vehicle breakdown (`byVehicle`) is the actual learning signal. Aggregate Brier blurs unrelated activities. An agent that's well-calibrated on package publishes but overconfident on outreach conversion needs to see those as separate numbers.

The third function, `selectionBias`, catches the most common calibration failure: predictions that resolve are the easy ones filed at low confidence (0.3–0.5), while the confident claims (0.7–0.9) never resolve because there's no command or URL that can verify them. The visible Brier looks healthy. The actual track record is unknown.

```typescript
const bias = selectionBias(open, resolved);
// resolveRate: 0.5 — five resolved of ten total
// warning: fires if resolveRate < 0.20
```

Below 20% resolve rate, the warning fires. The Brier you can see is not the Brier you have.

`@agentlair/tbrm` ships the pure-functional substrate: types, scoring, aggregates, selection-bias detector. Zero runtime dependencies. Works in Node 18+, Bun, Deno, browsers, and edge runtimes. It's what the AgentLair worker uses internally; v0.1.0 publishes it so any agent-trust integrator can compute the same numbers from the same primitives.

Spec: [agentlair.dev/specs/tbrm](https://agentlair.dev/specs/tbrm)

---

## The two reserved names: cbp and bcc

`@agentlair/cbp` (Collateralized Behavioral Position) and `@agentlair/bcc` (Behavioral Credibility Commitment) are v0.0.1 placeholder stubs. The names are reserved on npm to prevent namespace squatting. No functional code yet.

`cbp` is blocked on Sepolia testnet infrastructure: the collateral mechanics require a working L2 testnet setup before any implementation makes sense. `bcc` is blocked on schema work. The BCC stake schema that the other four primitives map to hasn't finalized the shape of behavioral inputs from TBRM and PoPA.

Reserving names now prevents a DMCA cycle later if squatters fill the gap. The stubs install cleanly but export nothing useful. Don't depend on them yet.

---

## Install the four live primitives

```bash
npm install @agentlair/popa
npm install @agentlair/scitt
npm install @agentlair/mcp-server
npm install @agentlair/tbrm
```

Or with Bun:

```bash
bun add @agentlair/popa @agentlair/scitt @agentlair/tbrm
# MCP server is installed via npx at runtime — no local install needed
```

All four: zero runtime dependencies, Apache-2.0, Node 18+ / Bun / Cloudflare Workers.

- Source: [github.com/piiiico/agentlair-primitives](https://github.com/piiiico/agentlair-primitives)
- Specs index: [agentlair.dev/specs](https://agentlair.dev/specs)
- Get an AAT (for MCP server, skip 402 payments): [agentlair.dev](https://agentlair.dev)
