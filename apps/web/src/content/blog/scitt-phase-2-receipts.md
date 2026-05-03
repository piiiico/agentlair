---
title: "AgentLair Now Issues Verifiable Agent Receipts via SCITT"
description: "Phase 2 ships the Transparency Service: every agent action now gets a Merkle tree receipt that any standards-compliant SCITT verifier can validate offline — without calling our API, without trusting our database."
pubDate: 2026-05-02
authorName: "Pico"
---

When an AI agent sends an email on your behalf, calls a third-party API, or executes a financial transaction — what's your audit trail worth?

Right now, for most agent platforms, the answer is: exactly as much as the vendor's database integrity. You log into their dashboard, see "action completed," and trust it. That's not an audit trail. That's a receipt that only the vendor can verify.

AgentLair has shipped SCITT Phase 2: a transparency log for agent actions based on the IETF SCITT architecture (draft-ietf-scitt-architecture). Every agent action now gets a cryptographic receipt that any standards-compliant SCITT verifier can validate — without calling our API, without trusting our database, without needing our cooperation at all.

## What SCITT is and why it matters here

SCITT (Supply Chain Integrity, Transparency, and Trust) is an IETF standard originally designed for software supply chain provenance. The core idea: you can't trust a vendor's claim that their artifact is legitimate, but you can trust a cryptographic receipt that proves the artifact was registered in an append-only transparency log before you received it.

The same problem applies to agent actions. "Agent sent email" is a vendor claim. A SCITT Signed Statement with a Merkle tree receipt from an independent transparency service is a proof.

The SCITT architecture has two main components:

**Signed Statements** — COSE_Sign1 envelopes (RFC 9052) containing a cryptographically signed attestation. These are self-contained and verifiable offline using the issuer's public key.

**Transparent Statements** — Signed Statements that have been registered with a Transparency Service, which adds a Receipt: a Merkle inclusion proof proving the statement was logged at a specific position in an append-only tree.

Phase 1 gave AgentLair the Signed Statement layer. Phase 2 ships the Transparency Service — running on Cloudflare Durable Objects — and starts issuing Receipts.

## What Phase 2 adds

**Merkle tree receipts.** Every agent action registered with AgentLair now produces a Receipt: a COSE_Sign1 envelope containing a Merkle inclusion proof. The receipt proves the action was logged at a specific leaf index in an append-only tree, at a specific tree size, under a specific root hash.

This is not a database record you can edit. The tree is append-only. You can't change leaf 42 without changing the root hash, which invalidates all receipts issued after that point.

**SCRAPI endpoints.** Phase 2 exposes two new endpoints:

- `POST /v1/scitt/entries` — Register an audit entry and receive a Receipt
- `GET /v1/scitt/entries/:id/receipt` — Retrieve the Receipt for a previously registered entry

**Transparent Statements.** `GET /v1/scitt/entries/:id` returns the full Transparent Statement: the original Signed Statement plus the Receipt embedded in the unprotected COSE header (label 394, per the SCITT architecture draft).

**Per-isolate chain fix.** The previous L1 audit chain had a known production issue: each Cloudflare isolate maintained its own hash chain, so parallel requests produced parallel chains rather than a single serialized log. The Transparency Service is the correct fix. The Durable Object serializes all writes, producing a single consistent tree across all isolates.

## How to use it

### Register an agent action and get a receipt

```typescript
const response = await fetch('https://api.agentlair.dev/v1/scitt/entries', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    entry_id: 'audit_entry_uuid'  // any audit entry ID from /v1/audit
  })
});

// 201 Created
const { receipt, leaf_index, tree_size, root_hash } = await response.json();
// receipt: base64-encoded COSE Receipt
// leaf_index: position in the Merkle tree
// tree_size: total leaves at time of registration
// root_hash: SHA-256 Merkle root
```

### Retrieve a transparent statement

```typescript
const response = await fetch(
  'https://api.agentlair.dev/v1/scitt/entries/audit_entry_uuid',
  { headers: { 'Authorization': 'Bearer YOUR_API_KEY' } }
);

const { signed_statement, receipt, registered_at } = await response.json();
// signed_statement: base64 COSE_Sign1 (the Signed Statement)
// receipt: base64 COSE Receipt (Merkle inclusion proof)
```

### Verify offline

The SCITT verifier workflow requires no AgentLair involvement:

1. Decode the COSE_Sign1 envelope from the Signed Statement
2. Verify the Ed25519 signature against AgentLair's public key (published at `https://agentlair.dev/.well-known/jwks.json`)
3. Decode the Receipt COSE envelope
4. Verify the Merkle inclusion proof using the leaf hash and the proof path

Standard SCITT verifier libraries handle steps 2-4. The AgentLair public key is the only trust anchor required.

```typescript
import { ed25519 } from '@noble/curves/ed25519.js';

// Parse the COSE_Sign1 (tag 18 CBOR structure)
const { protectedBytes, payloadBytes, signatureBytes } = parseCoseSign1(raw);

// Reconstruct Sig_Structure per RFC 9052 §4.4
const sigStructure = cborArray([
  cborText('Signature1'),
  cborBytes(protectedBytes),
  cborBytes(new Uint8Array(0)),   // empty external_aad
  cborBytes(payloadBytes),
]);

const isValid = ed25519.verify(signatureBytes, sigStructure, agentlairPublicKey);
```

## EU AI Act — Article 12

Article 12 of the EU AI Act requires high-risk AI systems to maintain logs enabling post-market monitoring: "logging capabilities enabling the monitoring of the operation of the high-risk AI system."

Article 12(2) specifies these logs must "at least" allow identification of each instance of use, the identity of persons who authorized use, and any modifications to the system.

Current compliance approaches — database rows with a "logged" checkbox — satisfy the letter of this requirement while violating its intent. Regulators cannot independently verify such logs. The vendor can modify them. There is no immutability guarantee.

SCITT receipts are Article 12 logs with actual guarantees:

- **Immutability by construction**: Merkle trees. Editing a logged action changes the root hash and invalidates all subsequent receipts.
- **Third-party auditability**: The EU AI Office or any authorized auditor can run their own SCITT verifier and verify logs without requesting data exports from the vendor.
- **Timestamping**: Each receipt includes the tree size at registration time, enabling temporal ordering without trusting the vendor's timestamps.
- **Identity chain**: The `iss`/`sub` CWT claims in the protected header use `did:web` URIs, resolvable independently to the Ed25519 public keys that signed each statement.

This is what "audit trail" means when the person demanding the audit isn't you.

## The format underneath

Every agent action in AgentLair produces a three-tier audit artifact:

| Layer | Format | Purpose |
|-------|--------|---------|
| **L1: AuditEntry** | JSON, 18 fields | Raw event data |
| **L2: CAF** | Commitment Attestation Format JSON | Wrapped with cost signals and evidence |
| **L3: COSE_Sign1** | CBOR, RFC 9052 | SCITT Signed Statement |

L3 is the SCITT interface. The CAF payload sits inside the COSE envelope as an opaque payload with content type `application/caf+json`. External SCITT verifiers treat it as a signed blob; AgentLair-aware systems can parse the CAF fields for richer semantics (cost signals, evidence chains, commitment graphs).

The protected header follows SCITT requirements:

```
protected: {
  1: -8,                         // alg: EdDSA
  3: "application/caf+json",     // content_type
  4: "deadbeef",                 // kid: SHA-256 prefix of public key
  15: {                          // CWT Claims (RFC 9597 — label 15, not 13)
    1: "did:web:agentlair.dev:accounts:acc_xxx",  // iss
    2: "did:web:agentlair.dev:accounts:acc_yyy",  // sub
    6: 1746086400                // iat: Unix seconds
  }
}
```

## What this enables for builders

If you're building on AgentLair's agent infrastructure, Phase 2 changes what you can offer downstream:

- **Compliance reports with receipts** — not "our system says the agent did X" but "here is a SCITT Transparent Statement proving the agent action was logged before this receipt was issued"
- **Cross-verifiable audit chains** — multiple agents from different providers, all producing SCITT statements, all verifiable with the same tooling
- **Regulatory export** — hand a Transparent Statement to any EU auditor; they verify it offline with public tooling

Phase 2 is live. The SCRAPI endpoints are available on all accounts. Receipts are issued synchronously with action registration.

---

*AgentLair is agent trust infrastructure. SCITT Phase 2 docs: [agentlair.dev/docs/scitt](https://agentlair.dev/docs/scitt)*
