---
title: "AAT vs EAT: How AgentLair's Agent Attestation Token Relates to the Entity Attestation Token"
description: "Two tokens, two problems. RFC 9711 defines Entity Attestation Tokens for hardware attestation. AgentLair's AAT attests behavioral trust for AI agents. Here's how they differ and why both matter."
pubDate: 2026-05-01
draft: true
schemaType: "DefinedTerm"
---

If you've searched for "Agent Attestation Token" and landed on IETF specifications for hardware-bound entity attestation, you've found the wrong token. That confusion is why this page exists.

AgentLair's **Agent Attestation Token (AAT)** and the IETF's **Entity Attestation Token (EAT)** solve related but fundamentally different problems. One proves a device is what it claims to be. The other proves an AI agent behaves the way it should.

---

## What is an Entity Attestation Token (EAT)?

The Entity Attestation Token is defined in [RFC 9711](https://www.rfc-editor.org/rfc/rfc9711.html), published as a Standards Track document by the IETF's Remote Attestation Procedures (RATS) Working Group in April 2025.

An EAT is a set of attested claims describing the state and characteristics of an **entity** — typically a hardware device like a smartphone, IoT sensor, or network equipment. It can be encoded as either a CBOR Web Token (CWT) or a JSON Web Token (JWT).

Key characteristics of EATs:

- **Hardware-rooted trust.** The attestation key is typically protected by a Trusted Platform Module (TPM), Secure Element, or Trusted Execution Environment (TEE). The security guarantee comes from tamper-resistant hardware.
- **Device identity.** An EAT tells a relying party what kind of device is making a request: its manufacturer, firmware version, security posture, boot state.
- **Static claims.** The claims describe what the device *is* — its hardware configuration, its software version, its security certification level. These change infrequently.
- **Profile-based.** RFC 9711 defines a profile mechanism for specific use cases. [PSA Certified](https://www.psacertified.org/blog/what-is-an-entity-attestation-token/) uses EAT profiles for Arm device attestation.

EATs answer the question: **"Is this device authentic and in a known-good state?"**

---

## What is an Agent Attestation Token (AAT)?

AgentLair's AAT is a signed JWT (Ed25519/EdDSA) that an AI agent presents to external services to prove its identity and behavioral trustworthiness. It's issued by AgentLair's identity provider and verifiable via a public [JWKS endpoint](https://agentlair.dev/.well-known/jwks.json).

Key characteristics of AATs:

- **Behavioral trust, not hardware trust.** The attestation key is held by AgentLair's infrastructure, not by a TPM. Trust comes from observed behavior over time, not from tamper-resistant silicon.
- **Agent identity.** An AAT identifies a specific AI agent: its account, its operator, its scopes, and — when sufficient behavioral data exists — its trust score.
- **Dynamic claims.** AATs can embed an `al_trust` claim that reflects the agent's current behavioral profile: a trust score (0–100), maturity level (intern through principal), confidence interval, and trend direction. These claims change as the agent operates.
- **Short-lived.** AATs have a default TTL of 1 hour (max 24 hours), compared to device attestations that may be valid for days or weeks.

AATs answer a different question: **"Has this agent been behaving normally, and should I trust its current request?"**

---

## Side-by-side comparison

| | Entity Attestation Token (EAT) | Agent Attestation Token (AAT) |
|---|---|---|
| **Specification** | [RFC 9711](https://www.rfc-editor.org/rfc/rfc9711.html) (IETF Standards Track) | AgentLair protocol (open specification) |
| **Trust root** | Hardware (TPM, TEE, Secure Element) | Behavioral observation over time |
| **Subject** | Physical device or firmware | AI agent (software process) |
| **Encoding** | CWT or JWT | JWT (EdDSA/Ed25519) |
| **Key protection** | Tamper-resistant hardware | AgentLair infrastructure + JWKS |
| **Claims model** | Static (device type, firmware, boot state) | Dynamic (trust score, maturity, trend) |
| **Typical TTL** | Hours to days | 1 hour (default) |
| **Verification** | Vendor-specific or profile-specific | JWKS at `/.well-known/jwks.json` |
| **Primary question** | "Is this device authentic?" | "Is this agent trustworthy right now?" |

---

## Where the IETF agent-identity landscape sits

Beyond RFC 9711, several IETF drafts address AI agent authentication and attestation directly:

**[draft-klrc-aiagent-auth-00](https://datatracker.ietf.org/doc/html/draft-klrc-aiagent-auth-00)** — "AI Agent Authentication and Authorization," published March 2026. The broadest consensus draft, authored by contributors from Defakto, AWS, Zscaler, and Ping Identity. It focuses on OAuth 2.0 extensions for agent delegation chains and explicitly calls out the token-forwarding anti-pattern.

**[draft-yakung-oauth-agent-attestation-00](https://datatracker.ietf.org/doc/draft-yakung-oauth-agent-attestation/)** — the Agent Credential Attestation Protocol (ACAP), published March 2026. Defines short-lived JWTs (RS256) for agent pipelines, with scope-limited permissions and a SHA-256 hash of the originating human instruction. Supports delegated credentials with narrowing scope and depth counting.

**[draft-niyikiza-oauth-attenuating-agent-tokens-00](https://datatracker.ietf.org/doc/draft-niyikiza-oauth-attenuating-agent-tokens/)** — Attenuating Authorization Tokens for Agentic Delegation Chains. Focuses on how permissions narrow as agents delegate to sub-agents.

These drafts address **authentication and authorization** — proving *who* an agent is and *what* it's allowed to do. AgentLair's AAT adds a third dimension: *how* the agent has been behaving. An AAT can carry an embedded trust attestation (`al_trust`) that no pure auth token provides, because it requires continuous behavioral observation to compute.

---

## How they work together

EAT and AAT are not competitors. They operate at different layers:

1. **Hardware layer:** An EAT proves the device running the agent is authentic and uncompromised.
2. **Identity layer:** An OAuth token or ACAP credential proves the agent is authorized to act.
3. **Behavioral layer:** An AAT proves the agent has been operating within normal parameters.

A well-designed agent infrastructure could use all three. The device presents an EAT to prove its hardware integrity. The agent obtains an OAuth token for authorization. And it presents an AAT to prove its behavioral trustworthiness — that it hasn't exhibited anomalous tool-call patterns, velocity spikes, or scope violations.

The behavioral layer is what's missing from the current standards conversation. Authentication tells you who's asking. Attestation tells you whether they're acting right.

---

## Verifying an AAT

Any service can verify an AAT without contacting AgentLair:

1. Fetch the JWKS from `https://agentlair.dev/.well-known/jwks.json`
2. Match the `kid` in the JWT header to a key in the JWKS
3. Verify the Ed25519 signature
4. Check standard JWT claims (`exp`, `iss`, `aud`)
5. Optionally inspect `al_trust` for the agent's current behavioral profile

The JWKS endpoint returns Ed25519 public keys in JWK format (`kty: "OKP"`, `crv: "Ed25519"`). Verifiers select the key by `kid`, not by position.

```json
{
  "keys": [{
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "<base64url-public-key>",
    "kid": "a1b2c3d4",
    "use": "sig",
    "alg": "EdDSA"
  }]
}
```

---

## Further reading

- [RFC 9711: The Entity Attestation Token (EAT)](https://www.rfc-editor.org/rfc/rfc9711.html)
- [IETF RATS Working Group](https://datatracker.ietf.org/wg/rats/about/)
- [PSA Certified: What is an Entity Attestation Token?](https://www.psacertified.org/blog/what-is-an-entity-attestation-token/)
- [Behavioral Health Certificate specification](/learn/behavioral-health-certificate)
- [Verify an AI agent without identity-proofing the human](/learn/verify-agent-without-identity-proofing)
