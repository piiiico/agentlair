# Five-Layer Agent Trust Model — Twitter Thread

*For @agentlair account. Publish alongside blog post.*

---

**1/7**

Three different things are called "L4" in agent security right now.

AgentNexus: entity-verified certificate (static)
Armalo AI: financial staking (USDC escrow)
RSAC 2026: behavioral trust (runtime)

Same label. Three completely different things.

We need a shared vocabulary. Here's a proposal.

---

**2/7**

The Five-Layer Agent Trust Model:

L1 — Identity Provenance: "Who delegated authority?"
L2 — Identity Verification: "Is this the agent it claims to be?"
L3 — Authorization: "What is it permitted to do?"
L4 — Structural Enforcement: "Can it physically do X?"
L5 — Behavioral Trust: "Should I trust it based on track record?"

Each layer depends on the ones below it. None of L1-L4 can answer the L5 question.

---

**3/7**

The cold-start test:

An agent with 2 years of perfect behavior across 500 orgs enters yours for the first time. A fresh attacker agent also requests access.

L1: Both have delegation.
L2: Both have valid keys.
L3: Both request the same scopes.
L4: Both pass policy.

Identical. Only L5 — cross-org behavioral data — can separate them.

---

**4/7**

Why everyone stops at L3:

L1-L4 are single-org problems. Your keys, your scopes, your policies.

L5 requires data from organizations you don't control. That's fundamentally harder:

- Neutral aggregation (no cloud vendor can credibly build this)
- Privacy-preserving computation (ZK-native)
- Data that compounds — behavioral trust can't be purchased

---

**5/7**

The evidence from 2026:

- 9/11 MCP marketplaces successfully poisoned (passed all declarative review)
- Mythos-class vulnerability discovery reproduced for $30 via public APIs
- MCPwn: first named MCP exploit campaign, CVSS 9.8, 2,600 instances
- Salt Security: 48.9% of orgs blind to M2M traffic

Declarative controls aren't enough. Runtime behavioral data is the missing layer.

---

**6/7**

The trust data market already exists.

Verisk ($2.8B), D&B ($2.3B), FICO ($1.6B) — all aggregate behavioral data across organizations to produce trust scores individuals can't compute alone.

Same market structure, new data type: agent behavioral telemetry instead of payment history.

---

**7/7**

Full essay with the model, evidence, and what it takes to build L5:

[link to blog post]

The layer definitions are meant to be copy-pasteable. Use them in your decks, your RFCs, your architecture docs. The industry needs shared vocabulary before it can build shared infrastructure.

---

*Notes for posting:*
- Thread optimized for quote-RT on tweet 2 (the model itself) and tweet 3 (the cold-start test)
- Tweet 2 is the one that gets screenshot'd into presentations — make sure formatting holds
- Consider posting tweet 1 as a standalone teaser 2-4 hours before the full thread
- Tag relevant accounts on engagement: @cloudsecurity (CSA), @salt_security, @nvidia (OpenShell)
