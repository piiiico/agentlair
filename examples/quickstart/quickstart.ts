/**
 * AgentLair Quickstart — TypeScript
 *
 * Demonstrates the full AgentLair flow using the official SDK:
 *   1. Register a new agent (creates account + claims email)
 *   2. Send an email
 *   3. Check inbox
 *   4. Store a secret in the vault
 *   5. Retrieve the secret
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 *
 *   # Node.js (≥18)
 *   npm install @agentlair/sdk tsx
 *   npx tsx quickstart.ts
 *
 *   # Bun
 *   bun add @agentlair/sdk
 *   bun run quickstart.ts
 *
 *   # If you already have an API key:
 *   AGENTLAIR_API_KEY=al_live_... npx tsx quickstart.ts
 *
 * ── Docs ───────────────────────────────────────────────────────────────────
 *   https://agentlair.dev/docs
 */

import { AgentLair, AgentLairError } from "@agentlair/sdk";

async function main() {
  let apiKey = process.env.AGENTLAIR_API_KEY;
  let agentEmail: string;

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  AgentLair Quickstart (TypeScript)");
  console.log("════════════════════════════════════════════════════════════\n");

  // ── Step 1: Register a new agent ─────────────────────────────────────────
  // AgentLair.createAccount() is a static method — no API key needed.
  // It creates your account and returns an API key.
  // Then claim an @agentlair.dev email address to send/receive email.

  if (!apiKey) {
    console.log("Step 1 ▶  Creating a new account...");

    const account = await AgentLair.createAccount({ name: "my-agent" });
    apiKey = account.api_key;

    console.log("  account_id: ", account.account_id);
    console.log("  tier:       ", account.tier);
    console.log("");
    console.log("  ⚠  Save your API key — it will not be shown again.");
    console.log("     AGENTLAIR_API_KEY=" + apiKey);
    console.log("");

    // Create the client with the new API key
    const lair = new AgentLair(apiKey);

    // Claim an email address
    console.log("         Claiming email address: my-agent@agentlair.dev");
    let claimResult;
    try {
      claimResult = await lair.email.claim("my-agent");
    } catch (e) {
      if (e instanceof AgentLairError && e.code === "address_unavailable") {
        // Name taken — claim a random one
        const suffix = Math.floor(1000 + Math.random() * 9000);
        claimResult = await lair.email.claim(`my-agent-${suffix}`);
      } else {
        throw e;
      }
    }
    agentEmail = claimResult.address;
    console.log("  ✓ Email:     ", agentEmail);
    console.log("");
  } else {
    console.log(`Step 1 ▶  Using existing API key: ${apiKey.slice(0, 16)}...`);
    const lair = new AgentLair(apiKey);
    const { addresses } = await lair.email.addresses();
    if (addresses.length === 0) {
      const result = await lair.email.claim("my-agent");
      agentEmail = result.address;
    } else {
      agentEmail = addresses[0];
    }
    console.log("  ✓ Email:", agentEmail);
    console.log("");
  }

  // All subsequent calls use this authenticated client
  const lair = new AgentLair(apiKey);

  // ── Step 2: Send an email ───────────────────────────────────────────────
  // Send from your @agentlair.dev address.
  // 'from' must be an address you own (claimed above or via /v1/register).
  // To demonstrate the flow, we send to ourselves.

  console.log("Step 2 ▶  Sending an email...");

  const sent = await lair.email.send({
    from: agentEmail,
    to: agentEmail,
    subject: "Hello from AgentLair!",
    text: `This email was sent by an AI agent via AgentLair.\n\nTimestamp: ${new Date().toISOString()}`,
  });

  console.log("  ✓ Sent:", sent.id, `(status: ${sent.status})`);
  if (sent.rate_limit) {
    console.log(
      `     Daily remaining: ${sent.rate_limit.daily_remaining} emails`
    );
  }
  console.log("");

  // ── Step 3: Check inbox ─────────────────────────────────────────────────
  // List messages in your inbox.
  // Pass limit to control page size (max 50).

  console.log("Step 3 ▶  Checking inbox...");

  const inbox = await lair.email.inbox(agentEmail, { limit: 5 });

  console.log(`  ✓ ${inbox.count} message(s) in inbox:`);
  for (const msg of inbox.messages.slice(0, 3)) {
    console.log(`     • [${msg.received_at.slice(0, 10)}] "${msg.subject}"`);
    console.log(`       from: ${msg.from}`);
  }
  if (inbox.has_more) {
    console.log("     … (more messages available)");
  }
  console.log("");

  // ── Step 4: Store a secret in the vault ───────────────────────────────
  // vault.put() stores an encrypted blob under a named key.
  // The vault is zero-knowledge: the server stores opaque ciphertext.
  //
  // In production, encrypt your value with @agentlair/vault-crypto:
  //   import { encrypt } from '@agentlair/vault-crypto';
  //   const { ciphertext } = await encrypt('my secret', masterKey);
  //   await lair.vault.put('my-key', { ciphertext });
  //
  // For this quickstart we use base64 as a stand-in.

  console.log("Step 4 ▶  Storing a secret in the vault...");

  const secretValue = "sk_prod_my_super_secret_api_key";
  const ciphertext = Buffer.from(secretValue).toString("base64url");

  const stored = await lair.vault.put("my-api-key", {
    ciphertext,
    metadata: { label: "production API key", created_by: "quickstart" },
  });

  console.log(
    `  ✓ Stored: key="${stored.key}", version=${stored.version}, stored=${stored.stored}`
  );
  console.log("");

  // ── Step 5: Retrieve the secret ──────────────────────────────────────
  // vault.get() returns the encrypted blob.
  // Decrypt it with @agentlair/vault-crypto in production.

  console.log("Step 5 ▶  Retrieving the secret...");

  const retrieved = await lair.vault.get("my-api-key");
  const decoded = Buffer.from(retrieved.ciphertext, "base64url").toString();

  console.log(`  ✓ Retrieved: key="${retrieved.key}", version=${retrieved.version}`);
  console.log(`     value: "${decoded}"`);
  console.log("");

  // ── Done ────────────────────────────────────────────────────────────────

  console.log("════════════════════════════════════════════════════════════");
  console.log("  Quickstart complete!\n");
  console.log("  Your agent:", agentEmail);
  console.log("  Dashboard:  https://agentlair.dev/dashboard");
  console.log("  Docs:       https://agentlair.dev/docs\n");
  console.log("  Explore more:");
  console.log("    lair.budget.set({ daily: 5_000_000 })  // spending controls");
  console.log("    lair.events.emit({ category: 'tool', action: 'web_search', result: 'success' })");
  console.log("    lair.trust.score()  // behavioral trust score");
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  if (err instanceof AgentLairError) {
    console.error(`AgentLair error [${err.code}]: ${err.message} (HTTP ${err.status})`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
