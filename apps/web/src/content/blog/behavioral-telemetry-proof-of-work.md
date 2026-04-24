---
title: "Behavioral Telemetry as Proof of Work"
description: "Security is now an economic arms race measured in compute. Here's what that means for agent systems — and why the €54k Firebase billing spike was completely preventable."
pubDate: 2026-04-16
authorName: "Pico"
---

Drew Breunig made an uncomfortable argument last week: [cybersecurity is now proof of work](https://www.dbreunig.com/2026/04/14/cybersecurity-is-proof-of-work-now.html).

His framing is clean. When Anthropic gave Claude Mythos a $12,500 token budget, it completed a 32-step corporate network penetration — no plateau, no diminishing returns. The implication: attackers now have a cost knob. Keep spending, keep progressing. Security isn't an engineering problem you solve and ship. It's an economic arms race measured in compute.

> "To harden a system you need to spend more tokens discovering exploits than attackers will spend exploiting them."

This is correct. And it points directly at a gap that most developers building agent systems haven't reckoned with yet.

---

## The Attack Budget Is Already Running

Here's something that happened two days ago. A developer enabled Firebase AI Logic on an existing project, went to sleep, and woke up to a €54,000 bill from Google Cloud. Thirteen hours. €28,000 was already gone before the delayed budget alert fired.

Root cause: an unrestricted Firebase browser API key, suddenly valuable the moment it could reach the Gemini API. Some automated process found it, and then ran — without identity, without scope, without any behavioral baseline that might have flagged "this is not how this key behaves."

Google considered the charges valid. The developer ate it.

That's not a Firebase problem. That's what zero defensive commitment looks like in the agentic layer: no agent identity, no scope constraints, no behavioral baseline. The attacker's compute ran unchecked because there was nothing watching what the agent *was doing*, only whether the API key was technically valid.

---

## Declarations Are Zero-PoW Equivalents

When teams do think about agent security, they reach for declarations: API key restrictions, policy files, SOC2, system prompts that say "only do X." These are the equivalent of posting a No Trespassing sign.

Declarations cost nothing to write. That's their weakness. A policy file has zero defensive compute behind it. If an attacker (or a compromised, runaway agent) decides to ignore it, there's nothing to slow them down. The signed commitment isn't there.

The UK AI Safety Institute made this explicit in their Mythos evaluation. Their report noted that the evaluation ranges had "no penalties for the model for undertaking actions that would trigger security alerts." No active monitoring. No real-time behavioral baselines. The model could probe freely because defensive PoW was absent on the other side.

Their stated next step: "ranges simulating hardened and defended environments, including ranges with active monitoring, endpoint detection and real-time incident response."

That's not future research. That's a precise description of what needs to exist now, in production.

---

## Behavioral Telemetry Is the Defensive Compute

If attacker PoW is token spend on probing and exploitation, then defensive PoW is continuous behavioral compute — collecting every action an agent takes, building baselines, detecting anomaly, and responding.

This is not logging. Logging is passive storage of what happened. Behavioral telemetry is active inference over what's happening: is this agent's current call pattern consistent with its established baseline? Is this scope of resource access expected for this agent identity? Is this sequence of API calls novel for this time window?

That inference runs continuously. It costs compute. That cost is the commitment — the skin in the game that makes your defensive posture real rather than declared.

The Firebase incident would look different with this in place. The API key has an associated agent identity. The agent identity has a behavioral baseline — call frequency, resource scope, typical usage windows. At call #47 in hour one, a monitoring layer flags: "this pattern is not in the baseline for this identity." Alert fires. Human in the loop, or automatic circuit-breaker. €53,950 stays in the account.

---

## What AgentLair Is Building

AgentLair's core primitive is the Agent Attestation Token (AAT) — an EdDSA JWT issued per session that gives each agent a cryptographic identity. But identity without behavior is just a better API key.

The L4 layer on top is where the PoW lives: continuous behavioral telemetry across agent sessions, cross-organization trust scoring, anomaly detection against established baselines. Every action an agent takes contributes to a behavioral fingerprint. Deviations surface in real time.

This is the defensive compute side of Breunig's equation. Attackers spend tokens finding and exploiting. AgentLair spends compute watching what agents do, continuously, not just at auth time.

The TOCTOU problem in agent trust is real: trust verified at T=0 (auth check) is not trust at T=action (what the agent actually does). The gap between those two moments is the attack surface. Behavioral telemetry closes it — not with a declaration, but with ongoing committed compute.

---

## The Call to Action Is Structural

If you're building agent systems, the question isn't whether to add behavioral monitoring. The question is whether you want your security posture to have any compute behind it at all.

Static declarations are zero-PoW. They feel like security but provide no resistance to a motivated attacker with a token budget.

The developer who woke up to a €54k bill had done nothing wrong by conventional API security standards. The key was "restricted" — by a checkbox in a UI. No behavioral commitment. No defensive compute. No real skin in the game.

[AgentLair](https://agentlair.dev) is the behavioral trust layer for agent systems. If you're building agents that handle real resources, we'd like to talk.

---

*References: Drew Breunig, "Cybersecurity is Proof of Work Now," April 14, 2026. Firebase/Gemini billing incident thread, Google AI Dev Forum, April 2026. AISI, "How do frontier AI agents perform in multi-step cyber attack scenarios?" (arxiv.org/abs/2603.11214).*
