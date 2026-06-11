/**
 * RFC 9421 HTTP Message Signatures — AgentLair Ed25519 Implementation
 *
 * Proves that AgentLair agents can produce Visa TAP-compatible HTTP signatures
 * using the SAME Ed25519 key pair already used for AAT signing.
 *
 * This bridges AgentLair's decentralized identity (JWKS-verifiable JWTs)
 * with centralized commerce protocols (Visa Trusted Agent Protocol).
 *
 * Key insight: Visa TAP uses Ed25519 + RFC 9421. AgentLair uses Ed25519 + JWT.
 * Same key, different signature envelope. This module produces the former
 * from the latter — enabling Portable Agent Identity (PAI).
 *
 * References:
 * - RFC 9421: HTTP Message Signatures
 * - Visa TAP: developer.visa.com/capabilities/trusted-agent-protocol
 * - RFC 8037: CFRG EdDSA for JWK/JOSE (Ed25519)
 *
 * @module rfc9421
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlEncode, b64urlDecode } from '../jwt.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SignatureParams {
  /** Key ID matching JWKS kid (first 8 chars of SHA-256 of pubkey) */
  keyid: string;
  /** Algorithm identifier — always "ed25519" for RFC 9421 */
  alg: 'ed25519';
  /** Unix timestamp of signature creation */
  created: number;
  /** Unix timestamp of signature expiration (Visa TAP: max 8 minutes) */
  expires?: number;
  /** Unique nonce for replay prevention */
  nonce: string;
  /** Signature tag — identifies signature purpose */
  tag: string;
}

export interface HttpMessage {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SignedComponents {
  components: string[];
  params: SignatureParams;
}

export interface SignatureResult {
  signatureInput: string;
  signature: string;
  signatureBase: string;
}

// ─── Derived Component Extraction ────────────────────────────────────────────

function getDerivedComponent(component: string, message: HttpMessage): string {
  const url = new URL(message.url);
  switch (component) {
    case '@method': return message.method.toUpperCase();
    case '@target-uri': return message.url;
    case '@authority': return url.host;
    case '@scheme': return url.protocol.replace(':', '');
    case '@request-target': return url.pathname + url.search;
    case '@path': return url.pathname;
    case '@query': return url.search || '?';
    default: throw new Error(`Unknown derived component: ${component}`);
  }
}

function getComponentValue(component: string, message: HttpMessage): string {
  if (component.startsWith('@')) return getDerivedComponent(component, message);
  const key = Object.keys(message.headers).find(
    (k) => k.toLowerCase() === component.toLowerCase(),
  );
  if (!key) throw new Error(`Header not present: ${component}`);
  return message.headers[key].trim();
}

// ─── Signature Base Construction (RFC 9421 §2.5) ────────────────────────────

export function buildSignatureBase(message: HttpMessage, signed: SignedComponents): string {
  const lines: string[] = [];
  for (const component of signed.components) {
    const value = getComponentValue(component, message);
    lines.push(`"${component.toLowerCase()}": ${value}`);
  }
  const paramsLine = buildSignatureParamsLine(signed);
  lines.push(`"@signature-params": ${paramsLine}`);
  return lines.join('\n');
}

function buildSignatureParamsLine(signed: SignedComponents): string {
  const { components, params } = signed;
  const componentList = components.map((c) => `"${c.toLowerCase()}"`).join(' ');
  const paramParts: string[] = [];
  paramParts.push(`created=${params.created}`);
  if (params.expires !== undefined) paramParts.push(`expires=${params.expires}`);
  paramParts.push(`keyid="${params.keyid}"`);
  paramParts.push(`alg="${params.alg}"`);
  paramParts.push(`nonce="${params.nonce}"`);
  paramParts.push(`tag="${params.tag}"`);
  return `(${componentList});${paramParts.join(';')}`;
}

// ─── Signing ─────────────────────────────────────────────────────────────────

export function signHttpMessage(
  message: HttpMessage,
  components: string[],
  params: SignatureParams,
  privateKeyB64: string,
): SignatureResult {
  const signed: SignedComponents = { components, params };
  const signatureBase = buildSignatureBase(message, signed);
  const messageBytes = new TextEncoder().encode(signatureBase);
  const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
  const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);
  const signatureB64 = btoa(String.fromCharCode(...signatureBytes));
  const paramsLine = buildSignatureParamsLine(signed);

  return {
    signatureInput: `agent=${paramsLine}`,
    signature: `agent=:${signatureB64}:`,
    signatureBase,
  };
}

// ─── Verification ────────────────────────────────────────────────────────────

export function verifyHttpSignature(
  message: HttpMessage,
  signatureInput: string,
  signature: string,
  publicKeyBytes: Uint8Array,
): boolean {
  try {
    const parsed = parseSignatureInput(signatureInput);
    if (!parsed) return false;
    const signatureBase = buildSignatureBase(message, parsed);
    const sigMatch = signature.match(/^\w+=:([A-Za-z0-9+/=]+):$/);
    if (!sigMatch) return false;
    const sigBytes = Uint8Array.from(atob(sigMatch[1]), (c) => c.charCodeAt(0));
    const messageBytes = new TextEncoder().encode(signatureBase);
    return ed25519.verify(sigBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

function parseSignatureInput(input: string): SignedComponents | null {
  const match = input.match(/^\w+=\(([^)]*)\);(.+)$/);
  if (!match) return null;
  const components = match[1].split(/\s+/).map((c) => c.replace(/"/g, '')).filter(Boolean);
  const params: Record<string, string> = {};
  for (const part of match[2].split(';')) {
    const [key, ...valueParts] = part.split('=');
    params[key] = valueParts.join('=').replace(/^"|"$/g, '');
  }
  return {
    components,
    params: {
      keyid: params.keyid || '',
      alg: 'ed25519',
      created: parseInt(params.created || '0'),
      expires: params.expires ? parseInt(params.expires) : undefined,
      nonce: params.nonce || '',
      tag: params.tag || '',
    },
  };
}

// ─── Visa TAP Convenience ────────────────────────────────────────────────────

export function signForVisaTAP(
  message: HttpMessage,
  privateKeyB64: string,
  keyid: string,
  tag: 'agent-browser-auth' | 'agent-payer-auth' = 'agent-browser-auth',
): { 'Signature-Input': string; Signature: string } {
  const now = Math.floor(Date.now() / 1000);
  const params: SignatureParams = {
    keyid,
    alg: 'ed25519',
    created: now,
    expires: now + 480,
    nonce: generateNonce(),
    tag,
  };
  const components = ['@method', '@authority', '@path'];
  if (message.headers['content-type'] || message.headers['Content-Type']) {
    components.push('content-type');
  }
  const result = signHttpMessage(message, components, params, privateKeyB64);
  return {
    'Signature-Input': result.signatureInput,
    Signature: result.signature,
  };
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

// ─── Demo: Portable Agent Identity ──────────────────────────────────────────

/**
 * Demonstrates that the SAME Ed25519 key works for:
 * 1. AgentLair AAT (JWT) — general agent authentication
 * 2. Visa TAP (RFC 9421 HTTP sig) — commerce
 * 3. Radicle NID (did:key) — code contributions
 *
 * This is Portable Agent Identity (PAI): one key, three ecosystems.
 *
 * Demo only — not production API
 */
export async function demonstratePAI(privateKeyB64: string) {
  const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);

  // Key ID (shared across all envelopes)
  const hashBuf = await crypto.subtle.digest(
    'SHA-256',
    publicKeyBytes.buffer.slice(publicKeyBytes.byteOffset, publicKeyBytes.byteOffset + publicKeyBytes.byteLength),
  );
  const kid = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);

  console.log('=== Portable Agent Identity (PAI) Demo ===\n');
  console.log(`Ed25519 Public Key: ${b64urlEncode(publicKeyBytes)}`);
  console.log(`Key ID (kid): ${kid}`);
  console.log(`JWKS URL: https://agentlair.dev/.well-known/jwks.json`);
  console.log('');

  // 1. JWT envelope (AgentLair AAT)
  const header = { alg: 'EdDSA', typ: 'JWT', kid };
  const payload = {
    iss: 'https://agentlair.dev',
    sub: 'acc_demo',
    aud: 'https://merchant.example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: 'aat_pai_demo',
    al_scopes: ['commerce:pay'],
    al_audit_url: 'https://agentlair.dev/v1/audit/aat_pai_demo',
  };
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const jwtSig = ed25519.sign(
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    privateKeyBytes,
  );
  const jwt = `${headerB64}.${payloadB64}.${b64urlEncode(jwtSig)}`;
  console.log('1. AgentLair AAT (JWT):');
  console.log(`   ${jwt.slice(0, 60)}...`);
  console.log(`   Verifier fetches: https://agentlair.dev/.well-known/jwks.json`);
  console.log('');

  // 2. RFC 9421 HTTP signature (Visa TAP)
  const tapMessage: HttpMessage = {
    method: 'POST',
    url: 'https://merchant.example.com/api/checkout',
    headers: { 'Content-Type': 'application/json' },
  };
  const tapHeaders = signForVisaTAP(tapMessage, privateKeyB64, kid, 'agent-payer-auth');
  console.log('2. Visa TAP (RFC 9421):');
  console.log(`   Signature-Input: ${tapHeaders['Signature-Input'].slice(0, 80)}...`);
  console.log(`   Verifier fetches: https://mcp.visa.com/.well-known/jwks (centralized)`);
  console.log(`   OR: https://agentlair.dev/.well-known/jwks.json (decentralized)`);
  console.log('');

  // 3. did:key (Radicle NID)
  const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKeyBytes.length);
  prefixed.set(ED25519_MULTICODEC);
  prefixed.set(publicKeyBytes, ED25519_MULTICODEC.length);
  // Simplified base58btc for demo (real impl in jwt.ts)
  const didKey = `did:key:z${b64urlEncode(prefixed)}`; // Approx — real uses base58btc
  console.log('3. Radicle NID (did:key):');
  console.log(`   ${didKey}`);
  console.log(`   Verifier checks: rad delegate list`);
  console.log('');

  console.log('=== Same Ed25519 key → Three ecosystems ===');
  console.log('The key is portable. The trust model differs:');
  console.log('  - AgentLair: verifier trusts agentlair.dev JWKS (decentralized)');
  console.log('  - Visa TAP: verifier trusts visa.com registry (centralized)');
  console.log('  - Radicle: verifier trusts cryptographic delegation chain (P2P)');

  return { jwt, tapHeaders, kid, publicKey: b64urlEncode(publicKeyBytes) };
}
