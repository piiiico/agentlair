/**
 * Transparency Service — Durable Object
 *
 * Maintains a single serialized Merkle tree (RFC 9162) for SCITT Receipt issuance.
 * Solves the per-isolate hash chain bug by serializing all append operations
 * through a single DO instance.
 *
 * Architecture:
 *   Worker → DO.fetch(POST /append) → leaf added to Merkle tree
 *                                    → inclusion proof computed
 *                                    → Receipt (COSE_Sign1) issued
 *                                    → Receipt + tree metadata stored in D1
 *
 * SCITT compliance:
 *   - Receipts contain RFC 9162 SHA-256 inclusion proofs
 *   - VDS type: RFC9162_SHA256 (COSE label 395 = 1)
 *   - VDS proofs: [tree_size, leaf_index, [path...]] (COSE label 396)
 *   - Receipt = COSE_Sign1 with detached payload
 *
 * References:
 *   - draft-ietf-scitt-architecture-22 §7 (Transparent Statements)
 *   - RFC 9162 §2 (Merkle Tree)
 *   - draft-ietf-cose-merkle-tree-proofs (COSE labels 394-396)
 */

import {
  cborUint, cborNegint, cborBytes, cborText,
  cborArray, cborMap, cborTag,
} from '../caf-scitt.js';
import { ed25519 } from '@noble/curves/ed25519.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** COSE label: algorithm */
const HDR_ALG = 1;
/** COSE label: VDS type (draft-ietf-cose-merkle-tree-proofs) */
const HDR_VDS_TYPE = 395;
/** COSE label: VDS proofs (draft-ietf-cose-merkle-tree-proofs) */
const HDR_VDS_PROOFS = 396;
/** VDS type value: RFC 9162 SHA-256 */
const VDS_RFC9162_SHA256 = 1;
/** COSE algorithm: EdDSA */
const ALG_EDDSA = -8;
/** CBOR tag for COSE_Sign1 */
const TAG_COSE_SIGN1 = 18;

// ─── RFC 9162 Merkle Tree ────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash (returns raw bytes).
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Cast to BufferSource: strict DOM types require Uint8Array<ArrayBuffer>,
  // but @noble/curves and Workers runtime use the broader Uint8Array<ArrayBufferLike>.
  // Workers runtime accepts both — the cast is safe (no SharedArrayBuffer in Workers).
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(buf);
}

/**
 * RFC 9162 §2.1: Hash of a leaf node.
 * MTH({d(0)}) = SHA-256(0x00 || d(0))
 */
export async function leafHash(data: Uint8Array): Promise<Uint8Array> {
  const prefixed = new Uint8Array(1 + data.length);
  prefixed[0] = 0x00;
  prefixed.set(data, 1);
  return sha256(prefixed);
}

/**
 * RFC 9162 §2.1: Hash of an internal node.
 * MTH(D[n]) = SHA-256(0x01 || MTH(D[0:k]) || MTH(D[k:n]))
 */
export async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  const prefixed = new Uint8Array(1 + 32 + 32);
  prefixed[0] = 0x01;
  prefixed.set(left, 1);
  prefixed.set(right, 33);
  return sha256(prefixed);
}

/**
 * Compute the Merkle inclusion proof for a leaf at `leafIndex` in a tree of `treeSize` leaves.
 * Uses the stored hashes from the tree state.
 *
 * Returns an array of 32-byte sibling hashes from leaf to root.
 */
export function computeInclusionProof(
  leafIndex: number,
  treeSize: number,
  nodeHashes: Map<string, Uint8Array>,
): Uint8Array[] {
  const proof: Uint8Array[] = [];
  let index = leafIndex;
  let size = treeSize;
  let level = 0;

  while (size > 1) {
    const siblingIndex = index ^ 1;  // XOR to get sibling
    if (siblingIndex < size) {
      const key = `${level}:${siblingIndex}`;
      const hash = nodeHashes.get(key);
      if (hash) proof.push(hash);
    }
    index = Math.floor(index / 2);
    size = Math.ceil(size / 2);
    level++;
  }

  return proof;
}

// ─── Receipt Builder ─────────────────────────────────────────────────────────

/**
 * Build a SCITT Receipt as COSE_Sign1 with detached payload.
 *
 * Receipt structure (draft-ietf-scitt-architecture §7.2):
 *   COSE_Sign1 {
 *     protected: { alg: EdDSA, 395: 1 (RFC9162_SHA256), 396: proofs },
 *     unprotected: {},
 *     payload: nil (detached),
 *     signature: Ed25519(Sig_Structure)
 *   }
 *
 * The VDS proofs (label 396) encode:
 *   [tree_size, leaf_index, [inclusion_path_hashes...]]
 */
export function buildReceipt(opts: {
  treeSize: number;
  leafIndex: number;
  inclusionPath: Uint8Array[];
  signingKey: Uint8Array;
}): Uint8Array {
  // VDS proofs: CBOR array [tree_size, leaf_index, [path...]]
  const pathArray = cborArray(opts.inclusionPath.map(h => cborBytes(h)));
  const vdsProofs = cborArray([
    cborUint(opts.treeSize),
    cborUint(opts.leafIndex),
    pathArray,
  ]);

  // Protected header
  const protectedMap = cborMap([
    [cborUint(HDR_ALG), cborNegint(ALG_EDDSA)],
    [cborUint(HDR_VDS_TYPE), cborUint(VDS_RFC9162_SHA256)],
    [cborUint(HDR_VDS_PROOFS), vdsProofs],
  ]);
  const protectedBytes = protectedMap;

  // Sig_Structure for detached payload (payload = empty bstr for signing)
  // "Signature1" / protected / external_aad / payload
  const sigStructure = cborArray([
    cborText('Signature1'),
    cborBytes(protectedBytes),
    cborBytes(new Uint8Array(0)),  // external_aad
    cborBytes(new Uint8Array(0)),  // nil payload (detached)
  ]);

  // Sign
  const signature = ed25519.sign(sigStructure, opts.signingKey);

  // Assemble COSE_Sign1 with nil payload
  // CBOR null = 0xf6 for detached payload
  const nullByte = new Uint8Array([0xf6]);
  const coseSign1 = cborArray([
    cborBytes(protectedBytes),
    cborMap([]),        // unprotected: empty
    nullByte,          // payload: null (detached)
    cborBytes(signature),
  ]);

  return cborTag(TAG_COSE_SIGN1, coseSign1);
}

// ─── Durable Object ──────────────────────────────────────────────────────────

interface AppendRequest {
  signedStatement: string;  // base64
  entryId: string;
}

interface AppendResponse {
  receipt: string;   // base64
  leafIndex: number;
  treeSize: number;
  rootHash: string;
}

/**
 * TransparencyService Durable Object
 *
 * Maintains a single Merkle tree. All writes are serialized through this DO.
 * One instance per account (or global singleton for simplicity).
 *
 * Uses the fetch() API pattern (same as InboxNotifier):
 *   POST /append — add a Signed Statement, return Receipt
 *   GET  /info   — return tree metadata
 *   GET  /receipt/:entryId — return a stored receipt
 */
export class TransparencyService {
  // Note: DurableObjectState parameter is required by the DO interface but not
  // retained — this DO uses pure in-memory state (treeSize, nodeHashes) plus D1
  // for persistence. No state.storage usage; no WebSocket Hibernation.
  private env: { AUDIT: D1Database; AUDIT_SIGNING_KEY: string };

  private treeSize: number = 0;
  private nodeHashes: Map<string, Uint8Array> = new Map();
  private initialized: boolean = false;

  constructor(_state: DurableObjectState, env: { AUDIT: D1Database; AUDIT_SIGNING_KEY: string }) {
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /append — register a Signed Statement
    if (request.method === 'POST' && url.pathname === '/append') {
      try {
        const body = await request.json() as AppendRequest;
        const signedStatement = base64ToArray(body.signedStatement);
        const result = await this.append(signedStatement, body.entryId);
        return new Response(JSON.stringify({
          receipt: arrayToBase64(result.receipt),
          leafIndex: result.leafIndex,
          treeSize: result.treeSize,
          rootHash: result.rootHash,
        } satisfies AppendResponse), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /info — tree metadata
    if (request.method === 'GET' && url.pathname === '/info') {
      const info = await this.getTreeInfo();
      return new Response(JSON.stringify(info), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /receipt/:entryId
    if (request.method === 'GET' && url.pathname.startsWith('/receipt/')) {
      const entryId = url.pathname.slice('/receipt/'.length);
      const receipt = await this.getReceipt(entryId);
      if (!receipt) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(JSON.stringify({ receipt: arrayToBase64(receipt) }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // ─── Core logic ────────────────────────────────────────────────────────────

  /**
   * Load tree state from D1 on first access.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      const result = await this.env.AUDIT
        .prepare('SELECT tree_size, nodes_json FROM scitt_tree_state WHERE id = ? LIMIT 1')
        .bind('global')
        .first<{ tree_size: number; nodes_json: string }>();

      if (result) {
        this.treeSize = result.tree_size;
        const nodes: Record<string, string> = JSON.parse(result.nodes_json);
        for (const [key, hexHash] of Object.entries(nodes)) {
          this.nodeHashes.set(key, hexToBytes(hexHash));
        }
      }
    } catch {
      // Table may not exist yet — start fresh
      this.treeSize = 0;
      this.nodeHashes = new Map();
    }

    this.initialized = true;
  }

  /**
   * Persist tree state to D1.
   */
  private async persistState(): Promise<void> {
    const nodesObj: Record<string, string> = {};
    for (const [key, hash] of this.nodeHashes) {
      nodesObj[key] = bytesToHex(hash);
    }

    await this.env.AUDIT
      .prepare('INSERT OR REPLACE INTO scitt_tree_state (id, tree_size, nodes_json, updated_at) VALUES (?, ?, ?, ?)')
      .bind('global', this.treeSize, JSON.stringify(nodesObj), new Date().toISOString())
      .run();
  }

  /**
   * Append a Signed Statement to the Merkle tree and return a Receipt.
   */
  private async append(signedStatement: Uint8Array, entryId: string): Promise<{
    receipt: Uint8Array;
    leafIndex: number;
    treeSize: number;
    rootHash: string;
  }> {
    await this.ensureInitialized();

    // Compute leaf hash (RFC 9162 §2.1)
    const leaf = await leafHash(signedStatement);
    const leafIndex = this.treeSize;

    // Store leaf at level 0
    this.nodeHashes.set(`0:${leafIndex}`, leaf);
    this.treeSize++;

    // Rebuild affected internal nodes (from leaf up to root)
    await this.rebuildPath(leafIndex);

    // Compute inclusion proof
    const inclusionPath = computeInclusionProof(leafIndex, this.treeSize, this.nodeHashes);

    // Get signing key
    const signingKey = Uint8Array.from(atob(this.env.AUDIT_SIGNING_KEY), c => c.charCodeAt(0));

    // Build Receipt
    const receipt = buildReceipt({
      treeSize: this.treeSize,
      leafIndex,
      inclusionPath,
      signingKey,
    });

    // Compute root hash for storage
    const rootHash = await this.computeRoot();

    // Store receipt in D1
    await this.env.AUDIT
      .prepare('INSERT INTO scitt_receipts (entry_id, leaf_index, tree_size, root_hash, receipt_cbor, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(entryId, leafIndex, this.treeSize, bytesToHex(rootHash), arrayToBase64(receipt), new Date().toISOString())
      .run();

    // Persist tree state
    await this.persistState();

    return {
      receipt,
      leafIndex,
      treeSize: this.treeSize,
      rootHash: bytesToHex(rootHash),
    };
  }

  /**
   * Rebuild internal nodes along the path from a leaf to the root.
   */
  private async rebuildPath(leafIndex: number): Promise<void> {
    let index = leafIndex;
    let size = this.treeSize;
    let level = 0;

    while (size > 1) {
      const left = index & ~1;
      const right = left + 1;

      const leftKey = `${level}:${left}`;
      const rightKey = `${level}:${right}`;

      const leftHash = this.nodeHashes.get(leftKey);
      if (leftHash && right < size) {
        const rightHash = this.nodeHashes.get(rightKey);
        if (rightHash) {
          const parent = await nodeHash(leftHash, rightHash);
          const parentIndex = Math.floor(left / 2);
          this.nodeHashes.set(`${level + 1}:${parentIndex}`, parent);
        }
      } else if (leftHash) {
        const parentIndex = Math.floor(left / 2);
        this.nodeHashes.set(`${level + 1}:${parentIndex}`, leftHash);
      }

      index = Math.floor(index / 2);
      size = Math.ceil(size / 2);
      level++;
    }
  }

  /**
   * Compute the current root hash of the tree.
   */
  private async computeRoot(): Promise<Uint8Array> {
    if (this.treeSize === 0) return new Uint8Array(32);
    if (this.treeSize === 1) return this.nodeHashes.get('0:0') || new Uint8Array(32);

    let maxLevel = 0;
    for (const key of this.nodeHashes.keys()) {
      const level = parseInt(key.split(':')[0], 10);
      if (level > maxLevel) maxLevel = level;
    }

    return this.nodeHashes.get(`${maxLevel}:0`) || new Uint8Array(32);
  }

  /**
   * Get current tree metadata.
   */
  private async getTreeInfo(): Promise<{ treeSize: number; rootHash: string }> {
    await this.ensureInitialized();
    const root = await this.computeRoot();
    return { treeSize: this.treeSize, rootHash: bytesToHex(root) };
  }

  /**
   * Get a receipt for an existing entry.
   */
  private async getReceipt(entryId: string): Promise<Uint8Array | null> {
    const result = await this.env.AUDIT
      .prepare('SELECT receipt_cbor FROM scitt_receipts WHERE entry_id = ? LIMIT 1')
      .bind(entryId)
      .first<{ receipt_cbor: string }>();

    if (!result) return null;
    return base64ToArray(result.receipt_cbor);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function arrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

function base64ToArray(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
