/**
 * digest.test.ts — pin the digest algorithm against the live golden value.
 *
 * The agentlair-email demo skill produces digest
 *   sha256-NDOawr5cQVVfoE4cvxxhUxAjI9fGh3YXNKboNAQu4QA
 * which is also the value embedded in its SKILL.sig JWT. If this test ever
 * fails, the package's digest algorithm has drifted from the spec — that's
 * a hard incompatibility with the live `/v1/verify-skill` endpoint.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { computeDigest } from './core.js';
import { readSkillDir } from './index.js';

const SKILL_DIR = '/workspace/projects/agent-infra/agentlair-email-skill';
const GOLDEN_DIGEST = 'sha256-NDOawr5cQVVfoE4cvxxhUxAjI9fGh3YXNKboNAQu4QA';

describe('computeDigest — golden test vs live SKILL.sig', () => {
  test('agentlair-email skill matches its embedded JWT digest', async () => {
    const files = readSkillDir(SKILL_DIR);
    expect(files.map((f) => f.path).sort()).toEqual(['README.md', 'SKILL.md']);

    const digest = await computeDigest(files);
    expect(digest).toBe(GOLDEN_DIGEST);
  });

  test('digest format: sha256- prefix + 43-char base64url payload', async () => {
    const files = readSkillDir(SKILL_DIR);
    const digest = await computeDigest(files);
    expect(digest.startsWith('sha256-')).toBe(true);
    const payload = digest.slice('sha256-'.length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    // SHA-256 = 32 bytes → base64url(32) = ceil(32 * 4 / 3) - padding = 43 chars
    expect(payload.length).toBe(43);
  });
});

describe('computeDigest — sort/tamper sensitivity', () => {
  test('flipping one byte changes the digest', async () => {
    const files = readSkillDir(SKILL_DIR);
    const original = await computeDigest(files);

    // Tamper the first byte of SKILL.md
    const skill = files.find((f) => f.path === 'SKILL.md');
    if (!skill) throw new Error('SKILL.md missing');
    const tampered = new Uint8Array(skill.content);
    tampered[0] = tampered[0] === 0x41 ? 0x42 : 0x41; // flip one byte
    const tamperedFiles = files.map((f) =>
      f.path === 'SKILL.md' ? { path: f.path, content: tampered } : f,
    );

    const tamperedDigest = await computeDigest(tamperedFiles);
    expect(tamperedDigest).not.toBe(original);
  });

  test('input order does not matter — internal sort handles it', async () => {
    const files = readSkillDir(SKILL_DIR);
    const reversed = [...files].reverse();
    const a = await computeDigest(files);
    const b = await computeDigest(reversed);
    expect(a).toBe(b);
  });

  test('renaming a file changes the digest', async () => {
    const files = readSkillDir(SKILL_DIR);
    const renamed = files.map((f) =>
      f.path === 'README.md' ? { path: 'OTHER.md', content: f.content } : f,
    );
    const original = await computeDigest(files);
    const renamedDigest = await computeDigest(renamed);
    expect(renamedDigest).not.toBe(original);
  });

  test('empty directory produces a stable digest', async () => {
    const a = await computeDigest([]);
    const b = await computeDigest([]);
    expect(a).toBe(b);
    expect(a.startsWith('sha256-')).toBe(true);
  });
});

describe('readSkillDir — exclusion rules', () => {
  test('does not include SKILL.sig itself', () => {
    const files = readSkillDir(SKILL_DIR);
    expect(files.some((f) => f.path === 'SKILL.sig')).toBe(false);
  });

  test('reads file content as Uint8Array matching disk bytes', () => {
    const files = readSkillDir(SKILL_DIR);
    const skill = files.find((f) => f.path === 'SKILL.md');
    if (!skill) throw new Error('SKILL.md missing');
    const onDisk = readFileSync(`${SKILL_DIR}/SKILL.md`);
    expect(skill.content.length).toBe(onDisk.length);
    expect(skill.content[0]).toBe(onDisk[0]);
  });
});
