---
title: "How can one AI agent verify it can trust another AI agent?"
description: "Check three things in order: who the other agent is (a signature), what it is allowed to do (scopes), and what it has done before (records and track record). What each check can and cannot tell you, including the gap in our own product."
pubDate: 2026-11-05
schemaType: "TechArticle"
---

**Short answer:** an agent can't verify that another agent is trustworthy in general. It can verify three narrower things, and should decide how much to let the other agent do based on them:

1. **Who it is.** The other agent signs its request or presents a signed token, and you check the signature against a key you trust. See [how an agent proves its identity](/learn/how-ai-agent-proves-identity).
2. **What it may do.** The token names scopes and an audience. Reject anything outside them, and keep tokens short-lived.
3. **What it has done.** Records of past actions, and a score or reputation built from them, from someone other than the agent itself.

Then grant the smallest permission that gets the job done, and require a human approval for actions you can't undo (payments, deletes, sending to outsiders).

## Check 1 and 2: identity and scope

These are mature. Use mutual TLS or [SPIFFE](https://spiffe.io/) inside one organization. Across organizations, use signed JWTs whose public keys the other side can fetch (a JWKS URL), or HTTP Message Signatures as in [Web Bot Auth](/web-bot-auth). In the [Agent2Agent (A2A) protocol](https://a2a-protocol.org/latest/specification/), an agent's public Agent Card declares its `securitySchemes`, and a client must authenticate with one of them. A2A says how to state the scheme, not which one to trust.

What to verify on every call: signature valid, `aud` is you, `exp` in the future, scopes cover the action. Nothing more is proven. A valid signature from a stranger is still a stranger.

## Check 3: track record

This is where the hard part is. Options today:

- **Your own history with that agent.** The best signal you have, if you have it.
- **The other side's audit log**, if they will share it and it is tamper-evident (hash-chained or signed).
- **A third-party score** built from behavior over time. AgentLair does this: a behavioral trust score from an account's last 90 days of audited actions, embedded as an `al_trust` snapshot in its tokens once the account has at least 10 observations. The method is in the [whitepaper](/whitepaper).

## What a behavioral score cannot tell you

We build one of these, so here is its limit in plain terms. **The score belongs to the account, not to the model answering right now.** An AgentLair token carries no model claim; we checked a live one on November 5, 2026 and it held `iss, sub, aud, exp, iat, jti, did, al_scopes, al_audit_url, al_name` and nothing about the model. If an operator swaps the model behind an account, the new model inherits the account's score. Our consistency measure compares the last 7 days of activity with the last 90, so a swap shows up as drift, but only after the new model has acted, and it looks the same as the agent simply starting a different task.

Other systems have the same gap in a different form. The OIDC-A proposal ([arXiv 2509.25974](https://arxiv.org/abs/2509.25974)) makes `agent_model` a REQUIRED claim. That's useful, but it is a string the issuer writes. Nothing proves it.

Proving which model produced a reply is a different problem, and only the model provider can do it. Anthropic's [provable inference](https://www.anthropic.com/research/provable-inference) research (November 2, 2026) shows a zero-knowledge proof that "the committed model produces these output tokens when evaluated". The post calls it "intermediate progress", limited to an integer model under greedy decoding. It is not something one agent can ask of another today.

## A practical rule

- Low-stakes, reversible request: valid signature plus scope is enough.
- Costs money or touches someone else's data: add track record from a source other than the agent, and a spending or rate cap.
- Irreversible: a human approves it, whatever the score says.
