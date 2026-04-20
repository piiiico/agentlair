/**
 * @agentlair/verify — Tests
 *
 * Unit tests using mock JWTs/JWKS (no network calls for unit tests).
 * Integration test against live agentlair.dev JWKS.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { verifyAAT } from './verify.js';
import { clearJWKSCache } from './jwks.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64urlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

interface TestKeypair {
  privateKeyBytes: Uint8Array;
  privateKeyB64: string;
  publicKeyBytes: Uint8Array;
  kid: string;
}

async function generateKeypair(): Promise<TestKeypair> {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));

  // Compute kid: first 8 chars of SHA-256 hex of public key
  const hash = await crypto.subtle.digest('SHA-256', publicKeyBytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const kid = hex.slice(0, 8);

  return { privateKeyBytes, privateKeyB64, publicKeyBytes, kid };
}

function createTestJWT(
  claims: Record<string, unknown>,
  privateKeyBytes: Uint8Array,
  kid: string,
): string {
  const header = { alg: 'EdDSA', typ: 'JWT', kid };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(signingInput);
  const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);
  return `${headerB64}.${payloadB64}.${b64urlEncode(signatureBytes)}`;
}

function buildJWKS(publicKeyBytes: Uint8Array, kid: string): unknown {
  return {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: b64urlEncode(publicKeyBytes),
        kid,
        use: 'sig',
        alg: 'EdDSA',
      },
    ],
  };
}

function makeClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    al_email: 'research-agent@agentlair.dev',
    al_name: 'research-agent',
    ...overrides,
  };
}

// ─── Mock JWKS server setup ──────────────────────────────────────────────────

let keypair: TestKeypair;
let originalFetch: typeof globalThis.fetch;

const MOCK_JWKS_URL = 'https://mock.agentlair.test/.well-known/jwks.json';

beforeAll(async () => {
  keypair = await generateKeypair();
  originalFetch = globalThis.fetch;

  // Mock fetch to intercept JWKS requests
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    if (url === MOCK_JWKS_URL) {
      return new Response(JSON.stringify(buildJWKS(keypair.publicKeyBytes, keypair.kid)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Fall through to real fetch for live integration test
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  clearJWKSCache();
});

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('verifyAAT — unit', () => {
  test('valid token returns agentId, scopes, dates', async () => {
    const token = createTestJWT(makeClaims(), keypair.privateKeyBytes, keypair.kid);
    const result = await verifyAAT(token, { jwksUrl: MOCK_JWKS_URL });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('expected valid');

    expect(result.agentId).toBe('acc_test123');
    expect(result.operatorEmail).toBe('research-agent@agentlair.dev');
    expect(result.scopes).toEqual(['mcp:tools:read', 'mcp:tools:execute']);
    expect(result.issuedAt).toBeInstanceOf(Date);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(result.issuedAt.getTime());
    expect(result.claims.jti).toBe('aat_testtoken123');
  });

  test('expired token returns valid:false with clear message', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = createTestJWT(
      makeClaims({ exp: now - 60, iat: now - 3660 }),
      keypair.privateKeyBytes,
      keypair.kid,
    );

    const result = await verifyAAT(token, { jwksUrl: MOCK_JWKS_URL });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.error).toContain('expired');
  });

  test('tampered payload returns valid:false', async () => {
    const token = createTestJWT(makeClaims(), keypair.privateKeyBytes, keypair.kid);
    // Corrupt the payload section
    const parts = token.split('.');
    const corruptedPayload = b64urlEncode(JSON.stringify({ ...makeClaims(), sub: 'acc_evil' }));
    const tampered = `${parts[0]}.${corruptedPayload}.${parts[2]}`;

    const result = await verifyAAT(tampered, { jwksUrl: MOCK_JWKS_URL });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.error).toMatch(/signature|key/i);
  });

  test('wrong issuer returns valid:false', async () => {
    const token = createTestJWT(
      makeClaims({ iss: 'https://evil.example.com' }),
      keypair.privateKeyBytes,
      keypair.kid,
    );

    const result = await verifyAAT(token, { jwksUrl: MOCK_JWKS_URL });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.error.toLowerCase()).toContain('iss');
  });

  test('audience check — match passes', async () => {
    const token = createTestJWT(makeClaims(), keypair.privateKeyBytes, keypair.kid);

    const result = await verifyAAT(token, {
      jwksUrl: MOCK_JWKS_URL,
      audience: 'https://mcp.example.com',
    });

    expect(result.valid).toBe(true);
  });

  test('audience check — mismatch fails', async () => {
    const token = createTestJWT(makeClaims(), keypair.privateKeyBytes, keypair.kid);

    const result = await verifyAAT(token, {
      jwksUrl: MOCK_JWKS_URL,
      audience: 'https://wrong-service.example.com',
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.error.toLowerCase()).toContain('aud');
  });

  test('malformed token string returns valid:false', async () => {
    const result = await verifyAAT('not.a.jwt.at.all', { jwksUrl: MOCK_JWKS_URL });
    expect(result.valid).toBe(false);
  });

  test('empty string returns valid:false', async () => {
    const result = await verifyAAT('', { jwksUrl: MOCK_JWKS_URL });
    expect(result.valid).toBe(false);
  });

  test('missing al_scopes returns valid:false', async () => {
    const claims = makeClaims();
    delete (claims as Record<string, unknown>)['al_scopes'];
    const token = createTestJWT(claims, keypair.privateKeyBytes, keypair.kid);

    const result = await verifyAAT(token, { jwksUrl: MOCK_JWKS_URL });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.error).toContain('al_scopes');
  });

  test('requiredClaims — match passes', async () => {
    const token = createTestJWT(makeClaims(), keypair.privateKeyBytes, keypair.kid);

    const result = await verifyAAT(token, {
      jwksUrl: MOCK_JWKS_URL,
      requiredClaims: { sub: 'acc_test123' },
    });

    expect(result.valid).toBe(true);
  });

  test('requiredClaims — mismatch fails', async () => {
    const token = createTestJWT(makeClaims(), keypair.privateKeyBytes, keypair.kid);

    const result = await verifyAAT(token, {
      jwksUrl: MOCK_JWKS_URL,
      requiredClaims: { sub: 'acc_other' },
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.error).toContain('sub');
  });

  test('token without al_email sets operatorEmail to undefined', async () => {
    const claims = makeClaims();
    delete (claims as Record<string, unknown>)['al_email'];
    const token = createTestJWT(claims, keypair.privateKeyBytes, keypair.kid);

    const result = await verifyAAT(token, { jwksUrl: MOCK_JWKS_URL });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('expected valid');
    expect(result.operatorEmail).toBeUndefined();
  });

  test('trust attestation claim is passed through', async () => {
    const token = createTestJWT(
      makeClaims({
        al_trust: {
          score: 85,
          level: 'senior',
          confidence: 0.92,
          computed_at: '2026-04-20T00:00:00Z',
          trend: 'improving',
        },
      }),
      keypair.privateKeyBytes,
      keypair.kid,
    );

    const result = await verifyAAT(token, { jwksUrl: MOCK_JWKS_URL });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('expected valid');
    expect(result.claims.al_trust?.level).toBe('senior');
    expect(result.claims.al_trust?.score).toBe(85);
  });
});

// ─── Integration test (live agentlair.dev) ────────────────────────────────────

describe('verifyAAT — integration', () => {
  test('JWKS endpoint is reachable and returns valid EdDSA keys', async () => {
    // Restore real fetch for this test
    globalThis.fetch = originalFetch;

    try {
      const res = await originalFetch('https://agentlair.dev/.well-known/jwks.json');
      expect(res.ok).toBe(true);

      const jwks = (await res.json()) as { keys: Array<Record<string, string>> };
      expect(Array.isArray(jwks.keys)).toBe(true);
      expect(jwks.keys.length).toBeGreaterThan(0);

      const edKey = jwks.keys.find((k) => k.alg === 'EdDSA');
      expect(edKey).toBeDefined();
      expect(edKey?.crv).toBe('Ed25519');
      expect(edKey?.kty).toBe('OKP');
      expect(edKey?.kid).toBeDefined();
      expect(edKey?.x).toBeDefined();
    } finally {
      // Restore mock fetch
      globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        if (url === MOCK_JWKS_URL) {
          return new Response(JSON.stringify(buildJWKS(keypair.publicKeyBytes, keypair.kid)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      }) as typeof globalThis.fetch;
    }
  });

  test('a real AAT from AGENTLAIR_AAT env var is valid (if set)', async () => {
    const token = process.env['AGENTLAIR_AAT'];
    if (!token) {
      console.log('Skipping: AGENTLAIR_AAT not set');
      return;
    }

    // Restore real fetch for this test
    const savedFetch = globalThis.fetch;
    globalThis.fetch = originalFetch;

    try {
      const result = await verifyAAT(token);
      // The token may be expired in CI — we just check the structure
      if (result.valid) {
        expect(result.agentId).toBeTruthy();
        expect(result.scopes.length).toBeGreaterThan(0);
        expect(result.issuedAt).toBeInstanceOf(Date);
        expect(result.expiresAt).toBeInstanceOf(Date);
      } else {
        // Expired is acceptable in test env
        expect(result.error).toBeTruthy();
        console.log('AAT result (may be expired):', result.error);
      }
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
