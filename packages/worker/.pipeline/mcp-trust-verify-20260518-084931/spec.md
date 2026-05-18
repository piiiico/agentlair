# Spec: POST /v1/trust/mcp/verify — MCP Server Attestation Verifier

Pipeline: mcp-trust-verify-20260518-084931  
Branch: feat/mcp-trust-verify  
Route: POST agentlair-worker /v1/trust/mcp/verify  
Author: pico (2026-05-18)

---

## Purpose

This endpoint is the CLIENT-SIDE complement to `@agentlair/mcp-trust-attestation` (npm v0.1.0, live 2026-05-18). The npm package lets MCP servers attach attestation headers. This HTTP endpoint lets anyone (MCP clients, browser tools, CLI) verify whether a given MCP server is attested — without custom code.

User story: "I have an MCP server URL. Is it attested? Is the signature valid?"

Free public-good utility. No auth required. No x402. Mirrors `/v1/proof-of-life` in pricing model.

---

## Route Registration

File: `packages/worker/src/routes/mcp-trust-verify.ts` (NEW)

Register in `packages/worker/src/index.ts`:
- Import from `./routes/mcp-trust-verify.js`
- Mount at `/v1/trust` before auth middleware (public route, same pattern as `publicTrustRoutes`)
- Route: `app.route('/v1/trust', mcpTrustVerifyRoutes)` — handler will be at `/mcp/verify`

---

## Request Shape

```
POST /v1/trust/mcp/verify
Content-Type: application/json

{
  "url": "https://example.com"   // HTTPS URL of MCP server (max 256 chars)
}
```

Validation rules:
- `url` must be present (400 if missing)
- `url` must start with `https://` (400 if http:// or other scheme)
- `url` max 256 characters (400 if exceeded)
- SSRF guard applied BEFORE any network request (see Security section)
- Body must be valid JSON (400 if parse error)

---

## Response Shape

HTTP 200 always when discovery completed (even if verified=false). Never absorb 5xx from downstream.

```typescript
interface VerifyResponse {
  verified: boolean;          // true iff BHC-S descriptor found AND JWT signature valid
  server_id: string | null;   // from descriptor.server_id (sub claim in JWT)
  issued_at: string | null;   // ISO-8601 from descriptor JWT iat claim
  expires_at: string | null;  // ISO-8601 from descriptor JWT exp claim
  jwks_url: string | null;    // JWKS URL used for signature verification
  bhc_token_type: string | null; // token type from descriptor
  raw_descriptor: object | null; // full parsed BHC-S descriptor object (trimmed to 64KB)
  errors: string[];           // empty array when verified=true; list of failure reasons when false
}
```

Example — verified server:
```json
{
  "verified": true,
  "server_id": "agentlair.dev",
  "issued_at": "2026-05-18T00:00:00Z",
  "expires_at": "2026-05-19T00:00:00Z",
  "jwks_url": "https://agentlair.dev/.well-known/jwks.json",
  "bhc_token_type": "urn:agentlair:bhc-s:v1",
  "raw_descriptor": { "...": "full descriptor" },
  "errors": []
}
```

Example — unattested server:
```json
{
  "verified": false,
  "server_id": null,
  "issued_at": null,
  "expires_at": null,
  "jwks_url": null,
  "bhc_token_type": null,
  "raw_descriptor": null,
  "errors": ["no agentlair-trust descriptor found at /.well-known/agentlair-trust"]
}
```

---

## HTTP Semantics

| Condition | Status |
|-----------|--------|
| Discovery completed (verified or not) | 200 |
| Missing/invalid `url` field | 400 |
| Private IP rejected (SSRF) | 400 |
| Request body not valid JSON | 400 |
| Internal error (bug) | 500 |

Do NOT return 404 when the target server has no attestation — return 200 with `verified: false`.
Do NOT surface 5xx from the target server as our own 5xx — surface in `errors[]`.

---

## Discovery Flow

1. Normalize the input URL: strip trailing slash, lowercase scheme+host, preserve path.
2. SSRF guard (see Security section) — reject before any network request.
3. Cache lookup: key = `sha256(normalizedUrl)`. If HIT: return cached response with `X-Cache: HIT` header, skip steps 4–7.
4. Fetch `{normalizedUrl}/.well-known/agentlair-trust`:
   - Timeout: 5s connect, 10s total (use AbortController)
   - Follow up to 3 redirects (default fetch behavior in CF Workers)
   - Cap response body at 64KB (reject if Content-Length > 64KB or body reads > 64KB)
5. Parse response body as JSON. If parse fails: return `verified: false`, `errors: ['descriptor parse error: <msg>']`.
6. Validate BHC-S descriptor shape:
   - Must have `bhc_token_type === 'urn:agentlair:bhc-s:v1'`
   - Must have `jwks_uri` (string)
   - Must have at least one of `attestation_token` or `server_attestations` (array) to extract a JWT
   - If shape invalid: return `verified: false`, `errors: ['invalid BHC-S descriptor shape: <reason>']`
7. Extract JWT: 
   - If descriptor has `attestation_token` (string): use it directly
   - If descriptor has `server_attestations` (array): use first entry's `token` field
   - If neither: return `verified: false`, `errors: ['no attestation token in descriptor']`
8. Fetch JWKS from `descriptor.jwks_uri` (same timeouts, same 64KB cap).
9. Verify JWT signature against JWKS using `verifyJWS()` or `verifyJWT()` from `../jwt.js`.
   - The worker already has EdDSA verification via `@noble/curves` — DO NOT add a new dependency.
   - Extract `kid` from JWT header, find matching key in JWKS, verify.
   - If signature invalid: return `verified: false`, `errors: ['JWT signature verification failed']`.
10. Extract claims from verified JWT: `sub` → server_id, `iat` → issued_at, `exp` → expires_at.
11. Check expiry: if `exp` in the past, add to errors and set `verified: false`.
12. Build and cache response (5min TTL). Return with `X-Cache: MISS` header.

---

## JWT Verification

Use existing worker utilities from `../jwt.js`. The worker already implements EdDSA via `@noble/curves`.

The BHC-S attestation JWT is a JWS (compact serialization). Use `verifyJWS()` if the token is a JWS,
or `verifyJWT()` if it's a standard JWT with AATClaims-compatible payload.

To resolve the signing key from JWKS:
1. Decode the JWT header (base64url decode, JSON parse)
2. Extract `kid` from header
3. Fetch JWKS JSON from `jwks_uri`
4. Find key with matching `kid`
5. Decode `x` field (base64url) → raw Ed25519 public key bytes (32 bytes)
6. Pass to `verifyJWS(token, publicKeyBytes)` or `verifyJWT(token, publicKeyBytes)`

If no matching `kid`: try all keys in JWKS (some issuers omit kid in token).
If JWKS fetch fails: add error, set verified=false.

---

## Caching

- KV namespace binding: `TRUST_VERIFY_CACHE` (add to wrangler.toml + worker env types)
- Key: `mcp-trust-verify:v1:${sha256hex(normalizedUrl)}`
- TTL: 300 seconds (5 minutes)
- Cached value: full JSON-stringified VerifyResponse
- On cache HIT: parse stored JSON, return with `X-Cache: HIT` header
- On cache MISS: compute response, store in KV, return with `X-Cache: MISS` header
- Cache negative results too (verified: false) — saves repeated hits to dead URLs
- Do NOT cache 400 responses (input validation errors)

If KV binding is unavailable (undefined env.TRUST_VERIFY_CACHE): skip cache, proceed without caching (graceful degradation, add `X-Cache: UNAVAILABLE` header).

---

## Security

### SSRF Guard (CRITICAL — public endpoint that fetches arbitrary URLs)

Reject ALL of the following BEFORE any network request:

Private IPv4 ranges:
- 10.0.0.0/8
- 172.16.0.0/12
- 192.168.0.0/16
- 127.0.0.0/8 (loopback)
- 169.254.0.0/16 (link-local / AWS metadata)
- 0.0.0.0/8

Private IPv6 ranges:
- ::1 (loopback)
- fc00::/7 (unique local)
- fe80::/10 (link-local)

Additional blocks:
- URL scheme must be `https://` (reject `http://`, `ftp://`, `file://`, etc.)
- Reject if hostname resolves to a private IP (DNS pre-resolution where possible)
- Reject if hostname is `localhost`, `0.0.0.0`, or any `.local` domain
- Reject URLs longer than 256 characters

Error response for SSRF-blocked requests: HTTP 400, `errors: ['private IP rejected']`

### Response Size Cap

- Cap target server response at 64KB
- Use `Response.arrayBuffer()` with size check, or stream with byte counter
- If exceeded: return `verified: false`, `errors: ['descriptor response too large (max 64KB)']`

### Rate Limiting

- Use existing global rate limiter (already in worker)
- No x402 payment required — free utility

---

## KV Binding Configuration

In `wrangler.toml`, add under `[[kv_namespaces]]`:
```toml
[[kv_namespaces]]
binding = "TRUST_VERIFY_CACHE"
id = "TO_BE_FILLED_BY_DEPLOY"
preview_id = "TO_BE_FILLED_BY_DEPLOY"
```

In `src/types.ts`, add to `CloudflareBindings` or `HonoEnv`:
```typescript
TRUST_VERIFY_CACHE?: KVNamespace;
```

The `?` makes it optional so tests pass without the binding (graceful degradation pattern already used in worker).

---

## Files to Create/Modify

### NEW: `packages/worker/src/routes/mcp-trust-verify.ts`

Full implementation file. Must export `mcpTrustVerifyRoutes` (Hono router).

### MODIFY: `packages/worker/src/index.ts`

Add import and route registration for `mcpTrustVerifyRoutes`. Mount at `/v1/trust` before auth middleware.

### MODIFY: `packages/worker/wrangler.toml`

Add `TRUST_VERIFY_CACHE` KV namespace entry.

### MODIFY: `packages/worker/src/types.ts`

Add `TRUST_VERIFY_CACHE?: KVNamespace` to env type.

### NEW (optional): `packages/worker/src/routes/mcp-trust-verify.test.ts`

Unit tests covering at least the 6 fitness assertions. Use existing test patterns (api.test.ts as reference).

---

## Out of Scope (do NOT implement in this pipeline)

- UI page at /showcase/mcp-trust (separate task post-deploy)
- npm client SDK @agentlair/mcp-trust-verify (deferred)
- GitHub Discussion announcement (gated on Hakon)
- SEP PR (gated on Hakon)
- x402 pricing (this is free)
- /v1/trust/server/{id} attestation issuance (separate system)

---

## Cross-Package Dependency Check

Before coding: verify `@agentlair/identity-core` is NOT a dependency in `packages/worker/package.json`.
Use only what's already in the worker: `@noble/curves` (for Ed25519), `../jwt.js` (verifyJWS/verifyJWT).
Do NOT add new npm dependencies.

---

## Fitness Assertions (post-deploy verification via curl)

All 6 must be verified after deploy and captured in `deploy-output.md`:

1. **Issuer discovery descriptor is reachable** (corrected 2026-05-18 — agentlair.dev is the BHC-S issuer, not a self-attested subject): `POST /v1/trust/mcp/verify {"url":"https://agentlair.dev"}` → HTTP 200, `verified=false`, `raw_descriptor` is a non-null JSON object containing `issuer === "https://agentlair.dev"` and `jwks_uri === "https://agentlair.dev/.well-known/jwks.json"`, and `errors` contains a string mentioning `"attestation token"`. Self-attestation of the issuer is out of scope until `/v1/trust/server/{server_id}` ships.

2. **Malformed JSON returns 400**: `POST /v1/trust/mcp/verify` with body `not-json` → HTTP 400 (not 500).

3. **Unattested server returns verified=false**: `POST /v1/trust/mcp/verify {"url":"https://www.example.com"}` → HTTP 200, `verified=false`, `errors` array contains a string mentioning `agentlair-trust`.

4. **Private IP rejected**: `POST /v1/trust/mcp/verify {"url":"http://10.0.0.1"}` → HTTP 400, response errors includes `private IP rejected`.

5. **Cache HIT on repeat**: Send same URL twice within 5 minutes, second response has `X-Cache: HIT` header.

6. **Schema consistency**: All 200 responses have all 8 response fields present (`verified`, `server_id`, `issued_at`, `expires_at`, `jwks_url`, `bhc_token_type`, `raw_descriptor`, `errors`).

---

## Implementation Notes

### URL Normalization
```typescript
function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
}
```

### SHA-256 for Cache Key
Use `crypto.subtle.digest('SHA-256', encoder.encode(url))` available in CF Workers and Bun.

### AbortController for Timeouts
```typescript
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 10_000);
const res = await fetch(url, { signal: ctrl.signal });
clearTimeout(timer);
```

### Graceful JWKS Resolution
Try `kid`-matching first, fall back to trying all keys. Log which key was used in `raw_descriptor` response for debuggability.
