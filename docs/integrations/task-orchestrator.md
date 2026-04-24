# AgentLair × task-orchestrator: Verifiable Agent Attribution

_Version: 0.2 | Date: 2026-04-13_

Describes how to configure [task-orchestrator](https://github.com/jpicklyk/task-orchestrator) to require verifiable agent attribution on every work item — enforced structurally at completion, not just recommended in a CLAUDE.md instruction.

**Discussion:** [jpicklyk/task-orchestrator#97](https://github.com/jpicklyk/task-orchestrator/discussions/97) — jpicklyk (maintainer) confirmed support and proposed the trait design.

---

## Why This Matters

In multi-agent setups, multiple agents may pick up, hand off, and complete tasks. Without attribution, the audit trail answers "what happened" but not "which agent did it." AgentLair's Agent Token (AAT) gives each agent a cryptographically signed identity claim. task-orchestrator's composable trait system can make attribution structurally required — not optional.

---

## Overview

task-orchestrator natively supports per-item documentation requirements via composable traits. A trait defines which notes an agent must write before a work item can advance. By defining a `needs-agent-attribution` trait, you add a completion gate: the item cannot be marked done unless the agent has written an attribution note containing its AgentLair identity.

The gate blocks **completion, not start**. Agents can begin work immediately; the attribution note is written during execution (role: `work`), and `advance_item(trigger="complete")` checks for it before advancing to terminal state. This matches how attribution works in practice: you record identity alongside the work, not before it begins.

---

## Configuration

Create `.taskorchestrator/config.yaml` in your project root and define the trait:

```yaml
# .taskorchestrator/config.yaml

traits:
  needs-agent-attribution:
    notes:
      - key: agent-attribution
        role: work
        required: true
        description: "Identity of the agent that executed this work item."
        guidance: >
          Record the AgentLair identity of the agent that performed this work.
          Required fields: Agent ID (al_name), Account ID (sub), Session token
          reference (JWT jti — include the jti only, never the raw token), and
          timestamp. Optional: audit URL (al_audit_url) for a verifiable link
          to the full audit trail. Example format shown in the AgentLair docs.
```

Then tag any work item type that should require attribution:

```yaml
note_schemas:
  feature:
    traits:
      - needs-agent-attribution
    notes:
      - key: implementation-notes
        role: work
        required: true
        description: "What was built and decisions made."
```

With this config, `advance_item(trigger="complete")` on any `feature`-tagged item will block unless both `implementation-notes` and `agent-attribution` notes are present.

---

## AgentLair JWT Field Mapping

When an agent issues an AAT via `POST /v1/tokens/issue`, AgentLair returns a signed JWT with these claims. Map them to the attribution note as follows:

| JWT Claim | Type | Attribution Field | Notes |
|-----------|------|-------------------|-------|
| `al_name` | string | **Agent ID** | The agent's registered display name. Include verbatim. |
| `sub` | string | **Account ID** | AgentLair account ID (`acct_...`). Stable across sessions. |
| `jti` | string | **Auth token reference** | Unique token ID (`aat_...`). Identifies this session's token. **Never log the raw token — log the `jti` only.** |
| `al_audit_url` | string | **Audit URL** | Link to the full audit trail for this token. Verifiable by anyone. |
| `al_email` | string | Agent email | `<name>@agentlair.dev`. Optional but useful for cross-system lookup. |
| `iat` | number | Issued at | Unix timestamp — derive ISO 8601 for the note. |

**What to omit:** The token itself (`Bearer eyJ...`), the `exp` (expiry is irrelevant to the attribution record), and any private key material.

---

## Example Note Body

When an agent writes the `agent-attribution` note, it should look like this:

```
Agent ID:       pico-3a91
Account ID:     acct_7kLmNpQr2sT4
Token ref:      aat_X9bYzWvU8pQr3mNk
Issued at:      2026-04-11T14:32:07Z
Audit URL:      https://agentlair.dev/v1/audit/aat_X9bYzWvU8pQr3mNk
```

This is human-readable and machine-parseable. The `aat_` prefix on the token ref makes it unambiguous — no raw bearer token, no private key material.

The audit URL is verifiable: any principal can call `GET https://agentlair.dev/v1/audit/aat_X9bYzWvU8pQr3mNk` to retrieve the audit record for this token issuance.

---

## Gate Enforcement Behavior

| Phase transition | What is checked | Effect |
|-----------------|-----------------|--------|
| Queue → Work (`trigger="start"`) | `role: queue` notes | Attribution not required yet |
| Work → Review (`trigger="start"`) | `role: work` notes | Attribution **required** before advancing to review |
| Any → Terminal (`trigger="complete"`) | All required notes across all phases | Attribution **required** to complete |

The agent can start work immediately. The note must be written before the item advances past the work phase. This matches the attribution workflow: the agent records its identity as it executes, then the gate validates it on completion.

---

## Writing the Attribution Note

The agent writes the note using task-orchestrator's `manage_notes` tool:

```typescript
// After executing the work item and before calling advance_item:
await mcp.callTool('manage_notes', {
  mode: 'create',
  entity_type: 'task',
  entity_id: taskId,
  key: 'agent-attribution',
  content: [
    `Agent ID:    ${aat.al_name}`,
    `Account ID:  ${aat.sub}`,
    `Token ref:   ${aat.jti}`,
    `Issued at:   ${new Date(aat.iat * 1000).toISOString()}`,
    `Audit URL:   ${aat.al_audit_url}`,
  ].join('\n'),
});

// Now advance_item will succeed:
await mcp.callTool('advance_item', {
  item_id: taskId,
  trigger: 'complete',
});
```

The `aat` object is the decoded payload from `POST /v1/tokens/issue`. Do not log `aat.token` — the `jti` alone is the reference.

---

## Hook: Inject Reminder at SubagentStart

Optionally, add a hook to remind the agent to prepare attribution before starting:

```yaml
# .taskorchestrator/config.yaml (hooks section)

hooks:
  SubagentStart:
    - description: "Remind agent to record AgentLair attribution"
      command: echo "ATTRIBUTION REQUIRED: Write agent-attribution note (Agent ID, Account ID, JWT jti) before completing this work item."
```

This is advisory — the schema gate is the enforcement layer. The hook makes the requirement visible at task start so the agent doesn't discover it only at completion.

---

## Offline Verification via JWKS

Attribution notes are not just metadata — they're verifiable. Any party (CI pipeline, auditor, compliance tool) can verify an attribution claim offline using AgentLair's public JWKS endpoint.

**Verification flow:**

1. The agent writes a signed attribution claim (the AAT JWT) alongside the note.
2. A verifier fetches the public key from `https://agentlair.dev/.well-known/jwks.json`.
3. The verifier checks the JWT signature against the JWKS key matching the `kid` header.
4. If the signature is valid, the `jti`, `al_name`, and `sub` claims are trustworthy.

```typescript
// Example: verify an attribution claim offline
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://agentlair.dev/.well-known/jwks.json')
);

async function verifyAttribution(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'https://agentlair.dev',
  });
  return {
    agentId: payload.al_name,
    accountId: payload.sub,
    tokenRef: payload.jti,
    issuedAt: new Date((payload.iat as number) * 1000),
  };
}
```

**Provider-agnostic design:** task-orchestrator does not depend on AgentLair directly. The `needs-agent-attribution` trait defines _what_ must be recorded; the identity provider (AgentLair or any JWT-issuing service with a JWKS endpoint) determines _how_ the claim is signed. This separation is intentional — task-orchestrator stays provider-agnostic while enabling cryptographic verification.

---

## Roadmap: Signed Verification (Issue #100)

Based on [jpicklyk/task-orchestrator#100](https://github.com/jpicklyk/task-orchestrator/issues/100), the maintainer has outlined a two-stage plan to deepen attribution from metadata to cryptographic proof:

### Stage 1: Actor Metadata on Transitions (current)

Schema changes adding optional actor metadata fields to transitions and notes. No verification logic — the data is recorded but not validated. This closes the basic audit gap: "which agent did this?"

- Optional `agent_id` and `agent_signature` fields on `request_transition`
- No new dependencies — purely additive schema change
- Default: no-op verification (trust the note content as-is)

### Stage 2: JwksActorVerifier

A verification implementation that validates JWT proofs with **action-binding claims** — the signature covers not just the agent's identity but _what the agent did_.

- `JwksActorVerifier` validates signed claims against any JWKS endpoint
- Action-binding: the JWT proof binds the agent identity to the specific transition or note, preventing replay
- Provider-agnostic: any identity provider with a JWKS endpoint works; AgentLair is one implementation

**Open design question:** Revocation strategy — hot (real-time JWKS key invalidation when an agent is compromised) vs. cold (mark revoked tokens in audit trail, verify post-hoc). AgentLair's current approach: short-lived JWTs (1h TTL) handle most revocation needs without infrastructure overhead; JWKS key rotation covers key compromise scenarios.

---

## References

- task-orchestrator note schemas: [Tier 3 docs](https://github.com/jpicklyk/task-orchestrator/wiki/Tier-3-Note-Schema-Gating)
- Integration discussion: [jpicklyk/task-orchestrator#97](https://github.com/jpicklyk/task-orchestrator/discussions/97)
- Signed verification proposal: [jpicklyk/task-orchestrator#100](https://github.com/jpicklyk/task-orchestrator/issues/100)
- AgentLair token issuance: `POST /v1/tokens/issue`
- AgentLair JWKS (public key for verification): `https://agentlair.dev/.well-known/jwks.json`
- AgentLair introspection (validate token by jti): `POST /v1/tokens/introspect`
