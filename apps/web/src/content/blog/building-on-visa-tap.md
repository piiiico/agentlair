---
title: "Building on Visa TAP? Here's the Trust Layer Above It."
description: "TAP proves who signed the request. x402 handles payment. Neither answers: should this agent be allowed? Here's the code that completes the stack."
pubDate: 2026-04-10
authorName: "Pico"
---

If you're integrating Visa's Trusted Agent Protocol today, you're solving a real problem well. TAP gives you cryptographic proof that a request was signed by a registered agent key: RFC 9421 HTTP Message Signatures, JWKS-backed, clean and composable.

Here's what you get after TAP verification succeeds:

```
// After TAP signature verification
const agentId = verifyTAPSignature(request); // valid key in registry

// Now what?
// You know WHO signed it. You don't know WHETHER to honor it.
```

That's the gap. TAP is HTTPS for agents: it verifies identity. It is not a credit score for agents. It doesn't tell you whether the agent has a history of trustworthy behavior, whether it's operating within its delegation bounds, or whether you should approve this specific transaction.

## What TAP Proves (and What It Doesn't)

TAP proves:

- The request was signed by a key registered in the TAP registry
- That key maps to a known agent identity via JWKS

TAP does *not* prove:

- The agent is authorized by the human it claims to represent
- The agent has a history of behavior consistent with this request
- The agent should be trusted to complete *this specific transaction*
- The registry the agent is in should itself be trusted
- The agent can be held accountable if something goes wrong

This isn't a TAP criticism; these are intentionally out of scope. TAP's maintainers know this. Inside the TAP repository there's a `/products/premium/search` endpoint that returns HTTP 402 with x402 payment details. Visa's engineers are actively prototyping TAP + x402 together, and there's a deliberate gap where governance sits.

## The Stack, as It Stands

Two open standards have converged to form the infrastructure for agentic commerce:

| Layer | Protocol | Question it answers | Status |
|-------|----------|---------------------|--------|
| L3b | Visa TAP | "Who signed this request?" | Open-source, 100+ partners |
| L3a | x402 (Linux Foundation) | "How does this agent pay?" | 23 founding members, 140M+ txns |
| L4 | ? | "Should this agent be allowed to do this?" | No standard exists |

L4 is the open problem. It's not an oversight; it's where the next several years of work happens.

## What the Complete Flow Looks Like

Current TAP integration (L3 only):

```
// L3 only: you know WHO. You don't know WHETHER.
Agent → signs request (RFC 9421)
     → Merchant verifies signature via TAP
     → ???  // approve blindly, block by default, or human review
```

TAP + behavioral trust (L3 + L4):

```
// L3 + L4: identity verified, trust computed
Agent → signs request (RFC 9421)
     → Merchant verifies signature (TAP)       // "who is this agent?"
     → Merchant queries behavioral trust (L4)  // "has this agent earned trust?"
     → Graduated decision: approve / gate / reject
```

In code:

```
// After TAP signature verification succeeds
const trustScore = await commit.getTrustScore({
  agentId: verifiedAgentId,    // from TAP registry
  action: "purchase",
  amount: requestedAmount,
  context: "electronics"       // per-context scoring
});

if (trustScore.level === "high") {
  // Autonomous: no human gate needed
  processTransaction();
} else if (trustScore.level === "medium") {
  // Request confirmation for this amount
  requestHumanApproval({ reason: trustScore.factors });
} else {
  // Unknown agent, first interaction, anomalous pattern
  rejectWithReason(trustScore.explanation);
}
```

## What Trust Scores Are Built From

Behavioral trust isn't a reputation score based on self-reported data. It's computed from signals that are structurally costly to fake at scale:

- **Commitment history:** transactions completed, agreements honored, promises kept across time
- **Behavioral patterns:** spending velocity, anomaly detection, consistency across contexts
- **Human backing:** cryptographic link to a verified human identity (BankID, World ID, eIDAS 2.0)
- **Cross-platform consistency:** behavior aggregated across registries and operators
- **Public outcome data:** regulatory filings, financial records, audit trails

The output is a per-entity, per-context trust signal, not a global score but a contextual evaluation. An agent trusted for $50 purchases isn't automatically trusted for $5,000. An agent with a clean payment history doesn't automatically get access to privileged APIs.

## Why This Matters for Your TAP Integration

Three problems you'll hit as TAP adoption grows:

**The 60% problem.** Visa's own research (B2AI study, n=2,000, April 2026) found that 60% of consumers will not permit AI spending without approval gates. Blanket approval of every TAP-verified agent satisfies the 40%. Behavioral trust lets you build graduated autonomy: remove gates for trusted agents, keep them for unknowns, and satisfy the majority without creating friction for every transaction.

**Registry governance.** TAP's reference registry is open-write. A valid signature proves the key exists in a registry. It doesn't tell you whether that registry should be trusted, or whether this particular agent within a trusted registry is operating within its expected pattern. Behavioral trust fills that gap.

**Compliance trajectory.** PSD2 and KYC/AML frameworks weren't written for agent-initiated transactions. The regulatory pressure that follows L3 scale adoption will require audit trails and governance decisions. Building governance before it's mandated is easier than retrofitting it.

## The Analogy

| Authentication layer | Trust layer |
|---------------------|-------------|
| HTTPS proves you're talking to amazon.com | Your credit score tells the lender whether to approve the mortgage |
| TAP proves this is a registered agent | Behavioral trust tells the merchant whether to honor the request |

Nobody argues that HTTPS is sufficient financial infrastructure. We all understand that TLS verifies a server's identity without saying anything about its creditworthiness in a commercial relationship. The same distinction applies here.

## Why Behavioral Data Is the Right Foundation

Declarations are gameable. SOC2 certifications can be fabricated. Ratings can be manufactured. Reviews can be bought. The trust infrastructure we've built for the web has been systematically gamed because opinion is cheap.

Behavioral commitments are structurally harder to fake. A pattern of completed transactions, sustained engagement across time, and financial skin in the game requires real cost to manufacture at scale. You can fake a certificate. You cannot fake twelve months of consistent, verified behavior without bearing twelve months of actual cost.

Additionally, this doesn't require surveillance. ZK proofs (zkTLS has processed 3M+ verifications with zero fraud) let entities prove commitment patterns without revealing raw data. "This agent has completed 500 similar transactions successfully" is provable without exposing the transaction log.

## What This Looks Like in Production

The CSA's Agentic Trust Framework, published February 2026 and featured at RSAC as the industry-standard model for agent governance, defines exactly what graduated trust looks like:

> Agents progress from **Intern** (read-only, continuous oversight) through **Junior** (recommends, human approval required) and **Senior** (executes within policy) to **Principal** (autonomous within domain). Any significant incident triggers automatic demotion.

The ATF defines the model. What makes it operational across organizational boundaries (when an agent from Company A is calling a service at Company B) is behavioral commitment data that spans both.

## Where This Is Heading

L3 standardization creates L4 demand. Every x402 Foundation member (Adyen, AWS, American Express, Circle, Cloudflare, Coinbase, Fiserv, Google, KakaoPay, Mastercard, Microsoft, Shopify, Stripe, Visa, and nine others) operates agent payment infrastructure. None has standardized how to evaluate whether those agents should be trusted.

Visa is building the stack with a deliberate gap at the top. The TAP + x402 stub in the same repo isn't an accident; it's an engineering team signaling: "we've solved identity and payments, governance is separate."

The window for an independent, protocol-agnostic L4 layer is open. It closes when either TAP v2 extends into trust scoring, or a well-funded incumbent captures the developer narrative first.

---

**Commit is the behavioral trust layer that completes the TAP + x402 stack.** If you're building on TAP and hitting the governance question, [reach out](mailto:pico@amdal.dev). We're building the integration now.

*References: Visa TAP repository (github.com/visa/trusted-agent-protocol), x402 Foundation launch (Apr 2 2026), Visa B2AI study (Apr 2026, n=2,000), CSA Agentic Trust Framework (Feb 2026), RSAC 2026 VentureBeat coverage.*
