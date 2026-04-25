"""
AgentLair Quickstart — Python

Demonstrates the full AgentLair flow using the official SDK:
  1. Register a new agent (creates account + claims email)
  2. Send an email
  3. Check inbox
  4. Store a secret in the vault
  5. Retrieve the secret

── Setup ─────────────────────────────────────────────────────────────────────

  pip install git+https://github.com/piiiico/agentlair-python.git
  python quickstart.py

  # If you already have an API key:
  AGENTLAIR_API_KEY=al_live_... python quickstart.py

── Docs ──────────────────────────────────────────────────────────────────────
  https://agentlair.dev/docs

── Requirements ──────────────────────────────────────────────────────────────
  Python >= 3.10
  agentlair >= 0.1.0  (pip install git+https://github.com/piiiico/agentlair-python.git)
"""

import asyncio
import base64
import os
import random
from datetime import datetime, timezone

from agentlair import AgentLair, AgentLairError


async def main() -> None:
    api_key = os.environ.get("AGENTLAIR_API_KEY")
    agent_email: str

    print()
    print("════════════════════════════════════════════════════════════")
    print("  AgentLair Quickstart (Python)")
    print("════════════════════════════════════════════════════════════")
    print()

    # ── Step 1: Register a new agent ─────────────────────────────────────────
    # AgentLair.create_account() is a static/class method — no API key needed.
    # It creates your account and returns an API key.
    # Then claim an @agentlair.dev email address to send/receive email.

    if not api_key:
        print("Step 1 ▶  Creating a new account...")

        account = await AgentLair.create_account(name="my-agent")
        api_key = account["api_key"]

        print("  account_id: ", account["account_id"])
        print("  tier:       ", account["tier"])
        print()
        print("  ⚠  Save your API key — it will not be shown again.")
        print("     AGENTLAIR_API_KEY=" + api_key)
        print()

        async with AgentLair(api_key) as lair:
            # Claim an email address
            print("         Claiming email address: my-agent@agentlair.dev")
            try:
                result = await lair.email.claim("my-agent@agentlair.dev")
            except AgentLairError as e:
                if e.code == "address_unavailable":
                    # Name taken — try a random suffix
                    suffix = random.randint(1000, 9999)
                    result = await lair.email.claim(f"my-agent-{suffix}@agentlair.dev")
                else:
                    raise
            agent_email = result["address"]
            print("  ✓ Email:    ", agent_email)
            print()
    else:
        print(f"Step 1 ▶  Using existing API key: {api_key[:16]}...")
        async with AgentLair(api_key) as lair:
            addr_result = await lair.email.addresses()
            addresses = addr_result.get("addresses", [])
            if not addresses:
                result = await lair.email.claim("my-agent@agentlair.dev")
                agent_email = result["address"]
            else:
                agent_email = addresses[0]
        print("  ✓ Email:", agent_email)
        print()

    # All subsequent calls use this authenticated client
    async with AgentLair(api_key) as lair:

        # ── Step 2: Send an email ─────────────────────────────────────────────
        # Send from your @agentlair.dev address.
        # 'from_address' must be an address you own (claimed above).
        # To demonstrate the loop, we send to ourselves.

        print("Step 2 ▶  Sending an email...")

        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        sent = await lair.email.send(
            from_address=agent_email,
            to=agent_email,
            subject="Hello from AgentLair!",
            text=(
                f"This email was sent by an AI agent via AgentLair.\n\n"
                f"Timestamp: {timestamp}"
            ),
        )

        print(f"  ✓ Sent: {sent['id']} (status: {sent['status']})")
        if rate_limit := sent.get("rate_limit"):
            print(f"     Daily remaining: {rate_limit['daily_remaining']} emails")
        print()

        # ── Step 3: Check inbox ───────────────────────────────────────────────
        # List messages in your inbox.
        # Pass limit to control page size (max 50).

        print("Step 3 ▶  Checking inbox...")

        inbox = await lair.email.inbox(agent_email, limit=5)

        print(f"  ✓ {inbox['count']} message(s) in inbox:")
        for msg in inbox["messages"][:3]:
            received = msg["received_at"][:10]
            print(f'     • [{received}] "{msg["subject"]}"')
            print(f"       from: {msg['from']}")
        if inbox.get("has_more"):
            print("     … (more messages available)")
        print()

        # ── Step 4: Store a secret in the vault ──────────────────────────────
        # vault.store() is a convenience method that stores a value under a key.
        # The vault is zero-knowledge: the server stores opaque ciphertext.
        #
        # vault.store(key, value) stores value as-is (no encryption layer in SDK).
        # In production, encrypt your value client-side before calling vault.put():
        #
        #   from agentlair_vault_crypto import encrypt
        #   ciphertext = await encrypt("my secret", master_key)
        #   await lair.vault.put("my-key", ciphertext=ciphertext)
        #
        # For this quickstart we store a base64-encoded value as a demo.

        print("Step 4 ▶  Storing a secret in the vault...")

        secret_value = "sk_prod_my_super_secret_api_key"
        # In production: encrypt before storing. Here: base64 as a stand-in.
        encoded = base64.urlsafe_b64encode(secret_value.encode()).decode()

        stored = await lair.vault.put(
            "my-api-key",
            ciphertext=encoded,
            metadata={"label": "production API key", "created_by": "quickstart"},
        )

        print(f'  ✓ Stored: key="{stored["key"]}", version={stored["version"]}')
        print()

        # ── Step 5: Retrieve the secret ───────────────────────────────────────
        # vault.get() returns the stored blob.
        # Decrypt it in production.

        print("Step 5 ▶  Retrieving the secret...")

        retrieved = await lair.vault.get("my-api-key")
        decoded_value = base64.urlsafe_b64decode(retrieved["ciphertext"]).decode()

        print(f'  ✓ Retrieved: key="{retrieved["key"]}", version={retrieved["version"]}')
        print(f'     value: "{decoded_value}"')
        print()

    # ── Done ──────────────────────────────────────────────────────────────────

    print("════════════════════════════════════════════════════════════")
    print("  Quickstart complete!\n")
    print("  Your agent:", agent_email)
    print("  Dashboard:  https://agentlair.dev/dashboard")
    print("  Docs:       https://agentlair.dev/docs\n")
    print("  Explore more:")
    print("    await lair.budget.set(daily=5_000_000)  # spending controls")
    print("    await lair.events.emit({'category': 'tool', 'action': 'web_search', 'result': 'success'})")
    print("    await lair.trust.score()  # behavioral trust score")
    print("════════════════════════════════════════════════════════════")
    print()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except AgentLairError as e:
        print(f"AgentLair error [{e.code}]: {e.message} (HTTP {e.status})")
        raise SystemExit(1)
