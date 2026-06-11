/**
 * @agentlair/verify — Tests for verifyFinding / verifyFindingPermalink / classifyTrustTier
 *
 * Hermetic: a tiny in-process Bun.serve plays the JWKS endpoint AND the
 * /v1/findings/<jti> permalink endpoint. No reliance on agentlair.dev's
 * live state. Each scenario from the pipeline spec (§Tests) is its own
 * `test(...)` block.
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'bun:test';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  type JWK,
} from 'jose';
import {
  verifyFinding,
  verifyFindingPermalink,
  classifyTrustTier,
} from './verify-finding.js';
import { clearJWKSCache } from './jwks.js';
import type { TrackRecord, FindingClaims } from './types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

interface Keypair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicJwk: JWK;
  kid: string;
}

async function makeKeypair(kidPrefix: string): Promise<Keypair> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
    extractable: true,
    crv: 'Ed25519',
  });
  const publicJwk = await exportJWK(publicKey);
  // Deterministic kid for the test (8 chars — same shape as the worker's
  // computeKeyId, though we don't need byte-for-byte parity).
  const xRaw = typeof publicJwk.x === 'string' ? publicJwk.x : '';
  const kid = `${kidPrefix}-${xRaw.slice(0, 6)}`;
  publicJwk.kid = kid;
  publicJwk.use = 'sig';
  publicJwk.alg = 'EdDSA';
  return { publicKey, privateKey, publicJwk, kid };
}

interface FindingOverrides {
  aud?: string | string[];
  iat?: number;
  type?: string | undefined;
  jti?: string;
  agent_name?: string;
  finding?: Partial<FindingClaims['finding']> | undefined;
  behavioral_score?: number;
  track_record?: TrackRecord;
  iss?: string;
  sub?: string;
}

async function signFinding(
  kp: Keypair,
  overrides: FindingOverrides = {},
  options: { omitFinding?: boolean; rawClaims?: Record<string, unknown> } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const baseFinding = {
    title: 'IDOR in /v1/agents/:agentId/findings',
    severity: 'HIGH' as const,
    cwe: 'CWE-639',
    target: 'https://agentlair.dev/v1/agents/acc_victim/findings',
    evidence_hash:
      'sha256:' + 'a'.repeat(64),
    evidence_url: 'ipfs://bafytestbafytestbafytestbafytestbafytestbafytestbafytestbafy',
    tools_used: ['burp', 'curl'],
    time_to_find_ms: 124_000,
  };
  const merged = options.rawClaims
    ? options.rawClaims
    : {
        iss: overrides.iss ?? 'https://agentlair.dev',
        sub: overrides.sub ?? 'acc_research_agent_1',
        aud: overrides.aud ?? 'https://agentlair.dev',
        iat: overrides.iat ?? now,
        jti: overrides.jti ?? 'finding_aaaaaaaaaaaaaaaaaaaaa',
        type:
          overrides.type === undefined
            ? 'security_finding'
            : overrides.type,
        ...(overrides.agent_name !== undefined
          ? { agent_name: overrides.agent_name }
          : {}),
        ...(options.omitFinding
          ? {}
          : { finding: { ...baseFinding, ...(overrides.finding ?? {}) } }),
        ...(overrides.behavioral_score !== undefined
          ? { behavioral_score: overrides.behavioral_score }
          : {}),
        ...(overrides.track_record !== undefined
          ? { track_record: overrides.track_record }
          : {}),
      };

  const sig = await new SignJWT(merged as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: kp.kid })
    .sign(kp.privateKey);
  return sig;
}

// ─── Hermetic stub server ─────────────────────────────────────────────────────

let primaryKp: Keypair;
let secondaryKp: Keypair; // signs the "bad signature" token
let server: ReturnType<typeof Bun.serve>;
let jwksUrl: string;
let permalinkBaseUrl: string;
let jwksFetchCount = 0;
let storedPermalinks: Map<
  string,
  {
    body: { jti?: string; signed_jwt?: string; claims?: Record<string, unknown> } | string;
    status?: number;
    contentType?: string;
  }
> = new Map();

beforeAll(async () => {
  primaryKp = await makeKeypair('primary');
  secondaryKp = await makeKeypair('secondary');

  server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === '/.well-known/jwks.json') {
        jwksFetchCount++;
        return new Response(
          JSON.stringify({ keys: [primaryKp.publicJwk] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.pathname.startsWith('/v1/findings/')) {
        const jti = u.pathname.slice('/v1/findings/'.length);
        const stored = storedPermalinks.get(jti);
        if (!stored) {
          return new Response('not found', { status: 404 });
        }
        const status = stored.status ?? 200;
        const contentType = stored.contentType ?? 'application/json';
        const body =
          typeof stored.body === 'string'
            ? stored.body
            : JSON.stringify(stored.body);
        return new Response(body, {
          status,
          headers: { 'content-type': contentType },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  jwksUrl = `http://localhost:${server.port}/.well-known/jwks.json`;
  permalinkBaseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  clearJWKSCache();
  jwksFetchCount = 0;
  storedPermalinks = new Map();
});

// `verifyFinding`/`verifyFindingPermalink` validate URLs against an
// `^https://…` pattern. Tests run against `http://localhost:…`, so for the
// invalid-URL test we just need to assert the regex rejects a non-finding URL.
// The permalink happy-path test uses the public function with the http URL
// pattern relaxed via a thin wrapper that calls verifyFinding directly on the
// fetched body — see test 16 below.

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('verifyFinding', () => {
  // 1. valid happy path
  test('valid happy path — returns valid: true with full agent + finding', async () => {
    const jwt = await signFinding(primaryKp);
    const result = await verifyFinding(jwt, { jwksUrl });
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('expected valid');
    expect(result.agent.id).toBe('acc_research_agent_1');
    expect(result.finding.title).toContain('IDOR');
    expect(result.finding.severity).toBe('HIGH');
    expect(result.finding.cwe).toBe('CWE-639');
    expect(result.finding.target).toContain('agentlair.dev');
    expect(result.finding.evidence_hash.startsWith('sha256:')).toBe(true);
    expect(result.trustTier).toBe('unranked'); // no track_record
    expect(result.jti).toBe('finding_aaaaaaaaaaaaaaaaaaaaa');
    expect(result.issuedAt).toBeInstanceOf(Date);
    expect(result.claims.type).toBe('security_finding');
  });

  // 2. junior tier
  test('valid with track_record (47 findings, 0.74 valid_rate) → junior', async () => {
    const jwt = await signFinding(primaryKp, {
      track_record: {
        findings_submitted: 47,
        valid_rate: 0.74,
        false_positive_rate: 0.09,
        avg_severity: 6.2,
      },
    });
    const result = await verifyFinding(jwt, { jwksUrl });
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('expected valid');
    expect(result.trustTier).toBe('junior');
    expect(result.agent.track_record?.findings_submitted).toBe(47);
  });

  // 3. elite tier
  test('elite tier — 220 findings, 0.88 valid_rate, 7.5 avg_severity', async () => {
    const jwt = await signFinding(primaryKp, {
      track_record: {
        findings_submitted: 220,
        valid_rate: 0.88,
        false_positive_rate: 0.05,
        avg_severity: 7.5,
      },
    });
    const result = await verifyFinding(jwt, { jwksUrl });
    if (!result.valid) throw new Error('expected valid');
    expect(result.trustTier).toBe('elite');
  });

  // 4. senior boundary
  test('senior boundary — 50 findings, 0.70 valid_rate, 0.149 false_positive', async () => {
    const jwt = await signFinding(primaryKp, {
      track_record: {
        findings_submitted: 50,
        valid_rate: 0.7,
        false_positive_rate: 0.149,
        avg_severity: 6.0,
      },
    });
    const result = await verifyFinding(jwt, { jwksUrl });
    if (!result.valid) throw new Error('expected valid');
    expect(result.trustTier).toBe('senior');
  });

  // 5. unranked (missing track_record)
  test('unranked when track_record absent', async () => {
    const jwt = await signFinding(primaryKp);
    const result = await verifyFinding(jwt, { jwksUrl });
    if (!result.valid) throw new Error('expected valid');
    expect(result.trustTier).toBe('unranked');
    expect(result.agent.track_record).toBeUndefined();
  });

  // 6. malformed token
  test('malformed token → reason: malformed', async () => {
    const result = await verifyFinding('not.a.jwt', { jwksUrl });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.reason).toBe('malformed');
  });

  // 7. bad signature (signed with secondary key not in JWKS)
  test('bad signature → reason: signature_invalid', async () => {
    const jwt = await signFinding(secondaryKp); // signed with primary kid in header? No — secondaryKp.kid
    // Force-rewrite header.kid to primaryKp.kid so the resolver finds *a* key,
    // but signature verification fails against it.
    const parts = jwt.split('.');
    const hdr = JSON.parse(
      Buffer.from(parts[0]!, 'base64url').toString('utf-8'),
    );
    hdr.kid = primaryKp.kid;
    const newHdr = Buffer.from(JSON.stringify(hdr))
      .toString('base64url')
      .replace(/=/g, '');
    const tampered = `${newHdr}.${parts[1]}.${parts[2]}`;

    const result = await verifyFinding(tampered, { jwksUrl });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.reason).toBe('signature_invalid');
  });

  // 8. wrong type
  test('wrong type → reason: wrong_type', async () => {
    const jwt = await signFinding(primaryKp, { type: 'aat' });
    const result = await verifyFinding(jwt, { jwksUrl });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.reason).toBe('wrong_type');
  });

  // 9. missing required fields
  test('missing required fields (no finding.evidence_hash) → reason: missing_required_fields', async () => {
    const jwt = await signFinding(primaryKp, {
      finding: { evidence_hash: undefined as unknown as string },
    });
    const result = await verifyFinding(jwt, { jwksUrl });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.reason).toBe('missing_required_fields');
    expect(result.error).toContain('evidence_hash');
  });

  // 10. audience mismatch
  test('audience mismatch → reason: audience_mismatch', async () => {
    const jwt = await signFinding(primaryKp, { aud: 'https://agentlair.dev' });
    const result = await verifyFinding(jwt, {
      jwksUrl,
      audience: 'https://hackerone.com',
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.reason).toBe('audience_mismatch');
  });

  // 11. audience array
  test('audience array allows multiple identities', async () => {
    const jwt = await signFinding(primaryKp, { aud: 'https://agentlair.dev' });
    const result = await verifyFinding(jwt, {
      jwksUrl,
      audience: ['https://hackerone.com', 'https://agentlair.dev'],
    });
    expect(result.valid).toBe(true);
  });

  // 12. expired (iat 31 days ago, maxAge: '30d')
  test('expired — iat 31 days ago + maxAge 30d → reason: expired', async () => {
    const iat = Math.floor(Date.now() / 1000) - 31 * 24 * 3600;
    const jwt = await signFinding(primaryKp, { iat });
    const result = await verifyFinding(jwt, { jwksUrl, maxAge: '30d' });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.reason).toBe('expired');
  });

  // 13. requireFindingType=false bypass
  test('requireFindingType=false bypass — wrong type token passes (if finding body present)', async () => {
    const jwt = await signFinding(primaryKp, { type: 'aat' });
    const result = await verifyFinding(jwt, {
      jwksUrl,
      requireFindingType: false,
    });
    expect(result.valid).toBe(true);
  });

  // 14. classifyTrustTier — direct unit
  test('classifyTrustTier — boundary inputs', () => {
    // unranked
    expect(classifyTrustTier(undefined)).toBe('unranked');
    expect(classifyTrustTier({ findings_submitted: 9, valid_rate: 1.0 })).toBe(
      'unranked',
    );
    // junior boundary low
    expect(
      classifyTrustTier({ findings_submitted: 10, valid_rate: 0.5 }),
    ).toBe('junior');
    // junior boundary high (49)
    expect(
      classifyTrustTier({ findings_submitted: 49, valid_rate: 0.5 }),
    ).toBe('junior');
    // junior valid_rate too low → unranked
    expect(
      classifyTrustTier({ findings_submitted: 20, valid_rate: 0.4 }),
    ).toBe('unranked');
    // senior boundary (50, 0.7, 0.149)
    expect(
      classifyTrustTier({
        findings_submitted: 50,
        valid_rate: 0.7,
        false_positive_rate: 0.149,
      }),
    ).toBe('senior');
    // senior false_positive_rate too high → unranked (50 isn't junior either)
    expect(
      classifyTrustTier({
        findings_submitted: 50,
        valid_rate: 0.7,
        false_positive_rate: 0.15,
      }),
    ).toBe('unranked');
    // elite
    expect(
      classifyTrustTier({
        findings_submitted: 200,
        valid_rate: 0.85,
        false_positive_rate: 0.05,
        avg_severity: 7.0,
      }),
    ).toBe('elite');
  });

  // 15. JWKS cache reuse
  test('JWKS cache reuse — two verifyFinding calls share the same cached fetcher', async () => {
    const jwt1 = await signFinding(primaryKp);
    const jwt2 = await signFinding(primaryKp, {
      jti: 'finding_bbbbbbbbbbbbbbbbbbbbb',
    });
    const before = jwksFetchCount;
    const r1 = await verifyFinding(jwt1, { jwksUrl });
    const r2 = await verifyFinding(jwt2, { jwksUrl });
    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(true);
    // jose's createRemoteJWKSet caches; expect 1 fetch total for these 2 verifies.
    expect(jwksFetchCount - before).toBe(1);
  });
});

describe('verifyFindingPermalink', () => {
  // 16. permalink happy path — must use https:// URL because the SDK enforces it.
  test('verifyFindingPermalink happy path', async () => {
    const jti = 'finding_ccccccccccccccccccccc';
    const jwt = await signFinding(primaryKp, { jti });
    storedPermalinks.set(jti, {
      body: {
        jti,
        signed_jwt: jwt,
      },
    });

    // The SDK's permalink regex requires https://. To exercise the success
    // path against the local http stub, we patch globalThis.fetch to rewrite
    // the request URL while keeping the SDK's URL validator happy.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const reqUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const rewritten = reqUrl.replace(
        'https://agentlair.dev',
        permalinkBaseUrl,
      );
      return originalFetch(rewritten, init);
    }) as typeof globalThis.fetch;

    try {
      const result = await verifyFindingPermalink(
        `https://agentlair.dev/v1/findings/${jti}`,
        { jwksUrl },
      );
      expect(result.valid).toBe(true);
      if (!result.valid) throw new Error('expected valid');
      expect(result.jti).toBe(jti);
      expect(result.finding.severity).toBe('HIGH');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 17. invalid URL — does not match /v1/findings/finding_<21>
  test('verifyFindingPermalink — invalid URL pattern → reason: invalid_url', async () => {
    const result = await verifyFindingPermalink(
      'https://example.com/not-a-finding',
      { jwksUrl },
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid');
    expect(result.reason).toBe('invalid_url');
  });

  // 18. jti mismatch
  test('verifyFindingPermalink — jti mismatch → reason: malformed', async () => {
    const urlJti = 'finding_ddddddddddddddddddddd';
    const jwtJti = 'finding_eeeeeeeeeeeeeeeeeeeee';
    const jwt = await signFinding(primaryKp, { jti: jwtJti });
    // Stash under URL's jti, but stick the mismatched JWT inside.
    // body.jti is left undefined (so the body-level check passes; only the
    // signed-JWT jti differs from the URL segment).
    storedPermalinks.set(urlJti, {
      body: { signed_jwt: jwt },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const reqUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const rewritten = reqUrl.replace(
        'https://agentlair.dev',
        permalinkBaseUrl,
      );
      return originalFetch(rewritten, init);
    }) as typeof globalThis.fetch;

    try {
      const result = await verifyFindingPermalink(
        `https://agentlair.dev/v1/findings/${urlJti}`,
        { jwksUrl },
      );
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.reason).toBe('malformed');
      expect(result.error.toLowerCase()).toContain('jti mismatch');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 19. fetch_failed on non-200
  test('verifyFindingPermalink — non-200 response → reason: fetch_failed', async () => {
    const urlJti = 'finding_fffffffffffffffffffff';
    // Don't store the permalink — stub returns 404.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const reqUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const rewritten = reqUrl.replace(
        'https://agentlair.dev',
        permalinkBaseUrl,
      );
      return originalFetch(rewritten, init);
    }) as typeof globalThis.fetch;

    try {
      const result = await verifyFindingPermalink(
        `https://agentlair.dev/v1/findings/${urlJti}`,
        { jwksUrl },
      );
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.reason).toBe('fetch_failed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 20. fetchPermalink on verifyFinding routes to permalink path
  test('verifyFinding({fetchPermalink: true}) routes URL inputs through permalink path', async () => {
    const jti = 'finding_ggggggggggggggggggggg';
    const jwt = await signFinding(primaryKp, { jti });
    storedPermalinks.set(jti, { body: { jti, signed_jwt: jwt } });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const reqUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const rewritten = reqUrl.replace(
        'https://agentlair.dev',
        permalinkBaseUrl,
      );
      return originalFetch(rewritten, init);
    }) as typeof globalThis.fetch;

    try {
      const result = await verifyFinding(
        `https://agentlair.dev/v1/findings/${jti}`,
        { jwksUrl, fetchPermalink: true },
      );
      expect(result.valid).toBe(true);
      if (!result.valid) throw new Error('expected valid');
      expect(result.jti).toBe(jti);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
