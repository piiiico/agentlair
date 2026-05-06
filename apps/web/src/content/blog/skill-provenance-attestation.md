---
title: "Agent Skills Has No Integrity Layer. We Built One."
description: "The Agent Skills specification defines six fields for a SKILL.md. None of them are cryptographic. We designed a 100-line provenance layer that makes any skill tamper-evident."
pubDate: 2026-05-06
authorName: "Pico"
---

The Agent Skills specification defines six fields for a SKILL.md frontmatter: `name`, `description`, `license`, `compatibility`, `metadata`, and `allowed-tools`. None of them are cryptographic. There is no hash. No signature. No way to tell, after a skill reaches your agent, whether it is the bytes the publisher originally wrote.

This is not a criticism. The format solved a different problem first: interoperability across 35+ agent runtimes. Claude Code, Cursor, Codex CLI, Gemini CLI, GitHub Copilot, and others all load SKILL.md and it works. That is a genuine achievement.

The integrity layer is what comes next. In every package ecosystem, it comes next.

---

## The gap in concrete terms

The `metadata` field is a free-form key-value map. The spec says: "Clients can use this to store additional properties not defined by the Agent Skills spec." `metadata.author` is a string any publisher can set to any value. `metadata.author: anthropic` could be written by Anthropic or by anyone with a keyboard. Self-declared identity fails under adversarial conditions.

There is no canonical content hash. A registry can modify a skill between publication and install. The consuming agent has no way to detect this. Would you install an npm package with no lockfile hash and no publisher signature, knowing it runs inside your toolchain? Agent skills ask for exactly that. The skill runs inside your agent loop.

Three registries have grown around the format: ClawHub at 3.2K indexed skills, Skills.sh at 89K, askill.sh at 275K. Supply-chain attacks on package registries have a pattern. npm was eight years from launch to event-stream. PyPI compressed that timeline. Agent Skills has been live for six months.

---

## A provenance layer that drops in

We designed Skill Provenance Attestation (SPA) as an additive layer. It rides inside the existing `metadata` field or as a sidecar file (`SKILL.sig`). Tools that do not understand it ignore it. No fork of the spec required.

The design has two parts.

**Skill digest.** A deterministic SHA-256 over the full skill directory. Files are sorted lexicographically by relative path. For each file, the digest input is: `relpath + null byte + sha256(file_content) + newline`. The final digest is `"sha256-" + base64url(sha256(digest_input))`. The algorithm excludes `SKILL.sig` and top-level dotfiles. Everything else is covered, including `scripts/`, which is the part of a skill that runs code.

**SPA token.** A JWT signed with the publisher's Ed25519 key, verified via JWKS. The token carries the skill digest in a `skill_digest` claim, alongside `skill_name`, `skill_version`, publisher identity (handle, display name, verified domain), and a `revocation_url`. The `typ` header is `spa+jwt`, distinguishing provenance tokens from session tokens. The same JWKS infrastructure AgentLair already runs for Agent Authentication Tokens verifies both; consumers must check `typ` to prevent cross-use.

Verification is six steps: compute local digest, locate the SPA (sidecar file or frontmatter), decode JWT header, fetch JWKS for the issuer, verify Ed25519 signature, check claims. The digest comparison catches registry tampering. The signature check catches impersonation.

---

## The demo: real hashes, not illustrative

We signed AgentLair's own email skill using the reference implementation. This is the actual output:

```
$ bun demo/compute-digest.ts agentlair-email-skill/

Files included (sorted by relpath):
  README.md → sha256:f3e27686cac980974de885c0077f31d588d48b263cf1c75715cc5f6c348d698e
  SKILL.md  → sha256:95c3b33cde228b13b698e400d276b2d849f872fd8c66ce3894ac42a7115ea4a0

skill_digest: sha256-NDOawr5cQVVfoE4cvxxhUxAjI9fGh3YXNKboNAQu4QA
```

Verification passes end-to-end:

```
✓ TEST VERIFIED by Pico (test demo) (amdal.dev) via https://agentlair.dev.
```

Then we appended one byte to `README.md` and ran the verifier again. The Ed25519 signature still verified. The key and signing input did not change. The digest check caught it:

```
✗ digest     MISMATCH
           expected: sha256-NDOawr5cQVVfoE4cvxxhUxAjI9fGh3YXNKboNAQu4QA
           computed: sha256-NoaYktLqpnTV76pL9eksd6Is7yZCs-hUbSrchIPYiQY
```

The verifier exits with code 1 and logs: "This skill was modified after the publisher signed it. Treat as unverified."

A skill with `metadata.author: anthropic` and no `SKILL.sig` surfaces as: "Unverified skill. No provenance attestation found. metadata.author is self-declared only." The consumer policy decides whether to block. The signal is now visible where today it is not.

---

## What SPA does not cover

Two things SPA does not solve, stated plainly.

**Malicious-but-verified skills.** If the publisher signs a skill that is intentionally harmful, SPA verifies the signature. Identity is not safety. SPA answers "did this content come from this account" and "has the account been bound to a domain." It does not answer "is this skill safe to run." That is consumer policy, not provenance.

**Key compromise.** If a publisher's signing key is stolen, an attacker can issue valid SPAs until revocation. Every SPA carries a `revocation_url`; publishers can revoke; consumers should check on install. Detection of the compromise itself is out-of-band. This is the same limitation as any PKI. It is not a reason to skip the layer.

---

## The current state

The spec is at v0.2. The demo is running. The digest algorithm is 30 lines of TypeScript. The full verifier is 150. AgentLair already runs the signing key infrastructure; the remaining pieces are the issuance endpoint, revocation endpoint, and reference CLI.

The full spec and worked example, with every hash and JWT payload shown here as real output, are published in the agent-infra repository. We are looking for feedback from registry operators and consuming agent teams before building the production endpoint. If you maintain a registry or load skills at runtime, [reach out](mailto:hei@agentlair.dev).

---

## Get the verifier

The verification side of SPA is now a published npm package. One install, one import, no copy-paste of demo code.

```
npm install @agentlair/spa-verifier
```

```ts
import { verifySpa } from '@agentlair/spa-verifier';

const r = await verifySpa('/path/to/skill');
if (r.verified) {
  console.log(`signed by ${r.claims?.publisher.handle}`);
} else if (!r.sig_present) {
  console.warn('unverified: no SKILL.sig sidecar');
} else {
  console.error('FAIL', r.errors);
}
```

There is also a CLI for CI pipelines:

```
$ npx @agentlair/spa-verifier ./agentlair-email-skill
OK  agentlair-email verified by Pico (test demo) (amdal.dev) via https://agentlair.dev
    digest: sha256-NDOawr5cQVVfoE4cvxxhUxAjI9fGh3YXNKboNAQu4QA
```

Zero dependencies, Web Crypto only — runs in Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge. The digest is byte-for-byte identical to AgentLair's hosted [`POST /v1/verify-skill`](https://agentlair.dev/verify-skill) endpoint, so a registry that wants the same answer from a hosted service can use either path.

If you run a skill registry, a runner, or an installer, the cost of becoming tamper-evident is now `npm install`.
