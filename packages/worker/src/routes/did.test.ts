/**
 * DID Document Resolution — Unit + Integration Tests
 *
 * Unit tests: buildDIDDocument function (no network)
 * Integration tests: GET /agents/:id/did.json (requires running worker)
 *
 * Run:   bun test src/routes/did.test.ts
 * Live:  BASE_URL=https://agentlair.dev bun test src/routes/did.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlEncode } from '../jwt.js';
import { buildDIDDocument } from './did.js';
import type { SigningKeyRecord } from './signing-keys.js';

const BASE_URL = process.env.BASE_URL ?? 'https://agentlair.dev';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSigningKey(overrides: Partial<SigningKeyRecord> = {}): SigningKeyRecord {
  return {
    keyid: 'test-keyid-abc123456789',
    algorithm: 'ed25519',
    public_key: 'dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA', // base64url test value
    agent_id: 'acc_test123',
    registered_at: '2026-04-18T00:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

// ─── Unit Tests: buildDIDDocument ────────────────────────────────────────────

describe('buildDIDDocument', () => {
  test('returns valid DID Document structure with active signing key', () => {
    const key = makeSigningKey();
    const doc = buildDIDDocument('acc_test123', key);

    // Required W3C DID Core fields
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc.id).toBe('did:web:agentlair.dev:agents:acc_test123');
    expect(Array.isArray(doc.verificationMethod)).toBe(true);
    expect(Array.isArray(doc.authentication)).toBe(true);
    expect(Array.isArray(doc.assertionMethod)).toBe(true);
  });

  test('DID id follows did:web spec — colons encode path segments', () => {
    const doc = buildDIDDocument('acc_xyz789', null);
    // did:web:agentlair.dev:agents:acc_xyz789 resolves to
    // https://agentlair.dev/agents/acc_xyz789/did.json
    expect(doc.id).toBe('did:web:agentlair.dev:agents:acc_xyz789');
  });

  test('includes JsonWebKey2020 verification method when signing key is active', () => {
    const key = makeSigningKey({ public_key: 'abc123pubkey' });
    const doc = buildDIDDocument('acc_test123', key);

    expect(doc.verificationMethod.length).toBe(1);
    const vm = doc.verificationMethod[0];
    expect(vm.id).toBe('did:web:agentlair.dev:agents:acc_test123#key-1');
    expect(vm.type).toBe('JsonWebKey2020');
    expect(vm.controller).toBe('did:web:agentlair.dev:agents:acc_test123');
    expect(vm.publicKeyJwk.kty).toBe('OKP');
    expect(vm.publicKeyJwk.crv).toBe('Ed25519');
    expect(vm.publicKeyJwk.x).toBe('abc123pubkey');
    expect(vm.publicKeyJwk.use).toBe('sig');
    expect(vm.publicKeyJwk.alg).toBe('EdDSA');
  });

  test('authentication and assertionMethod reference the key when present', () => {
    const key = makeSigningKey();
    const doc = buildDIDDocument('acc_test123', key);

    const keyRef = 'did:web:agentlair.dev:agents:acc_test123#key-1';
    expect(doc.authentication).toContain(keyRef);
    expect(doc.assertionMethod).toContain(keyRef);
  });

  test('no verification method when signing key is null and no root key provided', () => {
    const doc = buildDIDDocument('acc_test123', null);

    expect(doc.verificationMethod.length).toBe(0);
    expect(doc.authentication.length).toBe(0);
    expect(doc.assertionMethod.length).toBe(0);
  });

  test('no verification method when signing key is revoked and no root key provided', () => {
    const key = makeSigningKey({ status: 'revoked' });
    const doc = buildDIDDocument('acc_test123', key);

    expect(doc.verificationMethod.length).toBe(0);
    expect(doc.authentication.length).toBe(0);
    expect(doc.assertionMethod.length).toBe(0);
  });

  test('falls back to root public key when signing key is null', () => {
    const rootPublicKeyX = 'cm9vdC1wdWJsaWMta2V5LXg'; // base64url test value
    const doc = buildDIDDocument('acc_test123', null, rootPublicKeyX);

    expect(doc.verificationMethod.length).toBe(1);
    const vm = doc.verificationMethod[0];
    expect(vm.id).toBe('did:web:agentlair.dev:agents:acc_test123#key-1');
    expect(vm.type).toBe('JsonWebKey2020');
    expect(vm.controller).toBe('did:web:agentlair.dev:agents:acc_test123');
    expect(vm.publicKeyJwk.kty).toBe('OKP');
    expect(vm.publicKeyJwk.crv).toBe('Ed25519');
    expect(vm.publicKeyJwk.x).toBe(rootPublicKeyX);
    expect(vm.publicKeyJwk.alg).toBe('EdDSA');
    expect(doc.authentication).toContain('did:web:agentlair.dev:agents:acc_test123#key-1');
    expect(doc.assertionMethod).toContain('did:web:agentlair.dev:agents:acc_test123#key-1');
  });

  test('falls back to root public key when signing key is revoked', () => {
    const rootPublicKeyX = 'cm9vdC1wdWJsaWMta2V5LXg';
    const revokedKey = makeSigningKey({ status: 'revoked' });
    const doc = buildDIDDocument('acc_test123', revokedKey, rootPublicKeyX);

    expect(doc.verificationMethod.length).toBe(1);
    expect(doc.verificationMethod[0].publicKeyJwk.x).toBe(rootPublicKeyX);
  });

  test('per-agent key takes priority over root key fallback when both present', () => {
    const perAgentKey = makeSigningKey({ public_key: 'per-agent-key-x' });
    const rootPublicKeyX = 'cm9vdC1wdWJsaWMta2V5LXg';
    const doc = buildDIDDocument('acc_test123', perAgentKey, rootPublicKeyX);

    expect(doc.verificationMethod.length).toBe(1);
    expect(doc.verificationMethod[0].publicKeyJwk.x).toBe('per-agent-key-x');
  });

  test('always includes JWKS service endpoint and AgentLairTrustProfile service', () => {
    // With key — now 2 services: JWKS + AgentLairTrustProfile (RFC-001 Phase 1)
    const docWithKey = buildDIDDocument('acc_test123', makeSigningKey());
    expect(docWithKey.service).toBeDefined();
    expect(docWithKey.service!.length).toBe(2);

    const jwksSvc = docWithKey.service!.find((s) => s.type === 'JsonWebKeySet2020');
    expect(jwksSvc).toBeDefined();
    expect(jwksSvc!.serviceEndpoint).toBe(
      'https://agentlair.dev/agents/acc_test123/.well-known/jwks.json',
    );

    const trustSvc = docWithKey.service!.find((s) => s.type === 'AgentLairTrustProfile');
    expect(trustSvc).toBeDefined();
    expect(trustSvc!.serviceEndpoint).toBe('https://agentlair.dev/v1/trust/acc_test123');

    // Without key — same 2 services
    const docWithoutKey = buildDIDDocument('acc_test123', null);
    expect(docWithoutKey.service).toBeDefined();
    expect(docWithoutKey.service!.length).toBe(2);
    const jwksSvcNoKey = docWithoutKey.service!.find((s) => s.type === 'JsonWebKeySet2020');
    expect(jwksSvcNoKey!.serviceEndpoint).toBe(
      'https://agentlair.dev/agents/acc_test123/.well-known/jwks.json',
    );
  });

  test('service endpoint id contains did fragment #jwks', () => {
    const doc = buildDIDDocument('acc_test123', null);
    expect(doc.service![0].id).toBe('did:web:agentlair.dev:agents:acc_test123#jwks');
  });

  test('includes JWS-2020 security context', () => {
    const doc = buildDIDDocument('acc_test123', null);
    expect(doc['@context']).toContain('https://w3id.org/security/suites/jws-2020/v1');
  });

  test('different account IDs produce different DIDs', () => {
    const doc1 = buildDIDDocument('acc_alpha', null);
    const doc2 = buildDIDDocument('acc_beta', null);
    expect(doc1.id).not.toBe(doc2.id);
    expect(doc1.service![0].serviceEndpoint).not.toBe(doc2.service![0].serviceEndpoint);
  });
});

// ─── alsoKnownAs: Radicle NID in DID Document ───────────────────────────────

describe('buildDIDDocument — alsoKnownAs (Radicle NID)', () => {
  // A real 32-byte Ed25519 public key is required; the base fixture uses 25 bytes.
  const seed = new Uint8Array(32).fill(7);
  const realPubKey = ed25519.getPublicKey(seed);
  const realPubKeyB64 = b64urlEncode(realPubKey);

  function makeSigningKey32(overrides: Partial<SigningKeyRecord> = {}): SigningKeyRecord {
    return {
      keyid: 'test-keyid-abc123456789',
      algorithm: 'ed25519',
      public_key: realPubKeyB64,
      agent_id: 'acc_nid_test',
      registered_at: '2026-05-15T00:00:00.000Z',
      status: 'active',
      ...overrides,
    };
  }

  test('active signing key produces alsoKnownAs array with one did:key entry', () => {
    const key = makeSigningKey32();
    const doc = buildDIDDocument('acc_nid_test', key);

    expect(doc.alsoKnownAs).toBeDefined();
    expect(Array.isArray(doc.alsoKnownAs)).toBe(true);
    expect(doc.alsoKnownAs!.length).toBe(1);
    expect(doc.alsoKnownAs![0].startsWith('did:key:z6Mk')).toBe(true);
  });

  test('alsoKnownAs entry is deterministic for a given public key', () => {
    const key = makeSigningKey32();
    const doc1 = buildDIDDocument('acc_nid_test', key);
    const doc2 = buildDIDDocument('acc_nid_test', key);
    expect(doc1.alsoKnownAs).toEqual(doc2.alsoKnownAs);
  });

  test('alsoKnownAs is absent (not empty array) when signing key is null', () => {
    const doc = buildDIDDocument('acc_nid_test', null);
    expect(doc.alsoKnownAs).toBeUndefined();
  });

  test('alsoKnownAs is absent (not empty array) when signing key is revoked', () => {
    const revokedKey = makeSigningKey32({ status: 'revoked' });
    const doc = buildDIDDocument('acc_nid_test', revokedKey);
    expect(doc.alsoKnownAs).toBeUndefined();
  });

  test('alsoKnownAs is absent when root-key fallback is used (no per-agent key)', () => {
    const doc = buildDIDDocument('acc_nid_test', null, 'cm9vdC1wdWJsaWMta2V5LXg');
    expect(doc.alsoKnownAs).toBeUndefined();
  });
});

// ─── Integration Tests: GET /agents/:id/did.json ─────────────────────────────

describe('GET /agents/:id/did.json', () => {
  test('returns 400 for invalid agent ID format', async () => {
    const res = await fetch(`${BASE_URL}/agents/invalid-no-prefix/did.json`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_agent_id');
  });

  test('returns 400 for empty agent ID', async () => {
    // This would be /agents//did.json which won't match the route,
    // so it should 404 at the router level
    const res = await fetch(`${BASE_URL}/agents//did.json`);
    expect([400, 404]).toContain(res.status);
  });

  test('returns 400 for agent ID with special characters', async () => {
    const res = await fetch(`${BASE_URL}/agents/acc_test<script>/did.json`);
    expect(res.status).toBe(400);
  });

  test('returns 200 with valid DID Document for any acc_ prefixed ID', async () => {
    // Even if the account doesn't have a signing key, we return a minimal DID Doc
    const accountId = 'acc_did_test_' + Math.random().toString(36).slice(2, 8);
    const res = await fetch(`${BASE_URL}/agents/${accountId}/did.json`);
    expect(res.status).toBe(200);

    // Content-Type must be application/did+json per W3C spec
    expect(res.headers.get('content-type')).toBe('application/did+json');

    // Cache headers
    expect(res.headers.get('cache-control')).toContain('max-age=300');

    const doc = await res.json();

    // W3C DID Core required fields
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc.id).toBe(`did:web:agentlair.dev:agents:${accountId}`);
    expect(Array.isArray(doc.verificationMethod)).toBe(true);
    expect(Array.isArray(doc.authentication)).toBe(true);
    expect(Array.isArray(doc.assertionMethod)).toBe(true);
  });

  test('includes JWKS service endpoint in response', async () => {
    const accountId = 'acc_did_svc_test';
    const res = await fetch(`${BASE_URL}/agents/${accountId}/did.json`);
    expect(res.status).toBe(200);

    const doc = await res.json();
    expect(Array.isArray(doc.service)).toBe(true);
    expect(doc.service.length).toBeGreaterThanOrEqual(1);

    const jwksSvc = doc.service.find((s: any) => s.type === 'JsonWebKeySet2020');
    expect(jwksSvc).toBeDefined();
    expect(jwksSvc.serviceEndpoint).toBe(
      `https://agentlair.dev/agents/${accountId}/.well-known/jwks.json`,
    );
  });

  test('response is valid JSON-serialized DID Document', async () => {
    const res = await fetch(`${BASE_URL}/agents/acc_json_test/did.json`);
    expect(res.status).toBe(200);

    // Should be parseable JSON
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();

    // Pretty-printed (contains newlines)
    expect(text).toContain('\n');
  });

  test('rejects overly long account IDs', async () => {
    // acc_ + 33 chars (exceeds the 32-char limit after prefix)
    const longId = 'acc_' + 'a'.repeat(33);
    const res = await fetch(`${BASE_URL}/agents/${longId}/did.json`);
    expect(res.status).toBe(400);
  });
});
