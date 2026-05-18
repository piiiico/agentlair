/**
 * @agentlair/mcp-trust-attestation — Tests
 *
 * Hermetic Bun tests: in-process Hono fixture (no network) for the
 * middleware, mocked-fetch JWKS for the verifier. Mirrors the
 * `packages/verify/src/verify.test.ts` setup.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test';
import { Hono } from 'hono';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import type { KeyObject } from 'node:crypto';

import {
  TRUST_ATTESTATION_EXTENSION,
  buildDescriptor,
  buildServerCardExtension,
  createAttestationMiddleware,
  createNodeHttpHandler,
  verifyAttestation,
  clearJwksCache,
  clearAttestationCache,
} from './index.js';

const MOCK_ISSUER = 'https://mock.agentlair.test';
const MOCK_JWKS_URL = `${MOCK_ISSUER}/.well-known/jwks.json`;
const MOCK_KID = 'mock-kid-1';
const WRONG_KID = 'mock-kid-2';
const DESCRIPTOR_PATH = '/.well-known/agentlair-trust';
const SERVER_ID = 'url_sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

const EXPECTED_DESCRIPTOR_KEYS = [
  'issuer',
  'jwks_uri',
  'attestation_endpoint_template',
  'supported_signals',
  'supported_subjects',
  'supported_subject_id_forms',
  'signal_algorithm_version',
  'max_token_ttl_seconds',
  'bhc_token_type',
  'spec_version',
  'documentation_url',
];

const EXPECTED_SIGNALS = [
  'prompt_injection_indicators',
  'data_exfiltration_indicators',
  'tool_description_drift',
  'config_anomaly',
  'call_frequency_spike',
  'consent_violation_rate',
  'latency_anomaly',
  'origin_change',
];

interface TestKeypair {
  publicKey: CryptoKey | KeyObject;
  privateKey: CryptoKey | KeyObject;
  kid: string;
}

let goodKeypair: TestKeypair;
let wrongKeypair: TestKeypair;
let originalFetch: typeof globalThis.fetch;
let publishedKid: string;

async function generateEd25519Keypair(kid: string): Promise<TestKeypair> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  return { publicKey, privateKey, kid };
}

async function buildJwksBody(kp: TestKeypair): Promise<string> {
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = kp.kid;
  jwk.use = 'sig';
  jwk.alg = 'EdDSA';
  return JSON.stringify({ keys: [jwk] });
}

async function signTestJwt(
  kp: TestKeypair,
  opts: { issuer?: string; expSecondsFromNow?: number; audience?: string; subject?: string } = {},
): Promise<string> {
  const issuer = opts.issuer ?? MOCK_ISSUER;
  const expSeconds = opts.expSecondsFromNow ?? 3600;
  const now = Math.floor(Date.now() / 1000);

  const builder = new SignJWT({ signals: ['prompt_injection_indicators'] })
    .setProtectedHeader({ alg: 'EdDSA', kid: kp.kid })
    .setIssuer(issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + expSeconds)
    .setSubject(opts.subject ?? SERVER_ID);
  if (opts.audience) {
    builder.setAudience(opts.audience);
  }
  return builder.sign(kp.privateKey);
}

beforeAll(async () => {
  goodKeypair = await generateEd25519Keypair(MOCK_KID);
  wrongKeypair = await generateEd25519Keypair(WRONG_KID);
  publishedKid = MOCK_KID;
  originalFetch = globalThis.fetch;

  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url === MOCK_JWKS_URL) {
      const kp = publishedKid === goodKeypair.kid ? goodKeypair : wrongKeypair;
      const body = await buildJwksBody(kp);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('https://agentlair.dev/v1/trust/server/')) {
      return new Response(
        JSON.stringify({ attestation: 'eyJtb2NrIjp0cnVlfQ', subject: SERVER_ID }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  clearJwksCache();
  clearAttestationCache();
});

beforeEach(() => {
  clearJwksCache();
  clearAttestationCache();
  publishedKid = goodKeypair.kid;
});

// ─── Helper: in-process Hono fixture ─────────────────────────────────────────

function buildFixtureApp(): Hono {
  const app = new Hono();
  app.use(DESCRIPTOR_PATH, createAttestationMiddleware({ serverId: SERVER_ID }));
  app.use('/agentlair/trust-attestation/:subject', createAttestationMiddleware({ serverId: SERVER_ID }));
  return app;
}

// ─── Descriptor route tests ──────────────────────────────────────────────────

describe('descriptor route', () => {
  test('GET /.well-known/agentlair-trust returns 200', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    expect(res.status).toBe(200);
  });

  test('Content-Type response header is application/json', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  test('Cache-Control response header is public, max-age=300', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });

  test('descriptor body parses as JSON without error', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    const body = await res.text();
    expect(() => JSON.parse(body)).not.toThrow();
  });

  test('eleven documented keys are present in the parsed body', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of EXPECTED_DESCRIPTOR_KEYS) {
      expect(body).toHaveProperty(key);
    }
    expect(Object.keys(body).length).toBe(EXPECTED_DESCRIPTOR_KEYS.length);
  });

  test('issuer is the literal "https://agentlair.dev"', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    const body = (await res.json()) as { issuer: string };
    expect(body.issuer).toBe('https://agentlair.dev');
  });

  test('supported_signals is an 8-length array with the exact spec members', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    const body = (await res.json()) as { supported_signals: string[] };
    expect(Array.isArray(body.supported_signals)).toBe(true);
    expect(body.supported_signals.length).toBe(8);
    expect(body.supported_signals).toEqual(EXPECTED_SIGNALS);
  });

  test('attestation_endpoint_template contains the literal placeholder {server_id}', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    const body = (await res.json()) as { attestation_endpoint_template: string };
    expect(body.attestation_endpoint_template).toContain('{server_id}');
  });

  test('max_token_ttl_seconds is the number 3600 (not the string "3600")', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    const body = (await res.json()) as { max_token_ttl_seconds: number };
    expect(body.max_token_ttl_seconds).toBe(3600);
    expect(typeof body.max_token_ttl_seconds).toBe('number');
  });

  test('bhc_token_type equals urn:agentlair:bhc-s:v1', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'GET' });
    const body = (await res.json()) as { bhc_token_type: string };
    expect(body.bhc_token_type).toBe('urn:agentlair:bhc-s:v1');
  });

  test('HEAD on descriptor route returns 200 with the same headers and empty body', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const body = await res.text();
    expect(body).toBe('');
  });

  test('POST on descriptor route returns 405 (or 404)', async () => {
    const app = buildFixtureApp();
    const res = await app.request(DESCRIPTOR_PATH, { method: 'POST' });
    expect([404, 405]).toContain(res.status);
  });
});

// ─── Server-card extension test ──────────────────────────────────────────────

describe('buildServerCardExtension', () => {
  test('returns an object whose top-level key is dev.agentlair/trust-attestation', () => {
    const ext = buildServerCardExtension({ serverId: SERVER_ID });
    const keys = Object.keys(ext);
    expect(keys.length).toBe(1);
    expect(keys[0]).toBe('dev.agentlair/trust-attestation');
    expect(keys[0]).toBe(TRUST_ATTESTATION_EXTENSION);
    expect(ext[TRUST_ATTESTATION_EXTENSION]).toBeDefined();
  });
});

// ─── verifyAttestation tests ─────────────────────────────────────────────────

describe('verifyAttestation', () => {
  test('rejects an expired JWT with reason "expired"', async () => {
    const jwt = await signTestJwt(goodKeypair, { expSecondsFromNow: -60 });
    const result = await verifyAttestation(jwt, { issuer: MOCK_ISSUER });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  test('rejects a JWT signed by the wrong key with reason "signature"', async () => {
    // Sign with wrong key; the JWKS hosted at the issuer still publishes only the good key.
    publishedKid = goodKeypair.kid;
    const jwt = await signTestJwt(wrongKeypair, {});
    const result = await verifyAttestation(jwt, { issuer: MOCK_ISSUER });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature');
  });

  test('accepts a well-formed JWT signed by the published key', async () => {
    publishedKid = goodKeypair.kid;
    const jwt = await signTestJwt(goodKeypair, {});
    const result = await verifyAttestation(jwt, { issuer: MOCK_ISSUER });
    expect(result.ok).toBe(true);
    expect(result.payload).toBeDefined();
    const payload = result.payload as { iss: string };
    expect(payload.iss).toBe(MOCK_ISSUER);
  });

  test('rejects a JWT with the wrong issuer with reason "issuer"', async () => {
    publishedKid = goodKeypair.kid;
    const jwt = await signTestJwt(goodKeypair, { issuer: 'https://evil.example.com' });
    const result = await verifyAttestation(jwt, { issuer: MOCK_ISSUER });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('issuer');
  });

  test('rejects a malformed (non-3-part) JWT with reason "malformed"', async () => {
    const result = await verifyAttestation('not.a-valid-jwt', { issuer: MOCK_ISSUER });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('malformed');
  });

  test('rejects an empty string with reason "malformed"', async () => {
    const result = await verifyAttestation('', { issuer: MOCK_ISSUER });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('malformed');
  });
});

// ─── buildDescriptor tests ───────────────────────────────────────────────────

describe('buildDescriptor', () => {
  test('default issuer is https://agentlair.dev and key set matches spec', () => {
    const d = buildDescriptor({ serverId: SERVER_ID });
    expect(Object.keys(d).sort()).toEqual([...EXPECTED_DESCRIPTOR_KEYS].sort());
    expect(d.issuer).toBe('https://agentlair.dev');
    expect(d.jwks_uri).toBe('https://agentlair.dev/.well-known/jwks.json');
    expect(d.spec_version).toBe('0.1.0');
    expect(d.documentation_url).toBe('https://agentlair.dev/docs/bhc-s');
  });

  test('honors issuer override', () => {
    const d = buildDescriptor({ serverId: SERVER_ID, issuer: 'https://custom.test' });
    expect(d.issuer).toBe('https://custom.test');
    expect(d.jwks_uri).toBe('https://custom.test/.well-known/jwks.json');
    expect(d.attestation_endpoint_template).toBe('https://custom.test/v1/trust/server/{server_id}');
  });
});

// ─── node:http adapter smoke test ────────────────────────────────────────────

describe('node:http adapter', () => {
  test('descriptor handler returns 200 with descriptor body and correct headers', async () => {
    const handler = createNodeHttpHandler({ serverId: SERVER_ID });
    const headers: Record<string, string> = {};
    let body = '';
    let statusCode = 0;
    const res = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(v: number) {
        statusCode = v;
      },
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      end(payload?: string | Uint8Array) {
        body = typeof payload === 'string' ? payload : '';
      },
    } as unknown as Parameters<typeof handler>[1];
    const req = {
      url: DESCRIPTOR_PATH,
      method: 'GET',
      headers: {},
    } as Parameters<typeof handler>[0];
    await handler(req, res);
    expect(statusCode).toBe(200);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['cache-control']).toBe('public, max-age=300');
    const parsed = JSON.parse(body);
    expect(parsed.bhc_token_type).toBe('urn:agentlair:bhc-s:v1');
  });
});
