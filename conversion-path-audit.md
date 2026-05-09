# AgentLair Conversion Path Audit
**Date:** 2026-04-29  
**Method:** Automated (curl + WebFetch)  
**Framework:** arrive → understand → try → pay → succeed

---

## Summary

Three of five conversion stages work well. One P0 gap blocks revenue: **paid tiers have no checkout path**. Everything from discovery through first API call is excellent. The funnel breaks exactly at the money step.

---

## 1. ARRIVE

**Status: ✅ GOOD**

| Check | Result |
|-------|--------|
| HTTP Status | 200 OK |
| Load time | 0.09s (excellent) |
| OG title | AgentLair — Persistent Identity Infrastructure for AI Agents ✅ |
| OG description | "Give your AI agent a permanent address, credentials, audit trail, and namespace. Identity that survives session restarts." ✅ |
| OG image | https://agentlair.dev/og-image.jpg — exists (200) ✅ |
| Twitter card | summary_large_image ✅ |
| Meta description | Present ✅ |
| robots | index, follow ✅ |
| Sitemap | /sitemap-index.xml ✅ |

**Finding (P1): Content negotiation behavior — CONFIRMED BUG, FIX IN PIPELINE**  
`curl https://agentlair.dev` without an Accept header returns `Content-Type: application/agent+json` — intentional for bare agents.

**2026-05-06 verification:** Social media unfurlers all return `application/json` (4798 bytes API discovery), NOT HTML with OG tags:
- Twitterbot/1.0 → `application/json` ❌
- facebookexternalhit/1.1 → `application/json` ❌  
- Slackbot-LinkExpanding 1.0 → `application/json` ❌
- LinkedInBot/1.0 → `application/json` ❌
- Discordbot/2.0 → `application/json` ❌

Root cause: unfurlers send `Accept: */*` (not `text/html`), don't match AGENT_UA_PATTERNS, get only 1 signal (no-cookie-no-referer) = low confidence → fall through to `json(API_DISCOVERY)`.

**Fix:** Pipeline unfurl-fix-20260506 adds `UNFURLER_UA_PATTERNS` + `isUnfurler()` check in GET / handler. Known unfurlers route to `proxyToPages(c, '/')` (HTML with OG tags). Agent detection behavior unchanged.

**Live HTML OG tags confirmed present** (2026-04-29 audit):
- OG title: "AgentLair — Persistent Identity Infrastructure for AI Agents" ✅
- OG image: https://agentlair.dev/og-image.jpg ✅
- Twitter card: summary_large_image ✅

---

## 2. UNDERSTAND

**Status: ✅ GOOD**

- **Headline:** "Your agent dies every session. Its identity doesn't have to." — Clear, compelling, memorable in under 3 seconds.
- **Sub-headline:** "Give your agent a permanent address, credentials, audit trail, and namespace — everything it needs to operate across sessions." — Concrete, not abstract.
- **Five pillars** (address, credentials, record, namespace, reputation) — well-structured with icons.
- **Terminal demo in hero** — shows `curl -X POST https://agentlair.dev/v1/register` — developer audience will immediately understand.
- **Trust explorer link** (/explore) — live demo with no login required.

No gaps. A developer arriving from HN or a blog post understands the product in 10 seconds.

---

## 3. TRY

**Status: ✅ GOOD**

- `/getting-started` page: "Under 5 minutes, no email, no credit card, no verification — instant access."
- API registration confirmed working:
  ```bash
  curl -X POST https://agentlair.dev/v1/register -d '{"name": "my-agent"}'
  # Returns: api_key, email_address, profile_url, next_steps[]
  ```
- Free tier: 3 agents, 10 emails/day, 100 requests/day.
- `/explore` page: live agent trust scores, no login required — good social proof.
- Code examples in curl, TypeScript, Python.
- MCP integration docs present.

**Finding (P2):** `/register` UI is a React component loaded client-side. Server-side rendering would improve accessibility and load-time perception. Low priority.

---

## 4. PAY

**Status: ❌ P0 GAP — BLOCKS REVENUE**

Pricing tiers are shown prominently on the landing page:

| Tier | Price | CTA Button |
|------|-------|-----------|
| Free | $0/mo | "Get Started" → /register ✅ |
| Starter | $29/mo | "Join Waitlist" → mailto ❌ |
| Pro | $149/mo | "Join Waitlist" → mailto ❌ |
| Enterprise | Custom | "Contact Us" → mailto ❌ |

**There is no Stripe integration. No checkout page. No automated upgrade path.**

A developer who uses AgentLair, likes it, and wants to upgrade to Starter ($29/mo) must:
1. Click "Join Waitlist"
2. Send an email
3. Wait for a human response

This is a full conversion blocker. At current stage (post-blog, pre-HN), manual is acceptable — but the "waitlist" framing signals the product isn't ready to sell, which undercuts the credibility the rest of the funnel builds.

**Recommended fix (P0):** Replace "Join Waitlist" with a Stripe Payment Link for Starter/Pro. Does not require full billing infrastructure — a static Stripe link per tier takes 10 minutes to set up.

**Requires Håkon action:** Stripe account setup + connecting to AgentLair account. Cannot be done autonomously.

---

## 5. SUCCEED

**Status: ✅ GOOD (with caveat)**

On successful API registration, the response includes:
```json
{
  "next_steps": [
    "GET /v1/account/me to verify your account",
    "POST /v1/email/send to send your first email",
    "PUT /v1/vault/{key} to store credentials",
    "Visit https://agentlair.dev/dashboard to view your account"
  ],
  "status_note": "Free tier is fully functional. 'unverified' simply means no operator email is linked..."
}
```

- Well-structured onboarding response ✅
- Dashboard at /agentlair.dev/dashboard exists (200) ✅
- Docs at /docs with API reference ✅
- Getting started guide walks through 4 core actions ✅

**Finding (P2):** No email-based onboarding sequence. Developers who register via API and don't complete setup have no follow-up path. This is acceptable at current scale but will matter when volume increases.

---

## P0 Gaps (block conversion)

| Gap | Stage | Fix | Requires Håkon |
|-----|-------|-----|----------------|
| No payment path for Starter/Pro/Enterprise tiers | PAY | Add Stripe Payment Links | ✅ Yes (Stripe account) |

## P1 Gaps (hurt conversion)

| Gap | Stage | Fix | Requires Håkon |
|-----|-------|-----|----------------|
| Content-type negotiation: unfurlers get `application/json` | ARRIVE | Add unfurler UA allowlist in GET / handler | No — IN PIPELINE unfurl-fix-20260506 |

## P2 Gaps (nice to have)

| Gap | Stage | Fix | Requires Håkon |
|-----|-------|-----|----------------|
| Register UI is client-side only React | TRY | SSR the register form | No |
| No email onboarding sequence | SUCCEED | Add welcome email on registration | Maybe |
| "Waitlist" framing signals unready product | PAY | Update copy even before Stripe is live | No — IN PIPELINE unfurl-fix-20260506 (modal copy fix: "Join Waitlist"→"Notify Me"). Note: CTA buttons already say "Subscribe" (pricing.tsx updated since April audit). |

---

## Verdict

AgentLair's funnel from discovery to first API call is genuinely excellent. The gap is purely in monetization infrastructure. A developer who arrives, understands, and tries the product has no friction path to paying. Fix: Stripe Payment Links for Starter and Pro tiers. 10-minute implementation, requires Stripe account.
