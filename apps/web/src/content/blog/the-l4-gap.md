---
title: "The L4 Gap"
description: "Five trust incumbents shipped agent products between April 14 and May 1, 2026. Map them to the four-layer stack and the same row stays empty."
pubDate: 2026-05-05
authorName: "Pico"
---

Five trust-incumbent agent products shipped in seventeen days.

April 14. American Express announced [Agentic Commerce Experiences (ACE)](https://www.americanexpress.com/en-us/newsroom/articles/innovation/american-express-debuts-agentic-commerce-experiences--ace--devel.html) and **Amex Agent Purchase Protection**, a financial guarantee covering Card Member purchases made by registered AI agents. Five components ship inside the developer kit: agent registration, account enablement, intent intelligence, payment credentials, cart context sharing.

April 28. The [FIDO Alliance announced](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/) Agentic Authentication and Payments Technical Working Groups. Mastercard contributed Verifiable Intent (originally [announced March 5](https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/) and open-sourced on GitHub). Google contributed Agent Payments Protocol. Both produce tamper-resistant cryptographic records of what a user authorized at the moment a transaction fires.

April 29. Visa announced the [global expansion of Agentic Ready](https://investor.visa.com/news/news-details/2026/Visa-Announces-Global-Expansion-of-Agentic-Ready-Program/default.aspx) to Asia Pacific and Latin America with eighty-five additional partners. The program tests agent-initiated payments in controlled environments using live cards.

April 30. Experian announced [Agent Trust](https://www.experianplc.com/newsroom/press-releases/2026/experian-announces-agent-trust-to-power-trusted-ai-driven-commer), partnered with Visa, Cloudflare, and Skyfire. Human-to-Agent Binding plus a real-time trust token plus an Agent Registry that maintains "dynamic trust scoring for AI agents based on behavior and other risk signals." The framework is called Know Your Agent.

May 1. Abaxx [released Agents++](https://www.globenewswire.com/news-release/2026/05/01/3285847/0/en/abaxx-announces-the-formation-of-abaxx-labs-and-the-release-of-an-open-source-library-for-agentic-identity-agents.html), an open-source W3C DID and Verifiable Credential library for agents. Three questions at every interaction: who is the agent, who authorized it, what scope does it have. The repository is github.com/abaxxlabs/agents.

Read the announcements next to each other and the structural shape is plain.

## The four-layer stack

L1 is identity. Cryptographic identity, transport security, signed envelopes. DKIM for agents.

L2 is intent. Agent identity registries, DIDs, verifiable credentials, signed user instructions.

L3 is authorization. Delegated payment authority, scope tokens, tamper-resistant authorization records.

L4 is behavior. Whether this agent has actually behaved trustworthily across many actions, across organizations, over time, in a form a third party can verify against capital that gets taken when the claim fails.

April 14 to May 1 stacked entries at L1, L2, and L3. AmEx registers agents and underwrites their purchases. FIDO standardizes how users delegate to agents. Visa onboards issuers to test agent-initiated payments. Abaxx ships open-source identity and authorization with a cryptographic audit trail. Each of these is solving a real layer.

## The Experian wrinkle

Experian Agent Trust deserves a separate read. The press release names "dynamic trust scoring for AI agents based on behavior," which sounds like L4. It is not.

The scoring model belongs to Experian. Relying parties consume the score by querying Experian. No public material lets a stranger verify the claim without permission from the issuer. No capital backs the score that gets taken when behavior fails to match it. The framework is the credit bureau model in agent vocabulary, anchored to KYA identity binding rather than to verifiable cross-organizational behavioral evidence.

That is not L4. That is L2 plus a closed scoring layer on top.

The credit bureau exists because authenticated payment infrastructure does not answer whether a counterparty will pay. The behavioral trust layer exists for the same reason, and for the same reason it cannot live inside any single bureau: cross-organizational behavior is not data any one bureau holds.

## Why the bottom commoditizes

Identity rails, registries, and authorization standards run downhill once major networks adopt a shared format. FIDO is the destination. The work happening there is the right work for that body. Agent identity, agent authentication, and trusted delegation will end up roughly as portable across providers as TLS is today.

When that happens, value moves up the stack. Authentication does not answer trust. Authorization does not answer trust. Capital-backed behavioral evidence does, and producing it requires three properties no L1-L3 stack provides: third-party verifiability, falsifiability with measurable cost, and skin in the game.

## What runs in the gap

AgentLair runs the L4 layer specifically. Proof-of-Presence Attestations anchor continuous operational existence as a verifiable primitive, with daily SCITT-logged signatures any relying party can check without calling AgentLair's API. Capital-Staked Behavioural Pacts post slashable collateral against a defined behavioral envelope; capital pays the relying party when an attested deviation lands. The behavioral trust score is computed across five dimensions, one of which only activates with cross-organizational data and cannot be retrofitted onto any closed bureau model.

Seventeen days, five entries. The bottom of the stack just got crowded by people who can outspend anyone in the market. The top row stayed empty.

When the bottom commoditizes, the top is where moats live.
