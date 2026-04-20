/**
 * AgentLair Identity Provider — Core IdP Module
 *
 * RFC-001: AgentLair as MCP-I Identity Provider
 *
 * This module provides the IdP status endpoint and enhanced OIDC discovery
 * that positions AgentLair as a full MCP-I compliant Identity Provider.
 *
 * Existing infrastructure leveraged:
 * - /.well-known/openid-configuration (index.ts) — to be enhanced
 * - /.well-known/jwks.json (index.ts) — already complete
 * - POST /v1/tokens/issue (tokens.ts) — token issuance
 * - POST /v1/tokens/introspect (tokens.ts) — RFC 7662
 * - GET /agents/{id}/did.json (did.ts) — W3C DID resolution
 */

import { Hono } from 'hono';
import { json } from '../utils.js';
import type { HonoEnv } from '../types.js';

export const idpRoutes = new Hono<HonoEnv>();

// ─── Constants ────────────────────────────────────────────────────────────────

const ISSUER = 'https://agentlair.dev';
const IDP_VERSION = '0.1.0'; // RFC-001 Phase 1

/**
 * MCP-I conformance levels supported by this IdP.
 *
 * Level 1: JWT/OIDC identity — COMPLETE
 * Level 2: DID-anchored identity + delegation — PARTIAL (did:web done, VC pending)
 * Level 3: Lifecycle + audit trails — PARTIAL (audit done, lifecycle in progress)
 */
const MCPI_CONFORMANCE = {
  level_1: { status: 'complete', description: 'JWT/OIDC identity with EdDSA signing' },
  level_2: { status: 'partial', description: 'did:web in AAT + DID Document resolution; VC delegation pending' },
  level_3: { status: 'partial', description: 'Hash-chained audit trail; formal lifecycle states in progress' },
};

// ─── GET /v1/idp/status ────────────────────────────────────────────────────────
//
// Returns the IdP's current capabilities, conformance level, and health status.
// Public endpoint — no authentication required. Useful for relying parties
// to discover what this IdP supports before integrating.

idpRoutes.get('/status', async (c) => {
  const hasSigningKey = !!c.env.AUDIT_SIGNING_KEY;
  const hasAuditDb = !!c.env.AUDIT;

  return json({
    idp: {
      issuer: ISSUER,
      version: IDP_VERSION,
      protocol: 'MCP-I',
      signing_algorithm: 'EdDSA',
      key_type: 'Ed25519',
    },
    endpoints: {
      oidc_discovery: `${ISSUER}/.well-known/openid-configuration`,
      jwks: `${ISSUER}/.well-known/jwks.json`,
      token_issue: `${ISSUER}/v1/tokens/issue`,
      token_introspect: `${ISSUER}/v1/tokens/introspect`,
      token_revoke: `${ISSUER}/v1/tokens/revoke`,
      did_resolution: `${ISSUER}/agents/{id}/did.json`,
      trust_profile: `${ISSUER}/v1/trust/{agentId}`,
      trust_gate: `${ISSUER}/v1/trust/{agentId}/check`,
      agent_register: `${ISSUER}/v1/register`,
    },
    conformance: MCPI_CONFORMANCE,
    capabilities: {
      token_issuance: hasSigningKey,
      token_introspection: hasSigningKey,
      token_revocation: hasSigningKey,
      did_resolution: true,
      trust_scoring: hasAuditDb,
      trust_embedding: hasAuditDb && hasSigningKey,
      audit_trail: hasAuditDb,
      agent_email: true,
      credential_vault: true,
      http_message_signing: true, // RFC 9421
    },
    health: {
      signing_key: hasSigningKey ? 'configured' : 'missing',
      audit_database: hasAuditDb ? 'connected' : 'not_bound',
      status: hasSigningKey ? 'operational' : 'degraded',
    },
  });
});

// ─── Enhanced OIDC Discovery ────────────────────────────────────────────────────
//
// This builds the enhanced OpenID Connect Discovery document with MCP-I
// specific extensions. To be mounted at /.well-known/openid-configuration,
// replacing the existing minimal implementation in index.ts.

export function buildOIDCDiscovery(): Record<string, unknown> {
  return {
    // Standard OIDC Discovery (RFC 8414)
    issuer: ISSUER,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    token_endpoint: `${ISSUER}/v1/tokens/issue`,
    introspection_endpoint: `${ISSUER}/v1/tokens/introspect`,
    revocation_endpoint: `${ISSUER}/v1/tokens/revoke`,
    registration_endpoint: `${ISSUER}/v1/register`,
    token_endpoint_auth_methods_supported: ['none'],
    id_token_signing_alg_values_supported: ['EdDSA'],
    subject_types_supported: ['public'],
    response_types_supported: ['token'],
    grant_types_supported: ['agent_credentials'],

    // MCP-I extensions
    mcpi_conformance_levels: ['L1', 'L2_partial'],
    mcpi_did_methods_supported: ['did:web'],
    mcpi_did_resolution_endpoint: `${ISSUER}/agents/{id}/did.json`,

    // AgentLair L4 extensions
    trust_endpoint: `${ISSUER}/v1/trust/{agentId}`,
    trust_gate_endpoint: `${ISSUER}/v1/trust/{agentId}/check`,
    trust_levels_supported: ['intern', 'junior', 'senior', 'principal'],
    trust_dimensions: ['consistency', 'restraint', 'transparency'],

    // Agent-specific metadata
    agent_signing_keys_endpoint: `${ISSUER}/v1/agents/signing-keys`,
    agent_keys_directory: `${ISSUER}/.well-known/agent-keys/{keyid}`,

    // Service description
    service_documentation: 'https://agentlair.dev/docs',
    op_policy_uri: 'https://agentlair.dev/privacy',
    op_tos_uri: 'https://agentlair.dev/terms',
  };
}
