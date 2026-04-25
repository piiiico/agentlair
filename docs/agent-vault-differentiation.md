# Agent Vault vs. AgentLair — Differentiation Brief

_Last updated: 2026-04-24. For Show HN prep (Apr 28)._

---

## What Agent Vault Does

Agent Vault (by Infisical, Apr 22 Show HN, 124 pts) is a self-hosted HTTP credential
proxy. Agents route requests through `HTTPS_PROXY=http://127.0.0.1:14322`; Agent Vault
injects real credentials at the network layer — the agent never sees secrets. Credentials
are encrypted at rest (AES-256-GCM). Request logs capture method, host, and status.

---

## Where AgentLair Differs

### 1. Cloud-native vs. local proxy
Agent Vault is a Go binary on the same machine as your agent (ports 14321/14322, CA
cert required). AgentLair is a cloud service (Cloudflare Workers) — no install, no
HTTPS_PROXY, no CA trust. Works with containers, remote sandboxes, CI, anywhere.

### 2. Identity-first vs. credential proxy
Agent Vault hides credentials but does not give the agent an identity. AgentLair
issues each agent session an EdDSA-signed Agent Access Token (AAT), verifiable via
a public JWKS endpoint at `agentlair.dev/jwks`. The agent is a principal with a
stable DID (`did:web:agentlair.dev:agents:acc_…`), a public key, and a trust score —
not just a process with proxy access. External services can verify who is calling.

### 3. Behavioral trust scoring vs. static access rules
Agent Vault enforces static credential rules: either an agent has proxy access or it
doesn't. AgentLair's trust engine builds a behavioral score (0–100) from a 90-day
audit window across three dimensions: consistency, restraint, and transparency.
The score gates ATF maturity levels (intern → junior → senior → principal). Trust
accumulates across sessions — an agent that behaves well earns wider permissions over
time; one that misbehaves degrades automatically.

### 4. Runtime approval flows
HN commenter 10keane noted that static credential protection fails against prompt
injection — the real need is runtime supervision of agent behavior, not just hiding
secrets. AgentLair has this built in: `POST /v1/charge` can be configured with
`on_limit=approve`, which blocks execution and creates an approval request that the
operator accepts or rejects before the agent proceeds. Agent Vault has no equivalent.

### 5. Agent-to-agent communication
Agent Vault has no inter-agent messaging. AgentLair provides email addresses for
agents (`@agentlair.dev`), an inbox with real-time delivery, and webhook routing —
agents can send, receive, and act on messages from other agents or humans. This
enables async, multi-agent workflows without a separate messaging layer.

### 6. x402 micropayments
AgentLair implements x402 natively — agents pay per call in USDC on Base, no
subscription required. Agent Vault has no payment layer.

---

## HN Thread Insights (Apr 22 thread, item 47865822)

- **10keane** argued for runtime supervision over static credential protection — that
  hiding secrets fails once an agent is prompt-injected. AgentLair ships this.
- **gregw2** asked for agent identity via short-lived tokens rather than long-lived
  credentials. AgentLair ships this (EdDSA AATs, 1h TTL, JWKS-verifiable).
- **sandeepkd** worried about MITM complexity and CA cert management.
  AgentLair has no MITM proxy — identity is token-based.
- **hebetude** asked how you prevent an agent from accessing the vault itself.
  AgentLair sidesteps this: there is no local vault process to attack.

---

## HN Talking Points (technical, ready-to-use)

1. "Agent Vault solves credential exfiltration via a local proxy — a real problem.
   AgentLair solves the orthogonal problem: what is this agent, should it be trusted,
   and can it authorize itself to external services without any shared secrets?"

2. "Every AgentLair session gets a short-lived EdDSA JWT verifiable at a public JWKS
   endpoint. Your agent has a DID document. That's a different layer than what Agent
   Vault addresses — identity, not just credential isolation."

3. "The trust score accumulates across sessions. An agent that's run 200 successful
   sessions with no anomalies has a verifiable track record. Static proxy rules can't
   represent that."

4. "AgentLair agents can receive email, send messages, and participate in async
   multi-agent workflows — Agent Vault is infrastructure for a single agent calling
   APIs. Different scope."
