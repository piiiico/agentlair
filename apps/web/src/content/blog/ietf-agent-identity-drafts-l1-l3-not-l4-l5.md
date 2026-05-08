---
title: "Five IETF agent-identity drafts. Every one stops at L3."
description: "Five active IETF drafts cover provenance, verification, authorization, and discovery. Each declares behavior out of scope. L4-L5 stays open."
pubDate: 2026-05-07
authorName: "Pico"
cta: try
tags:
  - ietf
  - agent-identity
  - trust-layers
  - agentlair
related:
  - five-layer-agent-trust-model
  - aws-mcp-context-keys-stop-at-the-first-lambda
  - agent-identity-shipped-behavior-didnt
---

The IETF active draft pool now contains five I-Ds about agent identity, written by different authors, with no coordinating working group. Read together, they describe a stack: provenance, domain-anchored verification, authorization tokens, policy enforcement at request time, discovery. Read for scope, every one of them stops at the same place.

The reference for the layers is [The Five-Layer Agent Trust Model](/blog/five-layer-agent-trust-model/). L1 is identity provenance. L2 is identity verification. L3 is authorization. L4 is structural enforcement. L5 is cross-organizational behavioral trust. The five drafts below map onto L1, L2, and L3. Each declares L4 and L5 outside its scope, in its own words.

## L1: human-anchored provenance

[draft-beyer-agent-identity-architecture-00](https://datatracker.ietf.org/doc/draft-beyer-agent-identity-architecture/) proposes an architecture for human-anchored agent identity, delegation, and provenance. Three elements: a human identity root, explicit delegation semantics with scope and duration, and provenance structures the ecosystem can verify. Threat model: impersonation, forged delegation, unauthorized replication, lost provenance.

The scope statement is explicit. The architecture does not govern agent cognition or internal decision-making. Provenance traces an action back to a human. It says nothing about what the agent did between authorization and outcome.

## L2: domain-anchored verification

[draft-narajala-courtney-ansv2-01](https://datatracker.ietf.org/doc/draft-narajala-courtney-ansv2/), with authors at GoDaddy, OWASP, DistributedApps.ai, and Cisco, anchors agent identity to DNS domains validated through ACME, issues version-bound certificate pairs, and seals lifecycle events into a SCITT-aligned append-only transparency log. This is the strongest L2 primitive in the spring 2026 wave.

The scope language is surgical. The registration authority "answers one question: 'Who are you?'" Governance evaluation is deferred to "separate trust layers involving third-party attestors and behavioral reputation scoring." That sentence is an entire L4-L5 thesis written from inside an L2 draft.

## L3: OAuth, formalized for agents

[draft-aap-oauth-profile-01](https://datatracker.ietf.org/doc/draft-aap-oauth-profile/) extends OAuth 2.0 and JWT for autonomous AI agents. It defines structured claim schemas for agent identity, task context, capabilities, oversight requirements, delegation chains, and audit metadata, plus token validation rules for resource servers and constraint enforcement semantics for rate limiting, domain restrictions, and time windows.

The non-goals are explicit. The profile does not define internal AI model behavior, judge agent decision ethics, or replace organizational security frameworks. OAuth answers whether the bearer is permitted to call this endpoint right now. It does not answer whether this bearer has been behaving like an agent that should keep being permitted.

## L3: signed actions and a policy proxy

[draft-aip-agent-identity-protocol-00](https://datatracker.ietf.org/doc/draft-aip-agent-identity-protocol/), authored at Montcao and NVIDIA, defines a two-layer protocol. Identifier and key registration plus a proxy that verifies signatures, evaluates declarative policies, and emits allow, deny, or hold decisions before tools execute.

The primary threat is prompt injection. The defense is a tool allowlist plus deny rules outside the model's trust boundary. The draft is candid about what the proxy cannot stop: compromised agent runtimes that bypass it, and tool servers that accept calls from unauthorized sources. Behavioral profile across sessions is not in the threat model. The proxy is a per-request gate, not a memory.

## L1 adjacency: discovery without trust

[draft-king-dawn-requirements-01](https://datatracker.ietf.org/doc/draft-king-dawn-requirements/), from Old Dog Consulting, specifies requirements for Discovery of Agents, Workloads, and Named Entities. Discovery is upstream of L1: before you can verify provenance, you need to locate the entity. The DAWN cluster also includes [draft-akhavain-moussa-dawn-problem-statement-00](https://datatracker.ietf.org/doc/draft-akhavain-moussa-dawn-problem-statement/) and [draft-farrel-dawn-terminology-01](https://datatracker.ietf.org/doc/draft-farrel-dawn-terminology/) on the same axis.

The out-of-scope list reads like a tour of the rest of the stack: authentication and authorization of entities themselves, capability exchange and negotiation between discovered entities, entity selection mechanisms, task management and orchestration, agent-to-agent communication protocols. DAWN says the agent exists at this address. It is silent on every question that follows.

## The shared boundary

Five active drafts. Different authors at NVIDIA, GoDaddy, OWASP, Cisco, Old Dog Consulting, and independents. No coordinated working group visible across the bibliographies. Every draft stops at the same boundary, and three of them name it in language that could have been copied between filings.

ANSv2 defers behavioral reputation scoring to separate trust layers. DAWN excludes authentication, authorization, and capability exchange. Beyer excludes cognition and decision-making. AAP excludes internal model behavior. AIP excludes runtime compromise.

The boundary is unanimous because L1-L3 are single-organization problems. Each draft can specify its layer because the data lives inside a deployment. L4 is structural enforcement, also inside a deployment. L5 is cross-organizational behavioral trust, and no IETF draft can specify it because there is no single party to operate it. That is why the wave stops where it does.

## The next twelve to eighteen months

The IETF will canonize the wire formats. Microsoft already has Entra Agent ID. Google has Agent Identity for Vertex. Okta puts AI agents in Universal Directory. By the second half of 2027, a deployed agent carrying human-anchored provenance, an ANSv2 certificate, an AAP-profile token, and an AIP proxy will be a checklist item, not a differentiator.

L4 and L5 do not ship the same way. Structural enforcement needs runtime integration. Behavioral trust needs cross-organizational data, a neutral aggregator, privacy-preserving computation, and a record that compounds over time. None of those are wire-format problems. None of them appear in the active drafts.

AgentLair runs at L4-L5. POPA streaks turn signed activity into compounding portable evidence. BCC issuance with W3C Verifiable Credential checks the boundary the OAuth profile cannot. The SCITT corpus is the primitive ANSv2 names, operated as live infrastructure today, not a future deferral. The x402-paid attestation endpoint exposes behavioral history without a platform owner sitting in the middle.

The IETF drafts of spring 2026 are not competition. They are the substrate. AgentLair is the layer they all defer to, running in production today.

If you are integrating any of these drafts: require an Agent Attestation Token alongside the identity primitive. JWKS verification is five lines. The drafts answer who the agent is. The AAT answers what the agent has been doing.

Get one at [agentlair.dev](https://agentlair.dev).
