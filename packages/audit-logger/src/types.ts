// ─── Types ───────────────────────────────────────────────────────────────────
// Core types for @agentlair/audit-logger

/** A single agent action to log */
export interface AuditLogEntry {
  /** Name/ID of the agent performing the action */
  agent: string;
  /** High-level action category (e.g. "tool_call", "llm_response", "decision") */
  action: string;
  /** Tool name, if this is a tool call */
  tool?: string;
  /** Input passed to the tool or LLM */
  input?: unknown;
  /** Output from the tool or LLM */
  output?: unknown;
  /** ISO 8601 timestamp — defaults to now */
  timestamp?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** A log entry with all fields resolved (timestamp guaranteed) */
export interface ResolvedAuditEntry extends AuditLogEntry {
  timestamp: string;
}

/** Sink: where to write audit logs */
export interface AuditSink {
  write(entry: ResolvedAuditEntry): Promise<void> | void;
}

/** Options for configuring the audit logger */
export interface AuditLoggerOptions {
  /**
   * AgentLair API key. If set (or AGENTLAIR_API_KEY env var), logs are also
   * shipped to AgentLair for persistent querying.
   */
  apiKey?: string;
  /** Base URL for AgentLair API. Defaults to https://agentlair.dev */
  baseUrl?: string;
  /**
   * Local sinks to write to in addition to (or instead of) console.
   * Pass an empty array to suppress console output.
   */
  sinks?: AuditSink[];
  /** If false, suppress console output. Default: true */
  console?: boolean;
  /** If true, suppress all output (useful in tests) */
  silent?: boolean;
  /** HMAC secret for signing AAR receipts */
  hmacSecret?: string;
  /** Actor identity for pre-action records */
  actorId?: string;
}

// ─── AAR Before/After Split Types ─────────────────────────────────────────────

export interface AARSignature {
  alg: 'EdDSA' | 'HMAC-SHA256';
  kid: string;    // key ID
  sig: string;    // hex-encoded signature
}

/**
 * Canonicalization scheme version. v0.5 ships with `'cv1'`; future schemes
 * (`'cv2'`, ...) MUST be opted into explicitly. Mismatched versions between
 * pre-action and terminal — or between a terminal and the verifier — fail
 * closed unless an explicit migration verifier is supplied.
 */
export type CanonicalizationVersion = 'cv1' | (string & {});

export interface AARPreAction {
  id: string;                        // random 20-char ID
  version: 'aar-v1';
  phase: 'pre-action';
  toolName: string;
  toolCallId: string;
  inputDigest: string;               // 'sha256:<hex>'
  actorId: string;
  sessionId?: string;
  policyRef?: string;
  approvalDecision?: 'approved' | 'denied' | 'conditional';
  decidedBy?: string;
  issuedAt: string;                  // ISO 8601 UTC
  /**
   * Authority deadline (ISO 8601 UTC). When present, this pre-action's authority to
   * execute the tool expires at this instant. Sign-time invariant: endAction() refuses
   * to record `phase === 'executed'` if execution ended after expiresAt. Verify-time
   * invariant: chains with `phase === 'expired'` terminals must have a corresponding
   * pre-action whose expiresAt is set and whose terminalAt >= expiresAt.
   *
   * Covered automatically by previousReceiptHash because canonical JSON over the whole
   * pre-action is hashed — tampering with expiresAt post-signing breaks the chain.
   */
  expiresAt?: string;                // ISO 8601 UTC
  /**
   * v0.5: SHA-256 hash of the canonical envelope (consequential call shape) shown for
   * approval. When set, the chain commits to the *meaning* of the approved call, not
   * just its raw bytes. `endAction()` refuses to seal `phase: 'executed'` unless the
   * terminal's `effectiveEnvelopeHash` equals this value under the same
   * canonicalizationVersion. `inputDigest` remains as evidence of the literal payload.
   *
   * Format: `'sha256:<hex>'`.
   */
  approvedEnvelopeHash?: string;
  /**
   * v0.5: Canonicalization scheme version under which approvedEnvelopeHash was computed.
   * Required when approvedEnvelopeHash is set. The verifier refuses to evaluate
   * envelope-equality across version boundaries unless an explicit migration verifier
   * is selected.
   */
  canonicalizationVersion?: CanonicalizationVersion;
  /**
   * v0.6: SHA-256 hash of the canonicalizer profile declared at approval time. The
   * profile names which envelope fields the canonicalizer preserves and which
   * normalization rules it applies. When set, the chain commits to the rules that
   * produced `approvedEnvelopeHash` — "trust the caller's hash function" becomes
   * checkable. `endAction()` refuses to seal `executed` unless the terminal embeds the
   * same `canonicalizerProfileHash`. Format: `'sha256:<hex>'`.
   */
  canonicalizerProfileHash?: string;
  /**
   * v0.6: SHA-256 hash of the policy surface — the set of fields the policy actually
   * depends on. Declared separately from the profile so policy migration and profile
   * migration are independent events. Format: `'sha256:<hex>'`.
   */
  policySurfaceHash?: string;
  /**
   * v0.6: SHA-256 hash of the registered (policy_surface_hash, canonicalizer_profile_hash)
   * compatibility binding. Computed by the PolicyProfileBindingRegistry when binding is
   * registered — `beginAction()` looks up the binding rather than recomputing
   * compatibility. Absence of a registered binding refuses authority at `beginAction()`
   * (`unbound_policy_profile`). Format: `'sha256:<hex>'`.
   */
  policyProfileBindingHash?: string;
  previousReceiptHash?: string;      // undefined for first in chain
  signature?: AARSignature;
}

export type AARTerminalPhase = 'executed' | 'failed' | 'denied' | 'expired' | 'cancelled';

export interface AARTerminalReceipt {
  id: string;
  version: 'aar-v1';
  phase: AARTerminalPhase;
  preActionId: string;
  toolCallId: string;
  terminalAt: string;                // ISO 8601 UTC — always present. For 'expired', this is the timestamp the logger noticed expiry (not the policy deadline).
  terminalReason?: string;           // optional human-readable reason
  // Execution fields — ONLY when phase is 'executed' or 'failed'
  executionStartedAt?: string;
  executionEndedAt?: string;
  // Result fields — ONLY when phase is 'executed'
  resultDigest?: string;             // 'sha256:<hex>' of canonical output
  // Error fields — ONLY when phase is 'failed'
  errorClass?: string;
  /**
   * v0.5: SHA-256 hash of the consequential call envelope at execution time. Only set
   * when phase === 'executed' AND the pre-action carries approvedEnvelopeHash.
   * sign-time invariant: must equal preAction.approvedEnvelopeHash. Drift names which
   * side moved — the verifier can distinguish approved-vs-effective vs raw-input drift.
   * Format: `'sha256:<hex>'`.
   */
  effectiveEnvelopeHash?: string;
  /**
   * v0.5: Canonicalization scheme version used to compute effectiveEnvelopeHash. Must
   * equal preAction.canonicalizationVersion. Mismatched versions fail closed at sign
   * time and at verify time unless an explicit migration verifier is selected.
   */
  canonicalizationVersion?: CanonicalizationVersion;
  /**
   * v0.6: SHA-256 hash of the canonicalizer profile under which `effectiveEnvelopeHash`
   * was computed. Only set when `phase === 'executed'` AND the pre-action carries
   * `canonicalizerProfileHash`. Sign-time invariant: must equal
   * `preAction.canonicalizerProfileHash`. Drift here is named `profile_incompatible` —
   * authority was minted under profile A but execution sealed against profile B.
   * Format: `'sha256:<hex>'`.
   */
  canonicalizerProfileHash?: string;
  // Chain
  previousReceiptHash: string;       // REQUIRED: hash of preAction without signature
  signature?: AARSignature;
}

/** @deprecated Use AARTerminalReceipt instead */
export type AARPostAction = AARTerminalReceipt;

export interface ChainVerificationResult {
  intact: boolean;
  chainIntegrity: 'complete' | 'incomplete' | 'broken';
  breaks: Array<{ id: string; expected: string | undefined; actual: string | undefined }>;
}

// ─── v0.6 Canonicalizer accountability — three-hash decomposition ─────────────

/**
 * v0.6: A declared canonicalizer profile. Names what envelope fields the canonicalizer
 * preserves, what it excludes, and what normalization rules it applies. The profile is
 * a pure data record — `normalizationRules` is declared data (e.g. `{ caseSensitive: true }`),
 * NOT an environment lookup. The canonicalizer is a pure function of `(envelope, profile)`.
 *
 * `profileHash` is SHA-256 over canonical JSON of the other fields (excluding
 * `profileHash` itself). Profile semantics drift becomes explicit because changing any
 * field changes the hash → it is a different profile id, not the same profile in a new
 * environment.
 */
export interface CanonicalizerProfile {
  profileId: string;                               // human-readable: 'http.v1', 'fs.v1', 'db.v1'
  version: string;                                 // semver string
  toolFamily: string;                              // 'http' | 'fs' | 'db' | custom string
  /** Fields the canonicalizer preserves into the envelope hash. Sorted, stable. */
  includedConsequentialFields: string[];
  /** Fields explicitly excluded as non-consequential. Sorted, stable. */
  excludedFields: string[];
  /**
   * Declared normalization rules. Keys are field names from `includedConsequentialFields`.
   * Values are pure data (e.g. `{ caseSensitive: true, percentEncoded: true }`). No
   * environment lookup — host migration cannot silently change these.
   */
  normalizationRules: Record<string, unknown>;
  /** SHA-256 over canonical JSON of the other fields. Format: 'sha256:<hex>'. */
  profileHash: string;
  /**
   * Optional migration metadata. When present, declares that this profile version can be
   * cross-replayed from `fromVersion` via the registered migration function (out-of-band).
   */
  migrationVerifier?: {
    fromVersion: string;
    toVersion: string;
  };
}

/**
 * v0.6: A declared policy surface. Names which envelope fields the policy actually
 * gates on. Decoupled from the canonicalizer profile so the two can evolve
 * independently. `surfaceHash` is SHA-256 over canonical JSON of `(policyRef, gatedFields)`.
 */
export interface PolicySurface {
  policyRef: string;
  /** Sorted, stable. The set of envelope fields the policy decision depends on. */
  gatedFields: string[];
  /** SHA-256 over canonical JSON of `(policyRef, gatedFields)`. Format: 'sha256:<hex>'. */
  surfaceHash: string;
}

/**
 * v0.6: A registered compatibility binding between a policy surface and a canonicalizer
 * profile. Exists only after `register()` verifies that every gated field is preserved
 * by the profile — that is, `policy.gatedFields ⊆ profile.includedConsequentialFields`.
 * `bindingHash` is SHA-256 over canonical JSON of `(policySurfaceHash, canonicalizerProfileHash)`.
 *
 * `beginAction()` looks up the binding by `(policySurfaceHash, canonicalizerProfileHash)`
 * — absence is a structural refusal (`unbound_policy_profile`), no AAR is minted.
 */
export interface PolicyProfileBinding {
  policySurfaceHash: string;
  canonicalizerProfileHash: string;
  bindingHash: string;
}

/**
 * v0.6: Registry of compatibility bindings. Default in-memory implementation is
 * exported from `@agentlair/audit-logger` as `InMemoryPolicyProfileBindingRegistry`.
 * External registries (e.g. backed by AgentLair) implement the same interface.
 */
export interface PolicyProfileBindingRegistry {
  /**
   * Verify compatibility and register the binding. Throws if any gated field is absent
   * from the profile's included consequential fields. Returns the registered binding.
   */
  register(surface: PolicySurface, profile: CanonicalizerProfile): Promise<PolicyProfileBinding>;
  /** Lookup an existing binding by hash. Returns undefined if not registered. */
  lookup(
    policySurfaceHash: string,
    canonicalizerProfileHash: string,
  ): Promise<PolicyProfileBinding | undefined>;
}
