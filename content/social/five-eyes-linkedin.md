# Five Eyes LinkedIn Post

_Status: ready to post | Created: 2026-05-06_
_Ref: agentlair.dev/blog/five-eyes-audit-trail-gap_

---

Six intelligence agencies just published the first coordinated guidance on agentic AI security.

The accountability risk they name is specific: agents can delete their own audit trails.

Their recommendation: quarantine any agent request to delete logs until a human approves it.

Right as far as it goes. But it doesn't address the harder problem. An agent running on infrastructure that overlaps with its own logging doesn't need to explicitly delete anything. Logs inside your trust boundary can be altered. Records can be overwritten. Hash chains can be re-created by anyone who controls the signing key.

The guidance names the threat. It doesn't spec the defense.

Tamper-evident audit logging — the kind that survives "could these logs have been modified?" — needs three things:

1. Logs captured outside the agent's control (middleware-level, before agent code runs)
2. Logs outside any single party's trust boundary (Merkle tree receipts, cryptographically append-only, independently verifiable)
3. Behavioral monitoring independent of agent self-reporting

AgentLair implements all three. SCITT Phase 2 ships Merkle receipts for every agent action. Behavioral Health Certificates attest to behavioral patterns using data the agent doesn't control.

The Five Eyes document just gave enterprise procurement and legal teams the language to ask hard questions about AI agent governance. The answer has to be architectural.

https://agentlair.dev/blog/five-eyes-audit-trail-gap

---

_Voice check: run before posting. Especially em-dash density._
