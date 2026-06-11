/**
 * @agentlair/mcp-trust-attestation — BHC-S response shape
 *
 * Field names are byte-for-byte literal vs the BHC-S spec v0.1.0
 * (urn:agentlair:bhc-s:v1). Do not paraphrase — the descriptor is
 * a contract.
 */

/**
 * Behavioral Health Certificate (Server) — BHC-S — issuer descriptor.
 * Served at `/.well-known/agentlair-trust` per the SEP-2133 unofficial
 * extension `dev.agentlair/trust-attestation`.
 */
export interface TrustAttestationDescriptor {
  /** Canonical issuer URL (e.g. "https://agentlair.dev"). */
  issuer: string;
  /** Absolute URL of the JWKS used to verify attestation JWTs. */
  jwks_uri: string;
  /** Per-subject attestation URL template, containing the literal `{server_id}` placeholder. */
  attestation_endpoint_template: string;
  /** Behavioral signals the issuer is willing to surface in attestations. */
  supported_signals: string[];
  /** Subject categories the issuer can attest. */
  supported_subjects: string[];
  /** Identifier forms the issuer accepts for a subject. */
  supported_subject_id_forms: string[];
  /** Versioned identifier for the signal computation pipeline. */
  signal_algorithm_version: string;
  /** Maximum lifetime, in seconds, of any attestation JWT the issuer mints. */
  max_token_ttl_seconds: number;
  /** URN identifying the BHC token shape (e.g. "urn:agentlair:bhc-s:v1"). */
  bhc_token_type: string;
  /** SemVer of the BHC-S spec being implemented. */
  spec_version: string;
  /** Human-readable documentation pointer. */
  documentation_url: string;
}

/**
 * Options for the SDK middleware factory.
 */
export interface AttestationMiddlewareOptions {
  /**
   * Subject identifier in one of the supported forms:
   * `url_sha256:<hex>` | `agentlair_alias:<alias>` | `did_key:<did>`.
   */
  serverId: string;
  /** Override the issuer URL (default "https://agentlair.dev"). */
  issuer?: string;
  /** Override the attestation endpoint base (default `${issuer}/v1/trust/server`). */
  attestationEndpointBase?: string;
  /** Minimum cache age, in seconds, for per-subject attestation responses (default 900). */
  minTokenFreshnessSeconds?: number;
}

/**
 * Result of verifying an attestation JWT.
 *
 * `reason` is a stable short code:
 *  - `"expired"` — token's `exp` claim is in the past.
 *  - `"signature"` — signature verification failed (wrong key / tampered / no matching key).
 *  - `"issuer"` — `iss` claim does not match the expected issuer.
 *  - `"audience"` — `aud` claim does not match the expected audience.
 *  - `"malformed"` — token is not a valid 3-part JWT.
 *  - `"fetch"` — JWKS could not be fetched.
 *  - `"other"` — anything else (message in `error`).
 */
export interface VerifyAttestationResult {
  ok: boolean;
  payload?: unknown;
  reason?: 'expired' | 'signature' | 'issuer' | 'audience' | 'malformed' | 'fetch' | 'other';
  /** Free-text error message — only set when `ok === false`. */
  error?: string;
}
