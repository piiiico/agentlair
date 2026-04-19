---
title: "What the Vercel Incident Teaches Us About Agent Credential Management"
description: "Vercel's April 2026 breach exposed a structural problem: credentials stored in platform env vars have platform-level blast radius. For AI agents, that blast radius is dramatically larger — and short-lived scoped tokens are the fix."
pubDate: 2026-04-19
authorName: "Pico"
---

On April 19, 2026, Vercel disclosed unauthorized access to certain internal systems. Their guidance to customers: review environment variables, rotate secrets, use Vercel's "sensitive environment variable" feature if you weren't already.

That guidance lands differently when you're building AI agents.

## What Happened

Vercel experienced unauthorized access to internal systems. The incident is ongoing — Vercel has engaged external incident response experts and notified law enforcement. Services remained operational. A limited subset of customers were directly impacted and are being contacted individually.

The specifics of what was accessed aren't fully public. But the remediation advice — check your environment variables, rotate secrets — tells you something about the exposure surface. Environment variables on Vercel are the standard mechanism developers use to pass API keys, database URLs, and service credentials into deployed applications.

The "sensitive environment variable" feature Vercel recommended is a UI-level protection: it redacts values in the dashboard and CLI output. What it doesn't change is that those values are still plaintext secrets stored on Vercel's infrastructure. When the infrastructure is compromised, the UI protection is academic.

This isn't a criticism of Vercel specifically. It's the fundamental paradox of platform-stored credentials: **you can't protect secrets from a breach of the platform storing them by adding a feature on that platform.**

## Why Agents Amplify the Problem

A typical web application holds a small, fixed set of credentials: a database URL, maybe a Stripe key, a third-party API key. It loads them at startup and runs continuously in a small number of fixed environments.

An AI agent holds credentials to a different kind of surface. In a single session, an agent might authenticate to:

- An LLM provider (OpenAI, Anthropic, or both)
- A code execution environment
- The user's GitHub account
- A database
- A calendar service
- A file storage system
- Multiple downstream APIs

That's not a credential. That's a keyring.

When a credential is stored in a platform environment variable, every agent deployed to that platform inherits it. There's no scoping. A single compromised dependency in one agent's package tree exposes the keyring used by every other agent in the environment. This is credential fan-out — and it's structurally absent from how most agent frameworks think about authentication.

**Long-lived tokens make this worse.** If an API key is valid indefinitely, a breach that happened yesterday is still live today. The window between breach and discovery and rotation is the window of exposure. For platform-stored, long-lived credentials, that window has no architectural upper bound.

## What the Fix Looks Like

The structural solution has three properties:

**Short-lived.** Credentials that expire in minutes or hours limit the damage window regardless of when a breach is discovered. An attacker who exfiltrates a one-hour token has, at most, one hour of access. This is why certificate rotation, OIDC ephemeral tokens, and session-scoped credentials exist. The pattern is well-established — it just hasn't been applied to agent credential management.

**Per-session scoped.** Each agent session should have identity scoped to exactly what that session needs, issued at session start, and unusable outside that session. This limits blast radius: a compromised session exposes only what that session could access — not a shared keyring for everything running on the platform.

**Behaviorally monitored.** Short TTLs limit the time window. But within that window, behavioral signals can catch anomalies in real time — unusual call volumes, unexpected resource access, requests that don't fit the agent's declared purpose. Identity without behavioral context is still incomplete.

This is also what 12-Factor Agents describes as **Factor 12 (Stateless Reducer)**: agents as pure functions of their context, with no persistent credential state that outlives the invocation. Credentials should be issued with the context and expire with it. The agent should not be the credential store — it should be a consumer of credentials issued by a system designed to manage their lifecycle.

## How AgentLair Approaches This

AgentLair's Agent Authentication Token (AAT) architecture was designed for this threat model.

Every agent session gets a fresh AAT at initialization:

```
eyJhbGciOiJFZERTQSJ9...
```

The AAT is an EdDSA-signed JWT with a **1-hour TTL**. It carries the agent's identity as a `did:web` claim:

```json
{
  "sub": "did:web:agentlair.dev:agents:acct_abc123",
  "iat": 1745078400,
  "exp": 1745082000,
  "scope": ["email:read", "files:write"],
  "session": "sess_xyz789"
}
```

Three properties matter here:

**Short TTL.** The token expires in one hour. An attacker who exfiltrates an AAT from a running session gets, at most, the remainder of that hour. There's no long-lived credential to steal — and no need to rotate long-lived secrets after a breach because there are none.

**Per-session, per-agent scoping.** Each session gets its own token. The `scope` field contains exactly the permissions that session needs — not a superset, not a shared keyring. A compromised session cannot access what other sessions are doing. An attacker who obtains one session's AAT gets exactly one session's permissions for at most one hour.

**JWKS-verifiable.** Any downstream service can verify an AAT without calling AgentLair's API. The public key is published at `/.well-known/jwks.json`. Verification is a local operation — fast, offline-capable, and not dependent on AgentLair being reachable in the moment an agent makes a request.

The `did:web` identity gives each agent a persistent, externally resolvable identifier. Even though the token changes every session, the identity behind it is stable:

```
GET https://agentlair.dev/agents/acct_abc123/did.json
```

Any verifier that resolves `did:web` — and many do — can verify an AgentLair agent's identity without calling our API at all.

### Trust Scoring as a Second Factor

A valid token proves the credential is correct. It doesn't prove the session is behaving as expected.

AgentLair's trust scoring engine runs continuously during sessions, scoring three dimensions from the audit log: temporal consistency, scope adherence, and behavioral stability. A session with a valid AAT but anomalous behavior — calling unusual endpoints, requesting access beyond its declared scope, pattern shifts mid-session — receives a lower trust score.

Downstream services can use the trust score as a second factor in authorization decisions. A high-value operation might require both a valid AAT and a trust score above a threshold. This means an attacker who somehow obtains a valid token still faces a behavioral signal that their session doesn't match the expected pattern.

This closes the window that short TTLs alone leave open.

## The Comparison

| | Platform env vars | AgentLair AAT |
|---|---|---|
| Token lifetime | Indefinite | 1 hour |
| Scope | All agents on platform | Per-session, declared explicitly |
| Platform breach | Credentials exposed for all time | Current session's token, one hour max |
| Verifiable by | Platform only | Any JWKS-aware verifier |
| Behavioral monitoring | None | Trust score on every session |
| Factor 12 alignment | No — credentials persist in env | Yes — issued and expired with context |

## The Remediation Advice to Remember

Vercel told customers to rotate their secrets. That's the right immediate action.

The longer-term question is why those secrets are in platform environment variables at all, and how long they're valid once they're there.

For stable web applications with predictable deployment patterns, env vars are a reasonable tradeoff. For AI agents — ephemeral, high-volume, holding credentials to multiple downstream services simultaneously — the tradeoff looks different.

Platform-stored, long-lived credentials have platform-level blast radius. The Vercel incident is a clean illustration of the failure mode. Short-lived, per-session, JWKS-verifiable tokens shrink that blast radius to the session window. Behavioral monitoring during sessions shrinks the usable window further.

That's the architectural direction agent credential management is moving. The Vercel incident is a concrete illustration of why.

---

AgentLair issues AATs automatically for every agent session. They expire in one hour, carry `did:web` identity, and are verifiable without calling our API.

→ [agentlair.dev/docs/aat](https://agentlair.dev/docs/aat)
