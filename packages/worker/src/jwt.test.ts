/**
 * AgentLair JWT / AAT — Tests
 *
 * Tests for:
 * - JWT creation and Ed25519 signature verification
 * - JWT structure (header, payload, signature parts)
 * - Claims validation (iss, sub, aud, exp, iat, jti, al_*)
 * - Expiry enforcement
 * - JWKS document structure
 * - Base64url encoding edge cases
 * - Key ID computation
 * - Verification with wrong key
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  b64urlEncode,
  b64urlDecode,
  getPublicKey,
  computeKeyId,
  publicKeyToJWK,
  createJWT,
  verifyJWT,
  buildJWKS,
  pubkeyToRadicleNid,
} from './jwt';
import type { AATClaims } from './jwt';

// ─── Helper: generate test keypair ────────────────────────────────────────────

function generateTestKeypair(): {
  privateKeyB64: string;
  publicKeyBytes: Uint8Array;
} {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

// ─── Helper: make test claims ─────────────────────────────────────────────────

function makeClaims(overrides: Partial<AATClaims> = {}): AATClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://agentlair.dev',
    sub: 'acc_test123',
    aud: 'https://mcp.example.com',
    exp: now + 3600,
    iat: now,
    jti: 'aat_testtoken123',
    al_scopes: ['mcp:tools:read', 'mcp:tools:execute'],
    al_audit_url: 'https://agentlair.dev/v1/audit/aat_testtoken123',
    ...overrides,
  };
}

// ─── Base64url encoding ──────────────────────────────────────────────────────

describe('b64url', () => {
  test('encode + decode roundtrip for regular bytes', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const encoded = b64urlEncode(original);
    const decoded = b64urlDecode(encoded);
    expect(decoded).toEqual(original);
  });

  test('encode + decode roundtrip for string', () => {
    const original = '{"alg":"EdDSA","typ":"JWT"}';
    const encoded = b64urlEncode(original);
    const decoded = new TextDecoder().decode(b64urlDecode(encoded));
    expect(decoded).toBe(original);
  });

  test('output has no padding, +, or /', () => {
    const data = new Uint8Array(100);
    crypto.getRandomValues(data);
    const encoded = b64urlEncode(data);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  test('uses - and _ instead of + and /', () => {
    // Create bytes that produce + and / in standard base64
    const data = new Uint8Array([251, 239, 190]); // produces ++++ in base64
    const encoded = b64urlEncode(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });
});

// ─── Key operations ──────────────────────────────────────────────────────────

describe('key operations', () => {
  test('getPublicKey derives 32-byte public key from private key', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const derived = getPublicKey(privateKeyB64);
    expect(derived).toEqual(publicKeyBytes);
    expect(derived.length).toBe(32);
  });

  test('same private key always produces same public key', () => {
    const { privateKeyB64 } = generateTestKeypair();
    const pk1 = getPublicKey(privateKeyB64);
    const pk2 = getPublicKey(privateKeyB64);
    expect(pk1).toEqual(pk2);
  });

  test('different private keys produce different public keys', () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    expect(kp1.publicKeyBytes).not.toEqual(kp2.publicKeyBytes);
  });

  test('computeKeyId returns 8-char hex string', async () => {
    const { publicKeyBytes } = generateTestKeypair();
    const kid = await computeKeyId(publicKeyBytes);
    expect(kid.length).toBe(8);
    expect(kid).toMatch(/^[0-9a-f]{8}$/);
  });

  test('computeKeyId is deterministic', async () => {
    const { publicKeyBytes } = generateTestKeypair();
    const kid1 = await computeKeyId(publicKeyBytes);
    const kid2 = await computeKeyId(publicKeyBytes);
    expect(kid1).toBe(kid2);
  });

  test('different keys produce different key IDs', async () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    const kid1 = await computeKeyId(kp1.publicKeyBytes);
    const kid2 = await computeKeyId(kp2.publicKeyBytes);
    expect(kid1).not.toBe(kid2);
  });
});

// ─── JWK format ─────────────────────────────────────────────────────────────

describe('JWK format', () => {
  test('publicKeyToJWK returns correct OKP/Ed25519 JWK', async () => {
    const { publicKeyBytes } = generateTestKeypair();
    const kid = await computeKeyId(publicKeyBytes);
    const jwk = await publicKeyToJWK(publicKeyBytes, kid);

    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
    expect(jwk.use).toBe('sig');
    expect(jwk.alg).toBe('EdDSA');
    expect(jwk.kid).toBe(kid);
    expect(typeof jwk.x).toBe('string');
    expect(jwk.x.length).toBeGreaterThan(0);
  });

  test('JWK x field decodes back to original public key', async () => {
    const { publicKeyBytes } = generateTestKeypair();
    const kid = await computeKeyId(publicKeyBytes);
    const jwk = await publicKeyToJWK(publicKeyBytes, kid);

    const decodedPk = b64urlDecode(jwk.x);
    expect(decodedPk).toEqual(publicKeyBytes);
  });
});

// ─── JWT creation ───────────────────────────────────────────────────────────

describe('createJWT', () => {
  test('produces compact JWT with 3 dot-separated parts', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const kid = 'test-kid';
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, kid);
    const parts = token.split('.');
    expect(parts.length).toBe(3);
  });

  test('header contains alg=EdDSA, typ=JWT, kid', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const kid = 'abcd1234';
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, kid);
    const headerJson = new TextDecoder().decode(b64urlDecode(token.split('.')[0]));
    const header = JSON.parse(headerJson);

    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('JWT');
    expect(header.kid).toBe('abcd1234');
  });

  test('payload contains all standard JWT claims', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, 'kid');
    const payloadJson = new TextDecoder().decode(b64urlDecode(token.split('.')[1]));
    const payload = JSON.parse(payloadJson);

    expect(payload.iss).toBe('https://agentlair.dev');
    expect(payload.sub).toBe('acc_test123');
    expect(payload.aud).toBe('https://mcp.example.com');
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
    expect(payload.jti).toBe('aat_testtoken123');
  });

  test('payload contains AgentLair-specific claims', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const claims = makeClaims({
      al_name: 'research-agent',
      al_email: 'research@agentlair.dev',
    });

    const token = createJWT(claims, privateKeyB64, 'kid');
    const payloadJson = new TextDecoder().decode(b64urlDecode(token.split('.')[1]));
    const payload = JSON.parse(payloadJson);

    expect(payload.al_name).toBe('research-agent');
    expect(payload.al_email).toBe('research@agentlair.dev');
    expect(payload.al_scopes).toEqual(['mcp:tools:read', 'mcp:tools:execute']);
    expect(payload.al_audit_url).toBe('https://agentlair.dev/v1/audit/aat_testtoken123');
  });

  test('payload contains did:web claim when provided', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const claims = makeClaims({
      did: 'did:web:agentlair.dev:agents:acc_test123',
    });

    const token = createJWT(claims, privateKeyB64, 'kid');
    const payloadJson = new TextDecoder().decode(b64urlDecode(token.split('.')[1]));
    const payload = JSON.parse(payloadJson);

    expect(payload.did).toBe('did:web:agentlair.dev:agents:acc_test123');
    // did claim is absent when not provided
    const claimsWithoutDid = makeClaims();
    const tokenWithoutDid = createJWT(claimsWithoutDid, privateKeyB64, 'kid');
    const payloadWithoutDid = JSON.parse(new TextDecoder().decode(b64urlDecode(tokenWithoutDid.split('.')[1])));
    expect(payloadWithoutDid.did).toBeUndefined();
  });

  test('signature is Ed25519 (64 bytes encoded)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, 'kid');
    const sigBytes = b64urlDecode(token.split('.')[2]);
    expect(sigBytes.length).toBe(64);
  });

  test('same claims + key produce same token (deterministic)', () => {
    const { privateKeyB64 } = generateTestKeypair();
    const claims = makeClaims();

    const token1 = createJWT(claims, privateKeyB64, 'kid');
    const token2 = createJWT(claims, privateKeyB64, 'kid');
    expect(token1).toBe(token2);
  });
});

// ─── JWT verification ───────────────────────────────────────────────────────

describe('verifyJWT', () => {
  test('valid token verifies and returns claims', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, 'kid');
    const verified = verifyJWT(token, publicKeyBytes);

    expect(verified).not.toBeNull();
    expect(verified!.iss).toBe('https://agentlair.dev');
    expect(verified!.sub).toBe('acc_test123');
    expect(verified!.jti).toBe('aat_testtoken123');
    expect(verified!.al_scopes).toEqual(['mcp:tools:read', 'mcp:tools:execute']);
  });

  test('wrong public key fails verification', () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    const claims = makeClaims();

    const token = createJWT(claims, kp1.privateKeyB64, 'kid');
    const verified = verifyJWT(token, kp2.publicKeyBytes);

    expect(verified).toBeNull();
  });

  test('tampered payload fails verification', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, 'kid');
    const parts = token.split('.');

    // Tamper with payload (change sub claim)
    const tamperedClaims = { ...claims, sub: 'acc_evil' };
    const tamperedPayload = b64urlEncode(JSON.stringify(tamperedClaims));
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verified = verifyJWT(tamperedToken, publicKeyBytes);
    expect(verified).toBeNull();
  });

  test('tampered header fails verification', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, 'kid');
    const parts = token.split('.');

    // Tamper with header
    const tamperedHeader = b64urlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const tamperedToken = `${tamperedHeader}.${parts[1]}.${parts[2]}`;

    const verified = verifyJWT(tamperedToken, publicKeyBytes);
    expect(verified).toBeNull();
  });

  test('malformed token returns null', () => {
    const { publicKeyBytes } = generateTestKeypair();

    expect(verifyJWT('not.a.valid.token', publicKeyBytes)).toBeNull();
    expect(verifyJWT('', publicKeyBytes)).toBeNull();
    expect(verifyJWT('onlyonepart', publicKeyBytes)).toBeNull();
    expect(verifyJWT('two.parts', publicKeyBytes)).toBeNull();
  });

  test('token with invalid base64url signature returns null', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const claims = makeClaims();

    const token = createJWT(claims, privateKeyB64, 'kid');
    const parts = token.split('.');
    const badToken = `${parts[0]}.${parts[1]}.!!!invalid!!!`;

    const verified = verifyJWT(badToken, publicKeyBytes);
    expect(verified).toBeNull();
  });
});

// ─── JWKS document ──────────────────────────────────────────────────────────

describe('buildJWKS', () => {
  test('returns valid JWKS document with one key', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const jwks = await buildJWKS(privateKeyB64);

    expect(jwks.keys).toBeArray();
    expect(jwks.keys.length).toBe(1);
  });

  test('JWKS key has all required fields', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const jwks = await buildJWKS(privateKeyB64);
    const key = jwks.keys[0];

    expect(key.kty).toBe('OKP');
    expect(key.crv).toBe('Ed25519');
    expect(key.alg).toBe('EdDSA');
    expect(key.use).toBe('sig');
    expect(typeof key.kid).toBe('string');
    expect(typeof key.x).toBe('string');
  });

  test('JWKS key ID matches JWT header kid', async () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const kid = await computeKeyId(publicKeyBytes);

    // Build JWKS
    const jwks = await buildJWKS(privateKeyB64);
    expect(jwks.keys[0].kid).toBe(kid);

    // Create JWT
    const claims = makeClaims();
    const token = createJWT(claims, privateKeyB64, kid);
    const headerJson = new TextDecoder().decode(b64urlDecode(token.split('.')[0]));
    const header = JSON.parse(headerJson);

    // Key IDs must match
    expect(header.kid).toBe(jwks.keys[0].kid);
  });

  test('JWKS public key can verify JWT created with corresponding private key', async () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const kid = await computeKeyId(publicKeyBytes);

    // Create JWT
    const claims = makeClaims();
    const token = createJWT(claims, privateKeyB64, kid);

    // Get public key from JWKS
    const jwks = await buildJWKS(privateKeyB64);
    const jwkPublicKey = b64urlDecode(jwks.keys[0].x);

    // Verify JWT using JWKS public key
    const verified = verifyJWT(token, jwkPublicKey);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe('acc_test123');
  });

  test('JWKS does not contain private key material', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const jwks = await buildJWKS(privateKeyB64);
    const key = jwks.keys[0];

    // Must NOT have 'd' (private key parameter)
    expect(key).not.toHaveProperty('d');

    // Stringify and check for any base64 of the private key
    const jwksStr = JSON.stringify(jwks);
    const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
    const privKeyB64url = b64urlEncode(privateKeyBytes);
    expect(jwksStr).not.toContain(privKeyB64url);
  });
});

// ─── Expiry validation ──────────────────────────────────────────────────────

describe('token expiry', () => {
  test('token with future exp verifies successfully', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const now = Math.floor(Date.now() / 1000);
    const claims = makeClaims({ exp: now + 3600 });

    const token = createJWT(claims, privateKeyB64, 'kid');
    const verified = verifyJWT(token, publicKeyBytes);

    expect(verified).not.toBeNull();
    expect(verified!.exp).toBeGreaterThan(now);
  });

  test('exp claim is set correctly based on TTL', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const now = Math.floor(Date.now() / 1000);
    const ttl = 7200; // 2 hours
    const claims = makeClaims({ exp: now + ttl, iat: now });

    const token = createJWT(claims, privateKeyB64, 'kid');
    const verified = verifyJWT(token, publicKeyBytes);

    expect(verified).not.toBeNull();
    expect(verified!.exp - verified!.iat).toBe(ttl);
  });

  test('iat is set to current time', () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const now = Math.floor(Date.now() / 1000);
    const claims = makeClaims({ iat: now });

    const token = createJWT(claims, privateKeyB64, 'kid');
    const verified = verifyJWT(token, publicKeyBytes);

    expect(verified).not.toBeNull();
    // iat should be within a few seconds of now
    expect(Math.abs(verified!.iat - now)).toBeLessThan(5);
  });
});

// ─── pubkeyToRadicleNid ─────────────────────────────────────────────────────

describe('pubkeyToRadicleNid', () => {
  // T1: Reference vector — all-zero pubkey (pinned 2026-05-15 against PoC)
  test('T1: all-zero pubkey produces pinned did:key output', () => {
    const input = new Uint8Array(32); // 32 zero bytes
    const result = pubkeyToRadicleNid(input);
    expect(result).toBe('did:key:z6MkeTG3bFFSLYVU7VqhgZxqr6YzpaGrQtFMh1uvqGy1vDnP');
  });

  // T2: Reference vector — seed 0x42×32 (pinned 2026-05-15 against PoC)
  test('T2: 0x42×32 pubkey produces pinned did:key output', () => {
    const input = new Uint8Array(32).fill(0x42);
    const result = pubkeyToRadicleNid(input);
    expect(result).toBe('did:key:z6MkiuuZ37z7NE6RKUMCUHVV3sVLw4A8s5ZUZwuEgMvZED53');
  });

  // T3: Reference vector — bytes 1..32 (pinned 2026-05-15 against PoC)
  test('T3: sequential bytes 1..32 pubkey produces pinned did:key output', () => {
    const input = Uint8Array.from([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]);
    const result = pubkeyToRadicleNid(input);
    expect(result).toBe('did:key:z6MkeXCES4onVW4up9Qgz1KRnZsKmGufcaZxF6Zpv2w5QwUK');
  });

  // T4: Determinism — same input twice → identical output
  test('T4: same input always produces identical output', () => {
    const input = crypto.getRandomValues(new Uint8Array(32));
    const result1 = pubkeyToRadicleNid(input);
    const result2 = pubkeyToRadicleNid(input);
    expect(result1).toBe(result2);
  });

  // T5: Length & prefix — must start with did:key:z6Mk (Ed25519 multicodec marker)
  test('T5: output starts with did:key:z6Mk (z6 multibase + Mk ed25519-pub multicodec)', () => {
    const input = crypto.getRandomValues(new Uint8Array(32));
    const result = pubkeyToRadicleNid(input);
    expect(result.startsWith('did:key:z6Mk')).toBe(true);
  });
});

// ─── Audit middleware integration ───────────────────────────────────────────

describe('audit categorization for tokens', () => {
  // Import audit helpers to verify they handle token paths
  const { getCategory, getAction } = require('./middleware/audit');

  test('token paths are categorized as auth', () => {
    expect(getCategory('/v1/tokens/issue', 200)).toBe('auth');
    expect(getCategory('/v1/tokens/info', 200)).toBe('auth');
    expect(getCategory('/v1/tokens', 200)).toBe('auth');
  });

  test('POST /v1/tokens/issue → auth.token_issue', () => {
    expect(getAction('auth', 'POST', '/v1/tokens/issue')).toBe('auth.token_issue');
  });

  test('GET /v1/tokens/info → auth.token_info', () => {
    expect(getAction('auth', 'GET', '/v1/tokens/info')).toBe('auth.token_info');
  });

  test('POST /v1/tokens/introspect → auth.token_introspect', () => {
    expect(getAction('auth', 'POST', '/v1/tokens/introspect')).toBe('auth.token_introspect');
  });
});
