# RFC-001 Addendum: Phase 1 Scope Additions

**Status:** Accepted  
**Author:** Pico (autonomous agent)  
**Created:** 2026-04-20  
**Closes:** Review findings F1, F2  
**Relates to:** RFC-001 Phase 1 implementation

---

## Summary

During RFC-001 Phase 1 coding, three additions were made beyond the original RFC-001 spec. They were reviewed and approved as fail-open and consistent with existing codebase patterns, but were not formally tracked. This addendum documents them for the record.

---

## Addition 1: Rate Limiting on `POST /v1/tokens/introspect`

### What was added

Per-account monthly rate limiting on the token introspection endpoint. Rate limits are tier-dependent:

| Tier | Monthly Limit |
|------|--------------|
| Free | 1,000 verifications/month |
| Paid | 50,000 verifications/month |

**Implementation:**

- KV key pattern: `token-verify-monthly:{accountId}:{YYYY-MM}` (TTL: 35 days)
- Function: `checkAndIncrementTokenVerify()` in `src/middleware/ratelimit.ts`
- Tier lookup: fetches account object via `key:{keyHash}` in KV; includes lazy expiry check for paid tier

**Tier lookup logic (in `tokens.ts`):**

```typescript
const keyHash = await c.env.KEYS.get('account:' + accountId);
if (keyHash) {
  const accountRaw = await c.env.KEYS.get('key:' + keyHash);
  const acct = JSON.parse(accountRaw);
  accountTier = acct.tier || 'free';
  // Lazy expiry: if paid tier has expired, treat as free
  if (accountTier === 'paid' && new Date(acct.tier_expires_at) < new Date()) {
    accountTier = 'free';
  }
}
```

### Why it was added

Introspection is a public endpoint (no API key required per RFC 7662). Without rate limiting, any caller could drive unbounded KV reads using arbitrary token strings. The limit also aligns with the platform's tiered billing model already present on all other endpoints.

### Fail-open design

Any KV error during tier lookup defaults to free-tier limits. Any KV error during counter check/increment allows the request through. This prioritizes availability over strict enforcement — consistent with the platform's fail-open philosophy.

### Test coverage gaps

- No integration test for the 1,000/month free-tier wall (would require 1,001 calls or a mock counter)
- No test for the paid-tier expiry downgrade path during introspection
- Happy-path tests exist in the token route test suite

---

## Addition 2: x402 Payment Handling on Introspect (Over-Limit Bypass)

### What was added

When an account's monthly introspection limit is exceeded, the endpoint returns HTTP 402 with a standard x402 payment requirement. Agents can pay **0.001 USDC** (1,000 atomic) on Base to bypass the limit for that call.

**Payment flow:**

```
1. Counter >= limit → return 402 with x402 payment spec
2. Caller retries with X-PAYMENT header containing signed payment proof
3. Worker calls verifyX402Payment() → facilitator confirms signature
4. Worker calls settleX402Payment() → payment settled on Base
5. trackX402Spend() logs cumulative spend for the account
6. autoUpgradeIfThreshold(): if cumulative x402 spend > 1 USDC, auto-upgrade account to paid tier
7. Introspection proceeds, returns active: true/false as normal
```

**402 response body:**

```json
{
  "active": false,
  "error": "verification_limit_exceeded",
  "message": "Monthly token verification limit reached (1,000/month on free tier). Upgrade at https://agentlair.dev/pricing or pay 0.001 USDC via x402.",
  "used": 1000,
  "limit": 1000,
  "upgrade_url": "https://agentlair.dev/pricing",
  "tier_limits": { "free": 1000, "paid": 50000 }
}
```

**Pricing:**

- Service: `token_verify`
- Amount: 1,000 atomic USDC (0.001 USDC)
- Network: `eip155:8453` (Base mainnet)
- Asset: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Recipient: `0x90EE1EbcCFA2021711C595E1410e22401570B4AC`

### Why it was added

Consistent with the platform-wide x402 monetization pattern (already used on email, vault, stack creation, agent provisioning). Allows programmatic agents to continue operating without manual account upgrades. The auto-upgrade threshold (1 USDC cumulative) creates a natural migration path from free to paid tier.

### Edge case: counter increment on payment path

When `allowed: false` is returned by `checkAndIncrementTokenVerify()`, the counter was not incremented. On the payment path, the counter is not separately incremented for the bypassed call — the payment itself is the authorization. This is intentional: paying per-call already limits overuse through cost.

### Test coverage gaps

- No integration test for the full 402 → payment → retry cycle on introspect
- x402 payment verification is tested in `x402.test.ts` but not wired to the introspect handler tests
- Auto-upgrade threshold path not tested on the introspect code path specifically

---

## Addition 3: `/spec` Routes Wired Up

### What was added

The L4 Behavioral Trust Specification endpoint is served at `GET /spec` (public, no auth required).

**Wiring (in `src/index.ts`, line 277):**

```typescript
app.route('/spec', specRoutes);
```

**Implementation:** `src/routes/spec.ts` (793 lines)

**Behavior:**

- `Accept: text/html` → Styled HTML documentation (dark theme, responsive)
- `Accept: application/json` → Machine-readable JSON spec
- Default → HTML (browser-friendly)

**Response headers:**

```
Cache-Control: public, max-age=3600
X-Powered-By: AgentLair
```

**Spec metadata:**

- Version: 0.1.0 (matches `spec-v0.1.md` at repo root)
- Status: Draft
- Sections: Problem statement, L4 trust model, protocol definition, threat model, competitive comparison, integration guide

### Why it was added

RFC-001 formalized AgentLair's IdP role; the spec endpoint makes the behavioral trust specification machine-discoverable and human-readable. Required for the public positioning of AgentLair as an L4 trust layer (RFC-002). Serving from `/spec` (not `/docs/spec`) keeps the URL clean for external references.

### Test coverage gaps

- No test for content negotiation (HTML vs JSON path)
- No test that the spec JSON response validates against a schema

---

## Impact on RFC-001 Scope

These additions do not change any RFC-001 protocol commitments. They extend Phase 1 in two ways:

| Extension | Type | RFC-001 Section |
|-----------|------|-----------------|
| Introspect rate limiting | Operational constraint on existing endpoint | §3.2.2 |
| x402 on introspect | Monetization layer on existing endpoint | §3.2.2 |
| `/spec` route | New public endpoint (docs/marketing) | Not covered |

None of these are breaking changes. All are fail-open or additive.

---

## References

- `src/routes/tokens.ts` lines 321–396: Rate limiting + x402 on introspect
- `src/middleware/ratelimit.ts` lines 365–410: `checkAndIncrementTokenVerify`, `TOKEN_VERIFY_LIMITS`
- `src/x402.ts`: Full x402 payment infrastructure
- `src/routes/spec.ts`: Spec endpoint implementation
- `src/index.ts` line 277: Spec route wiring
- [RFC-001: AgentLair as MCP-I Identity Provider](./RFC-001-identity-provider.md)
