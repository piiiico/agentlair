// ─── AAR Publication Routes (v0.7) ────────────────────────────────────────────
//
// Content-addressed publication of canonicalizer profiles and policy/profile
// bindings, so a verifier can answer two questions independently of the prover:
//
//   GET /.well-known/aar-profiles/<profile_hash>
//     "what bytes does canonicalizerProfileHash actually resolve to?"
//
//   GET /.well-known/aar-bindings/<binding_hash>
//     "was this (policy, profile) pair an allowed binding when authority was minted?"
//
// Both records embed an EdDSA signature whose `kid` resolves through
// /.well-known/jwks.json — same root of trust as AATs and AARs.
//
// Source: vercel/ai#13215 (rpelevin guidance — keep v0.7 boring, individual
// publication only; no Merkle until the verifier gets a signed root + inclusion
// proof; profile-publication and binding-publication answer separate questions).
//
// Writes are admin-gated (POST /v1/aar/profiles, /v1/aar/bindings) — the public
// surface is read-only.

import { Hono } from 'hono';
import type { HonoEnv, Env } from '../types.js';
import { signJWS, getPublicKey, computeKeyId } from '../jwt.js';

const HASH_RE = /^sha256:[0-9a-f]{64}$/;

// ─── Canonical JSON (must match audit-logger byte-for-byte) ────────────────────
//
// The verifier hashes the bytes we return and compares to the receipt's
// canonicalizerProfileHash / policyProfileBindingHash. If our canonicalization
// drifts from audit-logger's, every signature verifies but every hash check
// fails. Keep this byte-identical to canonicalJson() in audit-logger/logger.ts.

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + (value as unknown[]).map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value as object).sort();
  return '{' + keys.map(
    k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]),
  ).join(',') + '}';
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Stored record shapes ──────────────────────────────────────────────────────

interface PublishedProfileRow {
  profile_canonical_json: string;
  issuer_signature_jws: string;
  issuer: string;
  issued_at: string;
  expires_at: string | null;
  superseded_at: string | null;
  supersedes: string | null;
}

interface PublishedBindingRow {
  binding_canonical_json: string;
  issuer_signature_jws: string;
  policy_surface_hash: string;
  canonicalizer_profile_hash: string;
  issuer: string;
  issued_at: string;
  expires_at: string | null;
  superseded_at: string | null;
  supersedes: string | null;
  status: 'active' | 'revoked' | 'superseded';
}

// ─── GET routes (public, content-addressed) ────────────────────────────────────

export const aarPublicationReadRoutes = new Hono<HonoEnv>();

aarPublicationReadRoutes.get('/aar-profiles/:hash', async (c) => {
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) {
    return new Response(
      JSON.stringify({ error: 'invalid_profile_hash_format', detail: 'Expected sha256:<64-hex>.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!c.env.AUDIT) {
    return new Response(
      JSON.stringify({ error: 'publication_storage_unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const row = await c.env.AUDIT
    .prepare(
      'SELECT profile_canonical_json, issuer_signature_jws, issuer, issued_at, expires_at, superseded_at, supersedes ' +
      'FROM aar_profiles WHERE profile_hash = ?1',
    )
    .bind(hash)
    .first<PublishedProfileRow>();

  if (!row) {
    // 404 is the fail-closed signal — verifier maps this to `profile_unpublished`.
    return new Response(
      JSON.stringify({ error: 'profile_unpublished', profile_hash: hash }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let profile: unknown;
  try {
    profile = JSON.parse(row.profile_canonical_json);
  } catch {
    return new Response(
      JSON.stringify({ error: 'corrupt_profile_record', profile_hash: hash }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({
      profile,
      profile_canonical_json: row.profile_canonical_json,
      profile_hash: hash,
      issuer: row.issuer,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      superseded_at: row.superseded_at,
      supersedes: row.supersedes,
      issuer_signature: row.issuer_signature_jws,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Content-addressed: hash determines bytes, so cache aggressively.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
});

aarPublicationReadRoutes.get('/aar-bindings/:hash', async (c) => {
  const hash = c.req.param('hash');
  if (!HASH_RE.test(hash)) {
    return new Response(
      JSON.stringify({ error: 'invalid_binding_hash_format', detail: 'Expected sha256:<64-hex>.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!c.env.AUDIT) {
    return new Response(
      JSON.stringify({ error: 'publication_storage_unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const row = await c.env.AUDIT
    .prepare(
      'SELECT binding_canonical_json, issuer_signature_jws, policy_surface_hash, ' +
      'canonicalizer_profile_hash, issuer, issued_at, expires_at, superseded_at, supersedes, status ' +
      'FROM aar_bindings WHERE binding_hash = ?1',
    )
    .bind(hash)
    .first<PublishedBindingRow>();

  if (!row) {
    // Fail-closed: verifier maps 404 to `binding_unpublished`.
    return new Response(
      JSON.stringify({ error: 'binding_unpublished', binding_hash: hash }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let binding: unknown;
  try {
    binding = JSON.parse(row.binding_canonical_json);
  } catch {
    return new Response(
      JSON.stringify({ error: 'corrupt_binding_record', binding_hash: hash }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({
      binding,
      binding_canonical_json: row.binding_canonical_json,
      binding_hash: hash,
      policy_surface_hash: row.policy_surface_hash,
      canonicalizer_profile_hash: row.canonicalizer_profile_hash,
      issuer: row.issuer,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      superseded_at: row.superseded_at,
      supersedes: row.supersedes,
      status: row.status,
      issuer_signature: row.issuer_signature_jws,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
});

// ─── POST routes (admin-gated, write) ─────────────────────────────────────────
//
// The publication surface is content-addressed and immutable — supersession
// happens by publishing a NEW record whose `supersedes` points at the old hash,
// and patching the old record's `superseded_at`.
//
// Auth: same `ADMIN_KEY` shared secret used for /v1/admin/* routes.

export const aarPublicationWriteRoutes = new Hono<HonoEnv>();

function adminAuthorized(req: Request, env: Env): boolean {
  if (!env.ADMIN_KEY) return false;
  const header = req.headers.get('Authorization') ?? '';
  const key = header.replace(/^Bearer\s+/i, '').trim();
  return key === env.ADMIN_KEY;
}

async function signWithAuditKey(
  env: Env,
  payload: Record<string, unknown>,
): Promise<{ jws: string; kid: string } | { error: string }> {
  if (!env.AUDIT_SIGNING_KEY) return { error: 'AUDIT_SIGNING_KEY not configured' };
  const pubBytes = getPublicKey(env.AUDIT_SIGNING_KEY);
  const kid = await computeKeyId(pubBytes);
  const jws = signJWS(payload, env.AUDIT_SIGNING_KEY, kid, 'https://agentlair.dev/.well-known/jwks.json');
  return { jws, kid };
}

aarPublicationWriteRoutes.post('/profiles', async (c) => {
  if (!adminAuthorized(c.req.raw, c.env)) {
    return new Response(
      JSON.stringify({ error: 'admin_unauthorized' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!c.env.AUDIT) {
    return new Response(
      JSON.stringify({ error: 'publication_storage_unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_json' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const profile = body.profile as Record<string, unknown> | undefined;
  const issuer = typeof body.issuer === 'string' ? body.issuer : '';
  const issuedAt = typeof body.issued_at === 'string' ? body.issued_at : new Date().toISOString();
  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : null;
  const supersedes = typeof body.supersedes === 'string' ? body.supersedes : null;

  if (!profile || typeof profile !== 'object') {
    return new Response(
      JSON.stringify({ error: 'profile_required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!issuer) {
    return new Response(
      JSON.stringify({ error: 'issuer_required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Recompute the canonicalizer profile hash the same way audit-logger does
  // (computeCanonicalizerProfileHash). Reject if submitted hash != recomputed —
  // this is the "issuer is asserting bytes the verifier can independently
  // recompute" gate. Sort the array fields to match.
  const profileWithoutHash = { ...profile } as Record<string, unknown>;
  delete profileWithoutHash.profileHash;
  delete profileWithoutHash.migrationVerifier;
  if (Array.isArray(profileWithoutHash.includedConsequentialFields)) {
    profileWithoutHash.includedConsequentialFields =
      [...profileWithoutHash.includedConsequentialFields as unknown[]].sort();
  }
  if (Array.isArray(profileWithoutHash.excludedFields)) {
    profileWithoutHash.excludedFields =
      [...profileWithoutHash.excludedFields as unknown[]].sort();
  }
  const computedHash = 'sha256:' + await sha256Hex(canonicalJson(profileWithoutHash));
  const submittedHash = typeof profile.profileHash === 'string' ? profile.profileHash : '';
  if (submittedHash !== computedHash) {
    return new Response(
      JSON.stringify({
        error: 'profile_hash_mismatch',
        submitted: submittedHash,
        computed: computedHash,
        detail: 'Submitted profile.profileHash does not match recomputed hash over canonical bytes.',
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Store canonical bytes of the FULL submitted profile (including profileHash)
  // so the verifier re-hashes EXACTLY what the issuer signed.
  const canonicalBytes = canonicalJson(profile);

  const signed = await signWithAuditKey(c.env, {
    profile,
    issuer,
    issued_at: issuedAt,
    expires_at: expiresAt,
    supersedes,
  });
  if ('error' in signed) {
    return new Response(
      JSON.stringify({ error: signed.error }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    await c.env.AUDIT
      .prepare(
        'INSERT INTO aar_profiles ' +
        '(profile_hash, profile_canonical_json, issuer_signature_jws, issuer, issued_at, expires_at, superseded_at, supersedes) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)',
      )
      .bind(computedHash, canonicalBytes, signed.jws, issuer, issuedAt, expiresAt, supersedes)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
      return new Response(
        JSON.stringify({ profile_hash: computedHash, status: 'already_published' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw e;
  }

  if (supersedes) {
    await c.env.AUDIT
      .prepare('UPDATE aar_profiles SET superseded_at = ?1 WHERE profile_hash = ?2 AND superseded_at IS NULL')
      .bind(issuedAt, supersedes)
      .run();
  }

  return new Response(
    JSON.stringify({
      profile_hash: computedHash,
      url: `https://agentlair.dev/.well-known/aar-profiles/${computedHash}`,
      kid: signed.kid,
      status: 'published',
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
});

aarPublicationWriteRoutes.post('/bindings', async (c) => {
  if (!adminAuthorized(c.req.raw, c.env)) {
    return new Response(
      JSON.stringify({ error: 'admin_unauthorized' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!c.env.AUDIT) {
    return new Response(
      JSON.stringify({ error: 'publication_storage_unavailable' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_json' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const policySurfaceHash = typeof body.policy_surface_hash === 'string' ? body.policy_surface_hash : '';
  const canonicalizerProfileHash = typeof body.canonicalizer_profile_hash === 'string'
    ? body.canonicalizer_profile_hash
    : '';
  const issuer = typeof body.issuer === 'string' ? body.issuer : '';
  const issuedAt = typeof body.issued_at === 'string' ? body.issued_at : new Date().toISOString();
  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : null;
  const supersedes = typeof body.supersedes === 'string' ? body.supersedes : null;
  const status = typeof body.status === 'string' && ['active', 'revoked', 'superseded'].includes(body.status)
    ? (body.status as 'active' | 'revoked' | 'superseded')
    : 'active';

  if (!HASH_RE.test(policySurfaceHash)) {
    return new Response(
      JSON.stringify({ error: 'policy_surface_hash_invalid' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!HASH_RE.test(canonicalizerProfileHash)) {
    return new Response(
      JSON.stringify({ error: 'canonicalizer_profile_hash_invalid' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!issuer) {
    return new Response(
      JSON.stringify({ error: 'issuer_required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // binding_hash matches audit-logger's computePolicyProfileBindingHash —
  // canonicalJson over {policySurfaceHash, canonicalizerProfileHash}, sha256.
  const bindingPayload: Record<string, unknown> = {
    policySurfaceHash,
    canonicalizerProfileHash,
  };
  const bindingHash = 'sha256:' + await sha256Hex(canonicalJson(bindingPayload));

  // Refuse to publish a binding pointing at an unpublished profile — that would
  // be a publisher-side mistake the verifier can't recover from.
  const profileExists = await c.env.AUDIT
    .prepare('SELECT 1 AS ok FROM aar_profiles WHERE profile_hash = ?1')
    .bind(canonicalizerProfileHash)
    .first<{ ok: number }>();
  if (!profileExists) {
    return new Response(
      JSON.stringify({
        error: 'canonicalizer_profile_not_published',
        canonicalizer_profile_hash: canonicalizerProfileHash,
        detail: 'Publish the canonicalizer profile before publishing a binding that references it.',
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // The signed binding record carries the full tuple — issuer, kid (in JWS
  // header), both hashes, validity window, status. canonicalJson over THIS
  // object is what we sign and what the verifier hashes.
  const bindingRecord = {
    bindingHash,
    policySurfaceHash,
    canonicalizerProfileHash,
    issuer,
    issued_at: issuedAt,
    expires_at: expiresAt,
    supersedes,
    status,
  };
  const canonicalBytes = canonicalJson(bindingRecord);

  const signed = await signWithAuditKey(c.env, bindingRecord);
  if ('error' in signed) {
    return new Response(
      JSON.stringify({ error: signed.error }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    await c.env.AUDIT
      .prepare(
        'INSERT INTO aar_bindings ' +
        '(binding_hash, binding_canonical_json, issuer_signature_jws, policy_surface_hash, ' +
        ' canonicalizer_profile_hash, issuer, issued_at, expires_at, superseded_at, supersedes, status) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)',
      )
      .bind(
        bindingHash, canonicalBytes, signed.jws, policySurfaceHash,
        canonicalizerProfileHash, issuer, issuedAt, expiresAt, supersedes, status,
      )
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
      return new Response(
        JSON.stringify({ binding_hash: bindingHash, status: 'already_published' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw e;
  }

  if (supersedes) {
    await c.env.AUDIT
      .prepare(
        'UPDATE aar_bindings SET superseded_at = ?1, status = ?2 ' +
        'WHERE binding_hash = ?3 AND superseded_at IS NULL',
      )
      .bind(issuedAt, 'superseded', supersedes)
      .run();
  }

  return new Response(
    JSON.stringify({
      binding_hash: bindingHash,
      url: `https://agentlair.dev/.well-known/aar-bindings/${bindingHash}`,
      kid: signed.kid,
      status: 'published',
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
});
