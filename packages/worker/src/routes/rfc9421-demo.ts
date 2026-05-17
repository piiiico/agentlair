/**
 * GET /v1/rfc9421/demo — self-verifying RFC 9421 example endpoint
 *
 * Returns a deterministic Ed25519 demo keypair, an unsigned example request,
 * the same request signed per RFC 9421, and a ready-to-paste curl one-liner
 * that round-trips through /v1/rfc9421/verify and produces {valid:true}.
 *
 * Strategic anchor: behavioral compliance > declarative compliance.
 * "AgentLair speaks RFC 9421" is a claim. One curl that verifies green is proof.
 *
 * Pipeline: rfc9421-demo-route-20260517-083700
 */

import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { HonoEnv } from '../types.js';
import { signHttpMessage, type SignatureParams, type HttpMessage } from '../lib/rfc9421.js';
import { base58btcEncode } from '../lib/base58btc.js';
import { checkIpRateLimit } from '../middleware/ratelimit.js';

export const rfc9421DemoRoutes = new Hono<HonoEnv>();

// ─── Deterministic demo keypair (module-load time, once) ──────────────────────

// Published demo seed: 32 × 0x42. Documented in the response as demo-only.
const DEMO_PRIVATE_KEY_BYTES = new Uint8Array(32).fill(0x42);
const DEMO_PUBLIC_KEY_BYTES = ed25519.getPublicKey(DEMO_PRIVATE_KEY_BYTES);

// did:key encoding: multicodec prefix [0xed, 0x01] + 32-byte pubkey, base58btc encoded, prefixed with 'z'
const DID_KEY_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
const DEMO_DID_KEY_BYTES = new Uint8Array(DID_KEY_MULTICODEC_PREFIX.length + DEMO_PUBLIC_KEY_BYTES.length);
DEMO_DID_KEY_BYTES.set(DID_KEY_MULTICODEC_PREFIX);
DEMO_DID_KEY_BYTES.set(DEMO_PUBLIC_KEY_BYTES, DID_KEY_MULTICODEC_PREFIX.length);
const DEMO_DID_KEY = 'did:key:z' + base58btcEncode(DEMO_DID_KEY_BYTES);

// Base64 representations for the response envelope
const DEMO_PRIVATE_KEY_B64 = btoa(String.fromCharCode(...DEMO_PRIVATE_KEY_BYTES));
const DEMO_PUBLIC_KEY_B64 = btoa(String.fromCharCode(...DEMO_PUBLIC_KEY_BYTES));

// ─── Demo request constants ───────────────────────────────────────────────────

const DEMO_TARGET_URI = 'https://merchant.example.com/agent/checkout';
const DEMO_BODY = '{"amount":"4.99","currency":"USD"}';
const DEMO_SIGNING_COMPONENTS = ['@method', '@authority', '@path', 'content-type'];

// ─── Route ────────────────────────────────────────────────────────────────────

rfc9421DemoRoutes.get('/', async (c) => {
  // Rate limit: 60 req/hour per IP
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? '';
  const rl = await checkIpRateLimit(c.env, ip, 'rfc9421-demo', 60);
  if (!rl.allowed) {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    return c.json({ error: 'rate_limited', retry_after: now.toISOString() }, 429);
  }

  // Fresh signature each request (created/expires/nonce are time-bound)
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 480; // Visa TAP max: 8 minutes
  const nonce = crypto.randomUUID();

  const params: SignatureParams = {
    keyid: DEMO_DID_KEY,
    alg: 'ed25519',
    created,
    expires,
    nonce,
    tag: 'agentlair-demo',
  };

  const message: HttpMessage = {
    method: 'POST',
    url: DEMO_TARGET_URI,
    headers: {
      'content-type': 'application/json',
    },
  };

  const { signatureInput, signature } = signHttpMessage(
    message,
    DEMO_SIGNING_COMPONENTS,
    params,
    DEMO_PRIVATE_KEY_B64,
  );

  // Signed envelope headers
  const signedHeaders = {
    'content-type': 'application/json',
    'signature-input': signatureInput,
    signature,
  };

  // Build the example.curl one-liner
  const verifyPayload = JSON.stringify({
    method: 'POST',
    target_uri: DEMO_TARGET_URI,
    headers: signedHeaders,
  });
  const curlString =
    `curl -sS -X POST https://api.agentlair.dev/v1/rfc9421/verify` +
    ` -H 'Content-Type: application/json'` +
    ` -d '${verifyPayload.replace(/'/g, "'\\''")}'`;

  const body = {
    documentation: {
      summary:
        'Self-verifying RFC 9421 example. This is the same HTTP Message Signature shape Visa Trusted Agent Protocol, Mastercard Verified Intent, and Skyfire all use. Sign your example.request with example.privateKey (or just paste example.curl) and POST example.signed to the verifier — it returns {valid:true}.',
      verifier_url: 'https://api.agentlair.dev/v1/rfc9421/verify',
      spec: 'https://www.rfc-editor.org/rfc/rfc9421.html',
      production_note:
        'example.privateKey is a published demo seed (32 × 0x42). do not use in production — generate fresh keys.',
    },
    example: {
      keyId: DEMO_DID_KEY,
      privateKey: {
        format: 'base64',
        value: DEMO_PRIVATE_KEY_B64,
        notes: 'demo-only, derived from 32 × 0x42, do not use anywhere — published seed',
      },
      publicKey: {
        format: 'base64',
        value: DEMO_PUBLIC_KEY_B64,
      },
      request: {
        method: 'POST',
        target_uri: DEMO_TARGET_URI,
        headers: {
          'content-type': 'application/json',
        },
        body: DEMO_BODY,
      },
      signed: {
        method: 'POST',
        target_uri: DEMO_TARGET_URI,
        headers: signedHeaders,
        created,
        expires,
        covered_components: DEMO_SIGNING_COMPONENTS,
      },
      curl: curlString,
    },
  };

  c.header('Cache-Control', 'no-store');
  return c.json(body);
});
