# EdDSA-JWTs Blog Funnel Audit

**Post:** https://agentlair.dev/blog/eddsa-jwts-agent-credential-problem/
**Date:** 2026-05-03
**Reason:** dev.to + HN cross-posts scheduled 2026-05-04. Audit before traffic lands.
**Method:** WebFetch + curl + voice-check. Compared against `conversion-path-audit.md` (2026-04-29).
**Framework:** arrive → understand → try → pay → succeed.

---

## Summary

Post is well-built editorial (voice +5) but had near-zero in-body funnel linking. Bottom BlogCTA carried the entire conversion load. Patched in this session: three inline contextual links to `/behavioral`, `/docs`, and `/quickstart`. Template-level gaps (ToC, copy buttons, above-the-fold CTA, related posts) deferred to a follow-up pipeline task — bigger surgery than safe in a single content session, and they touch every blog post not just this one.

`pay` is still broken (Stripe blocked, requires Håkon). The other four stages function. Honest expected outcome from the cross-post traffic is below.

---

## Stage-by-stage (post-fix state)

### 1. ARRIVE
**Status:** ✅ GOOD

| Check | Result |
|---|---|
| HTTP | 200 |
| Content-Type | text/html |
| Title | "How EdDSA JWTs Solve the Agent Credential Problem" |
| Description | Set, ~280 chars |
| JSON-LD | Article schema with author, dates, publisher |
| OG tags | Inherited from BaseHead.astro |
| Canonical | `https://agentlair.dev/blog/eddsa-jwts-agent-credential-problem` |

No regression vs Apr 29 baseline.

### 2. UNDERSTAND
**Status:** ✅ GOOD

- Opening hook is concrete — sandbox/credential problem stated in two sentences.
- Voice score: +5 (general context). σ=9.0 sentence-length variance — well above the LLM-flatness threshold.
- 939 words. Reading time ~4 min (no estimate displayed; see template gaps).
- Headers: 4 H2s. Logical progression: problem → mechanism → gap → shipped solution.
- No marketing fluff above the fold.

### 3. TRY
**Status:** ⚠️ PARTIAL

What works:
- BlogCTA component auto-renders after every blog post — has `curl` example, "Start Free →" → `/register`, "Read the docs →" button.
- Three new in-body inline links to `/behavioral`, `/docs`, `/quickstart` (this session's patch).
- `/register` and `/quickstart` both 200 OK, both load HTML, both work without email.

What's broken/missing:
- **BlogCTA "Read the docs →" button links to `/getting-started`, not `/docs`.** Label/href mismatch. (Tracked as follow-up pipeline task.)
- **No table of contents.** 939-word post with 4 H2s, no nav. Scroll-only.
- **No above-the-fold CTA.** First CTA is the BlogCTA at the bottom. A reader who bounces after the opening section sees no ask.
- **No code copy buttons.** Multi-line `curl` and JSON examples; no copy affordance.
- **No related posts.** AgentLair has 10+ posts on adjacent topics (litellm, vault-langchain, dont-let-agents-hold-credentials, agent-identity-landscape) — none surface here.

### 4. PAY
**Status:** ❌ P0 GAP — UNCHANGED

Stripe still blocked, requires Håkon. Free → paid path is mailto-waitlist for Starter ($29/mo), Pro ($149/mo), Enterprise. Same finding as 2026-04-29. Out of scope for this session.

### 5. SUCCEED
**Status:** ✅ GOOD

`/v1/register` response includes `next_steps[]` and dashboard link. No regression.

---

## Before / after (this session)

**Before:**
- 0 in-body links to `/docs`, `/quickstart`, `/behavioral`.
- Closing line: `→ [agentlair.dev](https://agentlair.dev). JWKS lives at /.well-known/jwks.json. Verifier package: @agentlair/verify.`
- Sole CTA path: bottom BlogCTA component.

**After:**
- "behavioral observations" (mid-body) links to `/behavioral`.
- Closing line rewritten: `The verifier package is @agentlair/verify ([integration notes in the docs](/docs)). Public keys live at /.well-known/jwks.json. If you want a working AAT in your terminal, [/quickstart](/quickstart) takes about 90 seconds — no signup form, no card.`
- Voice score: +5 → +5 (held).
- Commit: `84f1012` on main.
- Live verification: `curl https://agentlair.dev/blog/eddsa-jwts-agent-credential-problem/ | grep -c '/quickstart'` → 1.

---

## Honest leak quantification (per 100 cold HN/dev.to visitors)

This is what I expect to actually happen with the funnel as-is, post-fix:

| Stage | Count | Reasoning |
|---|---|---|
| Arrive | 100 | Cross-posted to dev.to + HN 2026-05-04 |
| Read past first H2 | ~55 | No ToC, no above-fold hook to scroll |
| Reach BlogCTA at bottom | ~25 | Typical long-form attrition |
| Click any internal link (`/quickstart`, `/docs`, `/behavioral`, BlogCTA) | ~7 | Up from estimated 5 pre-fix; the new in-body links pick up readers who bounce before the bottom |
| Run `curl` and get free agent | ~3 | Free tier is one curl, no email |
| Convert to paid | **0** | Waitlist-mailto. No Stripe. |

The funnel can produce free activations. It cannot produce revenue.

**What "ship Stripe Payment Links" would change:** with a working pay step, ~1-2 of those 3 free activations might convert at $29 within 14 days based on dev-tool norms. So ~$30-60 from this single cross-post wave. Without Stripe, $0.

The cross-post is still worth running — free activations build a usage base, the post earns SEO + backlinks, and HN points convert to brand recognition. Just not money.

---

## Template-level gaps (follow-up — pipeline required)

Pipeline task seeded separately. Scope:

1. **Fix BlogCTA "Read the docs →" href** — change `/getting-started` to `/docs`. Trivial.
2. **Add reading-time + ToC** to `[slug].astro`. Auto-extract H2s. Sticky on desktop. Affects all 90+ posts.
3. **Add above-the-fold mini-CTA** to `[slug].astro` — one-line "Try this in 90 seconds → /quickstart" between header and first paragraph. Conditional on post frontmatter `cta: try` so only technical posts get it.
4. **Add code-copy buttons** to all `<pre><code>` blocks in the prose section. Astro/MDX has plugin patterns for this.
5. **Add related-posts component** below BlogCTA. Manually curated per-post via frontmatter `related: [slug, slug, slug]`, no inference.

Each gap also affects every other blog post — leverage is high.

---

## What this session shipped

- `apps/web/src/content/blog/eddsa-jwts-agent-credential-problem.md` — three inline links added. Commit `84f1012`.
- Live deploy: `f257fcc3-883b-4716-8881-1d138119f88e` to `agentlair-web` Pages project.
- Voice-check on full post body: +5 (held, threshold +3).
- This audit doc.

## What this session did NOT ship

- Template fixes (pipeline-gated, deferred — see above).
- Stripe pay-step fix (requires Håkon — out of scope).
- BlogCTA href fix (1-line change but inside a component file — folded into the template pipeline task to avoid trickling small fixes).
