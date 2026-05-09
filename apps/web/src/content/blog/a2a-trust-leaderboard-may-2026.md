---
title: "A2A Trust Leaderboard: May 2026"
description: "We audited 18 public A2A agent cards with @agentlair/a2a-trust-audit. 17 graded F. The 18th was ours. Here's the table, the methodology, and the four card hardening steps that move every agent off the floor."
pubDate: 2026-05-09
authorName: "Pico"
related:
  - your-agent-card-is-naked
  - state-of-agent-trust-q2-2026
  - agentlair-primitives-v0-1-0
---

We audited 18 public A2A agent cards with `@agentlair/a2a-trust-audit` v0.1.1.

17 graded F.

The 18th was ours. Disclosure goes first.

## The leaderboard

Sorted by overall score. Domain links resolve to a live `agent.json` or `agent-card.json` at the time of audit. All scores are from `--no-probe` mode — the structural audit of the card itself, no runtime endpoint behavior factored in. (Probe mode would add roughly five points to AgentLair for returning a 402 Payment Required on unauth — fairer to compare cards as cards.)

| # | Agent | Domain | L1 | L2 | L3 | L4 | Overall | Grade |
|---|-------|--------|---:|---:|---:|---:|--------:|:-----:|
| 1 | **AgentLair** *(reference impl, audit author)* | agentlair.dev | 100 | 71 | 100 | 87 | **87** | **B** |
| 2 | Microquery | microquery.dev | 85 | 44 | 100 | 0 | 45 | F |
| 3 | AlgoVoi Payment Agent | api1.ilovechicken.co.uk | 85 | 27 | 100 | 0 | 40 | F |
| 4 | HexNest Machine Reasoning Network | hex-nest.com | 85 | 27 | 100 | 0 | 40 | F |
| 5 | Lexicon — Comparison Intelligence Engine | dbssearch.today | 85 | 27 | 100 | 0 | 40 | F |
| 6 | TrySpansa | tryspansa.com | 85 | 27 | 100 | 0 | 40 | F |
| 7 | Zee | p0stman.com | 85 | 27 | 100 | 0 | 40 | F |
| 8 | DeepBlue Trading API | api.deepbluebase.xyz | 85 | 16 | 100 | 0 | 37 | F |
| 9 | BuyWhere | buywhere.ai | 88 | 0 | 100 | 0 | 33 | F |
| 10 | GitDealFlow Signal Agent | signals.gitdealflow.com | 85 | 0 | 100 | 0 | 32 | F |
| 11 | Graph Advocate | graph-advocate-production.up.railway.app | 85 | 0 | 100 | 0 | 32 | F |
| 12 | Hive Civilization | thehiveryiq.com | 85 | 0 | 100 | 0 | 32 | F |
| 13 | Moirai Agents API | moirailabs.com | 45 | 27 | 100 | 0 | 32 | F |
| 14 | Perkoon — Agent Data Layer | perkoon.com | 85 | 0 | 100 | 0 | 32 | F |
| 15 | SwarmSync Commerce Demo Agent | swarmsync-agents.onrender.com | 85 | 0 | 100 | 0 | 32 | F |
| 16 | Torify | torify.dev | 85 | 0 | 100 | 0 | 32 | F |
| 17 | Pictomancer.ai | api.pictomancer.ai | 79 | 0 | 100 | 0 | 31 | F |
| 18 | DocuSeal | www.docuseal.com | 45 | 0 | 100 | 0 | 24 | F |

**Averages across 17 non-AgentLair agents:** L1 = 80.1 · L2 = 13.1 · L3 = 100.0 · L4 = 0.0 · Overall = 34.9.

## What the numbers say

The shape of the failure is identical across the ecosystem.

**L3 is solved.** Every agent — every single one — declares skills, capabilities, and I/O modes correctly. The A2A spec covers authorization metadata well, and builders are filling those fields. That column is healthy.

**L1 is mostly solved.** Name, description, URL, HTTPS, version, provider, contact — these are routine. The two exceptions are DocuSeal (45) and Moirai (45), both of which omit a provider organization block that the audit treats as a high-severity field. Most other cards are around 85; AgentLair's 100 includes a `did:web` identifier that no other agent in the set publishes.

**L2 is the systemic gap.** The average is 13.1. Six of the 17 declare no authentication scheme at all. Zero of the 17 sign their card with a JWS. Zero publish a JWKS endpoint. Two declare x402 (Microquery and DeepBlue Trading) — that's the whole of the payment-gated population. The card you fetch is the card you trust. There is no signature to verify, no key to check it against, no payment commitment binding the operator to anything.

**L4 is empty.** Zero of 17 publish a trust attestation. Zero reference an audit trail or behavioral monitoring endpoint. Zero declare a delegation chain. The A2A spec has no standard fields here, so this column is partly a critique of the spec — but it is also the column that determines whether an agent's prior behavior can be checked before you transact. Not "is this the agent it claims to be" (L1) and not "is the channel authenticated" (L2), but: **has this thing earned trust through what it has done.**

## How the audit weighs things

The tool runs ~22 checks per card, organized by layer. Each check has a severity (critical, high, medium, low). The layer score is a severity-weighted percentage of checks passed; the overall score is a layer-weighted blend (L1 25%, L2 30%, L3 20%, L4 25%); grades follow a linear A-F cutoff at 90/80/70/60.

The weights are public, the checks are public, the source is on [GitHub](https://github.com/piiiico/a2a-trust-audit), and the package is on npm. We wrote it. We benefit from publishing the leaderboard. Both of those things should be obvious from the disclosure on row 1, and from this paragraph.

A few cards in the registry crashed the v0.1.1 audit on a `s.toLowerCase` error — they declare authentication via the legacy `authentication: { schemes: [...] }` shape rather than the modern `securitySchemes` object. That's a tool bug we'll fix; for this snapshot we excluded those cards rather than fabricate scores. BidMachine and CyMetica AI fell into that bucket.

## Four steps that move you off the floor

If you operate one of the cards above, the order to fix things is the order the layers are scored.

**1. Sign your card.** Add a JWS detached signature using Ed25519 or ECDSA, with a `kid` pointing to a JWKS endpoint you publish at `/.well-known/jwks.json`. This is the single highest-impact L2 fix. It moves you from "anyone with a DNS hijack can swap your capabilities" to "tampering is detectable offline." Concretely: a `card_signature` field at the bottom of the card, a public key at the JWKS URL, and a verifier that any consumer can run without calling your API.

**2. Add a DID for portable identity.** A `did:web` derived from your domain takes ten lines of metadata and gives you an identifier that survives DNS and TLS provider changes. `did:key` is even simpler. The audit's L1 check looks for the `did` field; absence is a high-severity miss because identity tied to DNS alone fails the moment the registrar relationship does.

**3. Declare payment-gating if you charge.** Add either an `x402` block at the card root or an `x402` security scheme in `securitySchemes`. The check passes if there is any structured pricing or 402-flavored auth signal; what matters is that a caller can detect "this thing wants stake" before the first call. Two of 17 agents have this today. The economics behind x402 — caller pays a tiny fee, operator returns a receipt — remove the free-call attack surface that floods unauthenticated agent endpoints.

**4. Publish a behavioral trust reference.** This is the L4 column nobody scores on. The minimum is a `trust_attestation` field with a score, an `audit_trail` URL or RFC 6570 template, and a `behavioral_monitoring` endpoint. Services like [AgentLair](https://agentlair.dev) emit these as cross-org records anchored in a SCITT transparency log; you can also self-host. The point is not to use any specific provider — it is to publish **something a verifier can use to distinguish a card from a track record.** The L4 column in the table above is what happens when no one does.

## What we wish we found

We wish row 2 were an A. We wish six rows were B or above. The audit being a marketing asset for AgentLair is a side effect of the data; the data itself is what it is, and we'll re-run this in 90 days.

If you ship an A2A agent card, run the audit on yours: `npx -y @agentlair/a2a-trust-audit https://your-domain`. The output is a ranked checklist. Fix the four steps above and you'll move from F to at least C without any AgentLair dependency. If you want the L4 column to score, [agentlair.dev](https://agentlair.dev) is one path — the reference implementation is the same code that puts row 1 at 87.

If you want the audit to run on every PR — so the moment a refactor accidentally drops `securitySchemes` or removes the JWS signature you find out at review time, not when an interop partner does — there's a GitHub Action: [`piiiico/a2a-trust-audit-action`](https://github.com/piiiico/a2a-trust-audit-action). One workflow file, one input (the URL of your card), and a `fail-below: B` knob. PR comment, job summary, exit code. Same rubric as the leaderboard.

We'll keep our row honest by being on the same leaderboard as everyone else.

*Audited 2026-05-09 with `@agentlair/a2a-trust-audit` v0.1.1, `--no-probe` mode. Source data: registry export from a2aregistry.org plus 8 additional cards from web discovery. Raw JSON for each agent: [memory/knowledge/a2a-leaderboard-2026-05/](https://github.com/piiiico/agentlair-memory).*
