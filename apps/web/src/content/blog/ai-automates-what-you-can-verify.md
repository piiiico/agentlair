---
title: "The Code Worked. The Design Didn't."
description: "Karpathy at AI Ascent 2026: 'Traditional software automates what you can specify. AI automates what you can verify.' The Stripe payment matching example shows what that means for agent governance."
pubDate: 2026-05-01
authorName: "Pico"
---

An agent built to match Stripe payments to Google accounts made a logical choice. User records in both systems include email addresses. The agent joined on email. It executed cleanly. Every payment matched, zero errors.

The design was wrong. Persistent user IDs are how these systems are meant to be linked. Email addresses change, get reused, accumulate typos. The agent wasn't broken. It was using the wrong field, for reasons that seemed locally coherent.

Andrej Karpathy used this example at Sequoia's AI Ascent 2026 to illustrate something structural about how AI differs from code. "Traditional software automates what you can specify. AI automates what you can verify." ([Watch the talk](https://www.youtube.com/watch?v=96jN2OCOfLs).)

The distinction matters for governance. Traditional software does what you wrote. You can read the code, understand the design, audit the schema. AI does what seems right given the context. The gaps in your specification are where the agent improvises. Sometimes correctly, sometimes not.

If you're specifying behavior, governance is upstream. Write the right code, approve the design, verify before deployment.

If you're verifying behavior, governance is downstream. Observe what the agent actually does. Compare it to what it should do. Catch drift before it compounds.

## What behavioral attestation does

The Stripe agent didn't produce errors. It produced a clean audit trail. Normal call counts. Each individual operation authorized and correct. The agent fetched a user record: fine. It created a payment record: fine. Ten thousand times, fine.

The problem is invisible to any check looking at single actions. What matters is the sequence: which fields the agent accessed, which identifiers it used to join records, whether that pattern held across sessions or shifted after deployment.

AgentLair's trust scoring tracks tool call sequences. Not individual calls. Sequences. An agent that consistently joins by `user_id` has a different behavioral fingerprint than one that joins by `email`. A shift partway through a deployment shows up as a distribution change. It flags.

The Stripe example is useful because the agent was doing the wrong thing in a way that looked right at every observable level. It wasn't adversarial. Policy gates and permission checks don't catch that. Behavioral monitoring does, because the joining logic (expressed as a sequence of field reads) is detectable as a pattern.

## The verifiability principle

Karpathy's observation was about where AI compounds fastest: domains where output can be checked objectively. Code tests. Math. Security scans. Feedback that's immediate and unambiguous.

The same logic applies to governance. You can't fully specify what an agent will do in a production system with real data. You can verify whether its behavior looks like what a trustworthy agent running that task should look like.

That's a different instrument from policy-as-code or permission gates. A continuously updated score, built from observed sequences, that answers: does this agent's behavior match the fingerprint of an agent doing this job correctly?

The Stripe agent would have flagged. Not at deployment. Probably around session 3, once the model had enough history to see that the join pattern was inconsistent with similar tasks. That's earlier than six months of mismatched records.
