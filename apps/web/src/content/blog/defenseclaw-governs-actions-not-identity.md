---
title: "DefenseClaw Governs What Agents Do. But Who Are They?"
description: "Cisco's DefenseClaw is a serious behavioral security layer for agentic AI — scanning skills before they run, blocking dangerous tool calls at runtime, shipping ZK-style audit logs. It also says, explicitly, that it doesn't verify agent identity. That gap is the architecture."
pubDate: 2026-04-19
authorName: "Pico"
---

Cisco shipped something real.

DefenseClaw — 483 GitHub stars, Apache 2.0, launched at RSA 2026 — is not a product announcement wrapped in a press release. It's production-grade behavioral security for OpenClaw agents. Static analysis before install. Runtime inspection of every tool call. Six rule categories (secret exfiltration, command execution, sensitive-path access, C2 communication, cognitive-file manipulation, trust exploitation). A Go sidecar that intercepts LLM traffic through a guardrail proxy. SIEM integration. Full audit logging.

This is competent work by a well-resourced team. Read it as such.

It also has a structural boundary that one of their own documents defines clearly. From the DefenseClaw analysis published at RSA:

> **What it doesn't do**: Verify agent identity or establish cryptographic trust chains.

The boundary isn't a gap they missed. It's a deliberate scope choice: behavioral governance is a different layer from identity verification. They built the behavioral layer. They left the identity layer for someone else.

This post is about that other layer.

## What DefenseClaw Actually Measures

DefenseClaw's core function is supply-chain admission control plus runtime behavioral inspection.

Before an agent can run a skill, MCP server, or plugin, DefenseClaw scans it. The `skill-scanner`, `mcp-scanner`, and `aibom` tools produce a `ScanResult` with severity-ranked findings. HIGH and CRITICAL findings auto-block. MEDIUM and LOW install with warnings. Nothing runs until it's passed.

At runtime, the TypeScript plugin intercepts tool calls via `before_tool_call` and sends them to the Go sidecar's `/inspect/tool` endpoint. The sidecar evaluates the call against six behavioral rule categories — things like: is this tool call trying to exfiltrate a credential? Is it calling an unexpected outbound URL? Is it trying to read a cognitive manipulation file?

The inspection surface is rich. The audit log is complete. The enforcement is real.

What DefenseClaw inspects is the *behavior* of a running agent. It answers: **did this agent try to do something dangerous?**

It does not answer: **who is this agent?**

## The Identity Gap Is Structural

Here's the scenario DefenseClaw cannot address on its own.

Company A deploys an agent — let's call it `PaymentProcessor-v2`. It passes all scans. It runs cleanly against DefenseClaw's behavioral rules. Company A's deployment trusts it. Company A invites Company B into a multi-org workflow. `PaymentProcessor-v2` presents itself to Company B's DefenseClaw deployment.

What does Company B know about this agent?

Nothing that can't be faked. The agent can claim any name, any version, any capability. DefenseClaw will scan whatever code it presents at admission. It will monitor whatever behavior it exhibits in this session. But there's no cryptographic answer to: **is this actually Company A's PaymentProcessor-v2, or something else presenting itself as that agent?**

DefenseClaw's admission scanning checks code quality and dangerous patterns. It doesn't verify provenance — that the code being scanned is what it claims to be, issued by whom it claims was the issuer, with the behavioral history it implies.

This isn't a criticism of DefenseClaw. It's a description of what behavioral governance is. You can perfectly govern behavior while knowing nothing about identity. Airports screen luggage for weapons without verifying whose luggage it is. The screening is real and valuable. It doesn't replace customs.

## What the MAESTRO Stack Is Missing at L7

The MAESTRO framework — the CSA's 7-layer threat model for agentic AI — describes seven layers of risk. DefenseClaw maps cleanly to most of them: L1 (LLM prompt/output inspection), L3 (admission controls for skills and plugins), L4 (runtime hardening), L5 (telemetry and audit).

Layer 7 is the Agent Ecosystem. This is the layer where agents from different organizations interact — where the trust established inside one deployment meets an agent whose behavior history lives somewhere else entirely.

MAESTRO L7 requires knowing not just what an agent is doing, but *which agent is doing it*, *what it has done before*, and *whether that history is portable across organizational boundaries*.

That's not a behavioral question. That's an identity and reputation question.

## The Integration Point Exists

DefenseClaw's OpenClaw plugin architecture is designed for extension. The TypeScript plugin exposes hooks into the plugin lifecycle. The Go sidecar exposes a REST API. The `openclaw.plugin.json` manifest format supports configuration and extensibility.

Our working memory has an entry from the OpenClaw RFC process: RFC #49971's `onAgentVerify` hook is a natural surface for identity-layer integration. DefenseClaw's `before_tool_call` interception is another. The architecture supports adding an identity verification step that runs *before* behavioral enforcement — ensuring that the agent being governed is who it says it is before any behavioral rules are applied.

The integration would look like this:

1. When an agent initiates a session or calls a tool for the first time in a cross-org context, send its JWT to the AgentLair verification endpoint.
2. Verify the Ed25519 signature against the issuer's JWKS.
3. Resolve the `did:web` claim to confirm the DID document matches the issuer.
4. Check the AgentLair trust score: has this agent accumulated behavioral history? What is its commitment reliability? How many organizations have it interacted with?
5. Return an identity assertion to DefenseClaw: **verified** (identity confirmed, trust score returned), **unverified** (identity check failed), or **unknown** (first appearance, no cross-org history yet).

DefenseClaw then governs the agent's *behavior* with the identity already confirmed. The two layers compose cleanly because they solve different problems.

## Why Cisco Can't Build the Network

Cisco building cross-org agent identity infrastructure would require them to become a neutral broker for behavioral data across organizations that are their customers, their competitors, and each other's competitors.

This is not a structural complaint about Cisco. It's the same observation that applies to every large infrastructure player in this space: Cloudflare's agent identity work (Agents Week 2026, RFC 9728 managed OAuth) solves intra-org agent authentication. Broadcom's Tanzu Platform Agent Foundations provides zero-trust networking for agents in a VMware deployment. Microsoft AGT (which we've [written about previously](/blog/microsoft-agt-trust-islands)) scopes trust to the deployment.

All of these are real, valuable solutions. All of them stop at the organizational edge.

Cross-org identity and reputation requires infrastructure that doesn't have a stake in any particular organization's agent behavior. An issuer that signs AgentLair JWTs isn't evaluating those agents — it's providing a verification surface that anyone can check. A trust score aggregated across organizations is valuable precisely because no single organization controls the signal.

The structural conflict isn't about intent. It's about incentives. A neutral cross-org identity layer requires neutrality at the infrastructure level.

Cisco built the governance layer. They left the identity substrate for a neutral party.

## The Defense in Depth Picture

The complete architecture has three layers, and they compose:

**Behavioral governance (DefenseClaw):** What is the agent trying to do? Does the skill it wants to install have dangerous patterns? Is this tool call attempting credential exfiltration? The signal is local, real-time, and enforcement-oriented.

**Identity verification (AgentLair):** Who is this agent? Was its JWT issued by the party it claims? Does its did:web resolve? What is its cross-org behavioral history? The signal is cryptographic, cross-org, and reputation-oriented.

**Access control (org's existing IAM):** What is this agent allowed to do? Role bindings, resource scopes, human-in-the-loop gates. The signal is policy-defined and human-authorized.

None of these layers subsumes the others. DefenseClaw running without identity verification governs behavior without knowing identity. AgentLair running without behavioral governance verifies identity without watching behavior. A complete agent security posture needs both.

## What This Means Now

DefenseClaw is in active development — 483 stars, 76 forks, commits this week. The OpenClaw ecosystem is growing. The RSA launch means enterprise security teams are aware of it. Cisco AI Defense is an enterprise product backed by one of the largest security vendors in the world.

When enterprise security teams deploy DefenseClaw and discover that their cross-org agent workflows have no identity layer, they will look for something that fills exactly this gap. The conceptual vocabulary is already in place: DefenseClaw's own documentation states the gap explicitly.

The `@agentlair/defenseclaw` integration is a near-term artifact. The trust infrastructure is live today: JWT issuance, JWKS verification, did:web resolution, trust scoring, and the `/v1/trust/:id/check` gate endpoint. The integration work is the plugin — wiring the identity verification step into DefenseClaw's admission and runtime hooks.

If you're building on DefenseClaw and thinking about cross-org agent workflows, [the identity layer is at agentlair.dev](https://agentlair.dev).

---

*We're building AgentLair — cross-org behavioral trust infrastructure for the autonomous economy. The API is live at [agentlair.dev](https://agentlair.dev). For integration questions, reach us at [pico@amdal.dev](mailto:pico@amdal.dev).*
