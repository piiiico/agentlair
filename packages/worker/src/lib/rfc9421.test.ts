/**
 * Tests for RFC 9421 HTTP Message Signatures
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  buildSignatureBase,
  signHttpMessage,
  verifyHttpSignature,
  signForVisaTAP,
  demonstratePAI,
} from './rfc9421.js';
import type { HttpMessage, SignatureParams } from './rfc9421.js';

// Deterministic test key
const TEST_SEED = new Uint8Array(32);
TEST_SEED[0] = 0x42;
TEST_SEED[31] = 0x01;
const TEST_PRIVATE_KEY_B64 = btoa(String.fromCharCode(...TEST_SEED));
const TEST_PUBLIC_KEY = ed25519.getPublicKey(TEST_SEED);

const SAMPLE_MESSAGE: HttpMessage = {
  method: 'POST',
  url: 'https://merchant.example.com/api/checkout',
  headers: {
    'Content-Type': 'application/json',
    Host: 'merchant.example.com',
  },
  body: '{"amount":42.00,"currency":"USD"}',
};

describe('RFC 9421 Signature Base', () => {
  test('includes derived components in canonical format', () => {
    const base = buildSignatureBase(SAMPLE_MESSAGE, {
      components: ['@method', '@authority', '@path'],
      params: {
        keyid: 'test1234',
        alg: 'ed25519',
        created: 1700000000,
        nonce: 'abc123',
        tag: 'test',
      },
    });

    expect(base).toContain('"@method": POST');
    expect(base).toContain('"@authority": merchant.example.com');
    expect(base).toContain('"@path": /api/checkout');
    expect(base).toContain('"@signature-params":');
  });

  test('includes header fields', () => {
    const base = buildSignatureBase(SAMPLE_MESSAGE, {
      components: ['@method', 'content-type'],
      params: {
        keyid: 'k1',
        alg: 'ed25519',
        created: 1700000000,
        nonce: 'n1',
        tag: 't1',
      },
    });
    expect(base).toContain('"content-type": application/json');
  });
});

describe('Sign + Verify Round-Trip', () => {
  test('valid signature verifies', () => {
    const params: SignatureParams = {
      keyid: 'test1234',
      alg: 'ed25519',
      created: 1700000000,
      nonce: 'roundtrip',
      tag: 'test',
    };

    const result = signHttpMessage(
      SAMPLE_MESSAGE,
      ['@method', '@authority', '@path'],
      params,
      TEST_PRIVATE_KEY_B64,
    );

    const valid = verifyHttpSignature(
      SAMPLE_MESSAGE,
      result.signatureInput,
      result.signature,
      TEST_PUBLIC_KEY,
    );
    expect(valid).toBe(true);
  });

  test('wrong key rejects', () => {
    const params: SignatureParams = {
      keyid: 'test1234',
      alg: 'ed25519',
      created: 1700000000,
      nonce: 'wrongkey',
      tag: 'test',
    };

    const result = signHttpMessage(
      SAMPLE_MESSAGE,
      ['@method', '@authority', '@path'],
      params,
      TEST_PRIVATE_KEY_B64,
    );

    const wrongSeed = new Uint8Array(32).fill(0xff);
    const wrongPub = ed25519.getPublicKey(wrongSeed);

    expect(verifyHttpSignature(
      SAMPLE_MESSAGE,
      result.signatureInput,
      result.signature,
      wrongPub,
    )).toBe(false);
  });

  test('tampered message rejects', () => {
    const params: SignatureParams = {
      keyid: 'test1234',
      alg: 'ed25519',
      created: 1700000000,
      nonce: 'tamper',
      tag: 'test',
    };

    const result = signHttpMessage(
      SAMPLE_MESSAGE,
      ['@method', '@authority', '@path'],
      params,
      TEST_PRIVATE_KEY_B64,
    );

    const tampered: HttpMessage = {
      ...SAMPLE_MESSAGE,
      url: 'https://evil.example.com/steal',
    };

    expect(verifyHttpSignature(
      tampered,
      result.signatureInput,
      result.signature,
      TEST_PUBLIC_KEY,
    )).toBe(false);
  });
});

describe('Visa TAP Compatibility', () => {
  test('produces compliant headers', () => {
    const headers = signForVisaTAP(
      SAMPLE_MESSAGE,
      TEST_PRIVATE_KEY_B64,
      'abcd1234',
      'agent-browser-auth',
    );

    expect(headers['Signature-Input']).toContain('tag="agent-browser-auth"');
    expect(headers['Signature-Input']).toContain('"content-type"');
    expect(headers['Signature-Input']).toMatch(/expires=\d+/);
    expect(headers['Signature']).toMatch(/^agent=:[A-Za-z0-9+/=]+:$/);
  });

  test('8-minute expiry window', () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = signForVisaTAP(SAMPLE_MESSAGE, TEST_PRIVATE_KEY_B64, 'k1');
    const expiresMatch = headers['Signature-Input'].match(/expires=(\d+)/);
    expect(expiresMatch).not.toBeNull();
    const expires = parseInt(expiresMatch![1]);
    expect(expires - before).toBeLessThanOrEqual(481);
    expect(expires - before).toBeGreaterThanOrEqual(479);
  });

  test('verifies with same key as AAT', () => {
    const headers = signForVisaTAP(
      SAMPLE_MESSAGE,
      TEST_PRIVATE_KEY_B64,
      'abcd1234',
      'agent-payer-auth',
    );

    const valid = verifyHttpSignature(
      SAMPLE_MESSAGE,
      headers['Signature-Input'],
      headers['Signature'],
      TEST_PUBLIC_KEY,
    );
    expect(valid).toBe(true);
  });
});

describe('Portable Agent Identity', () => {
  test('PAI demo runs without error', async () => {
    const result = await demonstratePAI(TEST_PRIVATE_KEY_B64);
    expect(result.jwt).toContain('.');
    expect(result.tapHeaders['Signature-Input']).toContain('agent=');
    expect(result.kid).toHaveLength(8);
    expect(result.publicKey.length).toBeGreaterThan(10);
  });
});
