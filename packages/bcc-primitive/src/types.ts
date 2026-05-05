/**
 * Types for the BCC (Bonded Credibility Credential) primitive layer.
 * Shared by AgentLair (agent surface) and Commit (human/business surface).
 *
 * Verifier API contract: both verifiers MUST return BCCResolution-shaped responses.
 * @see bcc-schema-v1.md §Verifier API
 */

/** Supported BCC profiles. Each maps to a stake medium and commitment style. */
export type BCCProfile = "BCC-Capital" | "BCC-Claims" | "BCC-Existence";

/** Stake medium encoding. Maps 1:1 to BCCProfile. */
export type StakeMedium = "capital" | "claims" | "existence";

/** Oracle state for a bond credential. */
export type OracleState =
  | "active"          // Bond is live and within term (CBP) / stream ongoing (PoPA, BPTR)
  | "slashed"         // Bond was slashed by oracle or early withdrawal
  | "expired"         // Term ended; principal may be recovered (CBP only)
  | "self_revealing"; // PoPA-specific: no oracle; gaps in chain are self-revealing

/** An item in the evidence chain. */
export interface EvidenceItem {
  /**
   * Entry type:
   *   'scitt_entry'  — SCITT transparency log entry (PoPA, BCC-Claims).
   *   'onchain_tx'   — On-chain transaction (CBP / BCC-Capital).
   *   'self_anchor'  — Self-revealing credential with no external anchor
   *                    (BCC-Existence v1); the credential itself is the evidence.
   */
  type: "scitt_entry" | "onchain_tx" | "self_anchor";
  /** Reference — `scitt:<entry_id>`, `0x<tx_hash>`, or the credential ID for self-anchored. */
  ref: string;
  /** ISO 8601 UTC timestamp of the evidence item. */
  timestamp: string;
}

/**
 * Unified resolution shape returned by verifyBCC().
 *
 * Both the AgentLair verifier (GET /v1/bcc/{id}) and the Commit verifier
 * (GET commit-backend.fly.dev/trust/{kind}/{id}) MUST return data that maps
 * to this shape. Missing fields are filled from sane defaults by the adapter.
 */
export interface BCCResolution {
  /** The credential ID that was resolved. */
  credential_id: string;
  /** Whether the credential is currently valid. */
  valid: boolean;
  /** The BCC profile (Capital / Claims / Existence). */
  profile: BCCProfile;
  /** Stake details. */
  stake: {
    medium: StakeMedium;
    amount: number | null;
    unit: string | null;
  };
  /** Current oracle state. */
  oracle_state: OracleState;
  /**
   * Ordered list of evidence items forming the commitment chain.
   * For CBP: [onchain_tx for bond mint, optional subsequent onchain_txs for slashings].
   * For PoPA: latest SCITT entry (chain traversal via prev_attestation_id).
   * For BCC-Existence v1 (self-anchored): single self_anchor item — the credential
   *   is its own evidence; no external log or chain transaction is required.
   */
  evidence_chain: EvidenceItem[];
  /** DID of the credential issuer. */
  issuer: string;
  /** DID or identifier of the credential subject. */
  subject: string;
  /** Commitment window. end is null for open-ended streams (PoPA, BPTR). */
  window: {
    start: string;
    end: string | null;
  };
}

/** Options for verifyBCC(). */
export interface VerifyBCCOptions {
  /**
   * Which surface to query:
   *   'agentlair' → https://agentlair.dev/v1/bcc/{id}
   *   'commit'    → https://commit-backend.fly.dev/trust/{kind}/{id}
   *                 Response is normalised to BCCResolution shape by adapter.
   */
  source: "agentlair" | "commit";
  /**
   * For source='commit': the credential kind used in the URL path.
   * Defaults to 'bcc' if not specified.
   */
  commitKind?: string;
  /**
   * Optional fetch implementation (inject for testing or edge runtimes).
   * Defaults to globalThis.fetch.
   */
  fetchFn?: typeof fetch;
}

/** Wire response shape from GET /v1/bcc/{id} (AgentLair verifier). */
export interface AgentLairBCCResponse {
  credential_id: string;
  valid: boolean;
  profile: BCCProfile;
  stake: {
    medium: StakeMedium;
    amount: number | null;
    unit: string | null;
  };
  oracle_state: OracleState;
  evidence_chain: EvidenceItem[];
  issuer: string;
  subject: string;
  window: {
    start: string;
    end: string | null;
  };
}

/**
 * Wire response shape from Commit trust verifier.
 * GET commit-backend.fly.dev/trust/{kind}/{id}
 *
 * The Commit API returns a BCC-envelope-compatible shape but may use different
 * field names for identity (reviewer_nullifier, entity_id) — the adapter
 * normalises these to BCCResolution. Missing fields are filled from defaults.
 */
export interface CommitTrustResponse {
  id?: string;
  credential_id?: string;
  valid?: boolean;
  profile?: string;
  stake?: {
    medium?: string;
    amount?: number | null;
    unit?: string | null;
  };
  oracle_state?: string;
  evidence_chain?: Partial<EvidenceItem>[];
  issuer?: string;
  subject?: string;
  entity_id?: string; // Commit-side subject identifier (alternative to subject)
  window?: {
    start?: string;
    end?: string | null;
  };
}
