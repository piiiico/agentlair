/**
 * check-cf-self-fetch — host matcher, AST parser, scanner, allowlist tests.
 *
 * The classifier is the gate. Anything mis-classified either ships a
 * self-fetch that breaks at runtime (false negative) OR refuses an
 * unrelated public fetch (false positive — then the gate gets disabled
 * in frustration). These tests pin the surface so widening the patterns
 * later can't silently regress either failure mode.
 *
 * Run: bun test tools/check-cf-self-fetch.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import {
  deriveWranglerHosts,
  findFetchCalls,
  findMatchingPattern,
  isTestPath,
  loadConfig,
  main,
  matchHost,
  parseAllowlistFile,
  parseArgs,
  resolveFetchUrl,
  resolveSelfHosts,
  scanFile,
  walkTsFiles,
} from './check-cf-self-fetch';

// ─── Small helpers ───────────────────────────────────────────────────

function makeSourceFile(text: string): ts.SourceFile {
  return ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
}

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'cf-self-fetch-'));
}

function writeFile(root: string, rel: string, body: string): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

// ─── matchHost ───────────────────────────────────────────────────────

describe('matchHost', () => {
  test('exact match', () => {
    expect(matchHost('agentlair.dev', 'agentlair.dev')).toBe(true);
  });
  test('non-matching exact pattern', () => {
    expect(matchHost('api.resend.com', 'agentlair.dev')).toBe(false);
  });
  test('*.foo single-label subdomain', () => {
    expect(matchHost('api.agentlair.dev', '*.agentlair.dev')).toBe(true);
  });
  test('*.foo multi-label subdomain', () => {
    expect(matchHost('a.b.agentlair.dev', '*.agentlair.dev')).toBe(true);
  });
  test('*.foo does NOT match the bare apex', () => {
    expect(matchHost('agentlair.dev', '*.agentlair.dev')).toBe(false);
  });
  test('foo.*.bar matches exactly one middle label', () => {
    expect(matchHost('w.a.workers.dev', 'w.*.workers.dev')).toBe(true);
    expect(matchHost('w.workers.dev', 'w.*.workers.dev')).toBe(false);
    expect(matchHost('w.a.b.workers.dev', 'w.*.workers.dev')).toBe(false);
  });
  test('findMatchingPattern returns first match', () => {
    expect(findMatchingPattern('agentlair.dev', ['*.foo.com', 'agentlair.dev'])).toBe('agentlair.dev');
    expect(findMatchingPattern('foo.example', ['agentlair.dev'])).toBe(null);
  });
});

// ─── wrangler.toml derivation ────────────────────────────────────────

describe('deriveWranglerHosts', () => {
  test('name field → bare + wildcard workers.dev', () => {
    const out = deriveWranglerHosts('name = "agentlair-api"\nmain = "src/index.ts"');
    expect(out).toEqual(['agentlair-api.workers.dev', 'agentlair-api.*.workers.dev']);
  });
  test('name field with surrounding whitespace', () => {
    const out = deriveWranglerHosts('  name = "foo-bar-baz"\n');
    expect(out[0]).toBe('foo-bar-baz.workers.dev');
  });
  test('missing name throws', () => {
    expect(() => deriveWranglerHosts('main = "src/index.ts"')).toThrow(/name/);
  });
});

// ─── isTestPath ──────────────────────────────────────────────────────

describe('isTestPath', () => {
  test('.test.ts is excluded', () => {
    expect(isTestPath('packages/worker/src/foo.test.ts')).toBe(true);
  });
  test('.spec.ts is excluded', () => {
    expect(isTestPath('packages/worker/src/foo.spec.ts')).toBe(true);
  });
  test('__test__ directory is excluded', () => {
    expect(isTestPath('packages/worker/src/routes/__test__/x.ts')).toBe(true);
  });
  test('__tests__ directory is excluded', () => {
    expect(isTestPath('packages/worker/src/routes/__tests__/x.ts')).toBe(true);
  });
  test('regular source file is NOT excluded', () => {
    expect(isTestPath('packages/worker/src/routes/badge.ts')).toBe(false);
  });
});

// ─── AST: findFetchCalls ─────────────────────────────────────────────

describe('findFetchCalls — bare fetch identifier', () => {
  test('flags bare fetch(URL)', () => {
    const sf = makeSourceFile(`fetch("https://agentlair.dev/foo");`);
    const sites = findFetchCalls(sf);
    expect(sites.length).toBe(1);
    expect(sites[0]!.line).toBe(1);
  });

  test('flags fetch in await position', () => {
    const sf = makeSourceFile(`const x = await fetch("https://agentlair.dev/foo");`);
    expect(findFetchCalls(sf).length).toBe(1);
  });

  test('ignores obj.fetch() method calls (DO/Hono)', () => {
    const sf = makeSourceFile(`
      app.fetch(req);
      notifier.fetch(new Request("https://internal/notify"));
      tsStub.fetch(new Request("https://ts/append"));
    `);
    expect(findFetchCalls(sf).length).toBe(0);
  });

  test('ignores comments containing fetch(', () => {
    const sf = makeSourceFile(`
      // const r = await fetch("https://agentlair.dev/foo");
      /* fetch("https://agentlair.dev/bar"); */
      /** fetch('https://agentlair.dev/baz'); */
      const x = 1;
    `);
    expect(findFetchCalls(sf).length).toBe(0);
  });

  test('ignores strings containing the text fetch(', () => {
    const sf = makeSourceFile(`
      const body = \`Example: await fetch("https://agentlair.dev/foo")\`;
      const s = 'fetch("https://agentlair.dev/x")';
    `);
    expect(findFetchCalls(sf).length).toBe(0);
  });
});

// ─── AST: resolveFetchUrl ────────────────────────────────────────────

describe('resolveFetchUrl', () => {
  function resolve(text: string) {
    const sf = makeSourceFile(text);
    const sites = findFetchCalls(sf);
    expect(sites.length).toBe(1);
    return resolveFetchUrl(sites[0]!.arg0);
  }

  test('string literal', () => {
    const r = resolve(`fetch("https://agentlair.dev/foo");`);
    expect(r?.host).toBe('agentlair.dev');
  });

  test('single-quoted string literal', () => {
    const r = resolve(`fetch('https://agentlair.dev/foo');`);
    expect(r?.host).toBe('agentlair.dev');
  });

  test('no-substitution template', () => {
    const r = resolve('fetch(`https://agentlair.dev/foo`);');
    expect(r?.host).toBe('agentlair.dev');
  });

  test('template-literal head — constant prefix', () => {
    const r = resolve('fetch(`https://agentlair.dev/items/${id}`);');
    expect(r?.host).toBe('agentlair.dev');
    expect(r?.partial).toBe(true);
  });

  test('variable reference — unresolvable', () => {
    const r = resolve(`fetch(url);`);
    expect(r).toBeNull();
  });

  test('property-access reference — unresolvable', () => {
    const r = resolve(`fetch(env.URL);`);
    expect(r).toBeNull();
  });

  test('non-http URL string — unresolvable host', () => {
    const r = resolve(`fetch("ftp://foo.example/bar");`);
    expect(r).toBeNull();
  });

  test('uppercase scheme is accepted', () => {
    const r = resolve(`fetch("HTTPS://agentlair.dev/foo");`);
    expect(r?.host).toBe('agentlair.dev');
  });
});

// ─── Allowlist parser ────────────────────────────────────────────────

describe('parseAllowlistFile', () => {
  test('basic path:line entries', () => {
    const out = parseAllowlistFile(`
      packages/worker/src/foo.ts:42
      packages/worker/src/bar.ts:7  # explained somewhere
      # full-line comment
      `);
    expect(out).toEqual([
      { path: 'packages/worker/src/foo.ts', line: 42 },
      { path: 'packages/worker/src/bar.ts', line: 7 },
    ]);
  });

  test('blanks and comments only → empty', () => {
    expect(parseAllowlistFile('\n# a comment\n   # another\n')).toEqual([]);
  });
});

// ─── scanFile ────────────────────────────────────────────────────────

describe('scanFile', () => {
  function withRepo(fn: (repoRoot: string) => void) {
    const root = makeTempRepo();
    try {
      mkdirSync(join(root, 'packages/worker/src'), { recursive: true });
      writeFileSync(
        join(root, 'packages/worker/wrangler.toml'),
        'name = "agentlair-api"\nmain = "src/index.ts"\n',
      );
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function scanInput(repoRoot: string, opts: Partial<Parameters<typeof scanFile>[1]> = {}) {
    const cfg = loadConfig(repoRoot);
    const selfHosts = resolveSelfHosts(repoRoot, cfg);
    return {
      repoRoot,
      config: cfg,
      selfHosts,
      files: [],
      includeTests: false,
      allowlist: [],
      ...opts,
    };
  }

  test('flags literal self-host fetch', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        `export async function a() { return fetch("https://agentlair.dev/foo"); }`,
      );
      const out = scanFile(f, scanInput(root));
      expect(out.length).toBe(1);
      expect(out[0]!.host).toBe('agentlair.dev');
      expect(out[0]!.pattern).toBe('agentlair.dev');
    });
  });

  test('flags wildcard subdomain via template literal', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        'export async function a(id: string) { return fetch(`https://api.agentlair.dev/v1/${id}`); }',
      );
      const out = scanFile(f, scanInput(root));
      expect(out.length).toBe(1);
      expect(out[0]!.host).toBe('api.agentlair.dev');
      expect(out[0]!.pattern).toBe('*.agentlair.dev');
      expect(out[0]!.note).toBeDefined();
    });
  });

  test('flags <name>.workers.dev derived host', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        'export async function a() { return fetch("https://agentlair-api.workers.dev/v1/foo"); }',
      );
      const out = scanFile(f, scanInput(root));
      expect(out.length).toBe(1);
      expect(out[0]!.pattern).toBe('agentlair-api.workers.dev');
    });
  });

  test('flags account-subdomain workers.dev via wildcard', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        'export async function a() { return fetch("https://agentlair-api.acct42.workers.dev/v1/foo"); }',
      );
      const out = scanFile(f, scanInput(root));
      expect(out.length).toBe(1);
      expect(out[0]!.pattern).toBe('agentlair-api.*.workers.dev');
    });
  });

  test('does NOT flag public host', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        'export async function a() { return fetch("https://api.resend.com/emails"); }',
      );
      expect(scanFile(f, scanInput(root)).length).toBe(0);
    });
  });

  test('does NOT flag other workers.dev customers', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        'export async function a() { return fetch("https://foo-api.acct.workers.dev/v1"); }',
      );
      expect(scanFile(f, scanInput(root)).length).toBe(0);
    });
  });

  test('does NOT flag method-call .fetch() on objects', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        `
        export async function a(notifier: any) {
          await notifier.fetch(new Request("https://internal/notify"));
          await app.fetch(req);
        }
        `,
      );
      expect(scanFile(f, scanInput(root)).length).toBe(0);
    });
  });

  test('does NOT flag fetch( inside comments or strings', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        `
        /**
         * Example: const r = await fetch('https://agentlair.dev/foo');
         */
        const body = \`Quickstart: await fetch('https://agentlair.dev/foo')\`;
        export const x = body;
        `,
      );
      expect(scanFile(f, scanInput(root)).length).toBe(0);
    });
  });

  test('allowlist file comment skips violation', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        `export async function a() { return fetch("https://agentlair.dev/health"); /* cf-self-fetch-ok: cron self-health */ }`,
      );
      // Same-line trailing comment after the call — must be on same line.
      // Use a // comment to make matching reliable.
      writeFileSync(
        f,
        `export async function a() { return fetch("https://agentlair.dev/health"); } // cf-self-fetch-ok: cron self-health\n`,
      );
      expect(scanFile(f, scanInput(root)).length).toBe(0);
    });
  });

  test('external allowlist file path:line skips violation', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        `export async function a() { return fetch("https://agentlair.dev/foo"); }`,
      );
      const allowlist = parseAllowlistFile('packages/worker/src/x.ts:1\n');
      expect(scanFile(f, scanInput(root, { allowlist })).length).toBe(0);
    });
  });

  test('excludes .test.ts by default', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.test.ts',
        `export async function a() { return fetch("https://agentlair.dev/foo"); }`,
      );
      expect(scanFile(f, scanInput(root, { includeTests: false })).length).toBe(0);
      expect(scanFile(f, scanInput(root, { includeTests: true })).length).toBe(1);
    });
  });

  test('does NOT flag variable-URL fetch (false-positive avoidance)', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        `export async function a(url: string) { return fetch(url); }`,
      );
      expect(scanFile(f, scanInput(root)).length).toBe(0);
    });
  });

  test('does NOT crash on IPv6 / unusual URL inputs', () => {
    withRepo((root) => {
      const f = writeFile(
        root,
        'packages/worker/src/x.ts',
        `
        async function a() {
          await fetch("https://[::1]:8080/foo");
          await fetch("not a url");
        }
        `,
      );
      // [::1] is not a self-host; the parser must not throw.
      expect(scanFile(f, scanInput(root)).length).toBe(0);
    });
  });
});

// ─── walkTsFiles ─────────────────────────────────────────────────────

describe('walkTsFiles', () => {
  test('lists nested .ts files, excludes .d.ts and node_modules', () => {
    const root = makeTempRepo();
    try {
      writeFile(root, 'src/a.ts', '');
      writeFile(root, 'src/sub/b.ts', '');
      writeFile(root, 'src/c.d.ts', '');
      writeFile(root, 'src/node_modules/x.ts', '');
      writeFile(root, 'src/.pipeline/p.ts', '');
      const out = walkTsFiles(join(root, 'src'), 'src');
      expect(out.length).toBe(2);
      expect(out.some((p) => p.endsWith('/a.ts'))).toBe(true);
      expect(out.some((p) => p.endsWith('/sub/b.ts'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── parseArgs ───────────────────────────────────────────────────────

describe('parseArgs', () => {
  test('defaults', () => {
    const opts = parseArgs([]);
    expect(opts.includeTests).toBe(false);
    expect(opts.paths).toBeNull();
    expect(opts.json).toBe(false);
    expect(opts.help).toBe(false);
  });
  test('--include-tests', () => {
    expect(parseArgs(['--include-tests']).includeTests).toBe(true);
  });
  test('--paths a,b,c', () => {
    expect(parseArgs(['--paths', 'a,b,c']).paths).toEqual(['a', 'b', 'c']);
  });
  test('--paths=a,b,c', () => {
    expect(parseArgs(['--paths=a,b,c']).paths).toEqual(['a', 'b', 'c']);
  });
  test('--help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

// ─── End-to-end: main() ──────────────────────────────────────────────

describe('main — exit codes and force bypass', () => {
  function makeFakeIO() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      out: { write: (s: string) => stdout.push(s) },
      err: { write: (s: string) => stderr.push(s) },
      stdout: () => stdout.join(''),
      stderr: () => stderr.join(''),
    };
  }

  test('clean tree → exit 0', () => {
    const root = makeTempRepo();
    try {
      writeFile(
        root,
        'packages/worker/wrangler.toml',
        'name = "agentlair-api"\nmain = "src/index.ts"\n',
      );
      writeFile(
        root,
        'packages/worker/src/x.ts',
        `export const ok = async () => fetch("https://api.resend.com/emails");`,
      );
      const io = makeFakeIO();
      const r = main([], root, io.out, io.err);
      expect(r.exitCode).toBe(0);
      expect(r.violations.length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('violation → exit 1', () => {
    const root = makeTempRepo();
    try {
      writeFile(
        root,
        'packages/worker/wrangler.toml',
        'name = "agentlair-api"\nmain = "src/index.ts"\n',
      );
      writeFile(
        root,
        'packages/worker/src/x.ts',
        `export const bad = async () => fetch("https://agentlair.dev/foo");`,
      );
      const io = makeFakeIO();
      const r = main([], root, io.out, io.err);
      expect(r.exitCode).toBe(1);
      expect(r.violations.length).toBe(1);
      expect(io.stderr()).toContain('1 self-fetch violation');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('missing wrangler.toml → exit 2', () => {
    const root = makeTempRepo();
    try {
      writeFile(root, 'packages/worker/src/x.ts', `export const ok = 1;`);
      const io = makeFakeIO();
      const r = main([], root, io.out, io.err);
      expect(r.exitCode).toBe(2);
      expect(io.stderr()).toContain('wrangler.toml');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--paths explicitly scanning a fixture (test path)', () => {
    const root = makeTempRepo();
    try {
      writeFile(
        root,
        'packages/worker/wrangler.toml',
        'name = "agentlair-api"\nmain = "src/index.ts"\n',
      );
      writeFile(
        root,
        'packages/worker/src/routes/__test__/self-fetch.test.ts',
        `async function a() { return fetch("https://agentlair.dev/foo"); }`,
      );
      const io = makeFakeIO();
      // With --include-tests, the fixture file is scanned.
      const r = main(
        ['--include-tests', '--paths', 'packages/worker/src/routes/__test__/self-fetch.test.ts'],
        root,
        io.out,
        io.err,
      );
      expect(r.exitCode).toBe(1);
      expect(r.violations.length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('DEPLOY_FORCE-equivalent bypass returns 0 + logs', () => {
    const root = makeTempRepo();
    try {
      writeFile(
        root,
        'packages/worker/wrangler.toml',
        'name = "agentlair-api"\nmain = "src/index.ts"\n',
      );
      writeFile(
        root,
        'packages/worker/src/x.ts',
        `export const bad = async () => fetch("https://agentlair.dev/foo");`,
      );
      const io = makeFakeIO();
      const prev = process.env.DEPLOY_FORCE;
      try {
        process.env.DEPLOY_FORCE = '1';
        const r = main([], root, io.out, io.err);
        expect(r.exitCode).toBe(0);
        expect(r.violations.length).toBe(1);
        expect(io.stderr()).toContain('DEPLOY_FORCE');
      } finally {
        if (prev === undefined) delete process.env.DEPLOY_FORCE;
        else process.env.DEPLOY_FORCE = prev;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--json emits machine-readable output', () => {
    const root = makeTempRepo();
    try {
      writeFile(
        root,
        'packages/worker/wrangler.toml',
        'name = "agentlair-api"\nmain = "src/index.ts"\n',
      );
      writeFile(
        root,
        'packages/worker/src/x.ts',
        `export const bad = async () => fetch("https://agentlair.dev/foo");`,
      );
      const io = makeFakeIO();
      const r = main(['--json'], root, io.out, io.err);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(io.stdout());
      expect(parsed.violations.length).toBe(1);
      expect(parsed.selfHosts).toContain('agentlair.dev');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--help prints usage and exits 0', () => {
    const io = makeFakeIO();
    const r = main(['--help'], '/tmp/anywhere', io.out, io.err);
    expect(r.exitCode).toBe(0);
    expect(io.stdout()).toContain('Usage:');
  });
});
