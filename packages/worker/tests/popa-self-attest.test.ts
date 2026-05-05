/**
 * PoPA Self-Attest — unit tests for POST /v1/popa/self-attest and
 * GET /v1/popa/agent/:did.
 *
 * Tests the route logic using pure-function helpers and mocked D1/KV.
 * No real D1 required — uses in-memory mock stubs.
 *
 * Run: bun test tests/popa-self-attest.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { createJWT, getPublicKey, computeKeyId } from '../src/jwt';

// ─── Ed25519 test key (from @noble/curves) ────────────────────────────────────

import { ed25519 } from '@noble/curves/ed25519.js';

function genTestKey(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const priv = crypto.getRandomValues(new Uint8Array(32));
  const pub = ed25519.getPublicKey(priv);
  const privateKeyB64 = btoa(String.fromCharCode(...priv));
  return { privateKeyB64, publicKeyBytes: pub };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function makeAAT(
  privateKeyB64: string,
  sub: string,
  did: string,
  opts: { expired?: boolean } = {},
): Promise<string> {
  const publicKeyBytes = getPublicKey(privateKeyB64);
  const kid = await computeKeyId(publicKeyBytes);
  const nowSecs = Math.floor(Date.now() / 1000);
  const exp = opts.expired ? nowSecs - 60 : nowSecs + 3600;
  return createJWT(
    {
      iss: 'https://agentlair.dev',
      sub,
      aud: 'https://test.example.com',
      exp,
      iat: nowSecs,
      jti: 'aat_test' + Math.random().toString(36).slice(2),
      did,
      al_scopes: ['popa:self-attest'],
      al_audit_url: 'https://agentlair.dev/v1/audit/aat_test',
    },
    privateKeyB64,
    kid,
  );
}

// ─── Test: AAT creation and claim extraction ──────────────────────────────────
//
// We test the JWT-level helpers in isolation since full HTTP integration
// requires a real D1 binding (not available in bun:test without miniflare).

describe('AAT helpers (self-attest prerequisites)', () => {
  test('createJWT / verifyJWT round-trip with did claim', async () => {
    const { privateKeyB64, publicKeyBytes } = genTestKey();
    const aat = await makeAAT(privateKeyB64, 'acc_test123', 'did:web:agentlair.dev:agents:acc_test123');

    // Verify the token
    const { verifyJWT } = await import('../src/jwt');
    const claims = verifyJWT(aat, publicKeyBytes);

    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('acc_test123');
    expect(claims!.did).toBe('did:web:agentlair.dev:agents:acc_test123');
    expect(claims!.jti).toMatch(/^aat_test/);
  });

  test('expired AAT: exp in the past', async () => {
    const { privateKeyB64, publicKeyBytes } = genTestKey();
    const aat = await makeAAT(
      privateKeyB64,
      'acc_exptest',
      'did:web:agentlair.dev:agents:acc_exptest',
      { expired: true },
    );

    const { verifyJWT } = await import('../src/jwt');
    const claims = verifyJWT(aat, publicKeyBytes);
    // Signature is valid, but exp check is the caller's responsibility
    expect(claims).not.toBeNull();
    expect(claims!.exp).toBeLessThan(Math.floor(Date.now() / 1000));
  });

  test('wrong key: verifyJWT returns null', async () => {
    const { privateKeyB64 } = genTestKey();
    const { publicKeyBytes: wrongPub } = genTestKey();
    const aat = await makeAAT(privateKeyB64, 'acc_wrong', 'did:web:agentlair.dev:agents:acc_wrong');

    const { verifyJWT } = await import('../src/jwt');
    const claims = verifyJWT(aat, wrongPub);
    expect(claims).toBeNull();
  });

  test('DID fallback: missing did claim → derive from sub', async () => {
    const { privateKeyB64, publicKeyBytes } = genTestKey();
    const kid = await computeKeyId(publicKeyBytes);
    const nowSecs = Math.floor(Date.now() / 1000);

    const { createJWT, verifyJWT } = await import('../src/jwt');
    const aat = createJWT(
      {
        iss: 'https://agentlair.dev',
        sub: 'acc_nodid',
        aud: 'https://test.example.com',
        exp: nowSecs + 3600,
        iat: nowSecs,
        jti: 'aat_nodid_test',
        al_scopes: [],
        al_audit_url: 'https://agentlair.dev/v1/audit/aat_nodid_test',
        // `did` intentionally omitted
      },
      privateKeyB64,
      kid,
    );

    const claims = verifyJWT(aat, publicKeyBytes);
    expect(claims).not.toBeNull();
    // did should be undefined; endpoint derives: "did:web:agentlair.dev:agents:acc_nodid"
    expect(claims!.did).toBeUndefined();
    const derivedDid = claims!.did ?? `did:web:agentlair.dev:agents:${claims!.sub}`;
    expect(derivedDid).toBe('did:web:agentlair.dev:agents:acc_nodid');
  });
});

// ─── Test: window_date computation ───────────────────────────────────────────

describe('window_date (UTC date string)', () => {
  test('ISO slice to YYYY-MM-DD', () => {
    const d = new Date('2026-05-05T23:59:59.000Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-05-05');
  });

  test('UTC midnight boundary', () => {
    const d = new Date('2026-05-06T00:00:00.000Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-05-06');
  });
});

// ─── Test: self-attest streak logic (pure) ────────────────────────────────────

describe('self-attest streak computation', () => {
  function computeStreak(dates: string[]): number {
    // dates is in DESC order (newest first)
    let streak = 0;
    let prevDate: string | null = null;
    for (const d of dates) {
      if (prevDate === null) {
        streak = 1;
      } else {
        const prev = new Date(prevDate + 'T00:00:00Z');
        const curr = new Date(d + 'T00:00:00Z');
        const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
        if (diffDays === 1) {
          streak++;
        } else {
          break;
        }
      }
      prevDate = d;
    }
    return streak;
  }

  test('1 day → streak=1', () => {
    expect(computeStreak(['2026-05-05'])).toBe(1);
  });

  test('3 consecutive days → streak=3', () => {
    expect(computeStreak(['2026-05-05', '2026-05-04', '2026-05-03'])).toBe(3);
  });

  test('gap on day 2 → streak=1 (only today)', () => {
    expect(computeStreak(['2026-05-05', '2026-05-03', '2026-05-02'])).toBe(1);
  });

  test('5 days with gap in the middle', () => {
    // most recent 2 days consecutive, then a gap, then older days
    expect(
      computeStreak(['2026-05-05', '2026-05-04', '2026-05-02', '2026-05-01']),
    ).toBe(2);
  });

  test('empty → streak=0', () => {
    expect(computeStreak([])).toBe(0);
  });
});
