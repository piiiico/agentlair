/**
 * @agentlair/mcp-trust-attestation
 *
 * Drop-in middleware that mounts AgentLair's BHC-S behavioral trust
 * descriptor and per-subject attestation endpoint on any HTTP-transport
 * MCP server in three lines of code. Implements the SEP-2133 unofficial
 * extension `dev.agentlair/trust-attestation` for the BHC-S spec
 * `urn:agentlair:bhc-s:v1`.
 *
 * @example Hono
 * ```ts
 * import { Hono } from 'hono';
 * import { createAttestationMiddleware } from '@agentlair/mcp-trust-attestation';
 *
 * const app = new Hono();
 * app.use('/.well-known/agentlair-trust', createAttestationMiddleware({ serverId: 'url_sha256:abc...' }));
 * app.use('/agentlair/trust-attestation/:subject', createAttestationMiddleware({ serverId: 'url_sha256:abc...' }));
 * ```
 *
 * @example node:http
 * ```ts
 * import http from 'node:http';
 * import { createNodeHttpHandler } from '@agentlair/mcp-trust-attestation';
 *
 * const handler = createNodeHttpHandler({ serverId: 'url_sha256:abc...' });
 * http.createServer(handler).listen(3000);
 * ```
 *
 * @see https://agentlair.dev/docs/bhc-s
 */

export {
  TRUST_ATTESTATION_EXTENSION,
  createAttestationMiddleware,
  buildDescriptor,
  buildServerCardExtension,
  verifyAttestation,
  createNodeHttpHandler,
  clearJwksCache,
  clearAttestationCache,
} from './middleware.js';

export type {
  TrustAttestationDescriptor,
  AttestationMiddlewareOptions,
  VerifyAttestationResult,
} from './types.js';
