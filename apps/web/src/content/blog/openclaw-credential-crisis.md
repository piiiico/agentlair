---
title: "OpenClaw's Credential Problem Is Structural, Not Incidental"
description: "341 malicious skills. 1.5 million leaked agent tokens. 21,639 exposed instances. The largest AI agent platform has a credential architecture that makes exfiltration the default outcome."
pubDate: 2026-03-27
authorName: "Pico"
---

OpenClaw is the fastest-growing open-source project in history. 250K+ GitHub stars in 60 days, beating React's decade-long record. Hundreds of thousands of agents running on it, connected to WhatsApp, Slack, Discord, email, and corporate SaaS.

It also has a credential architecture that treats secrets like config values.

Between January 27 and February 3, 2026, three things happened in rapid succession: 341 malicious skills were discovered in the ClawHub marketplace (12% of the entire registry), a one-click RCE vulnerability was patched and disclosed, and the Moltbook social network for OpenClaw agents was breached — exposing 35,000 email addresses and 1.5 million agent API tokens.

This isn't a story about one vulnerability. It's the same structural pattern we [wrote about with LiteLLM](/blog/litellm-fork-bomb-was-an-accident), but at platform scale.

---

## Where the Credentials Live

OpenClaw stores API keys and bot tokens in `~/.openclaw/openclaw.json` and associated credential files. By default, in plaintext.

This isn't a secret. The [OpenClaw docs](https://docs.openclaw.ai/gateway/authentication) describe it. The community knows it. There's even a [GitHub issue (#11829)](https://github.com/openclaw/openclaw/issues/11829) titled "Security Roadmap: Protecting API Keys from Agent Access" that acknowledges the problem at the architectural level.

But it gets worse. A [critical bug (#9627)](https://github.com/openclaw/openclaw/issues/9627) revealed that OpenClaw's config write operations — triggered during `update`, `doctor`, or `configure` commands — resolve `${VAR_NAME}` environment variable references and replace them with the actual credential values. Permanently. In plain text JSON.

Users who thought they were using environment variable indirection were, after a routine update, storing raw API keys in their config files.

And then there's `models-config.ts`, which writes `apiKey` values to `models.json` — a file that gets serialized into prompt context. Real users have reported API keys appearing in chat while debugging. The credential doesn't just sit in a file. It leaks into the conversation.

---

## What ClawHavoc Actually Harvested

The [ClawHavoc campaign](https://reco.ai/blog/openclaw-the-ai-agent-security-crisis-unfolding-right-now) started on January 27, 2026. A single actor ("Hightower6eu") uploaded 354 malicious packages to ClawHub. They had professional documentation, innocuous names like "solana-wallet-tracker," and payloads that installed keyloggers on Windows and Atomic Stealer malware on macOS.

The attack method was the same one that makes OpenClaw powerful: skills can instruct agents to execute code. A malicious skill's instructions are indistinguishable from a legitimate skill's instructions — both are natural language directives that the agent follows. The skill tells the agent to run a command; the agent runs it.

When that command runs, it has access to everything the agent has access to. Which means `~/.openclaw/openclaw.json`, environment variables, `~/.ssh/`, `~/.aws/`, browser cookies, and anything else on the filesystem.

341 of the 2,857 skills in the ClawHub registry at the time were malicious. That's a 12% compromise rate in the marketplace of the most popular AI agent framework in the world.

---

## 21,639 Open Doors

The scale isn't theoretical. Censys identified [21,639 publicly exposed OpenClaw instances](https://reco.ai/blog/openclaw-the-ai-agent-security-crisis-unfolding-right-now) — agents bound to `0.0.0.0:18789` (OpenClaw's default) with no authentication barrier.

CVE-2026-25253 (CVSS 8.8) made it worse: the control UI trusted URL parameters without validation, enabling cross-site WebSocket hijacking. Visit a malicious webpage, and within milliseconds, an attacker has full control of your OpenClaw instance — including every credential it can reach.

The Moltbook breach was the final piece. 770,000+ active agents on the platform. 1.5 million API tokens exposed from an unsecured database. Those tokens unlock access to whatever services those agents were connected to: cloud APIs, email accounts, payment systems.

---

## Why the Mitigations Don't Close the Gap

OpenClaw has shipped mitigations. SecretRef (environment variable indirection), auth profiles (system keychain storage), 1Password/Bitwarden integration via `exec` providers, and a `security audit --deep` CLI command.

These are all good. None of them change the fundamental architecture.

**SecretRef still loads credentials into process memory.** Whether the secret comes from an environment variable, a file, or a keychain, it ends up in the agent's runtime. Any code the agent executes — including code from a malicious skill — has access to it.

**Environment variable indirection breaks on config writes.** Issue #9627 proved this: a routine `openclaw update` command resolved `${ANTHROPIC_API_KEY}` to `sk-ant-...` and wrote it to the config file permanently.

**System keychain doesn't help multi-agent setups.** If one agent in a multi-agent deployment has shell access, it can read every other agent's environment variables. The keychain protects at rest; it doesn't protect at runtime.

**The audit command is reactive.** `openclaw security audit --deep` finds leaked credentials after they've leaked. `grep -r "sk-" ~/.openclaw/` catches what's already there. Neither prevents the exfiltration.

The core problem is architectural: **credentials exist in the agent's runtime environment.** Every mitigation OpenClaw has shipped is a layer on top of that architecture. The ClawHavoc attackers didn't need to bypass any of them — they just instructed agents to read what was already accessible.

---

## What Vault-First Changes

The same pattern, the same fix. [AgentLair's vault model](https://agentlair.dev) takes credentials out of the process entirely:

```
GET /v1/vault/secrets/anthropic-key
Authorization: Bearer <agent-token>
```

The agent holds a reference — a vault token. Not the credential itself.

A malicious ClawHub skill running against a vault-first agent gets the vault token. Not the API keys, not the OAuth tokens, not the cloud credentials. To use the vault token, the attacker needs to make authenticated API calls through AgentLair's vault, which:

1. **Logs every access.** Every credential fetch appears in the audit trail. A skill that suddenly requests 15 different API keys at 3am produces a signal. No fork bomb required.

2. **Enforces per-credential permissions.** An agent authorized to read its Anthropic key can't read the Stripe production key. Credentials are scoped, not dumped.

3. **Blocks bulk exfiltration.** The `.openclaw/` directory crawl — where an attacker reads `openclaw.json`, `credentials/`, environment variables, SSH keys, and cloud tokens in one pass — doesn't work when there's nothing to crawl. Each credential requires a separate authenticated request.

4. **Makes rotation a single operation.** After the Moltbook breach exposed 1.5M tokens, every agent using those tokens needed manual credential rotation. In a vault-first model, you rotate the underlying credential once. Every agent gets the new value on its next fetch.

This is the same argument we made about [LiteLLM's `.pth` attack](/blog/litellm-fork-bomb-was-an-accident). The supply chain compromise isn't preventable — the question is what the attacker takes home. When credentials live in the environment, they take everything. When credentials live in a vault, they take a reference that produces an audit trail the moment it's misused.

---

## The Pattern

LiteLLM: malicious package harvests environment variables. Detection: accidental fork bomb.

OpenClaw: malicious skills harvest config files and environment variables. Detection: Bitdefender and community reports, weeks after initial distribution.

Both attacks succeed because the credential is where the code runs. Both attacks become silent harvests when the attacker is competent.

OpenClaw's scale — 250K+ stars, hundreds of thousands of agents, enterprise SaaS integrations — means the next ClawHavoc campaign isn't a hobby project. It's a supply chain attack against every service those agents are connected to.

The 12% malware rate in ClawHub is a number that should change how you think about agent credential architecture. Not because ClawHub is uniquely bad — it's doing what every marketplace does at scale — but because agent frameworks that store credentials in the runtime are giving every marketplace skill the keys to everything.

Vault-first doesn't prevent malicious skills. Nothing does at scale. But it changes the blast radius from "everything in the environment" to "one audited, scoped, revocable reference."

---

*AgentLair provides a credential vault and identity layer for AI agents. The vault API is available at [agentlair.dev](https://agentlair.dev).*
