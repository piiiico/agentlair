import { ArrowRight, BookOpen, Calendar, Mail, Shield } from "lucide-react";

import { Background } from "@/components/background";
import { CodeBlock } from "@/components/shared/code-block";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

// ---------------------------------------------------------------------------
// Code examples as template literals (JSX-unfriendly characters: { } ` $ =>)
// ---------------------------------------------------------------------------

const tsCode = `// Install: bun add @agentlair/vault-crypto  (or npm, pnpm, yarn)
import { VaultCrypto } from '@agentlair/vault-crypto';

// One-time setup (30 seconds)
const apiKey = await fetch('https://api.agentlair.dev/v1/auth/keys', {
  method: 'POST'
}).then(r => r.json()).then(r => r.api_key);

const seed = VaultCrypto.generateSeed();  // save this!
const vault = VaultCrypto.fromSeed(seed);

// Store a secret
const ciphertext = await vault.encrypt('sk-proj-abc123', 'openai');
await fetch('https://api.agentlair.dev/v1/vault/openai', {
  method: 'PUT',
  headers: {
    'Authorization': \`Bearer \${apiKey}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ ciphertext }),
});

// Retrieve it — from any agent, anywhere
const { ciphertext: stored } = await fetch(
  'https://api.agentlair.dev/v1/vault/openai',
  { headers: { 'Authorization': \`Bearer \${apiKey}\` } }
).then(r => r.json());

const secret = await vault.decrypt(stored, 'openai');
// secret === 'sk-proj-abc123'`;

const curlCode = `# Create account
API_KEY=$(curl -s -X POST https://api.agentlair.dev/v1/auth/keys | jq -r .api_key)

# Store (you encrypt client-side first — see TypeScript tab)
curl -X PUT https://api.agentlair.dev/v1/vault/my-secret \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ciphertext": "YOUR_ENCRYPTED_BLOB"}'
# -> { "key": "my-secret", "stored": true, "version": 1 }

# Retrieve
curl https://api.agentlair.dev/v1/vault/my-secret \\
  -H "Authorization: Bearer $API_KEY"
# -> { "ciphertext": "YOUR_ENCRYPTED_BLOB", "version": 1 }

# List all keys
curl https://api.agentlair.dev/v1/vault/ \\
  -H "Authorization: Bearer $API_KEY"
# -> { "keys": [...], "count": 1, "limit": 10 }`;

const pythonCode = `# Coming soon: pip install agentlair
# Python SDK is in development. For now, use curl or the TypeScript library.
#
# What it will look like:
#
# from agentlair import Client, VaultCrypto
#
# client = Client(api_key="al_live_...")
# vault = VaultCrypto.from_seed(VaultCrypto.generate_seed())
#
# encrypted = vault.encrypt("sk-proj-abc123", "openai")
# client.vault.put("openai", ciphertext=encrypted)
#
# Want Python support? Star the repo and open an issue:
# github.com/piiiico/agentlair`;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const problemStats = [
  {
    number: "92%",
    text: "of MCP servers store secrets in plaintext config files",
  },
  {
    number: "~0",
    text: "AI agent frameworks include a credential primitive — they recommend \"use .env files\"",
  },
  {
    number: "6 mo",
    text: "average enterprise secrets manager rollout — requires sales call, IAM policy, ops team",
  },
];

const howItWorksSteps = [
  {
    num: 1,
    title: "Your agent encrypts locally",
    body: (
      <>
        Call{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          VaultCrypto.encrypt(&quot;sk-proj-abc123&quot;, &quot;openai-key&quot;)
        </code>
        . The plaintext never leaves your process.
      </>
    ),
  },
  {
    num: 2,
    title: "Encrypted blob hits our API",
    body: (
      <>
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          PUT /v1/vault/openai-key
        </code>{" "}
        — we receive ciphertext. Opaque, meaningless without your seed.
      </>
    ),
  },
  {
    num: 3,
    title: "We store opaque ciphertext",
    body: (
      <>
        Server stores:{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          aeGx8kF...
        </code>{" "}
        — meaningless without your seed. We literally cannot read it.
      </>
    ),
  },
  {
    num: 4,
    title: "Your agent retrieves and decrypts",
    body: (
      <>
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          GET /v1/vault/openai-key
        </code>{" "}
        returns the blob. You call{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          vault.decrypt()
        </code>
        . You get your secret back.
      </>
    ),
  },
];

const codeTabs = [
  {
    id: "ts",
    label: "TypeScript",
    code: tsCode,
    language: "typescript",
    title: "agent.ts",
    note: (
      <>
        <strong className="text-foreground">npm:</strong>{" "}
        <a
          href="https://www.npmjs.com/package/@agentlair/vault-crypto"
          className="text-primary underline underline-offset-4"
        >
          @agentlair/vault-crypto
        </a>{" "}
        &middot;{" "}
        <a
          href="https://github.com/piiiico/agentlair-vault-crypto"
          className="text-primary underline underline-offset-4"
        >
          GitHub
        </a>{" "}
        &middot; AES-256-GCM + HKDF-SHA-256. Zero dependencies.
      </>
    ),
  },
  {
    id: "curl",
    label: "curl",
    code: curlCode,
    language: "bash",
    title: "terminal",
    note: null,
  },
  {
    id: "python",
    label: "Python",
    code: pythonCode,
    language: "python",
    title: "agent.py",
    note: (
      <>
        <a
          href="https://github.com/piiiico/agentlair"
          className="text-primary underline underline-offset-4"
        >
          Request Python SDK on GitHub &rarr;
        </a>
      </>
    ),
  },
];

const frameworks = [
  "LangChain",
  "LangGraph",
  "CrewAI",
  "AutoGen",
  "MCP Servers",
  "Mastra",
  "Claude SDK",
  "OpenAI Agents",
  "Any HTTP client",
];

const keyFeatures = [
  {
    title: "Version history",
    description:
      "Every PUT auto-increments version. Roll back with ?version=N. Old versions retained at tier limits.",
  },
  {
    title: "Email recovery",
    description:
      "Register a recovery email. When container dies and API key is lost — recover all secrets via magic link.",
  },
  {
    title: "Metadata",
    description:
      "Attach labels, algorithm hints, and agent IDs to each secret. Stored in plaintext for operational use.",
  },
  {
    title: "Agent-native payments",
    description:
      "Agents pay per-request via HTTP 402 + USDC on Base when free-tier limits are hit. No human billing needed.",
  },
];

const pricingFree = [
  "10 secrets",
  "3 versions per secret",
  "16 KB per value",
  "100 API calls/day",
  "Email recovery",
  "No credit card required",
];

const pricingPro = [
  "Unlimited secrets",
  "100 versions per secret",
  "64 KB per value",
  "10,000 API calls/day",
  "Priority support",
  "x402 autonomous payments",
];

const securityItems = [
  "Client-side encryption (AES-256-GCM)",
  "Per-key derivation (HKDF-SHA-256)",
  "API keys hashed server-side (SHA-256)",
  "Zero-knowledge: server stores opaque blobs",
  "Single-use recovery tokens (15 min TTL)",
  "Edge-deployed on Cloudflare (200+ PoPs)",
  "Open-source crypto library (npm)",
  "Built on Web Crypto API (no dependencies)",
];

const comparisons = [
  {
    title: "vs AWS / GCP Secrets Manager",
    description:
      "They see your plaintext. Require IAM setup (~1 hour). We take 30 seconds and never see your secrets.",
  },
  {
    title: "vs HashiCorp Vault",
    description:
      "Requires server setup (~1 day). Needs unseal keys, ops team, enterprise license. We're a single PUT request away from running.",
  },
  {
    title: "vs Infisical",
    description:
      "Server decrypts your secrets. Dashboard required. We store opaque blobs we literally cannot read.",
  },
  {
    title: "vs .env files",
    description:
      "Gone when the container dies. No recovery. No versioning. No audit trail. No encryption.",
  },
  {
    title: "vs openclaw.json",
    description:
      "Claude SDK stores config and credentials in openclaw.json — plaintext on disk. One leaked file exposes everything. Vault gives your Claude agents encrypted secrets from day one.",
  },
];

const trustPillars = [
  {
    icon: "🔒",
    title: "Zero-knowledge: we store gibberish",
    body: "Your secret enters as plaintext inside your process. It leaves as an encrypted blob. Our server receives and stores opaque ciphertext — bytes that are meaningless without your seed. There is no master decryption key on our end. We cannot read your secrets even if we wanted to.",
    link: null,
  },
  {
    icon: "📖",
    title: "Open-source crypto — verify it yourself",
    body: "The encryption library is public. Read the code, run the tests, fork it. AES-256-GCM + HKDF-SHA-256. Built on the Web Crypto API with zero external dependencies. Don't trust our description — audit the implementation.",
    link: {
      href: "https://github.com/piiiico/agentlair-vault-crypto",
      label: "github.com/piiiico/agentlair-vault-crypto →",
    },
  },
  {
    icon: "📋",
    title: "Every access logged",
    body: "Every GET, PUT, and DELETE is recorded with a timestamp and your agent's identity. Full audit trail — you see exactly who accessed what and when. Nothing happens silently.",
    link: null,
  },
];

const apiEndpoints = [
  {
    method: "POST",
    endpoint: "/v1/auth/keys",
    description: "Create account (no auth needed)",
  },
  {
    method: "GET",
    endpoint: "/v1/vault/",
    description: "List all keys (metadata, no ciphertext)",
  },
  {
    method: "PUT",
    endpoint: '/v1/vault/{key}',
    description: 'Store encrypted blob (body: {"ciphertext", "metadata?"})',
  },
  {
    method: "GET",
    endpoint: '/v1/vault/{key}',
    description: "Retrieve secret (?version=N for specific version)",
  },
  {
    method: "DELETE",
    endpoint: '/v1/vault/{key}',
    description: "Delete all versions (?version=N for one)",
  },
  {
    method: "POST",
    endpoint: "/v1/vault/recovery-email",
    description: "Register recovery email + encrypted seed",
  },
];

const tierLimits = [
  { label: "Secrets", free: "10 keys", pro: "Unlimited" },
  { label: "Version history", free: "3 per key", pro: "100 per key" },
  { label: "Max blob size", free: "16 KB", pro: "64 KB" },
  { label: "API requests/day", free: "100 (shared)", pro: "10,000" },
  { label: "Recovery emails", free: "1", pro: "3" },
];

const nextSteps = [
  {
    href: "/getting-started",
    icon: ArrowRight,
    title: "Get API Key — Free",
    description: "Create an account in 30 seconds. No credit card, no IAM, no human setup.",
  },
  {
    href: "/security",
    icon: Shield,
    title: "Security Details",
    description: "Read the full security architecture — cryptographic primitives, not trust.",
  },
  {
    href: "/integrations",
    icon: BookOpen,
    title: "Framework Integrations",
    description: "LangChain, CrewAI, Vercel AI SDK, Claude MCP — works with everything.",
  },
  {
    href: "/",
    icon: Mail,
    title: "Agent Email",
    description: "Give your agents a real email address. Claim @agentlair.dev in 30 seconds.",
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VaultHero() {
  return (
    <Background>
      <PageHeader
        title="The credential store AI agents actually use."
        description="Zero-knowledge. Edge-deployed. 30-second setup. Your secrets are encrypted before they leave your agent."
        badges={["Live", "Zero-knowledge"]}
      />
      <div className="container pb-12">
        <div className="flex flex-wrap gap-3">
          <a
            href="/getting-started"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
          >
            Get API Key — Free &rarr;
          </a>
          <a
            href="#how-it-works"
            className="border-border text-foreground hover:border-primary/50 hover:text-primary rounded-lg border px-6 py-3 text-sm font-semibold transition-colors"
          >
            Read the Docs
          </a>
        </div>
      </div>
    </Background>
  );
}

function VaultProblem() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">
        The state of agent credentials today
      </h2>
      <p className="text-muted-foreground text-sm">
        The AI agent ecosystem has a secrets problem. And nobody is solving it.
      </p>
      <Card>
        <CardContent className="divide-y p-0">
          {problemStats.map((stat) => (
            <div key={stat.number} className="flex items-baseline gap-4 px-6 py-4">
              <span className="text-destructive min-w-12 text-2xl font-extrabold">
                {stat.number}
              </span>
              <span className="text-muted-foreground text-sm">{stat.text}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-sm">
        Your agent deserves better. The bar is low — and we clear it in 30 seconds.
      </p>
    </div>
  );
}

function VaultHowItWorks() {
  return (
    <div id="how-it-works" className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">How it works</h2>
      <p className="text-muted-foreground text-sm">
        Four steps. One of them is our server. The rest happen inside your agent.
      </p>
      <Card>
        <CardContent className="divide-y p-0">
          {howItWorksSteps.map((step) => (
            <div key={step.num} className="flex items-start gap-4 px-6 py-4">
              <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {step.num}
              </div>
              <div className="space-y-1">
                <h3 className="text-foreground text-sm font-semibold">{step.title}</h3>
                <p className="text-muted-foreground text-sm">{step.body}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function VaultCodeExamples() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Get started in 30 seconds</h2>
      <p className="text-muted-foreground text-sm">Pick your language:</p>
      <Tabs defaultValue="ts">
        <TabsList className="flex-wrap">
          {codeTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {codeTabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            <Card>
              <CardContent className="space-y-4">
                <CodeBlock code={tab.code} language={tab.language} title={tab.title} />
                {tab.note && (
                  <div className="text-muted-foreground rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                    {tab.note}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function VaultFrameworks() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Works with your framework</h2>
      <p className="text-muted-foreground text-sm">
        Vault is a REST API. It works with everything that can make an HTTP request.
      </p>
      <div className="flex flex-wrap gap-2">
        {frameworks.map((fw) => (
          <span
            key={fw}
            className="bg-card border-border rounded-md border px-3 py-1.5 text-sm"
          >
            {fw}
          </span>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        Building a framework integration?{" "}
        <a
          href="https://github.com/piiiico/agentlair"
          className="text-primary underline underline-offset-4"
        >
          Open a PR &rarr;
        </a>
      </p>
    </div>
  );
}

function VaultFeatures() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Key features</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {keyFeatures.map((feat) => (
          <Card key={feat.title}>
            <CardContent className="space-y-2">
              <h3 className="text-foreground text-sm font-semibold">{feat.title}</h3>
              <p className="text-muted-foreground text-sm">{feat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VaultPricing() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Pricing</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Free */}
        <Card>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-foreground font-semibold">Free</h3>
              <div className="text-foreground text-3xl font-extrabold">
                $0
              </div>
            </div>
            <ul className="space-y-1.5">
              {pricingFree.map((item) => (
                <li key={item} className="text-muted-foreground flex items-center gap-2 text-sm">
                  <span className="font-bold text-green-500">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Pro */}
        <Card className="border-primary/50">
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-foreground font-semibold">Pro</h3>
                <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  Popular
                </span>
              </div>
              <div className="text-foreground text-3xl font-extrabold">
                $9{" "}
                <span className="text-muted-foreground text-sm font-normal">/month</span>
              </div>
            </div>
            <ul className="space-y-1.5">
              {pricingPro.map((item) => (
                <li key={item} className="text-muted-foreground flex items-center gap-2 text-sm">
                  <span className="font-bold text-green-500">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <p className="text-muted-foreground text-center text-sm">
        Pro tier coming soon. Free tier is permanent — no expiry, no bait-and-switch.
        <br />
        Autonomous agents:{" "}
        <strong className="text-foreground">x402 payments</strong> available — agents pay per-call at
        $0.001/request.{" "}
        <a href="/security" className="text-primary underline underline-offset-4">
          Security details &rarr;
        </a>
      </p>
    </div>
  );
}

function VaultSecurity() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Security model</h2>
      <p className="text-muted-foreground text-sm">
        Built on cryptographic primitives, not trust. Open-source, auditable, edge-deployed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {securityItems.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 font-bold text-green-500">✓</span>
            <span className="text-muted-foreground">{item}</span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        <a href="/security" className="text-primary underline underline-offset-4">
          Read the full security architecture &rarr;
        </a>
      </p>
    </div>
  );
}

function VaultComparisons() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Why not just use&hellip;?</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {comparisons.map((comp) => (
          <Card key={comp.title}>
            <CardContent className="space-y-2">
              <h3 className="text-foreground text-sm font-semibold">{comp.title}</h3>
              <p className="text-muted-foreground text-sm">{comp.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VaultTrust() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-xl font-bold">
          Why send your credentials to us?
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          A fair question. Here&apos;s the honest answer — backed by cryptography, not promises.
        </p>
      </div>
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="divide-y p-0">
          {trustPillars.map((pillar) => (
            <div key={pillar.title} className="flex items-start gap-4 px-6 py-5">
              <span className="mt-0.5 text-2xl leading-none">{pillar.icon}</span>
              <div className="space-y-1.5">
                <h3 className="text-foreground text-sm font-semibold">{pillar.title}</h3>
                <p className="text-muted-foreground text-sm">{pillar.body}</p>
                {pillar.link && (
                  <a
                    href={pillar.link.href}
                    className="text-primary text-sm underline underline-offset-4"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {pillar.link.label}
                  </a>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function VaultApiRef() {
  return (
    <div className="space-y-6">
      <h2 className="text-foreground text-xl font-bold">API reference</h2>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-6 py-3 text-left font-semibold">
                    Method
                  </th>
                  <th className="text-muted-foreground px-6 py-3 text-left font-semibold">
                    Endpoint
                  </th>
                  <th className="text-muted-foreground px-6 py-3 text-left font-semibold">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {apiEndpoints.map((ep) => (
                  <tr key={ep.endpoint}>
                    <td className="px-6 py-3">
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                        {ep.method}
                      </code>
                    </td>
                    <td className="px-6 py-3">
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                        {ep.endpoint}
                      </code>
                    </td>
                    <td className="text-muted-foreground px-6 py-3">{ep.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h3 className="text-foreground text-sm font-semibold">Tier limits</h3>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted-foreground px-6 py-3 text-left font-semibold"></th>
                    <th className="text-muted-foreground px-6 py-3 text-left font-semibold">
                      Free
                    </th>
                    <th className="text-muted-foreground px-6 py-3 text-left font-semibold">
                      Pro ($9/mo)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tierLimits.map((row) => (
                    <tr key={row.label}>
                      <td className="text-muted-foreground px-6 py-3">{row.label}</td>
                      <td className="text-foreground px-6 py-3">{row.free}</td>
                      <td className="text-foreground px-6 py-3">{row.pro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function VaultCta() {
  return (
    <>
      <div className="space-y-6 text-center">
        <div>
          <h2 className="text-foreground text-xl font-bold">
            The credential store AI agents actually use.
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Free tier. No credit card. No IAM. No human setup.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="/getting-started"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
          >
            Get API Key — Free &rarr;
          </a>
          <a
            href="/security"
            className="border-border text-foreground hover:border-primary/50 hover:text-primary rounded-lg border px-6 py-3 text-sm font-semibold transition-colors"
          >
            Security details
          </a>
        </div>
        <p className="text-muted-foreground text-xs">
          <a href="/v1/vault/" className="text-primary underline underline-offset-4">
            API reference
          </a>{" "}
          &middot;{" "}
          <a href="/dashboard" className="text-primary underline underline-offset-4">
            Dashboard
          </a>{" "}
          &middot;{" "}
          <a
            href="https://www.npmjs.com/package/@agentlair/vault-crypto"
            className="text-primary underline underline-offset-4"
          >
            npm
          </a>{" "}
          &middot;{" "}
          <a
            href="https://github.com/piiiico/agentlair"
            className="text-primary underline underline-offset-4"
          >
            GitHub
          </a>
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-foreground text-xl font-bold">Explore more</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {nextSteps.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                className="group block rounded-xl border p-5 transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="text-primary size-4" />
                  <h3 className="text-foreground text-sm font-bold">{item.title}</h3>
                  <ArrowRight className="text-muted-foreground ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {item.description}
                </p>
              </a>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component — composes all sub-sections
// ---------------------------------------------------------------------------

export function Vault() {
  return (
    <>
      <VaultHero />

      <section className="pb-28 lg:pb-32">
        <div className="container max-w-3xl space-y-16">
          <VaultProblem />
          <VaultHowItWorks />
          <VaultTrust />
          <VaultCodeExamples />
          <VaultFrameworks />
          <VaultFeatures />
          <VaultPricing />
          <VaultSecurity />
          <VaultComparisons />
          <VaultApiRef />
          <VaultCta />
        </div>
      </section>
    </>
  );
}
