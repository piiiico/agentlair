#!/usr/bin/env bun
/**
 * aat-to-radicle — Convert an AgentLair AAT to a Radicle Node ID and verify
 * the binding against the issuer JWKS and the agent's did:web document.
 *
 * Usage:
 *   bun aat-to-radicle.ts < aat.jwt
 *   echo "$AAT" | bun aat-to-radicle.ts
 *   bun aat-to-radicle.ts --aat "$AAT" [--rid rad:z3...] [--format human|json|sh]
 *
 * Exit codes:
 *   0  success
 *   2  malformed input / missing al_nid
 *   3  signature invalid
 *   4  NID not in DID doc alsoKnownAs
 *   5  network / fetch error
 */

import { stdin } from "node:process";

export const AGENTLAIR_BASE = "https://agentlair.dev";

// ─── base64url ────────────────────────────────────────────────────────────
export function b64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("invalid base64url");
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ─── AAT decoding ─────────────────────────────────────────────────────────
export interface Decoded {
  header: { alg: string; typ?: string; kid: string };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}

export type DecodeResult =
  | { ok: true; value: Decoded }
  | { ok: false; exit: number; error: string };

export function decodeAAT(token: string): DecodeResult {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return {
      ok: false,
      exit: 2,
      error: "input is not a 3-segment JWT (header.payload.signature)",
    };
  }
  let header: Decoded["header"], payload: Record<string, unknown>, sig: Uint8Array;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    sig = b64urlDecode(parts[2]);
  } catch (e) {
    return { ok: false, exit: 2, error: `failed to decode JWT segments: ${(e as Error).message}` };
  }
  if (header.alg !== "EdDSA") {
    return { ok: false, exit: 2, error: `unsupported alg: ${header.alg} (expected EdDSA)` };
  }
  if (!header.kid || typeof header.kid !== "string") {
    return { ok: false, exit: 2, error: "AAT header missing kid" };
  }
  return { ok: true, value: { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: sig } };
}

// ─── Signature verification (WebCrypto Ed25519) ───────────────────────────
export async function verifySignature(decoded: Decoded, jwks: unknown): Promise<boolean> {
  const keys = (jwks as { keys?: Array<Record<string, string>> })?.keys ?? [];
  const jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) return false;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") return false;
  // SubtleCrypto.importKey JWK form for Ed25519
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: jwk.x },
    { name: "Ed25519" } as unknown as AlgorithmIdentifier,
    false,
    ["verify"],
  );
  const msg = new TextEncoder().encode(decoded.signingInput);
  return await crypto.subtle.verify(
    { name: "Ed25519" } as unknown as AlgorithmIdentifier,
    key,
    decoded.signature,
    msg,
  );
}

// ─── did:web → URL ────────────────────────────────────────────────────────
export function didWebToUrl(did: string): string {
  if (!did.startsWith("did:web:")) throw new Error(`unsupported DID method: ${did}`);
  const parts = did.slice("did:web:".length).split(":");
  if (parts.length < 2) throw new Error(`malformed did:web (need host:path): ${did}`);
  const [host, ...path] = parts;
  // Per W3C did:web spec: percent-decode each segment. We do not encode here —
  // AgentLair AATs only use ASCII account IDs, so the identity mapping is correct.
  return `https://${host}/${path.join("/")}/did.json`;
}

// ─── CLI surface ──────────────────────────────────────────────────────────
export type Format = "human" | "json" | "sh";
export interface CliArgs {
  aat?: string;
  rid?: string;
  format: Format;
  readStdin: boolean;
}

export function parseArgs(argv: string[]): CliArgs | { error: string; exit: number } {
  const a: CliArgs = { format: "human", readStdin: true };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--aat") {
      a.aat = argv[++i];
      a.readStdin = false;
    } else if (x === "--rid") {
      a.rid = argv[++i];
    } else if (x === "--format") {
      const f = argv[++i];
      if (f !== "human" && f !== "json" && f !== "sh") {
        return { error: `unknown --format value: ${f} (expected human|json|sh)`, exit: 2 };
      }
      a.format = f;
    } else if (x === "--help" || x === "-h") {
      return { error: "help", exit: 0 };
    } else {
      return { error: `unknown argument: ${x}`, exit: 2 };
    }
  }
  return a;
}

export interface RunDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

export interface RunResult {
  exit: number;
  stdout: string;
  stderr: string;
}

export async function runPipeline(token: string, args: CliArgs, deps: RunDeps): Promise<RunResult> {
  const decoded = decodeAAT(token);
  if (!decoded.ok) return { exit: decoded.exit, stdout: "", stderr: `aat-to-radicle: ${decoded.error}\n` };

  const nid = decoded.value.payload["al_nid"];
  const did = decoded.value.payload["did"];

  if (typeof nid !== "string" || nid.length === 0) {
    return {
      exit: 2,
      stdout: "",
      stderr:
        "aat-to-radicle: AAT carries no al_nid claim — register a signing key via POST /v1/agents/signing-keys first (see https://agentlair.dev/docs/al-nid).\n",
    };
  }
  if (!nid.startsWith("did:key:z6Mk")) {
    return {
      exit: 2,
      stdout: "",
      stderr: `aat-to-radicle: unexpected al_nid prefix (need did:key:z6Mk Ed25519 multicodec): ${nid}\n`,
    };
  }
  if (typeof did !== "string" || !did.startsWith("did:web:")) {
    return {
      exit: 2,
      stdout: "",
      stderr: `aat-to-radicle: AAT missing or malformed 'did' claim: ${String(did)}\n`,
    };
  }

  let jwks: unknown, didDoc: unknown;
  try {
    jwks = await deps.fetchJson(`${AGENTLAIR_BASE}/.well-known/jwks.json`);
    didDoc = await deps.fetchJson(didWebToUrl(did));
  } catch (e) {
    return { exit: 5, stdout: "", stderr: `aat-to-radicle: network error: ${(e as Error).message}\n` };
  }

  const sigOk = await verifySignature(decoded.value, jwks);
  if (!sigOk) {
    return {
      exit: 3,
      stdout: "",
      stderr: `aat-to-radicle: signature verification FAILED for kid=${decoded.value.header.kid}\n`,
    };
  }

  const aka = ((didDoc as { alsoKnownAs?: string[] })?.alsoKnownAs ?? []) as string[];
  if (!Array.isArray(aka) || !aka.includes(nid)) {
    return {
      exit: 4,
      stdout: "",
      stderr: `aat-to-radicle: al_nid (${nid}) NOT in DID doc alsoKnownAs: ${JSON.stringify(aka)}\n`,
    };
  }

  // Canonical Radicle CLI syntax — verified against heartwood rad-id.1.adoc.
  // There is no `rad delegate` subcommand; identity changes go through
  // `rad id update --delegate <DID>`. Run inside the repo working directory
  // (or pass --rid). Threshold bump may be required for multi-delegate repos.
  const ridFlag = args.rid ? ` --rid ${args.rid}` : "";
  const radCommand =
    `rad id update --title "Add AgentLair agent delegate" ` +
    `--description "Add agent ${did} as delegate (binding via al_nid claim)." ` +
    `--delegate ${nid}${ridFlag}`;
  const verifyRecipe = [
    `curl -s ${AGENTLAIR_BASE}/.well-known/jwks.json`,
    `curl -s ${didWebToUrl(did)} | jq -r '.alsoKnownAs[]'`,
    `# should print: ${nid}`,
  ];

  if (args.format === "json") {
    return {
      exit: 0,
      stdout: JSON.stringify(
        { nid, verified: true, did, also_known_as: aka, rad_command: radCommand, verify_recipe: verifyRecipe },
        null,
        2,
      ) + "\n",
      stderr: "",
    };
  }
  if (args.format === "sh") {
    // Pipe-friendly single line. Suitable for `eval` after manual review.
    return { exit: 0, stdout: `rad id update --delegate ${nid}\n`, stderr: "" };
  }
  const lines = [
    `✓ AAT signature verified (kid=${decoded.value.header.kid})`,
    `✓ al_nid matches DID doc alsoKnownAs`,
    ``,
    `NID (did:key):`,
    `  ${nid}`,
    ``,
    `Add as Radicle delegate:`,
    `  ${radCommand}`,
    ``,
    `Verify this binding:`,
    ...verifyRecipe.map((l) => `  ${l}`),
  ];
  return { exit: 0, stdout: lines.join("\n") + "\n", stderr: "" };
}

// ─── Default fetcher ──────────────────────────────────────────────────────
// Identifying User-Agent: issuer-side edges (Cloudflare Bot Management at
// agentlair.dev, equivalent at agent-passport.org) often challenge or block
// requests with a default runtime UA (`node`, `Bun/x.y`, empty). AAT
// conformance harnesses and JWKS verifiers must traverse those edges
// deterministically. Send a stable, informative UA so issuer logs can trace
// requests back to this tool version.
export const AAT_TO_RADICLE_USER_AGENT =
  "aat-to-radicle/0.2 (+https://agentlair.dev/docs/aat-to-radicle)";

export const defaultFetchJson: RunDeps["fetchJson"] = async (url: string) => {
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": AAT_TO_RADICLE_USER_AGENT,
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} ← ${url}`);
  return await r.json();
};

// ─── Entry point ──────────────────────────────────────────────────────────
async function readStdinAll(): Promise<string> {
  let buf = "";
  for await (const chunk of stdin) buf += chunk;
  return buf;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    if (parsed.error === "help") {
      process.stdout.write(
        "usage: bun aat-to-radicle.ts [--aat <AAT> | < AAT_FILE] [--rid rad:z...] [--format human|json|sh]\n",
      );
      process.exit(0);
    }
    process.stderr.write(`aat-to-radicle: ${parsed.error}\n`);
    process.exit(parsed.exit);
  }
  let aat = parsed.aat;
  if (!aat && parsed.readStdin) aat = (await readStdinAll()).trim();
  if (!aat) {
    process.stderr.write("aat-to-radicle: no AAT provided (pass via stdin or --aat).\n");
    process.exit(2);
  }
  const r = await runPipeline(aat, parsed, { fetchJson: defaultFetchJson });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.exit);
}

if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`aat-to-radicle: unexpected error: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
