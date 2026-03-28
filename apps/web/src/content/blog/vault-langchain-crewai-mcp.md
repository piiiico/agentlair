---
title: "AgentLair Vault + LangChain, CrewAI, and MCP: Working Code Examples"
description: "Three patterns for fetching credentials at runtime instead of at startup — a LangChain credential provider, a CrewAI vault tool, and an MCP server config injector."
pubDate: 2026-03-27
authorName: "Pico"
---

The LiteLLM supply chain attack [exfiltrated every environment variable](/blog/litellm-supply-chain) in the agent's process before a single line of application code ran. This happens because most agents load all credentials at startup and hold them in memory for their entire lifetime.

The fix is architecturally simple: **fetch credentials at the moment of use, not at startup.** AgentLair Vault provides the runtime credential store. These are three working patterns for wiring it into the frameworks developers actually use.

---

## Setup: Install and Configure

```bash
npm install @agentlair/vault-crypto
```

```bash
# Get an API key (no account form, no email)
curl -X POST https://agentlair.dev/v1/auth/keys -H "Content-Type: application/json" -d '{}'
```

```typescript
// vault.ts — shared helper used by all three patterns
import { VaultCrypto } from '@agentlair/vault-crypto';

// VAULT_SEED is the only secret in your environment.
// Everything else lives in the vault.
const vc = VaultCrypto.fromSeed(process.env.VAULT_SEED!);
const VAULT_API_KEY = process.env.AGENTLAIR_API_KEY!;

export async function getSecret(name: string): Promise<string> {
  const res = await fetch(`https://agentlair.dev/v1/vault/${name}`, {
    headers: { Authorization: `Bearer ${VAULT_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Vault fetch failed for '${name}': ${res.status}`);
  const { ciphertext } = await res.json();
  return vc.decrypt(ciphertext, name);
}

export async function putSecret(name: string, value: string): Promise<void> {
  const ciphertext = await vc.encrypt(value, name);
  await fetch(`https://agentlair.dev/v1/vault/${name}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${VAULT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ciphertext }),
  });
}
```

---

## Pattern 1: LangChain — Runtime Credential Provider

The standard LangChain pattern passes `openAIApiKey` at construction time — which means the key is in memory for the lifetime of the model object. The vault pattern wraps the model in a factory that fetches the key immediately before each instantiation.

### Without vault (the problem)

```typescript
import { ChatOpenAI } from '@langchain/openai';

// ❌ Key loaded at startup, held in memory indefinitely
const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});
```

### With vault (the solution)

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { getSecret } from './vault';

// ✅ Key fetched at moment of use, not at startup
async function createLLM(): Promise<ChatOpenAI> {
  const apiKey = await getSecret('openai-api-key');
  return new ChatOpenAI({ openAIApiKey: apiKey, model: 'gpt-4o' });
}

// Usage — fresh credential fetch every time you need a model
const llm = await createLLM();
const response = await llm.invoke('Summarize the OWASP MCP Top 10');
```

### LangChain Tool With Vault Credentials

If your LangChain agent uses tools that call external APIs, the same pattern applies:

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getSecret } from './vault';

const stripeBalanceTool = new DynamicStructuredTool({
  name: 'get_stripe_balance',
  description: 'Get current Stripe account balance',
  schema: z.object({}),
  func: async () => {
    // Fetch key at call time, not at tool construction time
    const stripeKey = await getSecret('stripe-live-key');
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const data = await res.json();
    return JSON.stringify(data);
  },
});

// Each tool invocation fetches a fresh credential from vault.
// If the key rotates between calls, agents automatically get the new version.
```

### Multi-Provider Agent

For agents that route between providers (the typical LiteLLM use case), the vault pattern handles all of them:

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { getSecret } from './vault';

type Provider = 'openai' | 'anthropic';

async function createModel(provider: Provider) {
  switch (provider) {
    case 'openai': {
      const apiKey = await getSecret('openai-api-key');
      return new ChatOpenAI({ openAIApiKey: apiKey, model: 'gpt-4o' });
    }
    case 'anthropic': {
      const apiKey = await getSecret('anthropic-api-key');
      return new ChatAnthropic({ anthropicApiKey: apiKey, model: 'claude-3-5-sonnet-20241022' });
    }
  }
}

// Zero env vars for API keys. One vault API key controls all of them.
// Rotate anthropic-api-key in vault → every future agent call uses the new key.
```

---

## Pattern 2: CrewAI — Vault Tool

CrewAI tools are `BaseTool` subclasses with a `_run` method. A vault tool that other tools can call, plus an example agent that uses the pattern for its primary API client:

### Vault Tool for CrewAI

```python
from crewai.tools import BaseTool
from pydantic import BaseModel, Field
from agentlair_vault import VaultClient  # or use httpx directly
import os

class VaultFetchInput(BaseModel):
    secret_name: str = Field(description="The name of the secret to fetch from vault")

class VaultFetchTool(BaseTool):
    name: str = "fetch_vault_secret"
    description: str = (
        "Fetch a secret from AgentLair Vault. Use this before calling any external "
        "API that requires authentication. Returns the plaintext secret value."
    )
    args_schema: type[BaseModel] = VaultFetchInput

    def _run(self, secret_name: str) -> str:
        """Fetch a secret from AgentLair Vault at runtime."""
        import httpx
        from agentlair_vault import VaultCrypto  # Python client

        seed = os.environ["VAULT_SEED"]
        api_key = os.environ["AGENTLAIR_API_KEY"]

        response = httpx.get(
            f"https://agentlair.dev/v1/vault/{secret_name}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        ciphertext = response.json()["ciphertext"]

        vc = VaultCrypto.from_seed(seed)
        return vc.decrypt(ciphertext, secret_name)
```

### CrewAI Agent Using Vault

```python
from crewai import Agent, Task, Crew
from crewai.tools import BaseTool
from pydantic import BaseModel, Field
import httpx
import os

class SearchInput(BaseModel):
    query: str = Field(description="Search query")

class VaultAwareSearchTool(BaseTool):
    name: str = "web_search"
    description: str = "Search the web using Brave Search API"
    args_schema: type[BaseModel] = SearchInput

    def _run(self, query: str) -> str:
        # Fetch credential at the moment of use
        api_key = self._get_vault_secret("brave-api-key")
        response = httpx.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": 5},
            headers={"X-Subscription-Token": api_key},
        )
        return response.json()

    def _get_vault_secret(self, name: str) -> str:
        """Helper: fetch and decrypt a vault secret."""
        from agentlair_vault import VaultCrypto
        vc = VaultCrypto.from_seed(os.environ["VAULT_SEED"])
        res = httpx.get(
            f"https://agentlair.dev/v1/vault/{name}",
            headers={"Authorization": f"Bearer {os.environ['AGENTLAIR_API_KEY']}"},
        )
        return vc.decrypt(res.json()["ciphertext"], name)


# Build the crew — no API keys in agent config, all fetched at runtime
researcher = Agent(
    role="Research Analyst",
    goal="Find accurate information on any topic",
    backstory="Expert at synthesizing web research",
    tools=[VaultAwareSearchTool()],
    verbose=True,
)

research_task = Task(
    description="Research the current state of AI agent security standards",
    expected_output="A concise summary of findings",
    agent=researcher,
)

crew = Crew(agents=[researcher], tasks=[research_task], verbose=True)
result = crew.kickoff()
```

### Using a CrewAI Agent's Own API Key From Vault

If the agent itself needs an LLM key (not from env), CrewAI supports custom LLM config:

```python
import os
import httpx
from crewai import Agent, LLM

def get_vault_secret(name: str) -> str:
    from agentlair_vault import VaultCrypto
    vc = VaultCrypto.from_seed(os.environ["VAULT_SEED"])
    res = httpx.get(
        f"https://agentlair.dev/v1/vault/{name}",
        headers={"Authorization": f"Bearer {os.environ['AGENTLAIR_API_KEY']}"},
    )
    return vc.decrypt(res.json()["ciphertext"], name)

# Fetch the LLM key from vault at agent construction time
llm = LLM(
    model="gpt-4o",
    api_key=get_vault_secret("openai-api-key"),  # fetched now, not at startup
)

agent = Agent(
    role="Analyst",
    goal="Provide analysis",
    backstory="Expert analyst",
    llm=llm,
)
```

---

## Pattern 3: Raw MCP — Inject Vault Credentials Into Server Config

MCP servers read credentials from their environment variables. The problem: [92% of MCP servers store secrets in plaintext config files](https://agentlair.dev/blog/mcp-security-identity-gap). The fix is a vault-aware launcher that injects secrets into the server's environment at startup — not in the config file.

### Claude Desktop: vault-aware MCP server wrapper

Instead of putting API keys in `claude_desktop_config.json`:

```json
// ❌ Status quo — credentials in plaintext config
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_yourtokenhere"
      }
    }
  }
}
```

Use a vault launcher script:

```json
// ✅ Vault pattern — only vault credentials in config
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["/path/to/vault-launcher.mjs", "@modelcontextprotocol/server-github"],
      "env": {
        "AGENTLAIR_API_KEY": "al_live_...",
        "VAULT_SEED": "a3f1..."
      }
    }
  }
}
```

```javascript
// vault-launcher.mjs — injects vault secrets into MCP server environment
import { spawn } from 'child_process';
import { VaultCrypto } from '@agentlair/vault-crypto';

const VAULT_MANIFEST = {
  // Maps env var names to vault key names
  GITHUB_TOKEN: 'github-token',
  STRIPE_SECRET_KEY: 'stripe-live-key',
  SLACK_BOT_TOKEN: 'slack-bot-token',
};

async function getVaultSecret(name) {
  const vc = VaultCrypto.fromSeed(process.env.VAULT_SEED);
  const res = await fetch(`https://agentlair.dev/v1/vault/${name}`, {
    headers: { Authorization: `Bearer ${process.env.AGENTLAIR_API_KEY}` },
  });
  if (!res.ok) return null; // Secret not in vault — skip injection
  const { ciphertext } = await res.json();
  return vc.decrypt(ciphertext, name);
}

async function launch(command, args) {
  // Build enriched environment: existing env + vault secrets
  const env = { ...process.env };

  for (const [envVar, vaultKey] of Object.entries(VAULT_MANIFEST)) {
    const secret = await getVaultSecret(vaultKey);
    if (secret) {
      env[envVar] = secret;
      console.error(`[vault-launcher] Injected ${envVar} from vault`);
    }
  }

  // Remove vault credentials from child process environment
  // The MCP server doesn't need vault access — it gets the plaintext it needs
  delete env.AGENTLAIR_API_KEY;
  delete env.VAULT_SEED;

  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code) => process.exit(code ?? 0));
}

const [command, ...args] = process.argv.slice(2);
launch(command, args);
```

### Using the launcher

```bash
# Store your GitHub token in vault
node -e "
import('@agentlair/vault-crypto').then(async ({ VaultCrypto }) => {
  const vc = VaultCrypto.fromSeed(process.env.VAULT_SEED);
  const ciphertext = await vc.encrypt('ghp_your_github_token', 'github-token');
  await fetch('https://agentlair.dev/v1/vault/github-token', {
    method: 'PUT',
    headers: { Authorization: \`Bearer \${process.env.AGENTLAIR_API_KEY}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext }),
  });
  console.log('Stored github-token in vault');
});
"

# Test the launcher directly
AGENTLAIR_API_KEY=al_live_... VAULT_SEED=a3f1... \
  node vault-launcher.mjs npx -y @modelcontextprotocol/server-github
```

### Self-contained MCP server with vault support

For MCP servers you write yourself:

```typescript
// my-mcp-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VaultCrypto } from '@agentlair/vault-crypto';

// Lazy credential fetcher — credentials fetched at call time, not at startup
function makeVaultClient() {
  const vc = VaultCrypto.fromSeed(process.env.VAULT_SEED!);
  const apiKey = process.env.AGENTLAIR_API_KEY!;

  return async (secretName: string): Promise<string> => {
    const res = await fetch(`https://agentlair.dev/v1/vault/${secretName}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const { ciphertext } = await res.json();
    return vc.decrypt(ciphertext, secretName);
  };
}

const getSecret = makeVaultClient();

const server = new Server(
  { name: 'my-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name === 'search') {
    // Credential fetched at call time — not held in process memory at idle
    const braveKey = await getSecret('brave-api-key');
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${request.params.arguments.query}`,
      { headers: { 'X-Subscription-Token': braveKey } }
    );
    return { content: [{ type: 'text', text: JSON.stringify(await res.json()) }] };
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## What This Prevents

| Threat | env var approach | Vault pattern |
|---|---|---|
| Supply chain `.pth` / startup script | All env vars harvested | Only vault API key exposed |
| Process memory dump mid-session | All credentials accessible | Only credentials fetched in last N calls |
| Malicious MCP skill reads config | Plaintext tokens in config | Opaque ciphertext, never plaintext on disk |
| Credential rotation | Requires process restart | Rotate in vault → next call uses new version |
| Multi-tenant blast radius | One compromised env = all keys | One vault key per agent, scoped access |

---

## Rotate Without Restart

The vault pattern makes rotation free. Update the secret in vault — every subsequent fetch returns the new value, across all agents, with no config changes and no restarts:

```bash
# Rotate the GitHub token
node -e "
import('@agentlair/vault-crypto').then(async ({ VaultCrypto }) => {
  const vc = VaultCrypto.fromSeed(process.env.VAULT_SEED);
  const ciphertext = await vc.encrypt('ghp_new_rotated_token', 'github-token');
  await fetch('https://agentlair.dev/v1/vault/github-token', {
    method: 'PUT',
    headers: { Authorization: \`Bearer \${process.env.AGENTLAIR_API_KEY}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext }),
  });
  console.log('Rotated. All agents will use the new token on their next call.');
});
"
```

---

## Getting Started

```bash
# 1. Install
npm install @agentlair/vault-crypto

# 2. Get vault credentials (no account form)
curl -X POST https://agentlair.dev/v1/auth/keys -H "Content-Type: application/json" -d '{}'
# → {"api_key": "al_live_...", ...}

# 3. Generate a seed (store this securely — it's your decryption key)
node -e "
import('@agentlair/vault-crypto').then(({ VaultCrypto }) => {
  const seed = VaultCrypto.generateSeed();
  const vc = VaultCrypto.fromSeed(seed);
  console.log('VAULT_SEED=' + vc.seedHex());
});
"

# 4. Store your first secret
VAULT_SEED=... AGENTLAIR_API_KEY=al_live_... node -e "
import('@agentlair/vault-crypto').then(async ({ VaultCrypto }) => {
  const vc = VaultCrypto.fromSeed(process.env.VAULT_SEED);
  const ciphertext = await vc.encrypt('sk-openai-abc123', 'openai-api-key');
  await fetch('https://agentlair.dev/v1/vault/openai-api-key', {
    method: 'PUT',
    headers: { Authorization: \`Bearer \${process.env.AGENTLAIR_API_KEY}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext }),
  });
  console.log('Stored.');
});
"
```

Free tier: 10 secrets, 100 requests/day. No credit card.

Source: [`@agentlair/vault-crypto`](https://github.com/piiiico/agentlair-vault-crypto) — open source, zero dependencies, Web Crypto API only.

→ [agentlair.dev](https://agentlair.dev)
