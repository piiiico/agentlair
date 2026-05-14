#!/usr/bin/env bun
/**
 * gen-resvg-wasm-b64.ts — Generate base64-encoded WASM asset for CF Workers deploy.
 *
 * The agentlair-deploy.ts script uploads only dist/index.js via CF REST API.
 * Binary imports (like @resvg/resvg-wasm/index_bg.wasm) are NOT included.
 * This script embeds the WASM binary as a base64 string in TypeScript so it's
 * bundled into index.js and available at runtime on CF Workers.
 *
 * Output: src/assets/resvg-wasm-b64.ts
 * Usage:  bun packages/worker/scripts/gen-resvg-wasm-b64.ts
 *         (run from /workspace/agentlair or packages/worker/)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// Resolve paths relative to this script's location
const SCRIPT_DIR = dirname(resolve(import.meta.path));
const WORKER_DIR = join(SCRIPT_DIR, '..');
const WASM_PATH = join(WORKER_DIR, 'node_modules/@resvg/resvg-wasm/index_bg.wasm');
const OUT_PATH = join(WORKER_DIR, 'src/assets/resvg-wasm-b64.ts');

if (!existsSync(WASM_PATH)) {
  console.error(`✗ WASM not found at ${WASM_PATH}`);
  process.exit(1);
}

const wasmBytes = readFileSync(WASM_PATH);
const base64 = wasmBytes.toString('base64');
const sizeKb = Math.round(wasmBytes.length / 1024);
const b64SizeKb = Math.round(base64.length / 1024);

const content = [
  '// Auto-generated at deploy time — do not edit by hand.',
  `// Source: node_modules/@resvg/resvg-wasm/index_bg.wasm (${sizeKb}KB binary → ${b64SizeKb}KB base64)`,
  '// Regenerate: bun packages/worker/scripts/gen-resvg-wasm-b64.ts',
  '// Used by: src/lib/og-render.ts (fallback when binary import is undefined in CF Workers)',
  `export const RESVG_WASM_B64 = '${base64}';`,
  '',
].join('\n');

writeFileSync(OUT_PATH, content);
console.log(`✅ Wrote ${OUT_PATH} (${b64SizeKb}KB base64 from ${sizeKb}KB binary)`);
