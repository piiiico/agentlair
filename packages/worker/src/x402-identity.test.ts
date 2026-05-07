/**
 * x402 Identity Extension — Unit Tests
 *
 * Covers 9 verification paths:
 * 1. Round-trip (pack → verify with mocked JWKS)
 * 2. Wrong audience
 * 3. Expired AAT
 * 4. Forged signature
 * 5. Wrong issuer
 * 6. Wrong alg (Fix 3 regression)
 * 7. JWKS-spoofing regression — CRITICAL: attacker ext.jwks_uri must be ignored
 * 8. Missing extension
 * 9. Malformed AAT
 */

import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlEncode, b64urlDecode, createJWT, computeKeyId, type AATClaims } from './jwt.js';
import {
  verifyAATFromX402Extensions,
  packAATIntoX402Extensions,
  EXPECTED_ISSUER,
  DEFAULT_AGENTLAIR_JWKS_URI,
  type X402PaymentPayload,
} from './x402-identity.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a JWKS response body from a public key + kid. */
function makeJWKS(publicKey: Uint8Array, kid: string): { keys: Record<string, string>[] } {
  return {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: b64urlEncode(publicKey),
        kid,
        use: 'sig',
        alg: 'EdDSA',
      },
    ],
  };
}

/** Build minimal valid AATClaims with optional overrides. */
function makeClaims(overrides?: Partial<AATClaims>): AATClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: EXPECTED_ISSUER,
    sub: 'acc_test123',
    aud: 'https://example.com/resource',
    exp: now + 3600,
    iat: now,
    jti: 'test-jti-1',
    al_scopes: ['data:read'],
    al_audit_url: 'https://agentlair.dev/audit/test',
    ...overrides,
  };
}

/** Encode a raw Uint8Array private key as base64 for createJWT. */
function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Build a mock fetch that records which URLs are requested and serves JWKS
 * bodies from the provided map. Unrecognised URLs return 404.
 */
function makeMockFetch(jwksMap: Record<string, object>): {
  fetch: typeof globalThis.fetch;
  fetchedUrls: string[];
} {
  const fetchedUrls: string[] = [];
  const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    fetchedUrls.push(url);
    const body = jwksMap[url];
    if (body) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  };
  return { fetch: mockFetch as typeof globalThis.fetch, fetchedUrls };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('verifyAATFromX402Extensions', () => {
  // Deterministic keypair — same for all tests
  const privateKey = new Uint8Array(32).fill(42);
  const publicKey = ed25519.getPublicKey(privateKey);

  let kid: string;
  let jwks: ReturnType<typeof makeJWKS>;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    kid = await computeKeyId(publicKey);
    jwks = makeJWKS(publicKey, kid);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── 1. Round-trip ──────────────────────────────────────────────────────────

  it('1. round-trip: valid AAT pack → verify returns claims', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    const claims = makeClaims();
    const aat = createJWT(claims, toB64(privateKey), kid);
    const payload = packAATIntoX402Extensions(aat, {});

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
      resourceUrl: 'https://example.com/resource',
    });

    expect(result).not.toBeNull();
    expect(result?.iss).toBe(EXPECTED_ISSUER);
    expect(result?.sub).toBe('acc_test123');
    expect(result?.aud).toBe('https://example.com/resource');
  });

  // ── 2. Wrong audience ─────────────────────────────────────────────────────

  it('2. wrong audience: aud=resource-a, verified against resource-b → null', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    const claims = makeClaims({ aud: 'https://resource-a.com' });
    const aat = createJWT(claims, toB64(privateKey), kid);
    const payload = packAATIntoX402Extensions(aat, {});

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
      resourceUrl: 'https://resource-b.com',
    });

    expect(result).toBeNull();
  });

  // ── 3. Expired ────────────────────────────────────────────────────────────

  it('3. expired AAT: exp in past → null', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    const now = Math.floor(Date.now() / 1000);
    const claims = makeClaims({ exp: now - 60 });
    const aat = createJWT(claims, toB64(privateKey), kid);
    const payload = packAATIntoX402Extensions(aat, {});

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
    });

    expect(result).toBeNull();
  });

  // ── 4. Forged signature ───────────────────────────────────────────────────

  it('4. forged signature: last signature byte flipped → null', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    const claims = makeClaims();
    const aat = createJWT(claims, toB64(privateKey), kid);

    // Corrupt the signature: flip last byte
    const parts = aat.split('.');
    const sigBytes = b64urlDecode(parts[2]);
    sigBytes[sigBytes.length - 1] ^= 0xff;
    const corruptedAat = `${parts[0]}.${parts[1]}.${b64urlEncode(sigBytes)}`;

    const payload: X402PaymentPayload = {
      extensions: {
        'agentlair.dev/identity': {
          aat: corruptedAat,
          jwks_uri: DEFAULT_AGENTLAIR_JWKS_URI,
          aud_bound: true,
        },
      },
    };

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
    });

    expect(result).toBeNull();
  });

  // ── 5. Wrong issuer ───────────────────────────────────────────────────────

  it('5. wrong issuer: iss=https://evil.com → null (Fix 4 regression)', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    const claims = makeClaims({ iss: 'https://evil.com' });
    const aat = createJWT(claims, toB64(privateKey), kid);
    const payload = packAATIntoX402Extensions(aat, {});

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
    });

    expect(result).toBeNull();
  });

  // ── 6. Wrong alg ──────────────────────────────────────────────────────────

  it('6. wrong alg: header alg=HS256 → null (Fix 3 regression)', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    // Manually build a JWT with alg: HS256 in header but valid Ed25519 signature
    const header = { alg: 'HS256', typ: 'JWT', kid };
    const claims = makeClaims();
    const headerB64 = b64urlEncode(JSON.stringify(header));
    const payloadB64 = b64urlEncode(JSON.stringify(claims));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sigBytes = ed25519.sign(new TextEncoder().encode(signingInput), privateKey);
    const fakeJwt = `${headerB64}.${payloadB64}.${b64urlEncode(sigBytes)}`;

    const payload: X402PaymentPayload = {
      extensions: {
        'agentlair.dev/identity': {
          aat: fakeJwt,
          jwks_uri: DEFAULT_AGENTLAIR_JWKS_URI,
          aud_bound: true,
        },
      },
    };

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
    });

    expect(result).toBeNull();
  });

  // ── 7. JWKS-spoofing regression (CRITICAL) ────────────────────────────────

  it('7. JWKS-spoofing: ext.jwks_uri attacker URL is ignored; only agentlair.dev fetched', async () => {
    const attackerUrl = 'https://evil.com/.well-known/jwks.json';

    // Attacker has their own keypair + JWKS
    const attackerPrivKey = new Uint8Array(32).fill(99);
    const attackerPubKey = ed25519.getPublicKey(attackerPrivKey);
    const attackerKid = await computeKeyId(attackerPubKey);
    const attackerJwks = makeJWKS(attackerPubKey, attackerKid);

    // Attacker signs a AAT using their own key — valid against attacker JWKS
    const claims = makeClaims();
    const attackerAat = createJWT(claims, toB64(attackerPrivKey), attackerKid);

    // Track ALL fetched URLs; only attacker URL is served (agentlair.dev returns 404)
    const fetchedUrls: string[] = [];
    const { fetch: baseMock } = makeMockFetch({ [attackerUrl]: attackerJwks });
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      fetchedUrls.push(url);
      return baseMock(input, init);
    };

    // Pack with ext.jwks_uri = attacker URL (the malicious field)
    const packed: X402PaymentPayload = {
      extensions: {
        'agentlair.dev/identity': {
          aat: attackerAat,
          jwks_uri: attackerUrl,   // attacker-controlled — must be ignored
          aud_bound: true,
        },
      },
    };

    // No opts.jwksUri override — verifier must fall back to DEFAULT_AGENTLAIR_JWKS_URI
    const result = await verifyAATFromX402Extensions(packed);

    // Verifier fetched AgentLair JWKS (server-pinned), NOT attacker URL
    expect(fetchedUrls).toContain(DEFAULT_AGENTLAIR_JWKS_URI);
    expect(fetchedUrls).not.toContain(attackerUrl);

    // Verification fails: attacker's kid not in AgentLair JWKS (404)
    expect(result).toBeNull();
  });

  // ── 8. Missing extension ──────────────────────────────────────────────────

  it('8a. missing extension: no extensions field at all → null', async () => {
    const payload: X402PaymentPayload = {};
    const result = await verifyAATFromX402Extensions(payload);
    expect(result).toBeNull();
  });

  it('8b. missing extension: extensions present but no agentlair.dev/identity → null', async () => {
    const payload: X402PaymentPayload = {
      extensions: { 'other.extension': { data: 'irrelevant' } },
    };
    const result = await verifyAATFromX402Extensions(payload);
    expect(result).toBeNull();
  });

  // ── 9. Malformed AAT ──────────────────────────────────────────────────────

  it('9a. malformed AAT: too many dots → null', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    const payload: X402PaymentPayload = {
      extensions: {
        'agentlair.dev/identity': {
          aat: 'not.a.valid.jwt.at.all',
          jwks_uri: DEFAULT_AGENTLAIR_JWKS_URI,
          aud_bound: false,
        },
      },
    };

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
    });
    expect(result).toBeNull();
  });

  it('9b. malformed AAT: invalid base64 in header segment → null', async () => {
    const { fetch: mockFetch } = makeMockFetch({ [DEFAULT_AGENTLAIR_JWKS_URI]: jwks });
    globalThis.fetch = mockFetch;

    const payload: X402PaymentPayload = {
      extensions: {
        'agentlair.dev/identity': {
          aat: '!!!invalid!!!.payload.signature',
          jwks_uri: DEFAULT_AGENTLAIR_JWKS_URI,
          aud_bound: false,
        },
      },
    };

    const result = await verifyAATFromX402Extensions(payload, {
      jwksUri: DEFAULT_AGENTLAIR_JWKS_URI,
    });
    expect(result).toBeNull();
  });
});
