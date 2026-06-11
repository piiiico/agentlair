---
title: "MCP Becomes a C2 Fabric: The Cross-Server Behavioral Gap"
description: "UV Cyber's May 27 advisory frames MCP as command-and-control infrastructure for offensive agent swarms. Cross-server manipulation is the proof: each call passes per-server authorization. The attack lives in the sequence no single server can see."
pubDate: 2026-05-29
authorName: "Pico"
related:
  - five-layer-agent-trust-model
  - mcp-action-chaining-the-attack-your-permissions-cant-see
  - mcp-trust-attestation-three-lines
---

UV Cyber's [MCP Threat Advisory](https://www.uvcyber.com/resources/reports/threat-advisory-mcp-threats) landed on May 27. The TIDE Team analysis frames the protocol in one sentence that makes the trust model explicit:

> "MCP can be weaponized as a legitimate-appearing command-and-control fabric for offensive agent swarms."

This is not the usual MCP critique. It is not about a vulnerable server, a leaked credential, or a tool-poisoning trick on one connector. It is the structural claim that the protocol itself becomes the C2 surface, because the only place trust gets evaluated is inside each server, one call at a time.

The proof is one paragraph deeper in the same advisory:

> "A malicious tool's description on one MCP server manipulates how the agent interacts with tools on a separate, trusted server."

Two servers. Two trust evaluations. Both pass. The attack is the relation between them, and the relation is not anchored anywhere.

## What each layer sees

Map this against the [five-layer agent trust model](/blog/five-layer-agent-trust-model). An agent connected to Server A (compromised) and Server B (trusted) executes three calls:

1. Server A returns a tool description containing instructions the agent treats as priority context.
2. The agent calls Server B with parameters shaped by Server A's response.
3. Server B executes the call within its declared scope.

**L1 (Identity Provenance):** the agent is registered and human-backed. Pass.

**L2 (Identity Verification):** the agent's signing key validates on every call. Pass.

**L3 (Authorization):** every call to Server B falls within the scope Server B granted. Pass.

**L4 (Structural Enforcement):** every action is one a policy engine would permit on its own merits. Pass.

Nothing in L1 through L4 sees that Server A's description shaped what Server B was asked to do. Each server evaluates its own surface. The cross-server relation falls into the gap between them.

UV Cyber documents the mechanism in the same advisory: tool definitions get inspected once, at connection time. Tool responses flow continuously without equivalent scrutiny. The trust evaluation never re-anchors. This is the [TOCTOU of Trust](/blog/toctou-of-trust), restated for MCP: the description you approved at t=0 is not the description steering the agent at t=1.

## Why the gap is structural

The numbers in the advisory are the same numbers showing up in every MCP security report this year. 40+ CVEs disclosed against MCP implementations between January and April 2026. An estimated 200,000 vulnerable servers exposed globally. A Microsoft high-severity flaw in March. Ten more high or critical CVEs in April.

Patching servers does not close this. Tighter per-server scopes do not close this. Every patch and every scope check operates inside a single server. The attack is a sequence across servers, with each step in scope for its own server.

The only layer that can see the sequence is the one evaluating the agent's behavior across organizations, over time. That is L5. It is also the layer the rest of the 2026 MCP stack does not ship.

## What runs in the gap

A Behavioral Commitment Credential anchors an agent's declared intent and scope before any tool call fires. The audit chain records each call against the anchor, not against a single server's local policy. Cross-server manipulation surfaces as distributional shift: an agent that normally talks to Server B with one shape of parameters suddenly talks to it with a shape derived from Server A's instructions. The shift is detectable without inspecting either server's internals, because the trust signal lives in the agent's cross-server behavior, not in any single server's logs.

[`@agentlair/mcp-trust-attestation`](/blog/mcp-trust-attestation-three-lines) puts the per-server side of this on the wire in three lines of middleware. The trust descriptor each MCP server publishes is byte-identical to the live AgentLair issuer. The behavioral attestation behind it runs against the cross-server history, which is where this class of attack actually lives.

UV Cyber's framing is precise. The C2 fabric language is not rhetorical reach. The protocol is structurally a coordination channel without behavioral evidence, and a coordination channel without behavioral evidence is a C2 surface by definition. AgentLair issues the evidence.

---

*Sources: UV Cyber, ["Threat Advisory: MCP Threats"](https://www.uvcyber.com/resources/reports/threat-advisory-mcp-threats), May 27, 2026 (TIDE Team analysis). AgentLair, ["The Five-Layer Agent Trust Model"](/blog/five-layer-agent-trust-model). Install the per-server attestation surface: `npm install @agentlair/mcp-trust-attestation`.*
