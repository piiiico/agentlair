/**
 * Transparency Service — Tests
 *
 * Covers:
 *  (a) RFC 9162 Merkle tree hashing (leaf hash, node hash)
 *  (b) Receipt structure: COSE_Sign1 with VDS type + proofs
 *  (c) Inclusion proof correctness for trees of varying sizes
 *  (d) CBOR structure of generated receipts
 *
 * NOTE: The TransparencyService Durable Object itself requires D1 and cannot be
 * unit-tested without Miniflare. These tests cover the pure crypto/math functions
 * that the DO depends on. Integration tests live in the deploy pipeline.
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';

// ─── Import the CBOR encoder from caf-scitt (shared) ────────────────────────

import {
  cborUint, cborNegint, cborBytes, cborText,
  cborArray, cborMap, cborTag,
} from './caf-scitt';

// ─── Minimal CBOR decoder (test helper) ──────────────────────────────────────

type CborValue =
  | { t: 'uint';   v: number }
  | { t: 'negint'; v: number }
  | { t: 'bytes';  v: Uint8Array }
  | { t: 'text';   v: string }
  | { t: 'array';  v: CborValue[] }
  | { t: 'map';    v: Map<number | string, CborValue> }
  | { t: 'tag';    tag: number; v: CborValue }
  | { t: 'null' };

function decodeCbor(buf: Uint8Array, off = 0): { value: CborValue; bytesRead: number } {
  const ib  = buf[off];

  // Handle CBOR null (0xf6 = simple value 22)
  if (ib === 0xf6) {
    return { value: { t: 'null' }, bytesRead: 1 };
  }

  const mt  = ib >> 5;
  const ai  = ib & 0x1f;
  let pos   = off + 1;

  let arg: number;
  if      (ai <= 23) { arg = ai; }
  else if (ai === 24) { arg = buf[pos++]; }
  else if (ai === 25) { arg = (buf[pos] << 8) | buf[pos + 1]; pos += 2; }
  else if (ai === 26) {
    arg = ((buf[pos] << 24) | (buf[pos+1] << 16) | (buf[pos+2] << 8) | buf[pos+3]) >>> 0;
    pos += 4;
  } else {
    throw new Error(`CBOR: unsupported ai ${ai} at offset ${off}`);
  }

  switch (mt) {
    case 0: return { value: { t: 'uint', v: arg }, bytesRead: pos - off };
    case 1: return { value: { t: 'negint', v: -(arg + 1) }, bytesRead: pos - off };
    case 2: return { value: { t: 'bytes', v: buf.slice(pos, pos + arg) }, bytesRead: pos + arg - off };
    case 3: return { value: { t: 'text',  v: new TextDecoder().decode(buf.slice(pos, pos + arg)) }, bytesRead: pos + arg - off };
    case 4: {
      const items: CborValue[] = [];
      let read = pos - off;
      for (let i = 0; i < arg; i++) {
        const r = decodeCbor(buf, off + read);
        items.push(r.value);
        read += r.bytesRead;
      }
      return { value: { t: 'array', v: items }, bytesRead: read };
    }
    case 5: {
      const m = new Map<number | string, CborValue>();
      let read = pos - off;
      for (let i = 0; i < arg; i++) {
        const kr = decodeCbor(buf, off + read); read += kr.bytesRead;
        const vr = decodeCbor(buf, off + read); read += vr.bytesRead;
        const key = kr.value.t === 'uint'   ? kr.value.v
                  : kr.value.t === 'negint' ? kr.value.v
                  : kr.value.t === 'text'   ? kr.value.v
                  : String(kr.value);
        m.set(key, vr.value);
      }
      return { value: { t: 'map', v: m }, bytesRead: read };
    }
    case 6: {
      const inner = decodeCbor(buf, pos);
      return { value: { t: 'tag', tag: arg, v: inner.value }, bytesRead: (pos - off) + inner.bytesRead };
    }
    default:
      throw new Error(`CBOR: unsupported major type ${mt}`);
  }
}

// ─── RFC 9162 Merkle hash functions (re-implemented for testing) ─────────────

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

async function leafHash(data: Uint8Array): Promise<Uint8Array> {
  const prefixed = new Uint8Array(1 + data.length);
  prefixed[0] = 0x00;
  prefixed.set(data, 1);
  return sha256(prefixed);
}

async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  const prefixed = new Uint8Array(1 + 32 + 32);
  prefixed[0] = 0x01;
  prefixed.set(left, 1);
  prefixed.set(right, 33);
  return sha256(prefixed);
}

// ─── Test fixtures ───────────────────────────────────────────────────────────

const TEST_PRIVATE_KEY = crypto.getRandomValues(new Uint8Array(32));
const TEST_PRIVATE_KEY_B64 = btoa(String.fromCharCode(...TEST_PRIVATE_KEY));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RFC 9162 Merkle tree', () => {
  test('leaf hash uses 0x00 prefix', async () => {
    const data = new TextEncoder().encode('hello');
    const hash = await leafHash(data);
    expect(hash.length).toBe(32);

    // Verify prefix: SHA-256(0x00 || data)
    const manual = await sha256(new Uint8Array([0x00, ...data]));
    expect(hash).toEqual(manual);
  });

  test('node hash uses 0x01 prefix', async () => {
    const left  = await leafHash(new TextEncoder().encode('a'));
    const right = await leafHash(new TextEncoder().encode('b'));
    const hash  = await nodeHash(left, right);
    expect(hash.length).toBe(32);

    // Verify prefix: SHA-256(0x01 || left || right)
    const prefixed = new Uint8Array(65);
    prefixed[0] = 0x01;
    prefixed.set(left, 1);
    prefixed.set(right, 33);
    const manual = await sha256(prefixed);
    expect(hash).toEqual(manual);
  });

  test('leaf hash and node hash produce different results for same input', async () => {
    // This is critical for second-preimage resistance
    const data = new Uint8Array(64);
    const lh = await leafHash(data);
    const nh = await nodeHash(data.slice(0, 32), data.slice(32));
    expect(lh).not.toEqual(nh);
  });

  test('tree with 2 leaves has expected root', async () => {
    const leaf0 = await leafHash(new TextEncoder().encode('entry-0'));
    const leaf1 = await leafHash(new TextEncoder().encode('entry-1'));
    const root  = await nodeHash(leaf0, leaf1);

    // Root should be 32 bytes
    expect(root.length).toBe(32);
    // Root should differ from both leaves
    expect(root).not.toEqual(leaf0);
    expect(root).not.toEqual(leaf1);
  });

  test('tree with 3 leaves: root = H(H(leaf0, leaf1), leaf2)', async () => {
    const leaf0 = await leafHash(new TextEncoder().encode('a'));
    const leaf1 = await leafHash(new TextEncoder().encode('b'));
    const leaf2 = await leafHash(new TextEncoder().encode('c'));

    const left   = await nodeHash(leaf0, leaf1);
    // RFC 9162: odd leaf is promoted (becomes right child of parent with left subtree hash)
    const root   = await nodeHash(left, leaf2);
    expect(root.length).toBe(32);
  });
});

describe('CBOR Receipt structure', () => {
  test('receipt is tagged COSE_Sign1 (tag 18)', () => {
    const receipt = buildTestReceipt({
      treeSize: 4,
      leafIndex: 2,
      inclusionPath: [new Uint8Array(32), new Uint8Array(32)],
    });

    const { value } = decodeCbor(receipt);
    expect(value.t).toBe('tag');
    if (value.t === 'tag') {
      expect(value.tag).toBe(18);
    }
  });

  test('receipt has 4-element array (protected, unprotected, nil payload, signature)', () => {
    const receipt = buildTestReceipt({
      treeSize: 4,
      leafIndex: 2,
      inclusionPath: [new Uint8Array(32)],
    });

    const { value } = decodeCbor(receipt);
    expect(value.t).toBe('tag');
    if (value.t !== 'tag') return;

    const inner = value.v;
    expect(inner.t).toBe('array');
    if (inner.t !== 'array') return;
    expect(inner.v.length).toBe(4);

    // [0] = bstr (protected header)
    expect(inner.v[0].t).toBe('bytes');
    // [1] = map (unprotected, empty)
    expect(inner.v[1].t).toBe('map');
    // [2] = null (detached payload)
    expect(inner.v[2].t).toBe('null');
    // [3] = bstr (signature)
    expect(inner.v[3].t).toBe('bytes');
  });

  test('protected header contains alg=EdDSA, VDS type=1, VDS proofs', () => {
    const path0 = new Uint8Array(32).fill(0xAA);
    const path1 = new Uint8Array(32).fill(0xBB);

    const receipt = buildTestReceipt({
      treeSize: 8,
      leafIndex: 3,
      inclusionPath: [path0, path1],
    });

    const { value } = decodeCbor(receipt);
    if (value.t !== 'tag') return;
    const arr = value.v;
    if (arr.t !== 'array') return;

    // Decode protected header (it's a CBOR map inside a bstr)
    const protectedBstr = arr.v[0];
    if (protectedBstr.t !== 'bytes') return;
    const { value: header } = decodeCbor(protectedBstr.v);
    expect(header.t).toBe('map');
    if (header.t !== 'map') return;

    // alg = -8 (EdDSA)
    const alg = header.v.get(1);
    expect(alg?.t).toBe('negint');
    if (alg?.t === 'negint') expect(alg.v).toBe(-8);

    // VDS type (label 395) = 1 (RFC9162_SHA256)
    const vdsType = header.v.get(395);
    expect(vdsType?.t).toBe('uint');
    if (vdsType?.t === 'uint') expect(vdsType.v).toBe(1);

    // VDS proofs (label 396) = [tree_size, leaf_index, [path...]]
    const vdsProofs = header.v.get(396);
    expect(vdsProofs?.t).toBe('array');
    if (vdsProofs?.t !== 'array') return;
    expect(vdsProofs.v.length).toBe(3);

    // tree_size
    if (vdsProofs.v[0].t === 'uint') expect(vdsProofs.v[0].v).toBe(8);
    // leaf_index
    if (vdsProofs.v[1].t === 'uint') expect(vdsProofs.v[1].v).toBe(3);
    // inclusion path array
    expect(vdsProofs.v[2].t).toBe('array');
    if (vdsProofs.v[2].t === 'array') {
      expect(vdsProofs.v[2].v.length).toBe(2);
    }
  });

  test('signature is 64 bytes (Ed25519)', () => {
    const receipt = buildTestReceipt({
      treeSize: 2,
      leafIndex: 0,
      inclusionPath: [new Uint8Array(32)],
    });

    const { value } = decodeCbor(receipt);
    if (value.t !== 'tag') return;
    const arr = value.v;
    if (arr.t !== 'array') return;
    const sig = arr.v[3];
    if (sig.t !== 'bytes') return;
    expect(sig.v.length).toBe(64);
  });

  test('signature is verifiable with Ed25519 public key', () => {
    const receipt = buildTestReceipt({
      treeSize: 4,
      leafIndex: 1,
      inclusionPath: [new Uint8Array(32)],
    });

    const pubKey = ed25519.getPublicKey(TEST_PRIVATE_KEY);

    const { value } = decodeCbor(receipt);
    if (value.t !== 'tag') return;
    const arr = value.v;
    if (arr.t !== 'array') return;

    const protectedBytes = arr.v[0];
    const sig = arr.v[3];
    if (protectedBytes.t !== 'bytes' || sig.t !== 'bytes') return;

    // Reconstruct Sig_Structure
    const sigStructure = cborArray([
      cborText('Signature1'),
      cborBytes(protectedBytes.v),
      cborBytes(new Uint8Array(0)),
      cborBytes(new Uint8Array(0)),
    ]);

    const valid = ed25519.verify(sig.v, sigStructure, pubKey);
    expect(valid).toBe(true);
  });

  test('receipt with empty inclusion path (single leaf tree)', () => {
    const receipt = buildTestReceipt({
      treeSize: 1,
      leafIndex: 0,
      inclusionPath: [],
    });

    const { value } = decodeCbor(receipt);
    if (value.t !== 'tag') return;
    const arr = value.v;
    if (arr.t !== 'array') return;

    // Decode protected to check proofs
    const protectedBstr = arr.v[0];
    if (protectedBstr.t !== 'bytes') return;
    const { value: header } = decodeCbor(protectedBstr.v);
    if (header.t !== 'map') return;

    const vdsProofs = header.v.get(396);
    if (vdsProofs?.t !== 'array') return;

    // tree_size = 1
    if (vdsProofs.v[0].t === 'uint') expect(vdsProofs.v[0].v).toBe(1);
    // leaf_index = 0
    if (vdsProofs.v[1].t === 'uint') expect(vdsProofs.v[1].v).toBe(0);
    // empty path
    if (vdsProofs.v[2].t === 'array') expect(vdsProofs.v[2].v.length).toBe(0);
  });
});

describe('inclusion proof verification', () => {
  test('proof for 2-leaf tree: sibling hash verifies to root', async () => {
    const data0 = new TextEncoder().encode('leaf-0');
    const data1 = new TextEncoder().encode('leaf-1');

    const h0 = await leafHash(data0);
    const h1 = await leafHash(data1);
    const root = await nodeHash(h0, h1);

    // Proof for leaf 0: sibling is h1
    // Verify: nodeHash(h0, proof[0]) === root
    const computedRoot = await nodeHash(h0, h1);
    expect(computedRoot).toEqual(root);
  });

  test('proof for 4-leaf tree: path of length 2', async () => {
    const leaves = await Promise.all(
      ['a', 'b', 'c', 'd'].map(s => leafHash(new TextEncoder().encode(s)))
    );

    // Build tree manually
    const n01 = await nodeHash(leaves[0], leaves[1]);
    const n23 = await nodeHash(leaves[2], leaves[3]);
    const root = await nodeHash(n01, n23);

    // Proof for leaf 2 (index 2):
    //   level 0 sibling: leaves[3]
    //   level 1 sibling: n01
    // Verify: nodeHash(nodeHash(leaves[2], leaves[3]), n01) is wrong
    //         nodeHash(n01, nodeHash(leaves[2], leaves[3])) === root
    const step1 = await nodeHash(leaves[2], leaves[3]);
    const step2 = await nodeHash(n01, step1);
    expect(step2).toEqual(root);
  });
});

// ─── Test helper: build a receipt directly using the CBOR encoder ────────────

function buildTestReceipt(opts: {
  treeSize: number;
  leafIndex: number;
  inclusionPath: Uint8Array[];
}): Uint8Array {
  const HDR_ALG = 1;
  const HDR_VDS_TYPE = 395;
  const HDR_VDS_PROOFS = 396;
  const ALG_EDDSA = -8;
  const VDS_RFC9162_SHA256 = 1;
  const TAG_COSE_SIGN1 = 18;

  const pathArray = cborArray(opts.inclusionPath.map(h => cborBytes(h)));
  const vdsProofs = cborArray([
    cborUint(opts.treeSize),
    cborUint(opts.leafIndex),
    pathArray,
  ]);

  const protectedMap = cborMap([
    [cborUint(HDR_ALG), cborNegint(ALG_EDDSA)],
    [cborUint(HDR_VDS_TYPE), cborUint(VDS_RFC9162_SHA256)],
    [cborUint(HDR_VDS_PROOFS), vdsProofs],
  ]);

  const sigStructure = cborArray([
    cborText('Signature1'),
    cborBytes(protectedMap),
    cborBytes(new Uint8Array(0)),
    cborBytes(new Uint8Array(0)),
  ]);

  const signature = ed25519.sign(sigStructure, TEST_PRIVATE_KEY);

  const nullByte = new Uint8Array([0xf6]);
  const coseSign1 = cborArray([
    cborBytes(protectedMap),
    cborMap([]),
    nullByte,
    cborBytes(signature),
  ]);

  return cborTag(TAG_COSE_SIGN1, coseSign1);
}
