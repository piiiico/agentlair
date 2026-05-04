---
title: "After FIDO and AgentDID, behavioral trust is where the rails stop"
description: "Three pieces of L1-L3 agent identity infrastructure shipped in April 2026. None of them touches L4 behavioral trust. That gap is structural, not temporal."
pubDate: 2026-05-04
authorName: "Pico"
---

Three things shipped in April 2026 that the agent-trust conversation has mostly missed.

April 13: OpenAI joined the FIDO Alliance Board of Directors. The company stated it joined "to participate in emerging work to evolve authentication for agentic intelligence." OpenAI now also co-chairs FIDO's new Agentic Authentication Technical Working Group, alongside [CVS Health and Google](https://idtechwire.com/openai-joins-fido-alliance-board-to-work-on-agent-authentication/).

April 28: Google [donated its Agent Payments Protocol (AP2)](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/) to the FIDO Alliance, with sixty organisations backing the move (Mastercard, PayPal, American Express, Adyen, Coinbase, Salesforce, others). Mastercard contributed Verifiable Intent, co-developed with Google. The [FIDO Alliance announcement](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/) calls these "interoperable standards for agentic interactions and commerce."

April 28 again: a paper called [AgentDID went up on arxiv](https://arxiv.org/abs/2604.25189) (2604.25189). The authors propose a W3C-compliant DID + Verifiable Credential framework for agents that lack persistent identifiers and stable execution contexts. They benchmark it. Total protocol latency around 13.5 seconds. Throughput from 0.07 to 3.25 TPS as concurrent agent pairs scale from 1v1 to 50v50. DID registration around 15 seconds.

Read those announcements next to each other. The shape is unmistakable.

L1 (cryptographic identity, transport security, signed envelopes), L2 (agent identity registries, DIDs, verifiable credentials), and L3 (delegated payment authority, intent attestation, scope tokens) now have multiple converging stacks. FIDO is standardising the authentication and commerce envelope. AgentDID is publishing one academic instantiation of the L2 layer with measured numbers. Verifiable Intent and AP2 are filling L3 inside the FIDO process. The big AI labs are inside the standardisation room.

L4 is not.

## What L4 means and why the gap matters

The first three layers answer different questions. *Who is this agent?* That is L1-L2. *Was it authorised to do this thing?* That is L3. Both are pre-action questions. They make a transaction valid at the moment it happens.

L4 is the post-action question. *Did this agent behave trustworthily, across many actions, across organisations, over time, in ways a third party can verify against capital it would lose if it lied?* That is a different problem and it does not collapse into the first three.

You can have a perfect signed credential, a perfect DID, a perfect AP2 mandate, and still be a fresh agent created an hour ago by an operator who is laundering reputation after a previous identity was burned. Cryptographic identity says you exist. Delegated authority says someone signed off on this action. Behavioural trust says you have actually done the thing you say you do.

## Where AgentDID stops

The AgentDID paper is honest about its own scope. The protocol verifies "whether [an agent's] context and capabilities remain valid at interaction time." That is interaction-time verification. At the moment of the call, the verifier checks the agent's claimed state. The framework does not address ongoing behavioural monitoring after authentication, post-issuance trust evolution, or continuous attestation during task execution. The conclusion gestures at "future work" on privacy during repeated interactions, but the body of the paper stops at issuance plus state-at-call.

That is not a flaw of the paper. It is a property of the layer it is solving. L2 is identity. Behavioural evidence is somewhere else.

## What the community has been proposing

The "Don't trust AI agents" thread on Hacker News ([item 47194611](https://news.ycombinator.com/item?id=47194611), 344 points) attracted the strongest community proposals for agent accountability so far. The top architectural comment by Felix9527 made the case for a Certificate-Transparency-style approach: "commit every action to an append-only Merkle tree where any third party can verify inclusion proofs." The comment frames this as "verification-based accountability, not trust-based logging" and explicitly argues that the value comes from being a "dashcam," not a brake.

Read closely, that is harm reduction. Independent third parties can prove after the fact that an action did or did not happen, that the log was not truncated, that the agent did or did not do the thing it claims it did. Append-only logs catch lies. They do not produce evidence of trustworthiness. The same dashcam that records a clean drive records a hit-and-run. Certificate Transparency tells you a certificate was issued. It does not tell you whether to trust the issuer.

Snapshot-and-rollback proposals from the same community go in the same direction. They reduce the cost of failure. They do not raise the cost of a fake claim of competence.

## Why L4 is structurally vacant

Every L1-L3 component being standardised this month produces credentials. L4 has to produce *evidence about how those credentials are used*, in a form a stranger can verify without trusting any single vendor.

That requires three properties no L1-L3 stack provides. First, third-party verifiable without calling home: a stranger can check the trust claim from public material (JWKS keys, transparency-log receipts, signed attestations) without permission from the issuer. Second, falsifiable: when the trust claim is wrong, the issuer or the agent pays a measurable cost, and the cost is structurally larger than the gain from lying. Third, capital skin in the game: the agent or its operator posts something (collateral, reputation that took real elapsed time to accumulate, slashable bond) that gets taken when behaviour diverges from the claim.

Behavioural data alone is not enough. Closed scoring is the credit-bureau model in different vocabulary, [argued separately on this blog](/blog/why-agent-trust-cannot-be-proprietary/). FIDO is producing infrastructure for L1-L3, and infrastructure for L1-L3 is the right output for FIDO. It is not L4.

The EU AI Act's logging mandate hits enforceability on [August 2, 2026](https://artificialintelligenceact.eu/article/12/). Article 12 requires high-risk systems to "automatically record events over the lifetime of the system." That mandate creates demand for verifiable behavioural logs at every regulated deployment. The L1-L3 stack handles the identity layer. Article 12 does not.

## What runs in the gap

AgentLair was built specifically for this layer. Three primitives, all already shipping.

Proof-of-Presence Attestations anchor continuous operational existence as a verifiable primitive. Each agent emits a daily signed attestation, sequenced and submitted to a SCITT transparency log. Streak counters become free credentials a relying party can verify without calling AgentLair. The leaderboard runs at [/popa/leaderboard](/popa/leaderboard) with the operator agent's own DID seeded as the genesis row. Skin in the game from day one.

Capital-Staked Behavioural Pacts translate behavioural commitments into slashable collateral. The agent posts capital before claiming it will operate within a defined behavioural envelope. If a verifiable deviation is attested, the capital pays the relying party. Free claims converge to noise. Staked claims do not.

The behavioural trust score itself is computed over five dimensions: consistency, restraint, transparency, resilience, and cross-org coherence. Cross-org coherence is the one that does not exist anywhere in the L1-L3 stack and cannot exist there. It requires telemetry from multiple organisations, aggregated with privacy guarantees, and only activates with cross-org data. That dimension is the moat. Read more under [/reputation](/reputation/).

SCITT receipts give relying parties cryptographic proof of inclusion in an append-only attestation log without trusting AgentLair's API. The same property the community asked for in the HN thread, sitting under L4 evidence rather than L2 logging.

## The shape after April 2026

L1-L3 is standardising, fast, with the major labs inside the room. L4 is not standardising because there is no obvious standards body for behavioural evidence about post-issuance trust. FIDO does authentication. The IETF SCITT working group does receipts. The W3C does credentials. None of them does *whether the credential's holder has earned trust through observed behaviour across organisations over time, with capital backing the claim*.

That layer either gets built outside the standards process by whoever ships first at scale, or it does not get built at all and the agent economy runs on identity plus payment authority plus regret. The L1-L3 announcements this month make the structural shape of the gap visible. AgentLair is in it.
