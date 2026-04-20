/**
 * AgentLair Identity Provider Module
 *
 * RFC-001: AgentLair as MCP-I Identity Provider
 *
 * Barrel export for all IdP components:
 * - idp.ts: Status endpoint + enhanced OIDC discovery
 * - revoke.ts: Token revocation registry
 * - trust-embed.ts: Trust score embedding in AAT claims
 */

export { idpRoutes, buildOIDCDiscovery } from './idp.js';
export { revokeRoutes, isTokenRevoked, revokeAllAccountTokens, getAccountRevocationTime } from './revoke.js';
export { getTrustAttestationForEmbed, validateTrustAttestation } from './trust-embed.js';
export type { TrustAttestation } from './trust-embed.js';
