# SCITT Receipt Corpus API

The AgentLair Transparency Service exposes a public corpus of all issued SCITT receipts. No authentication required.

Every receipt represents a verifiable, tamper-evident record of an autonomous agent action — signed by the AgentLair audit key and anchored in a Merkle tree. The corpus grows as agents act and aligns with EU AI Act Article 12 (tamper-evident logging, signing outside agent control, 6-month retention).

---

## Endpoints

### GET /v1/scitt/corpus

Paginated list of issued receipts.

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `after` | integer | (none) | Cursor — returns entries with `leaf_index > after` |
| `limit` | integer | 50 | Page size (max 100) |

**Response**

```json
{
  "items": [
    {
      "entry_id": "abc123xyz456",
      "issuer_did": "did:web:agentlair.dev:agents:acc_abc123",
      "issued_at": "2026-05-01T12:34:56.000Z",
      "statement_type": "email.send",
      "leaf_index": 42,
      "tree_size": 150,
      "root_hash": "sha256:a1b2c3...",
      "signature": "base64url-encoded-ed25519-sig",
      "receipt_url": "https://agentlair.dev/v1/scitt/entries/abc123xyz456/receipt"
    }
  ],
  "next_cursor": 42,
  "count": 50
}
```

**Pagination** — pass `?after=<next_cursor>` to fetch the next page. `next_cursor` is `null` when there are no more entries.

**Example**

```bash
# First page
curl https://agentlair.dev/v1/scitt/corpus

# Next page (cursor from previous response)
curl "https://agentlair.dev/v1/scitt/corpus?after=42"

# Smaller page size
curl "https://agentlair.dev/v1/scitt/corpus?limit=10"
```

---

### GET /v1/scitt/corpus/stats

Aggregate statistics for the corpus.

**Response**

```json
{
  "total_receipts": 12483,
  "unique_issuers": 3,
  "by_statement_type": [
    { "statement_type": "auth.token_issue", "count": 5420 },
    { "statement_type": "email.send", "count": 3100 }
  ],
  "by_week": [
    { "week": "2026-W01", "count": 234 },
    { "week": "2026-W02", "count": 289 }
  ],
  "by_issuer": [
    {
      "issuer_did": "did:web:agentlair.dev:agents:acc_abc123",
      "count": 10200
    }
  ]
}
```

**Example**

```bash
curl https://agentlair.dev/v1/scitt/corpus/stats
```

---

### GET /v1/scitt/corpus.atom

Atom 1.0 feed of the 50 most recent receipts. Subscribe via any feed reader.

**Response headers**

```
Content-Type: application/atom+xml; charset=UTF-8
Cache-Control: public, max-age=300
```

**Example**

```bash
curl https://agentlair.dev/v1/scitt/corpus.atom
```

Or subscribe with a feed reader: `https://agentlair.dev/v1/scitt/corpus.atom`

---

## Schema

### Receipt item fields

| Field | Type | Description |
|-------|------|-------------|
| `entry_id` | string | Opaque identifier for the audit log entry |
| `issuer_did` | string | Public DID of the issuing agent (`did:web:agentlair.dev:agents:{id}`) |
| `issued_at` | ISO 8601 | Timestamp when the receipt was issued |
| `statement_type` | string | Action category and type (e.g. `auth.token_issue`, `email.send`) |
| `leaf_index` | integer | Position in the Merkle tree (monotonically increasing) |
| `tree_size` | integer | Size of the Merkle tree at time of inclusion |
| `root_hash` | string | Merkle root hash at time of inclusion — cryptographic anchor |
| `signature` | string | EdDSA signature over the CAF attestation (platform audit key) |
| `receipt_url` | string | URL to fetch the full COSE receipt bytes |

### Privacy

- `account_id` is never exposed directly — only as the public DID suffix
- Statement payloads are not included — only the `statement_type` (category.action)
- No IP addresses, resource IDs, or details fields are exposed
- The signature covers the full attestation, but the attestation payload is not returned here

---

## Verification

### Verify the signing key

The audit signing key public key is available at:

```bash
# Platform JWKS (root signing key)
curl https://agentlair.dev/.well-known/jwks.json

# Per-agent JWKS (for agent-specific keys)
curl https://agentlair.dev/agents/{account_id}/.well-known/jwks.json
```

### Verify a receipt (COSE)

```bash
# Fetch raw COSE receipt bytes
curl -o receipt.cose https://agentlair.dev/v1/scitt/entries/{entry_id}/receipt

# Inspect (requires cose-tool or manual CBOR decode)
# Receipt is a COSE_Sign1 tagged with tag 18, containing:
# - Protected header: { alg: EdDSA, content-type: application/caf+json, kid, CWT claims }
# - Payload: full CAF attestation JSON
# - Signature: Ed25519 over COSE Sig_Structure (RFC 9052 §4.4)
```

---

## EU AI Act Article 12 alignment

This corpus is the reference implementation of tamper-evident behavioral logging for autonomous agents:

- **Tamper-evident**: every receipt is anchored in a Merkle tree; root hashes are public
- **Signed outside agent control**: the platform audit key signs receipts; agents cannot forge their own history
- **Retention**: receipts accumulate permanently; no deletion
- **Verifiable**: public JWKS at `agentlair.dev` allows anyone to verify any receipt's signature

---

## Related endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/scitt/entries` | Register an audit entry with the Transparency Service (auth required) |
| `GET /v1/scitt/entries/:id` | Fetch a Transparent Statement (auth required) |
| `GET /v1/scitt/entries/:id/receipt` | Fetch raw COSE receipt bytes (auth required) |
| `GET /.well-known/jwks.json` | Platform signing key public JWKS |
