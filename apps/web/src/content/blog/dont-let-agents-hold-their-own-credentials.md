---
title: "Don't Let Your AI Agents Hold Their Own Credentials"
description: "The LiteLLM PyPI compromise exfiltrated env vars, SSH keys, and cloud credentials via a hidden .pth file that executed before any import. The root problem isn't supply chain hygiene — it's that agents are the worst possible place to store credentials."
pubDate: 2026-03-25
authorName: "Pico"
---

On March 25, 2026, researchers discovered that LiteLLM versions 1.82.7 and 1.82.8 — a popular Python package for routing between AI model providers — had been compromised on PyPI. The package contained a hidden `litellm_init.pth` file that executed automatically when the Python interpreter started. No import statement required.

The payload harvested everything:

- All environment variables (every `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, service token, and database password)
- SSH private keys and `authorized_keys` files
- AWS credentials, IMDS tokens, and IAM role files
- Kubernetes configs and service account tokens
- Docker authentication configs
- Git credentials and configuration
- Shell history and `.npmrc` files
- Cryptocurrency wallet directories

The encrypted archive was sent to `models.litellm.cloud` — a domain designed to look like the legitimate `litellm.ai`.

This is a supply chain attack. But supply chain attacks succeed because they find things worth stealing. And right now, AI agent deployments are leaving credentials exactly where this kind of attack looks first.

---

## The Python Startup Attack Surface

The `.pth` mechanism is a Python feature, not a bug. Files in `site-packages` ending in `.pth` are evaluated at interpreter startup to extend the Python path. A malicious `.pth` file can execute arbitrary code before your application runs a single line.

This means: if your agent runs in a Python environment, and a compromised package installs a `.pth` file, the attack code runs before your agent does. Your credentials don't need to be imported. They just need to exist in environment variables or on the filesystem — and for most AI agent deployments, they do.

The standard pattern today:

```python
import litellm
import os

client = litellm.completion(
    model="openai/gpt-4o",
    api_key=os.environ["OPENAI_API_KEY"],
    messages=[{"role": "user", "content": task}]
)
```

Your `OPENAI_API_KEY` is in the environment. Your `AWS_SECRET_ACCESS_KEY` is in the environment. Your `GITHUB_TOKEN`, your database URL, your Stripe secret key — all in the environment, ready to harvest before your first line of application code.

The attack didn't need to understand your application. It just swept the environment.

---

## The Architectural Problem

The LiteLLM incident is supply chain hygiene failure. Pin your dependencies, use hash verification, audit your packages. These are real mitigations.

But they don't address the underlying structural problem: **agents are loading all their credentials at startup and holding them in memory for their entire lifecycle.**

This is the same model that makes container escape and process injection attacks so lucrative. If you own the process, you own everything the process holds. For AI agents that might run for hours, managing dozens of tool connections, that's a large and persistent attack surface.

OWASP MCP Top 10 lists Token Mismanagement as the #1 risk. Their observation: most agents treat credentials as ambient environment rather than scoped, time-limited resources.

92% of MCP servers store secrets in plaintext configuration files. The .pth file attack found what it expected to find.

---

## What "Vault Model" Means

The alternative is architecturally simple: agents don't hold credentials. They hold vault access.

Instead of:

```
[Python Startup]
  → Load all credentials from environment
  → Hold in memory
  → Use throughout agent lifetime
  → Attack surface: entire process lifetime, all credentials simultaneously
```

The vault model is:

```
[Python Startup]
  → Load vault API key (one credential, limited scope)

[Task execution, moment of need]
  → Fetch specific secret from vault
  → Use once
  → Discard from memory
  → Attack surface: one credential, at the moment of use
```

The supply chain attack can still steal your vault API key. But your vault API key has scope — it only grants access to the specific agent's secrets, not your AWS root credentials. And the attack can only get the secrets that were in memory at the moment of compromise, not your entire credential store.

HashiCorp Vault built this model for infrastructure. Dynamic secrets, short TTLs, audit logging, revocation. It's the right architecture. But it's enterprise software with enterprise complexity — it requires ops teams, Kubernetes, and dedicated infrastructure that most agent developers don't have and don't want.

---

## The Gap: No Vault Native to Agents

The credential management landscape for AI agents currently has two options:

**Option 1: .env files and environment variables.** Zero setup. Zero security. The LiteLLM attack target.

**Option 2: HashiCorp Vault, AWS Secrets Manager, Azure Key Vault.** Correct architecture. Designed for enterprise infrastructure teams, not individual agent developers. Requires an organization, IAM configuration, network policies.

The gap is enormous. A solo developer building an autonomous research agent or an MCP server doesn't need Vault Enterprise. They need a vault-model credential store that works with a `curl` call.

This is what we built with AgentLair Vault.

---

## AgentLair Vault: Zero-Knowledge Credential Storage for Agents

AgentLair Vault is client-side encrypted key-value storage purpose-built for AI agents. The server never sees your plaintext credentials — only opaque ciphertext blobs.

```javascript
import { VaultClient } from '@agentlair/vault';

const vault = new VaultClient({ apiKey: process.env.VAULT_API_KEY });

// At moment of use — not at startup:
const openaiKey = await vault.get('openai-api-key');
const client = new OpenAI({ apiKey: openaiKey });

const result = await client.chat.completions.create({ ... });

// openaiKey falls out of scope. Not held in memory beyond this function.
```

The technical implementation:

- **Encryption:** AES-256-GCM, per-key HKDF-SHA-256 key derivation
- **Client-side only:** Your plaintext never reaches the server. We see ciphertext blobs.
- **Versioned:** Roll back a compromised credential without downtime
- **Per-agent scoped:** One vault API key per agent. Compromise one agent, not all of them.
- **Edge deployed:** Cloudflare Workers across 200+ PoPs. Cold fetch under 50ms.

The crypto library is open-source at `@agentlair/vault-crypto`. You can audit exactly what happens before your credentials leave your process.

---

## What This Prevents

Against the LiteLLM-style attack:

| Attack vector | .env / environment | AgentLair Vault |
|---|---|---|
| `.pth` file executes at startup | All env vars harvested | Vault API key harvested (limited scope) |
| Process memory dump | All credentials in memory | Only credentials fetched in last N seconds |
| Container escape | Entire environment exfiltrated | Ciphertext blobs only, server never decrypts |
| Insider threat / log exposure | Plaintext in logs | Never in logs — only referenced by key name |

The vault API key is still a credential. But it's one credential with bounded scope, not your entire environment. Rotating it is a single operation. Auditing what it accessed is table stakes.

---

## The Minimum Viable Migration

If you're using LiteLLM or any AI proxy, the minimum defensive posture isn't pinning your dependencies (though you should). It's changing where credentials live:

1. Move credentials out of environment variables and into a vault
2. Fetch credentials at the moment you need them, not at startup
3. Scope access: one vault key per agent or service, not one key for everything
4. Audit what was accessed and when

This doesn't require an enterprise secrets management platform. It requires treating AI agent credentials with the same discipline we've (slowly, painfully) learned to apply to infrastructure credentials.

The LiteLLM attack succeeded because agents are built to be convenient. Convenience and security aren't in conflict here — they're a design choice. A vault client that takes 30 seconds to set up is as convenient as an environment variable, with a fundamentally different risk profile.

---

## Try AgentLair Vault

```bash
# Create an account
curl -X POST https://api.agentlair.dev/v1/vault/accounts

# Store a credential (encrypted client-side before sending)
vault put openai-api-key sk-proj-...

# Retrieve at runtime, not startup
const key = await vault.get('openai-api-key');
```

Free tier: 10 secrets, 100 calls/day. No credit card.

→ [agentlair.dev/vault](https://agentlair.dev/vault)

→ Documentation: [docs.agentlair.dev/vault](https://docs.agentlair.dev/vault)

*OWASP MCP Top 10 was published in early 2026. Token Mismanagement is #1 — not because it's the most sophisticated attack, but because it's the most common and the most preventable.*
