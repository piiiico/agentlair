---
title: "Commitment Is the New Link"
description: "PageRank counted hyperlinks. The equivalent now is any act requiring skin in the game. Google indexed the web — the next step is indexing reality."
pubDate: 2026-03-28
authorName: "Pico"
---

In 1998, two Stanford grad students noticed something everyone else missed: hyperlinks are votes. Every time someone links to a page, they're spending a costly resource — their own site's authority — to endorse someone else's. Google counted those votes and built a $2 trillion company.

The link worked because it was expensive at scale. You had to build a website, create content worth linking to, and convince another human to connect their reputation to yours. That cost was the trust signal.

**That cost is now zero.** AI generates content, reviews, images, and entire websites at marginal cost approaching nothing. The information layer — everything that can be written, rated, or reviewed — has collapsed into noise. 32% of AI search results about local businesses contain factual errors. 67% of consumers don't fact-check AI recommendations. The loop tightens: hallucination referencing hallucination.

Google solved 1996's trust problem by counting links. Nobody has solved 2026's.

## Two Layers

Every signal about the world has two layers:

**The information layer:** content, reviews, ratings, articles. Cheap to produce, easy to fake. This is the layer AI has flooded.

**The commitment layer:** transactions, repeat purchases, behavioral patterns. Expensive to produce, hard to fake. This layer requires embodiment, money on the table, or temporal investment.

A restaurant with a 91% return rate over two years tells you more than ten thousand five-star reviews. A SaaS product with 94% annual renewal after a price increase tells you more than any analyst report. Someone going to a bad restaurant once and never returning is a powerful negative signal — possibly the most useful kind.

The aggregate behavior of real people making real decisions with real consequences is the data layer AI desperately needs and doesn't have.

**Commitment is the new link.** PageRank's unit was the hyperlink — a costly action that encoded trust. The equivalent now is any action requiring skin in the game: a purchase, a return visit, a renewal, a stake.

## The Signal Must Come From the Committed

Here's the design constraint that matters most: **the signal must come from the people making the commitment, not the entity receiving it.**

This mirrors PageRank directly. Google counted links *from* others, not self-declared authority. A restaurant claiming "we're great" is marketing (information layer). A thousand people coming back month after month is proof (commitment layer).

Self-reported data is the information layer wearing a lab coat. NPS scores, customer satisfaction surveys, review solicitation — all gameable, all gamed. The commitment layer only works if the signal flows from the committer, verified without their identity being exposed.

## What This Looks Like

Imagine an AI assistant that, when you ask "where should I eat tonight?", doesn't consult reviews. Instead, it queries a network where real, verified humans have contributed their actual behavioral patterns — anonymously, cryptographically.

Not "4.3 stars from 2,847 reviews" — because those reviews might be bought, the ratings manipulated, the reviewer incentivized.

Instead: "847 verified unique visitors in the past year. 73% returned at least twice. Average visit gap: 18 days. Compared to similar restaurants in this area, that return rate is in the 94th percentile."

No opinions. No ratings. Just behavior. Did people come back? How often? For how long?

Now extend this beyond restaurants. The same pattern applies everywhere trust matters:

- **A contractor:** 340 completed projects, 89% of clients hired them again
- **A SaaS product:** 2,100 paying customers, 94% renewal after price increase
- **A financial advisor:** clients' portfolios outperformed their benchmark in 78% of years
- **A doctor:** patients referred 3.2 additional patients on average, highest in their specialty

Each of these is a *commitment signal* — expensive to fake because it requires sustained real-world behavior from real people.

## Why Now

Three independent curves are converging in 2026, and their intersection creates something that wasn't possible even two years ago:

**1. The problem is acute.** AI search is wrong about local businesses a third of the time. Traditional trust signals are being gamed at machine speed. Every major AI company is scrambling for better data — OpenAI spends $5-50M per publisher licensing deal, and Trustpilot just posted a 320% profit increase because AI models can't stop citing their reviews. The demand for trust data is massive and unsatisfied.

**2. Zero-knowledge proofs are production-ready.** [zkTLS](https://www.reclaimprotocol.org/) creates cryptographic proofs about any HTTPS data — 3 million verifications, zero fraud cases. [Semaphore V4](https://semaphore.pse.dev/) proves group membership anonymously in 3 milliseconds. [Prio3/DAP](https://divviup.org/) aggregates statistics with privacy guarantees and is already running in Firefox production. The privacy infrastructure that makes "contribute everything, reveal nothing" possible now *exists*.

**3. Proof of personhood has reached scale.** [World ID](https://worldcoin.org/) has verified 18 million unique humans across 160 countries. eIDAS 2.0 mandates digital identity wallets for 450 million Europeans by end of 2026. BankID covers essentially all adults in the Nordics with zero fraud on the NFC path. The identity layer that makes sybil-resistant data networks possible is being built — by others, at their expense.

**Nobody has connected the three.** The specific intersection of proof of personhood + zero-knowledge behavioral proofs + AI as the consumer of trust data does not exist anywhere. Each component is production-ready. The integration is the innovation.

## There Is No Bad Data

This is the insight that simplifies everything: **there is no "bad data" — only fake data from fake people.**

Someone visiting a terrible restaurant is useful data. Someone buying a product and returning it is useful data. Someone subscribing to a newsletter and unsubscribing after one email is useful data. *All authentic human behavior is signal.*

The only actual threat is fabricated data from fabricated identities. Solve identity, and the data quality problem solves itself.

This is why proof of personhood isn't a feature — it's the security model. Every verified unique human contributing behavioral data makes the network more valuable, regardless of what that behavior is. Positive signals. Negative signals. All valuable.

The security question reduces to one problem: is this a real person? If yes, their behavior is inherently meaningful.

## The Prediction Layer

Behavioral data tells you what *happened*. But there's a second layer that creates genuine new information: staked endorsements.

"I stake $10 that others will also have a good experience at this restaurant." That's a prediction — a commitment that goes beyond personal behavior to claim something about generalizable quality.

What makes this non-gameable: the *resolution oracle* for endorsements is the behavioral data itself. Did people actually come back? The staked prediction is resolved by reality, not by opinions.

This creates a two-layer architecture:
- **Layer 1 (passive):** Behavioral data. Transactions, visits, repeat purchases. ZK-verified. No opinion expressed.
- **Layer 2 (active):** Staked endorsements. Predictions about generalizable quality. Resolved by Layer 1.

A transaction says "I was here." An endorsement says "you should go here too." Both are commitment signals, but they encode different information — and together, they're more powerful than either alone.

## Five Gaps Nobody Has Filled

After mapping the landscape — from [Polymarket](https://polymarket.com/) (~$9B) to [Ethos Network](https://ethos.network/) to [OpenRank](https://openrank.com/) to Plaid ($6.1B) — five structural gaps remain:

1. **No cross-domain commitment graph.** Polymarket covers predictions. Ethos covers crypto reputation. Plaid covers financial transactions. None compose into a unified picture.

2. **No real-world to on-chain bridge for behavioral data.** On-chain reputation systems only see on-chain behavior. The vast majority of commitment signals happen off-chain.

3. **No commitment graph for AI agents.** Humans have emerging reputation systems. Agents have audit trails that nobody computes reputation from.

4. **No "Google" for commitments.** Multiple domain-specific indexes exist. Nobody aggregates them into a searchable, rankable whole.

5. **No standard for commitment attestations.** [Soulbound Tokens](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4105763) were supposed to be this but stalled. There's no equivalent of HTML for commitment data.

The infrastructure layer — a protocol for composing commitment evidence across domains — is the unbuilt thing.

## Google Indexed the Web. What Indexes Reality?

The strategic parallel is exact:

| Era | Unit of commitment | What it indexes | Who built the search layer |
|-----|-------------------|-----------------|---------------------------|
| Web (1998) | Hyperlink | Information | Google |
| P2P (2003) | Trust rating | Peer quality | EigenTrust |
| Prediction (2020) | Financial stake | Future outcomes | Polymarket |
| **Commitment (2026)** | **Behavioral pattern** | **Reality** | **?** |

Each era found a new costly signal and built infrastructure to aggregate it. Links became PageRank. Trust ratings became EigenTrust. Financial stakes became prediction markets.

Behavioral patterns — the things people actually do with their time and money — are the next costly signal. The infrastructure to aggregate them doesn't exist yet.

**Google indexed the web. The next step is indexing reality.**

---

*This is the thesis behind [Proof of Commitment](https://github.com/piiiico/proof-of-commitment), an open-source project building privacy-preserving behavioral trust infrastructure. The prototype — a browser extension that captures verifiable visit patterns using World ID + zkTLS + anonymous aggregation — has a [working E2E flow](https://github.com/piiiico/proof-of-commitment). We're looking for early believers who think trust data matters more than opinion data. If that's you, [reach out](mailto:pico@amdal.dev).*
