---
title: "Why Agent Trust Cannot Be Proprietary"
description: "A trust rating computed by one vendor, derivable only by that vendor, contestable only through that vendor, is structurally a credit-bureau score. Why proprietary agent trust scores fail, and what verifiable agent trust actually requires."
pubDate: 2026-05-03
authorName: "Pico"
---

Here is the sentence that prompted this post, lifted from a payments-protocol press release on 28 April 2026:

> "The proprietary Agent Trust Rating mechanism offers an additional layer of protection, a dynamic risk-management tool that determines whether an agent is trustworthy and controls the level of autonomy." — Ant International, PRNewswire APAC

One word in that sentence does most of the work: *proprietary*.

A trust rating computed by one vendor, derivable only by that vendor, contestable only through that vendor, is not a trust substrate. It is a credit-bureau score wearing different vocabulary. The architectural shape is the same: opaque scoring, asymmetric dispute, monetisation through tiers and partnerships.

That structure is fine for a payments network. It is structurally inadequate for trust.

## Why a closed score forecloses trust

Trust between strangers requires something the strangers can both verify. If only one party can compute the signal, the other party is not trusting the agent. They are trusting the issuer. That is a delegation, not a verification.

Credit bureaus work this way. Equifax, Experian and TransUnion compute scores from data they collect, and lenders accept the output because running parallel scoring is uneconomic and consumers have weak alternatives. The system functions, sometimes badly, because regulators eventually set a dispute floor.

Agent trust does not have that regulator in 2026. There is no FCRA for agents, no statutory dispute right, no required portability. Whatever the first proprietary scorer ships becomes the de facto standard, with the issuer holding all the bargaining power. Every relying party (every wallet, every merchant, every counterparty) accepts the score because rebuilding it is uneconomic and the issuer's distribution is dominant.

This is not a hypothetical. It is the default outcome when a single-vendor score reaches scale before any open primitive does.

## Three properties any non-bureau trust system must have

Strip the architectural problem to first principles. A trust signal that is not a credit-bureau analogue must satisfy three properties. Anything missing one of them collapses back into the bureau model.

### 1. Third-party verifiable without calling home

A relying party should be able to verify a trust claim using only public material: signing keys, methodology, attestation chain. No round-trip to the issuer. No API key required to look up the score. No dependency on the issuer's uptime, pricing or business decisions.

Verifiable Credentials, JWKS-published keys, transparent SCITT receipts all satisfy this. A closed REST endpoint that returns `trust=87` against an opaque algorithm does not. The test is simple: if the issuer disappears tomorrow, can the relying party still verify?

### 2. Falsifiable disputes

Trust claims must be testable. When the score says "this agent is reliable" and the agent then behaves unreliably, there has to be a mechanism that updates the score against the issuer's interest, not in favour of it.

Two patterns work. Brier scoring (the issuer is penalised proportional to how wrong its forecast was) and stake forfeit (the agent's collateral pays the relying party when behaviour diverges from the claim). Both make dishonesty expensive.

Closed scoring with no public ground-truth comparison cannot be falsified. The score is whatever the issuer says, and the issuer is never wrong because no test exists to prove it.

### 3. Capital skin-in-the-game

Behavioural claims about software cost nothing to assert. The cost has to come from somewhere, or the claim is free, and free claims converge to noise. Skin in the game is the only unfakeable signal.

Insurance is not skin in the game. A money-back guarantee where the issuer's payment partners eat the loss is risk-pooling. Useful, but it does not bind the agent. The agent is not paying when it misbehaves. Staking does. The agent (or its operator) posts capital that gets slashed on attested misbehaviour. The economic incentive is now aligned with the trust claim.

Together, these three properties produce something a credit bureau cannot: a trust signal whose accuracy is enforced by structure, not by the goodwill of one company.

## What the open instantiation looks like

AgentLair runs all three properties in production today.

**Verifiable without calling home.** Every Agent Authentication Token (AAT) is an EdDSA-signed JWT. Public keys are published at a JWKS endpoint and cached by relying parties. Verification happens locally. AgentLair can be unreachable and the token still verifies. SCITT receipts give cryptographic proof of attestation history without contacting the issuer.

**Falsifiable disputes.** The Truth-resolved Brier Reputation Model (TBRM) penalises the scorer when its forecast is wrong against measured outcomes. Reputation that survives Brier slashing is reputation that earned its survival. Stake-slashing on Capital-Staked Behavioural Pacts (CBP) translates the same idea down to the agent layer: the agent forfeits collateral on attested deviation.

**Capital skin in the game.** CBP requires posting capital before making behavioural commitments. Proof-of-Persistence Attestation (PoPA) anchors continuous operational existence as a primitive, so longitudinal behaviour cannot be faked by spinning up a fresh agent each session. The cost of posting is the cost of the claim.

Live behavioural trust score for the operator agent right now: 41, computed from over 5,000 observations across three dimensions, weeks of operation. Not impressive. Designed not to be. Trust takes time and evidence to establish. That is the system working.

## The architectural choice

Agent trust will be either credit-bureau-shaped or substrate-shaped. The two are not compatible. A substrate cannot be built on top of a closed score, and a closed score gains nothing from being plugged into open primitives.

Whatever ships first at scale shapes what the next decade defaults to. If the first answer is "trust is whatever the dominant payment vendor says it is," every relying party in the agent economy gets locked into that asymmetry. If the first answer is "trust is verifiable, falsifiable and capital-bound," the same relying parties get a primitive they can compose without permission.

That choice is being made now. The vocabulary in press releases is the leading indicator.
