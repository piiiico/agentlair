#!/usr/bin/env bun
/**
 * check-cf-self-fetch.ts
 *
 * Pre-deploy gate: scan worker source for raw `fetch()` calls that target
 * the worker's own origin. Cloudflare Workers cannot fetch their own
 * origin — the call returns HTTP 522 in production. Bun tests can't
 * surface this because the CF runtime is the only place it manifests.
 *
 * Why this exists: 2026-05-13 self-card audit endpoint deployed clean —
 * 841 Bun tests passed, pipeline review APPROVED, deploy succeeded —
 * but production returned 522 on the self-referential request. The fix
 * was to bypass the fetch for self-host URLs (per route), but nothing
 * prevented the next self-fetch from shipping the same way. This is the
 * gate. Companion: packages/worker/src/lib/safe-fetch.ts (ratchet 2,
 * runtime guard).
 *
 * What it does:
 *   1. Reads .cf-self-fetch-config.json (optional) and each scanned
 *      package's wrangler.toml to derive SELF_HOSTS:
 *        - explicit selfHosts entries from config
 *        - `<worker_name>.workers.dev` + `<worker_name>.*.workers.dev`
 *          per worker
 *   2. Walks packages/worker/src/**\/*.ts (configurable). Excludes
 *      `*.test.ts` and `__test__/` directories by default.
 *   3. Parses each file with the TypeScript compiler. For every
 *      CallExpression where the function is the bare identifier `fetch`,
 *      resolves the first argument:
 *        - StringLiteral / NoSubstitutionTemplate → URL.host
 *        - TemplateExpression with constant-prefix head → host via regex
 *   4. Flags any URL whose host matches a SELF_HOSTS pattern. Allows
 *      opt-out via `// cf-self-fetch-ok: <reason>` on the same line, or
 *      via an allowlist file.
 *
 * Exit codes:
 *   0  no violations, or DEPLOY_FORCE=1
 *   1  violations detected
 *   2  tool itself failed (missing wrangler, parse error, etc.)
 *
 * Usage:
 *   bun tools/check-cf-self-fetch.ts                        # report
 *   bun tools/check-cf-self-fetch.ts --json                 # machine output
 *   bun tools/check-cf-self-fetch.ts --include-tests        # scan *.test.ts too
 *   bun tools/check-cf-self-fetch.ts --paths a.ts,b.ts      # scan specific files
 *   DEPLOY_FORCE=1 bun tools/check-cf-self-fetch.ts         # bypass (logged)
 *
 * The tool is intentionally narrow: it scans for the exact failure mode
 * (raw fetch() to a self-host) and treats anything else as out of scope.
 * Wider patterns (catching method-call fetches, env-var URLs) produce
 * false positives — preferred behavior is "no false positives" so the
 * gate isn't disabled in frustration.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

// ─── Types ───────────────────────────────────────────────────────────

export interface CheckConfig {
  /** Patterns interpreted by matchHost (exact, *.foo.com, foo.*.bar.com). */
  selfHosts: string[];
  /** Wrangler.toml paths whose `name` field contributes additional patterns. */
  wranglerPaths: string[];
  /** Root directories to scan (relative to REPO_ROOT). */
  scanRoots: string[];
  /** Path to a one-violation-per-line allowlist file (optional). */
  allowlistFile?: string;
}

export interface Violation {
  path: string;     // relative to REPO_ROOT
  line: number;     // 1-indexed
  col: number;      // 1-indexed
  host: string;     // resolved host (or "?" when only partial)
  url: string;      // resolved URL string (or fragment for templates)
  pattern: string;  // SELF_HOSTS entry that matched
  /** When the resolver couldn't fully determine the URL, this notes the gap. */
  note?: string;
}

export interface RunOptions {
  includeTests: boolean;
  paths: string[] | null;  // explicit file list overrides scanRoots
  json: boolean;
  force: boolean;          // DEPLOY_FORCE=1 equivalent
  help: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────

export const REPO_ROOT_DEFAULT = '/workspace/agentlair';

export const DEFAULT_CONFIG: CheckConfig = {
  selfHosts: [
    'agentlair.dev',
    '*.agentlair.dev',
  ],
  wranglerPaths: [
    'packages/worker/wrangler.toml',
  ],
  scanRoots: [
    'packages/worker/src',
  ],
  allowlistFile: 'tools/.cf-self-fetch-allow',
};

/** Same wildcard semantics as packages/worker/src/lib/safe-fetch.ts. */
export function matchHost(host: string, pattern: string): boolean {
  if (pattern === host) return true;
  if (!pattern.includes('*')) return false;
  const pLabels = pattern.split('.');
  const hLabels = host.split('.');
  if (pLabels[0] === '*') {
    const tailPattern = pLabels.slice(1);
    if (hLabels.length < tailPattern.length + 1) return false;
    const hTail = hLabels.slice(hLabels.length - tailPattern.length);
    return tailPattern.every((p, i) => (p === '*' ? true : p === hTail[i]));
  }
  if (pLabels.length !== hLabels.length) return false;
  return pLabels.every((p, i) => p === '*' || p === hLabels[i]);
}

export function findMatchingPattern(
  host: string,
  patterns: readonly string[],
): string | null {
  for (const p of patterns) {
    if (matchHost(host, p)) return p;
  }
  return null;
}

// ─── Config loading ──────────────────────────────────────────────────

export function loadConfig(repoRoot: string, override?: Partial<CheckConfig>): CheckConfig {
  // Optional .cf-self-fetch-config.json at the repo root.
  const overlay: Partial<CheckConfig> = override ?? {};
  const configPath = join(repoRoot, '.cf-self-fetch-config.json');
  if (existsSync(configPath) && !override) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      Object.assign(overlay, raw);
    } catch (e) {
      throw new Error(`.cf-self-fetch-config.json invalid: ${(e as Error).message}`);
    }
  }
  return {
    selfHosts: overlay.selfHosts ?? DEFAULT_CONFIG.selfHosts,
    wranglerPaths: overlay.wranglerPaths ?? DEFAULT_CONFIG.wranglerPaths,
    scanRoots: overlay.scanRoots ?? DEFAULT_CONFIG.scanRoots,
    allowlistFile: 'allowlistFile' in overlay
      ? overlay.allowlistFile
      : DEFAULT_CONFIG.allowlistFile,
  };
}

/**
 * Extract additional self-host patterns from a wrangler.toml file by
 * reading the `name = "..."` field and emitting `<name>.workers.dev`
 * patterns. Throws if the file is missing OR malformed (no name field).
 */
export function deriveWranglerHosts(wranglerToml: string): string[] {
  const m = wranglerToml.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (!m) {
    throw new Error('wrangler.toml: no `name = "..."` field found');
  }
  const name = m[1]!;
  return [
    `${name}.workers.dev`,
    `${name}.*.workers.dev`,
  ];
}

export function resolveSelfHosts(repoRoot: string, cfg: CheckConfig): string[] {
  const out = [...cfg.selfHosts];
  for (const wp of cfg.wranglerPaths) {
    const full = join(repoRoot, wp);
    if (!existsSync(full)) {
      throw new Error(`wrangler.toml not found at ${wp}`);
    }
    const text = readFileSync(full, 'utf8');
    out.push(...deriveWranglerHosts(text));
  }
  // De-duplicate while preserving order.
  return Array.from(new Set(out.map((s) => s.toLowerCase())));
}

// ─── Allowlist ───────────────────────────────────────────────────────

export interface AllowlistEntry {
  path: string;
  line: number;
}

export function parseAllowlistFile(text: string): AllowlistEntry[] {
  const out: AllowlistEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(.+):(\d+)$/);
    if (!m) continue;
    out.push({ path: m[1]!.trim(), line: Number.parseInt(m[2]!, 10) });
  }
  return out;
}

// ─── File discovery ──────────────────────────────────────────────────

export function isTestPath(relPath: string): boolean {
  return relPath.endsWith('.test.ts') ||
    relPath.endsWith('.spec.ts') ||
    relPath.split('/').includes('__test__') ||
    relPath.split('/').includes('__tests__');
}

export function walkTsFiles(
  rootAbs: string,
  rootRel: string,
  out: string[] = [],
): string[] {
  if (!existsSync(rootAbs)) return out;
  const stack: string[] = [rootAbs];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Skip node_modules + dist nests.
        if (name === 'node_modules' || name === 'dist' || name === '.pipeline') continue;
        stack.push(abs);
      } else if (st.isFile() && abs.endsWith('.ts') && !abs.endsWith('.d.ts')) {
        out.push(abs);
      }
    }
  }
  out.sort();
  return out;
}

// ─── Source parsing ──────────────────────────────────────────────────

/**
 * Walk the AST and locate every `fetch(URL, ...)` call expression where
 * the callee is the bare identifier `fetch` (NOT `obj.fetch(...)`).
 *
 * For each such site, return the first argument's TypeScript node — the
 * caller resolves it to a URL string.
 */
export interface FetchSite {
  node: ts.CallExpression;
  arg0: ts.Expression;
  line: number;
  col: number;
  /** Trailing comment on the same source line (for allowlist matching). */
  lineComment: string;
}

export function findFetchCalls(sf: ts.SourceFile): FetchSite[] {
  const out: FetchSite[] = [];
  const fullText = sf.getFullText();

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      // Bare identifier "fetch" — NOT `obj.fetch(...)` (DO stubs, Hono apps).
      // Also skip "safeFetch" (already has runtime guard).
      if (ts.isIdentifier(expr) && expr.text === 'fetch' && node.arguments.length >= 1) {
        const arg0 = node.arguments[0]!;
        const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const lineEnd = lineEndOffset(fullText, node.getStart(sf));
        const after = fullText.slice(node.getEnd(), lineEnd);
        const commentMatch = after.match(/\/\/\s*(.*)$/);
        out.push({
          node,
          arg0,
          line: start.line + 1,
          col: start.character + 1,
          lineComment: commentMatch ? commentMatch[1]!.trim() : '',
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

function lineEndOffset(text: string, fromPos: number): number {
  const nl = text.indexOf('\n', fromPos);
  return nl < 0 ? text.length : nl;
}

/**
 * Resolve a first-argument expression to a (host, urlSnippet) pair.
 * Returns null when the expression is not a URL-bearing literal (e.g.
 * variable reference) — the caller treats those as unresolvable and
 * does not flag them (false-positive avoidance).
 */
export function resolveFetchUrl(
  arg: ts.Expression,
): { host: string; url: string; partial: boolean } | null {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    const text = arg.text;
    return hostFromUrlSnippet(text, /*partial=*/false);
  }
  if (ts.isTemplateExpression(arg)) {
    // `https://host/...${x}/...` — host is in the head if it's a constant prefix.
    const head = arg.head.text;
    return hostFromUrlSnippet(head + '__TPL__', /*partial=*/true);
  }
  return null;
}

function hostFromUrlSnippet(
  snippet: string,
  partial: boolean,
): { host: string; url: string; partial: boolean } | null {
  const m = snippet.match(/^(https?:\/\/[^/\s$`'"]+)/i);
  if (!m) return null;
  const host = (() => {
    try {
      return new URL(m[1]!).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (!host) return null;
  return { host, url: snippet, partial };
}

// ─── Top-level scan ──────────────────────────────────────────────────

export interface ScanInput {
  repoRoot: string;
  config: CheckConfig;
  selfHosts: string[];
  files: string[];           // absolute paths
  includeTests: boolean;
  allowlist: AllowlistEntry[];
}

export function scanFile(
  absPath: string,
  input: ScanInput,
): Violation[] {
  const rel = relative(input.repoRoot, absPath);
  if (!input.includeTests && isTestPath(rel)) return [];

  const text = readFileSync(absPath, 'utf8');
  const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, /*setParentNodes=*/true);
  const sites = findFetchCalls(sf);
  const out: Violation[] = [];

  for (const s of sites) {
    const resolved = resolveFetchUrl(s.arg0);
    if (!resolved) continue;
    const matchedPattern = findMatchingPattern(resolved.host, input.selfHosts);
    if (!matchedPattern) continue;

    // Allowlist: same-line comment.
    if (/^cf-self-fetch-ok\s*[:\-]/i.test(s.lineComment)) continue;

    // Allowlist: external file entry.
    if (input.allowlist.some((e) => e.path === rel && e.line === s.line)) continue;

    out.push({
      path: rel,
      line: s.line,
      col: s.col,
      host: resolved.host,
      url: resolved.url,
      pattern: matchedPattern,
      ...(resolved.partial ? { note: 'partial URL (template literal head)' } : {}),
    });
  }
  return out;
}

export function runScan(input: ScanInput): Violation[] {
  const out: Violation[] = [];
  for (const f of input.files) {
    out.push(...scanFile(f, input));
  }
  return out;
}

// ─── Reporting ───────────────────────────────────────────────────────

export function renderReport(violations: Violation[], selfHosts: string[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('┌─────────────────────────────────────────────────────────────┐');
  lines.push('│  CF Workers self-fetch gate — packages/worker/src            │');
  lines.push('└─────────────────────────────────────────────────────────────┘');
  lines.push('');
  lines.push(`  self-host patterns checked (${selfHosts.length}):`);
  for (const h of selfHosts) lines.push(`    - ${h}`);
  lines.push('');
  if (violations.length === 0) {
    lines.push('  no violations — deploy may proceed.');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`  ${violations.length} violation(s) found:`);
  for (const v of violations) {
    lines.push('');
    lines.push(`    ${v.path}:${v.line}:${v.col}`);
    lines.push(`      fetch host: ${v.host}  (matched pattern: ${v.pattern})`);
    lines.push(`      url snippet: ${v.url}${v.note ? '  [' + v.note + ']' : ''}`);
  }
  lines.push('');
  lines.push('  remediation options:');
  lines.push('    1. Use packages/worker/src/lib/safe-fetch.ts — wrap the call in');
  lines.push('       `safeFetch(...)`. The runtime guard refuses self-fetches.');
  lines.push('    2. Inline the response. CF Workers can build the answer in-memory');
  lines.push('       (see routes/badge.ts:432 — buildSignedAgentCard).');
  lines.push('    3. Genuine emergency: add `// cf-self-fetch-ok: <reason>` to the');
  lines.push('       same line as the fetch() call, with a clear rationale.');
  lines.push('');
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────

export function parseArgs(argv: readonly string[]): RunOptions {
  const out: RunOptions = {
    includeTests: false,
    paths: null,
    json: false,
    force: process.env.DEPLOY_FORCE === '1',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--include-tests') out.includeTests = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--paths' && argv[i + 1]) {
      out.paths = argv[i + 1]!.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (a?.startsWith('--paths=')) {
      out.paths = a.split('=')[1]!.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

const USAGE = `Usage: bun tools/check-cf-self-fetch.ts [options]

Options:
  --json            machine-readable output
  --include-tests   also scan *.test.ts and __test__/** files
  --paths a,b       scan only these paths (relative to repo root)
  -h, --help        print this message

Environment:
  DEPLOY_FORCE=1    bypass the gate (logged, audit-trail intent)

Exit codes:
  0  no violations (or DEPLOY_FORCE=1)
  1  violations detected
  2  tool failure
`;

export interface MainResult {
  exitCode: number;
  violations: Violation[];
  selfHosts: string[];
}

export function main(
  argv: readonly string[],
  repoRoot: string = REPO_ROOT_DEFAULT,
  out: { write: (s: string) => void } = process.stdout,
  err: { write: (s: string) => void } = process.stderr,
): MainResult {
  const cli = parseArgs(argv);
  if (cli.help) {
    out.write(USAGE);
    return { exitCode: 0, violations: [], selfHosts: [] };
  }
  let cfg: CheckConfig;
  let selfHosts: string[];
  try {
    cfg = loadConfig(repoRoot);
    selfHosts = resolveSelfHosts(repoRoot, cfg);
  } catch (e) {
    err.write(`[check-cf-self-fetch] ${(e as Error).message}\n`);
    return { exitCode: 2, violations: [], selfHosts: [] };
  }

  // File set.
  let files: string[];
  if (cli.paths && cli.paths.length > 0) {
    files = cli.paths.map((p) => resolve(repoRoot, p));
  } else {
    files = [];
    for (const root of cfg.scanRoots) {
      walkTsFiles(join(repoRoot, root), root, files);
    }
  }

  // Allowlist file (if configured + present).
  let allowlist: AllowlistEntry[] = [];
  if (cfg.allowlistFile) {
    const alPath = join(repoRoot, cfg.allowlistFile);
    if (existsSync(alPath)) {
      allowlist = parseAllowlistFile(readFileSync(alPath, 'utf8'));
    }
  }

  let violations: Violation[];
  try {
    violations = runScan({
      repoRoot,
      config: cfg,
      selfHosts,
      files,
      includeTests: cli.includeTests,
      allowlist,
    });
  } catch (e) {
    err.write(`[check-cf-self-fetch] scan failed: ${(e as Error).message}\n`);
    return { exitCode: 2, violations: [], selfHosts };
  }

  if (cli.json) {
    out.write(JSON.stringify({ selfHosts, violations }, null, 2) + '\n');
  } else {
    out.write(renderReport(violations, selfHosts));
  }

  if (violations.length === 0) {
    return { exitCode: 0, violations, selfHosts };
  }
  err.write(
    `[check-cf-self-fetch] ${violations.length} self-fetch violation(s) — fix before deploying.\n`,
  );
  if (cli.force) {
    err.write('[check-cf-self-fetch] DEPLOY_FORCE=1 set — proceeding despite violations.\n');
    return { exitCode: 0, violations, selfHosts };
  }
  return { exitCode: 1, violations, selfHosts };
}

if (import.meta.main) {
  const result = main(process.argv.slice(2));
  process.exit(result.exitCode);
}
