#!/usr/bin/env bun
/**
 * gen-fonts-b64.ts — Generate base64-encoded font assets for CF Workers deploy.
 *
 * Same motivation as gen-resvg-wasm-b64.ts: binary font imports (.woff2) resolve
 * to undefined in CF Workers when deployed via CF REST API (no Data rules).
 * This script embeds the fonts as base64 strings in TypeScript.
 *
 * Output: src/assets/fonts-b64.ts
 * Usage:  bun packages/worker/scripts/gen-fonts-b64.ts
 *         (run from /workspace/agentlair or packages/worker/)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(resolve(import.meta.path));
const WORKER_DIR = join(SCRIPT_DIR, '..');
const ASSETS_DIR = join(WORKER_DIR, 'src/assets');
const OUT_PATH = join(ASSETS_DIR, 'fonts-b64.ts');

const fonts = [
  { name: 'INTER_REGULAR_B64', file: 'inter-regular.woff2' },
  { name: 'INTER_BOLD_B64', file: 'inter-bold.woff2' },
];

const lines: string[] = [
  '// Auto-generated at deploy time — do not edit by hand.',
  '// Source: src/assets/inter-*.woff2',
  '// Regenerate: bun packages/worker/scripts/gen-fonts-b64.ts',
  '// Used by: src/lib/og-render.ts (fallback when binary imports are undefined in CF Workers)',
];

for (const { name, file } of fonts) {
  const path = join(ASSETS_DIR, file);
  if (!existsSync(path)) {
    console.error(`✗ Font not found at ${path}`);
    process.exit(1);
  }
  const bytes = readFileSync(path);
  const base64 = bytes.toString('base64');
  const sizeKb = Math.round(bytes.length / 1024);
  const b64SizeKb = Math.round(base64.length / 1024);
  lines.push(`// ${file}: ${sizeKb}KB binary → ${b64SizeKb}KB base64`);
  lines.push(`export const ${name} = '${base64}';`);
  console.log(`  ${file}: ${sizeKb}KB → ${b64SizeKb}KB base64`);
}
lines.push('');

writeFileSync(OUT_PATH, lines.join('\n'));
console.log(`✅ Wrote ${OUT_PATH}`);
