import { describe, test, expect } from 'bun:test';
import { base58btcEncode, base58btcDecode } from './base58btc.js';

describe('base58btcEncode / base58btcDecode', () => {
  test('round-trip: arbitrary bytes', () => {
    const original = new Uint8Array([0xed, 0x01, ...Array.from({ length: 32 }, (_, i) => i + 1)]);
    const encoded = base58btcEncode(original);
    const decoded = base58btcDecode(encoded);
    expect(decoded).toEqual(original);
  });

  test('round-trip: all-zero bytes', () => {
    const original = new Uint8Array(8);
    const encoded = base58btcEncode(original);
    const decoded = base58btcDecode(encoded);
    expect(decoded).toEqual(original);
  });

  test('decode: empty string → empty Uint8Array', () => {
    const result = base58btcDecode('');
    expect(result).toEqual(new Uint8Array(0));
  });

  test('decode: rejects invalid character → null', () => {
    expect(base58btcDecode('invalid0char')).toBeNull(); // '0' not in alphabet
    expect(base58btcDecode('abc!')).toBeNull();
    expect(base58btcDecode('abc l')).toBeNull(); // 'l' not in alphabet
    expect(base58btcDecode('abc O')).toBeNull(); // 'O' not in alphabet
  });

  test('decode: leading 1 (zero-byte) prefix', () => {
    // '1' encodes a single zero byte
    const result = base58btcDecode('1');
    expect(result).toEqual(new Uint8Array([0]));

    const result3 = base58btcDecode('111');
    expect(result3).toEqual(new Uint8Array([0, 0, 0]));
  });

  test('decode: 34-byte Ed25519-shaped input (multicodec 0xed01 + 32 key bytes)', () => {
    const key32 = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key32[i] = i + 10;
    const payload = new Uint8Array([0xed, 0x01, ...key32]);
    const encoded = base58btcEncode(payload);
    const decoded = base58btcDecode(encoded);
    expect(decoded).toEqual(payload);
    expect(decoded?.length).toBe(34);
    expect(decoded?.[0]).toBe(0xed);
    expect(decoded?.[1]).toBe(0x01);
  });

  test('encode: known vector — did:key z6Mk prefix means first two bytes are 0xed 0x01', () => {
    const prefix = new Uint8Array([0xed, 0x01]);
    const fakeKey = new Uint8Array(32); // all zeros
    const input = new Uint8Array([...prefix, ...fakeKey]);
    const encoded = base58btcEncode(input);
    // The did:key z6Mk prefix is the multibase 'z' + base58btc of [0xed, 0x01, ...]
    // z6Mk is the canonical prefix for Ed25519 keys in did:key
    expect(encoded.startsWith('6Mk')).toBe(true);
  });
});
