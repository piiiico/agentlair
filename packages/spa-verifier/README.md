# @agentlair/spa-verifier

Verify **Skill Provenance Attestations (SPA)** for AI agent skill directories. One install, one import — confirm a skill was signed by the publisher it claims, and hasn't been modified since.

Zero dependencies. Web Crypto only. Runs in Node.js, Bun, Deno, Cloudflare Workers, Vercel Edge, browsers — anywhere `crypto.subtle` exists.

> **What is SPA?** A standardised Ed25519/JWS attestation for agent skill directories: a sidecar `SKILL.sig` file commits the publisher's identity to the bytewise digest of the skill. Read [Agent Skills Has No Integrity Layer. We Built One.](https://agentlair.dev/blog/skill-provenance-attestation/) for the design rationale.

## Install

```bash
npm install @agentlair/spa-verifier
# or
bun add @agentlair/spa-verifier
# or
pnpm add @agentlair/spa-verifier
```

## Quick start — verify a directory

```ts
import { verifySpa } from '@agentlair/spa-verifier';

const result = await verifySpa('/path/to/skill');

if (result.verified) {
  const { handle, display_name, domain } = result.claims!.publisher;
  console.log(`OK  signed by ${display_name ?? handle} (${domain})`);
} else if (!result.sig_present) {
  console.warn('? unverified: no SKILL.sig sidecar');
} else {
  console.error('FAIL', result.errors);
}
```

## CLI — `spa-verify`

```bash
$ npx spa-verify ./agentlair-email-skill
OK  agentlair-email verified by Pico (test demo) (amdal.dev) via https://agentlair.dev [TEST SPA]
    digest: sha256-NDOawr5cQVVfoE4cvxxhUxAjI9fGh3YXNKboNAQu4QA

$ npx spa-verify ./tampered-skill
FAIL  ./tampered-skill
    digest mismatch:
      computed: sha256-7QBA2I_o…
      claimed:  sha256-NDOawr5c…
    error: digest_mismatch
```

Exit codes: `0` verified, `1` failed, `2` no `SKILL.sig`, `3` usage error.

Drop into CI:

```yaml
- name: Verify skill provenance
  run: npx -y @agentlair/spa-verifier ./skills/my-skill
```

## API

### `verifySpa(skillDir, options?) → Promise<SpaVerifyResult & { sig_present }>`

Read `<skillDir>/SKILL.sig`, compute the canonical digest from every non-excluded file, and verify the Ed25519 signature against the issuer's JWKS.

```ts
const r = await verifySpa('/path/to/skill', {
  localJwks,                                              // skip the network fetch
  jwksUrl: 'https://agentlair.dev/.well-known/jwks.json', // override the issuer-derived URL
  sigPath: '/custom/SKILL.sig',                           // override the sig location
});
```

Returns:

```ts
{
  verified: boolean;             // sig + digest both check out
  signature_valid: boolean;
  digest_match: boolean;
  signer: string | null;         // claims.publisher.handle, or null
  computed_digest: string;       // "sha256-…"
  claimed_digest: string;        // claimed in JWT
  claims: SpaClaims | null;      // null only on parse failure
  errors: string[];              // empty when verified=true
  sig_present: boolean;          // false → unverified, no attestation
}
```

### `verifySpaJwt(jwt, files, options?) → Promise<SpaVerifyResult>`

Lower-level: verify a JWT string against in-memory files. Useful for registries, scanners, and edge runtimes where you read files yourself (e.g. from R2, S3, a database).

```ts
import { verifySpaJwt } from '@agentlair/spa-verifier/core';

const files = [
  { path: 'SKILL.md', content: skillBytes },
  { path: 'README.md', content: readmeBytes },
];

const result = await verifySpaJwt(skillSigJwt, files, { localJwks });
```

Importing from `@agentlair/spa-verifier/core` skips the `node:fs` import — handy for edge bundles.

### `computeDigest(files) → Promise<string>`

The canonical SPA digest. Bytewise identical to AgentLair's hosted `/v1/verify-skill` endpoint and to the demo CLI in the [skill-provenance repo](https://github.com/piiiico/agentlair).

```ts
const digest = await computeDigest(files);  // "sha256-…"
```

### `parseSpaToken(jwt) → ParsedSpa`

Decode a JWT into header + claims + signing input + signature without verifying. Useful for inspecting the kid before fetching JWKS.

### `readSkillDir(skillDir) → SkillFile[]`

Walk a skill directory and return the canonical file list with these exclusions, applied at the top level:

- `SKILL.sig` (the sidecar attestation itself)
- Top-level dotfiles and dotdirs (`.git`, `.DS_Store`, `.cursorignore`, etc.)

Paths in the result are POSIX-relative, regardless of host OS. (You generally don't need to call this directly; `verifySpa` handles it.)

## Algorithm (mirrors the spec exactly)

```
sorted = files sorted by path (UTF-8 lex order)
for each file in sorted:
  digest_input ||= path_bytes || 0x00 || sha256(content) || 0x0A
skill_digest  = "sha256-" || base64url(sha256(digest_input))
```

The JWT itself is JWS over Ed25519 with `typ: "spa+jwt"` and a publisher-bound claim set. Full spec: [`SPEC.md`](https://github.com/piiiico/agentlair/blob/main/projects/agent-infra/skill-provenance/SPEC.md).

## Why this exists

A `metadata.author` field in `SKILL.md` is whatever the directory's last writer typed. There's no mechanical way to ask: *"Did the publisher actually publish this exact byte sequence?"*

SPA closes that gap with a Ed25519/JWS signature over a deterministic directory digest. This package is the verifier — drop-in, runs anywhere, takes one line.

| Without SPA | With SPA |
|---|---|
| `metadata.author: "research-corp"` is self-declared | `SKILL.sig` is a JWS commitment to the bytes |
| `git clone` could ship anyone's edits | `npx spa-verify` flags any modification |
| Ad-hoc `gpg --verify` instructions in READMEs | One install, one CLI call, structured exit codes |

## Compatibility

- Node.js ≥ 18 (Web Crypto + Ed25519 in stable)
- Bun (any version)
- Deno (any version)
- Cloudflare Workers, Vercel Edge — import from `@agentlair/spa-verifier/core` (no `node:fs`)
- Browsers (via `core` entry; pass files in manually)

## Live verifier

Don't want to install? Use the hosted endpoint:

```bash
curl -X POST https://agentlair.dev/v1/verify-skill \
  -H 'content-type: application/json' \
  -d '{"skill_sig": "<jwt>", "files": [{"path": "SKILL.md", "content_base64": "..."}]}'
```

Same algorithm, same result.

## License

MIT — [AgentLair](https://agentlair.dev)
