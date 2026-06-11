/**
 * Act-binding — VENDORED from DashClaw (issue ucsandman/DashClaw#121, Phase 2c).
 *
 * Upstream: github.com/ucsandman/DashClaw at app/lib/act-binding.ts
 *   - Module commit:       cb55249039724c0fc78a5763b27d5897d9c85682  (TS migration v4.2.1)
 *   - Wire-format anchor:  ed879cf8b2355230b4420ae680da397e823f8321  (9 frozen vectors locked)
 *   - Vendor-import date:  2026-06-09
 *
 * Why vendored, not reimplemented:
 *   The act-binding property is "issuer and verifier hash the same bytes."
 *   AgentLair is the ISSUER; DashClaw is the canonical VERIFIER. If either
 *   half drifts on canonicalization or digest encoding, the binding fails
 *   open on every legitimate call. The frozen 9-vector test suite (mirrored
 *   in ./act-binding.test.ts) fails the same way on both sides if either
 *   drifts — that is the only durable guarantee against drift.
 *
 * MAINTENANCE RULES:
 *   1. DO NOT edit this module. Re-vendor from upstream when DashClaw bumps
 *      the wire format (signaled by a new `typ` suffix, e.g. `action-binding/v2`).
 *   2. When re-vendoring, update the SHAs above AND re-derive vectors in the
 *      sibling test file from the new upstream test file. Both halves move
 *      together or interop drifts.
 *   3. The verifier helpers (getActBindingMode, getSupportedTyps,
 *      parseActBinding, resolveActStatus) are unused on the issuer side but
 *      are kept verbatim so the module stays byte-identical to upstream —
 *      this lets a future symmetric verifier (e.g. an AgentLair-side guard)
 *      land without divergence.
 *   4. `node:crypto` works in Cloudflare Workers because
 *      compatibility_flags = ["nodejs_compat"] is set in wrangler.toml. If
 *      that flag is ever removed, this module breaks and the test suite
 *      catches it at `bun test` boundary first.
 *
 * Wire claim (namespaced, dodges the RFC 8693 `act` collision):
 *
 *   "urn:dashclaw:act-binding": {
 *     "typ":  "action-binding/v1",
 *     "hash": "sha256:<base64url-digest>"
 *   }
 *
 * Issuer integration: see ../routes/tokens.ts — POST /v1/tokens/issue accepts
 * an optional `act_binding: { action, target, goal }` block. The literal three
 * strings are the SDK boundary; do not invent a bind(intent) wrapper as the
 * canonical input.
 *
 * ─── UPSTREAM SOURCE BEGINS BELOW (do not edit) ──────────────────────────────
 *
 * Phase 2 verifies *who* signed a token. Phase 2b stops *reusing* one. Phase 2c
 * narrows *what* a single token can do: an issuer commits the token to one
 * intended (action, target, goal) tuple at mint time, and the guard records
 * whether the incoming call matches — so a token minted to `read` a record
 * can't be repurposed to `delete` a different one (e.g. by a prompt-injected
 * agent holding an over-broad token).
 *
 * This module is the SINGLE SOURCE OF TRUTH for canonicalization + digest. The
 * issuer (which mints the claim) and the verifier (which recomputes it) must
 * agree byte-for-byte, so both sides go through here. It exists as its own file
 * precisely so those two halves cannot drift.
 *
 * Digest — a constrained RFC 8785 (JSON Canonicalization Scheme) profile with
 * string-only, NFC-normalized values and lexicographically ordered keys.
 */

import { createHash } from 'node:crypto';

// Namespaced claim name. Deliberately NOT `act` — see module header.
export const ACT_BINDING_CLAIM = 'urn:dashclaw:act-binding';

// Default accepted `typ`. Schema evolution rides on the suffix.
const DEFAULT_TYP = 'action-binding/v1';

const MODES = ['off', 'best_effort', 'required'] as const;
export type ActBindingMode = (typeof MODES)[number];

export type ActStatus =
  | 'not_applicable'
  | 'not_present'
  | 'unsupported_typ'
  | 'ctx_incomplete'
  | 'match'
  | 'mismatch';

interface ActBinding {
  typ: string;
  hash: string;
}

interface ActVerification {
  verification_status?: string;
  act?: ActBinding | null;
  act_typ_supported?: boolean;
}

interface ActContext {
  action_type?: string;
  target?: string;
  declared_goal?: string;
}

/**
 * Enforcement mode. Default `off`: act-binding needs issuer cooperation that
 * doesn't exist yet, so defaulting to anything stricter would tag every
 * legitimate verified token `not_present`.
 */
export function getActBindingMode(): ActBindingMode {
  const raw = (process.env.DASHCLAW_ACT_BINDING || 'off').toLowerCase();
  return (MODES as readonly string[]).includes(raw) ? (raw as ActBindingMode) : 'off';
}

/**
 * Accepted `typ` values (comma-separated env, defaults to action-binding/v1).
 */
export function getSupportedTyps(): string[] {
  const raw = process.env.DASHCLAW_ACT_BINDING_TYP || DEFAULT_TYP;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Canonicalize the (action, target, goal) tuple to the exact byte string the
 * digest is taken over. Both issuer and guard call this so the bytes match.
 *
 * Throws an error with `code: 'CTX_INCOMPLETE'` when any field is missing or
 * not a non-empty string.
 */
export function canonicalizeActionTuple(
  { action, target, goal }: { action?: string; target?: string; goal?: string } = {},
): string {
  if (typeof action !== 'string' || action.length === 0) {
    throw Object.assign(new Error('canonicalizeActionTuple: action must be a non-empty string'), { code: 'CTX_INCOMPLETE' });
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw Object.assign(new Error('canonicalizeActionTuple: target must be a non-empty string'), { code: 'CTX_INCOMPLETE' });
  }
  if (typeof goal !== 'string' || goal.length === 0) {
    throw Object.assign(new Error('canonicalizeActionTuple: goal must be a non-empty string'), { code: 'CTX_INCOMPLETE' });
  }
  // Keys inserted in lexicographic order (action < goal < target). Values are
  // NFC-normalized per spec.
  const ordered = {
    action: action.normalize('NFC'),
    goal: goal.normalize('NFC'),
    target: target.normalize('NFC'),
  };
  return JSON.stringify(ordered);
}

/**
 * "sha256:" + base64url(sha256(utf8(canonical))).
 *
 * CF Workers compat note (2026-06-11): Bun's browser-target polyfill for
 * node:crypto does not implement digest('base64url') — the string literal
 * passes through unrecognised, causing a 500 in production. The standard
 * base64url alphabet is base64 with + → -, / → _, padding stripped. The
 * hash bytes are identical; only the encoding path differs. This patch is
 * intentionally minimal and does NOT change the wire format.
 */
export function computeActBindingHash(tuple: { action?: string; target?: string; goal?: string }): string {
  const canonical = canonicalizeActionTuple(tuple);
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Parse the binding claim from a JWT payload. The caller MUST have already
 * verified the signature — this only reads, it does not trust.
 *
 * A present-but-malformed claim is treated as absent (`act: null`).
 */
export function parseActBinding(payload: Record<string, unknown> | null | undefined): {
  act: ActBinding | null;
  actTypSupported: boolean;
} {
  const raw = payload?.[ACT_BINDING_CLAIM] as { typ?: unknown; hash?: unknown } | null | undefined;
  if (
    raw == null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.typ !== 'string' ||
    typeof raw.hash !== 'string'
  ) {
    return { act: null, actTypSupported: false };
  }
  return {
    act: { typ: raw.typ, hash: raw.hash },
    actTypSupported: getSupportedTyps().includes(raw.typ),
  };
}

/**
 * Resolve act_status for a guard call. Pure and mode-independent: the mode
 * governs only the *block* decision (in guard.js), never the status itself.
 */
export function resolveActStatus(verification: ActVerification | null | undefined, ctx: ActContext): ActStatus {
  // Binding only means anything on a cryptographically verified token.
  if (!verification || verification.verification_status !== 'verified') return 'not_applicable';
  if (!verification.act) return 'not_present';
  if (!verification.act_typ_supported) return 'unsupported_typ';

  let computed: string;
  try {
    computed = computeActBindingHash({
      action: ctx.action_type,
      target: ctx.target,
      goal: ctx.declared_goal,
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'CTX_INCOMPLETE') return 'ctx_incomplete';
    throw err;
  }
  return verification.act.hash === computed ? 'match' : 'mismatch';
}

/**
 * `typ` constant exported for the issuer side. The issuer emits this string;
 * the verifier accepts it (and any future variant listed in
 * DASHCLAW_ACT_BINDING_TYP). Keeping them in one module guarantees the issuer
 * cannot accidentally mint a `typ` the verifier won't recognise.
 */
export const ACT_BINDING_TYP_V1 = DEFAULT_TYP;
