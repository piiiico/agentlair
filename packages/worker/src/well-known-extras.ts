// ─── Well-Known Extras — RSL + Agent Discovery ───────────────────────────────
// RSL (Really Simple Licensing) and agents.json for agent-economy conventions.
// Served at:
//   GET /.well-known/rsl.xml     — training/inference license terms
//   GET /.well-known/agents.json — agent discovery + x402 payment surface

// ── RSL (Really Simple Licensing) ────────────────────────────────────────────
// Spec: https://rslstandard.org/
// Terms: free with attribution for non-commercial + inference use.
//        Commercial training requires a license (contact api@agentlair.dev).
//        x402 payment receiver for automated licensing flows.
export const RSL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <!-- Public documentation, API reference, and blog content -->
  <content url="/">
    <!-- Inference / summarization / retrieval: free with CC-BY-4.0 attribution -->
    <license>
      <permits type="usage">all</permits>
      <payment type="attribution">
        <standard>https://creativecommons.org/licenses/by/4.0/</standard>
      </payment>
    </license>
  </content>
  <!-- Commercial AI training on AgentLair content requires a license -->
  <content url="/api">
    <license>
      <permits type="usage">ai-train</permits>
      <payment type="subscription">
        <custom>mailto:api@agentlair.dev</custom>
      </payment>
    </license>
  </content>
  <content url="/docs">
    <license>
      <permits type="usage">ai-train</permits>
      <payment type="subscription">
        <custom>mailto:api@agentlair.dev</custom>
      </payment>
    </license>
  </content>
</rsl>
`;

// ── agents.json — Agent Discovery ─────────────────────────────────────────────
// Custom convention (no formal spec — first-mover).
// Declares: AAT issuer DID, citation policy, x402 payment receiver,
//           behavioral-trust thresholds, and contact for agent inquiries.
// Aligned with AgentLair AAT positioning (did:web:agentlair.dev).
export const AGENTS_JSON = {
  schema_version: '0.1',
  domain: 'agentlair.dev',
  description: 'AgentLair — persistent identity infrastructure for AI agents',
  aat_issuer: {
    did: 'did:web:agentlair.dev',
    jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
    oidc_discovery: 'https://agentlair.dev/.well-known/openid-configuration',
    docs: 'https://agentlair.dev/api',
  },
  citation_policy: {
    required: true,
    format: 'attribution: AgentLair (https://agentlair.dev)',
    license: 'CC-BY-4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    commercial_training: 'requires-license — contact api@agentlair.dev',
  },
  x402: {
    protocol_version: 2,
    receiver: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
    network: 'base',
    asset: 'USDC',
    asset_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    facilitator: 'https://ultravioletadao.xyz',
    payment_endpoints: [
      {
        path: '/v1/email/send',
        amount_usdc: '0.01',
        description: 'Overage email send — 0.01 USDC when free tier exceeded',
      },
      {
        path: '/v1/register',
        amount_usdc: '0.01',
        description: 'Agent registration beyond free tier — 0.01 USDC',
      },
    ],
  },
  trust: {
    read_threshold: 0.0,
    write_threshold: 0.7,
    admin_threshold: 0.95,
    trust_engine_url: 'https://agentlair.dev/v1/trust',
    aat_required_for_write: true,
  },
  contact: {
    email: 'api@agentlair.dev',
    url: 'https://agentlair.dev',
    a2a_card: 'https://agentlair.dev/.well-known/agent.json',
    mcp_server: 'https://agentlair.dev/.well-known/mcp/server.json',
  },
  updated: '2026-05-02',
};
