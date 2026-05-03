# git-receipt: Verifiable SCITT Receipts for AI Commits

A git post-commit hook that attaches a verifiable SCITT receipt to every commit made by an AI agent.

## The Problem

`Co-Authored-By: GitHub Copilot <copilot@github.com>` is a metadata string. Anyone can type it. It proves nothing about what AI actually touched, who authorized the change, or whether the attribution is retroactive.

The real question isn't "did AI help?" — it's **who authorized this change, and under what scope?**

## What This Does

On every commit:

1. Sends `{commit_hash, authorized_by, repo_url}` to AgentLair's SCITT endpoint
2. Receives a Merkle-tree inclusion receipt from the [AgentLair Transparency Service](https://agentlair.dev)
3. Amends the commit with an `AgentLair-Receipt:` trailer

```
commit a3f9b2e
Author: Pico <pico@amdal.dev>
Date:   Sat May 3 14:22:01 2026 +0200

    feat: add SCITT receipt endpoint for git commits

    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
    AgentLair-Receipt: beda30c3e1cb13e5a4f2
```

The receipt is verifiable by anyone — no API key, no account:

```bash
curl https://agentlair.dev/v1/scitt/entries/beda30c3e1cb13e5a4f2/receipt \
  -H "Accept: application/scitt-receipt+cose" \
  --output receipt.cose

# The receipt is a COSE_Sign1 envelope with a Merkle inclusion proof.
# Verify offline using AgentLair's public key from:
# https://agentlair.dev/.well-known/jwks.json
```

## Install

```bash
cp post-commit /path/to/your/repo/.git/hooks/post-commit
chmod +x /path/to/your/repo/.git/hooks/post-commit

export AGENTLAIR_API_KEY=al_live_your_key_here
```

Get an API key at [agentlair.dev](https://agentlair.dev).

## Configuration

| Variable | Required | Description |
|---|---|---|
| `AGENTLAIR_API_KEY` | Yes | Your AgentLair API key (`al_live_...`) |
| `AGENTLAIR_AUTHORIZED_BY` | No | Who authorized the AI change. Defaults to `git user.name <user.email>` |
| `AGENTLAIR_API_BASE` | No | API base URL. Defaults to `https://api.agentlair.dev` |

## What Gets Recorded

The receipt attests to:

- **commit_hash** — the exact SHA-1 of this commit (cryptographically bound, not metadata)
- **authorized_by** — the human or system that authorized the AI-assisted change
- **agent_did** — the AgentLair DID of the agent account that submitted the receipt
- **timestamp** — when the receipt was issued by the Transparency Service

## API

### POST /v1/scitt/git-commits

Register a git commit as a SCITT Signed Statement.

```typescript
const response = await fetch('https://api.agentlair.dev/v1/scitt/git-commits', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer al_live_your_key_here',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    commit_hash: 'a3f9b2e...',          // 40-char SHA-1
    authorized_by: 'Håkon <hakon@...>', // who authorized the AI change
    repo_url: 'https://github.com/...',  // optional, for public verifiability
    message: 'feat: add SCITT receipts', // optional commit subject
  }),
});

// 201 Created
const {
  entry_id,    // use as AgentLair-Receipt trailer value
  receipt,     // base64 COSE Receipt (Merkle inclusion proof)
  receipt_url, // public URL — no auth required to verify
  leaf_index,
  tree_size,
  root_hash,
} = await response.json();
```

### GET /v1/scitt/entries/:entry_id/receipt (public)

Retrieve the raw COSE Receipt — no authentication required.

```bash
curl https://agentlair.dev/v1/scitt/entries/<entry_id>/receipt
# Returns: application/scitt-receipt+cose
```

## Why SCITT, Not Just a Signature

A signature over the commit hash proves AgentLair signed it. A SCITT Receipt proves it was **registered in an append-only transparency log** at a specific time.

You can't forge a Merkle inclusion proof without forking the entire tree. Anyone can verify the proof offline using AgentLair's public JWKS — no API call, no trust in the vendor's database.

This is the same guarantee that Certificate Transparency gives to TLS: not just "someone signed this," but "this was logged, and you can verify the log."

## Behavior

- **No-op when `AGENTLAIR_API_KEY` is unset** — safe to commit to shared repos
- **Non-blocking on API failure** — commit succeeds even if receipt registration fails
- **Amend-safe** — skips commits that already have an `AgentLair-Receipt:` trailer
- **No new dependencies** — requires only `curl` and `bash` (python3 for safe JSON encoding, falls back to sed)
