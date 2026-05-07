/**
 * BCC Routes — Bonded Credibility Certificate issuance and retrieval.
 *
 * Two routers exported:
 *
 *   bccPublicRoutes (public)
 *     GET /v1/bcc/:id/verify → structured verification response per bcc-schema-v1.md Verifier API
 *     GET /v1/bcc/:id        → 200 signed BCC VC, 404 not found, 410 revoked
 *     Mounted BEFORE the global /v1/* auth middleware in index.ts.
 *
 *   bccRoutes (auth-gated)
 *     POST /v1/bcc/issue → 201 signed BCC VC
 *     Mounted AFTER the global /v1/* auth middleware in index.ts.
 *
 * Signing: eddsa-jcs-2022 (DataIntegrityProof) per W3C Data Integrity spec.
 * Uses canonicalJSON() from popa-cose.js (sorted-key JSON serialization) as
 * the canonicalization step. Two-hash construction:
 *   sign(sha256(canonical(proofOptions)) || sha256(canonical(document)))
 * Base58btc encoding is inline (no external lib required in CF Workers).
 */

import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { HonoEnv } from '../types.js';
import { json, err, nanoid } from '../utils.js';
import { canonicalJSON } from '../lib/popa-cose.js';
import { parseStyle, svgResponse, renderBadgeSVG, renderErrorBadge } from './badge.js';

// ─── Stake-medium → BCC profile mapping ──────────────────────────────────────

const STAKE_MEDIUM_TO_PROFILE: Record<string, string> = {
  capital:   'BCC-Capital',
  claims:    'BCC-Claims',
  existence: 'BCC-Existence',
};

const VALID_STAKE_MEDIUMS = Object.keys(STAKE_MEDIUM_TO_PROFILE);

// ─── Base58btc encoder (inline — no external dep) ─────────────────────────────
// Standard Bitcoin Base58 alphabet as defined in the Multibase spec.

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(bytes: Uint8Array): string {
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
  return '1'.repeat(zeros) + digits.reverse().map(d => BASE58_ALPHABET[d]!).join('');
}

function base58btcDecode(s: string): Uint8Array {
  const ALPHABET_MAP: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) ALPHABET_MAP[BASE58_ALPHABET[i]!] = i;

  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;

  const bytes = new Uint8Array(s.length);
  let length = 0;

  for (let i = zeros; i < s.length; i++) {
    const c = s[i]!;
    if (!(c in ALPHABET_MAP)) throw new Error(`Invalid base58 character: ${c}`);
    let carry = ALPHABET_MAP[c]!;
    let j = 0;
    for (j = 0; j < length || carry > 0; j++) {
      carry += 58 * (bytes[j] ?? 0);
      bytes[j] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = j;
  }

  const result = new Uint8Array(zeros + length);
  for (let i = 0; i < length; i++) {
    result[zeros + i] = bytes[length - 1 - i]!;
  }
  return result;
}

// ─── SHA-256 helper (async, uses WebCrypto) ───────────────────────────────────

async function sha256bytes(text: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(buf);
}

// ─── eddsa-jcs-2022 two-hash signing input construction ──────────────────────
// Per W3C Data Integrity EdDSA Cryptosuites spec (eddsa-jcs-2022):
//   hashData = sha256(canonical(proofOptions)) || sha256(canonical(document))
// where proofOptions = proof block without proofValue,
// and document = credential without proof block.

async function buildHashData(
  credentialWithoutProof: Record<string, unknown>,
  proofOptions: Record<string, unknown>,
): Promise<Uint8Array> {
  const proofHashBytes = await sha256bytes(canonicalJSON(proofOptions));
  const docHashBytes   = await sha256bytes(canonicalJSON(credentialWithoutProof));
  const hashData = new Uint8Array(64);
  hashData.set(proofHashBytes, 0);
  hashData.set(docHashBytes, 32);
  return hashData;
}

// ─── oracle_state helper ──────────────────────────────────────────────────────

function inferOracleState(profile: string, validUntil: string | null): string {
  if (profile === 'BCC-Existence') return 'self_revealing';
  if (profile === 'BCC-Capital' && validUntil) {
    if (new Date(validUntil) < new Date()) return 'expired';
  }
  return 'active';
}

// ─── evidence_chain helper ────────────────────────────────────────────────────

function buildEvidenceChain(anchor: string, timestamp: string): Array<{ type: string; ref: string; timestamp: string }> {
  let type: string;
  if (anchor.startsWith('scitt:')) {
    type = 'scitt_entry';
  } else if (anchor.startsWith('0x')) {
    type = 'onchain_tx';
  } else {
    type = 'self_anchor';
  }
  return [{ type, ref: anchor, timestamp }];
}

// ─── BCC verification status helper ──────────────────────────────────────────

type BccVerifyStatus = 'verified' | 'expired' | 'revoked' | 'unknown' | 'unavailable';

const BCC_ID_RE = /^bcc_[A-Za-z0-9_-]{1,64}$/;

async function computeBccVerifyStatus(
  env: HonoEnv['Bindings'],
  id: string,
): Promise<BccVerifyStatus> {
  if (!env.AUDIT || !env.AUDIT_SIGNING_KEY) return 'unavailable';

  const row = await env.AUDIT
    .prepare('SELECT credential_json, revoked_at FROM bcc_credentials WHERE id = ?')
    .bind(id)
    .first<{ credential_json: string; revoked_at: string | null }>();

  if (!row) return 'unknown';
  if (row.revoked_at) return 'revoked';

  const credential = JSON.parse(row.credential_json) as Record<string, unknown>;
  const proof = credential.proof as Record<string, unknown> | undefined;

  if (!proof?.proofValue) return 'revoked';

  try {
    const { proofValue, ...proofOptions } = proof;
    const { proof: _proof, ...credentialWithoutProof } = credential;

    const privKeyBytes = Uint8Array.from(atob(env.AUDIT_SIGNING_KEY), ch => ch.charCodeAt(0));
    const pubKeyBytes = ed25519.getPublicKey(privKeyBytes);

    const hashData = await buildHashData(
      credentialWithoutProof as Record<string, unknown>,
      proofOptions as Record<string, unknown>,
    );

    const proofValueStr = proofValue as string;
    if (!proofValueStr.startsWith('z')) return 'revoked';
    const sigBytes = base58btcDecode(proofValueStr.slice(1));

    const valid = ed25519.verify(sigBytes, hashData, pubKeyBytes);
    if (!valid) return 'revoked';
  } catch {
    return 'revoked';
  }

  // Signature is valid — check window expiry
  const cs = credential.credentialSubject as Record<string, unknown>;
  const windowEnd = cs.commitment_window_end as string | null;
  if (windowEnd && new Date(windowEnd).getTime() < Date.now()) return 'expired';

  return 'verified';
}

// ─── Public retrieval router ──────────────────────────────────────────────────

export const bccPublicRoutes = new Hono<HonoEnv>();

// GET /list must be registered BEFORE /:id (otherwise "list" matches as an id)
bccPublicRoutes.get('/list', async (c) => {
  if (!c.env.AUDIT) return err('BCC store not configured.', 503, 'audit_unavailable');

  // ── Parse limit ────────────────────────────────────────────────────────────
  const limitRaw = c.req.query('limit');
  let limit = 20;
  if (limitRaw !== undefined && limitRaw !== '') {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || isNaN(parsed)) {
      return err('Invalid limit parameter.', 400, 'invalid_limit');
    }
    limit = Math.max(1, Math.min(100, parsed));
  }

  // ── Parse since cursor ─────────────────────────────────────────────────────
  const since = c.req.query('since');
  if (since !== undefined && !since.startsWith('bcc_')) {
    return err('Invalid cursor.', 400, 'invalid_cursor');
  }

  // ── Query D1 ───────────────────────────────────────────────────────────────
  type Row = { rowid: number; id: string; subject_did: string; stake_medium: string; issued_at: string };
  let rows: Row[];

  if (since) {
    // Verify cursor exists
    const cursorRow = await c.env.AUDIT
      .prepare('SELECT rowid FROM bcc_credentials WHERE id = ?')
      .bind(since)
      .first<{ rowid: number }>();

    if (!cursorRow) return err('Cursor not found.', 404, 'cursor_not_found');

    const result = await c.env.AUDIT
      .prepare(
        `SELECT rowid, id, subject_did, stake_medium, issued_at
         FROM bcc_credentials
         WHERE revoked_at IS NULL AND rowid < ?1
         ORDER BY rowid DESC
         LIMIT ?2`,
      )
      .bind(cursorRow.rowid, limit)
      .all<Row>();

    rows = result.results;
  } else {
    const result = await c.env.AUDIT
      .prepare(
        `SELECT rowid, id, subject_did, stake_medium, issued_at
         FROM bcc_credentials
         WHERE revoked_at IS NULL
         ORDER BY rowid DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all<Row>();

    rows = result.results;
  }

  const count = rows.length;
  const next_cursor = count === limit ? (rows[count - 1]?.id ?? null) : null;

  const items = rows.map(r => ({
    id: r.id,
    subject_did: r.subject_did,
    evidence_type: r.stake_medium,
    issued_at: r.issued_at,
  }));

  return json({ items, count, next_cursor });
});

// GET /:id/verify must be registered BEFORE /:id (more specific path)
bccPublicRoutes.get('/:id/verify', async (c) => {
  if (!c.env.AUDIT || !c.env.AUDIT_SIGNING_KEY) {
    return err('BCC verification not configured.', 503, 'audit_unavailable');
  }

  const id = c.req.param('id');
  if (!id || !id.startsWith('bcc_')) {
    return err('Invalid BCC credential id.', 400, 'invalid_id');
  }

  const row = await c.env.AUDIT
    .prepare('SELECT credential_json, revoked_at FROM bcc_credentials WHERE id = ?')
    .bind(id)
    .first<{ credential_json: string; revoked_at: string | null }>();

  if (!row) return err('BCC credential not found.', 404, 'not_found');

  const credential = JSON.parse(row.credential_json) as Record<string, unknown>;
  const cs = credential.credentialSubject as Record<string, unknown>;

  const status = await computeBccVerifyStatus(c.env, id);
  const isRevoked = !!row.revoked_at;
  const valid = status === 'verified' || status === 'expired';
  const profile = cs.bcc_profile as string;
  const validUntil = credential.validUntil as string | null;

  const response = {
    credential_id: id,
    valid: valid && !isRevoked,
    profile,
    stake: {
      medium: cs.stake_medium as string,
      amount: cs.stake_amount as number | null,
      unit: cs.stake_unit as string | null,
    },
    oracle_state: inferOracleState(profile, validUntil),
    evidence_chain: buildEvidenceChain(
      cs.evidence_anchor as string,
      credential.validFrom as string,
    ),
    issuer: (credential.issuer as Record<string, unknown>)?.id ?? credential.issuer,
    subject: cs.id as string,
    window: {
      start: cs.commitment_window_start as string,
      end: cs.commitment_window_end as string | null,
    },
  };

  if (isRevoked) {
    return c.json({ ...response, valid: false }, 410);
  }

  return json(response);
});

// ─── Badge endpoints — registered BEFORE /:id to avoid swallowing ────────────

const BADGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

function badgeSvgResponse(svg: string): Response {
  const res = svgResponse(svg);
  // svgResponse already sets the correct headers — return as-is
  return res;
}

async function handleBccBadgeRequest(c: any): Promise<Response> {
  const rawId = c.req.param('id') || '';

  const style = parseStyle(c.req.query('style'));
  const compact = c.req.query('compact') === 'true';
  const customLabel = c.req.query('label');
  const label = customLabel || (compact ? 'AL-BCC' : 'BCC');

  // Validate id format
  if (!BCC_ID_RE.test(rawId)) {
    return badgeSvgResponse(renderErrorBadge(label, 'invalid id', style));
  }

  const status = await computeBccVerifyStatus(c.env, rawId);

  let value: string;
  let color: string;

  switch (status) {
    case 'verified':
      value = 'verified'; color = '#4caf50'; break;
    case 'expired':
      value = 'expired'; color = '#ff9800'; break;
    case 'revoked':
      value = 'revoked'; color = '#f44336'; break;
    case 'unavailable':
      value = 'unavailable'; color = '#9e9e9e'; break;
    case 'unknown':
    default:
      value = 'unknown'; color = '#9e9e9e'; break;
  }

  return badgeSvgResponse(renderBadgeSVG(label, value, color, style));
}

bccPublicRoutes.get('/:id/badge.svg', handleBccBadgeRequest);
bccPublicRoutes.get('/:id/badge', handleBccBadgeRequest);

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

  // ── Sign (eddsa-jcs-2022 DataIntegrityProof) ────────────────────────────────
  // Two-hash construction per W3C Data Integrity EdDSA Cryptosuites spec:
  //   hashData = sha256(canonical(proofOptions)) || sha256(canonical(document))
  // proofOptions = proof block without proofValue; document = credential without proof.

  const proofOptions = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    verificationMethod: `${issuerDid}#key-1`,
    proofPurpose: 'assertionMethod',
    created: now,
  };

  // Decode the signing key (base64 → 32-byte Ed25519 private key seed)
  const privKeyBytes = Uint8Array.from(atob(c.env.AUDIT_SIGNING_KEY), ch => ch.charCodeAt(0));

  const hashData = await buildHashData(
    credentialWithoutProof as unknown as Record<string, unknown>,
    proofOptions as unknown as Record<string, unknown>,
  );

  const signature = ed25519.sign(hashData, privKeyBytes);

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
