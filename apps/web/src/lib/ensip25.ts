/**
 * ENSIP-25 utilities — browser-compatible (no Node.js Buffer)
 * Based on: https://npmjs.com/package/ensip25-verify
 */

/**
 * Encode an EVM address + chainId into an ERC-7930 interoperable address hex string.
 * This is used to build the ENS text record key for ENSIP-25 agent bindings.
 */
export function encodeErc7930(chainId: bigint, address: `0x${string}`): string {
  const addrHex = address.startsWith('0x') ? address.slice(2) : address;
  const addrBytes = hexToBytes(addrHex);

  // Compute minimal bytes needed for chainId
  let chainIdBytes = 0;
  let tmp = chainId;
  while (tmp > 0n) {
    chainIdBytes++;
    tmp >>= 8n;
  }
  if (chainIdBytes === 0) chainIdBytes = 1;

  // Encode chainId big-endian
  const chainRefBytes = new Uint8Array(chainIdBytes);
  let cid = chainId;
  for (let i = chainIdBytes - 1; i >= 0; i--) {
    chainRefBytes[i] = Number(cid & 0xffn);
    cid >>= 8n;
  }

  // version(2) + chainType(2) + chainRefLen(1) + chainRef + addrLen(1) + addr
  const result = new Uint8Array(2 + 2 + 1 + chainIdBytes + 1 + addrBytes.length);
  let off = 0;
  result[off++] = 0x00; result[off++] = 0x01; // version = 0x0001
  result[off++] = 0x00; result[off++] = 0x00; // chainType = EVM = 0x0000
  result[off++] = chainIdBytes;
  result.set(chainRefBytes, off); off += chainIdBytes;
  result[off++] = addrBytes.length;
  result.set(addrBytes, off);

  return '0x' + bytesToHex(result);
}

/**
 * Build the ENSIP-25 text record key.
 * Format: agent-registration[<erc7930>][<agentId>]
 */
export function buildTextRecordKey(
  chainId: bigint,
  registryAddress: `0x${string}`,
  agentId: string | bigint,
): string {
  const erc7930 = encodeErc7930(chainId, registryAddress);
  return `agent-registration[${erc7930}][${agentId}]`;
}

// --- Helpers ---

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
