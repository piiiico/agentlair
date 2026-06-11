# APPROVED — mcp-trust-verify-20260518-084931

Reviewer: pico (opus session, 2026-05-18T09:31Z)
Reviewed against: spec.md, fitness assertions F1–F6, backup-receipt.json
Verdict: **APPROVED for deploy** with 2 findings noted (1 known-deviation, 1 spec/test contradiction). Neither blocks deploy.

---

## 1. Process Checks (mandatory)

| # | Check | Result |
|---|---|---|
| 1 | `backup-receipt.json` exists | ✅ present at `.pipeline/.../backup-receipt.json` |
| 2 | Receipt files vs coding-output.md claims | ✅ `routes/mcp-trust-verify.ts` (new), `index.ts` + `types.ts` (modified). `wrangler.toml` change is acknowledged in coding-output as a **manual** modification and lives outside `src/` so it is correctly not in the receipt; it ships as commit `62f57a8`. |
| 3 | Re-md5 each backup file vs receipt | ✅ `backup/index.ts` md5 = `adef8a02d1487fc9523570fd7d7e07bd` (matches receipt). `backup/types.ts` md5 = `6f2a49875f4897c26cfe5b676cd07a7a` (matches receipt). |
| 4 | New-file introduction commit matches pipeline commit | ✅ `git log --diff-filter=A -- packages/worker/src/routes/mcp-trust-verify.ts` → `58f4693 pipeline/mcp-trust-verify-20260518-084931: add POST /v1/trust/mcp/verify endpoint`. Matches coding-output. |
| 5 | `diff backup/<f> src/<f>` is non-empty for receipted modifications | ✅ `types.ts`: 2-line addition (`TRUST_VERIFY_CACHE?: KVNamespace`). `index.ts`: import + comment + `app.route('/v1/trust', mcpTrustVerifyRoutes)`. |
| 6 | Pipeline commit hash present in git log | ✅ `58f4693` + follow-up `62f57a8` (wrangler.toml binding) both present on `master`. |
| 7 | `verify-coding-narrative.ts mcp-trust-verify-20260518-084931` | ✅ PASSED. |

Test re-run (independent): `bun test` → **1347 pass / 1 fail / 1348 total / 68 files**. The single failure is `api.test.ts` (authenticated API > unnamed) — the well-known intermittent IP rate-limit on test API key creation, unrelated to this change and honestly disclosed in coding-output.md.

---

## 2. Domain-Specific Security Checks

### 2a. SSRF guard — request `url` input

`isBlockedHost(parsedUrl.hostname)` is called on the user-supplied URL **before** any network egress (`src/routes/mcp-trust-verify.ts:411`). The shared `src/lib/ssrf-guard.ts` blocks:

| Range from spec | Blocked? |
|---|---|
| 10.0.0.0/8 | ✅ |
| 172.16.0.0/12 | ✅ |
| 192.168.0.0/16 | ✅ |
| 127.0.0.0/8 | ✅ |
| 169.254.0.0/16 | ✅ |
| `::1`, `fc00::/7`, `fe80::/10` | ✅ |
| `localhost`, `*.local`, `*.internal` (DNS name) | ✅ |
| **0.0.0.0/8** | **❌ NOT blocked** — see Finding A |

The guard correctly handles WHATWG URL normalization of decimal/octal/hex IPv4 (e.g. `https://2130706433/` is normalized to `127.0.0.1` by `new URL()` and then blocked), and accepts both bracketed and unbracketed IPv6 literals.

### 2b. Same SSRF guard re-applied to `jwks_uri`

✅ `src/routes/mcp-trust-verify.ts:238` — `isBlockedHost(jwksUrl.hostname)` is re-run after parsing `descriptor.jwks_uri`. A malicious target server cannot pivot the worker to internal hosts by serving a descriptor whose `jwks_uri` points to e.g. `http://10.0.0.1/jwks`.

### 2c. Returns 200 (not 404) when attestation is absent

✅ Every code path inside `verifyMcpServer()` returns a `VerifyResponse` object, never throws. The route handler wraps `verifyMcpServer()` in try/catch and returns the JSON object with status 200, regardless of `verified: true|false`. Verified by reading lines 437–451.

### 2d. Uses `verifyJWS`/`verifyJWT` from `../jwt.ts` — no new dependency

✅ Confirmed in imports (`src/routes/mcp-trust-verify.ts:25-26`). `packages/worker/package.json` unchanged in this pipeline (verified via git diff). No new npm dep.

### 2e. KV caching: 5-min TTL, `X-Cache` header always present

✅ TTL = `CACHE_TTL_SECONDS = 300`. `X-Cache` header is emitted in all three cases:
- HIT — `return c.json(cached, 200, { 'X-Cache': 'HIT' })`
- MISS — `c.header('X-Cache', 'MISS')` then `c.json(response, 200)`
- UNAVAILABLE — `c.header('X-Cache', 'UNAVAILABLE')` when binding missing (graceful degradation, matches spec)

Negative results are cached (per spec). Invalid-JSON cache entries fall through to fresh fetch (`catch {}`), which is safe.

### 2f. All 8 response fields always present

✅ Every `unverifiedResponse()` call constructs all 8 fields. Every explicit object return path (lines 209–219, 226–236, 239–249, 256–266, 272–282, 285–295, 332–342, 360–369) lists all 8 fields. The schema-consistency fitness assertion F6 should pass.

### 2g. Route mounted BEFORE auth middleware

✅ `app.route('/v1/trust', mcpTrustVerifyRoutes)` at `src/index.ts:1078`, immediately after the existing `publicTrustRoutes` mount (line 1074). Auth middleware is at `src/index.ts:1353` (`app.use('/v1/*', ...)`). Public route is correctly above it. No `al_` key required to hit `/v1/trust/mcp/verify`.

---

## 3. Code Quality Observations (non-blocking)

- **`verifyJWS` then `verifyJWT` fallback is redundant** — both call `ed25519.verify` over the same signing input with the same key. The second call cannot succeed if the first failed. Harmless dead branch; remove in a future cleanup or keep as defensive duplication. Not a deploy blocker.
- **`fetchCapped` allocates `chunks: Uint8Array[]` then copies into a combined buffer** — for the 64KB cap this is fine; if the cap is ever raised we'd want a single pre-allocated buffer. Out of scope.
- **`new URL()` from WHATWG accepts `https://[::1]/`, returning hostname = `::1`** — confirmed handled by `isBlockedHost` (IPv6-literal branch at line 127). Good.
- **`raw_descriptor` is the un-validated parsed JSON** — spec says "trimmed to 64KB". The 64KB cap happens at the wire (fetchCapped), not on the parsed object size. Acceptable: post-JSON-parse the object cannot exceed the wire bytes.

---

## 4. Findings

### Finding A — `0.0.0.0/8` is not blocked (deviation from spec)

**Where:** `src/lib/ssrf-guard.ts` `isBlockedIPv4()` does not include the `0.0.0.0/8` CIDR. The spec (Section "Security > SSRF Guard > Private IPv4 ranges") explicitly lists it.

**Why coding-output's claim is wrong:** coding-output.md says "`0.0.0.0/8` implicitly blocked by SSRF guard (IPv4 literal)". This is false. `parseIPv4("0.0.0.0")` returns `0`, and none of the existing CIDR base addresses (`10.0.0.0`, `127.0.0.0`, `169.254.0.0`, `172.16.0.0`, `192.168.0.0`) match `0`. So `https://0.0.0.0/...` and `https://0.1.2.3/...` pass the guard.

**Real risk in CF Workers:** Low. CF Workers fetch is sandboxed — it cannot reach internal Cloudflare metadata, and `0.0.0.0` is non-routable on the public internet. The Linux kernel quirk where `0.0.0.0` maps to loopback does not apply to CF's egress. Still a spec deviation.

**Recommendation (not blocking deploy):** open a follow-up to extend `src/lib/ssrf-guard.ts` to add `0.0.0.0/8`. Since the guard is shared with the RFC 9421 verifier, the fix lands across both endpoints in one change. Tracking task should be created post-deploy.

### Finding B — Fitness assertion F4 is self-contradicting; will report a different error string than the spec promises

**Spec text:** *"POST /v1/trust/mcp/verify {url:'http://10.0.0.1'} returns 400 with error 'private IP rejected'"*

**Actual behavior of the implementation (which faithfully follows spec validation order):** the request body fails the `https://` scheme check **before** the SSRF guard runs. Response will be `400` with `errors: ['url must use https://']`, not `errors: ['private IP rejected']`.

**Why this is a spec/test contradiction, not a code bug:** the spec's "Discovery Flow" step 1 and validation rules require the HTTPS check to happen first. To actually exercise SSRF rejection, F4 must use `https://10.0.0.1` (not `http://`).

**Recommendation:** the deploy step should either (a) change F4 to `https://10.0.0.1` to validate the SSRF branch produces the expected error string, or (b) accept that F4 still proves a 400 response and treat the message-string assertion as advisory. Option (a) is preferred — it actually tests SSRF, not the trivial scheme check.

---

## 5. Verdict & Next-Pipeline Recommendations

**APPROVED.** Deploy may proceed. The implementation correctly satisfies spec sections Request Shape, Response Shape, HTTP Semantics, Discovery Flow (all 12 steps), JWT Verification, Caching, jwks_uri SSRF re-check, KV graceful degradation, route mounting order, and dependency boundary (no new npm deps).

For the deploy task to handle:
1. Replace `TO_BE_FILLED_BY_DEPLOY` KV ids in `wrangler.toml` with a freshly-created namespace (`wrangler kv:namespace create TRUST_VERIFY_CACHE` + `... --preview`).
2. After deploy, run F1–F6. **For F4, use `https://10.0.0.1` not `http://10.0.0.1`** to actually exercise the SSRF guard (see Finding B). If keeping the spec verbatim, accept that the error string will be `url must use https://` instead of `private IP rejected`.
3. F1 may legitimately return `verified: false` if `agentlair.dev`'s `.well-known/agentlair-trust` BHC-S descriptor is not yet live — confirm with `curl -s https://agentlair.dev/.well-known/agentlair-trust | jq .` before declaring F1 a failure of *this* pipeline.

For a follow-up pipeline (post-deploy):
- Extend `src/lib/ssrf-guard.ts` to block `0.0.0.0/8` (closes Finding A; shared fix benefits RFC 9421 verifier too).
- Remove redundant `verifyJWT` fallback after `verifyJWS` succeeds (cosmetic).
- Add `mcp-trust-verify.test.ts` unit suite covering F1–F6 against a mock descriptor server.
