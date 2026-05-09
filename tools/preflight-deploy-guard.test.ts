/**
 * preflight-deploy-guard config + behavioral regression tests.
 *
 * Why this exists: the guard's surface (ROUTE_SOURCE_DIRS, ROUTE_EXTS) is
 * the actual security control — anything outside the surface deploys
 * silently. These tests pin the surface so a future "narrow it down"
 * refactor can't regress the May 3 / May 8 2026 audit-divergence class
 * without flipping a red bar.
 *
 * Run: bun test tools/preflight-deploy-guard.test.ts
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTE_SOURCE_DIRS, ROUTE_EXTS } from './preflight-deploy-guard';

const REPO_ROOT = resolve(import.meta.dir, '..');
const GUARD = resolve(REPO_ROOT, 'tools/preflight-deploy-guard.ts');

describe('ROUTE_SOURCE_DIRS surface', () => {
  test('covers public route pages', () => {
    expect(ROUTE_SOURCE_DIRS).toContain('apps/web/src/pages');
  });

  test('covers content collections', () => {
    expect(ROUTE_SOURCE_DIRS).toContain('apps/web/src/content/blog');
    expect(ROUTE_SOURCE_DIRS).toContain('apps/web/src/content/learn');
    expect(ROUTE_SOURCE_DIRS).toContain('apps/web/src/content/whitepaper');
  });

  // Regression: 2026-05-08 — client:only React islands ship as separate
  // JS bundles whose changes never alter the importing .astro page's hash.
  // Components must be in the surface or island edits deploy without commits.
  test('covers components dir (client:only React island regression)', () => {
    expect(ROUTE_SOURCE_DIRS).toContain('apps/web/src/components');
  });

  test('covers layouts dir', () => {
    expect(ROUTE_SOURCE_DIRS).toContain('apps/web/src/layouts');
  });
});

describe('ROUTE_EXTS regex', () => {
  test('matches Astro pages and content', () => {
    expect(ROUTE_EXTS.test('foo.astro')).toBe(true);
    expect(ROUTE_EXTS.test('foo.md')).toBe(true);
    expect(ROUTE_EXTS.test('foo.mdx')).toBe(true);
  });

  // Regression: 2026-05-08 — .tsx React islands were silently shipping.
  test('matches React islands (.tsx) and TS modules (.ts)', () => {
    expect(ROUTE_EXTS.test('faq.tsx')).toBe(true);
    expect(ROUTE_EXTS.test('verify.ts')).toBe(true);
  });

  test('rejects build artifacts and unrelated extensions', () => {
    expect(ROUTE_EXTS.test('foo.css')).toBe(false);
    expect(ROUTE_EXTS.test('foo.json')).toBe(false);
    expect(ROUTE_EXTS.test('foo.js')).toBe(false);
    expect(ROUTE_EXTS.test('foo.png')).toBe(false);
  });
});

describe('guard end-to-end (UNTRACKED detection)', () => {
  // Use untracked files — they don't require modifying tracked sources, so
  // a test crash leaves no dirtied tracked file behind. Cleanup is rm -f.
  const FIXTURES = [
    resolve(REPO_ROOT, 'apps/web/src/components/__preflight_test_island.tsx'),
    resolve(REPO_ROOT, 'apps/web/src/layouts/__preflight_test_layout.astro'),
    resolve(REPO_ROOT, 'apps/web/src/pages/__preflight_test_page.astro'),
  ];

  afterAll(() => {
    for (const f of FIXTURES) {
      if (existsSync(f)) unlinkSync(f);
    }
  });

  function runGuard(): { exitCode: number; output: string } {
    const r = spawnSync('bun', [GUARD], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { exitCode: r.status ?? -1, output: (r.stdout ?? '') + (r.stderr ?? '') };
  }

  test('flags untracked component .tsx (regression: client:only island)', () => {
    const f = FIXTURES[0];
    writeFileSync(f, '// preflight regression fixture\nexport default null;\n');
    try {
      const { exitCode, output } = runGuard();
      expect(exitCode).toBe(1);
      expect(output).toContain('__preflight_test_island.tsx');
      expect(output).toContain('UNTRACKED');
    } finally {
      unlinkSync(f);
    }
  });

  test('flags untracked layout .astro', () => {
    const f = FIXTURES[1];
    writeFileSync(f, '---\n---\n<!-- preflight regression fixture -->\n');
    try {
      const { exitCode, output } = runGuard();
      expect(exitCode).toBe(1);
      expect(output).toContain('__preflight_test_layout.astro');
    } finally {
      unlinkSync(f);
    }
  });

  test('flags untracked page .astro (existing surface still covered)', () => {
    const f = FIXTURES[2];
    writeFileSync(f, '---\n---\n<!-- preflight regression fixture -->\n');
    try {
      const { exitCode, output } = runGuard();
      expect(exitCode).toBe(1);
      expect(output).toContain('__preflight_test_page.astro');
    } finally {
      unlinkSync(f);
    }
  });

  test('DEPLOY_FORCE=1 escape hatch overrides divergence', () => {
    const f = FIXTURES[0];
    writeFileSync(f, '// preflight escape-hatch fixture\nexport default null;\n');
    try {
      const r = spawnSync('bun', [GUARD], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, DEPLOY_FORCE: '1' },
      });
      expect(r.status).toBe(0);
      expect((r.stderr ?? '') + (r.stdout ?? '')).toContain('DEPLOY_FORCE=1');
    } finally {
      unlinkSync(f);
    }
  });
});
