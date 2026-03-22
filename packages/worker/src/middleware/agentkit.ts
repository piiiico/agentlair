// ─── AgentKit Verification Middleware ─────────────────────────────────────────
// Verifies World AgentKit proof-of-human headers on incoming requests.
// Human-verified agents get free-trial access (N free emails before x402).
//
// Flow:
//   1. Check for X-AGENTKIT header on request
//   2. Parse and validate the CAIP-122 signed message
//   3. Verify the signature (EIP-191/EIP-1271/Ed25519)
//   4. Look up the wallet in AgentBook → resolve to anonymous human ID
//   5. Return human ID + usage info for downstream route logic
//
// This middleware does NOT replace authenticateAny() — the caller still needs
// an AgentLair API key. AgentKit augments the payment flow: human-verified
// agents bypass x402 payment for their free-trial allocation.

import {
  parseAgentkitHeader,
  validateAgentkitMessage,
  verifyAgentkitSignature,
  createAgentBookVerifier,
  type AgentkitPayload,
} from '@worldcoin/agentkit';

import type { Env } from '../types.js';
import { KVAgentKitStorage } from '../agentkit-storage.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Number of free emails per human before x402 payment is required */
export const AGENTKIT_FREE_TRIAL_USES = 3;

/** Header name for AgentKit proof */
export const AGENTKIT_HEADER = 'X-AGENTKIT';

/** The resource URI for AgentKit validation */
const AGENTKIT_RESOURCE_URI = 'https://agentlair.dev';

// ─── Result types ────────────────────────────────────────────────────────────

export interface AgentkitVerification {
  /** Whether the agent is human-verified via AgentKit */
  verified: true;
  /** The anonymous human identifier from AgentBook */
  humanId: string;
  /** The agent's wallet address */
  address: string;
  /** How many free uses this human has consumed on this endpoint */
  usageCount: number;
  /** Whether the agent still has free-trial uses remaining */
  hasFreeUses: boolean;
}

export interface AgentkitNotPresent {
  verified: false;
  reason: 'no_header';
}

export interface AgentkitFailed {
  verified: false;
  reason: 'parse_error' | 'validation_failed' | 'signature_invalid' | 'not_registered' | 'nonce_replay';
  error?: string;
}

export type AgentkitResult = AgentkitVerification | AgentkitNotPresent | AgentkitFailed;

// ─── Verification function ──────────────────────────────────────────────────

/**
 * Verify an incoming request's AgentKit proof-of-human header.
 *
 * @param request - The incoming HTTP request
 * @param env - Cloudflare Worker environment bindings
 * @param endpoint - The endpoint identifier for usage tracking (e.g. "/v1/email/send")
 * @returns AgentkitResult with verification status and human ID if valid
 */
export async function verifyAgentKit(
  request: Request,
  env: Env,
  endpoint: string,
): Promise<AgentkitResult> {
  const headerValue = request.headers.get(AGENTKIT_HEADER);
  if (!headerValue) {
    return { verified: false, reason: 'no_header' };
  }

  // 1. Parse the header into a structured payload
  let payload: AgentkitPayload;
  try {
    payload = parseAgentkitHeader(headerValue);
  } catch (e: unknown) {
    return { verified: false, reason: 'parse_error', error: e instanceof Error ? e.message : String(e) };
  }

  // 2. Initialize storage for nonce tracking
  const storage = new KVAgentKitStorage(env.KEYS);

  // 3. Validate the message (domain, URI, timestamps, nonce replay)
  const validation = await validateAgentkitMessage(payload, AGENTKIT_RESOURCE_URI, {
    maxAge: 300, // 5 minutes
    checkNonce: async (nonce: string) => {
      const used = await storage.hasUsedNonce(nonce);
      return !used; // returns true if nonce is valid (not used)
    },
  });

  if (!validation.valid) {
    // Distinguish nonce replay from other validation failures
    const isNonceReplay = validation.error?.toLowerCase().includes('nonce');
    return {
      verified: false,
      reason: isNonceReplay ? 'nonce_replay' : 'validation_failed',
      error: validation.error,
    };
  }

  // 4. Verify the cryptographic signature
  const sigResult = await verifyAgentkitSignature(payload);
  if (!sigResult.valid) {
    return { verified: false, reason: 'signature_invalid', error: sigResult.error };
  }

  // 5. Look up the wallet in AgentBook to resolve human ID
  const agentBook = createAgentBookVerifier({ network: 'base' });
  const humanId = await agentBook.lookupHuman(payload.address, payload.chainId);

  if (!humanId) {
    return { verified: false, reason: 'not_registered' };
  }

  // 6. Record the nonce to prevent replay
  await storage.recordNonce(payload.nonce);

  // 7. Check usage count for free-trial
  const usageCount = await storage.getUsageCount(endpoint, humanId);
  const hasFreeUses = usageCount < AGENTKIT_FREE_TRIAL_USES;

  return {
    verified: true,
    humanId,
    address: payload.address,
    usageCount,
    hasFreeUses,
  };
}

/**
 * Record that a human-verified agent used a free-trial allocation.
 * Call this AFTER the request succeeds (email sent, etc.) — not before.
 */
export async function recordAgentkitUsage(
  env: Env,
  endpoint: string,
  humanId: string,
): Promise<void> {
  const storage = new KVAgentKitStorage(env.KEYS);
  await storage.incrementUsage(endpoint, humanId);
}
