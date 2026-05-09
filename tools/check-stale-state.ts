#!/usr/bin/env bun
/**
 * check-stale-state.ts
 *
 * Triage stale files in the agentlair monorepo working tree. Companion to
 * preflight-deploy-guard.ts: where the guard refuses to deploy when divergence
 * exists, this tool tells you *what kind* of divergence each file is and *how*
 * to clear it without re-reading 40+ files by hand.
 *
 * Why this exists: two autonomous sessions on 2026-05-09 hit the same blocker
 * — 40+ uncommitted files, 60+ unpushed commits — and worked around it twice
 * with DEPLOY_FORCE=1. The principle "Recurring failures need skills, not more
 * principles. Skills are also text. If a pattern recurs after a skill covers
 * it, the text failed — escalate to code enforcement immediately." applies.
 * This is the code enforcement.
 *
 * What it does:
 *   1. Walks `git status --porcelain` to collect every uncommitted entry.
 *   2. Classifies each by path heuristics into one of:
 *        commit-as-is        — a coherent change in a known-publishable surface
 *        gitignore-or-revert — build artifact that shouldn't be tracked
 *        keep-WIP            — draft/scratch content not meant to ship
 *        inspect-manually    — paired with another file or unfamiliar surface
 *   3. Prints a fix-script you can pipe to `bash` (commit groups + push).
 *
 * Exit codes:
 *   0  drift ≤ DRIFT_THRESHOLD (default 5)
 *   1  drift > DRIFT_THRESHOLD (deploy.ts pre-flight should refuse)
 *   2  tool itself failed (not a git repo, git not on PATH, etc.)
 *
 * Usage:
 *   bun tools/check-stale-state.ts                  # report only
 *   bun tools/check-stale-state.ts --threshold 10   # custom drift bound
 *   bun tools/check-stale-state.ts --json           # machine-readable
 *   bun tools/check-stale-state.ts --fix-script     # only the bash one-shot
 *
 * The classifier is intentionally conservative — anything outside the known
 * categories falls to `inspect-manually`. Better to over-trigger triage than
 * to silently mis-classify a real WIP file as commit-ready.
 */

import { execSync } from "node:child_process";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

export type Action =
  | "commit-as-is"
  | "gitignore-or-revert"
  | "keep-WIP"
  | "inspect-manually";

export type Category =
  | "blog-content"
  | "page-tracked"
  | "page-untracked"
  | "component"
  | "layout"
  | "content-research"
  | "package-impl"
  | "package-doc"
  | "tool-impl"
  | "tool-test"
  | "docs"
  | "audit-report"
  | "build-artifact"
  | "draft-content"
  | "config"
  | "unknown";

export interface Entry {
  /** Two-character porcelain code, e.g. " M", "??", "MM". */
  status: string;
  /** Path relative to REPO_ROOT. */
  path: string;
  /** True if file is untracked (porcelain "??"). */
  untracked: boolean;
  category: Category;
  action: Action;
  /** Short why-this-classification string for the report. */
  reason: string;
}

/** ─── Classifier ─────────────────────────────────────────────────────────── */

const RX = {
  blogContent: /^apps\/web\/src\/content\/blog\/.+\.(md|mdx)$/,
  contentCollection:
    /^apps\/web\/src\/content\/(learn|whitepaper)\/.+\.(md|mdx)$/,
  pageRoute: /^apps\/web\/src\/pages\/.+\.(astro|mdx|md)$/,
  component: /^apps\/web\/src\/components\/.+\.(tsx|ts|astro)$/,
  layout: /^apps\/web\/src\/layouts\/.+\.(astro|tsx|ts)$/,
  contentResearch: /^content\/.+\.(md|mdx)$/,
  packageSrc: /^packages\/[^/]+\/src\/.+\.(ts|tsx|js|jsx|sol)$/,
  packageTest: /^packages\/[^/]+\/.+\.test\.(ts|tsx)$/,
  packageDoc: /^packages\/[^/]+\/(README|CHANGELOG)\.md$/,
  packageConfig: /^packages\/[^/]+\/(package\.json|tsconfig\.json|tsup\.config\.ts)$/,
  toolImpl: /^tools\/[^/]+\.ts$/,
  toolTest: /^tools\/[^/]+\.test\.ts$/,
  docs: /^docs\/.+\.(md|mdx)$/,
  rootAudit: /^(conversion-path-audit|report-deploy-divergence|.*-audit-\d{4}-\d{2}-\d{2})\.md$/,
  whitepaper: /^whitepaper\/.+\.md$/,
  buildArtifact:
    /(^|\/)(node_modules|dist|dist-bundle|dist-check|\.wrangler|\.pipeline|out|cache|broadcast)\//,
  tsbuildinfo: /\.tsbuildinfo$/,
  draftDir: /(^|\/)drafts?\//,
  scratchExt: /\.(html|txt|xml)$/,
  rootConfig:
    /^(\.gitignore|\.gitattributes|\.editorconfig|wrangler\.toml|astro\.config\.(mjs|ts)|package\.json|tsconfig\.json)$/,
  appConfig:
    /^apps\/[^/]+\/(package\.json|tsconfig\.json|astro\.config\.(mjs|ts)|wrangler\.toml)$/,
  socialContent: /^content\/social\/.+\.md$/,
};

export function classify(path: string, untracked: boolean): {
  category: Category;
  action: Action;
  reason: string;
} {
  if (RX.buildArtifact.test(path) || RX.tsbuildinfo.test(path)) {
    return {
      category: "build-artifact",
      action: "gitignore-or-revert",
      reason: "build output — should be in .gitignore",
    };
  }
  if (RX.draftDir.test(path) || (untracked && RX.scratchExt.test(path))) {
    return {
      category: "draft-content",
      action: "keep-WIP",
      reason: "draft/scratch — not meant to ship",
    };
  }
  if (RX.blogContent.test(path) || RX.contentCollection.test(path)) {
    return {
      category: "blog-content",
      action: "commit-as-is",
      reason: "blog/content collection edit",
    };
  }
  if (RX.pageRoute.test(path)) {
    return {
      category: untracked ? "page-untracked" : "page-tracked",
      action: "commit-as-is",
      reason: untracked
        ? "new public route — anything here ships on next deploy"
        : "page edit on tracked route",
    };
  }
  if (RX.component.test(path)) {
    return {
      category: "component",
      action: "commit-as-is",
      reason: "component change — preflight surface",
    };
  }
  if (RX.layout.test(path)) {
    return {
      category: "layout",
      action: "commit-as-is",
      reason: "layout change — preflight surface",
    };
  }
  if (RX.socialContent.test(path)) {
    return {
      category: "content-research",
      action: "commit-as-is",
      reason: "social-content draft",
    };
  }
  if (RX.contentResearch.test(path) || RX.whitepaper.test(path)) {
    return {
      category: "content-research",
      action: "commit-as-is",
      reason: "content/whitepaper edit",
    };
  }
  if (RX.toolTest.test(path)) {
    return {
      category: "tool-test",
      action: "commit-as-is",
      reason: "tool test — pair with implementation",
    };
  }
  if (RX.toolImpl.test(path)) {
    return {
      category: "tool-impl",
      action: "commit-as-is",
      reason: "tool source — pair with test if present",
    };
  }
  if (RX.packageTest.test(path)) {
    return {
      category: "package-impl",
      action: "commit-as-is",
      reason: "package test",
    };
  }
  if (RX.packageSrc.test(path)) {
    return {
      category: "package-impl",
      action: "commit-as-is",
      reason: "package source",
    };
  }
  if (RX.packageDoc.test(path)) {
    return {
      category: "package-doc",
      action: "commit-as-is",
      reason: "package README/CHANGELOG",
    };
  }
  if (RX.packageConfig.test(path)) {
    return {
      category: "package-impl",
      action: "commit-as-is",
      reason: "package manifest/tsconfig",
    };
  }
  if (RX.docs.test(path)) {
    return {
      category: "docs",
      action: "commit-as-is",
      reason: "docs change",
    };
  }
  if (RX.rootAudit.test(path)) {
    return {
      category: "audit-report",
      action: "commit-as-is",
      reason: "audit report at repo root",
    };
  }
  if (RX.rootConfig.test(path)) {
    return {
      category: "config",
      action: "commit-as-is",
      reason: "root config file",
    };
  }
  if (RX.appConfig.test(path)) {
    return {
      category: "config",
      action: "commit-as-is",
      reason: "app-level config file",
    };
  }
  return {
    category: "unknown",
    action: "inspect-manually",
    reason: "no classifier rule matched",
  };
}

/** ─── Git inspection ─────────────────────────────────────────────────────── */

function sh(cmd: string): string {
  // Don't .trim() — git porcelain output has significant leading whitespace
  // ("[space]M file") that disambiguates between staged vs working-tree
  // changes. Strip only the trailing newline.
  return execSync(cmd, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .replace(/\n$/, "");
}

export function parsePorcelain(porcelain: string): Entry[] {
  if (!porcelain) return [];
  // Trim only trailing newlines, never leading spaces — those carry
  // information in the porcelain format.
  const lines = porcelain.replace(/\n+$/, "").split("\n").filter((l) => l.length > 0);
  const entries: Entry[] = [];
  // Format: `XY[space]path` where X=index, Y=worktree. Either char can be
  // a literal space (e.g. " M" = unstaged modify, "M " = staged modify).
  // For untracked: "?? path". For renames: "R  old -> new".
  const RE = /^(.{2}) (.+)$/;
  for (const line of lines) {
    const m = line.match(RE);
    if (!m) continue;
    const status = m[1]!;
    const rest = m[2]!;
    let path = rest;
    if (status.startsWith("R") || status.startsWith("C")) {
      const arrow = rest.indexOf(" -> ");
      if (arrow >= 0) path = rest.slice(arrow + 4);
    }
    // Strip optional surrounding quotes git adds for paths with spaces.
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    const untracked = status === "??";
    const cls = classify(path, untracked);
    entries.push({
      status,
      path,
      untracked,
      category: cls.category,
      action: cls.action,
      reason: cls.reason,
    });
  }
  return entries;
}

export function unpushedCount(): number {
  try {
    const n = sh("git rev-list --count origin/main..HEAD");
    return Number.parseInt(n, 10) || 0;
  } catch {
    return 0;
  }
}

/** ─── Reporting ──────────────────────────────────────────────────────────── */

export function groupByCategory(
  entries: Entry[],
): Record<Category, Entry[]> {
  const out: Record<string, Entry[]> = {};
  for (const e of entries) {
    (out[e.category] ||= []).push(e);
  }
  return out as Record<Category, Entry[]>;
}

const ACTION_ICON: Record<Action, string> = {
  "commit-as-is": "+",
  "gitignore-or-revert": "x",
  "keep-WIP": "·",
  "inspect-manually": "?",
};

function shellQuote(p: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export function buildFixScript(entries: Entry[]): string {
  const out: string[] = [];
  out.push("#!/usr/bin/env bash");
  out.push("# Generated by tools/check-stale-state.ts — review before running.");
  out.push("set -euo pipefail");
  out.push("cd " + shellQuote(REPO_ROOT));
  out.push("");

  const byCat = groupByCategory(entries.filter((e) => e.action === "commit-as-is"));
  const ORDER: Category[] = [
    "blog-content",
    "page-untracked",
    "page-tracked",
    "component",
    "layout",
    "content-research",
    "package-impl",
    "package-doc",
    "tool-impl",
    "tool-test",
    "docs",
    "audit-report",
    "config",
  ];
  const COMMIT_MSG: Partial<Record<Category, string>> = {
    "blog-content": "content: blog updates",
    "page-untracked": "pages: add new public routes",
    "page-tracked": "pages: update existing routes",
    component: "components: update shared blocks",
    layout: "layouts: update shared layouts",
    "content-research": "content: research/social/whitepaper updates",
    "package-impl": "packages: source changes",
    "package-doc": "packages: docs/changelog updates",
    "tool-impl": "tools: implementation changes",
    "tool-test": "tools: test changes",
    docs: "docs: integration/audit updates",
    "audit-report": "docs: audit reports",
    config: "config: root config updates",
  };

  let wrote = false;
  for (const cat of ORDER) {
    const list = byCat[cat];
    if (!list || list.length === 0) continue;
    wrote = true;
    out.push(`# ${cat} (${list.length})`);
    const paths = list.map((e) => shellQuote(e.path)).join(" ");
    out.push(`git add ${paths}`);
    const msg = COMMIT_MSG[cat] ?? cat;
    out.push(`git commit -m ${shellQuote(msg)}`);
    out.push("");
  }

  const ignore = entries.filter((e) => e.action === "gitignore-or-revert");
  if (ignore.length) {
    out.push("# build artifacts — add to .gitignore (DO NOT git add):");
    for (const e of ignore) out.push(`#   ${e.path}`);
    out.push("");
  }
  const wip = entries.filter((e) => e.action === "keep-WIP");
  if (wip.length) {
    out.push("# WIP/draft — leave alone or move outside repo:");
    for (const e of wip) out.push(`#   ${e.path}`);
    out.push("");
  }
  const inspect = entries.filter((e) => e.action === "inspect-manually");
  if (inspect.length) {
    out.push("# inspect manually — classifier didn't match:");
    for (const e of inspect) out.push(`#   ${e.path}`);
    out.push("");
  }

  if (wrote) {
    out.push("git push origin main");
  } else {
    out.push("# (no commit-as-is entries — nothing to push)");
  }
  return out.join("\n");
}

export function renderReport(
  entries: Entry[],
  unpushed: number,
  threshold: number,
): string {
  const out: string[] = [];
  out.push("");
  out.push("┌─────────────────────────────────────────────────────────────┐");
  out.push("│  agentlair monorepo — stale state audit                     │");
  out.push("└─────────────────────────────────────────────────────────────┘");
  out.push("");
  out.push(`  uncommitted: ${entries.length}  threshold: ${threshold}`);
  out.push(`  unpushed commits ahead of origin/main: ${unpushed}`);
  out.push("");

  const byCat = groupByCategory(entries);
  const cats = Object.keys(byCat).sort() as Category[];
  for (const cat of cats) {
    const list = byCat[cat];
    out.push(`  ${cat} (${list.length})`);
    for (const e of list) {
      const icon = ACTION_ICON[e.action];
      const tag = e.untracked ? "??" : e.status;
      out.push(`    ${icon} [${tag}] ${e.path}`);
      out.push(`        → ${e.action}: ${e.reason}`);
    }
    out.push("");
  }

  out.push("  legend:");
  out.push("    +  commit-as-is        ready for a squash-commit by category");
  out.push("    x  gitignore-or-revert build artifact — should not be tracked");
  out.push("    ·  keep-WIP            intentional draft — leave alone");
  out.push("    ?  inspect-manually    no classifier match — read it");
  out.push("");
  out.push("  next:");
  out.push("    bun tools/check-stale-state.ts --fix-script | bash");
  out.push("");
  return out.join("\n");
}

/** ─── CLI ────────────────────────────────────────────────────────────────── */

interface Cli {
  threshold: number;
  json: boolean;
  fixScript: boolean;
}

export function parseArgs(argv: string[]): Cli {
  let threshold = Number.parseInt(process.env.STALE_THRESHOLD ?? "5", 10);
  if (!Number.isFinite(threshold) || threshold < 0) threshold = 5;
  let json = false;
  let fixScript = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--threshold" && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1]!, 10);
      if (Number.isFinite(n) && n >= 0) threshold = n;
      i++;
    } else if (a?.startsWith("--threshold=")) {
      const n = Number.parseInt(a.split("=")[1]!, 10);
      if (Number.isFinite(n) && n >= 0) threshold = n;
    } else if (a === "--json") json = true;
    else if (a === "--fix-script") fixScript = true;
  }
  return { threshold, json, fixScript };
}

export function run(cli: Cli): {
  entries: Entry[];
  unpushed: number;
  exitCode: number;
} {
  const porcelain = sh("git status --porcelain=1");
  const entries = parsePorcelain(porcelain);
  const unpushed = unpushedCount();
  const exitCode = entries.length > cli.threshold ? 1 : 0;
  return { entries, unpushed, exitCode };
}

export function main(argv: string[]): number {
  const cli = parseArgs(argv);
  let result;
  try {
    result = run(cli);
  } catch (e) {
    console.error("[check-stale-state] git inspection failed:", e);
    return 2;
  }
  const { entries, unpushed, exitCode } = result;

  if (cli.fixScript) {
    process.stdout.write(buildFixScript(entries) + "\n");
    return exitCode;
  }
  if (cli.json) {
    process.stdout.write(
      JSON.stringify(
        {
          unpushed,
          threshold: cli.threshold,
          drift: entries.length,
          entries,
        },
        null,
        2,
      ) + "\n",
    );
    return exitCode;
  }
  process.stdout.write(renderReport(entries, unpushed, cli.threshold));
  if (exitCode === 1) {
    console.error(
      `[check-stale-state] drift ${entries.length} > threshold ${cli.threshold} — fix before deploying.`,
    );
    if (process.env.DEPLOY_FORCE === "1") {
      console.error(
        "[check-stale-state] DEPLOY_FORCE=1 set — proceeding despite drift.",
      );
      return 0;
    }
  }
  return exitCode;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
