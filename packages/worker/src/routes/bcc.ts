/**
 * BCC Routes — Bonded Credibility Certificate issuance and retrieval.
 *
 * Two routers exported:
 *
 *   bccPublicRoutes (public)
 *     GET /v1/bcc/:id  → 200 signed BCC VC, 404 not found, 410 revoked
 *     Mounted BEFORE the global /v1/* auth middleware in index.ts.
 *
 *   bccRoutes (auth-gated)
 *     POST /v1/bcc/issue → 201 signed BCC VC
 *     Mounted AFTER the global /v1/* auth middleware in index.ts.
 *
 * Signing: simplified v1 approximation of eddsa-jcs-2022 (DataIntegrityProof).
 * Uses canonicalJSON() from popa-cose.js (sorted-key JSON serialization —
 * NOT strict RFC 8785 JCS, sufficient for v1 single-issuer verification).
 * Base58btc encoding is inline (no external lib required in CF Workers).
 */

import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { HonoEnv } from '../types.js';
import { json, err, nanoid } from '../utils.js';
import { canonicalJSON } from '../lib/popa-cose.js';

// ─── Stake-medium → BCC profile mapping ──────────────────────────────────────

const STAKE_MEDIUM_TO_PROFILE: Record<string, string> = {
  capital:   'BCC-Capital',
  claims:    'BCC-Claims',
  existence: 'BCC-Existence',
};

const VALID_STAKE_MEDIUMS = Object.keys(STAKE_MEDIUM_TO_PROFILE);

// ─── Base58btc encoder (inline — no external dep) ─────────────────────────────
// Standard Bitcoin Base58 alphabet as defined in the Multibase spec.

function base58btcEncode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j]!) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map(d => ALPHABET[d]!).join('');
}

// ─── Public retrieval router ──────────────────────────────────────────────────

export const bccPublicRoutes = new Hono<HonoEnv>();

bccPublicRoutes.get('/:id', async (c) => {
  if (!c.env.AUDIT) return err('BCC store not configured.', 503, 'audit_unavailable');

  const id = c.req.param('id');
  if (!id || !id.startsWith('bcc_')) {
    return err('Invalid BCC credential id.', 400, 'invalid_id');
  }

  const row = await c.env.AUDIT
    .prepare('SELECT credential_json, revoked_at FROM bcc_credentials WHERE id = ?')
    .bind(id)
    .first<{ credential_json: string; revoked_at: string | null }>();

  if (!row) return err('BCC credential not found.', 404, 'not_found');
  if (row.revoked_at) return err('BCC credential has been revoked.', 410, 'revoked');

  const credential = JSON.parse(row.credential_json);
  return json(credential);
});

// ─── Auth-gated issuance router ───────────────────────────────────────────────

export const bccRoutes = new Hono<HonoEnv>();

bccRoutes.post('/issue', async (c) => {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const account = c.get('account');
  if (!account || !account.id) {
    return err('Authentication required.', 401, 'unauthorized');
  }

  // ── Infrastructure check ────────────────────────────────────────────────────
  if (!c.env.AUDIT || !c.env.AUDIT_SIGNING_KEY) {
    return err('BCC issuance not configured.', 503, 'audit_unavailable');
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return err('Request body must be valid JSON.', 400, 'invalid_json');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return err('Request body must be a JSON object.', 400, 'invalid_body');
  }

  const {
    subject_did,
    claim,
    stake_medium,
    confidence,
  } = body as Record<string, unknown>;

  // ── Validate inputs ─────────────────────────────────────────────────────────
  if (typeof subject_did !== 'string' || !subject_did.startsWith('did:')) {
    return err('subject_did must be a string starting with "did:".', 400, 'invalid_subject_did');
  }

  if (claim === undefined) {
    return err('claim is required.', 400, 'missing_claim');
  }

  if (typeof stake_medium !== 'string' || !VALID_STAKE_MEDIUMS.includes(stake_medium)) {
    return err(
      `stake_medium must be one of: ${VALID_STAKE_MEDIUMS.join(', ')}.`,
      400,
      'invalid_stake_medium',
    );
  }

  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return err('confidence must be a number between 0 and 1.', 400, 'invalid_confidence');
  }

  // ── Build credential ────────────────────────────────────────────────────────
  const credentialId = 'bcc_' + nanoid(20);
  const issuerDid = `did:web:agentlair.dev:agents:${account.id}`;
  const now = new Date().toISOString();
  const bccProfile = STAKE_MEDIUM_TO_PROFILE[stake_medium]!;

  const credentialWithoutProof = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://agentlair.dev/contexts/bcc/v1.jsonld',
    ],
    type: ['VerifiableCredential', 'BondedCredibilityCredential'],
    id: `https://agentlair.dev/v1/bcc/${credentialId}`,
    issuer: { id: issuerDid },
    validFrom: now,
    validUntil: null,
    credentialSubject: {
      id: subject_did,
      bcc_profile: bccProfile,
      stake_medium,
      stake_amount: null,
      stake_unit: null,
      commitment_window_start: now,
      commitment_window_end: null,
      slashing_oracle_uri: null,
      evidence_anchor: `self:${credentialId}`,
      claim,
      confidence,
    },
  };

  // ── Sign (simplified v1 approximation of eddsa-jcs-2022) ───────────────────
  // Proof options (without proofValue) are included in the signed document per
  // the DataIntegrityProof spec. We canonicalize the full credential+proofOptions
  // object (minus proofValue) before signing.

  const proofOptions = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    verificationMethod: `${issuerDid}#key-1`,
    proofPurpose: 'assertionMethod',
    created: now,
  };

  // Serialize the document to be signed: credential + proof options (no proofValue)
  const docToSign = { ...credentialWithoutProof, proof: proofOptions };
  const canonicalized = canonicalJSON(docToSign);
  const messageBytes = new TextEncoder().encode(canonicalized);

  // Decode the signing key (base64 → 32-byte Ed25519 private key seed)
  const privKeyBytes = Uint8Array.from(atob(c.env.AUDIT_SIGNING_KEY), ch => ch.charCodeAt(0));

  const signature = ed25519.sign(messageBytes, privKeyBytes);

  // Multibase base58btc encoding: prefix 'z' per Multibase spec
  const proofValue = 'z' + base58btcEncode(signature);

  const credential = {
    ...credentialWithoutProof,
    proof: {
      ...proofOptions,
      proofValue,
    },
  };

  // ── Store in D1 ─────────────────────────────────────────────────────────────
  try {
    await c.env.AUDIT
      .prepare(
        `INSERT INTO bcc_credentials
           (id, issuer_account_id, subject_did, bcc_profile, stake_medium, confidence, claim_json, credential_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        credentialId,
        account.id,
        subject_did,
        bccProfile,
        stake_medium,
        confidence,
        JSON.stringify(claim),
        JSON.stringify(credential),
      )
      .run();
  } catch (e) {
    return err(
      'Failed to store BCC credential: ' + (e instanceof Error ? e.message : 'unknown error'),
      500,
      'store_failed',
    );
  }

  return json(credential, 201);
});
