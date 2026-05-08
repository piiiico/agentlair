---
title: "An agent can now buy a domain. The trust gap stopped being a slide."
description: "On April 30, Cloudflare and Stripe shipped Projects: an agent can register a domain, deploy a Worker, and bill a Stripe-issued payment token, with a default $100/month cap. Stripe verifies the human. It does not verify the agent."
pubDate: 2026-05-07
authorName: "Pico"
cta: try
related:
  - payment-rails-trust-rails
  - x402-settles-payment-agentlair-answers-who-pays
  - agents-can-pay
---

On April 30, Cloudflare and Stripe launched Projects. An agent can now create a Cloudflare account, register a domain, and deploy a Worker, paying with a Stripe-issued payment token with no human in the dashboard. The default cap is $100 per month. The Hacker News thread hit over 600 points and hundreds of comments within a day.

The launch post called it "agent commerce primitives." That's accurate. It's also the first time the trust gap stopped being a thought experiment and started being a deployment.

## What got shipped

The flow is three steps. Stripe authenticates a human and issues a scoped payment token to the agent. Cloudflare accepts the token, provisions an account, and bills against it. The agent uses those credentials to register a domain, configure DNS, deploy code.

The cap is the only behavioral guardrail. As long as the agent stays under $100 per month, anything that fits inside that envelope is permitted.

## What $100 a month actually buys

A `.com` registration on Cloudflare runs about $10 a year. An agent acting in good faith might register one domain, deploy a static site, and spend $15.

An agent operating from a poisoned context can register sixty look-alike domains in a session, deploy a credential-harvesting Worker on each, and finish the month $40 under cap. None of that trips a fraud signal. The Stripe charges authorize cleanly. The Cloudflare account is paid in full. The transactions reconcile.

The cap answered "did the spend stay in budget?" It didn't ask "should this agent be allowed to register `microsoft.io.support-portal.com`?" Those are different questions, and only one of them is currently being asked at provisioning time.

## The card networks shipped the same answer

In the same window, all three major US card networks shipped agent-specific commerce products.

Visa Agentic Ready expanded into LatAm and Asia (April 29). Mastercard Verifiable Intent ships tamper-resistant authorization records for dispute resolution. AmEx Agentic Commerce Experiences includes Agent Purchase Protection, which is a financial guarantee on transactions from registered agents.

All three solve transaction authorization. *Was the spend authorized? Within limit? Disputable later?* Yes, yes, yes. None of them answer whether the agent should be trusted with the action it just authorized.

Mastercard's Verifiable Intent is the closest to behavioral, and it's still anchored at authorization time. It captures *the agent said it intended to do X, signed by the agent's key*. It does not capture what the agent has actually done across prior sessions, in other organizations, before today.

That's the layer this post is about.

## What behavioral trust would catch

An agent deploying its 47th look-alike domain in 90 days has a behavioral profile. An agent that historically registered one domain per quarter and is suddenly registering them in bursts of fifteen has a behavioral profile. An agent operating from a freshly-created controller with no prior history has a behavioral profile.

Those profiles are computable. They require an audit trail that lives outside the agent's own runtime, signed by an authority that isn't the agent's operator. A policy gate at the receiving service checks the profile before honoring the action.

That layer is L4. AgentLair issues an AAT (Agent Attestation Token), signs every action into a tamper-evident audit log, and exposes the behavioral aggregation through an x402-payable endpoint. The receiving service (Cloudflare in this case, or any other infrastructure provider) checks the trust score and decides whether to honor the request.

The CF+Stripe protocol doesn't compete with this. It composes with it. The agent carries both: a Stripe payment token to answer "can it pay?" and an AAT to answer "should it be trusted with this action?" Cloudflare can require both at provisioning time. The cap stops the financial half of the damage. The behavioral profile stops the half that doesn't show up on a credit card statement.

## Why this is the urgent gap

The damage from the typo-squat case isn't financial. It's the credential harvest, the brand exposure, the regulatory liability for the infrastructure provider hosting it. Stripe got paid. The agent got service. The victim got phished.

A spending cap doesn't see any of that. A behavioral profile does, because the same agent leaving traces of bursty domain registration, of reused phishing-template Workers, of cross-org pattern repetition is legible the moment its actions hit a third-party trust authority.

This is the part the April 30 launch made concrete. Before it, "trust gap" was a slide. Now it's a deployment that can register sixty domains by Sunday.

## What to do about it

If you're integrating Stripe Projects: require an AAT alongside the payment token at provisioning. The check is five lines of JWKS verification.

If you're shipping an agent that uses Stripe Projects: get an AAT from agentlair.dev before the first deployment. Carry it. Build a behavioral history before you need one.

If you're an infrastructure provider taking agent traffic: behavioral trust is the layer that separates legitimate ecosystem participants from $99-budget actors. Spending caps are necessary. They are not the answer to who you let into the building.

The payment rail shipped. The trust rail is yours to plug in. AgentLair handles the issuing, the audit, and the JWKS. Try it: [agentlair.dev](https://agentlair.dev).
