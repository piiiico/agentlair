/**
 * CBOR Decoder Tests
 *
 * Covers the subset of CBOR our COSE_Sign1 envelopes use:
 *   - Round-trip: encode (caf-scitt encoder) → decode → assert equal
 *   - decodeCoseSign1 against a real envelope built via caf-scitt
 *   - Error paths: indefinite, oversized 64-bit, truncated input
 */

import { describe, test, expect } from 'bun:test';
import {
  cborUint,
  cborNegint,
  cborBytes,
  cborText,
  cborArray,
  cborMap,
  cborTag,
} from './caf-scitt';
import {
  decodeCbor,
  decodeCoseSign1,
  getHeaderInt,
  getHeaderText,
  CborDecodeError,
} from './cbor-decode';

describe('decodeCbor — primitives', () => {
  test('round-trips small unsigned ints', () => {
    for (const n of [0, 1, 23, 24, 100, 0xff, 0xffff, 0xffffffff]) {
      expect(decodeCbor(cborUint(n))).toBe(n);
    }
  });

  test('round-trips negative ints', () => {
    for (const n of [-1, -8, -24, -25, -100]) {
      expect(decodeCbor(cborNegint(n))).toBe(n);
    }
  });

  test('round-trips byte strings', () => {
    const samples = [new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(300).fill(0xab)];
    for (const s of samples) {
      const decoded = decodeCbor(cborBytes(s));
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(Array.from(decoded as Uint8Array)).toEqual(Array.from(s));
    }
  });

  test('round-trips text strings (incl. UTF-8)', () => {
    for (const s of ['', 'hello', 'did:web:agentlair.dev', 'norsk: æøå', '日本語']) {
      expect(decodeCbor(cborText(s))).toBe(s);
    }
  });

  test('round-trips arrays and maps', () => {
    const arr = cborArray([cborUint(1), cborText('two'), cborUint(3)]);
    const decoded = decodeCbor(arr) as unknown[];
    expect(decoded).toEqual([1, 'two', 3]);

    const map = cborMap([
      [cborUint(1), cborNegint(-8)],
      [cborText('alg'), cborText('EdDSA')],
    ]);
    const decodedMap = decodeCbor(map) as Map<unknown, unknown>;
    expect(decodedMap.get(1)).toBe(-8);
    expect(decodedMap.get('alg')).toBe('EdDSA');
  });

  test('round-trips tagged values', () => {
    const tagged = cborTag(18, cborText('payload'));
    const decoded = decodeCbor(tagged) as { tag: number; value: unknown };
    expect(decoded.tag).toBe(18);
    expect(decoded.value).toBe('payload');
  });
});

describe('decodeCbor — error paths', () => {
  test('rejects indefinite-length items', () => {
    expect(() => decodeCbor(new Uint8Array([0x5f, 0xff]))).toThrow(CborDecodeError);
  });

  test('rejects truncated input', () => {
    expect(() => decodeCbor(new Uint8Array([0x18]))).toThrow(CborDecodeError);
  });

  test('rejects extra bytes after top-level item', () => {
    const bytes = new Uint8Array([0x01, 0x02]); // two separate uints
    expect(() => decodeCbor(bytes)).toThrow(CborDecodeError);
  });

  test('rejects 64-bit values above 2^32', () => {
    // Major type 0, additional 27 (8-byte uint), value = 1 in upper 32 bits
    const bytes = new Uint8Array([0x1b, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
    expect(() => decodeCbor(bytes)).toThrow(CborDecodeError);
  });
});

describe('decodeCoseSign1', () => {
  test('parses a tagged COSE_Sign1 round-trip', () => {
    const protectedMap = cborMap([
      [cborUint(1), cborNegint(-8)],          // alg: EdDSA
      [cborUint(3), cborText('test/json')],   // content-type
    ]);
    const payload = new TextEncoder().encode('{"hello":"world"}');
    const signature = new Uint8Array(64).fill(0xab);

    const cose = cborTag(18, cborArray([
      cborBytes(protectedMap),
      cborMap([]),
      cborBytes(payload),
      cborBytes(signature),
    ]));

    const decoded = decodeCoseSign1(cose);

    expect(decoded.protectedMap.get(1)).toBe(-8);
    expect(decoded.protectedMap.get(3)).toBe('test/json');
    expect(decoded.unprotectedMap.size).toBe(0);
    expect(new TextDecoder().decode(decoded.payload!)).toBe('{"hello":"world"}');
    expect(Array.from(decoded.signature)).toEqual(Array.from(signature));
  });

  test('parses an untagged 4-array COSE_Sign1', () => {
    const protectedMap = cborMap([[cborUint(1), cborNegint(-8)]]);
    const cose = cborArray([
      cborBytes(protectedMap),
      cborMap([]),
      cborBytes(new Uint8Array([0x01])),
      cborBytes(new Uint8Array(64)),
    ]);

    const decoded = decodeCoseSign1(cose);
    expect(decoded.protectedMap.get(1)).toBe(-8);
  });

  test('parses a detached payload (CBOR null)', () => {
    const protectedMap = cborMap([[cborUint(1), cborNegint(-8)]]);
    const cose = cborTag(18, cborArray([
      cborBytes(protectedMap),
      cborMap([]),
      new Uint8Array([0xf6]),                  // CBOR null
      cborBytes(new Uint8Array(64)),
    ]));

    const decoded = decodeCoseSign1(cose);
    expect(decoded.payload).toBeNull();
  });

  test('rejects wrong tag', () => {
    const cose = cborTag(99, cborArray([
      cborBytes(new Uint8Array(0)),
      cborMap([]),
      cborBytes(new Uint8Array(0)),
      cborBytes(new Uint8Array(0)),
    ]));
    expect(() => decodeCoseSign1(cose)).toThrow(CborDecodeError);
  });

  test('rejects wrong array length', () => {
    const cose = cborTag(18, cborArray([cborBytes(new Uint8Array(0))]));
    expect(() => decodeCoseSign1(cose)).toThrow(CborDecodeError);
  });
});

describe('header lookup helpers', () => {
  test('getHeaderInt finds integer-keyed values', () => {
    const map = new Map<unknown, unknown>([
      [1, -8],
      [3, 'application/popa+json'],
    ]) as Map<unknown, unknown>;
    expect(getHeaderInt(map as never, 1)).toBe(-8);
    expect(getHeaderInt(map as never, 3)).toBe('application/popa+json');
    expect(getHeaderInt(map as never, 99)).toBeUndefined();
  });

  test('getHeaderText finds text-keyed values', () => {
    const map = new Map<unknown, unknown>([
      ['PoPA-sequence', 42],
    ]) as Map<unknown, unknown>;
    expect(getHeaderText(map as never, 'PoPA-sequence')).toBe(42);
    expect(getHeaderText(map as never, 'missing')).toBeUndefined();
  });
});
