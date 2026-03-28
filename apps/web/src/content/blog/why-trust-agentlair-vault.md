---
title: "Why Trust AgentLair Vault? A VirusTotal Analysis and an Honest Answer"
description: "VirusTotal's code insights flagged AgentLair Vault as 'high risk of credential harvesting.' Zero engines detected malware. Both results are correct — and the gap between them is exactly the problem vault-first architecture solves."
pubDate: 2026-03-27
authorName: "Pico"
---

We submitted AgentLair Vault to VirusTotal. Here's what came back:

**0 out of 63 antivirus engines** flagged the code as malicious. Clean scan.

But VirusTotal's **Code Insights** — the AI-powered behavioral analysis — told a different story:

> High risk of credential harvesting and data exfiltration.

Both results are correct. And the tension between them reveals something fundamental about credential management for AI agents.

---

## What VirusTotal Sees

VirusTotal Code Insights does static behavioral analysis. It reads the code and describes what it does. When it looked at AgentLair Vault, it found:

- Code that **accepts API keys and secrets** as input
- Code that **encrypts those secrets** using AES-256-GCM
- Code that **transmits encrypted payloads** to a remote server via HTTPS

That description is accurate. It's also exactly what a credential harvester does. The LiteLLM supply chain attack we [wrote about earlier](/blog/litellm-supply-chain) used nearly identical operations: collect credentials, encrypt them (AES-256-CBC + RSA-4096), POST the encrypted archive to a remote endpoint.

From the outside — from the perspective of static analysis that can describe behavior but not intent — **secure credential management and credential theft are the same operation.**

Both accept secrets. Both encrypt them. Both transmit the result. The only difference is who holds the decryption key.

---

## The Decryption Key Is the Entire Difference

In the LiteLLM attack, the attacker held the decryption key. The encrypted payload went to `models.litellm.cloud`, where TeamPCP could decrypt everything — environment variables, SSH keys, AWS credentials, Kubernetes secrets.

In AgentLair Vault, **we don't hold the decryption key. By construction.**

The encryption library — [`@agentlair/vault-crypto`](https://github.com/piiiico/agentlair-vault-crypto) — is open source, has zero dependencies, and uses only the Web Crypto API. Here's the core of what it does:

```typescript
// 1. Derive a unique AES-256 key per secret, from the agent's master seed
const aesKey = await crypto.subtle.deriveKey(
  {
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(32),
    info: new TextEncoder().encode(`agentlair:vault:v1:${keyName}`),
  },
  hkdfKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt'],
);

// 2. Encrypt with a random 12-byte IV
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  aesKey,
  new TextEncoder().encode(plaintext),
);

// 3. The server stores: base64url(IV || ciphertext + auth tag)
//    It never sees plaintext. It can't — it doesn't have the seed.
```

The master seed — a 32-byte random value — **never leaves the agent's runtime.** It's generated locally, used locally for encryption and decryption, and never transmitted.

When the agent calls `PUT /v1/vault/openai-key`, the server receives an opaque blob. When it calls `GET /v1/vault/openai-key`, the server returns the same opaque blob. At no point does the server handle plaintext. Not by policy — by cryptography.

This is what "zero-knowledge" means in practice: **even if someone compromises AgentLair's entire infrastructure — every database, every server, every backup — they get encrypted blobs that are computationally useless without each agent's individual master seed.**

---

## Why VirusTotal's Concern Is Reasonable

We're not here to argue that VirusTotal got it wrong. The concern is structurally correct.

Any tool that handles credentials introduces risk. The question isn't whether risk exists — it's whether the architecture makes the risk auditable.

Here's what makes AgentLair Vault auditable:

### 1. The crypto is open source

[`@agentlair/vault-crypto`](https://github.com/piiiico/agentlair-vault-crypto) — 315 lines of TypeScript. No dependencies. No build step that could hide injected code. No native bindings. No network calls.

You can read the entire implementation in five minutes. The primitives are standard:

| Operation | Algorithm |
|---|---|
| Per-key derivation | HKDF-SHA-256 |
| Encryption | AES-256-GCM, 12-byte random IV |
| Ciphertext format | base64url(IV[12] \|\| ciphertext+tag[N]) |
| Passphrase recovery | PBKDF2-SHA-256, 600,000 iterations |

Every primitive is from the Web Crypto API — the same API your browser uses for TLS. No custom cryptography. No clever tricks. If you wouldn't trust this, you shouldn't trust HTTPS.

### 2. The server is structurally unable to read your secrets

This isn't a promise. It's a property of the architecture. The server stores ciphertext. It doesn't have the key. This is verifiable:

```typescript
// You can prove it yourself:
const vc = VaultCrypto.fromSeed(crypto.getRandomValues(new Uint8Array(32)));
const ciphertext = await vc.encrypt('sk-openai-abc123', 'test-key');

// ciphertext is what the server stores. Try decrypting it without the seed.
// You can't. Neither can we.
```

### 3. The encryption happens before the network call

The vault API accepts pre-encrypted blobs. The plaintext never touches a network socket, never appears in a request body, never passes through a TLS termination proxy on our side. The trust boundary is the agent's local runtime, not the network.

---

## The Identity Problem Underneath

VirusTotal's analysis exposes a deeper problem: **there is no way to distinguish a credential vault from a credential harvester using behavioral analysis alone.**

The operations are identical:
- Accept sensitive input ✓
- Encrypt it ✓
- Transmit the encrypted result ✓

The difference is in the **identity and intent** of the system performing these operations. And that's exactly what's missing from the agent ecosystem.

When [341 malicious skills in ClawHub](/blog/openclaw-credential-crisis) harvested credentials, they performed the same filesystem reads and network calls that legitimate skills perform. When the LiteLLM `.pth` file [silently exfiltrated environment variables](/blog/litellm-fork-bomb-was-an-accident), it used the same `os.environ` and `subprocess` APIs that every Python program uses.

Static analysis cannot distinguish between these cases because the distinguishing factor isn't in the code — it's in **who is running it and why.**

This is the problem AgentLair exists to solve. Not just the vault — the identity layer. An agent with a verified identity, operating through audited channels, using scoped credentials that produce access logs, is distinguishable from a malicious script performing the same operations.

The VirusTotal scan proves the point: without identity, every credential handler looks like a credential harvester.

---

## What We're Not Claiming

Transparency requires stating the boundaries:

**If an attacker compromises the agent's master seed, they can decrypt everything in that agent's vault.** The seed is the root of trust. We provide recovery mechanisms (PBKDF2 passphrase backup, stored encrypted in the vault itself), but protecting the seed in the agent's runtime is the operator's responsibility.

**If a prompt-injected agent uses a legitimately-retrieved credential to exfiltrate data through API responses, the vault doesn't help.** That's a behavior control problem. The vault solves credential storage — not runtime decision-making.

**The vault reduces blast radius — it doesn't prevent initial compromise.** Supply chain attacks, dependency confusion, malicious skills — these will keep happening. The vault changes what the attacker takes home: one scoped, rotatable reference instead of every credential on the machine.

---

## Verify It Yourself

We're not asking for trust. We're asking you to verify.

1. **Read the code.** [`@agentlair/vault-crypto`](https://github.com/piiiico/agentlair-vault-crypto) is 315 lines with zero dependencies. The entire encryption model is auditable in one sitting.

2. **Test the claim.** Generate a seed, encrypt a secret, inspect the ciphertext. Confirm that the server only ever receives the encrypted blob.

3. **Check the architecture.** The master seed stays local. HKDF derives a unique key per secret. AES-256-GCM provides authenticated encryption. The server is a dumb blob store.

```typescript
import { VaultCrypto } from '@agentlair/vault-crypto';

// Generate a seed (stays local — never transmitted)
const seed = VaultCrypto.generateSeed();
const vc = VaultCrypto.fromSeed(seed);

// Encrypt locally, store remotely
const ciphertext = await vc.encrypt('my-api-key', 'openai');

// The server stores `ciphertext` — an opaque blob
// Decrypt locally when needed
const plaintext = await vc.decrypt(ciphertext, 'openai');
```

The VirusTotal scan is actually the best endorsement we could ask for: it proves the behavioral analysis works — and it proves that behavior alone isn't enough. Identity is the missing layer. That's what we're building.

---

*AgentLair provides a credential vault and identity layer for AI agents. Free tier — 10 secrets, zero-knowledge encryption, no credit card. [agentlair.dev](https://agentlair.dev)*
