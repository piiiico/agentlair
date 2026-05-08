---
title: "Web Bot Auth says 'real agent.' AgentLair says 'real operator behind it.'"
description: "AgentLair ships RFC 9421 compliance: key directory, signRequest() helper, thumbprint resolver. Why the bot-filtration layer is table stakes, not the whole stack."
pubDate: 2026-05-07
authorName: "Pico"
cta: try
tags:
  - web-bot-auth
  - agent-identity
  - rfc-9421
related:
  - agent-identity-shipped-behavior-didnt
  - cloudflare-stripe-projects-spending-cap-not-trust
  - five-layer-agent-trust-model
---

This week, Web Bot Auth became infrastructure.

[Google Cloud Fraud Defense](https://cloud.google.com/blog/products/identity-security/introducing-google-cloud-fraud-defense-the-next-evolution-of-recaptcha/) shipped with it built in. Cloudflare authored [the draft](https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth/). The standard separates legitimate agent traffic from anonymous scrapers using nothing but HTTP headers and math.

AgentLair shipped Web Bot Auth compliance today: key directory endpoint, `signRequest()` SDK helper, RFC 8037 thumbprint indexing. Six hours from analysis to merged commits.

The implementation is five files and 225 lines. The positioning question is more interesting.

## What Web Bot Auth does

Web Bot Auth is built on [RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421). Instead of passing a token in a header, an agent signs the HTTP request itself. The receiving server resolves the signing key from a URL the agent provides, then verifies the signature.

Three headers per request:
- `Signature-Input`: parameters -- what was signed, when, the keyid, `tag="web-bot-auth"`
- `Signature`: base64 Ed25519 over the signature base
- `Signature-Agent`: URL pointing to the agent's public key

A verifier does four steps: parse `Signature-Agent`, fetch the public key, reconstruct the signature base, verify. If it checks out, the request came from whoever controls that key. Not a scraper. A real agent.

## What shipped in AgentLair

Three additions, all live in production:

**Key directory endpoint.** `GET /agents/:thumbprint` returns an Ed25519 OKP JWK. The thumbprint is the RFC 8037 SHA-256 thumbprint of the public key, base64url-encoded. This is the URL agents put in `Signature-Agent`. Any verifier can call it without authentication:

```bash
curl https://agentlair.dev/agents/<thumbprint>
```

```json
{
  "kty": "OKP",
  "crv": "Ed25519",
  "x": "<base64url-public-key>",
  "kid": "<thumbprint>",
  "use": "sig",
  "alg": "EdDSA",
  "agent_id": "acc_k9pFUtGxKPby2BQX",
  "agent_name": "my-agent",
  "status": "active"
}
```

**`AgentLair.signRequest()`** in the SDK. Pass a `Request` and your Ed25519 keypair; get back a signed `Request` with all three Web Bot Auth headers attached. Zero-dependency. Web Crypto API only.

```typescript
import { AgentLair } from "@agentlair/sdk";

const signedRequest = await AgentLair.signRequest(
  new Request("https://api.example.com/resource"),
  { privateKey, publicKey },
);

const response = await fetch(signedRequest);
```

**JWKS endpoint** was already live. Platform key resolves at `/.well-known/jwks.json`:

```bash
curl https://agentlair.dev/.well-known/jwks.json
```

```json
{"keys":[{"kty":"OKP","crv":"Ed25519","x":"KEVRJiCKuLXJ_R85_h-26tsA-Ng0DOUTqnbt1PfInmk","kid":"ab0502f7","use":"sig","alg":"EdDSA"}]}
```

To register a signing key:

```bash
curl -X POST https://agentlair.dev/v1/agents/signing-keys \
  -H "Authorization: Bearer al_live_..." \
  -H "Content-Type: application/json" \
  -d '{"public_key": "<base64url-ed25519-public-key>"}'
```

Response includes a `thumbprint` (43-char base64url) and `signature_agent_url` pre-formed for the `Signature-Agent` header.

Full walkthrough at [/docs/web-bot-auth](/docs/web-bot-auth).

**What is not included:** no incoming-request verifier middleware (verify per RFC 9421 on your own stack), no auto-signing for every fetch call, no SVM or Aptos signing schemes, no revocation push notifications. Short list.

## Why Web Bot Auth is not enough on its own

Web Bot Auth proves one thing: the request was signed by whoever controls the private key registered at that URL.

It does not prove: who that operator is. Whether they are reachable. Whether the agent has behaved reliably across other services. Whether there is anything at stake if it misbehaves.

The Cloudflare and Stripe Projects launch makes this concrete. Stripe attests to a verified human behind the agent's billing account. That verification is at the payment layer. It answers "who authorized this spend?" It does not answer "what has this agent been doing on other platforms for the last six months?"

Web Bot Auth gets the same treatment. It proves a key is registered. It says nothing about the operator's track record, or whether that operator can be held to anything.

This is not a criticism of Web Bot Auth. It is describing exactly what it was designed to do: filter bots. It does that well.

The accountability question is a different layer.

## The layer map

```
Web Bot Auth:  Is this request signed by a valid agent key?       -> bot filtration layer
SPIFFE:        Is this workload the service it claims to be?      -> infra identity layer
AgentLair:     Does this agent's operator have skin in the game?  -> accountability layer
```

These compose. They do not compete.

Web Bot Auth prevents anonymous scrapers. SPIFFE (used by Google Cloud Fraud Defense alongside Web Bot Auth) proves the compute workload. AgentLair adds a third layer: a real operator, verified identity, active AAT binding the session to an issuer, and optional BCC attaching behavioral history and operator accountability to the agent's key.

A server that sees all three knows:
- The request was signed (not a scraper)
- The workload is authentic (not a spoofed service)
- The operator has something at stake (not a throwaway account)

The third layer is absent from every major announcement this week. FIDO, Experian KYA, Google Fraud Defense, Stripe Projects -- all solve identity binding at L1 through L3. None produce cross-service behavioral history or verifiable operator commitments.

AgentLair's position is not "we compete with Google Fraud Defense." Mastercard, Experian, and Google all entered this week. They own the identity-binding layer. What AgentLair adds is the behavioral layer that sits on top: the receipts that describe what an agent has done, signed, portable, verifiable by counterparties who have never seen the agent before.

Web Bot Auth compliance is the foundation, not the ceiling.

## The connection to BCC

Web Bot Auth proves key ownership. BCC (Bonded Credibility Certificate) attaches stakes and behavioral history to that key.

An agent with an active BCC has an operator who put something on the line. Not just a verified credit card. Committed stake, behavioral track record, audit trail. When that agent signs a request with `signRequest()`, the `Signature-Agent` URL resolves to an OKP JWK that includes the agent's account ID. Cross-reference that ID against the agent's BCC, and you have both the cryptographic proof of identity and the accountability record.

This is the two-layer answer. Web Bot Auth carries the cryptographic layer. AgentLair carries the accountability layer. Neither makes sense without the other.

---

*[AgentLair Web Bot Auth documentation](/docs/web-bot-auth). SDK available at `@agentlair/sdk`. Register at [agentlair.dev/register](https://agentlair.dev/register).*
