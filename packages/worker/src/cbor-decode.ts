/**
 * Minimal CBOR Decoder — sized to parse the subset of CBOR our COSE_Sign1
 * envelopes use. Pairs with the encoder in caf-scitt.ts.
 *
 * Supports:
 *   - Unsigned integers          (major type 0, args 0..2^32-1)
 *   - Negative integers          (major type 1, args 0..2^32-1)
 *   - Byte strings (definite)    (major type 2)
 *   - Text strings (definite)    (major type 3)
 *   - Arrays (definite)          (major type 4)
 *   - Maps (definite)            (major type 5)
 *   - Tags                       (major type 6)
 *   - Simple values: null/false/true/undefined (major type 7, args 20..23)
 *
 * NOT supported (would throw):
 *   - Indefinite-length items
 *   - Floats (major type 7, args 25/26/27)
 *   - 64-bit integers above 2^32 (Cloudflare Workers limit; not used by us)
 *
 * Used by routes/scitt.ts to parse client-supplied COSE_Sign1 envelopes
 * for verification. The decoder is intentionally strict: any unsupported
 * construct causes a CborDecodeError with a useful trail for debugging.
 */

export class CborDecodeError extends Error {
  constructor(message: string) {
    super(`CBOR decode error: ${message}`);
    this.name = 'CborDecodeError';
  }
}

export type CborValue =
  | number
  | bigint
  | Uint8Array
  | string
  | CborValue[]
  | Map<CborValue, CborValue>
  | { tag: number; value: CborValue }
  | null
  | boolean
  | undefined;

interface DecodeState {
  bytes: Uint8Array;
  offset: number;
}

/**
 * Decode a single CBOR item. Returns the value and bytes consumed.
 * Throws CborDecodeError on malformed input.
 */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const state: DecodeState = { bytes, offset: 0 };
  const value = decodeNext(state);
  if (state.offset < bytes.length) {
    throw new CborDecodeError(
      `${bytes.length - state.offset} extra bytes after top-level item`,
    );
  }
  return value;
}

function decodeNext(state: DecodeState): CborValue {
  if (state.offset >= state.bytes.length) {
    throw new CborDecodeError('unexpected end of input');
  }

  const initial = state.bytes[state.offset++];
  const majorType = initial >> 5;
  const additional = initial & 0x1f;

  // Read the argument value (length / value)
  let arg: number;
  if (additional < 24) {
    arg = additional;
  } else if (additional === 24) {
    arg = readUint(state, 1);
  } else if (additional === 25) {
    arg = readUint(state, 2);
  } else if (additional === 26) {
    arg = readUint(state, 4);
  } else if (additional === 27) {
    // 64-bit: only safe if upper 32 bits are zero
    const hi = readUint(state, 4);
    const lo = readUint(state, 4);
    if (hi !== 0) {
      throw new CborDecodeError('64-bit values above 2^32 are not supported');
    }
    arg = lo;
  } else if (additional === 31) {
    throw new CborDecodeError('indefinite-length items are not supported');
  } else {
    throw new CborDecodeError(`reserved additional info ${additional}`);
  }

  switch (majorType) {
    case 0: // unsigned int
      return arg;
    case 1: // negative int
      return -1 - arg;
    case 2: { // byte string
      assertRemaining(state, arg);
      const slice = state.bytes.subarray(state.offset, state.offset + arg);
      state.offset += arg;
      // Return a copy so callers can't mutate the source buffer
      return new Uint8Array(slice);
    }
    case 3: { // text string
      assertRemaining(state, arg);
      const slice = state.bytes.subarray(state.offset, state.offset + arg);
      state.offset += arg;
      return new TextDecoder('utf-8', { fatal: true }).decode(slice);
    }
    case 4: { // array
      const items: CborValue[] = [];
      for (let i = 0; i < arg; i++) {
        items.push(decodeNext(state));
      }
      return items;
    }
    case 5: { // map
      const map = new Map<CborValue, CborValue>();
      for (let i = 0; i < arg; i++) {
        const k = decodeNext(state);
        const v = decodeNext(state);
        map.set(k, v);
      }
      return map;
    }
    case 6: { // tag
      const inner = decodeNext(state);
      return { tag: arg, value: inner };
    }
    case 7: // simple values
      switch (arg) {
        case 20: return false;
        case 21: return true;
        case 22: return null;
        case 23: return undefined;
        default:
          throw new CborDecodeError(`unsupported simple/float value (arg=${arg})`);
      }
    default:
      throw new CborDecodeError(`unknown major type ${majorType}`);
  }
}

function readUint(state: DecodeState, n: number): number {
  assertRemaining(state, n);
  let value = 0;
  for (let i = 0; i < n; i++) {
    value = value * 256 + state.bytes[state.offset + i];
  }
  state.offset += n;
  // Number stays safe for n ≤ 6; we only ever call with n ≤ 4.
  return value;
}

function assertRemaining(state: DecodeState, n: number): void {
  if (state.offset + n > state.bytes.length) {
    throw new CborDecodeError(
      `unexpected end of input (need ${n}, have ${state.bytes.length - state.offset})`,
    );
  }
}

// ─── COSE_Sign1 helpers ──────────────────────────────────────────────────────
//
// COSE_Sign1 wire format (RFC 9052 §4.2):
//   tag(18, [
//     bstr  protected,    ; CBOR-encoded protected header map
//     map   unprotected,  ; (we accept empty)
//     bstr|null payload,  ; signed payload bytes (or CBOR null for detached)
//     bstr  signature,    ; signature bytes
//   ])

export interface CoseSign1Components {
  /** Raw bytes of the (CBOR-encoded) protected header map. */
  protected: Uint8Array;
  /** Decoded protected header map (integer or text keys → CBOR value). */
  protectedMap: Map<CborValue, CborValue>;
  /** Unprotected header map. */
  unprotectedMap: Map<CborValue, CborValue>;
  /** Payload bytes — null for detached payload. */
  payload: Uint8Array | null;
  /** Raw Ed25519 signature bytes. */
  signature: Uint8Array;
}

/**
 * Parse a COSE_Sign1 envelope. Accepts the canonical tag(18, [...]) form
 * AND the untagged 4-element array form (some wire formats omit the tag).
 *
 * Returns the four standard slots plus a pre-decoded protected header map
 * (since we always need to read it).
 */
export function decodeCoseSign1(bytes: Uint8Array): CoseSign1Components {
  const top = decodeCbor(bytes);

  let array: CborValue;
  if (typeof top === 'object' && top !== null && !Array.isArray(top) && 'tag' in top) {
    if (top.tag !== 18) {
      throw new CborDecodeError(`expected COSE_Sign1 tag 18, got tag ${top.tag}`);
    }
    array = top.value;
  } else {
    array = top;
  }

  if (!Array.isArray(array) || array.length !== 4) {
    throw new CborDecodeError('COSE_Sign1 must be a 4-element array');
  }

  const [protectedRaw, unprotectedRaw, payloadRaw, signatureRaw] = array;

  if (!(protectedRaw instanceof Uint8Array)) {
    throw new CborDecodeError('COSE_Sign1.protected must be a byte string');
  }
  if (!(unprotectedRaw instanceof Map)) {
    throw new CborDecodeError('COSE_Sign1.unprotected must be a map');
  }

  // Protected header is a CBOR-encoded map embedded in a bstr
  let protectedMap: Map<CborValue, CborValue>;
  if (protectedRaw.length === 0) {
    protectedMap = new Map();
  } else {
    const decoded = decodeCbor(protectedRaw);
    if (!(decoded instanceof Map)) {
      throw new CborDecodeError('COSE_Sign1.protected must decode to a map');
    }
    protectedMap = decoded;
  }

  let payload: Uint8Array | null;
  if (payloadRaw === null) {
    payload = null;
  } else if (payloadRaw instanceof Uint8Array) {
    payload = payloadRaw;
  } else {
    throw new CborDecodeError('COSE_Sign1.payload must be a byte string or null');
  }

  if (!(signatureRaw instanceof Uint8Array)) {
    throw new CborDecodeError('COSE_Sign1.signature must be a byte string');
  }

  return {
    protected: protectedRaw,
    protectedMap,
    unprotectedMap: unprotectedRaw,
    payload,
    signature: signatureRaw,
  };
}

/**
 * Look up a header value by integer label. Returns undefined if not present.
 * Centralised so callers don't repeat the int-key lookup.
 */
export function getHeaderInt(map: Map<CborValue, CborValue>, label: number): CborValue | undefined {
  for (const [k, v] of map) {
    if (typeof k === 'number' && k === label) return v;
  }
  return undefined;
}

/**
 * Look up a header value by text label.
 */
export function getHeaderText(map: Map<CborValue, CborValue>, label: string): CborValue | undefined {
  for (const [k, v] of map) {
    if (typeof k === 'string' && k === label) return v;
  }
  return undefined;
}
