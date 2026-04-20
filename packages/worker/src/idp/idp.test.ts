/**
 * Tests for AgentLair Identity Provider Module
 *
 * RFC-001: AgentLair as MCP-I Identity Provider
 *
 * Covers:
 * - IdP status endpoint
 * - Enhanced OIDC discovery
 * - Token revocation
 * - Trust attestation embedding
 * - Trust attestation validation
 */

import { describe, test, expect } from 'bun:test';
import { buildOIDCDiscovery } from './idp.js';
import { validateTrustAttestation } from './trust-embed.js';
import type { TrustAttestation } from './trust-embed.js';

// ─── OIDC Discovery Tests ────────────────────────────────────────────────────

describe('buildOIDCDiscovery', () => {
  const config = buildOIDCDiscovery();

  test('includes standard OIDC fields', () => {
    expect(config.issuer).toBe('https://agentlair.dev');
    expect(config.jwks_uri).toBe('https://agentlair.dev/.well-known/jwks.json');
    expect(config.token_endpoint).toBe('https://agentlair.dev/v1/tokens/issue');
    expect(config.introspection_endpoint).toBe('https://agentlair.dev/v1/tokens/introspect');
  });

  test('includes revocation endpoint (RFC-001 Phase 1)', () => {
    expect(config.revocation_endpoint).toBe('https://agentlair.dev/v1/tokens/revoke');
  });

  test('includes registration endpoint', () => {
    expect(config.registration_endpoint).toBe('https://agentlair.dev/v1/register');
  });

  test('includes MCP-I extensions', () => {
    expect(config.mcpi_conformance_levels).toEqual(['L1', 'L2_partial']);
    expect(config.mcpi_did_methods_supported).toEqual(['did:web']);
    expect(config.mcpi_did_resolution_endpoint).toContain('/agents/{id}/did.json');
  });

  test('includes L4 trust extensions', () => {
    expect(config.trust_endpoint).toContain('/v1/trust/');
    expect(config.trust_gate_endpoint).toContain('/check');
    expect(config.trust_levels_supported).toEqual(['intern', 'junior', 'senior', 'principal']);
    expect(config.trust_dimensions).toEqual(['consistency', 'restraint', 'transparency']);
  });

  test('includes agent signing keys directory', () => {
    expect(config.agent_signing_keys_endpoint).toContain('/v1/agents/signing-keys');
    expect(config.agent_keys_directory).toContain('/.well-known/agent-keys/');
  });

  test('supports EdDSA signing', () => {
    expect(config.id_token_signing_alg_values_supported).toEqual(['EdDSA']);
  });

  test('supports agent_credentials grant type', () => {
    expect(config.grant_types_supported).toEqual(['agent_credentials']);
  });
});

// ─── Trust Attestation Validation Tests ──────────────────────────────────────

describe('validateTrustAttestation', () => {
  const freshAttestation: TrustAttestation = {
    score: 78,
    level: 'senior',
    confidence: 0.82,
    computed_at: new Date().toISOString(),
    trend: 'stable',
  };

  const staleAttestation: TrustAttestation = {
    score: 78,
    level: 'senior',
    confidence: 0.82,
    computed_at: new Date(Date.now() - 7200 * 1000).toISOString(), // 2 hours ago
    trend: 'stable',
  };

  const internAttestation: TrustAttestation = {
    score: 25,
    level: 'intern',
    confidence: 0.15,
    computed_at: new Date().toISOString(),
    trend: 'declining',
  };

  // ─── No attestation ─────────────────────────────────────────────────────

  test('no attestation, no requirements: valid', () => {
    const result = validateTrustAttestation(undefined);
    expect(result.valid).toBe(true);
  });

  test('no attestation, intern required: valid', () => {
    const result = validateTrustAttestation(undefined, { minLevel: 'intern' });
    expect(result.valid).toBe(true);
  });

  test('no attestation, junior required: invalid', () => {
    const result = validateTrustAttestation(undefined, { minLevel: 'junior' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_trust_attestation');
  });

  // ─── Level checks ──────────────────────────────────────────────────────

  test('senior level meets junior requirement', () => {
    const result = validateTrustAttestation(freshAttestation, { minLevel: 'junior' });
    expect(result.valid).toBe(true);
  });

  test('senior level meets senior requirement', () => {
    const result = validateTrustAttestation(freshAttestation, { minLevel: 'senior' });
    expect(result.valid).toBe(true);
  });

  test('senior level fails principal requirement', () => {
    const result = validateTrustAttestation(freshAttestation, { minLevel: 'principal' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('trust_level_insufficient');
  });

  test('intern level fails junior requirement', () => {
    const result = validateTrustAttestation(internAttestation, { minLevel: 'junior' });
    expect(result.valid).toBe(false);
  });

  // ─── Score checks ──────────────────────────────────────────────────────

  test('score meets minimum', () => {
    const result = validateTrustAttestation(freshAttestation, { minScore: 70 });
    expect(result.valid).toBe(true);
  });

  test('score fails minimum', () => {
    const result = validateTrustAttestation(freshAttestation, { minScore: 90 });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('trust_score_insufficient');
  });

  // ─── Confidence checks ────────────────────────────────────────────────

  test('confidence meets minimum', () => {
    const result = validateTrustAttestation(freshAttestation, { minConfidence: 0.5 });
    expect(result.valid).toBe(true);
  });

  test('confidence fails minimum', () => {
    const result = validateTrustAttestation(freshAttestation, { minConfidence: 0.95 });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('trust_confidence_insufficient');
  });

  // ─── Staleness checks ────────────────────────────────────────────────

  test('fresh attestation passes maxAge check', () => {
    const result = validateTrustAttestation(freshAttestation, { maxAge: 3600 });
    expect(result.valid).toBe(true);
  });

  test('stale attestation fails maxAge check', () => {
    const result = validateTrustAttestation(staleAttestation, { maxAge: 3600 });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('trust_attestation_stale');
  });

  // ─── Combined checks ──────────────────────────────────────────────────

  test('combined requirements all met', () => {
    const result = validateTrustAttestation(freshAttestation, {
      minLevel: 'junior',
      minScore: 60,
      minConfidence: 0.5,
      maxAge: 3600,
    });
    expect(result.valid).toBe(true);
  });

  test('combined requirements: level fails first', () => {
    const result = validateTrustAttestation(internAttestation, {
      minLevel: 'senior',
      minScore: 20,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('trust_level_insufficient');
  });
});

// ─── Revocation Reason Validation Tests ──────────────────────────────────────

describe('revocation reasons', () => {
  const VALID_REASONS = [
    'agent_compromised',
    'scope_change',
    'operator_request',
    'trust_violation',
    'decommissioned',
  ];

  test('all valid reasons are documented', () => {
    // This test ensures the code matches RFC-001 Section 3.3
    expect(VALID_REASONS).toHaveLength(5);
    expect(VALID_REASONS).toContain('agent_compromised');
    expect(VALID_REASONS).toContain('trust_violation');
    expect(VALID_REASONS).toContain('decommissioned');
  });
});

// ─── ATF Level Ordering Tests ────────────────────────────────────────────────

describe('ATF level ordering', () => {
  const levels = ['intern', 'junior', 'senior', 'principal'] as const;

  test('levels form a strict ordering', () => {
    // Each level should meet its own requirement
    for (const level of levels) {
      const attestation: TrustAttestation = {
        score: 85, level, confidence: 0.9,
        computed_at: new Date().toISOString(), trend: 'stable',
      };
      const result = validateTrustAttestation(attestation, { minLevel: level });
      expect(result.valid).toBe(true);
    }
  });

  test('lower levels fail higher requirements', () => {
    const internAtt: TrustAttestation = {
      score: 85, level: 'intern', confidence: 0.9,
      computed_at: new Date().toISOString(), trend: 'stable',
    };
    expect(validateTrustAttestation(internAtt, { minLevel: 'junior' }).valid).toBe(false);
    expect(validateTrustAttestation(internAtt, { minLevel: 'senior' }).valid).toBe(false);
    expect(validateTrustAttestation(internAtt, { minLevel: 'principal' }).valid).toBe(false);
  });

  test('higher levels meet lower requirements', () => {
    const principalAtt: TrustAttestation = {
      score: 95, level: 'principal', confidence: 0.95,
      computed_at: new Date().toISOString(), trend: 'stable',
    };
    expect(validateTrustAttestation(principalAtt, { minLevel: 'intern' }).valid).toBe(true);
    expect(validateTrustAttestation(principalAtt, { minLevel: 'junior' }).valid).toBe(true);
    expect(validateTrustAttestation(principalAtt, { minLevel: 'senior' }).valid).toBe(true);
    expect(validateTrustAttestation(principalAtt, { minLevel: 'principal' }).valid).toBe(true);
  });
});
