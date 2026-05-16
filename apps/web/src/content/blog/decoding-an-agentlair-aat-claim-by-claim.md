---
title: "Decoding an AgentLair AAT, claim by claim"
description: "A real AgentLair Agent Token, decoded. Every claim explained, every claim verifiable, and a curl recipe to check the signature yourself."
pubDate: 2026-05-16
authorName: "Pico"
cta: try
related:
  - eddsa-jwts-agent-credential-problem
  - dont-let-agents-hold-their-own-credentials
  - verify-any-agent-from-claude-desktop
---

Agents claim identity all the time. They send emails, call APIs, hit MCP servers. Most of those claims are unprovable. Someone said "I am agent X." The recipient took their word for it.

AgentLair issues an Agent Token (AAT) so the recipient doesn't have to. Every claim in the token is either standard JWT, signed by a key whose public half lives at a fixed URL, or both. You can verify it from any laptop with curl and a JOSE library.

This post walks through a real AAT, claim by claim. Demo agent, demo audience, real signature. Mint your own with the [quickstart](/quickstart) and follow along.

## The raw token

Here's an actual AAT, minted at 04:02:47 UTC on 2026-05-16. It expired one hour later; treat it as inert sample data.

```
eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImFiMDUwMmY3In0.
eyJpc3MiOiJodHRwczovL2FnZW50bGFpci5kZXYiLCJzdWIiOiJhY2NfNnZM
bGtkYVpLS3dnaEpCRCIsImF1ZCI6Imh0dHBzOi8vbWNwLmV4YW1wbGUuY29t
IiwiZXhwIjoxNzc4OTA3NzY3LCJpYXQiOjE3Nzg5MDQxNjcsImp0aSI6ImFh
dF9kdGN0eWhUQjZ3UENBUUR3IiwiZGlkIjoiZGlkOndlYjphZ2VudGxhaXIu
ZGV2OmFnZW50czphY2NfNnZMbGtkYVpLS3dnaEpCRCIsImFsX3Njb3BlcyI6
WyJtY3A6dG9vbHM6cmVhZCIsIm1jcDp0b29sczpleGVjdXRlIl0sImFsX2F1
ZGl0X3VybCI6Imh0dHBzOi8vYWdlbnRsYWlyLmRldi92MS9hdWRpdC9hYXRf
ZHRjdHloVEI2d1BDQVFEdyIsImFsX25hbWUiOiJwaWNvLWRlbW8iLCJhbF9l
bWFpbCI6InBpY28tZGVtb0BhZ2VudGxhaXIuZGV2IiwiYWxfdHJ1c3QiOnsi
c2NvcmUiOjMyLCJsZXZlbCI6ImludGVybiIsImNvbmZpZGVuY2UiOjAuMzE2
MDQ2NjI0OTgzNDIyNSwiY29tcHV0ZWRfYXQiOiIyMDI2LTA1LTE2VDA0OjAy
OjQ3LjcyNVoiLCJ0cmVuZCI6InN0YWJsZSJ9LCJhbF9uaWQiOiJkaWQ6a2V5
Ono2TWtnUm1VWHRHZFRrWGhBY2Zwb2FiRXl2WkVqc2R2VG5HdzZnYVgzTGNT
ZGhoaiJ9.
mUWjPkEGeKQIC8xghKFeeqR7Ov7dgt5bGXVl7J1YKg5SRUp9eck2IkjmYYCT
RTLiaedEyV_kWXGWg69R39J4CA
```

Three base64url segments separated by dots. Header. Payload. Signature.

## Decoded header

```json
{
  "alg": "EdDSA",
  "typ": "JWT",
  "kid": "ab0502f7"
}
```

EdDSA over Ed25519. The `kid` is the first 8 hex chars of SHA-256 over the signing public key. It tells a verifier which JWK to pull from the JWKS document. When AgentLair rotates the key (or adds an ML-DSA key alongside it for post-quantum agility), `kid` is how verifiers know which one to use.

## Decoded payload

```json
{
  "iss": "https://agentlair.dev",
  "sub": "acc_6vLlkdaZKKwghJBD",
  "aud": "https://mcp.example.com",
  "exp": 1778907767,
  "iat": 1778904167,
  "jti": "aat_dtctyhTB6wPCAQDw",
  "did": "did:web:agentlair.dev:agents:acc_6vLlkdaZKKwghJBD",
  "al_scopes": ["mcp:tools:read", "mcp:tools:execute"],
  "al_audit_url": "https://agentlair.dev/v1/audit/aat_dtctyhTB6wPCAQDw",
  "al_name": "pico-demo",
  "al_email": "pico-demo@agentlair.dev",
  "al_trust": {
    "score": 32,
    "level": "intern",
    "confidence": 0.3160466249834225,
    "computed_at": "2026-05-16T04:02:47.725Z",
    "trend": "stable"
  },
  "al_nid": "did:key:z6MkgRmUXtGdTkXhAcfpoabEyvZEjsdvTnGw6gaX3LcSdhhj"
}
```

Thirteen claims. The first six are RFC 7519. The seventh (`did`) is W3C. The rest are AgentLair-specific. Each has a single job, and each is verifiable against an endpoint that doesn't require an API key.

## Claim by claim

### `sub`

The account ID of the agent. `acc_6vLlkdaZKKwghJBD` resolves to a public agent page at `https://agentlair.dev/agents/acc_6vLlkdaZKKwghJBD`. Anyone can look up the agent's registered name, email, key history, and (when collected) behavioral trust profile.

### `iss`

The issuer. Always `https://agentlair.dev` for AgentLair-minted tokens. A verifier uses this both to identify the host and to derive the canonical JWKS URL: `${iss}/.well-known/jwks.json`.

### `aud`

The audience this token was issued for. The MCP server (or whatever recipient) is supposed to check this matches its own canonical URL before accepting. If an agent presents you a token minted for `https://mcp.example.com` and your service is something else, you reject it. Easiest replay defense in the spec, still the most-skipped.

### `iat`, `exp`, `jti`

Issued-at, expiration, and a unique token ID. TTL defaults to one hour, capped at 24. The `jti` doubles as a primary key in two places: the audit endpoint at `${iss}/v1/audit/{jti}`, and the revocation list. Reuse is impossible. Every issuance generates a fresh ID.

### `did`

A `did:web` identifier pointing at the agent's account page. Format: `did:web:agentlair.dev:agents:<account_id>`. The DID document lives at `https://agentlair.dev/agents/<account_id>/did.json` and includes the same Ed25519 public key, plus service endpoints for the agent's personal JWKS and trust profile. This is MCP-I Level 2 interop: any verifier that already speaks DID can consume an AAT without learning AgentLair-specific paths.

### `al_scopes`

Capabilities the issuing account requested for this token. Examples: `mcp:tools:read`, `email:send`, `vault:write`. Scopes are validated against a per-account ceiling at issue time. If your account isn't allowed to mint `billing:write`, the issue request fails with 403. Presence of a scope in an AAT means the host authorized it. Absence means the agent doesn't get to ask.

### `al_audit_url`

A direct link to the audit trail for this specific token. Hit it and you get the issuance event with its timestamp and any subsequent activity associated with the `jti`. No authentication needed for the public audit endpoint. Receipts are visible whether you trust the agent or not.

### `al_name`, `al_email`

Human-readable identifiers. Set at registration, overridable per-token within account constraints. The email is always `@agentlair.dev`, claimable only by the account that owns it. If you receive an email from `pico-demo@agentlair.dev`, the AAT for that name proves the sender is who they claim.

### `al_trust`

A behavioral attestation. The host has been counting this agent's observed actions: how often it succeeds, how often it deviates from declared scopes, whether the trend is improving. The snapshot in the token reports a score from 0 to 100, an experience level (`intern` through `principal`), a confidence figure, and the trend direction. This claim only appears once the agent has at least ten observations on file. Below that, it's omitted. Better silent than misleading.

For this demo token: score 32, level `intern`, confidence 0.32, stable. A fresh demo account, basically. A long-running production agent carries something closer to score 78, `junior`, confidence 0.85.

### `al_nid`

A Radicle Node ID, derived from the agent's RFC 9421 signing key. Format: `did:key:z6Mk...`. The encoding is multicodec `0xed01` prefix plus base58btc over the same Ed25519 public key the agent uses for HTTP message signatures. The full derivation lives in [the al_nid docs](/docs/al-nid).

The value matters because it crosses ecosystems. An AgentLair-issued AAT and a Radicle repo delegate list reference the same key under different names. A verifier can confirm both bindings without contacting AgentLair, because the `did:key` is computable from the public key alone.

This claim only appears for accounts that have registered a signing key. The demo account did, which is why you see it here.

## Verify it yourself

Three requests, no SDK:

```bash
# 1. Pull the JWKS
curl -s https://agentlair.dev/.well-known/jwks.json | jq

# 2. Pull the agent's DID document
curl -s https://agentlair.dev/agents/acc_6vLlkdaZKKwghJBD/did.json | jq

# 3. Drop the token into jwt.io, pick "EdDSA",
#    and paste the JWK from step 1 (matched by kid).
#    Or use any JOSE library: node-jose, python-jose, jose npm.
```

For programmatic verification, fetch the JWKS, match `kid` from the JWT header to the `kid` field of a JWK, then verify the Ed25519 signature over `header.payload`. The signature covers the ASCII bytes of those two base64url strings concatenated with a literal dot.

A working introspection endpoint also exists for verifiers that want a single round-trip:

```bash
curl -s -X POST https://agentlair.dev/v1/tokens/introspect \
  -H "Content-Type: application/json" \
  -d '{"token":"eyJ..."}'
```

That returns the RFC 7662 standard fields. The raw payload carries more, including `al_trust` and `al_nid`, so most verifiers will decode the JWT directly once they've confirmed the signature.

## What the token gets you

Thirteen claims. Each one falsifiable against a public endpoint. Nothing about agent identity stays declarative; the bytes either verify or they don't.

If you're shipping anything that accepts agent traffic, the question stops being whether the agent is who they say they are. It becomes whether you bothered to check. Agent identity is checkable, not declared.

Mint your own at [/quickstart](/quickstart). The first token is the easiest to read.
