/**
 * @agentlair/verify
 *
 * Lightweight AAT (Agent Authentication Token) verification.
 * Fetches JWKS from agentlair.dev, caches keys, and validates
 * EdDSA JWTs with a single function call.
 *
 * @example Zero-config verification
 * ```typescript
 * import { verifyAAT } from '@agentlair/verify';
 *
 * const result = await verifyAAT(token);
 * if (result.valid) {
 *   console.log('Agent:', result.agentId);
 *   console.log('Scopes:', result.scopes);
 * } else {
 *   console.error('Rejected:', result.error);
 * }
 * ```
 *
 * @example With options
 * ```typescript
 * const result = await verifyAAT(token, {
 *   audience: 'https://my-api.example.com',
 *   maxAge: '1h',
 *   cacheTtl: 300_000,
 * });
 * ```
 *
 * @example Express middleware
 * ```typescript
 * import { createExpressMiddleware } from '@agentlair/verify';
 * app.use('/api', createExpressMiddleware({ audience: 'https://my-api.example.com' }));
 * ```
 *
 * @see https://agentlair.dev/docs/verify
 */

export { verifyAAT } from './verify.js';
export { clearJWKSCache } from './jwks.js';
export { createExpressMiddleware, createHonoMiddleware, createFastifyHook } from './middleware.js';
export { reportEvent, reportBatch, createEventBuffer } from './events.js';
export { verifyFinding } from './verify-finding.js';
export { verifyFindingPermalink } from './verify-finding.js';
export { classifyTrustTier } from './verify-finding.js';

export type {
  AATClaims,
  VerifyOptions,
  VerifyResult,
  MiddlewareOptions,
} from './types.js';

export type {
  BehavioralEvent,
  EventCategory,
  EventResult,
  EventSubmission,
  EventSubmissionResponse,
  EventError,
  ReportOptions,
  BufferOptions,
  EventBuffer,
} from './types.js';

export type {
  VerifyFindingResult,
  VerifyFindingOptions,
  VerifyFindingErrorReason,
  FindingClaims,
  FindingSeverity,
  TrackRecord,
  TrustTier,
} from './types.js';
