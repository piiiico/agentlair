/**
 * Web Bot Auth Public Verifier — RFC 9421 + L4 enrichment
 *
 * POST /v1/wba/verify — anonymous public endpoint, free at low volume,
 *                        x402-payable above (0.005 USDC, like /v1/agents/lookup).
 *
 * Returns L3 (cryptographic verdict per RFC 9421) AND L4 (AgentLair
 * behavioral attestation chain) for any submitted signed request.
 */

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import { b64urlDecode } from '../jwt.js';
import { getSigningKey, getSigningKeyByThumbprint } from './signing-keys.js';
import { checkIpRateLimit } from '../middleware/ratelimit.js';
import { make402Response, SERVICE_PRICES, verifyX402Payment, settleX402Payment, trackX402Spend } from '../x402.js';
import type { HonoEnv, Env } from '../types.js';

export const wbaRoutes = new Hono<HonoEnv>();

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerifyRequestBody {
  method: string;       // GET | POST | PUT | DELETE | PATCH | HEAD | OPTIONS
  url: string;
  headers: {
    'signature-input': string;
    'signature': string;
    'signature-agent'?: string;  // optional per RFC 9421; required for AgentLair L4 lookup
    [k: string]: string | undefined;
  };
  body?: string;
}

interface L3Result {
  valid: boolean;
  signing_agent_url: string | null;
  key_id: string | null;
  thumbprint: string | null;
  covered_components: string[];
  created: number | null;
  expires: number | null;
  alg: string;
  failure_reason?: string;
  // surfaced for diagnostic UI ("show signature base")
  signature_base?: string;
}

interface L4Agent {
  did: string;
  handle: string | null;
  account_id: string;
  popa_streak: number | null;
  bcc_count: number | null;
  signing_keys_count: number;
  first_seen: string;
}

interface L4Result {
  agent: L4Agent | null;
  resolution_path: 'agentlair_thumbprint' | 'agentlair_keyid' | 'external' | 'no_agent_url';
}

// ─── Route handler ────────────────────────────────────────────────────────────

wbaRoutes.post('/verify', async (c) => {
  // Rate limit: 100/day per IP for free tier; x402 above.
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const ipCheck = await checkIpRateLimit(c.env, clientIp, 'wba-verify', 100);
  if (!ipCheck.allowed) {
    const paymentHeader = c.req.header('X-PAYMENT');
    if (!paymentHeader) {
      return make402Response(SERVICE_PRICES.agent_lookup, {
        error: 'rate_limited',
        message: 'Free tier allows 100 verifications per IP per day. Pay 0.005 USDC via x402 to continue.',
        upgrade_url: 'https://agentlair.dev/pricing',
      });
    }
    const payment = await verifyX402Payment(paymentHeader, SERVICE_PRICES.agent_lookup);
    if (!payment.valid) {
      return new Response(JSON.stringify({ error: 'payment_invalid', message: payment.error }),
        { status: 402, headers: { 'Content-Type': 'application/json' } });
    }
    void settleX402Payment(paymentHeader, SERVICE_PRICES.agent_lookup);
    void trackX402Spend(c.env, clientIp + ':wba-verify',
      SERVICE_PRICES.agent_lookup.amount,
      { payer: payment.payer, service: 'wba_verify' });
  }

  // Parse body
  let body: VerifyRequestBody;
  try {
    body = await c.req.json() as VerifyRequestBody;
  } catch {
    return err('Invalid JSON body', 400, 'invalid_request_shape');
  }

  // Shape validation
  if (typeof body.method !== 'string' || typeof body.url !== 'string' || !body.headers) {
    return err('Body must include method, url, and headers', 400, 'invalid_request_shape',
      'See /docs/api-reference#wba-verify for the request schema.');
  }

  const sigInput = body.headers['signature-input'] ?? body.headers['Signature-Input'];
  const sig      = body.headers['signature'] ?? body.headers['Signature'];
  const sigAgent = body.headers['signature-agent'] ?? body.headers['Signature-Agent'] ?? null;

  if (typeof sigInput !== 'string' || typeof sig !== 'string') {
    return err('headers must include signature-input and signature', 400, 'wrong_signature_format',
      'Both signature-input and signature headers are required (case-insensitive). See RFC 9421 §4.');
  }

  // Verify
  const l3 = await verifyL3(c.env, body, sigInput, sig, sigAgent);
  const l4 = l3.valid && (l3.thumbprint || l3.key_id)
    ? await enrichL4(c.env, l3.thumbprint, l3.key_id, sigAgent)
    : { agent: null, resolution_path: 'no_agent_url' } as L4Result;

  return json({ l3, l4 });
});

// ─── L3 verification ──────────────────────────────────────────────────────────

async function verifyL3(
  env: Env,
  body: VerifyRequestBody,
  sigInput: string,
  sig: string,
  sigAgent: string | null,
): Promise<L3Result> {
  // 1. Parse signature-input header
  const inputParsed = parseSignatureInput(sigInput);
  if (!inputParsed) {
    return makeFailL3(sigAgent, 'sig_input_parse_error', `Cannot parse signature-input header: ${sigInput.slice(0, 100)}`);
  }
  const { label, coveredComponents, params } = inputParsed;

  // 2. Parse signature header — extract bytes for the matching label
  const sigBytes = parseSignatureHeader(sig, label);
  if (!sigBytes) {
    return makeFailL3(sigAgent, 'sig_parse_error', `Cannot parse signature header for label "${label}"`);
  }

  // 3. Resolve signing key
  const keyid = params.keyid;
  if (!keyid) {
    return makeFailL3(sigAgent, 'no_keyid', 'signature-input missing keyid parameter');
  }

  let publicKeyBytes: Uint8Array | null = null;
  let thumbprint: string | null = null;

  // Try thumbprint lookup (43 chars, strict regex) — direct AgentLair lookup
  if (/^[A-Za-z0-9_-]{43}$/.test(String(keyid))) {
    const record = await getSigningKeyByThumbprint(env, String(keyid));
    if (record) {
      try {
        publicKeyBytes = b64urlDecode(record.public_key);
        thumbprint = String(keyid);
      } catch { /* fallthrough */ }
    }
  }

  // Fallback: fetch signature-agent URL and find JWK with kid === keyid
  if (!publicKeyBytes) {
    if (!sigAgent) {
      return makeFailL3(sigAgent, 'no_signature_agent', 'No signature-agent URL and keyid not in AgentLair directory');
    }
    const fetched = await fetchAndResolveKey(sigAgent, String(keyid));
    if (!fetched) {
      return makeFailL3(sigAgent, 'key_not_found', `Could not resolve key "${keyid}" from ${sigAgent}`);
    }
    publicKeyBytes = fetched.publicKeyBytes;
    thumbprint = fetched.thumbprint;
  }

  // 4. Reconstruct signature base per RFC 9421 §2.5
  let signatureBase: string;
  try {
    signatureBase = buildSignatureBase(body, coveredComponents, sigInput, label);
  } catch (e) {
    return makeFailL3(sigAgent, 'sig_base_error', `Cannot build signature base: ${(e as Error).message}`);
  }

  // 5. Verify Ed25519 signature only (RSA-PSS/ECDSA not supported yet)
  const alg = params.alg ?? 'ed25519';
  if (alg !== 'ed25519' && alg !== 'eddsa') {
    return makeFailL3(sigAgent, 'unsupported_alg',
      `alg "${alg}" not supported by this verifier yet (Ed25519 only). Open an issue if you need RSA-PSS/ECDSA.`,
      {
        key_id: String(keyid), thumbprint,
        covered_components: coveredComponents,
        created: params.created != null ? Number(params.created) : null,
        expires: params.expires != null ? Number(params.expires) : null,
        alg: String(alg),
        signature_base: signatureBase,
      });
  }

  let valid = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes.buffer.slice(publicKeyBytes.byteOffset, publicKeyBytes.byteOffset + publicKeyBytes.byteLength) as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      cryptoKey,
      sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
      new TextEncoder().encode(signatureBase),
    );
  } catch (e) {
    return makeFailL3(sigAgent, 'verify_error', `Ed25519 verification threw: ${(e as Error).message}`,
      {
        key_id: String(keyid), thumbprint,
        covered_components: coveredComponents,
        created: params.created != null ? Number(params.created) : null,
        expires: params.expires != null ? Number(params.expires) : null,
        alg: 'ed25519',
        signature_base: signatureBase,
      });
  }

  return {
    valid,
    signing_agent_url: sigAgent,
    key_id: String(keyid),
    thumbprint,
    covered_components: coveredComponents,
    created: params.created != null ? Number(params.created) : null,
    expires: params.expires != null ? Number(params.expires) : null,
    alg: 'ed25519',
    signature_base: signatureBase,
    ...(valid ? {} : { failure_reason: 'signature_mismatch' }),
  };
}

function makeFailL3(
  sigAgent: string | null,
  reason: string,
  message: string,
  extra: Partial<L3Result> = {},
): L3Result {
  return {
    valid: false,
    signing_agent_url: sigAgent,
    key_id: extra.key_id ?? null,
    thumbprint: extra.thumbprint ?? null,
    covered_components: extra.covered_components ?? [],
    created: extra.created ?? null,
    expires: extra.expires ?? null,
    alg: extra.alg ?? 'unknown',
    failure_reason: `${reason}: ${message}`,
    ...(extra.signature_base ? { signature_base: extra.signature_base } : {}),
  };
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

interface ParsedSigInput {
  label: string;
  coveredComponents: string[];
  params: Record<string, string | number>;
}

/**
 * Parse signature-input header per RFC 9421 §2.3.
 * Single-label form only (most common). Format:
 *   <label>=("<comp1>" "<comp2>");param1=val1;param2="val2"
 */
export function parseSignatureInput(input: string): ParsedSigInput | null {
  const trimmed = input.trim();
  const m = trimmed.match(/^([A-Za-z0-9_-]+)=\(([^)]*)\)(.*)$/);
  if (!m) return null;
  const [, label, componentsRaw, paramsRaw] = m;

  // Parse components: space-separated quoted strings
  const coveredComponents: string[] = [];
  const compRe = /"([^"]+)"/g;
  let cm: RegExpExecArray | null;
  while ((cm = compRe.exec(componentsRaw)) !== null) {
    coveredComponents.push(cm[1]);
  }

  // Parse params: ;key=value pairs (value may be quoted string or integer)
  const params: Record<string, string | number> = {};
  const rest = paramsRaw.replace(/^;/, '');
  const paramTokens = splitParamList(rest);
  for (const tok of paramTokens) {
    const eq = tok.indexOf('=');
    if (eq === -1) continue;
    const k = tok.slice(0, eq).trim();
    const v = tok.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      params[k] = v.slice(1, -1);
    } else if (/^-?\d+$/.test(v)) {
      params[k] = Number(v);
    } else {
      params[k] = v;
    }
  }
  return { label, coveredComponents, params };
}

function splitParamList(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of s) {
    if (ch === '"') { inQuotes = !inQuotes; cur += ch; }
    else if (ch === ';' && !inQuotes) { if (cur.trim()) out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Parse signature header for a given label.
 * Format: sig1=:<base64-bytes>:[, sig2=:<base64-bytes>:]
 * RFC 9421 byte sequences use STANDARD base64 (not base64url).
 */
export function parseSignatureHeader(sig: string, label: string): Uint8Array | null {
  // Anchored at start or after ", " to avoid partial-label matches
  const re = new RegExp(`(?:^|,\\s*)${escapeRegex(label)}=:([A-Za-z0-9+/=]+):`);
  const m = sig.match(re);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Signature base reconstruction (RFC 9421 §2.5) ────────────────────────────

export function buildSignatureBase(
  body: VerifyRequestBody,
  coveredComponents: string[],
  sigInput: string,
  label: string,
): string {
  const url = new URL(body.url);
  const lines: string[] = [];

  for (const comp of coveredComponents) {
    let value: string;
    switch (comp) {
      case '@method':
        value = body.method.toUpperCase();
        break;
      case '@authority':
        value = url.host;
        break;
      case '@target-uri':
        value = body.url;
        break;
      case '@scheme':
        value = url.protocol.replace(':', '');
        break;
      case '@path':
        value = url.pathname;
        break;
      case '@query':
        value = url.search;
        break;
      case '@request-target':
        value = `${body.method.toLowerCase()} ${url.pathname}${url.search}`;
        break;
      default: {
        // Header field — case-insensitive lookup in body.headers
        const headerKey = Object.keys(body.headers).find(k => k.toLowerCase() === comp.toLowerCase());
        if (!headerKey) throw new Error(`covered component "${comp}" not found in headers`);
        value = String(body.headers[headerKey]).trim();
      }
    }
    lines.push(`"${comp}": ${value}`);
  }

  // Final line: @signature-params with the original parameter list for THIS label
  const labelPrefix = `${label}=`;
  const idx = sigInput.indexOf(labelPrefix);
  if (idx === -1) throw new Error(`signature-input does not contain label "${label}"`);
  const afterLabel = sigInput.slice(idx + labelPrefix.length).trim();
  // Take everything up to the next ", <ident>=" or end of string
  const nextLabelMatch = afterLabel.match(/,\s*[A-Za-z0-9_-]+=/);
  const sigParamsRaw = nextLabelMatch ? afterLabel.slice(0, nextLabelMatch.index) : afterLabel;
  lines.push(`"@signature-params": ${sigParamsRaw}`);

  return lines.join('\n');
}

// ─── Key resolution ──────────────────────────────────────────────────────────

async function fetchAndResolveKey(
  signatureAgentUrl: string,
  keyid: string,
): Promise<{ publicKeyBytes: Uint8Array; thumbprint: string | null } | null> {
  let url: URL;
  try { url = new URL(signatureAgentUrl); } catch { return null; }

  // Only allow https (and http://localhost for testing)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(signatureAgentUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
  } catch { return null; }
  if (!res.ok) return null;

  let parsed: unknown;
  try { parsed = await res.json(); } catch { return null; }

  // Accept JWKS { keys: [...] } OR single JWK object
  let jwk: { kty?: string; crv?: string; x?: string; kid?: string } | null = null;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { keys?: unknown }).keys)) {
    const keys = (parsed as { keys: { kty?: string; crv?: string; x?: string; kid?: string }[] }).keys;
    jwk = keys.find(k => k.kid === keyid) ?? null;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as { kty?: string; crv?: string; x?: string; kid?: string };
    if (obj.kid === keyid || !obj.kid) jwk = obj;
  }
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') return null;

  let publicKeyBytes: Uint8Array;
  try { publicKeyBytes = b64urlDecode(jwk.x); } catch { return null; }
  if (publicKeyBytes.length !== 32) return null;

  return {
    publicKeyBytes,
    thumbprint: typeof jwk.kid === 'string' && /^[A-Za-z0-9_-]{43}$/.test(jwk.kid) ? jwk.kid : null,
  };
}

// ─── L4 enrichment ───────────────────────────────────────────────────────────

async function enrichL4(
  env: Env,
  thumbprint: string | null,
  keyid: string | null,
  sigAgent: string | null,
): Promise<L4Result> {
  const tp = thumbprint ?? keyid;
  if (!tp) return { agent: null, resolution_path: 'no_agent_url' };

  // If sigAgent is set and NOT an agentlair.dev URL, this is external.
  if (sigAgent) {
    try {
      const u = new URL(sigAgent);
      if (u.hostname !== 'agentlair.dev' && !u.hostname.endsWith('.agentlair.dev')) {
        return { agent: null, resolution_path: 'external' };
      }
    } catch { /* ignore */ }
  }

  // Try thumbprint lookup first, then key ID fallback
  let record: Awaited<ReturnType<typeof getSigningKey>> = null;
  let resolution: L4Result['resolution_path'] = 'agentlair_thumbprint';
  if (/^[A-Za-z0-9_-]{43}$/.test(tp)) {
    record = await getSigningKeyByThumbprint(env, tp);
  }
  if (!record) {
    record = await getSigningKey(env, tp);
    if (record) resolution = 'agentlair_keyid';
  }
  if (!record) return { agent: null, resolution_path: 'external' };

  const accountId = record.agent_id;
  const did = `did:web:agentlair.dev:agents:${accountId}`;

  // PoPA streak — best-effort, null if not present
  let popaStreak: number | null = null;
  try {
    const popaRaw = await env.KEYS.get(`popa-summary:${did}`);
    if (popaRaw) {
      const summary = JSON.parse(popaRaw) as { streak_days?: number };
      if (typeof summary.streak_days === 'number') popaStreak = summary.streak_days;
    }
  } catch { /* ignore */ }

  // BCC count — best-effort, null if not present
  let bccCount: number | null = null;
  try {
    const bccRaw = await env.KEYS.get(`bcc-count:${accountId}`);
    if (bccRaw) bccCount = Number(bccRaw);
  } catch { /* ignore */ }

  return {
    agent: {
      did,
      handle: record.agent_name ?? null,
      account_id: accountId,
      popa_streak: popaStreak,
      bcc_count: bccCount,
      signing_keys_count: 1,
      first_seen: record.registered_at,
    },
    resolution_path: resolution,
  };
}
