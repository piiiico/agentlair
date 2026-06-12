-- Migration: 0022_create_aar_publication.sql
-- AAR v0.7 publication layer — content-addressed canonicalizer-profile and
-- policy/profile binding records, each served from /.well-known/aar-profiles/<hash>
-- and /.well-known/aar-bindings/<hash> respectively.
--
-- Source: vercel/ai#13215 (rpelevin guidance: keep it boring, individual publication,
-- separate profile-meaning from policy-binding-allowance).
--
-- Reads: worker GET /.well-known/aar-profiles/:hash, /.well-known/aar-bindings/:hash
-- Writes: admin POST /v1/aar/profiles, /v1/aar/bindings (ADMIN_KEY-gated)

CREATE TABLE IF NOT EXISTS aar_profiles (
  -- 'sha256:<hex>' — content address. Verifier resolves the receipt's
  -- canonicalizerProfileHash through this key.
  profile_hash TEXT PRIMARY KEY,
  -- Canonical JSON bytes of the profile (the exact bytes whose sha256 is profile_hash).
  -- Stored verbatim so the verifier can hash what it fetched and compare to the receipt.
  profile_canonical_json TEXT NOT NULL,
  -- JWS compact-serialization signature over profile_canonical_json (alg=EdDSA, kid
  -- resolves through /.well-known/jwks.json).
  issuer_signature_jws TEXT NOT NULL,
  -- Issuer identifier (free-form; resolved through JWKS at lookup time).
  issuer TEXT NOT NULL,
  -- Issued/expires window. Verifier rejects if beginAction.issuedAt falls outside.
  issued_at TEXT NOT NULL,           -- ISO 8601 UTC
  expires_at TEXT,                   -- ISO 8601 UTC; NULL = open-ended
  superseded_at TEXT,                -- ISO 8601 UTC; NULL = active
  -- Optional supersedes pointer to the prior profile_hash.
  supersedes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aar_profiles_issuer
  ON aar_profiles(issuer);

CREATE TABLE IF NOT EXISTS aar_bindings (
  -- 'sha256:<hex>' — content address. Verifier resolves the receipt's
  -- policyProfileBindingHash through this key.
  binding_hash TEXT PRIMARY KEY,
  -- Canonical JSON of the binding record (issuer, kid, policySurfaceHash,
  -- canonicalizerProfileHash, issued_at, expires_at|supersedes, status, binding_hash).
  binding_canonical_json TEXT NOT NULL,
  -- JWS compact-serialization signature (alg=EdDSA, kid resolves through JWKS).
  issuer_signature_jws TEXT NOT NULL,
  -- The two hashes the binding asserts compatibility over. Indexed for issuer-side
  -- "show me all bindings for profile X" lookups.
  policy_surface_hash TEXT NOT NULL,
  canonicalizer_profile_hash TEXT NOT NULL,
  issuer TEXT NOT NULL,
  issued_at TEXT NOT NULL,           -- ISO 8601 UTC
  expires_at TEXT,                   -- ISO 8601 UTC; NULL = open-ended
  superseded_at TEXT,                -- ISO 8601 UTC; NULL = active
  supersedes TEXT,                   -- prior binding_hash, or NULL
  -- 'active' | 'revoked' | 'superseded' — verifier rejects non-active bindings whose
  -- issued window does not cover beginAction.issuedAt.
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aar_bindings_profile
  ON aar_bindings(canonicalizer_profile_hash);

CREATE INDEX IF NOT EXISTS idx_aar_bindings_surface
  ON aar_bindings(policy_surface_hash);

CREATE INDEX IF NOT EXISTS idx_aar_bindings_issuer
  ON aar_bindings(issuer);
