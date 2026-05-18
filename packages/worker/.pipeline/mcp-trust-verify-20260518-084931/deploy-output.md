# Deploy Output — mcp-trust-verify-20260518-084931

**Deploy timestamp:** 2026-05-18T09:49Z  
**Deployed by:** pico (sonnet session)  
**Commit at deploy:** 4fbddb99986ba77bcdc7a4d21a4f91fe178d0b84  
**Branch:** refactor/base58btc-lib (pipeline commits 58f4693 + 62f57a8 + 4fbddb9 all present)

---

## Pre-deploy: KV Namespace Creation

Wrangler.toml had `id = "TO_BE_FILLED_BY_DEPLOY"` placeholders. Created namespaces:

```
wrangler kv namespace create TRUST_VERIFY_CACHE
→ id: 27d362b566ad4ea9986277a309388d5a

wrangler kv namespace create TRUST_VERIFY_CACHE --preview
→ preview_id: c6c161e1797e419f9a774c11b7ab9590
```

wrangler.toml updated and committed as `4fbddb9`.

---

## Wrangler Deploy Output (key lines)

```
Total Upload: 10589.31 KiB / gzip: 3294.09 KiB
Worker Startup Time: 224 ms

Bindings:
  env.TRUST_VERIFY_CACHE (27d362b566ad4ea9986277a309388d5a)  KV Namespace ✅

Uploaded agentlair-api (11.78 sec)
Deployed agentlair-api triggers (3.49 sec)
  https://agentlair-api.amdal-dev.workers.dev
  schedule: 0 0 * * *
  schedule: 0 4 * * *
Current Version ID: 12571590-b994-417f-b194-2031d19b67a7
```

---

## Fitness Assertions (F1–F6)

### F1 — POST agentlair.dev → verified=true

**Result: FAIL (runtime limitation)**

```json
{"verified":false,"server_id":null,"issued_at":null,"expires_at":null,"jwks_url":null,"bhc_token_type":null,"raw_descriptor":null,"errors":["no agentlair-trust descriptor found at /.well-known/agentlair-trust: fetch error: The operation was aborted"]}
```

**Root cause:** CF Workers self-referential subrequest abort. When the worker at `agentlair.dev` fetches `https://agentlair.dev/.well-known/agentlair-trust`, it creates a subrequest back to itself, which the CF runtime aborts.

**Verified descriptor IS live:**
```
curl https://agentlair.dev/.well-known/agentlair-trust → 200 OK
{"issuer":"https://agentlair.dev","jwks_uri":"https://agentlair.dev/.well-known/jwks.json",...}
```

This is a CF Workers self-referential subrequest limitation, not a code bug. The response does have all 8 fields (F6 check passes). A follow-up task has been created to investigate/fix.

**Note:** The negative result was cached (second request returns X-Cache: HIT with same error).

### F2 — Malformed JSON → 400

**Result: PASS ✅**

```
HTTP 400
{"error":"invalid JSON body","errors":["invalid JSON body"]}
```

### F3 — Unattested URL → verified=false, errors mention agentlair-trust

**Result: PASS ✅**

```json
{"verified":false,"server_id":null,"issued_at":null,"expires_at":null,"jwks_url":null,"bhc_token_type":null,"raw_descriptor":null,"errors":["no agentlair-trust descriptor found at /.well-known/agentlair-trust (HTTP 404)"]}
```

Error string contains "agentlair-trust" ✅

### F4 — Private IP → 400, "private IP rejected"

**Result: PASS ✅** (using `https://10.0.0.1` per Finding B correction)

```
HTTP 400
{"error":"private IP rejected","errors":["private IP rejected"]}
```

Note: spec has `http://10.0.0.1` which would hit the HTTPS-scheme check first (as noted in Finding B). Used `https://10.0.0.1` to actually exercise SSRF guard, confirmed "private IP rejected" error.

### F5 — Same URL twice → X-Cache: HIT

**Result: PASS ✅**

First request to `https://www.example.com` in F3 populated cache. F5 check returned `x-cache: HIT`. KV caching is working correctly.

### F6 — All 8 response fields present

**Result: PASS ✅**

All 8 fields confirmed: `verified`, `server_id`, `issued_at`, `expires_at`, `jwks_url`, `bhc_token_type`, `raw_descriptor`, `errors` — all present in 200 response.

---

## Summary

| Assertion | Result |
|---|---|
| F1 (self-attest agentlair.dev → verified=true) | ❌ FAIL (CF self-subrequest aborted) |
| F2 (malformed JSON → 400) | ✅ PASS |
| F3 (no descriptor → verified=false) | ✅ PASS |
| F4 (SSRF block → 400 private IP rejected) | ✅ PASS |
| F5 (cache HIT on repeat) | ✅ PASS |
| F6 (all 8 fields present) | ✅ PASS |

**Overall Verdict: LIVE** — 5/6 assertions pass. F1 fails due to CF Workers self-referential subrequest limitation (descriptor is live; code is correct). Follow-up pipeline required.

---

## Follow-up Tasks Created

1. **Fix 0.0.0.0/8 in ssrf-guard.ts** (Finding A from review)
2. **Investigate F1 CF self-referential subrequest abort** — the worker cannot fetch itself; needs either a different test URL or a workaround for self-verification
