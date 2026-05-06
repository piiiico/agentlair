/**
 * skill-provenance.test.ts
 *
 * Unit tests for the SPA verifier pure functions.
 * No network — JWKS fetch is mocked with test-jwks.json.
 *
 * The real SKILL.sig uses kid "alk_test_1778038761477", which matches
 * test-jwks.json — so tests run fully offline.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'fs';
import { computeSkillDigest, verifySkillJwt } from './skill-provenance.js';

const SKILL_DIR = '/workspace/projects/agent-infra/agentlair-email-skill';
const JWKS_PATH = '/workspace/projects/agent-infra/skill-provenance/demo/test-jwks.json';

describe('skill-provenance', () => {
  let skillSig: string;
  let skillMdContent: Uint8Array;
  let readmeMdContent: Uint8Array;
  let mockJwksFetcher: () => Promise<{ keys?: unknown[] }>;

  beforeAll(() => {
    skillSig = readFileSync(`${SKILL_DIR}/SKILL.sig`, 'utf8').trim();
    skillMdContent = new Uint8Array(readFileSync(`${SKILL_DIR}/SKILL.md`));
    readmeMdContent = new Uint8Array(readFileSync(`${SKILL_DIR}/README.md`));
    const testJwks = JSON.parse(readFileSync(JWKS_PATH, 'utf8'));
    mockJwksFetcher = async () => testJwks;
  });

  test('valid sig + matching digest → valid: true, digest_match: true', async () => {
    const files = [
      { path: 'SKILL.md', content: skillMdContent },
      { path: 'README.md', content: readmeMdContent },
    ];
    const result = await verifySkillJwt(skillSig, mockJwksFetcher, files);
    expect(result.valid).toBe(true);
    expect(result.digest_match).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.signer).toBe('pico@amdal.dev');
  });

  test('valid sig + tampered file → valid: true, digest_match: false', async () => {
    // Flip the first byte of SKILL.md to corrupt the content
    const tampered = new Uint8Array(skillMdContent);
    tampered[0] = tampered[0] === 65 ? 66 : 65;
    const files = [
      { path: 'SKILL.md', content: tampered },
      { path: 'README.md', content: readmeMdContent },
    ];
    const result = await verifySkillJwt(skillSig, mockJwksFetcher, files);
    expect(result.valid).toBe(true);
    expect(result.digest_match).toBe(false);
    expect(result.computed_digest).not.toBe(result.claimed_digest);
  });

  test('mangled sig → valid: false, errors includes "signature"', async () => {
    const parts = skillSig.split('.');
    // Ed25519 sig = 64 bytes = 86 base64url chars (no `=` padding).
    // 86 A's decodes successfully but produces a wrong signature value.
    parts[2] = 'A'.repeat(86);
    const mangledJwt = parts.join('.');
    const files = [
      { path: 'SKILL.md', content: skillMdContent },
      { path: 'README.md', content: readmeMdContent },
    ];
    const result = await verifySkillJwt(mangledJwt, mockJwksFetcher, files);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('signature'))).toBe(true);
  });

  test('wrong kid → valid: false, errors includes "kid"', async () => {
    // Re-encode header with a fake kid (signature becomes invalid, but kid lookup fails first)
    const fakeHeaderJson = JSON.stringify({ alg: 'EdDSA', kid: 'fake_kid_not_in_jwks', typ: 'spa+jwt' });
    const fakeHeaderB64 = btoa(fakeHeaderJson)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const parts = skillSig.split('.');
    const fakeJwt = `${fakeHeaderB64}.${parts[1]}.${parts[2]}`;
    const files = [
      { path: 'SKILL.md', content: skillMdContent },
      { path: 'README.md', content: readmeMdContent },
    ];
    const result = await verifySkillJwt(fakeJwt, mockJwksFetcher, files);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('kid'))).toBe(true);
  });
});
