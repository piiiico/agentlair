// ─── Shared OG Rendering Infrastructure ────────────────────────────────────────
//
// Shared by all OG image routes (og-a2a.ts, og-a2a-stats.ts, and future endpoints).
// Holds WASM/font singleton state. Module-level singletons are correct: all routes
// in the same CF Workers isolate share one WASM instance.
//
// Exports: loadBinary, ensureWasm, svgToPng, gradeColor (LeaderboardGrade)

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { LeaderboardGrade } from './a2a-leaderboard-job.js';

// @ts-expect-error — binary imports: WebAssembly.Module in CF Workers, file path string in Bun
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-expect-error — binary font import: ArrayBuffer in CF Workers, file path string in Bun
import interRegularWoff2 from '../assets/inter-regular.woff2';
// @ts-expect-error — binary font import: ArrayBuffer in CF Workers, file path string in Bun
import interBoldWoff2 from '../assets/inter-bold.woff2';

// ─── Module-level singletons ─────────────────────────────────────────────────

let wasmReady = false;
let wasmInitPromise: Promise<void> | null = null;
let fontBuffers: Uint8Array[] = [];

// ─── Binary loading ──────────────────────────────────────────────────────────

export async function loadBinary(imported: unknown): Promise<Uint8Array> {
  if (imported instanceof ArrayBuffer) return new Uint8Array(imported);
  if (imported instanceof Uint8Array) return imported;
  if (typeof imported === 'string') {
    // Bun/Node: import resolves to file path
    const { readFileSync } = await import('fs');
    return new Uint8Array(readFileSync(imported));
  }
  throw new Error('Unexpected binary import type: ' + typeof imported);
}

// ─── WASM initialization ─────────────────────────────────────────────────────

export async function ensureWasm(): Promise<boolean> {
  if (wasmReady) return true;
  if (wasmInitPromise) {
    await wasmInitPromise;
    return wasmReady;
  }
  wasmInitPromise = (async () => {
    try {
      // In CF Workers, WASM import is a WebAssembly.Module — pass directly.
      // In Bun, it's a file path string — read the file first.
      let wasmInput: any = resvgWasm;
      if (typeof wasmInput === 'string') {
        const { readFileSync } = await import('fs');
        wasmInput = readFileSync(wasmInput);
      }
      await initWasm(wasmInput);
    } catch (e: unknown) {
      // "Already initialized" means another module/test already called initWasm
      if (!(e instanceof Error && e.message.includes('Already initialized'))) {
        return; // genuine failure — WASM not available
      }
    }
    // Load fonts (needed regardless of whether we just initialized or it was already done)
    fontBuffers = [
      await loadBinary(interRegularWoff2),
      await loadBinary(interBoldWoff2),
    ];
    wasmReady = true;
  })();
  await wasmInitPromise;
  return wasmReady;
}

// ─── SVG → PNG rendering ─────────────────────────────────────────────────────

export function svgToPng(svg: string): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontBuffers,
      defaultFontFamily: 'Inter',
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}

// ─── Grade color (LeaderboardGrade: A/B/C/D/F/E) ────────────────────────────
// NOTE: a2a-audit.ts has its own gradeColor for Grade (A-F only) — do NOT merge.
// This version handles the extra 'E' grade (error/unavailable) used in leaderboard.

export function gradeColor(g: LeaderboardGrade): string {
  switch (g) {
    case 'A': return '#4caf50';
    case 'B': return '#8bc34a';
    case 'C': return '#ff9800';
    case 'D': return '#ff5722';
    case 'F': return '#f44336';
    case 'E': return '#9e9e9e';
    default:  return '#9e9e9e';
  }
}
