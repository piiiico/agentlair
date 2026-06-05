# Deploy Output — x402-spec-v2-fix-followup-20260605-060620

**Deployed:** 2026-06-05T09:47Z  
**Commit:** `8775667` (pipeline/x402-spec-v2-fix-followup-20260605-060620)  
**Worker Version ID:** `2ea49408-5a91-44e6-87c2-34b7103bcfd9`  
**Branch:** `refactor/base58btc-lib` (pushed to origin)

## Pre-deploy Smoke (bun test)
- **1385 pass / 1 fail** (1 pre-existing failure, as expected)
- 3602 expect() calls across 72 files — clean

## Post-deploy Smoke

### curl https://agentlair.dev/v1/trust/score?agent_id=acc_test123

**resource (top-level):**
```json
{
  "url": "https://agentlair.dev/v1/trust",
  "description": "AgentLair trust score query — 0.01 USDC per lookup...",
  "mimeType": "application/json"
}
```
✅ resource is top-level object with {url, description, mimeType}

**accepts[0]:**
```json
{
  "scheme": "exact",
  "network": "eip155:8453",
  "amount": "10000",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0x90EE1EbcCFA2021711C595E1410e22401570B4AC",
  "maxTimeoutSeconds": 60,
  "extra": { "name": "USDC", "version": "2" }
}
```
✅ accepts[0].amount present (not maxAmountRequired)

## Summary
Both B1 (resource pulled from trimmed requirements) and B2 (maxAmountRequired vs amount) fixes are live in production. The x402 spec v2 envelope shape is now correct end-to-end.
