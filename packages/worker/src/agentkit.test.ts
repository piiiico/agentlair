/**
 * AgentKit Integration — Unit Tests
 *
 * Tests for:
 * 1. KV-backed AgentKitStorage (usage counting + nonce replay protection)
 * 2. AgentKit verification middleware logic
 *
 * Run: bun test src/agentkit.test.ts
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { KVAgentKitStorage } from './agentkit-storage.js';

// ─── Mock KV ─────────────────────────────────────────────────────────────────
// Minimal in-memory KVNamespace mock for unit testing

class MockKV {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl
      ? Math.floor(Date.now() / 1000) + options.expirationTtl
      : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[] }> {
    return { keys: Array.from(this.store.keys()).map(name => ({ name })) };
  }

  // Debug helper
  _dump(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.store) out[k] = v.value;
    return out;
  }
}

// ─── KVAgentKitStorage Tests ─────────────────────────────────────────────────

describe('KVAgentKitStorage', () => {
  let kv: MockKV;
  let storage: KVAgentKitStorage;

  beforeEach(() => {
    kv = new MockKV();
    storage = new KVAgentKitStorage(kv as unknown as KVNamespace);
  });

  describe('usage counting', () => {
    test('getUsageCount returns 0 for unknown human', async () => {
      const count = await storage.getUsageCount('/v1/email/send', '0xhuman123');
      expect(count).toBe(0);
    });

    test('incrementUsage increases count by 1', async () => {
      await storage.incrementUsage('/v1/email/send', '0xhuman123');
      const count = await storage.getUsageCount('/v1/email/send', '0xhuman123');
      expect(count).toBe(1);
    });

    test('multiple increments accumulate', async () => {
      await storage.incrementUsage('/v1/email/send', '0xhuman123');
      await storage.incrementUsage('/v1/email/send', '0xhuman123');
      await storage.incrementUsage('/v1/email/send', '0xhuman123');
      const count = await storage.getUsageCount('/v1/email/send', '0xhuman123');
      expect(count).toBe(3);
    });

    test('usage is tracked per endpoint', async () => {
      await storage.incrementUsage('/v1/email/send', '0xhuman123');
      await storage.incrementUsage('/v1/email/send', '0xhuman123');
      await storage.incrementUsage('/v1/vault/store', '0xhuman123');

      expect(await storage.getUsageCount('/v1/email/send', '0xhuman123')).toBe(2);
      expect(await storage.getUsageCount('/v1/vault/store', '0xhuman123')).toBe(1);
    });

    test('usage is tracked per human', async () => {
      await storage.incrementUsage('/v1/email/send', '0xhuman_a');
      await storage.incrementUsage('/v1/email/send', '0xhuman_a');
      await storage.incrementUsage('/v1/email/send', '0xhuman_b');

      expect(await storage.getUsageCount('/v1/email/send', '0xhuman_a')).toBe(2);
      expect(await storage.getUsageCount('/v1/email/send', '0xhuman_b')).toBe(1);
    });

    test('KV keys use correct pattern', async () => {
      await storage.incrementUsage('/v1/email/send', '0xabc');
      const dump = kv._dump();
      expect(dump['agentkit:usage:/v1/email/send:0xabc']).toBe('1');
    });
  });

  describe('nonce replay protection', () => {
    test('hasUsedNonce returns false for unknown nonce', async () => {
      const used = await storage.hasUsedNonce('nonce_fresh_123');
      expect(used).toBe(false);
    });

    test('recordNonce marks nonce as used', async () => {
      await storage.recordNonce('nonce_abc');
      const used = await storage.hasUsedNonce('nonce_abc');
      expect(used).toBe(true);
    });

    test('different nonces are independent', async () => {
      await storage.recordNonce('nonce_1');
      expect(await storage.hasUsedNonce('nonce_1')).toBe(true);
      expect(await storage.hasUsedNonce('nonce_2')).toBe(false);
    });

    test('nonce KV keys use correct pattern with TTL', async () => {
      await storage.recordNonce('nonce_xyz');
      const dump = kv._dump();
      expect(dump['agentkit:nonce:nonce_xyz']).toBe('1');
    });

    test('replayed nonce is detected', async () => {
      // First use: nonce is fresh
      const firstCheck = await storage.hasUsedNonce('replay_me');
      expect(firstCheck).toBe(false);

      // Record the nonce
      await storage.recordNonce('replay_me');

      // Second use: nonce is replayed
      const secondCheck = await storage.hasUsedNonce('replay_me');
      expect(secondCheck).toBe(true);
    });
  });

  describe('free-trial flow simulation', () => {
    const ENDPOINT = '/v1/email/send';
    const HUMAN_ID = '0xanon_human_42';
    const FREE_TRIAL_USES = 3;

    test('human gets exactly N free uses then is blocked', async () => {
      // Uses 1-3: should be allowed
      for (let i = 0; i < FREE_TRIAL_USES; i++) {
        const count = await storage.getUsageCount(ENDPOINT, HUMAN_ID);
        expect(count).toBe(i);
        expect(count < FREE_TRIAL_USES).toBe(true);
        await storage.incrementUsage(ENDPOINT, HUMAN_ID);
      }

      // Use 4: should be blocked (free trial exhausted)
      const finalCount = await storage.getUsageCount(ENDPOINT, HUMAN_ID);
      expect(finalCount).toBe(FREE_TRIAL_USES);
      expect(finalCount < FREE_TRIAL_USES).toBe(false);
    });

    test('different humans have independent free-trial counters', async () => {
      // Human A uses all 3
      for (let i = 0; i < FREE_TRIAL_USES; i++) {
        await storage.incrementUsage(ENDPOINT, '0xhuman_a');
      }

      // Human B still has all 3
      const bCount = await storage.getUsageCount(ENDPOINT, '0xhuman_b');
      expect(bCount).toBe(0);
      expect(bCount < FREE_TRIAL_USES).toBe(true);
    });
  });
});

// ─── Middleware edge cases ───────────────────────────────────────────────────

describe('AgentKit middleware edge cases', () => {
  test('AGENTKIT_HEADER constant matches expected value', async () => {
    // Import the constant to verify it matches what agents will send
    const { AGENTKIT_HEADER } = await import('./middleware/agentkit.js');
    expect(AGENTKIT_HEADER).toBe('X-AGENTKIT');
  });

  test('AGENTKIT_FREE_TRIAL_USES is 3', async () => {
    const { AGENTKIT_FREE_TRIAL_USES } = await import('./middleware/agentkit.js');
    expect(AGENTKIT_FREE_TRIAL_USES).toBe(3);
  });

  test('verifyAgentKit returns no_header when header missing', async () => {
    const { verifyAgentKit } = await import('./middleware/agentkit.js');
    const mockRequest = new Request('https://agentlair.dev/v1/email/send', {
      method: 'POST',
    });
    const mockEnv = { KEYS: new MockKV() } as any;
    const result = await verifyAgentKit(mockRequest, mockEnv, '/v1/email/send');
    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.reason).toBe('no_header');
    }
  });

  test('verifyAgentKit returns parse_error for invalid header', async () => {
    const { verifyAgentKit } = await import('./middleware/agentkit.js');
    const mockRequest = new Request('https://agentlair.dev/v1/email/send', {
      method: 'POST',
      headers: { 'X-AGENTKIT': 'not-valid-json-or-base64' },
    });
    const mockEnv = { KEYS: new MockKV() } as any;
    const result = await verifyAgentKit(mockRequest, mockEnv, '/v1/email/send');
    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.reason).toBe('parse_error');
    }
  });
});
