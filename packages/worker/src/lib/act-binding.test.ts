/**
 * Phase 2c frozen interop test vectors (issue ucsandman/DashClaw#121) — mirrored
 * on the AgentLair issuer side.
 *
 * These vectors are byte-for-byte the same set frozen in DashClaw's
 * __tests__/integration/act-binding-vectors.test.js at upstream commit
 * ed879cf8b2355230b4420ae680da397e823f8321 (the 9-vector consolidation that
 * extended PR #138's original 6 with three V8-vs-RFC-8785 divergence vectors).
 *
 * Why mirror, not import: the upstream test file uses vitest + Vite path
 * resolution. AgentLair's worker uses bun:test. The vectors themselves are
 * the contract — re-derived here against the vendored act-binding.ts module
 * at the same SHA. If either side drifts on canonicalization or digest
 * encoding, the same 9 cases fail on both halves, pointing at the drift.
 *
 * Changing any expected value in this file is a wire-format break. If a
 * future change forces it, bump `urn:dashclaw:act-binding`'s `typ` suffix
 * (`action-binding/v1` → `v2`), re-vendor act-binding.ts, and re-derive a
 * fresh vector set rather than silently editing.
 */
import { describe, test, expect } from 'bun:test';
import {
  canonicalizeActionTuple,
  computeActBindingHash,
} from './act-binding.js';

const VECTORS = [
  {
    name: 'vec.ascii.read-customer',
    tuple: {
      action: 'http.GET',
      target: 'https://api.example/customers/42',
      goal: 'read the customer record to summarize recent orders',
    },
    canonical:
      '{"action":"http.GET","goal":"read the customer record to summarize recent orders","target":"https://api.example/customers/42"}',
    hash: 'sha256:XfBUzVuMEr-BUnGQtAT06R_Hzlt8pocE2aEywEL2s9k',
  },
  {
    name: 'vec.ascii.delete-order',
    tuple: {
      action: 'http.DELETE',
      target: 'https://api.example/orders/9001',
      goal: 'delete the cancelled order at the user request',
    },
    canonical:
      '{"action":"http.DELETE","goal":"delete the cancelled order at the user request","target":"https://api.example/orders/9001"}',
    hash: 'sha256:8m9D2_tkCCf5Q67SNFMs4VjwtwnP376pqefXI46baao',
  },
  {
    // U+00E9 (LATIN SMALL LETTER E WITH ACUTE) inline.
    name: 'vec.unicode.precomposed',
    tuple: {
      action: 'agent.note',
      target: String.fromCodePoint(0x63, 0x61, 0x66, 0xe9),
      goal: 'add a note about the ' + String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) + ' visit',
    },
    canonical:
      '{"action":"agent.note","goal":"add a note about the ' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      ' visit","target":"' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      '"}',
    hash: 'sha256:D1svv5sGwpixEiwRJaQ-xRWrOHEFQdx60Qk3qSB_xbU',
  },
  {
    // Same caf{e + combining acute}, U+0065 + U+0301 — must hash identical
    // to precomposed. NFC fold proof.
    name: 'vec.unicode.decomposed',
    tuple: {
      action: 'agent.note',
      target: String.fromCodePoint(0x63, 0x61, 0x66, 0x65, 0x301),
      goal: 'add a note about the ' + String.fromCodePoint(0x63, 0x61, 0x66, 0x65, 0x301) + ' visit',
    },
    canonical:
      '{"action":"agent.note","goal":"add a note about the ' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      ' visit","target":"' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      '"}',
    hash: 'sha256:D1svv5sGwpixEiwRJaQ-xRWrOHEFQdx60Qk3qSB_xbU',
  },
  {
    name: 'vec.escape.quotes-and-backslash',
    tuple: {
      action: 'shell.exec',
      target: 'rm -rf "/tmp/with \\ quotes"',
      goal: 'cleanup temp dir with quoted and \\ escaped paths',
    },
    canonical:
      '{"action":"shell.exec","goal":"cleanup temp dir with quoted and \\\\ escaped paths","target":"rm -rf \\"/tmp/with \\\\ quotes\\""}',
    hash: 'sha256:73778maUi-E7ySXocYn8BwSLqsQmOCN_KxhsJMDSmz0',
  },
  {
    name: 'vec.escape.control-char',
    tuple: {
      action: 'log.write',
      target: 'app.log',
      goal: 'line1\nline2',
    },
    canonical:
      '{"action":"log.write","goal":"line1\\nline2","target":"app.log"}',
    hash: 'sha256:Rn2KBAu2PX4OAL_ziqCja2zDfvfyoMQoDU3XzwBJLbw',
  },
  {
    // U+2028 LINE SEPARATOR in goal. V8 JSON.stringify leaves it RAW; strict
    // RFC 8785 §3.2.2.2 would escape it. This freezes V8's choice.
    name: 'vec.unicode.line-separator',
    tuple: {
      action: 'doc.append',
      target: 'notes.md',
      goal: 'first paragraph' + String.fromCodePoint(0x2028) + 'second paragraph',
    },
    canonical:
      '{"action":"doc.append","goal":"first paragraph' +
      String.fromCodePoint(0x2028) +
      'second paragraph","target":"notes.md"}',
    hash: 'sha256:rmerdIKjQaau84rHrvBma0UebaBWcDV8CRFRfgksqQI',
  },
  {
    // U+1F600 (astral, UTF-16 surrogate pair). Emitted as raw 4-byte UTF-8.
    name: 'vec.unicode.astral-emoji',
    tuple: {
      action: 'chat.react',
      target: 'thread/42',
      goal: 'react with ' + String.fromCodePoint(0x1f600),
    },
    canonical:
      '{"action":"chat.react","goal":"react with ' +
      String.fromCodePoint(0x1f600) +
      '","target":"thread/42"}',
    hash: 'sha256:DXpt4dK3TfXt8MsO0-1_V3CBUrx93Uw-pipnd_xcUsQ',
  },
  {
    // U+FB03 (ﬃ ligature): NFC-stable. NFKC would fold it to "ffi" — this
    // vector locks that the profile is NFC, not NFKC.
    name: 'vec.unicode.nfkc-stable',
    tuple: {
      action: 'search.run',
      target: 'reports',
      goal: 'find the ' + String.fromCodePoint(0xfb03) + ' ligature',
    },
    canonical:
      '{"action":"search.run","goal":"find the ' +
      String.fromCodePoint(0xfb03) +
      ' ligature","target":"reports"}',
    hash: 'sha256:lRn09hG0drGKo5br-CYp52TJP-CT4EfDBTWYVno65YY',
  },
];

describe('act-binding frozen interop vectors (Phase 2c)', () => {
  for (const v of VECTORS) {
    describe(v.name, () => {
      test('canonicalizes to the frozen byte string', () => {
        expect(canonicalizeActionTuple(v.tuple)).toBe(v.canonical);
      });
      test('hashes to the frozen sha256:base64url digest', () => {
        expect(computeActBindingHash(v.tuple)).toBe(v.hash);
      });
    });
  }

  test('NFC fold: precomposed and decomposed café canonicalize identically', () => {
    const precomposed = VECTORS.find((v) => v.name === 'vec.unicode.precomposed')!;
    const decomposed = VECTORS.find((v) => v.name === 'vec.unicode.decomposed')!;
    // Guard: the inputs really differ before NFC.
    expect(precomposed.tuple.target).not.toBe(decomposed.tuple.target);
    expect(precomposed.tuple.goal).not.toBe(decomposed.tuple.goal);
    // Post-canonicalization they fold together.
    expect(canonicalizeActionTuple(precomposed.tuple)).toBe(
      canonicalizeActionTuple(decomposed.tuple),
    );
    expect(computeActBindingHash(precomposed.tuple)).toBe(
      computeActBindingHash(decomposed.tuple),
    );
  });

  test('U+2028 is left raw, not escaped (V8 JSON.stringify, not strict RFC 8785)', () => {
    const v = VECTORS.find((x) => x.name === 'vec.unicode.line-separator')!;
    const canonical = canonicalizeActionTuple(v.tuple);
    expect(canonical).toContain(String.fromCodePoint(0x2028)); // raw separator survives
    expect(canonical).not.toContain('\\u2028'); // the strict-RFC-8785 escape is absent
  });

  test('astral code point is emitted as raw UTF-8, not \\uXXXX', () => {
    const v = VECTORS.find((x) => x.name === 'vec.unicode.astral-emoji')!;
    const canonical = canonicalizeActionTuple(v.tuple);
    expect(canonical).toContain(String.fromCodePoint(0x1f600)); // raw emoji
    expect(canonical).not.toContain('\\u'); // no escape sequence at all
  });

  test('NFKC-unstable ligature is preserved (NFC), not folded to "ffi" (NFKC)', () => {
    const v = VECTORS.find((x) => x.name === 'vec.unicode.nfkc-stable')!;
    const canonical = canonicalizeActionTuple(v.tuple);
    expect(canonical).toContain(String.fromCodePoint(0xfb03)); // ﬃ kept verbatim
    expect(canonical).not.toContain('ffi'); // NFKC compatibility fold did NOT happen
  });
});

describe('canonicalizeActionTuple: CTX_INCOMPLETE error contract', () => {
  test('missing action → CTX_INCOMPLETE', () => {
    expect(() =>
      canonicalizeActionTuple({ target: 't', goal: 'g' } as { action?: string; target?: string; goal?: string }),
    ).toThrow(/action must be a non-empty string/);
  });
  test('empty target → CTX_INCOMPLETE', () => {
    expect(() => canonicalizeActionTuple({ action: 'a', target: '', goal: 'g' })).toThrow(
      /target must be a non-empty string/,
    );
  });
  test('missing goal → CTX_INCOMPLETE', () => {
    expect(() => canonicalizeActionTuple({ action: 'a', target: 't' } as { action?: string; target?: string; goal?: string })).toThrow(
      /goal must be a non-empty string/,
    );
  });
  test('error carries code=CTX_INCOMPLETE', () => {
    try {
      canonicalizeActionTuple({});
    } catch (e) {
      expect((e as { code?: string }).code).toBe('CTX_INCOMPLETE');
      return;
    }
    throw new Error('expected canonicalizeActionTuple to throw');
  });
});
