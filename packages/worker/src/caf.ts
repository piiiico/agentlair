/**
 * Commitment Attestation Format (CAF) v0.1 — AgentLair Emitter
 *
 * Implements:
 * - CAF TypeScript interfaces (from spec section 2)
 * - canonicalize() — deterministic JSON serialization for signing/hashing
 * - computeId() — content-addressable ID (sha256 of canonical JSON)
 * - signAttestation() — Ed25519 signature over canonical form
 * - auditEntryToCAF() — converts AuditEntry to a complete CommitmentAttestation
 *
 * Reference: /workspace/memory/knowledge/commitment-attestation-format.md
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256hex } from './utils.js';
import type { AuditEntry } from './middleware/audit.js';

// ─── Identity Types ───────────────────────────────────────────────────────────

/**
 * A typed identifier for any entity in the commitment graph.
 * The type discriminates between identity systems.
 */
export type SubjectId =
  | { type: 'agent';    id: string }   // AgentLair account: "acc_xxx"
  | { type: 'human';    id: string }   // PoP-verified human: "bankid:xxx", "worldid:xxx"
  | { type: 'business'; id: string }   // Business registry: "brreg:923456789"
  | { type: 'did';      id: string }   // Any DID: "did:web:example.com"
  | { type: 'url';      id: string };  // Web resource: "https://example.com"

/**
 * A typed identifier for the entity making the attestation.
 * Same type system as SubjectId.
 */
export type AttesterId = SubjectId;

// ─── Cost Signal ──────────────────────────────────────────────────────────────

/**
 * What makes this commitment costly to fake (the Spence dimension).
 */
export interface CostSignal {
  /** The type of cost that makes this commitment credible. */
  type: 'financial' | 'temporal' | 'computational' | 'reputational' | 'credential' | 'behavioral' | 'institutional';

  /** Human-readable description of the specific cost. */
  description: string;

  /**
   * Quantified cost magnitude (optional).
   * - financial: amount in smallest unit (cents, satoshis)
   * - temporal: milliseconds
   * - behavioral: event count
   * - computational: hash operations
   * - credential/reputational/institutional: null
   */
  magnitude: number | null;

  /** Unit for the magnitude. */
  unit: string | null;
}

// ─── Evidence ────────────────────────────────────────────────────────────────

/**
 * Verifiable evidence supporting a commitment attestation.
 */
export interface Evidence {
  /** What kind of evidence this is. */
  type: 'hash' | 'url' | 'inline' | 'merkle_proof' | 'zk_proof';

  /** Human-readable label. */
  label: string;

  /** The evidence payload. */
  value: string | Record<string, unknown>;
}

// ─── Attestation Signature ────────────────────────────────────────────────────

/**
 * Ed25519 signature over the canonical attestation.
 */
export interface AttestationSignature {
  /** Signature algorithm. */
  alg: 'EdDSA';

  /** Key identifier — matches `kid` in JWKS or key ID in DID document. */
  kid: string;

  /** Base64-encoded Ed25519 signature. */
  value: string;
}

// ─── Commitment Source ────────────────────────────────────────────────────────

/**
 * The system that generated this attestation.
 */
export type CommitmentSource =
  | 'agentlair'     // AgentLair audit trail
  | 'vwm'           // Verified Work Market
  | 'commit.ext'    // Commit browser extension
  | 'brreg'         // Brønnøysundregistrene (Norwegian business registry)
  | 'mattilsynet'   // Norwegian Food Safety Authority
  | 'manual'        // Human-entered attestation
  | string;         // Extensible — any source can emit CAF

// ─── AgentLair Body Schema ────────────────────────────────────────────────────

/**
 * Body for commitment_type: "agent.action"
 * Transforms an AuditEntry into a CAF body.
 */
export interface AgentActionBody {
  /** The action performed (from audit middleware). */
  action: string;

  /** HTTP method. */
  method: string;

  /** API path (resource identifier). */
  path: string;

  /** Outcome. */
  result: 'success' | 'failure' | 'denied' | 'rate_limited';

  /** HTTP status code. */
  status: number;

  /** Whether this action triggered the approval gate. */
  approval_required: boolean;

  /** Whether a human approved the action (null if no approval gate). */
  approval_granted: boolean | null;

  /** Hash of the previous audit entry (chain integrity). */
  prev_hash: string;

  /** Action-specific details. */
  details: Record<string, string | number | boolean> | null;
}

// ─── Core Attestation Schema ──────────────────────────────────────────────────

/**
 * Commitment Attestation Format (CAF) v0.1
 *
 * The universal unit of the commitment graph.
 * Every data source (AgentLair, VWM, browser extension, public data) emits this shape.
 */
export interface CommitmentAttestation {
  /** Globally unique ID. Content-addressable: SHA-256(canonical JSON excluding id, sig). */
  id: string;

  /** Schema version. Breaking changes increment major. */
  schema: 'caf:v0.1';

  /** Who made this attestation. */
  attester: AttesterId;

  /** Who/what this attestation is about. */
  subject: SubjectId;

  /** When the attested event occurred. ISO 8601 UTC. */
  timestamp: string;

  /** When this attestation was created. ISO 8601 UTC. */
  created_at: string;

  /** When this attestation expires. null = never. ISO 8601 UTC. */
  expires_at: string | null;

  /** When this attestation was revoked. null = active. ISO 8601 UTC. */
  revoked_at: string | null;

  /** The data source that generated this attestation. */
  source: CommitmentSource;

  /** What kind of commitment this attests to. Hierarchical: "domain.action". */
  commitment_type: string;

  /** The commitment-specific payload. Schema varies by commitment_type. */
  body: Record<string, unknown>;

  /** What makes this attestation costly to fake (the Spence dimension). */
  cost_signal: CostSignal;

  /** Verifiable evidence supporting this attestation. */
  evidence: Evidence[];

  /**
   * References to other attestations. Forms the commitment graph.
   * Inspired by EAS refUID.
   */
  ref: string[];

  /** Cryptographic proof of attestation integrity. */
  sig: AttestationSignature;
}

// ─── Canonical Serialization ──────────────────────────────────────────────────

/**
 * Recursively sort all object keys alphabetically.
 * Required for canonical JSON serialization.
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Produce canonical JSON for signing/hashing.
 *
 * Rules:
 * 1. Sort all object keys alphabetically (recursive)
 * 2. No whitespace (compact JSON)
 * 3. Exclude `id` and `sig` fields (they depend on the canonical form)
 * 4. null values are included (not stripped)
 * 5. Numbers are IEEE 754 double-precision (no trailing zeros)
 */
export function canonicalize(attestation: CommitmentAttestation | Omit<CommitmentAttestation, 'id' | 'sig'>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, sig: _sig, ...rest } = attestation as CommitmentAttestation;
  return JSON.stringify(sortObjectKeys(rest));
}

/**
 * Compute the content-addressable ID for an attestation.
 * Returns `sha256:<hex>` — deterministic for the same content.
 */
export async function computeId(attestation: Omit<CommitmentAttestation, 'id' | 'sig'>): Promise<string> {
  const canonical = JSON.stringify(sortObjectKeys(attestation));
  const hex = await sha256hex(canonical);
  return `sha256:${hex}`;
}

// ─── Ed25519 Signing ──────────────────────────────────────────────────────────

/**
 * Compute a deterministic key ID from a base64-encoded private key.
 * First 8 chars of SHA-256 of the public key — same pattern as jwt.ts.
 */
async function computeKid(privateKeyB64: string): Promise<string> {
  const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  // SHA-256 of public key bytes via crypto.subtle
  const buf = ArrayBuffer.prototype.slice.call(
    publicKeyBytes.buffer,
    publicKeyBytes.byteOffset,
    publicKeyBytes.byteOffset + publicKeyBytes.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 8);
}

/**
 * Sign an attestation with Ed25519 and return an AttestationSignature.
 *
 * Signs the canonical JSON of the attestation (excluding id + sig fields).
 */
export async function signAttestation(
  attestation: Omit<CommitmentAttestation, 'id' | 'sig'>,
  signingKeyB64: string,
): Promise<AttestationSignature> {
  const canonical = canonicalize(attestation as CommitmentAttestation);
  const messageBytes = new TextEncoder().encode(canonical);
  const privateKeyBytes = Uint8Array.from(atob(signingKeyB64), c => c.charCodeAt(0));
  const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);
  const value = btoa(String.fromCharCode(...signatureBytes));
  const kid = await computeKid(signingKeyB64);
  return { alg: 'EdDSA', kid, value };
}

// ─── AuditEntry → CAF Converter ───────────────────────────────────────────────

/**
 * Convert an AuditEntry to a complete CommitmentAttestation (including id and sig).
 *
 * Field mapping per spec section 9 and section 13.1:
 * - attester/subject = account_id (agent attests its own behavior)
 * - timestamp + created_at = entry.timestamp
 * - body includes action, method, path, result, status, prev_hash, details
 * - cost_signal = credential (Ed25519-signed + hash-chained)
 * - evidence = [original signature hash, audit trail URL]
 */
export async function auditEntryToCAF(
  entry: AuditEntry,
  signingKeyB64: string,
): Promise<CommitmentAttestation> {
  const withoutIdAndSig: Omit<CommitmentAttestation, 'id' | 'sig'> = {
    schema: 'caf:v0.1',
    attester: { type: 'agent', id: entry.account_id },
    subject: { type: 'agent', id: entry.account_id },
    timestamp: entry.timestamp,
    created_at: entry.timestamp,
    expires_at: null,
    revoked_at: null,
    source: 'agentlair',
    commitment_type: 'agent.action',
    body: {
      action: entry.action,
      method: entry.method,
      path: entry.path,
      result: entry.result,
      status: entry.status,
      approval_required: false,
      approval_granted: null,
      prev_hash: entry.prev_hash,
      details: entry.details,
    },
    cost_signal: {
      type: 'credential',
      description: `Ed25519-signed audit entry from AgentLair identity (${entry.account_id}). Hash-chained for tamper detection.`,
      magnitude: null,
      unit: null,
    },
    evidence: [
      {
        type: 'hash',
        label: 'Original audit entry signature',
        value: `ed25519:${entry.signature}`,
      },
      {
        type: 'url',
        label: 'AgentLair audit trail',
        value: `https://agentlair.dev/v1/audit/log?account=${entry.account_id}&from=${entry.timestamp}`,
      },
    ],
    ref: [],
  };

  const id = await computeId(withoutIdAndSig);
  const sig = await signAttestation(withoutIdAndSig, signingKeyB64);

  return { ...withoutIdAndSig, id, sig };
}
