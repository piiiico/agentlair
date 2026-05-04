---
title: "Most of agent auth is now self-hostable. Here's the part that isn't."
description: "OneCLI, mcp-use, DeepClaude. Three open-source pieces, one enterprise gap-naming post from Diagrid. Compose them and you still owe a verifier on the other side proof you can't generate from inside your own org."
pubDate: 2026-05-04
authorName: "Pico"
cta: try
related:
  - agent-identity-is-not-enough
  - eddsa-jwts-agent-credential-problem
  - five-layer-agent-trust-model
---

If you're building an agent today, you can stitch together a credible self-hosted stack from open-source pieces. The question that used to be "how do you do this at all" is becoming "how much of this do you want to host yourself."

Walk through what's already shipped.

## OneCLI: the credential layer

OneCLI is a Rust gateway that sits between an agent and the APIs it calls. You store credentials once. Agents get placeholder keys like `FAKE_KEY`. When the agent makes a request through the gateway, OneCLI matches the host and path, swaps the placeholder for the real value, and injects it as a header or query param. The agent never touches the secret. Storage is AES-256-GCM, decrypted only at request time.

The Show HN landed at 161 points ([thread](https://news.ycombinator.com/item?id=47353558), [repo](https://github.com/onecli/onecli)). Bitwarden has since shipped an integration. NanoClaw adopted it. The trajectory is real.

Solve the secret-handling problem and stop. Most teams will get value out of this within a day.

## mcp-use: the protocol layer

mcp-use connects any LLM to any MCP server. 155 points on Show HN ([thread](https://news.ycombinator.com/item?id=44747229), [repo](https://github.com/mcp-use/mcp-use)). Think of it as the LangChain shape for the MCP world. The Python library hands an agent a uniform interface to whatever tools you point it at, and you stop writing wiring.

Tool discovery and protocol mismatch were the friction here. They're not the friction anymore.

## DeepClaude: the model layer

DeepClaude takes Claude Code's autonomous agent loop and swaps the brain. Same tool calls, same shell-spawning, same multi-step coding behavior, except the API points at DeepSeek V4 Pro at $0.87 per million output tokens instead of Anthropic at $15. The repo claims 17x cheaper. The HN post passed 500 points yesterday ([thread](https://news.ycombinator.com/item?id=48002136), [repo](https://github.com/aattaran/deepclaude)). MIT.

Cost stops being a structural reason to avoid running an autonomous loop. That changes the math on how many agents your team can afford to spawn.

## Diagrid: naming the gap

Then on the enterprise side, Diagrid published [Why MCP Gateways Aren't Enough](https://www.diagrid.io/blog/why-mcp-gateways-are-not-enough). The argument: a gateway that proxies MCP traffic without identity, authorization, and proof is a router with extra steps. Workload identity for agents (SPIFFE-style mTLS, in their framing) is the missing primitive. The post is enterprise-shaped (it pitches Catalyst, their hosted workflow runtime for agents), but the framing is the part that travels. They're naming what the OSS pieces leave open.

Four signals, three OSS, one enterprise framing. The composite picture is healthier than the agent stack looked twelve months ago.

## What composing them still asks you to build

Stack the three OSS pieces and run the result. Here's what you don't get.

OneCLI knows that an agent presented a placeholder key. It does not know whether *that agent* should be allowed to use it. The audit log lives inside your org's trust boundary. An external service receiving a call routed through OneCLI sees the request originate from your IP, not from a verifiable agent identity it can pin a policy to.

mcp-use connects an LLM to a tool. Two agents using the same library hitting the same MCP server are indistinguishable to that server unless you build the identity layer yourself. The protocol carries no agent identity by default.

DeepClaude swaps the model and inherits whatever identity the calling shell already has. Cheaper inference, same anonymity to anyone outside your perimeter.

Diagrid's post names the gap and solves it inside an enterprise mesh. Outside that mesh, between organizations that don't share a SPIFFE root, the question is open.

Compose all three OSS pieces and you have an agent that runs cheaply, holds credentials safely, and reaches tools generically. What you owe a verifier on the other side of any wire is still:

1. An issued, externally verifiable identity per agent that doesn't depend on shared infrastructure.
2. An audit trail any third party can replay without trusting your reporting.
3. Some signal beyond "the request is signed" about whether *this* agent has been doing reasonable things lately.

Each of those is composable in principle. In practice, you build them yourself, or somebody publishes them on your behalf.

## What hosted absorbs

That third bucket is where AgentLair sits.

The AAT (Agent Authentication Token) is a short-lived EdDSA JWT, issued via `POST /v1/auth/keys`. The signing key's public half lives at `agentlair.dev/.well-known/jwks.json`. Any verifier on the open internet can validate the signature without calling our API. Verification is a local operation, offline-capable, and survives us going down for a maintenance window.

The audit trail behind the token is hash-chained. Every event references the previous event's hash, so a verifier looking at any event can detect a gap or a rewrite without trusting our database. Five behavioral signals from those events (consistency, restraint, transparency, resilience, cross-org coherence) collapse into a 0–100 trust score, weighted, signed inline in the JWT under `al_trust`. A third party who doesn't trust the score can pull the receipts and recompute. The shape is documented in [Agent identity is not enough](/blog/agent-identity-is-not-enough).

The cross-org coherence dimension is the one nothing else here gets you. It only activates when a second organization has seen the same agent. Behavioral history that ages across orgs that don't talk to each other is something OneCLI plus mcp-use plus a SPIFFE root cannot produce, because the inputs live on the wrong side of the trust boundary. That signal needs a publisher who isn't any one of the orgs.

The Free tier is 3 agents and 1,000 verifications per month. No card, no setup ritual, no IAM policy to draft.

## The pragmatic shape

Use OneCLI for credentials. Use mcp-use for tools. Use DeepClaude when the model bill matters. Stack them and you've absorbed the part of the integration that was previously hand-rolled per-team.

Then point the resulting agent at AgentLair, so the verifier on the other side has a JWKS to fetch, a signed score to check, and an audit chain to replay. Hosted is the answer to the part of the integration that doesn't compress to a library.

The choice isn't OSS versus hosted. It's which layers reward each.

[Get an AAT in 90 seconds.](/quickstart)
