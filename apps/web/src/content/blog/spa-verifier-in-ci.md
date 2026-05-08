---
title: "Verify skills in CI in 5 lines"
description: "Signing a skill proves it came from you. But the signature only holds if something checks it. Here's how to wire that check into your PR pipeline."
pubDate: 2026-05-06
authorName: "Pico"
---

Signing a skill proves it left your hands intact. But a signature no one checks is a statement no one reads. The missing half is verification at install time — specifically, on the PR that brings a skill into your codebase.

This is what `@agentlair/spa-verifier` 0.2.0 adds: a GitHub Actions workflow that blocks unsigned or tampered skills before they merge.

---

## Why signing alone isn't enough

The supply chain attack window doesn't open at publish time. It opens between publish and install: registry tampering, dependency confusion, a compromised mirror. By the time the skill reaches your agent loop, the signature is history.

The only enforcement point that matters is the moment before it lands in your repo. That's a PR check.

## Five lines

```yaml
- uses: oven-sh/setup-bun@v2
- name: Verify skill provenance
  run: bunx --bun @agentlair/spa-verifier ./skills/my-skill --json
```

Exit code `0` means the skill is cryptographically tied to its declared publisher and the bytes haven't changed since signing. Exit code `1` blocks the merge. Exit code `2` flags an unsigned skill — your call whether to block or warn.

The `--json` flag outputs the full verification result so your CI logs have context when something fails:

```json
{
  "verified": false,
  "digest_match": false,
  "computed_digest": "sha256-MYMQHVvN...",
  "claimed_digest": "sha256-NDOawr5c...",
  "errors": ["digest_mismatch"]
}
```

## Detecting what changed

In a monorepo with 40 skills, you don't want to verify every directory on every PR. The full workflow detects which skill directories changed in the PR, verifies only those, and posts a comment summary:

```yaml
name: Verify skill provenance

on:
  pull_request:
    paths:
      - 'skills/**'

jobs:
  spa-verify:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Verify changed skills
        run: |
          CHANGED=$(git diff --name-only origin/${{ github.base_ref }}...HEAD \
            | grep '^skills/' | cut -d/ -f1-2 | sort -u)

          FAILED=0
          while IFS= read -r skill_dir; do
            [ -d "$skill_dir" ] || continue
            bunx --bun @agentlair/spa-verifier "$skill_dir" --json || FAILED=1
          done <<< "$CHANGED"
          exit $FAILED
```

The complete version — with PR comments and a formatted summary table — is in `examples/github-actions/verify-skill.yml` in the package.

## What the check actually does

`spa-verifier` reads `SKILL.sig` from the skill directory, computes a deterministic Ed25519/JWS digest over every file in the directory (sorted, bytewise, path-prefixed), and verifies the signature against the publisher's JWKS endpoint. Two failure modes:

- **digest_mismatch**: bytes changed after signing. Signature is valid but the files were touched.
- **signature_invalid**: the JWT was tampered with, or the key doesn't match the claimed publisher.

Both fail with exit code `1`. The distinction is in the JSON.

## Install

```bash
npm install @agentlair/spa-verifier
# or
bun add @agentlair/spa-verifier
```

Runs in Node ≥ 18, Bun, Deno, Cloudflare Workers, Vercel Edge — anywhere `crypto.subtle` exists. Zero dependencies.

0.2.0 ships today. Full docs: [npmjs.com/package/@agentlair/spa-verifier](https://www.npmjs.com/package/@agentlair/spa-verifier).
