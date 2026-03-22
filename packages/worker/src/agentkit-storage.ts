// ─── AgentKit Storage (Cloudflare KV) ────────────────────────────────────────
// Implements the AgentKitStorage interface from @worldcoin/agentkit backed by
// Cloudflare KV. Used for tracking per-human usage counts (free-trial mode)
// and preventing nonce replay attacks.
//
// KV key patterns (in KEYS namespace):
//   agentkit:usage:{endpoint}:{humanId}  → count (string)
//   agentkit:nonce:{nonce}               → "1" (with 24h TTL)

import type { AgentKitStorage } from '@worldcoin/agentkit';

export class KVAgentKitStorage implements AgentKitStorage {
  constructor(private kv: KVNamespace) {}

  async getUsageCount(endpoint: string, humanId: string): Promise<number> {
    const key = `agentkit:usage:${endpoint}:${humanId}`;
    const raw = await this.kv.get(key);
    return raw ? parseInt(raw, 10) : 0;
  }

  async incrementUsage(endpoint: string, humanId: string): Promise<void> {
    const key = `agentkit:usage:${endpoint}:${humanId}`;
    const current = await this.getUsageCount(endpoint, humanId);
    await this.kv.put(key, String(current + 1));
  }

  async hasUsedNonce(nonce: string): Promise<boolean> {
    const key = `agentkit:nonce:${nonce}`;
    const raw = await this.kv.get(key);
    return raw !== null;
  }

  async recordNonce(nonce: string): Promise<void> {
    const key = `agentkit:nonce:${nonce}`;
    // Nonces expire after 24h — stale nonces are inherently invalid anyway
    // (the signature's issuedAt timestamp will fail validation)
    await this.kv.put(key, '1', { expirationTtl: 24 * 3600 });
  }
}
