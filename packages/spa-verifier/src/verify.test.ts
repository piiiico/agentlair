/**
 * verify.test.ts — pin the verification logic with the demo SKILL.sig.
 *
 * Uses the offline `localJwks` path so tests run without network access. The
 * demo SKILL.sig was signed with the kid `alk_test_1778038761477`, which lives
 * in the demo's test-jwks.json — we load that file directly.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseSpaToken, verifySpaJwt, type Jwks } from './core.js';
import { verifySpa, readSkillDir } from './index.js';

const SKILL_DIR = '/workspace/projects/agent-infra/agentlair-email-skill';
const JWKS_PATH = '/workspace/projects/agent-infra/skill-provenance/demo/test-jwks.json';

const skillSig = readFileSync(`${SKILL_DIR}/SKILL.sig`, 'utf8').trim();
const localJwks = JSON.parse(readFileSync(JWKS_PATH, 'utf8')) as Jwks;

describe('parseSpaToken', () => {
  test('parses a valid SPA JWT', () => {
    const p = parseSpaToken(skillSig);
    expect(p.header.alg).toBe('EdDSA');
    expect(p.header.typ).toBe('spa+jwt');
    expect(p.header.kid).toBe('alk_test_1778038761477');
    expect(p.claims.skill_name).toBe('agentlair-email');
    expect(p.claims.publisher.handle).toBe('pico@amdal.dev');
    expect(p.claims.skill_digest.startsWith('sha256-')).toBe(true);
    expect(p.signature.length).toBe(64); // Ed25519 sig
  });

  test('throws on malformed JWT (wrong part count)', () => {
    expect(() => parseSpaToken('not.a.jwt.at.all')).toThrow(/expected 3 parts/);
    expect(() => parseSpaToken('only-one-part')).toThrow(/expected 3 parts/);
  });

  test('throws on garbage in header/claims', () => {
    const parts = skillSig.split('.');
    expect(() => parseSpaToken(`${'a'.repeat(20)}.${parts[1]}.${parts[2]}`)).toThrow();
  });
});

describe('verifySpaJwt — happy path (offline JWKS)', () => {
  test('verified=true when sig is valid and digest matches', async () => {
    const files = readSkillDir(SKILL_DIR);
    const result = await verifySpaJwt(skillSig, files, { localJwks });

    expect(result.verified).toBe(true);
    expect(result.signature_valid).toBe(true);
    expect(result.digest_match).toBe(true);
    expect(result.signer).toBe('pico@amdal.dev');
    expect(result.errors).toHaveLength(0);
    expect(result.claims?.publisher.handle).toBe('pico@amdal.dev');
  });
});

describe('verifySpaJwt — tamper detection', () => {
  test('flipped byte → verified=false, digest_match=false, signature still valid', async () => {
    const files = readSkillDir(SKILL_DIR);
    const skill = files.find((f) => f.path === 'SKILL.md');
    if (!skill) throw new Error('SKILL.md missing');
    const tampered = new Uint8Array(skill.content);
    tampered[0] = tampered[0] === 0x41 ? 0x42 : 0x41;
    const tamperedFiles = files.map((f) =>
      f.path === 'SKILL.md' ? { path: f.path, content: tampered } : f,
    );

    const result = await verifySpaJwt(skillSig, tamperedFiles, { localJwks });
    expect(result.verified).toBe(false);
    expect(result.signature_valid).toBe(true); // sig is over the JWT, unchanged
    expect(result.digest_match).toBe(false);
    expect(result.computed_digest).not.toBe(result.claimed_digest);
    expect(result.errors).toContain('digest_mismatch');
  });

  test('mangled signature → verified=false, signature_valid=false', async () => {
    const files = readSkillDir(SKILL_DIR);
    const parts = skillSig.split('.');
    // 86 'A's = valid base64url length for 64 bytes, but the value won't verify.
    const mangled = `${parts[0]}.${parts[1]}.${'A'.repeat(86)}`;

    const result = await verifySpaJwt(mangled, files, { localJwks });
    expect(result.verified).toBe(false);
    expect(result.signature_valid).toBe(false);
    expect(result.errors.some((e) => e.includes('signature'))).toBe(true);
  });

  test('unknown kid → verified=false, errors includes kid_not_found', async () => {
    const files = readSkillDir(SKILL_DIR);
    const fakeHeader = JSON.stringify({ alg: 'EdDSA', typ: 'spa+jwt', kid: 'fake_kid' });
    const fakeHeaderB64 = btoa(fakeHeader)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const parts = skillSig.split('.');
    const altered = `${fakeHeaderB64}.${parts[1]}.${parts[2]}`;

    const result = await verifySpaJwt(altered, files, { localJwks });
    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes('kid_not_found'))).toBe(true);
  });

  test('wrong typ in header → flagged as invalid_typ', async () => {
    const files = readSkillDir(SKILL_DIR);
    const fakeHeader = JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'alk_test_1778038761477' });
    const fakeHeaderB64 = btoa(fakeHeader)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const parts = skillSig.split('.');
    const altered = `${fakeHeaderB64}.${parts[1]}.${parts[2]}`;

    const result = await verifySpaJwt(altered, files, { localJwks });
    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid_typ'))).toBe(true);
  });

  test('garbage JWT → verified=false, claims=null', async () => {
    const result = await verifySpaJwt('not.a.jwt', [], { localJwks });
    expect(result.verified).toBe(false);
    expect(result.claims).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('verifySpa — directory-based API', () => {
  test('verifies the agentlair-email demo skill', async () => {
    const result = await verifySpa(SKILL_DIR, { localJwks });
    expect(result.sig_present).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.signer).toBe('pico@amdal.dev');
    expect(result.claims?.skill_name).toBe('agentlair-email');
  });

  test('skill dir without SKILL.sig → sig_present=false', async () => {
    // The demo directory itself contains test-jwks.json + .ts files, no SKILL.sig
    const result = await verifySpa('/workspace/projects/agent-infra/skill-provenance/demo', {
      localJwks,
    });
    expect(result.sig_present).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes('no_attestation'))).toBe(true);
  });

  test('non-existent dir → throws', async () => {
    await expect(verifySpa('/no/such/path/xxxxx', { localJwks })).rejects.toThrow();
  });
});
