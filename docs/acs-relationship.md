# AgentLair × Agent Control Standard (ACS): Relationship & Integration Posture

**Status:** Architecture note (internal-facing). Not for publication.
**Created:** 2026-05-28
**Trigger to revisit:** ACS v1 ships the `specification/Observability/opentelemetry/` mapper (currently an empty directory in the upstream repo).

---

## TL;DR

ACS (launched 2026-05-27, [agentcontrolstandard.ai](https://agentcontrolstandard.ai/)) is a **6-week-old, Zenity-led spec** for an inline agent-control protocol. It is **not yet a standard**, **not an OWASP project** (despite framing in the press release), and **does not yet emit traces** in any ingestable form.

AgentLair should treat ACS as **complementary infrastructure at a different layer**, not as a competitor, dependency, or near-term integration target. The right posture is **monitor and prepare**, not build.

---

## What ACS actually is (verified against primary sources)

| Claim in launch coverage | Verified reality |
|---|---|
| "OWASP-affiliated standard" | Fork of `OWASP/www-project-agent-observability-standard` under its own MIT-licensed org. Top contributor is Michael Bargury (Zenity CTO); the OWASP AOS project itself is still an Incubator. ACS is Zenity-driven, not OWASP-governed. |
| "Standardized middleware hooks" | True. Spec defines `agentTrigger`, `message`, `toolCallRequest`, `knowledgeRetrieval`, `memoryStore` plus A2A/MCP extensions. |
| "OpenTelemetry traces" | **Promised, not shipped.** `specification/Observability/opentelemetry/` directory exists but is empty. Listed as a v1 roadmap item. |
| "OCSF mappings" | **Promised, not shipped.** Same status. |
| "L3 runtime governance" | External framing (Oracle's sandbox taxonomy). ACS's own model is three layers: **Instrument / Trace / Inspect**, with Observed Agent ↔ Guardian Agent as the central protocol shape. |
| Adoption | 5 GitHub stars, 2 forks, ~5 contributors (all Zenity-orbit). No named external adopters in the press release. |

**Transport:** HTTP(S) with JSON-RPC 2.0 payloads. **Not OTLP.** Not a wire-level event protocol.

**Architecture:** Synchronous request/response between the agent runtime and a co-located Guardian Agent. Verdicts: permit / deny / modify. This is an **inline control protocol**, not an export protocol.

Source: [github.com/Agent-Control-Standard/ACS](https://github.com/Agent-Control-Standard/ACS), `specification/ACS/acs_schema.json` v0.1.0.

---

## How this maps to AgentLair's layer model

AgentLair operates one layer up from ACS. They aren't on the same wire:

```
┌────────────────────────────────────────────────────────────────────┐
│  AgentLair: cross-organizational behavioral trust attestation      │
│  (JWT-embedded score, JWKS-verifiable, RFC-002 telemetry intake)   │
├────────────────────────────────────────────────────────────────────┤
│  ACS Guardian Agent: inline per-action permit/deny/modify          │
│  (one organization's runtime, synchronous RPC, no cross-org view)  │
├────────────────────────────────────────────────────────────────────┤
│  Agent runtime: tool calls, message handling, memory, retrieval    │
└────────────────────────────────────────────────────────────────────┘
```

ACS gates **what happens next** inside one org. AgentLair attests to **what already happened, across orgs**. The TOCTOU framing in `agentlair-l4-positioning.md` applies: ACS is a declarative-control plane (what an agent is permitted to do, at the moment of action). AgentLair is an observational-trust plane (what an agent actually did, accumulated over time).

A reasonably governed enterprise would benefit from **both**: ACS for inline policy enforcement, AgentLair for the cross-org behavioral trust attestation that traveling agents need.

---

## Positioning statement (sharpened from task description)

The originally proposed line —

> *"ACS standardizes what agents do within your org. AgentLair tells you what they did across orgs."*

— is roughly right but **over-commits** by implying AgentLair consumes ACS output. We don't, and ACS doesn't yet emit anything we can consume. Sharper:

> **"ACS is an inline control plane for agents inside one organization. AgentLair is the cross-organizational behavioral trust layer that travels with the agent's identity. They sit on different wires and solve different problems — ACS gates the next action; AgentLair attests to the accumulated record."**

If/when ACS v1 ships its OpenTelemetry mapper, the second sentence can extend to: *"…and when ACS-instrumented agents emit OTel spans, AgentLair ingests them as behavioral telemetry via the RFC-003 event pipeline."*

**Do not publish this positioning yet.** ACS is too small (5 stars, 1 day old) to amplify by acknowledgement. Re-evaluate when ACS clears one of these thresholds:
- 50+ GitHub stars or 10+ named adopters
- ACS v1 OTel mapper merges
- A buyer or reviewer asks about ACS specifically

---

## Ingestion compatibility analysis

The task asked: "Can AgentLair ingest ACS traces?" The answer has two parts.

### Today (ACS v0.1)
**No.** ACS v0.1 specifies an inline RPC contract, not a trace export. There are no traces to ingest. Trying to ingest "ACS events" today means proxying Guardian-Agent RPC payloads — which is not what ACS is for and would tie AgentLair to a control-plane interface that's likely to change.

### When ACS v1 ships its OTel mapper
**Yes, with no new architecture required.** AgentLair's `RFC-003` behavioral event envelope already accepts the categories ACS instrumentation would emit:

| ACS step | AgentLair `BehavioralEvent.category` | Notes |
|---|---|---|
| `agentTrigger` | `session` | Lifecycle: agent run start |
| `message` | `tool` (LLM call) or `delegation` (A2A) | Distinguish by counterparty |
| `toolCallRequest` | `tool` | `action` = tool name, `scope_used` = declared capability |
| `knowledgeRetrieval` | `resource` | `resource_type` = "knowledge" or vector store kind |
| `memoryStore` | `resource` | `resource_type` = "memory" |
| Guardian verdict `deny` | `result = "denied"` | Cleanly maps |
| Guardian verdict `modify` | metadata: `{"verdict": "modify"}` | Preserves the signal without expanding the enum |

The mapping is straightforward because both designs share an action-with-result model. **No RFC-003 changes are needed** to be ready for ACS interop.

### What we would need to build
A thin adapter — call it `@agentlair/acs-bridge` — that:
1. Subscribes to ACS-emitted OTel spans (via the v1 mapper, when it exists).
2. Translates each span into a `BehavioralEvent` and `POST`s to `/v1/events`.
3. Preserves the Guardian verdict as `result` plus optional metadata.

Estimated effort once ACS v1 ships: ~1-2 days of work, plus a demo integration. **Do not start building it yet** — the input format isn't frozen.

---

## Decision

1. **Do not** update the public `agentlair-l4-positioning.md` doc to reference ACS. Mentioning a 1-day-old, 5-star spec amplifies them more than us, and "OWASP-affiliated" appears in their marketing more than in their governance — repeating their framing degrades our credibility.
2. **Do not** open a GitHub issue / PR on the ACS repo right now. There's nothing technical to contribute until the OTel mapper directory has content.
3. **Do not** create a "watch ACS" successor task — passive monitoring is reflection's job, not the task queue's.
4. **Do** keep this note as the canonical internal artifact. If ACS adoption changes, this is the starting point for the public positioning update.
5. **Do** confirm that RFC-003's envelope is OTel-mappable in spirit (verified above). No code changes today; the alignment is already there.

---

## Trigger conditions to revisit

Re-evaluate ACS posture if any of the following becomes true:

- The `specification/Observability/opentelemetry/` directory in the ACS repo gains a real schema/mapper.
- An ACS-affiliated party publicly proposes a federation or aggregation pattern for cross-org trust (i.e., enters AgentLair's layer).
- A prospect or design partner names ACS in a buyer-journey conversation.
- Bargury or Lambros (Zenity) publishes a follow-up arguing ACS *is* the cross-org layer — then we have a positioning conflict and must respond.

Until then: no action.

---

## Source trail

- BusinessWire announcement: `https://www.businesswire.com/news/home/20260527326259/en/Agent-Control-Standard-Launches-Open-Framework-for-Runtime-Governance-of-AI-Agents`
- Spec repo: `github.com/Agent-Control-Standard/ACS` (MIT, created 2026-04-10)
- Schema: `specification/ACS/acs_schema.json` v0.1.0 (JSON Schema draft-07, JSON-RPC 2.0 transport)
- Upstream incubator: `owasp.org/www-project-agent-observability-standard-2`
- AgentLair counterpart: `docs/agentlair-l4-positioning.md`, `rfcs/RFC-003-behavioral-event-ingestion.md`
- L3/L4 framing (external): `github.com/kajogo777/the-agent-sandbox-taxonomy`
