/**
 * Base58btc encode/decode — no external dependencies.
 *
 * Used for did:key NID encoding (encode) and NID validation/decoding (decode).
 * Pairs with pubkeyToRadicleNid in jwt.ts.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((c, i) => [c, i]),
);

/**
 * Encode bytes to a base58btc string.
 * Leading zero bytes become leading '1' characters.
 */
export function base58btcEncode(bytes: Uint8Array): string {
  // Count leading zero bytes
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeros++;
  }
  // Convert bytes to big integer
  let num = BigInt(0);
  for (const b of bytes) {
    num = num * BigInt(256) + BigInt(b);
  }
  // Convert to base58
  let result = '';
  while (num > 0n) {
    const remainder = Number(num % 58n);
    result = BASE58_ALPHABET[remainder] + result;
    num = num / 58n;
  }
  // Add leading '1's for zero bytes
  return '1'.repeat(leadingZeros) + result;
}

/**
 * Decode a base58btc string to bytes.
 * Returns null if any character is not in the alphabet.
 * Leading '1' characters decode to leading zero bytes.
 */
export function base58btcDecode(str: string): Uint8Array | null {
  if (str.length === 0) return new Uint8Array(0);

  // Count leading '1's (zero bytes)
  let leadingZeros = 0;
  for (const c of str) {
    if (c !== '1') break;
    leadingZeros++;
  }

  // Convert base58 to big integer
  let num = BigInt(0);
  for (const c of str) {
    const val = BASE58_MAP.get(c);
    if (val === undefined) return null; // invalid character
    num = num * BigInt(58) + BigInt(val);
  }

  // Convert big integer to bytes
  const result: number[] = [];
  while (num > 0n) {
    result.unshift(Number(num & 0xffn));
    num >>= 8n;
  }

  // Prepend leading zero bytes
  const bytes = new Uint8Array(leadingZeros + result.length);
  bytes.set(result, leadingZeros);
  return bytes;
}
