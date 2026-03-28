---
title: "Don't Let Your Agents Hold Their Own Credentials"
description: "The LiteLLM supply chain attack exfiltrated everything in the environment. Here's the architectural reason — and the fix."
pubDate: 2026-03-25
authorName: "Pico"
---

On March 24, 2026, a threat actor known as **TeamPCP** published two backdoored versions of the `litellm` Python package to PyPI — versions 1.82.7 and 1.82.8. LiteLLM is the most popular LLM API gateway library, present in **36% of all cloud environments**, with 95 million monthly PyPI downloads.

The compromise was surgical. TeamPCP had previously stolen PyPI credentials by compromising Aqua Security's Trivy scanner through a poisoned GitHub Action. Using those credentials, they uploaded two modified releases approximately 22 hours after the Trivy attack.

## The Payload

**Version 1.82.7** injected 12 lines into `litellm/proxy/proxy_server.py`, between two legitimate code blocks. A double-base64-encoded payload of 34,460 characters executed whenever the proxy server module was imported. No `exec()` calls — the encoding was designed to evade static analysis.

**Version 1.82.8** escalated with a `.pth` file — `litellm_init.pth`. Python's `.pth` mechanism runs code at interpreter startup, before any import. This means the malware executed **every time Python launched**, whether or not LiteLLM was being used. No import needed. No explicit invocation.

The payload was a three-stage attack:

**Stage 1 — Orchestrator:** Coordinates the credential harvest, encrypts everything with AES-256-CBC and an RSA-4096 public key, and exfiltrates to `models.litellm.cloud` via HTTPS POST.

**Stage 2 — Credential Harvester (332 lines):** Systematically collected:
- Every environment variable on the system
- SSH private keys (`id_rsa`, `id_ed25519`, `id_ecdsa`)
- AWS credentials (including IMDS role tokens from metadata service)
- GCP `application_default_credentials.json`
- Azure `~/.azure/` directory
- Kubernetes service account tokens and secrets across all namespaces
- `.env` files recursively (up 6 directories)
- Database configs (`.pgpass`, `redis.conf`, `.mongorc.js`)
- Cryptocurrency wallet files
- TLS/SSL private keys (`.pem`, `.key`, `.p12`, `.pfx`)
- CI/CD secrets (`terraform.tfvars`, `terraform.tfstate`)
- Shell history

It also deployed privileged Kubernetes pods to every cluster node with `hostPID`, `hostNetwork`, and full root filesystem mounts — lateral movement via infrastructure-as-code.

**Stage 3 — Persistence:** A systemd service polling `checkmarx.zone/raw` every 50 minutes for additional binary payloads. After the initial credential theft, the attacker maintained persistent access.

PyPI quarantined both versions within approximately 3 hours. But for anyone who ran `pip install litellm` during that window — or whose CI pipeline pulled the latest version — the damage was done.

The safe version is **1.82.6** (or 1.82.9+).

---

## Why Environment Variables Are Structurally Vulnerable

Here's the thing: the TeamPCP malware wasn't sophisticated in *what* it stole. It just collected everything that was already there. And in a standard AI agent deployment, *everything is already there.*

This is the canonical pattern for using LLM APIs:

```python
import litellm
import os

response = litellm.completion(
    model="openai/gpt-4o",
    api_key=os.environ["OPENAI_API_KEY"],
    messages=[{"role": "user", "content": "Hello"}]
)
```

Your `OPENAI_API_KEY` is in the environment before the first line of your code executes. Your `ANTHROPIC_API_KEY`. Your `AWS_ACCESS_KEY_ID`. Your `DATABASE_URL`. Your `GITHUB_TOKEN`. Everything your agent needs to function is loaded at process startup and accessible for the entire lifetime of the process.

When TeamPCP's `.pth` file executed at Python startup, it didn't need to break any encryption. It didn't need to exploit any vulnerability in LiteLLM's code. It ran `os.environ` and walked the filesystem. The credentials were right where everyone puts them.

This isn't a LiteLLM problem. It's a **pattern problem**.

### The Numbers

- **92% of MCP servers** store secrets in plaintext configuration files (OWASP MCP Top 10)
- **45.6% of organizations** use shared API keys for their AI agents (RSAC 2026)
- Every major agent framework recommends `.env` files in their quickstart guide
- Docker Compose, Kubernetes pods, and CI/CD systems all inject secrets as environment variables

The supply chain attack didn't exploit an unusual configuration. It exploited **the standard configuration**. The one in every tutorial. The one in every quickstart guide. The one running in production right now.

### The Blast Radius Problem

When credentials live in the environment, a single compromise gives the attacker *everything*. Not just the LLM API key — but database access, cloud provider credentials, SSH keys, and anything else loaded at startup. There's no compartmentalization. No scoping. No audit trail of what was accessed. The blast radius is the entire credential surface.

This is the opposite of how mature infrastructure handles secrets. No serious production system loads every database password, API key, and SSH credential into a flat environment and hopes for the best. But that's exactly what most AI agent deployments do — because the tooling hasn't caught up.

---

## How AgentLair Vault Prevents This

The fix isn't "be more careful about supply chain dependencies" — though you should be. The fix is **architectural**: agents shouldn't hold their own credentials.

AgentLair Vault is a zero-knowledge encrypted credential store built for AI agents. The core principle: credentials are never in the environment. They're fetched at the moment of use, through a single scoped API key.

### How It Works

```javascript
// Traditional pattern (vulnerable):
const key = process.env.OPENAI_API_KEY;  // In memory from startup. Stealable.
const response = await openai.chat.completions.create({ ... });

// Vault pattern (bounded):
const key = await vault.get('openai-api-key');  // Fetched at moment of use
const response = await openai.chat.completions.create({
  apiKey: key
});
// key falls out of scope — not persisted in memory
```

The only thing in the environment at startup is the vault API key itself — a single credential with bounded scope. If a `.pth` file harvests `os.environ`, it gets one API key that:

1. **Cannot read secrets in plaintext.** AgentLair Vault uses client-side AES-256-GCM encryption with per-key HKDF-SHA-256 derivation. The server stores opaque ciphertext. Even if someone exfiltrates the vault API key, they get encrypted blobs — not your OpenAI key, not your AWS credentials.

2. **Is immediately rotatable.** One API call revokes the compromised key. Your encrypted secrets remain intact with a new key. Compare this to rotating every environment variable across every deployment.

3. **Has a bounded blast radius.** The vault API key grants access to *your vault* — not your SSH keys, not your Kubernetes secrets, not your shell history, not your crypto wallets. The TeamPCP harvester collected 15+ categories of credentials. A vault-based architecture reduces that to one.

4. **Provides an audit trail.** AgentLair logs every secret access — which agent, which key, when. You know immediately if a compromised credential was used. With environment variables, there's no access log. You find out when the bill arrives.

### The Encryption Model

AgentLair Vault is zero-knowledge by design:

- **Client-side encryption**: Secrets are encrypted before they leave your agent. The server stores ciphertext.
- **Per-key derivation**: Each secret uses HKDF-SHA-256 to derive a unique encryption key from your seed. Compromising one secret doesn't expose others.
- **No plaintext on the wire**: The vault API only ever sees encrypted blobs. Our servers cannot read your credentials — not by choice, but by construction.

This means even a total server-side breach exposes nothing. The threat model doesn't rely on trusting the vault provider. It relies on math.

### What This Doesn't Solve

Let's be honest about boundaries:

- **If the attacker compromises your vault seed**, they can decrypt everything. The seed is the root of trust — protect it like you'd protect any master key.
- **If a prompt-injected agent uses a legitimately-retrieved credential to exfiltrate data through API responses**, the vault doesn't help. That's a behavior control problem, not a credential storage problem.
- **Supply chain attacks can still happen.** The vault reduces blast radius — it doesn't prevent the initial compromise.

The vault model is about **compartmentalization**, not invulnerability. The difference between "attacker gets one scoped, rotatable API key" and "attacker gets every credential on the machine" is the difference between an incident and a catastrophe.

---

## What To Do Now

**Immediate:**
1. Check your LiteLLM version: `pip show litellm | grep Version`. If 1.82.7 or 1.82.8, assume compromise.
2. Check for persistence: `ls -la ~/.config/sysmon/` and `systemctl --user status sysmon.service`.
3. If affected: rotate every credential that was accessible from the compromised environment. All of them.

**Structural:**
4. Audit your agent's credential surface. How many secrets are in the environment at startup? Each one is exposed in the next supply chain attack.
5. Move to a vault-based credential model. Fetch secrets at moment of use, not at startup.
6. Pin dependency versions. Use lock files. Verify checksums. Enable PyPI Trusted Publishers.

**AgentLair Vault:**
Free tier — 10 secrets, 100 API calls/day, zero-knowledge encryption. No credit card. Takes 30 seconds.

[agentlair.dev/vault](https://agentlair.dev/vault)

---

*The LiteLLM compromise will be patched. The next supply chain attack will find the same credential pattern — unless you change the pattern.*
