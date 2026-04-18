/**
 * AgentLair DID Web Resolution — did.json endpoint
 *
 * GET /agents/:id/did.json
 *
 * Resolves did:web DID Documents per the W3C DID Web spec:
 * https://w3c-ccg.github.io/did-method-web/
 *
 * DID format:  did:web:agentlair.dev:agents:<account_id>
 * Resolves to: https://agentlair.dev/agents/<account_id>/did.json
 *
 * This enables MCP-I Level 2 compliance — verifiers can resolve an agent's
 * DID to obtain the public key for signature verification, without needing
 * to know AgentLair-specific API endpoints.
 *
 * Verification method type: JsonWebKey2020 (Ed25519 via OKP key)
 * Falls back to service reference if no per-agent signing key is registered.
 */

import { Hono } from 'hono';
import { err } from '../utils.js';
import type { HonoEnv, Env } from '../types.js';
import type { SigningKeyRecord } from './signing-keys.js';

const ISSUER_DOMAIN = 'agentlair.dev';
const ISSUER_BASE = `https://${ISSUER_DOMAIN}`;

// ─── DID Document builder ─────────────────────────────────────────────────────

interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[];
}

interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyJwk: PublicKeyJwk;
}

interface PublicKeyJwk {
  kty: string;
  crv: string;
  x: string;
  use: string;
  alg: string;
}

interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export function buildDIDDocument(accountId: string, signingKey: SigningKeyRecord | null): DIDDocument {
  const did = `did:web:${ISSUER_DOMAIN}:agents:${accountId}`;
  const keyId = `${did}#key-1`;
  const jwksUrl = `${ISSUER_BASE}/agents/${accountId}/.well-known/jwks.json`;

  const doc: DIDDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    id: did,
    verificationMethod: [],
    authentication: [],
    assertionMethod: [],
    service: [
      {
        id: `${did}#jwks`,
        type: 'JsonWebKeySet2020',
        serviceEndpoint: jwksUrl,
      },
    ],
  };

  if (signingKey && signingKey.status === 'active') {
    const vm: VerificationMethod = {
      id: keyId,
      type: 'JsonWebKey2020',
      controller: did,
      publicKeyJwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: signingKey.public_key,
        use: 'sig',
        alg: 'EdDSA',
      },
    };
    doc.verificationMethod.push(vm);
    doc.authentication.push(keyId);
    doc.assertionMethod.push(keyId);
  }

  return doc;
}

// ─── KV helpers ───────────────────────────────────────────────────────────────

export async function getSigningKeyForAccount(env: Env, accountId: string): Promise<SigningKeyRecord | null> {
  const indexRaw = await env.KEYS.get('signing-key-by-account:' + accountId);
  if (!indexRaw) return null;

  let keyid: string;
  try {
    ({ keyid } = JSON.parse(indexRaw) as { keyid: string });
  } catch {
    return null;
  }

  const keyRaw = await env.KEYS.get('signing-key:' + keyid);
  if (!keyRaw) return null;

  try {
    return JSON.parse(keyRaw) as SigningKeyRecord;
  } catch {
    return null;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const didRoutes = new Hono<HonoEnv>();

/**
 * GET /agents/:id/did.json
 *
 * Resolves DID Document for a given AgentLair account.
 * Public endpoint — no authentication required.
 *
 * The DID `did:web:agentlair.dev:agents:acc_xxx` resolves here per the
 * DID Web spec (colons after domain become path segments).
 *
 * Response: W3C DID Document (application/did+json)
 *
 * If the agent has a registered signing key, it is included as a
 * JsonWebKey2020 verification method. If not, only the service reference
 * to the JWKS endpoint is included.
 */
didRoutes.get('/:id/did.json', async (c) => {
  const accountId = c.req.param('id');

  // Validate account ID format: acc_ prefix + alphanumeric/dash/underscore
  if (!accountId || !/^acc_[A-Za-z0-9_-]{1,32}$/.test(accountId)) {
    return err('Invalid agent ID format. Expected acc_{id}.', 400, 'invalid_agent_id');
  }

  // Verify the account exists (check for any KV data keyed to this account)
  // We accept any account — even those without signing keys — and serve a
  // minimal DID Document. The account's existence is implied by the DID claim
  // in their AAT; we don't require a separate account lookup here.

  // Look up active signing key (optional — DID Document is valid without it)
  const signingKey = await getSigningKeyForAccount(c.env, accountId);

  const doc = buildDIDDocument(accountId, signingKey);

  return new Response(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      // application/did+json is the W3C-specified media type for DID Documents
      'Content-Type': 'application/did+json',
      // Cache for 5 minutes — short enough to detect key rotation promptly
      'Cache-Control': 'public, max-age=300',
    },
  });
});
