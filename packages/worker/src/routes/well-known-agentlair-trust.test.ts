// ─── BHC-S Trust Discovery Descriptor — Unit tests ──────────────────────────
//
// Exercises GET /.well-known/agentlair-trust. Pure static descriptor — no
// env, no D1, no DO bindings — so the fixture is just a Hono app with the
// sub-router mounted at the same path the worker mounts it.

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { wellKnownAgentlairTrustRoutes, TRUST_DESCRIPTOR } from './well-known-agentlair-trust.js';

const PATH = '/.well-known/agentlair-trust';

function buildApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route(PATH, wellKnownAgentlairTrustRoutes);
  return app;
}

describe('GET /.well-known/agentlair-trust', () => {
  test('returns HTTP 200', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    expect(res.status).toBe(200);
  });

  test('Content-Type header is application/json', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  test('Cache-Control header is public, max-age=300', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  test('response body is valid JSON', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test('body contains the 11 documented keys', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as Record<string, unknown>;
    const expectedKeys = [
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
    for (const k of expectedKeys) {
      expect(body).toHaveProperty(k);
    }
  });

  test('issuer is https://agentlair.dev', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { issuer: string };
    expect(body.issuer).toBe('https://agentlair.dev');
  });

  test('supported_signals is an array of length 8 with the exact members', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { supported_signals: string[] };
    expect(Array.isArray(body.supported_signals)).toBe(true);
    expect(body.supported_signals).toHaveLength(8);
    expect(body.supported_signals).toEqual([
      'prompt_injection_indicators',
      'data_exfiltration_indicators',
      'tool_description_drift',
      'config_anomaly',
      'call_frequency_spike',
      'consent_violation_rate',
      'latency_anomaly',
      'origin_change',
    ]);
  });

  test('supported_subjects includes mcp_server, http_api_server, shell_tool_server', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { supported_subjects: string[] };
    expect(body.supported_subjects).toContain('mcp_server');
    expect(body.supported_subjects).toContain('http_api_server');
    expect(body.supported_subjects).toContain('shell_tool_server');
  });

  test('attestation_endpoint_template contains the {server_id} placeholder', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { attestation_endpoint_template: string };
    expect(body.attestation_endpoint_template).toContain('{server_id}');
  });

  test('max_token_ttl_seconds is the number 3600 (not a string)', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { max_token_ttl_seconds: unknown };
    expect(typeof body.max_token_ttl_seconds).toBe('number');
    expect(body.max_token_ttl_seconds).toBe(3600);
  });

  test('bhc_token_type is the literal urn:agentlair:bhc-s:v1', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { bhc_token_type: string };
    expect(body.bhc_token_type).toBe('urn:agentlair:bhc-s:v1');
  });

  test('signal_algorithm_version is trust-engine-v2.5', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { signal_algorithm_version: string };
    expect(body.signal_algorithm_version).toBe('trust-engine-v2.5');
  });

  test('spec_version is 0.1.0', async () => {
    const app = buildApp();
    const res = await app.request(PATH);
    const body = await res.json() as { spec_version: string };
    expect(body.spec_version).toBe('0.1.0');
  });

  test('HEAD returns 200 with the same headers and an empty body', async () => {
    const app = buildApp();
    const res = await app.request(PATH, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    const body = await res.text();
    expect(body).toBe('');
  });

  test('POST returns 404 or 405 (unsupported method on a GET-only route)', async () => {
    const app = buildApp();
    const res = await app.request(PATH, { method: 'POST' });
    expect([404, 405]).toContain(res.status);
  });

  test('exported TRUST_DESCRIPTOR has the 11 documented keys', () => {
    // Sanity check: the exported constant matches the spec shape so consumers
    // who import it directly (e.g. for type-level reuse) don't see drift.
    expect(Object.keys(TRUST_DESCRIPTOR).sort()).toEqual([
      'attestation_endpoint_template',
      'bhc_token_type',
      'documentation_url',
      'issuer',
      'jwks_uri',
      'max_token_ttl_seconds',
      'signal_algorithm_version',
      'spec_version',
      'supported_signals',
      'supported_subject_id_forms',
      'supported_subjects',
    ]);
  });
});
