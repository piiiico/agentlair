#!/usr/bin/env bun
/**
 * preflight-deploy-guard.ts
 *
 * Pre-deploy enforcement for source/git divergence on agentlair.dev.
 *
 * Why this exists: deploy.ts walks `apps/web/dist/` (built from the local
 * working tree) and uploads via the Cloudflare Pages REST API. Any source
 * file in the working tree gets shipped — regardless of whether it is
 * tracked in git. That is exactly how five files (verify.astro,
 * behavioral.astro, reputation.astro, VerifyWidget.tsx, two blog posts)
 * went live without commits and had to be recovered from the live deploy
 * (commits 73a222f, 835787d, May 3 2026).
 *
 * audit-deploy-divergence.ts catches this *after* the fact, by querying
 * the live sitemap. This guard catches it *before* the upload happens, by
 * inspecting the local working tree against git.
 *
 * What this checks (every source file whose change can ship to production):
 *   - apps/web/src/pages/**\/*.{astro,mdx,md,tsx,ts}
 *   - apps/web/src/components/**\/*.{astro,mdx,md,tsx,ts}
 *   - apps/web/src/layouts/**\/*.{astro,mdx,md,tsx,ts}
 *   - apps/web/src/content/{blog,learn,whitepaper}/**\/*.{astro,mdx,md,tsx,ts}
 *
 * The components/layouts coverage and .tsx/.ts extensions exist because
 * Astro's `client:only="react"` islands ship as separate JS bundles. The
 * importing .astro page's source — and therefore its HTML hash — does not
 * change when the .tsx component changes, so a route-only surface lets
 * island edits deploy with no git commit. Concrete failure (2026-05-08):
 * editing apps/web/src/components/blocks/faq.tsx alone passed the guard
 * with no divergence, even though dist/_astro/faq.*.js shipped new content.
 * Same audit-divergence class as the May 3 incident, one directory deeper.
 *
 * Two failure classes:
 *   UNTRACKED — file exists locally, has zero git history (was never
 *               `git add`-ed). This is the recurring failure mode.
 *   MODIFIED  — file is tracked but has uncommitted changes. Deploy would
 *               ship the working-tree version that no commit captures.
 *
 * Escape hatch: DEPLOY_FORCE=1 logs a warning and exits 0. Use this only
 * when you have inspected the diff and intend to ship without a commit
 * (e.g. emergency rollback to a known-good build dir).
 *
 * Exit codes:
 *   0  clean, or DEPLOY_FORCE=1
 *   1  one or more divergences detected
 *   2  guard itself failed (git not a repo, etc.)
 *
 * Usage:
 *   bun tools/preflight-deploy-guard.ts
 *   DEPLOY_FORCE=1 bun tools/preflight-deploy-guard.ts
 */

import { execSync } from "node:child_process";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// Paths whose contents — directly or via a client:only React island — can
// reach the production deploy. The original surface excluded components and
// layouts on the theory that imports manifest in route bundle hashes. That
// theory holds for SSR / static .astro renders but breaks for client:only
// islands, whose JS bundle is a separate artifact. Widening the surface is
// noisier (every component edit becomes a divergence trigger) but keeps the
// gate honest. If the noise becomes painful, replace with an import-graph
// walker that resolves only the deps each route actually pulls in.
export const ROUTE_SOURCE_DIRS = [
  "apps/web/src/pages",
  "apps/web/src/components",
  "apps/web/src/layouts",
  "apps/web/src/content/blog",
  "apps/web/src/content/learn",
  "apps/web/src/content/whitepaper",
];

export const ROUTE_EXTS = /\.(astro|mdx|md|tsx|ts)$/;

function sh(cmd: string): string {
  return execSync(cmd, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] })
    .toString();
}

function untrackedRouteFiles(): string[] {
  const args = ROUTE_SOURCE_DIRS.map(d => `"${d}"`).join(" ");
  // --others = untracked, --exclude-standard = honor .gitignore
  const raw = sh(`git ls-files --others --exclude-standard ${args}`);
  return raw
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => ROUTE_EXTS.test(p));
}

function modifiedRouteFiles(): string[] {
  const args = ROUTE_SOURCE_DIRS.map(d => `"${d}"`).join(" ");
  // -- diff against HEAD covers both staged and unstaged
  const raw = sh(`git diff --name-only HEAD -- ${args}`);
  return raw
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => ROUTE_EXTS.test(p));
}

function main(): number {
  let untracked: string[];
  let modified: string[];
  try {
    untracked = untrackedRouteFiles();
    modified = modifiedRouteFiles();
  } catch (e) {
    console.error("[preflight] git inspection failed:", e);
    return 2;
  }

  const total = untracked.length + modified.length;

  if (total === 0) {
    console.log("[preflight] clean — every route source is tracked and committed.");
    return 0;
  }

  console.error("");
  console.error("┌─────────────────────────────────────────────────────────────┐");
  console.error("│  DEPLOY BLOCKED — source/git divergence detected            │");
  console.error("└─────────────────────────────────────────────────────────────┘");
  console.error("");
  console.error("Cloudflare Pages will ship whatever is in the local working tree.");
  console.error("These files would go live without a corresponding git commit:");
  console.error("");

  if (untracked.length) {
    console.error(`  UNTRACKED (${untracked.length}) — never \`git add\`-ed:`);
    for (const p of untracked) console.error(`    + ${p}`);
    console.error("");
  }
  if (modified.length) {
    console.error(`  MODIFIED (${modified.length}) — tracked but uncommitted:`);
    for (const p of modified) console.error(`    ~ ${p}`);
    console.error("");
  }

  console.error("Resolve by EITHER:");
  console.error("  1. Commit the changes:   git add <files> && git commit");
  console.error("  2. Discard them:         git checkout -- <files>  /  rm <untracked>");
  console.error("  3. Override (rare):      DEPLOY_FORCE=1 bun run deploy");
  console.error("");

  if (process.env.DEPLOY_FORCE === "1") {
    console.error("[preflight] DEPLOY_FORCE=1 set — proceeding despite divergence.");
    return 0;
  }

  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
