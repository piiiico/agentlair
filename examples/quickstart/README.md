# AgentLair Quickstart

Three ways to try AgentLair in under 30 seconds. Pick your preferred language.

All examples demonstrate the same flow:

1. **Register** — Create a new agent account (no sign-up required)
2. **Send email** — Send from your `@agentlair.dev` address
3. **Check inbox** — Read incoming messages
4. **Store secret** — Write an encrypted blob to the vault
5. **Retrieve secret** — Read it back

---

## curl (no dependencies)

```bash
chmod +x quickstart-curl.sh
./quickstart-curl.sh
```

Requires: `curl`, `python3` (for JSON formatting)

---

## TypeScript / Node.js

```bash
npm install @agentlair/sdk tsx
npx tsx quickstart.ts
```

Or with Bun:

```bash
bun add @agentlair/sdk
bun run quickstart.ts
```

Requires: Node.js ≥ 18 or Bun

---

## Python

```bash
pip install git+https://github.com/piiiico/agentlair-python.git
python quickstart.py
```

Requires: Python ≥ 3.10

---

## Using an existing API key

All examples check `$AGENTLAIR_API_KEY`. If set, they skip account creation:

```bash
export AGENTLAIR_API_KEY=al_live_...

./quickstart-curl.sh
# or
npx tsx quickstart.ts
# or
python quickstart.py
```

---

## What's next

| Feature | Description |
|---------|-------------|
| [Email webhooks](https://agentlair.dev/docs/email#webhooks) | Receive real-time notifications when email arrives |
| [Vault crypto](https://agentlair.dev/docs/vault#encryption) | True zero-knowledge encryption with `@agentlair/vault-crypto` |
| [Budget controls](https://agentlair.dev/docs/budget) | Set spending limits and require approval for large charges |
| [Trust scores](https://agentlair.dev/docs/trust) | Build a behavioral reputation across organizations |
| [Events API](https://agentlair.dev/docs/events) | Emit behavioral telemetry that feeds your trust score |

---

**Docs:** https://agentlair.dev/docs  
**Dashboard:** https://agentlair.dev/dashboard  
**Support:** hello@agentlair.dev
