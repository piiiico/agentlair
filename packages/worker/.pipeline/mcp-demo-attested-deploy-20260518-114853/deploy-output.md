# Deploy Output: mcp-demo-attested-deploy

**Deployed:** 2026-06-01T13:08:00Z  
**Deployed by:** pico (sonnet scheduled task)  
**Status:** ✅ ALL 5 FF ASSERTIONS PASSED

---

## Summary

First production-attested MCP server deployed at https://mcp-demo.agentlair.dev.

`POST /v1/trust/mcp/verify -d '{"url":"https://mcp-demo.agentlair.dev"}'` returns `verified: true`.

---

## Deploy Steps

1. **wrangler deploy** — `agentlair-mcp-demo` worker deployed to CF Workers (packages/mcp-demo-worker)
2. **AUDIT_SIGNING_KEY secret** — New Ed25519 keypair generated (kid: `04b37454`), stored as CF secret on agentlair-mcp-demo worker. Note: a fresh key was generated (not the main worker's key) with mcp-demo serving its own JWKS at `/.well-known/jwks.json`.
3. **DNS** — CNAME `mcp-demo.agentlair.dev → agentlair-mcp-demo.workers.dev` (proxied) created via CF API.
4. **Service binding** — `MCP_DEMO` binding added to agentlair-api worker's wrangler.toml + verifier updated to use it for same-zone fetch bypass (CF same-zone HTTP fetches return 403; service bindings route directly).
5. **agentlair-api redeploy** — Version `c05b0073` with MCP_DEMO service binding.

### Hot-fix: CF Same-Zone Fetch 403

CF Workers cannot make HTTP subrequests to other Workers on the same zone's custom domain (returns 403). Fixed via CF Service Binding (`[[services]] binding = "MCP_DEMO" service = "agentlair-mcp-demo"`) which routes directly without going through the zone HTTP stack. The fix is in:
- `packages/worker/src/routes/mcp-trust-verify.ts` — `getDescriptorBody` + `getJwksBody` use binding for `mcp-demo.agentlair.dev`
- `packages/worker/src/types.ts` — Added `MCP_DEMO?: Fetcher` to Env
- `packages/worker/wrangler.toml` — Added `[[services]]` binding

---

## FF Assertions

| # | Assertion | Result |
|---|-----------|--------|
| FF1 | `GET /.well-known/agentlair-trust` → 200 + attestation_token | ✅ PASS |
| FF2 | `GET /.well-known/jwks.json` → 200 + OKP key | ✅ PASS |
| FF3 | `POST /v1/trust/mcp/verify` → verified=true | ✅ PASS (KEY METRIC) |
| FF4 | `POST /mcp tools/list` → echo,time,ping | ✅ PASS |
| FF5 | Repeat FF3 → X-Cache: HIT | ✅ PASS |

---

## Working curl (FF3)

```bash
curl -sS -X POST https://agentlair.dev/v1/trust/mcp/verify \
  -H "Content-Type: application/json" \
  -d '{"url":"https://mcp-demo.agentlair.dev"}'

# Returns: {"verified":true,"server_id":"agentlair_alias:mcp-demo",...}
```
