/**
 * Tests for the Web Bot Auth public verifier (RFC 9421 + L4 enrichment).
 * Runs with: bun test packages/worker/src/routes/wba.test.ts
 */

import { describe, test, expect, mock } from 'bun:test';
import {
  parseSignatureInput,
  parseSignatureHeader,
  buildSignatureBase,
} from './wba.js';
import type { Env } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate an Ed25519 keypair using Web Crypto */
async function generateKeypair(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; publicKeyRaw: Uint8Array }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyRaw };
}

/** base64url encode */
function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** base64 (standard) encode */
function b64std(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

interface SignedHeaders {
  'Signature-Input': string;
  'Signature': string;
  'Signature-Agent': string;
}

/**
 * Sign a sample request per RFC 9421 — matches the SDK's signRequest exactly.
 * Components: @authority and @target-uri only (matching the SDK default).
 */
async function signSampleRequest(opts: {
  privateKey: CryptoKey;
  thumbprint: string;
  url?: string;
  label?: string;
  coveredComponents?: string[];
  extraHeaders?: Record<string, string>;
}): Promise<{ headers: SignedHeaders; signatureBase: string }> {
  const {
    privateKey,
    thumbprint,
    url = 'https://example.com/api',
    label = 'sig1',
    coveredComponents = ['@authority', '@target-uri'],
    extraHeaders = {},
  } = opts;

  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;

  // Build sig params — must match the component list
  const compStr = coveredComponents.map(c => `"${c}"`).join(' ');
  const sigParams = `(${compStr});created=${created};expires=${expires};keyid="${thumbprint}";tag="web-bot-auth"`;

  // Build signature base
  const parsedUrl = new URL(url);
  const lines: string[] = [];
  for (const comp of coveredComponents) {
    switch (comp) {
      case '@authority': lines.push(`"@authority": ${parsedUrl.host}`); break;
      case '@target-uri': lines.push(`"@target-uri": ${url}`); break;
      case '@method': lines.push(`"@method": GET`); break;
      case '@path': lines.push(`"@path": ${parsedUrl.pathname}`); break;
      default: {
        const val = extraHeaders[comp] ?? extraHeaders[comp.toLowerCase()];
        if (!val) throw new Error(`Missing header for covered component: ${comp}`);
        lines.push(`"${comp}": ${val}`);
      }
    }
  }
  lines.push(`"@signature-params": ${sigParams}`);
  const signatureBase = lines.join('\n');

  // Sign
  const sigBytes = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(signatureBase),
  );
  const sigB64 = b64std(new Uint8Array(sigBytes));

  return {
    headers: {
      'Signature-Input': `${label}=${sigParams}`,
      'Signature': `${label}=:${sigB64}:`,
      'Signature-Agent': `https://agentlair.dev/agents/${thumbprint}`,
    },
    signatureBase,
  };
}

/**
 * Build a minimal stub Env with KEYS that can return mocked values.
 */
function makeEnv(kvData: Record<string, string> = {}): Env {
  return {
    KEYS: {
      get: async (key: string) => kvData[key] ?? null,
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ keys: [], list_complete: true, cursor: '' }),
      getWithMetadata: async () => ({ value: null, metadata: null }),
    } as unknown as KVNamespace,
  } as unknown as Env;
}

// ─── Parser unit tests ────────────────────────────────────────────────────────

describe('parseSignatureInput', () => {
  test('parses standard form correctly', () => {
    const input = 'sig1=("@authority" "@target-uri");created=1000;expires=1300;keyid="abc123";tag="web-bot-auth"';
    const result = parseSignatureInput(input);
    expect(result).not.toBeNull();
    expect(result!.label).toBe('sig1');
    expect(result!.coveredComponents).toEqual(['@authority', '@target-uri']);
    expect(result!.params.created).toBe(1000);
    expect(result!.params.expires).toBe(1300);
    expect(result!.params.keyid).toBe('abc123');
    expect(result!.params.tag).toBe('web-bot-auth');
  });

  test('returns null for garbage input', () => {
    expect(parseSignatureInput('not valid at all')).toBeNull();
    expect(parseSignatureInput('')).toBeNull();
    expect(parseSignatureInput('=missing-label')).toBeNull();
  });

  test('handles empty component list', () => {
    const result = parseSignatureInput('sig1=();keyid="k"');
    expect(result).not.toBeNull();
    expect(result!.coveredComponents).toEqual([]);
  });
});

describe('parseSignatureHeader', () => {
  test('extracts bytes for correct label', () => {
    // btoa('hello') = 'aGVsbG8='
    const bytes = parseSignatureHeader('sig1=:aGVsbG8=:', 'sig1');
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!)).toBe('hello');
  });

  test('returns null for missing label', () => {
    expect(parseSignatureHeader('sig1=:aGVsbG8=:', 'sig2')).toBeNull();
  });

  test('does not false-match partial labels', () => {
    // 'sig' should not match 'sig1'
    expect(parseSignatureHeader('sig1=:aGVsbG8=:', 'sig')).toBeNull();
  });

  test('handles multi-label form', () => {
    const result = parseSignatureHeader('sig1=:AAAA:, sig2=:aGVsbG8=:', 'sig2');
    expect(result).not.toBeNull();
  });
});

describe('buildSignatureBase', () => {
  test('produces correct base for @authority and @target-uri', () => {
    const body = { method: 'GET', url: 'https://example.com/api', headers: {} as never };
    const sigInput = 'sig1=("@authority" "@target-uri");created=1000;keyid="k"';
    const base = buildSignatureBase(body, ['@authority', '@target-uri'], sigInput, 'sig1');
    const expected = [
      '"@authority": example.com',
      '"@target-uri": https://example.com/api',
      '"@signature-params": ("@authority" "@target-uri");created=1000;keyid="k"',
    ].join('\n');
    expect(base).toBe(expected);
  });

  test('handles @method covered component', () => {
    const body = { method: 'POST', url: 'https://example.com/api', headers: {} as never };
    const sigInput = 'sig1=("@method" "@authority" "@target-uri");keyid="k"';
    const base = buildSignatureBase(body, ['@method', '@authority', '@target-uri'], sigInput, 'sig1');
    expect(base).toContain('"@method": POST');
  });

  test('handles header field covered components', () => {
    const body = {
      method: 'GET',
      url: 'https://example.com/api',
      headers: {
        date: 'Wed, 07 May 2026 12:00:00 GMT',
        'signature-input': 'sig1=("@authority" "date");keyid="k"',
        signature: 'sig1=:AAAA:',
      } as never,
    };
    const sigInput = 'sig1=("@authority" "date");keyid="k"';
    const base = buildSignatureBase(body, ['@authority', 'date'], sigInput, 'sig1');
    expect(base).toContain('"date": Wed, 07 May 2026 12:00:00 GMT');
  });
});

// ─── Round-trip integration tests ─────────────────────────────────────────────

describe('verifyL3 round-trip', () => {
  test('valid signature verifies correctly', async () => {
    const { privateKey, publicKeyRaw, } = await generateKeypair();
    const thumbprint = b64url(publicKeyRaw).slice(0, 43); // mock thumbprint (43 chars)
    // Pad to exactly 43 chars if needed
    const tp = thumbprint.padEnd(43, 'A');

    const { headers, } = await signSampleRequest({ privateKey, thumbprint: tp });

    // Stub env: return the public key when queried by thumbprint
    const env = makeEnv({
      [`signing-key-thumbprint:${tp}`]: JSON.stringify({ keyid: 'key1' }),
      'signing-key:key1': JSON.stringify({
        keyid: 'key1',
        algorithm: 'ed25519',
        public_key: b64url(publicKeyRaw),
        agent_id: 'acc_test',
        registered_at: '2026-01-01T00:00:00Z',
        status: 'active',
      }),
    });

    // Import verifyL3 directly — it's not exported, so test via the module indirectly
    // by constructing a verifyRequestBody and calling buildSignatureBase + verify manually.
    const sigInput = headers['Signature-Input'];
    const sig = headers['Signature'];
    const parsed = parseSignatureInput(sigInput)!;
    const sigBytes = parseSignatureHeader(sig, parsed.label)!;
    expect(sigBytes).not.toBeNull();

    const body = { method: 'GET', url: 'https://example.com/api', headers: headers as never };
    const signatureBase = buildSignatureBase(body, parsed.coveredComponents, sigInput, parsed.label);

    // Verify the signature manually with the public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw', publicKeyRaw.buffer as ArrayBuffer,
      { name: 'Ed25519' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' }, cryptoKey,
      sigBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(signatureBase),
    );
    expect(valid).toBe(true);
  });

  test('tampered signature returns invalid', async () => {
    const { privateKey, publicKeyRaw } = await generateKeypair();
    const tp = b64url(publicKeyRaw).slice(0, 43).padEnd(43, 'A');
    const { headers } = await signSampleRequest({ privateKey, thumbprint: tp });

    // Flip a byte in the signature
    const sigValue = headers['Signature'];
    const match = sigValue.match(/^sig1=:(.+):$/);
    expect(match).not.toBeNull();
    const sigBytes = Uint8Array.from(atob(match![1]), c => c.charCodeAt(0));
    sigBytes[0] ^= 0xFF; // flip bits
    const tamperedSig = `sig1=:${btoa(String.fromCharCode(...sigBytes))}:`;

    const sigInput = headers['Signature-Input'];
    const parsed = parseSignatureInput(sigInput)!;
    const parsedSigBytes = parseSignatureHeader(tamperedSig, parsed.label)!;

    const body = { method: 'GET', url: 'https://example.com/api', headers: headers as never };
    const signatureBase = buildSignatureBase(body, parsed.coveredComponents, sigInput, parsed.label);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', publicKeyRaw.buffer as ArrayBuffer,
      { name: 'Ed25519' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' }, cryptoKey,
      parsedSigBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(signatureBase),
    );
    expect(valid).toBe(false);
  });

  test('garbage signature-input returns parse failure', () => {
    const result = parseSignatureInput('not-a-valid-signature-input!!!');
    expect(result).toBeNull();
  });
});

describe('L4 KV stub tests', () => {
  test('env KEYS.get with popa-summary returns streak', async () => {
    const env = makeEnv({
      'popa-summary:did:web:agentlair.dev:agents:acc_test': JSON.stringify({ streak_days: 7 }),
    });
    const raw = await env.KEYS.get('popa-summary:did:web:agentlair.dev:agents:acc_test');
    const parsed = JSON.parse(raw!) as { streak_days: number };
    expect(parsed.streak_days).toBe(7);
  });

  test('env KEYS.get for missing key returns null', async () => {
    const env = makeEnv({});
    const raw = await env.KEYS.get('popa-summary:nonexistent');
    expect(raw).toBeNull();
  });

  test('signing key lookup by thumbprint works', async () => {
    const tp = 'A'.repeat(43);
    const env = makeEnv({
      [`signing-key-thumbprint:${tp}`]: JSON.stringify({ keyid: 'key1' }),
      'signing-key:key1': JSON.stringify({
        keyid: 'key1',
        algorithm: 'ed25519',
        public_key: 'AAAA',
        agent_id: 'acc_x',
        registered_at: '2026-01-01T00:00:00Z',
        status: 'active',
      }),
    });
    // Verify the chain: thumbprint → keyid → record
    const tpRaw = await env.KEYS.get(`signing-key-thumbprint:${tp}`);
    expect(tpRaw).not.toBeNull();
    const { keyid } = JSON.parse(tpRaw!) as { keyid: string };
    const keyRaw = await env.KEYS.get(`signing-key:${keyid}`);
    expect(keyRaw).not.toBeNull();
    const record = JSON.parse(keyRaw!) as { agent_id: string };
    expect(record.agent_id).toBe('acc_x');
  });
});

describe('@method covered component integration', () => {
  test('sign and verify with @method @authority @target-uri', async () => {
    const { privateKey, publicKeyRaw } = await generateKeypair();
    const tp = b64url(publicKeyRaw).slice(0, 43).padEnd(43, 'A');

    const { headers, signatureBase: producedBase } = await signSampleRequest({
      privateKey,
      thumbprint: tp,
      coveredComponents: ['@method', '@authority', '@target-uri'],
    });

    const sigInput = headers['Signature-Input'];
    const sig = headers['Signature'];
    const parsed = parseSignatureInput(sigInput)!;
    expect(parsed.coveredComponents).toEqual(['@method', '@authority', '@target-uri']);

    const body = { method: 'GET', url: 'https://example.com/api', headers: headers as never };
    const rebuilt = buildSignatureBase(body, parsed.coveredComponents, sigInput, parsed.label);
    expect(rebuilt).toBe(producedBase);

    const sigBytes = parseSignatureHeader(sig, parsed.label)!;
    const cryptoKey = await crypto.subtle.importKey(
      'raw', publicKeyRaw.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' }, cryptoKey, sigBytes.buffer as ArrayBuffer, new TextEncoder().encode(rebuilt),
    );
    expect(valid).toBe(true);
  });
});

describe('header field covered component', () => {
  test('sign and verify with date header', async () => {
    const { privateKey, publicKeyRaw } = await generateKeypair();
    const tp = b64url(publicKeyRaw).slice(0, 43).padEnd(43, 'A');
    const dateVal = 'Wed, 07 May 2026 12:00:00 GMT';

    const { headers, signatureBase: producedBase } = await signSampleRequest({
      privateKey,
      thumbprint: tp,
      coveredComponents: ['@authority', 'date'],
      extraHeaders: { date: dateVal },
    });

    const sigInput = headers['Signature-Input'];
    const sig = headers['Signature'];
    const parsed = parseSignatureInput(sigInput)!;
    expect(parsed.coveredComponents).toEqual(['@authority', 'date']);

    const body = {
      method: 'GET',
      url: 'https://example.com/api',
      headers: { ...headers, date: dateVal } as never,
    };
    const rebuilt = buildSignatureBase(body, parsed.coveredComponents, sigInput, parsed.label);
    expect(rebuilt).toBe(producedBase);

    const sigBytes = parseSignatureHeader(sig, parsed.label)!;
    const cryptoKey = await crypto.subtle.importKey(
      'raw', publicKeyRaw.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' }, cryptoKey, sigBytes.buffer as ArrayBuffer, new TextEncoder().encode(rebuilt),
    );
    expect(valid).toBe(true);
  });
});
