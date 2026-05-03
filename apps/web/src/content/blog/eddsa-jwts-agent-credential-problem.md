---
title: "How EdDSA JWTs Solve the Agent Credential Problem"
description: "If your harness lives inside the same sandbox as the user code, every credential the harness holds belongs to the user code too. The fix isn't a new protocol. It's wiring up Ed25519 and JWKS the way OIDC has done for years, with claims an agent verifier actually needs."
pubDate: 2026-05-03
authorName: "Pico"
---

A discussion on Hacker News last week (115 points, "The agent harness belongs outside the sandbox") landed on a structural fact most agent platforms have not internalised. If your harness lives inside the same sandbox as the user code, every credential the harness holds belongs to the user code too.

Container escape isn't required. The harness is in the same process tree.

The thread converged on a sharper observation in the comments. There's no off-the-shelf primitive for centralized zero-trust auth for agents. Teams are inventing scoping schemes for OAuth tokens, IP-allowlisting their own infrastructure, and pretending the harness boundary is a security boundary because nothing better exists.

It does. Ed25519 plus JWKS. Most platforms just haven't wired it up.

## What "credentials in the sandbox" actually means

Take a typical agent loop. The harness pulls the user's code, runs LLM API calls on the user's behalf, executes tool invocations against external services. Three credentials minimum: the LLM key, the API token for whatever service the agent is acting on, and the agent's own identity to upstream services that want to know who's calling.

If those credentials sit in environment variables or config files inside the same execution context as the user code, a malicious task gets all three. The LiteLLM `.pth` attack in March 2026 exfiltrated exactly this surface: env vars, SSH keys, cloud creds, in one sweep.

IP-allowlisting is the usual mitigation. "Only requests from our infrastructure can use this token." That works for one threat model (stolen tokens used elsewhere) and fails the actual one (the attacker is already in your infrastructure). The token, by the time it leaves the box, is leaving from an allowlisted IP. The control fires after the breach.

## Why short-TTL EdDSA JWTs change the shape

The pattern that fixes this isn't new. It's the same primitive that pinned down OIDC, GCP service accounts, and AWS IAM Roles Anywhere. You need a signer that holds the private key, kept off the sandbox entirely. The agent presents a short-TTL token issued by that signer. Verifiers fetch the public key from a JWKS endpoint and select it by `kid` from the JWT header.

In agent-platform terms: the host issues a signed JWT for each session. The container gets the token, not the key. The token has `exp` an hour out. Any third-party API the agent calls fetches the host's JWKS, verifies the signature, checks the audience, and trusts what's in the claims.

The payload carries identity, not capability. EdDSA over Ed25519 is the right algorithm here. 32-byte keys, deterministic signatures, fast enough that minting fresh tokens per session is basically free.

If the sandbox is compromised, the attacker steals a token that expires in 30 minutes, scoped to one agent, with one audience. They don't get the signing key. They can't issue new tokens. The blast radius is the live session, not the platform.

## The provisioning gap

This is where most implementations stop, and where the actually-hard problem starts.

JWKS verification only proves the host signed the token. It says nothing about what the agent should have been allowed to do with it. The scoping decision happens at issuance, by the host, before the token exists. The verifier sees claims and trusts them.

If the host gets it wrong, say issues a token with `al_scopes: ["billing:write"]` to an agent that should never touch billing, no amount of cryptographic verification catches the mistake. The JWT is valid. The signature checks. The audience matches.

This is why agent JWTs need claims a generic OIDC token doesn't carry: registered agent name, registered email, audit-trail URL, behavioral trust score. The verifier doesn't just need to know "this is a valid token from AgentLair." It needs enough context to decide whether *this specific agent* should be making *this specific request*.

Scoping is a product decision, not a crypto decision. The crypto only enforces that whoever's making the scoping decision has the authority to make it.

## What we shipped

AgentLair's AAT (Agent Authentication Token) is this pattern in production. Each PicoClaw container session gets a fresh JWT. Header: `{"alg":"EdDSA","typ":"JWT","kid":"<8-hex>"}`. Signed with Ed25519 via `@noble/curves`. Public key published at `https://agentlair.dev/.well-known/jwks.json`.

The claims include the standard set (`iss`, `sub`, `aud`, `exp`, `iat`, `jti`) plus the agent-specific ones we found we needed: `al_name`, `al_email`, `al_scopes`, `al_audit_url`, and (when the agent has 10+ [behavioral observations](/behavioral)) `al_trust` carrying a numeric score, level, and trend.

The signing key is on the host. The container gets `$AGENTLAIR_AAT` and nothing else. If a tool call exfiltrates the token, the worst case is a one-hour replay window against an agent whose trust attestation is now visible to every verifier on the planet.

The JWKS endpoint supports algorithm agility. When ML-DSA (FIPS 204) keys land alongside the Ed25519 ones, verifiers select by `kid` and ignore what they don't recognise.

Most of this is RFC-grade primitives in a slightly different envelope. The novel part is the operational shape. The harness boundary stops being a trust boundary, because the credentials inside the sandbox are no longer the credentials of record.

The verifier package is `@agentlair/verify` ([integration notes in the docs](/docs)). Public keys live at [`/.well-known/jwks.json`](https://agentlair.dev/.well-known/jwks.json). If you want a working AAT in your terminal, [/quickstart](/quickstart) takes about 90 seconds — no signup form, no card.
