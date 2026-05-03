# Deploy Enforcement — agentlair.dev

How the static site reaches production, and the pre-flight guard that
prevents source/git divergence.

## Deploy mechanism

The web app is **not** auto-deployed by Cloudflare's git integration. The
only GitHub workflow in this repo (`.github/workflows/publish-mcp-registry.yml`)
publishes the MCP package on tag — it does not touch the website.

Production deploys happen via a single command run from a developer's
machine (or this container):

```bash
cd apps/web
bun run deploy
```

That script chain is, post-enforcement:

```json
"deploy": "bun ../../tools/preflight-deploy-guard.ts && bun run build && bun deploy.ts"
```

1. `preflight-deploy-guard.ts` — inspects the local working tree for
   route sources that are untracked or uncommitted. **Blocks here on
   divergence.**
2. `astro build` — produces `apps/web/dist/`.
3. `deploy.ts` — walks `dist/`, hashes with blake3, uploads via the
   Cloudflare Pages REST API, creates a deployment.

Because step 3 reads `dist/`, and `dist/` is built from the **local
working tree** (committed *or* untracked), anything in `apps/web/src`
ships — git tracking is not consulted. That is the divergence vector
the guard closes.

## The original failure (May 3, 2026)

Five files were live on agentlair.dev with no git history:

- `apps/web/src/pages/verify.astro`
- `apps/web/src/pages/behavioral.astro`
- `apps/web/src/pages/reputation.astro`
- `apps/web/src/components/dashboard/VerifyWidget.tsx`
- `apps/web/src/content/blog/eddsa-jwts-explained.md` (and one sibling)

All were detected by `tools/audit-deploy-divergence.ts`, which polls the
live sitemap and cross-references against git. They were recovered by
fetching from the live deployment (commits `73a222f`, `835787d`).

`audit-deploy-divergence.ts` is a **post-mortem** tool — it tells you
what *did* leak. The pattern recurred 5+ times across one session despite
the audit script existing, because the audit is opt-in and runs after
the bad upload has already happened. Per the principle "if a pattern
recurs 3+ times after a skill/tool covers it, escalate to code
enforcement," the fix is at the **execution path**, not the inspection
path.

## What the guard checks

`tools/preflight-deploy-guard.ts` scans these directories for files
matching `*.{astro,mdx,md}`:

```
apps/web/src/pages/
apps/web/src/content/blog/
apps/web/src/content/learn/
apps/web/src/content/whitepaper/
```

These are the files that produce public routes. (Components, layouts,
and lib code are imported *into* route files; any divergence in them
manifests via the route file's bundle hash, so we keep the surface
narrow on purpose.)

Two failure classes:

| Class      | Detected via                        | What it means                                  |
|------------|-------------------------------------|------------------------------------------------|
| UNTRACKED  | `git ls-files --others`             | Never `git add`-ed. The recurring failure.     |
| MODIFIED   | `git diff --name-only HEAD`         | Tracked but uncommitted; deploy ships diff.    |

Exit codes:
- `0` — clean, or `DEPLOY_FORCE=1` set
- `1` — divergence detected
- `2` — guard itself failed (not a git repo, etc.)

## Escape hatch

```bash
DEPLOY_FORCE=1 bun run deploy
```

Reserved for cases like emergency rollback to a pre-built `dist/` whose
sources you don't want to commit. Logs a warning, does not silently
proceed.

## Verification of the fix (2026-05-03)

The guard was tested against the natural divergence that existed in the
working tree at the time of writing:

- `apps/web/src/pages/dashboard/popa.astro` (untracked)
- `apps/web/src/pages/tools/eu-ai-act-compliance.astro` (untracked)
- `apps/web/src/content/blog/git-history-attack-surface.md` (modified, uncommitted)

### Test 1 — guard blocks divergent state

```
$ bun tools/preflight-deploy-guard.ts ; echo "EXIT=$?"
┌─────────────────────────────────────────────────────────────┐
│  DEPLOY BLOCKED — source/git divergence detected            │
└─────────────────────────────────────────────────────────────┘
…
  UNTRACKED (2) — never `git add`-ed:
    + apps/web/src/pages/dashboard/popa.astro
    + apps/web/src/pages/tools/eu-ai-act-compliance.astro
  MODIFIED (1) — tracked but uncommitted:
    ~ apps/web/src/content/blog/git-history-attack-surface.md
EXIT=1
```

### Test 2 — wired into `bun run deploy`, aborts before build

```
$ cd apps/web && bun run deploy
$ bun ../../tools/preflight-deploy-guard.ts && bun run build && bun deploy.ts
… same blocked output …
error: script "deploy" exited with code 1
DEPLOY_EXIT=1
```

`astro build` and `deploy.ts` are never reached. No `dist/` is produced,
no upload to Cloudflare happens.

### Test 3 — `DEPLOY_FORCE=1` overrides

```
$ DEPLOY_FORCE=1 bun tools/preflight-deploy-guard.ts ; echo "FORCE_EXIT=$?"
… blocked output, then …
[preflight] DEPLOY_FORCE=1 set — proceeding despite divergence.
FORCE_EXIT=0
```

### Test 4 — clean working tree passes

```
$ git stash -u -- apps/web/src/pages/dashboard apps/web/src/pages/tools \
    apps/web/src/content/blog/git-history-attack-surface.md
$ bun tools/preflight-deploy-guard.ts ; echo "CLEAN_EXIT=$?"
[preflight] clean — every route source is tracked and committed.
CLEAN_EXIT=0
```

## Maintenance

If new content collections are added under `apps/web/src/content/`,
extend `ROUTE_SOURCE_DIRS` in the guard. The post-mortem audit
(`audit-deploy-divergence.ts`) and the pre-flight guard are
complementary, not redundant — keep both. The audit catches anything
that bypassed the guard (CDN edge files, deploys from another
machine/branch, manual `wrangler pages deploy` invocations).
