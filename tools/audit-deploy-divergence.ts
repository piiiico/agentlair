#!/usr/bin/env bun
/**
 * audit-deploy-divergence.ts
 *
 * Why this exists: a 14:02 reflection (May 3, 2026) surfaced that the
 * EdDSA-JWTs blog post was live on agentlair.dev but the markdown source
 * was untracked in git — Cloudflare Pages held the build artifact even
 * after the working tree forgot. "Local clean" is not "site clean."
 *
 * What this does: pulls every URL from the production sitemap, resolves
 * each to its expected Astro/content source file, and checks git history.
 * Reports two divergence classes:
 *
 *   ORPHAN_SOURCE  live route, source file has zero git history
 *                  (subdivided: ORPHAN_LOCAL — file exists locally untracked,
 *                              ORPHAN_GONE  — file does not exist locally)
 *   STALE_SOURCE   git-tracked source file with no live route at the
 *                  expected URL (HTTP 404 / 5xx)
 *
 * Designed to be re-runnable. Output: report-deploy-divergence.md at repo root.
 *
 * Usage:
 *   bun tools/audit-deploy-divergence.ts
 *   bun tools/audit-deploy-divergence.ts --json  # machine-readable
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const WEB_SRC = join(REPO_ROOT, "apps/web/src");
const SITE = "https://agentlair.dev";

// Routes we never expect to back with a single source file (collection indexes,
// API-driven pages, dynamic catch-alls). Listing them explicitly avoids false
// positives in either direction.
const DYNAMIC_OR_INDEX_ROUTES = new Set<string>([
  "/", // index.astro
  "/blog/", // blog/index.astro
  "/learn/", // learn/index.astro
  "/popa/", // popa/index.astro
  "/popa/leaderboard/", // popa/leaderboard.astro
  "/dashboard/", // dashboard.astro (index)
  "/dashboard/popa/", // dashboard/popa.astro
  "/docs/", // docs/index.astro
  "/eu-ai-act/", // eu-ai-act.mdx
  "/eu-ai-act/assess/", // eu-ai-act/assess.astro
  "/about/pico/", // about/pico.astro
  "/tools/eu-ai-act-compliance/", // tools/eu-ai-act-compliance.astro
]);

interface Finding {
  url: string;
  candidates: string[]; // repo-relative paths checked
  resolved: string | null; // first candidate that exists locally
  inGit: boolean;
  liveStatus: number | "unknown";
  classification:
    | "OK"
    | "ORPHAN_LOCAL"
    | "ORPHAN_GONE"
    | "STALE_SOURCE"
    | "DYNAMIC"
    | "UNRESOLVED";
}

function sh(cmd: string): string {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

async function fetchSitemapUrls(): Promise<string[]> {
  const indexXml = await fetch(`${SITE}/sitemap-index.xml`).then(r => r.text());
  const subSitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const urls: string[] = [];
  for (const sm of subSitemaps) {
    const xml = await fetch(sm).then(r => r.text());
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
  }
  return [...new Set(urls)].sort();
}

function urlToPath(url: string): string {
  // strip origin, ensure leading and trailing slash
  let p = url.replace(/^https?:\/\/[^/]+/, "");
  if (!p.endsWith("/")) p += "/";
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function candidatesFor(routePath: string): string[] {
  // routePath like "/blog/foo/" — drop leading and trailing slashes
  const segs = routePath.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
  if (segs.length === 0) return ["apps/web/src/pages/index.astro"];

  const out: string[] = [];
  const last = segs[segs.length - 1];

  // Content collections — Astro convention
  if (segs[0] === "blog" && segs.length === 2) {
    out.push(`apps/web/src/content/blog/${last}.md`);
    out.push(`apps/web/src/content/blog/${last}.mdx`);
  }
  if (segs[0] === "learn" && segs.length === 2) {
    out.push(`apps/web/src/content/learn/${last}.md`);
    out.push(`apps/web/src/content/learn/${last}.mdx`);
  }
  if (segs[0] === "whitepaper" && segs.length >= 1) {
    out.push(`apps/web/src/content/whitepaper/${segs.slice(1).join("/") || "index"}.md`);
  }

  // Pages directory — for any depth
  const pagesPath = segs.join("/");
  for (const ext of ["astro", "mdx", "md"]) {
    out.push(`apps/web/src/pages/${pagesPath}.${ext}`);
    out.push(`apps/web/src/pages/${pagesPath}/index.${ext}`);
  }

  return out;
}

function isInGit(repoRelPath: string): boolean {
  // Any history on any branch counts.
  const log = sh(`git log --all --oneline -- "${repoRelPath}"`);
  if (log) return true;
  // Also check if currently tracked (cached but never committed is unlikely
  // but possible — surface as tracked).
  const lsfiles = sh(`git ls-files --error-unmatch "${repoRelPath}" 2>/dev/null`);
  return Boolean(lsfiles);
}

async function liveStatus(url: string): Promise<number> {
  try {
    const r = await fetch(url, { redirect: "manual" });
    return r.status;
  } catch {
    return 0;
  }
}

function listTrackedContent(): string[] {
  const raw = sh(
    `git ls-files apps/web/src/content apps/web/src/pages`,
  );
  return raw.split("\n").filter(Boolean);
}

function pathToRoute(repoRelPath: string): string | null {
  // Inverse map for STALE_SOURCE pass.
  if (repoRelPath.startsWith("apps/web/src/content/blog/")) {
    const slug = repoRelPath.replace(/^apps\/web\/src\/content\/blog\//, "").replace(/\.(md|mdx)$/, "");
    if (slug === "index") return null;
    return `/blog/${slug}/`;
  }
  if (repoRelPath.startsWith("apps/web/src/content/learn/")) {
    const slug = repoRelPath.replace(/^apps\/web\/src\/content\/learn\//, "").replace(/\.(md|mdx)$/, "");
    return `/learn/${slug}/`;
  }
  if (repoRelPath.startsWith("apps/web/src/pages/")) {
    let p = repoRelPath.replace(/^apps\/web\/src\/pages\//, "").replace(/\.(astro|mdx|md)$/, "");
    // Skip dynamic routes — Astro [slug] templates aren't a single URL
    if (p.includes("[")) return null;
    if (p.endsWith("/index")) p = p.slice(0, -"/index".length);
    if (p === "index") return "/";
    return `/${p}/`;
  }
  return null;
}

async function main() {
  const jsonOnly = process.argv.includes("--json");
  const urls = await fetchSitemapUrls();
  if (!jsonOnly) console.error(`[sitemap] ${urls.length} URLs`);

  // Forward pass: live URL -> source file
  const findings: Finding[] = [];
  for (const url of urls) {
    const route = urlToPath(url);
    if (DYNAMIC_OR_INDEX_ROUTES.has(route)) {
      findings.push({
        url,
        candidates: [],
        resolved: null,
        inGit: true, // assumed — these are first-class index/dynamic templates
        liveStatus: "unknown",
        classification: "DYNAMIC",
      });
      continue;
    }

    const candidates = candidatesFor(route);
    const resolved = candidates.find(c => existsSync(join(REPO_ROOT, c))) ?? null;

    let classification: Finding["classification"];
    let inGit = false;

    if (resolved) {
      inGit = isInGit(resolved);
      classification = inGit ? "OK" : "ORPHAN_LOCAL";
    } else {
      // Source missing entirely — could be ORPHAN_GONE if URL is live, or
      // a dynamic route we forgot to whitelist. Confirm by checking liveness.
      classification = "ORPHAN_GONE";
    }

    findings.push({
      url,
      candidates,
      resolved,
      inGit,
      liveStatus: "unknown",
      classification,
    });
  }

  // Resolve liveness only for non-OK to keep the run cheap.
  for (const f of findings) {
    if (f.classification === "OK" || f.classification === "DYNAMIC") continue;
    f.liveStatus = await liveStatus(f.url);
    // 404 with no source -> not divergence, just dead URL in sitemap.
    if (f.classification === "ORPHAN_GONE" && f.liveStatus !== 200) {
      f.classification = "UNRESOLVED";
    }
  }

  // Inverse pass: tracked content -> live route
  const stale: Array<{ path: string; route: string; status: number }> = [];
  const tracked = listTrackedContent();
  for (const path of tracked) {
    if (!/\.(md|mdx|astro)$/.test(path)) continue;
    const route = pathToRoute(path);
    if (!route) continue;
    if (DYNAMIC_OR_INDEX_ROUTES.has(route)) continue;
    // If this route is already in the sitemap, it's live by construction.
    if (urls.some(u => urlToPath(u) === route)) continue;
    const status = await liveStatus(`${SITE}${route}`);
    if (status !== 200) {
      stale.push({ path, route, status });
    }
  }

  const summary = {
    sitemap_urls: urls.length,
    ok: findings.filter(f => f.classification === "OK").length,
    dynamic: findings.filter(f => f.classification === "DYNAMIC").length,
    orphan_local: findings.filter(f => f.classification === "ORPHAN_LOCAL").length,
    orphan_gone: findings.filter(f => f.classification === "ORPHAN_GONE").length,
    unresolved: findings.filter(f => f.classification === "UNRESOLVED").length,
    stale: stale.length,
  };

  if (jsonOnly) {
    console.log(JSON.stringify({ summary, findings, stale }, null, 2));
    return;
  }

  // Markdown report
  const lines: string[] = [];
  lines.push("# Deploy ↔ Git Divergence Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Site: ${SITE}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [k, v] of Object.entries(summary)) lines.push(`- **${k}**: ${v}`);
  lines.push("");

  const orphLocal = findings.filter(f => f.classification === "ORPHAN_LOCAL");
  if (orphLocal.length) {
    lines.push("## ORPHAN_LOCAL — live, source untracked");
    lines.push("");
    lines.push("Source file exists locally but has zero git history. Highest priority — file loss on container rebuild.");
    lines.push("");
    for (const f of orphLocal) lines.push(`- \`${f.resolved}\` → ${f.url}`);
    lines.push("");
  }

  const orphGone = findings.filter(f => f.classification === "ORPHAN_GONE");
  if (orphGone.length) {
    lines.push("## ORPHAN_GONE — live, source missing locally");
    lines.push("");
    lines.push("URL is live (HTTP 200) but no candidate source file exists locally. Recoverable from CDN; document or scrape.");
    lines.push("");
    for (const f of orphGone) {
      lines.push(`- ${f.url}`);
      lines.push(`  - tried: ${f.candidates.slice(0, 3).join(", ")}${f.candidates.length > 3 ? "…" : ""}`);
    }
    lines.push("");
  }

  if (stale.length) {
    lines.push("## STALE_SOURCE — tracked, not live");
    lines.push("");
    lines.push("Source committed but route returns non-200. Either deploy is behind, or route is intentionally hidden.");
    lines.push("");
    for (const s of stale) lines.push(`- \`${s.path}\` → ${s.route} (HTTP ${s.status})`);
    lines.push("");
  }

  const unresolved = findings.filter(f => f.classification === "UNRESOLVED");
  if (unresolved.length) {
    lines.push("## UNRESOLVED — sitemap entry without live page or local source");
    lines.push("");
    for (const f of unresolved) lines.push(`- ${f.url} (HTTP ${f.liveStatus})`);
    lines.push("");
  }

  const reportPath = join(REPO_ROOT, "report-deploy-divergence.md");
  writeFileSync(reportPath, lines.join("\n"));
  console.error(`[report] wrote ${relative(REPO_ROOT, reportPath)}`);
  console.error(`[summary] ${JSON.stringify(summary)}`);

  // Exit code: non-zero if anything needs attention.
  const needsAction = summary.orphan_local + summary.orphan_gone + summary.stale;
  process.exit(needsAction === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
