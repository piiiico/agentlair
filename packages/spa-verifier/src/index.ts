/**
 * @agentlair/spa-verifier
 *
 * Verify Skill Provenance Attestations (SPA) for AI agent skill directories.
 *
 * One install, one import — verify any skill directory with a `SKILL.sig`
 * sidecar against the publisher's signing key from `agentlair.dev`.
 *
 * @example Verify a skill directory
 * ```ts
 * import { verifySpa } from '@agentlair/spa-verifier';
 *
 * const result = await verifySpa('/path/to/skill');
 * if (result.verified) {
 *   console.log(`Verified by ${result.claims?.publisher.handle}`);
 * } else {
 *   console.error('Errors:', result.errors);
 * }
 * ```
 *
 * @example Edge runtime — no filesystem
 * ```ts
 * import { verifySpaJwt } from '@agentlair/spa-verifier/core';
 *
 * const result = await verifySpaJwt(jwt, files);
 * ```
 *
 * @see https://agentlair.dev/blog/skill-provenance-attestation/
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  type SkillFile,
  type SpaVerifyResult,
  type VerifySpaJwtOptions,
  verifySpaJwt,
} from './core.js';

// Re-export the pure core for advanced use cases.
export {
  computeDigest,
  parseSpaToken,
  verifySpaJwt,
} from './core.js';

export type {
  SkillFile,
  SpaClaims,
  SpaHeader,
  SpaPublisher,
  SpaVerifyResult,
  ParsedSpa,
  Jwks,
  VerifySpaJwtOptions,
} from './core.js';

// ─── Filesystem helpers ──────────────────────────────────────────────────────

/**
 * Walk a skill directory and return the file list used for digest computation.
 *
 * Exclusions (must match the SPA spec exactly):
 *   - `SKILL.sig` (the signature file itself)
 *   - top-level dotfiles and dotdirs (anything starting with `.` at the root)
 *   - `.git` and everything under it (defensive — covered by the dotfile rule
 *     for top-level, but also dropped if nested via symlink/subskill)
 *
 * Paths in the result are POSIX-relative (forward slashes), regardless of host OS.
 */
export function readSkillDir(skillDir: string): SkillFile[] {
  if (!existsSync(skillDir)) {
    throw new Error(`skill_dir_not_found: ${skillDir}`);
  }
  const stat = statSync(skillDir);
  if (!stat.isDirectory()) {
    throw new Error(`skill_dir_not_a_directory: ${skillDir}`);
  }

  const files: SkillFile[] = [];
  walk(skillDir, skillDir, files, true);
  return files;
}

function walk(dir: string, base: string, acc: SkillFile[], isTopLevel: boolean): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isTopLevel && entry.name.startsWith('.')) continue;
    if (entry.name === '.git') continue;
    if (entry.name === 'SKILL.sig' && isTopLevel) continue;

    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, acc, false);
    } else if (entry.isFile()) {
      const rel = relative(base, full).split(sep).join('/');
      acc.push({ path: rel, content: new Uint8Array(readFileSync(full)) });
    }
  }
}

// ─── High-level API ──────────────────────────────────────────────────────────

/**
 * Options for `verifySpa`.
 */
export interface VerifySpaOptions extends VerifySpaJwtOptions {
  /**
   * Override the path to the signature file. Defaults to `SKILL.sig` at the
   * top of `skillDir`.
   */
  sigPath?: string;
}

/**
 * Verify the Skill Provenance Attestation for a skill directory on disk.
 *
 * Reads `<skillDir>/SKILL.sig`, computes the canonical digest from every file
 * in `skillDir` (excluding the sig and top-level dotfiles), then verifies the
 * Ed25519 signature against the issuer's JWKS.
 *
 * Returns a structured result. Throws only on truly unrecoverable I/O errors
 * (e.g. directory missing). Verification failures populate `errors` and set
 * `verified: false`.
 *
 * @example
 * ```ts
 * const r = await verifySpa('/path/to/agentlair-email-skill');
 * if (r.verified) {
 *   console.log('signed by', r.claims?.publisher.handle);
 * }
 * ```
 *
 * @example Offline / pinned JWKS
 * ```ts
 * import jwks from './agentlair-jwks.json' with { type: 'json' };
 * const r = await verifySpa('/path/to/skill', { localJwks: jwks });
 * ```
 */
export async function verifySpa(
  skillDir: string,
  opts: VerifySpaOptions = {},
): Promise<SpaVerifyResult & { sig_present: boolean }> {
  // Distinguish "you gave me a bad path" from "no attestation" — a typo
  // in the skillDir argument should NOT be silently reported as unverified.
  if (!existsSync(skillDir)) {
    throw new Error(`skill_dir_not_found: ${skillDir}`);
  }
  const stat = statSync(skillDir);
  if (!stat.isDirectory()) {
    throw new Error(`skill_dir_not_a_directory: ${skillDir}`);
  }

  const sigPath = opts.sigPath ?? join(skillDir, 'SKILL.sig');

  if (!existsSync(sigPath)) {
    return {
      verified: false,
      signature_valid: false,
      digest_match: false,
      signer: null,
      computed_digest: '',
      claimed_digest: '',
      claims: null,
      errors: ['no_attestation: SKILL.sig not found'],
      sig_present: false,
    };
  }

  const jwt = readFileSync(sigPath, 'utf8').trim();
  const files = readSkillDir(skillDir);
  const result = await verifySpaJwt(jwt, files, opts);
  return { ...result, sig_present: true };
}
