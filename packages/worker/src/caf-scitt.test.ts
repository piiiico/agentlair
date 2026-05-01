/**
 * COSE_Sign1 (SCITT Wrapper) — Tests
 *
 * Covers:
 *  (a) Round-trip: CAF → COSE_Sign1 → verify Ed25519 signature
 *  (b) CWT claims correctly encoded (iss, sub, iat)
 *  (c) Content-type header correctly set
 *  (d) subjectIdToUri mapping for all SubjectId variants
 *  (e) COSE_Sign1 structural invariants (CBOR tag 18, 4-element array, etc.)
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  cafToSignedStatement,
  subjectIdToUri,
  cborText,
  cborBytes,
  cborArray,
} from './caf-scitt';
import type { CommitmentAttestation, SubjectId } from './caf';

// ─── Minimal CBOR decoder (test helper only) ─────────────────────────────────
//
// Decodes the subset of CBOR used in COSE_Sign1: uint, negint, bstr, tstr,
// array, map, tag. Not a general-purpose decoder.

type CborValue =
  | { t: 'uint';   v: number }
  | { t: 'negint'; v: number }
  | { t: 'bytes';  v: Uint8Array }
  | { t: 'text';   v: string }
  | { t: 'array';  v: CborValue[] }
  | { t: 'map';    v: Map<number | string, CborValue> }
  | { t: 'tag';    tag: number; v: CborValue };

function decodeCbor(buf: Uint8Array, off = 0): { value: CborValue; bytesRead: number } {
  const ib  = buf[off];
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
      let c = pos - off;
      for (let i = 0; i < arg; i++) { const r = decodeCbor(buf, off + c); items.push(r.value); c += r.bytesRead; }
      return { value: { t: 'array', v: items }, bytesRead: c };
    }
    case 5: {
      const map = new Map<number | string, CborValue>();
      let c = pos - off;
      for (let i = 0; i < arg; i++) {
        const kr = decodeCbor(buf, off + c); c += kr.bytesRead;
        const vr = decodeCbor(buf, off + c); c += vr.bytesRead;
        const k = kr.value.t === 'uint' ? kr.value.v
                : kr.value.t === 'negint' ? kr.value.v
                : kr.value.t === 'text'   ? kr.value.v
                : (() => { throw new Error('map key must be int or text'); })();
        map.set(k as number | string, vr.value);
      }
      return { value: { t: 'map', v: map }, bytesRead: c };
    }
    case 6: {
      const r = decodeCbor(buf, pos);
      return { value: { t: 'tag', tag: arg, v: r.value }, bytesRead: pos - off + r.bytesRead };
    }
    default: throw new Error(`CBOR: unsupported major type ${mt}`);
  }
}

function mustBytes(v: CborValue): Uint8Array  { if (v.t !== 'bytes') throw new Error(`Expected bstr, got ${v.t}`); return v.v; }
function mustText(v: CborValue):  string       { if (v.t !== 'text')  throw new Error(`Expected tstr, got ${v.t}`);  return v.v; }
function mustUint(v: CborValue):  number       { if (v.t !== 'uint')  throw new Error(`Expected uint, got ${v.t}`);  return v.v; }
function mustNegint(v: CborValue): number      { if (v.t !== 'negint') throw new Error(`Expected negint, got ${v.t}`); return v.v; }
function mustArray(v: CborValue): CborValue[]  { if (v.t !== 'array') throw new Error(`Expected array, got ${v.t}`); return v.v; }
function mustMap(v: CborValue):   Map<number | string, CborValue> {
  if (v.t !== 'map') throw new Error(`Expected map, got ${v.t}`);
  return v.v;
}

/** Parse a COSE_Sign1 blob into its four components. */
function parseCoseSign1(raw: Uint8Array): {
  tag: number;
  protectedBytes: Uint8Array;
  payloadBytes: Uint8Array;
  signatureBytes: Uint8Array;
} {
  const { value: tagged } = decodeCbor(raw);
  if (tagged.t !== 'tag') throw new Error('Expected CBOR tag');
  const arr = mustArray(tagged.v);
  if (arr.length !== 4) throw new Error(`COSE_Sign1 must have 4 elements, got ${arr.length}`);
  return {
    tag:            tagged.tag,
    protectedBytes: mustBytes(arr[0]),
    payloadBytes:   mustBytes(arr[2]),
    signatureBytes: mustBytes(arr[3]),
  };
}

/** Rebuild COSE Sig_Structure for signature verification. */
function makeSigStructure(protectedBytes: Uint8Array, payloadBytes: Uint8Array): Uint8Array {
  return cborArray([
    cborText('Signature1'),
    cborBytes(protectedBytes),
    cborBytes(new Uint8Array(0)),  // empty external_aad
    cborBytes(payloadBytes),
  ]);
}

// ─── Test data builders ───────────────────────────────────────────────────────

function generateKeypair() {
  const priv = crypto.getRandomValues(new Uint8Array(32));
  const pub  = ed25519.getPublicKey(priv);
  return { privateKeyB64: btoa(String.fromCharCode(...priv)), publicKeyBytes: pub };
}

function makeAttestation(overrides: Partial<CommitmentAttestation> = {}): CommitmentAttestation {
  return {
    id: 'sha256:aabbccddeeff',
    schema: 'caf:v0.1',
    attester:  { type: 'agent', id: 'acc_attester' },
    subject:   { type: 'agent', id: 'acc_subject' },
    timestamp: '2026-05-01T12:00:00.000Z',
    created_at: '2026-05-01T12:00:00.000Z',
    expires_at:  null,
    revoked_at:  null,
    source: 'agentlair',
    commitment_type: 'agent.action',
    body: { action: 'email.send', result: 'success', status: 200 },
    cost_signal: { type: 'credential', description: 'test', magnitude: null, unit: null },
    evidence: [],
    ref: [],
    sig: { alg: 'EdDSA', kid: 'deadbeef', value: 'testvalue==' },
    ...overrides,
  };
}

// ─── subjectIdToUri ───────────────────────────────────────────────────────────

describe('subjectIdToUri', () => {
  test('agent → "agentlair:<id>"', () => {
    expect(subjectIdToUri({ type: 'agent', id: 'acc_abc123' })).toBe('agentlair:acc_abc123');
  });

  test('did → pass through', () => {
    const did = 'did:web:agentlair.dev:accounts:acc_xyz';
    expect(subjectIdToUri({ type: 'did', id: did })).toBe(did);
  });

  test('human → pass through', () => {
    expect(subjectIdToUri({ type: 'human', id: 'bankid:pno-NO-12345678901' })).toBe('bankid:pno-NO-12345678901');
  });

  test('business → pass through', () => {
    expect(subjectIdToUri({ type: 'business', id: 'brreg:923456789' })).toBe('brreg:923456789');
  });

  test('url → pass through', () => {
    expect(subjectIdToUri({ type: 'url', id: 'https://example.com' })).toBe('https://example.com');
  });
});

// ─── Structural invariants ────────────────────────────────────────────────────

describe('cafToSignedStatement structure', () => {
  test('returns Uint8Array', async () => {
    const { privateKeyB64 } = generateKeypair();
    const result = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  test('first byte is 0xd2 (CBOR tag 18)', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    // CBOR tag 18: major type 6 (0xC0) | argument 18 = 0xD2
    expect(raw[0]).toBe(0xd2);
  });

  test('COSE_Sign1 tag value is 18', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { tag } = parseCoseSign1(raw);
    expect(tag).toBe(18);
  });

  test('top-level tagged value is a 4-element array', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { value: tagged } = decodeCbor(raw);
    if (tagged.t !== 'tag') throw new Error();
    expect(mustArray(tagged.v).length).toBe(4);
  });

  test('element 0 (protected) is a byte string', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { value: tagged } = decodeCbor(raw);
    if (tagged.t !== 'tag') throw new Error();
    expect(mustArray(tagged.v)[0].t).toBe('bytes');
  });

  test('element 1 (unprotected) is an empty map', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { value: tagged } = decodeCbor(raw);
    if (tagged.t !== 'tag') throw new Error();
    expect(mustMap(mustArray(tagged.v)[1]).size).toBe(0);
  });

  test('element 2 (payload) is a byte string', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { value: tagged } = decodeCbor(raw);
    if (tagged.t !== 'tag') throw new Error();
    expect(mustArray(tagged.v)[2].t).toBe('bytes');
  });

  test('element 3 (signature) is exactly 64 bytes', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { signatureBytes } = parseCoseSign1(raw);
    expect(signatureBytes.length).toBe(64);
  });

  test('payload decodes to the original attestation JSON', async () => {
    const { privateKeyB64 } = generateKeypair();
    const att = makeAttestation();
    const raw = await cafToSignedStatement(att, privateKeyB64);
    const { payloadBytes } = parseCoseSign1(raw);
    const decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
    expect(decoded.id).toBe(att.id);
    expect(decoded.schema).toBe(att.schema);
    expect(decoded.commitment_type).toBe(att.commitment_type);
  });

  test('output is deterministic (same key + attestation = same bytes)', async () => {
    const { privateKeyB64 } = generateKeypair();
    const att = makeAttestation();
    const raw1 = await cafToSignedStatement(att, privateKeyB64);
    const raw2 = await cafToSignedStatement(att, privateKeyB64);
    expect(Buffer.from(raw1).toString('hex')).toBe(Buffer.from(raw2).toString('hex'));
  });
});

// ─── (a) Round-trip signature verification ───────────────────────────────────

describe('cafToSignedStatement round-trip', () => {
  test('Ed25519 signature verifies against Sig_Structure', async () => {
    const { privateKeyB64, publicKeyBytes } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);

    const { protectedBytes, payloadBytes, signatureBytes } = parseCoseSign1(raw);
    const sigStructure = makeSigStructure(protectedBytes, payloadBytes);

    expect(ed25519.verify(signatureBytes, sigStructure, publicKeyBytes)).toBe(true);
  });

  test('tampered payload fails verification', async () => {
    const { privateKeyB64, publicKeyBytes } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);

    const { protectedBytes, payloadBytes, signatureBytes } = parseCoseSign1(raw);
    const tampered = new Uint8Array(payloadBytes);
    tampered[0] ^= 0xff;

    const sigStructure = makeSigStructure(protectedBytes, tampered);
    expect(ed25519.verify(signatureBytes, sigStructure, publicKeyBytes)).toBe(false);
  });

  test('tampered protected header fails verification', async () => {
    const { privateKeyB64, publicKeyBytes } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);

    const { protectedBytes, payloadBytes, signatureBytes } = parseCoseSign1(raw);
    const tampered = new Uint8Array(protectedBytes);
    tampered[tampered.length - 1] ^= 0xff;

    const sigStructure = makeSigStructure(tampered, payloadBytes);
    expect(ed25519.verify(signatureBytes, sigStructure, publicKeyBytes)).toBe(false);
  });

  test('wrong public key fails verification', async () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), kp1.privateKeyB64);

    const { protectedBytes, payloadBytes, signatureBytes } = parseCoseSign1(raw);
    const sigStructure = makeSigStructure(protectedBytes, payloadBytes);

    expect(ed25519.verify(signatureBytes, sigStructure, kp2.publicKeyBytes)).toBe(false);
  });
});

// ─── (b) CWT claims ──────────────────────────────────────────────────────────

describe('CWT claims encoding', () => {
  test('protected header contains CWT claims at label 15', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { protectedBytes } = parseCoseSign1(raw);
    const header = mustMap(decodeCbor(protectedBytes).value);
    expect(header.has(15)).toBe(true);
  });

  test('iss (CWT claim 1) matches attester URI', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(
      makeAttestation({ attester: { type: 'agent', id: 'acc_issuer42' } }),
      privateKeyB64,
    );
    const { protectedBytes } = parseCoseSign1(raw);
    const cwt = mustMap(mustMap(decodeCbor(protectedBytes).value).get(15)!);
    expect(mustText(cwt.get(1)!)).toBe('agentlair:acc_issuer42');
  });

  test('sub (CWT claim 2) matches subject URI', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(
      makeAttestation({ subject: { type: 'agent', id: 'acc_sub99' } }),
      privateKeyB64,
    );
    const { protectedBytes } = parseCoseSign1(raw);
    const cwt = mustMap(mustMap(decodeCbor(protectedBytes).value).get(15)!);
    expect(mustText(cwt.get(2)!)).toBe('agentlair:acc_sub99');
  });

  test('iat (CWT claim 6) is unix timestamp in seconds', async () => {
    const { privateKeyB64 } = generateKeypair();
    const ts = '2026-05-01T12:00:00.000Z';
    const raw = await cafToSignedStatement(
      makeAttestation({ timestamp: ts }),
      privateKeyB64,
    );
    const { protectedBytes } = parseCoseSign1(raw);
    const cwt = mustMap(mustMap(decodeCbor(protectedBytes).value).get(15)!);
    const expected = Math.floor(new Date(ts).getTime() / 1000);
    expect(mustUint(cwt.get(6)!)).toBe(expected);
  });

  test('iss for DID attester passes through unchanged', async () => {
    const { privateKeyB64 } = generateKeypair();
    const did = 'did:web:agentlair.dev:accounts:acc_abc';
    const raw = await cafToSignedStatement(
      makeAttestation({ attester: { type: 'did', id: did } }),
      privateKeyB64,
    );
    const { protectedBytes } = parseCoseSign1(raw);
    const cwt = mustMap(mustMap(decodeCbor(protectedBytes).value).get(15)!);
    expect(mustText(cwt.get(1)!)).toBe(did);
  });

  test('CWT claims map has exactly 3 entries (iss=1, sub=2, iat=6)', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { protectedBytes } = parseCoseSign1(raw);
    const cwt = mustMap(mustMap(decodeCbor(protectedBytes).value).get(15)!);
    expect(cwt.size).toBe(3);
    expect(cwt.has(1)).toBe(true);
    expect(cwt.has(2)).toBe(true);
    expect(cwt.has(6)).toBe(true);
  });
});

// ─── (c) Content-type header ─────────────────────────────────────────────────

describe('content-type and header encoding', () => {
  test('content-type header (label 3) is "application/caf+json"', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { protectedBytes } = parseCoseSign1(raw);
    const header = mustMap(decodeCbor(protectedBytes).value);
    expect(mustText(header.get(3)!)).toBe('application/caf+json');
  });

  test('alg header (label 1) is EdDSA = -8', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { protectedBytes } = parseCoseSign1(raw);
    const header = mustMap(decodeCbor(protectedBytes).value);
    expect(mustNegint(header.get(1)!)).toBe(-8);
  });

  test('kid header (label 4) is 8-char lowercase hex', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { protectedBytes } = parseCoseSign1(raw);
    const header = mustMap(decodeCbor(protectedBytes).value);
    expect(mustText(header.get(4)!)).toMatch(/^[0-9a-f]{8}$/);
  });

  test('protected header has exactly 4 entries', async () => {
    const { privateKeyB64 } = generateKeypair();
    const raw = await cafToSignedStatement(makeAttestation(), privateKeyB64);
    const { protectedBytes } = parseCoseSign1(raw);
    const header = mustMap(decodeCbor(protectedBytes).value);
    expect(header.size).toBe(4);
    // Verify all four expected labels are present
    expect(header.has(1)).toBe(true);   // alg
    expect(header.has(3)).toBe(true);   // content-type
    expect(header.has(4)).toBe(true);   // kid
    expect(header.has(15)).toBe(true);  // cwt_claims
  });
});
