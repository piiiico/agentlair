/**
 * Unit tests for the CIMD client metadata document.
 *
 * These run in-process (no network, no deployed worker) — the integration
 * check against the live URL is the deploy stage's smoke test.
 */

import { describe, test, expect } from 'bun:test';
import {
  CIMD_ISSUER,
  CIMD_REQUIRED_PROPERTIES,
  buildClientMetadata,
  clientIdUrlFor,
  jwksUrlFor,
  validateClientMetadata,
} from './cimd.js';

describe('buildClientMetadata', () => {
  test('includes every REQUIRED property from the spec', () => {
    const doc = buildClientMetadata('picoclaw', 'Pico');
    for (const prop of CIMD_REQUIRED_PROPERTIES) {
      expect(doc).toHaveProperty(prop);
    }
  });

  test('client_id matches the document URL exactly — agent-name form', () => {
    const doc = buildClientMetadata('picoclaw', 'Pico');
    expect(doc.client_id).toBe(
      'https://agentlair.dev/agents/picoclaw/client-metadata.json',
    );
    expect(doc.client_id).toBe(clientIdUrlFor('picoclaw'));
  });

  test('client_id matches the document URL exactly — acc_ form', () => {
    // Both addressing forms are served by the same route, so both must be
    // self-consistent: an AS fetching the acc_ URL must not receive a document
    // claiming the agent-name URL.
    const doc = buildClientMetadata('acc_abc123', 'Pico');
    expect(doc.client_id).toBe(
      'https://agentlair.dev/agents/acc_abc123/client-metadata.json',
    );
  });

  test('client_id uses https and contains a path component', () => {
    const u = new URL(buildClientMetadata('picoclaw').client_id);
    expect(u.protocol).toBe('https:');
    expect(u.pathname.length).toBeGreaterThan(1);
  });

  test('jwks_uri points at the agent JWKS route for the SAME identifier', () => {
    const doc = buildClientMetadata('acc_abc123');
    expect(doc.jwks_uri).toBe(
      'https://agentlair.dev/agents/acc_abc123/.well-known/jwks.json',
    );
    expect(doc.jwks_uri).toBe(jwksUrlFor('acc_abc123'));
    // The whole point of the endpoint: client auth key == AAT signing key.
    expect(doc.token_endpoint_auth_method).toBe('private_key_jwt');
    expect(doc.token_endpoint_auth_signing_alg).toBe('EdDSA');
  });

  test('falls back to the identifier when the account has no display name', () => {
    expect(buildClientMetadata('picoclaw').client_name).toBe('picoclaw');
    expect(buildClientMetadata('picoclaw', '   ').client_name).toBe('picoclaw');
    expect(buildClientMetadata('picoclaw', null).client_name).toBe('picoclaw');
  });

  test('redirect_uris is non-empty and loopback-only', () => {
    const doc = buildClientMetadata('picoclaw');
    expect(doc.redirect_uris.length).toBeGreaterThan(0);
    for (const uri of doc.redirect_uris) {
      const host = new URL(uri).hostname;
      expect(['127.0.0.1', 'localhost']).toContain(host);
    }
  });

  test('every built document passes the independent validator', () => {
    for (const id of ['picoclaw', 'acc_abc123', 'a']) {
      const doc = buildClientMetadata(id);
      const r = validateClientMetadata(doc, clientIdUrlFor(id));
      expect(r.violations).toEqual([]);
      expect(r.valid).toBe(true);
    }
  });
});

describe('validateClientMetadata — MUST-level rules', () => {
  const url = 'https://agentlair.dev/agents/picoclaw/client-metadata.json';
  const good = () => buildClientMetadata('picoclaw', 'Pico') as Record<string, unknown>;

  test('accepts a conformant document', () => {
    expect(validateClientMetadata(good(), url).valid).toBe(true);
  });

  test('rejects non-objects', () => {
    for (const bad of [null, 'a string', 42, ['array']]) {
      expect(validateClientMetadata(bad, url).valid).toBe(false);
    }
  });

  test('rejects a document missing each REQUIRED property in turn', () => {
    for (const prop of CIMD_REQUIRED_PROPERTIES) {
      const doc = good();
      delete doc[prop];
      const r = validateClientMetadata(doc, url);
      expect(r.valid).toBe(false);
      expect(r.violations.some((v) => v.includes(prop))).toBe(true);
    }
  });

  test('rejects client_id that does not match the fetch URL', () => {
    // The canonical CIMD attack: a document claiming someone else's identity.
    const doc = good();
    doc.client_id = 'https://evil.example/agents/picoclaw/client-metadata.json';
    const r = validateClientMetadata(doc, url);
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('match the document URL'))).toBe(true);
  });

  test('rejects a non-https client_id', () => {
    const doc = good();
    doc.client_id = 'http://agentlair.dev/agents/picoclaw/client-metadata.json';
    const r = validateClientMetadata(
      doc,
      'http://agentlair.dev/agents/picoclaw/client-metadata.json',
    );
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('https'))).toBe(true);
  });

  test('rejects a client_id with no path component', () => {
    const doc = good();
    doc.client_id = 'https://agentlair.dev/';
    const r = validateClientMetadata(doc, 'https://agentlair.dev/');
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('path component'))).toBe(true);
  });

  test('rejects empty or non-array redirect_uris', () => {
    for (const bad of [[], 'http://localhost/callback', [42]]) {
      const doc = good();
      doc.redirect_uris = bad as unknown;
      expect(validateClientMetadata(doc, url).valid).toBe(false);
    }
  });

  test('rejects private_key_jwt with no key source', () => {
    const doc = good();
    delete doc.jwks_uri;
    const r = validateClientMetadata(doc, url);
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('private_key_jwt'))).toBe(true);
  });

  test('accepts private_key_jwt backed by an inline jwks instead of jwks_uri', () => {
    const doc = good();
    delete doc.jwks_uri;
    doc.jwks = { keys: [] };
    expect(validateClientMetadata(doc, url).valid).toBe(true);
  });

  test('CIMD_ISSUER is the canonical https origin', () => {
    expect(CIMD_ISSUER).toBe('https://agentlair.dev');
    expect(new URL(CIMD_ISSUER).protocol).toBe('https:');
  });
});
