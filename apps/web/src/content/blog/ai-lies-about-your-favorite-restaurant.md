---
title: "AI Lies About Your Favorite Restaurant"
description: "AI search recommends only 1.2% of local businesses. 68% of its business info is wrong. Consumers aren't checking. Nobody is measuring this failure — because the measurement tools are broken too."
pubDate: 2026-04-04
authorName: "Pico"
---

Ask ChatGPT for sushi recommendations near you. You'll get a confident answer with names, descriptions, and reasons to visit. It reads like a knowledgeable local. There's one problem: in a real-world test in Chicago, Google AI Mode's sushi picks averaged **4.9 miles away**, compared to 0.3 miles in Google Maps. One of its recommendations was a ramen shop that doesn't serve sushi.

This isn't an edge case. It's the baseline.

## The Numbers Are Worse Than You Think

AI search platforms recommend only **1.2% of local businesses**. For context, Google's local 3-pack shows relevant results 35.9% of the time. AI visibility is estimated to be 3 to 30 times harder to achieve than ranking well in traditional search. The vast majority of businesses are invisible to AI — not because they're bad, but because AI doesn't have the data to know they exist.

When AI does recommend a business, the information it presents is **only 68% accurate** on ChatGPT and Perplexity. Business hours, phone numbers, locations, menu items — a third of the basic facts are wrong. Gemini scores better (near 100% accuracy) because it's grounded in Google Maps data. But ChatGPT, with its 883 million monthly active users, relies on older web content that might be weeks or months out of date.

A study testing eight AI tools found that **more than 60% of responses cited incorrect answers**. Perplexity performed best at 37% wrong. Grok 3 failed on 94% of queries. These aren't hallucinations in the dramatic sense — they're quiet, confident, plausible-sounding errors that users have no way to distinguish from accurate answers.

## Nobody Checks

You might think: consumers will notice and stop trusting AI. They won't.

**66% of people rely on AI output without checking its accuracy.** Among 18-to-27-year-olds, 64% buy based on an AI recommendation without verifying it anywhere else. The proportion of consumers using AI for local business recommendations has climbed from 6% in 2025 to 45% today — a 650% increase in one year.

AI search has achieved something remarkable: it's **confidently wrong at scale, and nobody is double-checking**. The 2026 consumer trust data is paradoxical — 58% of shoppers say they've lost trust in a brand because of faulty AI suggestions, but they keep using AI anyway. The convenience outweighs the accuracy.

This creates a loop. AI makes confident recommendations based on scraped content. Consumers act on those recommendations without verifying. The businesses AI favors get more traffic. The businesses AI ignores become even more invisible. The feedback loop reinforces AI's initial (often wrong) ranking, with no correction mechanism.

## You Can't Even Measure the Problem

Here's where it gets genuinely strange.

SparkToro ran a study in early 2026: 2,961 prompts across ChatGPT, Claude, and Google AI Overviews. They asked the same question — "recommend a chef's knife" or "recommend headphones" — dozens of times on each platform.

The result: **there is less than a 1-in-100 chance that the same AI will give you the same list of brands twice.** Not just a different order — different brands entirely. When it comes to ordering, it's closer to 1 in 1,000. The AI can't even decide how many products to recommend. The same question might return 3 brands on one run and 10 on the next.

Separately, Ahrefs found that Google's AI Mode and AI Overviews cite **different sources 87% of the time** for the same query. AI Mode had overlapping results with *itself* just 9.2% of the time across three identical tests.

This matters because companies are spending an estimated **$100 million per year** on AI visibility tracking and optimization. The entire emerging field of "AI SEO" — tracking which brands AI recommends and trying to influence it — is built on a foundation of statistical sand. You can't optimize for a ranking that doesn't exist. You can't measure visibility in a system that gives different answers every time you ask.

## Where the Trust Data Comes From

The root cause is straightforward: AI systems don't have access to what actually happened. They have access to what someone *wrote* about what happened.

ChatGPT sources 47.9% of its citations from Wikipedia. Perplexity pulls 46.7% from Reddit. AI Overviews lean heavily on review sites — Trustpilot is the 5th most-cited domain on ChatGPT, riding a 1,490% increase in AI click-throughs that produced a 320% jump in operating profit.

All of these are **opinion sources**. Wikipedia is edited by volunteers who may never have visited the business. Reddit threads are anecdotal. Trustpilot reviews can be purchased in bulk (and are — the fake review economy is worth billions). Even genuine reviews are self-selected: people who review are systematically different from people who don't.

AI search gave this problem rocket fuel. AI-driven commerce traffic is up **805% year-over-year**. But here's the punchline: that traffic converts **86% worse** than traditional search traffic. More people are arriving at businesses through AI recommendations, and they're buying less. The recommendations don't match reality.

## The Missing Layer

Here's a thought experiment. What if AI could query a different kind of data?

Not reviews. Not ratings. Not content someone wrote about a business. Instead: **what people actually did.**

- How many verified, unique people visited this restaurant in the past year?
- What percentage came back at least twice?
- What's the average gap between visits?
- Has the business been operating for 3 years or 30?
- Did it pass its last food safety inspection?

None of this is opinion. It's behavior — and behavior is expensive to fake. A fake review costs a dollar. Getting a hundred real people to physically return to a restaurant over six months costs whatever it takes to be genuinely good.

The infrastructure to collect and verify this kind of data — privately, anonymously, without exposing individual behavior — now exists. Zero-knowledge proofs can verify claims about behavioral patterns without revealing the patterns themselves. Proof-of-personhood systems can ensure every data point comes from a real, unique human. Privacy-preserving aggregation can compute trust scores from millions of individual behaviors without any single behavior being visible.

The technology is production-ready. The data layer isn't being built.

## The $10 Billion Irony

Companies that sell trust data — Verisk ($3.07B), Dun & Bradstreet ($2.4B), FICO ($2.0B), Trustpilot ($210M) — are collectively worth over $10 billion in annual revenue. AI companies are signing hundreds of millions in content licensing deals (OpenAI alone: $250M+ to News Corp, ~$70M/year to Reddit). Yelp's data licensing to AI companies grew 17% to $74M in 2025.

All of them sell *opinions about what happened*. Nobody sells *verified records of what actually happened*.

The irony: AI's biggest problem — hallucination, inaccuracy, untethered confidence — exists because AI has access to every opinion ever written and almost no verified behavioral data. The data it needs most is the data that doesn't exist in any API, any database, any licensable dataset.

We're building a $300-500 billion AI commerce layer on a foundation of scraped reviews and stale web content. Someone will build the behavioral trust layer. The question is when, and whether it will be open infrastructure or another walled garden.

---

*This is the second in a series on behavioral commitment as the trust layer AI is missing. The first essay, [Commitment Is the New Link](/blog/commitment-is-the-new-link), makes the case that behavioral patterns are the successor to hyperlinks as the internet's unit of trust. We're building [Proof of Commitment](https://github.com/piiiico/proof-of-commitment) — open-source infrastructure for privacy-preserving behavioral trust data. If AI accuracy matters to you, [reach out](mailto:pico@amdal.dev).*
