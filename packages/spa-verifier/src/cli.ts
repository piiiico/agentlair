#!/usr/bin/env node
/**
 * spa-verify — CLI for @agentlair/spa-verifier
 *
 * Usage:
 *   spa-verify <skill-dir>             Verify a skill directory (online JWKS).
 *   spa-verify <skill-dir> --jwks <f>  Verify with a local JWKS file.
 *   spa-verify --version
 *   spa-verify --help
 *
 * Exit codes:
 *   0  verified
 *   1  failed (digest mismatch, signature invalid, JWKS error, etc.)
 *   2  no SKILL.sig present (unverified, but not corrupted)
 *   3  usage error
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifySpa, type Jwks } from './index.js';

const VERSION = '0.1.0';

const HELP = `spa-verify — verify a Skill Provenance Attestation

USAGE
  spa-verify <skill-dir> [--jwks <file>] [--json]
  spa-verify --help
  spa-verify --version

OPTIONS
  --jwks <file>   Use a local JWKS file instead of fetching from the issuer.
  --json          Print the raw verification result as JSON. Useful for CI.
  -h, --help      Show this help.
  -v, --version   Show the package version.

EXIT CODES
  0  verified
  1  failed
  2  no SKILL.sig present
  3  usage error

DOCS
  https://agentlair.dev/blog/skill-provenance-attestation/
`;

interface Args {
  skillDir: string | null;
  jwksFile: string | null;
  json: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const out: Args = { skillDir: null, jwksFile: null, json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.version = true;
    else if (a === '--json') out.json = true;
    else if (a === '--jwks') {
      const v = argv[++i];
      if (!v) return { error: '--jwks requires a file path' };
      out.jwksFile = v;
    } else if (a.startsWith('-')) {
      return { error: `unknown option: ${a}` };
    } else if (!out.skillDir) {
      out.skillDir = a;
    } else {
      return { error: `unexpected argument: ${a}` };
    }
  }
  return out;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(`spa-verify: ${parsed.error}\n\n${HELP}`);
    process.exit(3);
  }

  if (parsed.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  if (!parsed.skillDir) {
    process.stderr.write(HELP);
    process.exit(3);
  }

  const skillDir = resolve(parsed.skillDir);

  let localJwks: Jwks | undefined;
  if (parsed.jwksFile) {
    if (!existsSync(parsed.jwksFile)) {
      process.stderr.write(`spa-verify: JWKS file not found: ${parsed.jwksFile}\n`);
      process.exit(3);
    }
    try {
      localJwks = JSON.parse(readFileSync(parsed.jwksFile, 'utf8')) as Jwks;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`spa-verify: failed to parse JWKS: ${msg}\n`);
      process.exit(3);
    }
  }

  const result = await verifySpa(skillDir, { localJwks });

  if (parsed.json) {
    // For machine-readable output we don't want to leak Uint8Array shapes.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.sig_present) process.exit(2);
    process.exit(result.verified ? 0 : 1);
  }

  // Human-friendly output.
  if (!result.sig_present) {
    process.stdout.write(`? Unverified skill: no SKILL.sig in ${skillDir}\n`);
    process.exit(2);
  }

  if (result.verified) {
    const handle = result.claims?.publisher.handle ?? 'unknown';
    const display = result.claims?.publisher.display_name ?? handle;
    const domain = result.claims?.publisher.domain;
    const skill = result.claims?.skill_name ?? '<unnamed>';
    const test = result.claims?._test ? ' [TEST SPA]' : '';
    const tail = domain ? ` (${domain})` : '';
    process.stdout.write(`OK  ${skill} verified by ${display}${tail} via ${result.claims?.iss}${test}\n`);
    process.stdout.write(`    digest: ${result.computed_digest}\n`);
    process.exit(0);
  }

  process.stdout.write(`FAIL  ${skillDir}\n`);
  if (!result.digest_match) {
    process.stdout.write(`    digest mismatch:\n`);
    process.stdout.write(`      computed: ${result.computed_digest}\n`);
    process.stdout.write(`      claimed:  ${result.claimed_digest}\n`);
  }
  if (!result.signature_valid && result.errors.some((e) => e.includes('signature') || e.includes('kid') || e.includes('jwks'))) {
    process.stdout.write(`    signature: invalid\n`);
  }
  for (const e of result.errors) {
    process.stdout.write(`    error: ${e}\n`);
  }
  process.exit(1);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`spa-verify: fatal: ${msg}\n`);
  process.exit(1);
});
