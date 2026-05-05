/**
 * PoPA v2 Controller Check — verifies that an authenticated account is
 * authorised to enroll/revoke a given DID in PoPA.
 *
 * Two acceptance paths:
 *
 *   1. Self-issued: the DID is `did:web:agentlair.dev:agents:<account.id>` —
 *      AgentLair issued it to this account, so the account controls it.
 *      No network round-trip needed.
 *
 *   2. Externally controlled: the DID resolves to a DID Document whose
 *      `verificationMethod[].controller` field includes the caller's
 *      AgentLair DID. The DID owner has delegated control by listing the
 *      caller as a controller in their published did.json.
 *
 * Anything else returns `not_controller` (caller is authenticated but does
 * not control the DID) or `unresolvable` (the DID's did.json is missing or
 * malformed).
 *
 * `did:key:*` is not supported in this cut: did:key has no document to
 * publish a controller in, so verifying control requires a separate
 * proof-of-possession flow (out of scope for v2 enrollment).
 */

const ISSUER_DOMAIN = 'agentlair.dev';

export type ControllerCheckResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported_did' | 'invalid_did' | 'unresolvable' | 'not_controller'; detail?: string };

/**
 * Build the AgentLair-issued DID for an account.
 */
export function agentLairDidFor(accountId: string): string {
  return `did:web:${ISSUER_DOMAIN}:agents:${accountId}`;
}

/**
 * Convert a `did:web` identifier to the resolution URL per W3C DID Web spec.
 *
 *   did:web:host                       → https://host/.well-known/did.json
 *   did:web:host:path:to               → https://host/path/to/did.json
 *   did:web:host%3A8443                → https://host:8443/.well-known/did.json
 */
export function didWebToUrl(did: string): string | null {
  if (!did.startsWith('did:web:')) return null;
  const rest = did.slice('did:web:'.length);
  if (rest.length === 0) return null;
  const segments = rest.split(':').map((s) => decodeURIComponent(s));
  const host = segments[0];
  if (!host || !/^[A-Za-z0-9.\-:]+$/.test(host)) return null;
  if (segments.length === 1) {
    return `https://${host}/.well-known/did.json`;
  }
  // Reject empty path segments — they would collapse to // in the URL
  for (let i = 1; i < segments.length; i++) {
    if (!segments[i]) return null;
    // Path segments are constrained — refuse anything that would let a
    // crafted DID escape into another origin.
    if (segments[i].includes('/')) return null;
  }
  const path = segments.slice(1).map(encodeURIComponent).join('/');
  return `https://${host}/${path}/did.json`;
}

interface DidDocVM {
  id?: string;
  type?: string;
  controller?: string | string[];
  // other fields ignored
}

interface MinimalDidDoc {
  id?: string;
  controller?: string | string[];
  verificationMethod?: DidDocVM[];
}

/**
 * Pull every controller string out of a DID document — the document-level
 * `controller` plus each verificationMethod's `controller`.
 */
function collectControllers(doc: MinimalDidDoc): Set<string> {
  const out = new Set<string>();
  const push = (v: string | string[] | undefined): void => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && out.add(x));
  };
  push(doc.controller);
  for (const vm of doc.verificationMethod ?? []) {
    push(vm.controller);
  }
  return out;
}

/**
 * Verify that `accountId` controls `agentDid`.
 *
 * Network: at most one fetch to the DID's well-known location. 5s timeout —
 * a slow upstream must not stall the enrollment endpoint indefinitely.
 *
 * The `fetchImpl` parameter exists for testing; production passes
 * `globalThis.fetch`.
 */
export async function checkController(
  agentDid: string,
  accountId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ControllerCheckResult> {
  const callerDid = agentLairDidFor(accountId);

  // Fast path: the caller's own AgentLair-issued DID
  if (agentDid === callerDid) return { ok: true };

  // Short-circuit AgentLair-issued DIDs that don't match the caller. We control
  // the issuance namespace (did:web:agentlair.dev:agents:acc_*), so a non-match
  // here is definitionally "not the caller's DID" — no need to fetch did.json
  // (which would trigger a self-call to our own /agents/:id/did.json route and
  // run into Workers subrequest limits when called from inside the same worker).
  if (/^did:web:agentlair\.dev:agents:acc_[A-Za-z0-9_-]+$/.test(agentDid)) {
    return { ok: false, reason: 'not_controller' };
  }

  // did:key is not supported in v2 — needs a PoP flow we have not built.
  if (agentDid.startsWith('did:key:')) {
    return { ok: false, reason: 'unsupported_did', detail: 'did:key requires proof-of-possession (not implemented).' };
  }

  // Only did:web beyond this point.
  const url = didWebToUrl(agentDid);
  if (!url) return { ok: false, reason: 'invalid_did' };

  let res: Response;
  try {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 5000);
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/did+json, application/json' },
        signal: ac.signal,
        // Don't follow cross-origin redirects — a malicious did.json must
        // come from the host the DID names.
        redirect: 'manual',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'unresolvable',
      detail: e instanceof Error ? e.message.slice(0, 120) : 'fetch_failed',
    };
  }

  if (!res.ok) {
    return { ok: false, reason: 'unresolvable', detail: `HTTP ${res.status}` };
  }

  let doc: MinimalDidDoc;
  try {
    doc = (await res.json()) as MinimalDidDoc;
  } catch {
    return { ok: false, reason: 'unresolvable', detail: 'invalid_json' };
  }

  // Sanity: the DID document MUST self-identify with the same DID, otherwise
  // anyone could publish a did.json claiming to control someone else's DID.
  if (typeof doc.id !== 'string' || doc.id !== agentDid) {
    return { ok: false, reason: 'unresolvable', detail: 'doc_id_mismatch' };
  }

  const controllers = collectControllers(doc);
  if (controllers.has(callerDid)) return { ok: true };

  return { ok: false, reason: 'not_controller' };
}
