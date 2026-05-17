// ─── BHC-S Trust Discovery Descriptor ────────────────────────────────────────
//
// GET /.well-known/agentlair-trust
//
// Static service descriptor advertising AgentLair as a behavioral trust issuer
// for MCP and HTTP API servers. Modeled on RFC 8414 (OAuth Authorization Server
// Metadata): a public JSON metadata document that third-party MCP clients and
// the upcoming `dev.agentlair/trust-attestation` MCP Extension can discover
// without hardcoding our domain — the JWKS URI, signal taxonomy, and BHC-S
// token type are all advertised in a single document.
//
// Public — no auth required. The path is in the .well-known/* cluster which is
// already non-auth-gated per existing convention (jwks.json, agents.json, etc.).
//
// No D1, no env vars, no DO bindings — pure static content. The attestation
// issuance route (/v1/trust/server/{server_id}) is deferred to a separate
// pipeline that depends on the BHC-S scoring engine.
//
// Spec: /workspace/memory/knowledge/agentlair/agentlair-mcp-server-trust-spec.md
//       /workspace/agentlair/packages/worker/.pipeline/bhc-s-discovery-20260517-220500/spec.md

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';

export const TRUST_DESCRIPTOR = {
  issuer: 'https://agentlair.dev',
  jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
  attestation_endpoint_template: 'https://agentlair.dev/v1/trust/server/{server_id}',
  supported_signals: [
    'prompt_injection_indicators',
    'data_exfiltration_indicators',
    'tool_description_drift',
    'config_anomaly',
    'call_frequency_spike',
    'consent_violation_rate',
    'latency_anomaly',
    'origin_change',
  ],
  supported_subjects: ['mcp_server', 'http_api_server', 'shell_tool_server'],
  supported_subject_id_forms: ['url_sha256', 'agentlair_alias', 'did_key'],
  signal_algorithm_version: 'trust-engine-v2.5',
  max_token_ttl_seconds: 3600,
  bhc_token_type: 'urn:agentlair:bhc-s:v1',
  spec_version: '0.1.0',
  documentation_url: 'https://agentlair.dev/docs/bhc-s',
} as const;

export const wellKnownAgentlairTrustRoutes = new Hono<HonoEnv>();

wellKnownAgentlairTrustRoutes.get('/', () =>
  new Response(JSON.stringify(TRUST_DESCRIPTOR), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  }),
);
