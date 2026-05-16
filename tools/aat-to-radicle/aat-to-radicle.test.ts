/**
 * Tests for aat-to-radicle CLI. Uses WebCrypto Ed25519 to generate real
 * signing keypairs and mint test AATs — so signature verification is genuine,
 * not stubbed.
 */
import { test, expect, describe } from "bun:test";
import {
  decodeAAT,
  verifySignature,
  didWebToUrl,
  parseArgs,
  runPipeline,
  b64urlDecode,
  type RunDeps,
} from "./aat-to-radicle";

// ─── helpers ──────────────────────────────────────────────────────────────

function b64urlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

interface Mint {
  aat: string;
  jwks: { keys: Array<Record<string, string>> };
  pubKeyJwk: { kty: string; crv: string; x: string; kid: string };
}

async function mintAAT(payload: Record<string, unknown>, kid = "test-kid"): Promise<Mint> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" } as unknown as AlgorithmIdentifier,
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pubJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as { x: string };
  const headerB64 = b64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid }));
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" } as unknown as AlgorithmIdentifier,
      pair.privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return {
    aat: `${signingInput}.${b64urlEncode(sig)}`,
    pubKeyJwk: { kty: "OKP", crv: "Ed25519", x: pubJwk.x, kid },
    jwks: { keys: [{ kty: "OKP", crv: "Ed25519", x: pubJwk.x, kid, alg: "EdDSA", use: "sig" }] },
  };
}

const FIXTURE_NID = "did:key:z6MkrGqF8v63t6gwTGuZLnYGTQsCA7VMzjAcuRJQNr6hMEaS";
const FIXTURE_DID = "did:web:agentlair.dev:agents:acc_test";
const FIXTURE_DID_DOC = {
  "@context": ["https://www.w3.org/ns/did/v1"],
  id: FIXTURE_DID,
  alsoKnownAs: [FIXTURE_NID],
};

function mockFetcher(map: Record<string, unknown>): RunDeps["fetchJson"] {
  return async (url: string) => {
    if (!(url in map)) throw new Error(`unmocked URL: ${url}`);
    return map[url];
  };
}

// ─── decode-* ─────────────────────────────────────────────────────────────

describe("decode", () => {
  test("decode-1: valid AAT extracts kid from header", async () => {
    const { aat } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID }, "kid-abc");
    const r = decodeAAT(aat);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.header.kid).toBe("kid-abc");
  });

  test("decode-2: valid AAT extracts al_nid from payload", async () => {
    const { aat } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const r = decodeAAT(aat);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.payload.al_nid).toBe(FIXTURE_NID);
  });

  test("decode-3: valid AAT extracts did claim", async () => {
    const { aat } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const r = decodeAAT(aat);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.payload.did).toBe(FIXTURE_DID);
  });
});

// ─── reject-* ─────────────────────────────────────────────────────────────

describe("reject", () => {
  test("reject-1: 2-segment input → exit 2", () => {
    const r = decodeAAT("aaa.bbb");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.exit).toBe(2);
  });

  test("reject-2: non-base64url segments → exit 2", () => {
    const r = decodeAAT("@@@.@@@.@@@");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.exit).toBe(2);
  });

  test("reject-3: missing al_nid → exit 2 (via runPipeline)", async () => {
    const { aat, jwks } = await mintAAT({ did: FIXTURE_DID }); // no al_nid
    const r = await runPipeline(aat, { format: "human", readStdin: false }, {
      fetchJson: mockFetcher({
        "https://agentlair.dev/.well-known/jwks.json": jwks,
        "https://agentlair.dev/agents/acc_test/did.json": FIXTURE_DID_DOC,
      }),
    });
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain("al_nid");
  });
});

// ─── signature-* ──────────────────────────────────────────────────────────

describe("signature", () => {
  test("signature-1: tampered payload → exit 3", async () => {
    const { aat, jwks } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID }, "kid-tamper");
    // Tamper: substitute a valid-JSON payload with different content. Signature
    // won't match because signing input changed, but JSON still parses cleanly.
    const parts = aat.split(".");
    const newPayload = b64urlEncode(
      JSON.stringify({ al_nid: FIXTURE_NID, did: FIXTURE_DID, evil: true }),
    );
    const tamperedAAT = `${parts[0]}.${newPayload}.${parts[2]}`;
    const r = await runPipeline(tamperedAAT, { format: "human", readStdin: false }, {
      fetchJson: mockFetcher({
        "https://agentlair.dev/.well-known/jwks.json": jwks,
        "https://agentlair.dev/agents/acc_test/did.json": FIXTURE_DID_DOC,
      }),
    });
    expect(r.exit).toBe(3);
    expect(r.stderr).toContain("signature verification FAILED");
  });

  test("signature-2: signature OK with correct JWKS", async () => {
    const { aat, jwks } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const decoded = decodeAAT(aat);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(await verifySignature(decoded.value, jwks)).toBe(true);
  });
});

// ─── did-mismatch-* ───────────────────────────────────────────────────────

describe("did-mismatch", () => {
  test("did-mismatch-1: aka does not include nid → exit 4", async () => {
    const { aat, jwks } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const r = await runPipeline(aat, { format: "human", readStdin: false }, {
      fetchJson: mockFetcher({
        "https://agentlair.dev/.well-known/jwks.json": jwks,
        "https://agentlair.dev/agents/acc_test/did.json": {
          ...FIXTURE_DID_DOC,
          alsoKnownAs: ["did:key:z6MkSomeOtherKey"],
        },
      }),
    });
    expect(r.exit).toBe(4);
    expect(r.stderr).toContain("NOT in DID doc");
  });
});

// ─── format-* ─────────────────────────────────────────────────────────────

describe("format", () => {
  test("format-1: default human output contains checkmarks and NID", async () => {
    const { aat, jwks } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const r = await runPipeline(aat, { format: "human", readStdin: false }, {
      fetchJson: mockFetcher({
        "https://agentlair.dev/.well-known/jwks.json": jwks,
        "https://agentlair.dev/agents/acc_test/did.json": FIXTURE_DID_DOC,
      }),
    });
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("✓ AAT signature verified");
    expect(r.stdout).toContain("✓ al_nid matches DID doc");
    expect(r.stdout).toContain(FIXTURE_NID);
    expect(r.stdout).toContain("rad id update");
    expect(r.stdout).toContain("--delegate");
  });

  test("format-2: --format json emits structured payload", async () => {
    const { aat, jwks } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const r = await runPipeline(aat, { format: "json", readStdin: false }, {
      fetchJson: mockFetcher({
        "https://agentlair.dev/.well-known/jwks.json": jwks,
        "https://agentlair.dev/agents/acc_test/did.json": FIXTURE_DID_DOC,
      }),
    });
    expect(r.exit).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.nid).toBe(FIXTURE_NID);
    expect(obj.verified).toBe(true);
    expect(obj.did).toBe(FIXTURE_DID);
    expect(Array.isArray(obj.also_known_as)).toBe(true);
    expect(obj.rad_command).toContain("rad id update");
    expect(obj.rad_command).toContain("--delegate");
    expect(Array.isArray(obj.verify_recipe)).toBe(true);
  });

  test("format-3: --format sh emits a single rad delegate line", async () => {
    const { aat, jwks } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const r = await runPipeline(aat, { format: "sh", readStdin: false }, {
      fetchJson: mockFetcher({
        "https://agentlair.dev/.well-known/jwks.json": jwks,
        "https://agentlair.dev/agents/acc_test/did.json": FIXTURE_DID_DOC,
      }),
    });
    expect(r.exit).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^rad id update --delegate did:key:z6Mk/);
  });
});

// ─── e2e-* ────────────────────────────────────────────────────────────────

describe("e2e", () => {
  test("e2e-1: full pipeline with mocked fetch → exit 0", async () => {
    const { aat, jwks } = await mintAAT(
      {
        iss: "https://agentlair.dev",
        sub: "acc_test",
        did: FIXTURE_DID,
        al_nid: FIXTURE_NID,
        al_scopes: ["read"],
      },
      "kid-e2e",
    );
    const calls: string[] = [];
    const r = await runPipeline(aat, { format: "human", readStdin: false }, {
      fetchJson: async (url) => {
        calls.push(url);
        if (url === "https://agentlair.dev/.well-known/jwks.json") return jwks;
        if (url === "https://agentlair.dev/agents/acc_test/did.json") return FIXTURE_DID_DOC;
        throw new Error(`unmocked: ${url}`);
      },
    });
    expect(r.exit).toBe(0);
    expect(calls).toContain("https://agentlair.dev/.well-known/jwks.json");
    expect(calls).toContain("https://agentlair.dev/agents/acc_test/did.json");
  });

  test("e2e-2: network failure on JWKS fetch → exit 5", async () => {
    const { aat } = await mintAAT({ al_nid: FIXTURE_NID, did: FIXTURE_DID });
    const r = await runPipeline(aat, { format: "human", readStdin: false }, {
      fetchJson: async () => {
        throw new Error("network unreachable");
      },
    });
    expect(r.exit).toBe(5);
    expect(r.stderr).toContain("network error");
  });
});

// ─── helpers / parsing ────────────────────────────────────────────────────

describe("misc", () => {
  test("didWebToUrl: standard agentlair did:web maps correctly", () => {
    expect(didWebToUrl("did:web:agentlair.dev:agents:acc_pico")).toBe(
      "https://agentlair.dev/agents/acc_pico/did.json",
    );
  });

  test("parseArgs: --format sh parses", () => {
    const r = parseArgs(["--format", "sh"]);
    expect("format" in r ? r.format : null).toBe("sh");
  });

  test("parseArgs: unknown flag → exit 2", () => {
    const r = parseArgs(["--unknown"]);
    expect("error" in r ? r.exit : null).toBe(2);
  });
});
