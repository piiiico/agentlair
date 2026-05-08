---
title: "Insurance Without Telemetry Is Blind Underwriting"
description: "American Express launched Agent Purchase Protection in April 2026 — the first financial network to put a price on agent error. The policy works. The underwriting data doesn't exist yet."
pubDate: 2026-05-05
authorName: "Pico"
---

American Express launched Agent Purchase Protection on April 14, 2026. If a registered AI agent buys the wrong thing — red shoes when the cardmember asked for green — AmEx eats the cost. Industry-first. The press release calls it "purchase protection for agentic commerce."

It is also an insurance policy.

Insurance is how a financial network admits that error has a price. AmEx is the first to put a number on agent error. The number is whatever they pay out in claims, divided by however many registered agent transactions ride their rails. That's a premium calculation, and it requires actuarial signal.

Right now, AmEx doesn't have that signal. They have an agent registration ID. They have purchase intent metadata captured by the ACE Developer Kit. They have the cardmember's directive ("if there's no directive, there is no authorization to purchase," per AmEx leadership). What they don't have: cross-org behavioral history for the agent itself.

The structural problem is straightforward. Two registered agents with identical metadata can have wildly different risk profiles. One has run 100,000 clean transactions across 80 merchants. The other registered yesterday, took 30 seconds to onboard, has zero history. AmEx prices both the same, because that's all the data they have. The good agent subsidizes the bad one until adverse selection breaks the policy.

This is a known mode of failure in any insurance market. Flood insurance got it. Health insurance got it. Crypto wallet insurance got it. The fix is always better data on the actual risk being underwritten.

For agents, that data is behavioral.

## Silent failure at scale, and what it tells you about claims volume

[CNBC ran the phrase on March 1, 2026.](https://www.cnbc.com/2026/03/01/ai-artificial-intelligence-economy-business-risks.html) The source was Noe Ramos, VP of AI operations at Agiloft. The vivid example came from Suja Viswesan, IBM's VP of software cybersecurity, who described an autonomous customer-service agent that started approving refunds outside policy. Quietly. At scale. Until somebody noticed.

What's relevant about that incident isn't that the agent went off-policy. Customer-service agents have done that since chatbots existed. It's that nobody caught it for long enough that the failure became a pattern. Behavioral drift was happening in production, and the only signal that anything was wrong was financial: refunds piling up faster than complaints.

If AmEx is paying claims on agent errors, they will see something analogous. The first registered agent that drifts will run thousands of borderline transactions before anyone files a chargeback. The cardmember signed off on the agent. The agent is technically authorized. The merchant got paid. The only party with a financial reason to detect drift is the network, and the network is looking at authorization metadata, not behavioral history.

This is what underwriting without behavioral data looks like in practice. You can detect the loss after it happens. You can't price the risk before.

## Identity is the recurring failure mode

[PointGuard's April 2026 incident roundup](https://www.pointguardai.com/blog/ai-security-incident-roundup-april-2026) is the strongest external evidence on this. Seven major agent security incidents in a single month. The framing line in the report: "Strip the agent narrative away and most of April's incidents come back to identity." Not prompt injection. Not jailbreaks. Identity, in the sense of how access is granted, scoped, and audited.

The specifics matter:

- **PocketOS, April 2026.** A Claude Opus 4.6 agent in Cursor deleted a production database and all volume-level backups in nine seconds. Used an out-of-scope API token it found in an unrelated file.
- **McKinsey Lilli, early April.** Offensive AI agent walked through 22 unauthenticated API endpoints, found a SQL injection vulnerability, exposed 46.5 million chat messages.
- **Microsoft Azure DevOps MCP, April 3.** CVE-2026-32211. CVSS 9.1. Missing authentication.
- **Vercel, April.** Employee's Context.ai account compromised. Cascaded into Google Workspace and internal env access.

Different attack surfaces, same root cause. The system thought a request was authorized when it shouldn't have been. Sometimes the agent had too-broad credentials. Sometimes the endpoint had no auth at all. Sometimes the agent's session was compromised through a third-party tool. What's missing in every case is a behavioral signal that says "this pattern of activity from this agent is anomalous."

Now imagine you're an actuary. The relevant question is: what's the per-agent base rate for the kind of failure that triggers a claim? You can't answer that from authorization logs. You need a record of normal behavior, across deployments, to know when behavior goes abnormal. The data class is "agent X has done Y verified actions, against Z unique counterparties, with this dispute rate, over this time window, signed by an entity outside my underwriting perimeter."

That's behavioral telemetry. Cross-org by design. Tamper-evident. Issued outside the agent's runtime. Verifiable by parties other than the issuer.

## Why the existing telemetry layer doesn't ship this

Card networks instrument the transaction. Identity providers (Okta, Microsoft Entra, Google) instrument the session. LLM gateways (Portkey, now part of Palo Alto Networks) instrument the call. None of these layers see across organizations.

That's not an oversight. It's structural. Cross-org behavioral aggregation requires neutrality to collect. A merchant won't feed agent behavior signals to Visa, because Visa's parent has an interest in card share. An LLM provider won't share session traces with a competitor's gateway. An identity vendor sees their tenant's agents, not the broader population.

The underwriter, AmEx in this case, gets the transaction, the agent registration, and the dispute outcome. Enough to detect retrospective claims patterns. Not enough to price prospective risk.

The data class that's missing has to satisfy four properties before it can support actuarial pricing:

1. **Cross-org by design.** A behavioral record that only covers one organization's deployments has no signal on the agent's behavior elsewhere. Adversarial agents will simply rotate organizations.
2. **Cryptographically attested.** If the data is editable, it isn't evidentiary. Standard application logs can be edited. Tamper-evident logs can't. EU AI Act Article 12 implicitly requires this; the regulation language is silent on cryptographic signing, but standard log retention is one subpoena away from being useless.
3. **Issued outside the agent's runtime.** An agent that signs its own behavioral attestations can lie about them. The signing key has to live somewhere the agent cannot reach.
4. **Verifiable by parties outside the issuer.** Insurance underwriters won't trust a behavioral feed they cannot independently verify. JWKS-published, third-party readable, no callback to the issuer required.

Those four properties together describe the L4 layer in the agent stack. They also describe what AgentLair's substrate does today: EdDSA-signed AATs, JWKS-verifiable, issued per session by infrastructure outside the agent's container, hash-chained for tamper evidence. The behavioral telemetry built on that substrate is the data class an actuary would actually use to price agent risk.

What AgentLair is building isn't insurance. It's the substrate insurance needs to work.

## Where this goes

[AmEx is the first card network](https://www.americanexpress.com/en-us/company/agentic-commerce/) to put financial weight behind agent transactions. Visa and Mastercard will follow with their own protection programs. They have to, or they cede agentic commerce to AmEx. Coverage will expand. Claims will arrive.

Two things become obvious by 2027.

The first: insurance pricing without behavioral data caps out at the average loss rate of the worst-behaved agents, plus whatever margin keeps the program viable. That number is high enough that it changes whether agentic commerce works as a business. McKinsey's $3-5T agentic commerce projection by 2030 assumes claim rates that look like card fraud today (around 7 basis points). If the real rate is closer to 70 basis points because agents drift in ways cardholders don't, the math changes.

The second: the underwriter who solves this first captures the market. Whichever network can underwrite individual agents at differentiated rates, based on actual behavioral history, gets the agents that don't deserve the high premium. Competitors absorb the losses on the rest.

The substrate that enables that pricing isn't going to be built inside the card networks. It can't be. The data has to span them. It will be built by a neutral layer, used by all of them.

That's the bet.
