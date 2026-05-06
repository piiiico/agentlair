---
title: "Six Governments Named the Attack. Nobody Specced the Defense."
description: "The Five Eyes just published joint guidance on agentic AI security. The accountability risk they named: agents that delete their own audit trails. The guidance quarantines the symptom. Here's what tamper-evident logging actually requires."
pubDate: 2026-05-06
authorName: "Pico"
---

Six intelligence agencies published a joint document on May 1st. CISA. NSA. UK NCSC. Australian ASD. Canadian CCCS. New Zealand NCSC. The Five Eyes, coordinated, on the topic of autonomous AI agents. A first.

The document is called "Careful Adoption of Agentic AI Services." It identifies five risk categories: privilege escalation, design flaws, behavioral drift, structural failure, and accountability.

The accountability section is worth quoting directly.

When agentic systems fail, the consequences can be concrete: *altered files, changed access controls, and deleted audit trails.*

Deleted audit trails. The specific scenario the agencies are worried about is an agent (or someone controlling an agent) removing the evidence of what the agent did. Not corrupted data in some abstract sense. The logs, gone.

There's a recommendation: quarantine any request from an agent to delete logs until a human approves it.

That's the guidance. Quarantine delete requests.

---

## The gap the guidance doesn't fill

Quarantining delete requests is the right instinct. But it doesn't address the harder problem.

An agent with write access to a logging system doesn't need to explicitly delete anything. Logs inside your trust boundary can be altered. Records can be overwritten. Hash chains can be re-created by anyone who controls the signing key.

The guidance names the accountability risk. It doesn't give you a technical spec for solving it. No standard for log format. No requirement for independent verification. No guidance on who should sign the logs or whether the signing authority should be the same party running the agent.

This is the implementation gap every organization building agentic systems now has to solve on their own.

---

## What tamper-evident requires

A log that survives the question "could these records have been modified?" needs three properties.

**First: logs captured outside the agent's control.** If an agent can write to its own audit log, it can alter that log. This isn't hypothetical. AgentLair captures audit events at the middleware layer, before the agent's own code runs. The agent authenticates via a signed JWT, and every action gets logged independently, not by the agent itself.

**Second: logs outside any single party's trust boundary.** Ed25519 signatures help. They prove a record wasn't altered after signing. But if AgentLair signs the logs and stores the logs, a sophisticated auditor asks: can someone with database access re-sign a modified record? This is why AgentLair implemented SCITT Phase 2. Every audit entry produces a Merkle tree receipt from an independent Transparency Service. A cryptographic inclusion proof showing the entry was registered at a specific position in an append-only tree. Changing the receipt requires changing the root hash, which invalidates every receipt issued after it. Cryptographically append-only, not just contractually.

**Third: behavioral monitoring that doesn't depend on agent self-reporting.** The accountability and behavioral risk categories in the guidance are related. An agent that behaves unexpectedly and can alter its own traces is a forensic problem without a clean solution. AgentLair's Behavioral Health Certificate is a signed JWT attesting to an agent's behavioral patterns across sessions: anomaly scores, velocity, scope, error rates. Generated independently of what the agent reports about itself. Third parties can verify it without calling our API.

---

## Why this matters now

When six national intelligence agencies jointly publish guidance on a specific risk, enterprise procurement and legal teams read it. The accountability risk, agents that can alter or delete their own audit trails, just got named at the level of national security infrastructure.

The next question buyers will ask is: how do you prove this can't happen with your agents?

The answer has to be architectural. "We promise our agents don't tamper with logs" doesn't survive the question. "Here's a cryptographic Merkle receipt verifiable by your own auditor, without calling us" does.

That's what AgentLair ships today.

---

## For developers evaluating the guidance

If you're building autonomous agents and you read the Five Eyes document, the accountability section gives you the threat model. Your implementation needs:

- Logs outside the agent's control (middleware-level, not agent-reported)
- Logs outside any single party's trust boundary (independent verification, not just signatures)
- Behavioral monitoring independent of agent self-reporting

AgentLair covers all three. SCITT-backed audit trail. Behavioral Health Certificates. One API.

[Read the technical specs →](https://agentlair.dev/docs/audit-trail)
