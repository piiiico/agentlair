# @agentlair/vault-crypto

Client-side encryption for [AgentLair Vault](https://agentlair.dev). Zero-knowledge — your secrets are encrypted before they leave your runtime. AgentLair stores opaque blobs and can never read your plaintext.

**No dependencies.** Uses only the Web Crypto API (built into Node ≥18, Bun, Deno, and browsers).

## Install

```bash
# npm
npm install @agentlair/vault-crypto

# Bun
bun add @agentlair/vault-crypto

# Deno (no install needed)
import { VaultCrypto } from 'npm:@agentlair/vault-crypto';
```

## Quick Start

```typescript
import { VaultCrypto } from '@agentlair/vault-crypto';

// 1. Generate a master seed (do this once per agent)
const seed = VaultCrypto.generateSeed();
const vc = VaultCrypto.fromSeed(seed);

// 2. Encrypt a secret
const ciphertext = await vc.encrypt('sk-openai-abc123', 'openai-key');

// 3. Store it in AgentLair Vault
await fetch('https://agentlair.dev/v1/vault/openai-key', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer al_live_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ ciphertext }),
});

// 4. Later — retrieve and decrypt
const res = await fetch('https://agentlair.dev/v1/vault/openai-key', {
  headers: { 'Authorization': 'Bearer al_live_...' },
});
const { ciphertext: stored } = await res.json();
const plaintext = await vc.decrypt(stored, 'openai-key');
// plaintext === 'sk-openai-abc123'
```

## API

### `VaultCrypto.generateSeed()`

Generate a cryptographically random 32-byte master seed.

```typescript
const seed = VaultCrypto.generateSeed(); // Uint8Array (32 bytes)
```

Store this seed securely — or back it up with a passphrase (see [Backup & Recovery](#backup--recovery)).

---

### `VaultCrypto.fromSeed(masterSeed)`

Create a `VaultCrypto` instance from a 32-byte seed.

```typescript
// From Uint8Array
const vc = VaultCrypto.fromSeed(seed);

// From hex string (e.g., stored in an env var)
const vc = VaultCrypto.fromSeed('a3f1...'); // 64-char hex
```

---

### `VaultCrypto.fromPassphrase(passphrase, salt?)`

Derive a `VaultCrypto` instance from a human-memorable passphrase.

Uses PBKDF2-SHA-256 with 600,000 iterations. Deterministic: the same passphrase always produces the same master seed, enabling recovery without storing the seed.

```typescript
const vc = await VaultCrypto.fromPassphrase('correct-horse-battery-staple');
```

> **Note:** For automated agents, prefer `generateSeed()` + `fromSeed()`. Use `fromPassphrase` for human operators or as the recovery passphrase that wraps a random seed.

---

### `vc.encrypt(plaintext, keyName?)`

Encrypt a string. Returns a base64url-encoded ciphertext.

```typescript
const ciphertext = await vc.encrypt('my-secret-value', 'vault-key-name');
```

- **`keyName`** (optional, default: `'default'`): The name of the vault key. Used for per-key derivation — different key names produce different AES keys, so you can only decrypt with the correct key name.
- Each call produces a different ciphertext (random 12-byte IV). The same plaintext encrypted twice yields different ciphertexts.

---

### `vc.decrypt(ciphertext, keyName?)`

Decrypt a ciphertext produced by `encrypt()`. Returns the original string.

```typescript
const plaintext = await vc.decrypt(ciphertext, 'vault-key-name');
```

Throws if the ciphertext is tampered, the key name is wrong, or the seed is different.

---

### `vc.seedHex()`

Get the master seed as a 64-character hex string (for backup or env var storage).

```typescript
const hex = vc.seedHex();
// Store in .env: VAULT_SEED=a3f1...
```

---

## Backup & Recovery

If the agent's container dies and the seed is lost, you can recover using a passphrase. The recommended pattern:

### 1. Back up the seed

```typescript
const seed = VaultCrypto.generateSeed();
const vc = VaultCrypto.fromSeed(seed);

// Encrypt the seed with a human-memorable passphrase
const seedBackup = await vc.encryptSeedBackup('operator-passphrase');

// Store the backup in Vault under the reserved key '_master_seed_backup'
await fetch('https://agentlair.dev/v1/vault/_master_seed_backup', {
  method: 'PUT',
  headers: { 'Authorization': 'Bearer al_live_...', 'Content-Type': 'application/json' },
  body: JSON.stringify({ ciphertext: seedBackup }),
});
```

### 2. Recover after container loss

```typescript
// 1. Request a recovery link via email
await fetch('https://agentlair.dev/v1/vault/recover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'operator@example.com' }),
});

// 2. Click the magic link → you get back all encrypted entries, including _master_seed_backup

// 3. Restore the VaultCrypto instance from the backup
const restoredVc = await VaultCrypto.decryptSeedBackup(seedBackup, 'operator-passphrase');

// 4. All secrets are now accessible again
const apiKey = await restoredVc.decrypt(openaiKeyCiphertext, 'openai-key');
```

### `vc.encryptSeedBackup(passphrase)`

Encrypt the master seed with a passphrase for storage in Vault.

```typescript
const backup = await vc.encryptSeedBackup('my-recovery-passphrase');
```

### `VaultCrypto.decryptSeedBackup(encryptedBackup, passphrase)`

Restore a `VaultCrypto` instance from a seed backup.

```typescript
const restored = await VaultCrypto.decryptSeedBackup(backup, 'my-recovery-passphrase');
```

---

## Crypto Primitives

| Operation | Algorithm |
|---|---|
| Per-key derivation | HKDF-SHA-256, info = `agentlair:vault:v1:{keyName}` |
| Encryption | AES-256-GCM, 12-byte random IV |
| Ciphertext format | base64url(IV[12] \|\| ciphertext+tag[N]) |
| Passphrase → seed | PBKDF2-SHA-256, 600,000 iterations, salt = `agentlair-vault-v1` |

All primitives are from the **Web Crypto API** (no external dependencies). Works identically across Node ≥18, Bun, Deno, and modern browsers.

---

## Node.js Example

```typescript
import { VaultCrypto } from '@agentlair/vault-crypto';

const vc = VaultCrypto.fromSeed(process.env.VAULT_SEED!);
const plaintext = await vc.decrypt(storedCiphertext, 'db-password');
```

## Bun Example

```typescript
import { VaultCrypto } from '@agentlair/vault-crypto';

const vc = await VaultCrypto.fromPassphrase(Bun.env.VAULT_PASSPHRASE!);
const ciphertext = await vc.encrypt(process.env.OPENAI_KEY!, 'openai');
```

## Deno Example

```typescript
import { VaultCrypto } from 'npm:@agentlair/vault-crypto';

const vc = VaultCrypto.fromSeed(Deno.env.get('VAULT_SEED')!);
const secret = await vc.decrypt(ciphertext, 'my-key');
```

## Browser Example

```typescript
import { VaultCrypto } from '@agentlair/vault-crypto';

// Generate and show seed to user (prompt them to save it)
const seed = VaultCrypto.generateSeed();
const vc = VaultCrypto.fromSeed(seed);
console.log('Save your seed:', vc.seedHex());
```

---

## License

MIT © [AgentLair](https://agentlair.dev)
