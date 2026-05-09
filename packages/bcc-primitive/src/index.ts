/**
 * @agentlair/bcc-primitive — TS Verifier SDK
 *
 * Unified verifyBCC() function that wraps both the AgentLair and Commit
 * verifier endpoints, returning a consistent BCCResolution shape regardless
 * of which surface issued the credential.
 *
 * @example
 * ```ts
 * import { verifyBCC } from "@agentlair/bcc-primitive";
 *
 * // Verify an agent credential (AgentLair-issued)
 * const result = await verifyBCC("cred_abc123", { source: "agentlair" });
 * console.log(result.valid, result.oracle_state); // true, "active"
 *
 * // Verify a human/business credential (Commit-issued)
 * const result2 = await verifyBCC("cred_xyz789", { source: "commit" });
 * console.log(result2.profile, result2.stake.medium); // "BCC-Capital", "capital"
 * ```
 */

export type {
  BCCResolution,
  BCCProfile,
  StakeMedium,
  OracleState,
  EvidenceItem,
  VerifyBCCOptions,
  AgentLairBCCResponse,
  CommitTrustResponse,
} from "./types.js";

import type {
  BCCResolution,
  BCCProfile,
  StakeMedium,
  OracleState,
  EvidenceItem,
  VerifyBCCOptions,
  AgentLairBCCResponse,
  CommitTrustResponse,
} from "./types.js";

const AGENTLAIR_BASE = "https://agentlair.dev";
const COMMIT_BASE    = "https://commit-backend.fly.dev";

// -------------------------------------------------------------------------
// Adapter: Commit verifier response → BCCResolution
// -------------------------------------------------------------------------

function isValidProfile(v: unknown): v is BCCProfile {
  return (
    v === "BCC-Capital" || v === "BCC-Claims" || v === "BCC-Existence"
  );
}

function isValidOracleState(v: unknown): v is OracleState {
  return (
    v === "active" || v === "slashed" || v === "expired" || v === "self_revealing"
  );
}

function isValidStakeMedium(v: unknown): v is StakeMedium {
  return v === "capital" || v === "claims" || v === "existence";
}

/**
 * Adapt a Commit trust response to the unified BCCResolution shape.
 * Fields missing from the Commit response are filled from sane defaults
 * and a warning is logged.
 */
function adaptCommitResponse(
  credentialId: string,
  raw: CommitTrustResponse,
): BCCResolution {
  const missing: string[] = [];

  const profile = isValidProfile(raw.profile) ? raw.profile : (() => {
    missing.push("profile");
    return "BCC-Capital" as BCCProfile;
  })();

  const oracle_state = isValidOracleState(raw.oracle_state) ? raw.oracle_state : (() => {
    missing.push("oracle_state");
    return "active" as OracleState;
  })();

  const medium = isValidStakeMedium(raw.stake?.medium) ? raw.stake!.medium! : (() => {
    missing.push("stake.medium");
    return "capital" as StakeMedium;
  })();

  const evidence_chain: EvidenceItem[] = (raw.evidence_chain ?? []).map((item, i) => {
    if (!item.type || !item.ref || !item.timestamp) {
      missing.push(`evidence_chain[${i}]`);
    }
    return {
      type:      (item.type as "scitt_entry" | "onchain_tx") ?? "onchain_tx",
      ref:       item.ref ?? "",
      timestamp: item.timestamp ?? new Date().toISOString(),
    };
  });

  if (missing.length > 0) {
    console.warn(
      `[bcc-primitive] Commit verifier response missing fields: ${missing.join(", ")}. ` +
      `Filled with sane defaults. credential_id=${credentialId}`
    );
  }

  return {
    credential_id: raw.credential_id ?? raw.id ?? credentialId,
    valid:         raw.valid ?? false,
    profile,
    stake: {
      medium,
      amount: raw.stake?.amount ?? null,
      unit:   raw.stake?.unit   ?? null,
    },
    oracle_state,
    evidence_chain,
    issuer:  raw.issuer ?? "",
    subject: raw.subject ?? raw.entity_id ?? "",
    window: {
      start: raw.window?.start ?? "",
      end:   raw.window?.end   ?? null,
    },
  };
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Verify a BCC credential from either the AgentLair or Commit verifier.
 *
 * @param credentialId  The credential ID to resolve.
 * @param opts          Source selection and optional config.
 * @returns             Unified BCCResolution shape.
 * @throws              On 404 (not found), 410 (revoked), or network errors.
 */
export async function verifyBCC(
  credentialId: string,
  opts: VerifyBCCOptions,
): Promise<BCCResolution> {
  const fetchFn = opts.fetchFn ?? fetch;

  if (opts.source === "agentlair") {
    const url = `${AGENTLAIR_BASE}/v1/bcc/${encodeURIComponent(credentialId)}`;
    const res = await fetchFn(url, {
      headers: { Accept: "application/json" },
    });

    if (res.status === 404) throw new Error(`BCC not found: ${credentialId}`);
    if (res.status === 410) throw new Error(`BCC revoked: ${credentialId}`);
    if (!res.ok) throw new Error(`AgentLair verifier error: HTTP ${res.status}`);

    const body = (await res.json()) as AgentLairBCCResponse;
    // AgentLair response already conforms to BCCResolution — cast directly.
    return body as BCCResolution;
  }

  if (opts.source === "commit") {
    const kind = opts.commitKind ?? "bcc";
    const url = `${COMMIT_BASE}/trust/${encodeURIComponent(kind)}/${encodeURIComponent(credentialId)}`;
    const res = await fetchFn(url, {
      headers: { Accept: "application/json" },
    });

    if (res.status === 404) throw new Error(`Commit trust not found: ${credentialId}`);
    if (res.status === 410) throw new Error(`Commit trust revoked: ${credentialId}`);
    if (!res.ok) throw new Error(`Commit verifier error: HTTP ${res.status}`);

    const raw = (await res.json()) as CommitTrustResponse;
    return adaptCommitResponse(credentialId, raw);
  }

  throw new Error(`Unknown source: ${(opts as VerifyBCCOptions).source}`);
}
