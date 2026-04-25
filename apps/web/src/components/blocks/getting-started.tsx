import { ArrowRight, Calendar, FileText, Layers, Lock, ShieldCheck, Terminal, Zap, Code } from "lucide-react";

import { Background } from "@/components/background";
import { CodeBlock } from "@/components/shared/code-block";
import { PageHeader } from "@/components/shared/page-header";
import { StepCard } from "@/components/shared/step-card";
import { Card, CardContent } from "@/components/ui/card";

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
      {children}
    </div>
  );
}

function BrowserTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-sm">
      <strong className="text-green-600 dark:text-green-400">
        Browser:
      </strong>{" "}
      {children}
    </div>
  );
}

const nextSteps = [
  {
    href: "/docs/concepts",
    icon: ShieldCheck,
    title: "Concepts",
    description:
      "What is an AAT? What is L4 behavioral trust? How does JWKS verification work?",
  },
  {
    href: "/docs/api-reference",
    icon: FileText,
    title: "API Reference",
    description:
      "All endpoints: registration, email, vault, trust scoring, tokens.",
  },
  {
    href: "/vault",
    icon: Lock,
    title: "Vault",
    description:
      "Zero-knowledge encrypted secret store. Versioned. Recoverable.",
  },
  {
    href: "/calendar",
    icon: Calendar,
    title: "Agent Calendar",
    description:
      "Create events via REST. Share an iCal feed. Humans subscribe in any calendar app.",
  },
  {
    href: "/pods",
    icon: Layers,
    title: "Agent Pods",
    description:
      "Multi-tenant isolation. Each pod gets its own API key, email, vault, and calendar.",
  },
  {
    href: "/docs/audit-logger",
    icon: Zap,
    title: "Audit Logger",
    description:
      "Log agent actions to build behavioral history and improve your trust score.",
  },
  {
    href: "https://github.com/piiiico/agentlair-python",
    icon: Code,
    title: "Python SDK",
    description:
      "pip install git+https://github.com/piiiico/agentlair-python.git — async-first, typed, zero extra dependencies.",
  },
];

export function GettingStarted() {
  return (
    <>
      <Background>
        <PageHeader
          title="Getting Started with AgentLair"
          description="Register your agent, send email, store secrets, and check your trust score. Under 5 minutes."
          badges={["Identity", "Email", "Vault", "Trust"]}
        />
      </Background>

      <section className="pb-28 lg:pb-32 pt-4">
        <div className="container max-w-3xl space-y-6">

          {/* ── Step 1: Register ─────────────────────────────────────────────── */}
          <StepCard number={1} title="Register your agent">
            <p>
              One call creates your account. No email, no credit card, no
              verification — instant access. You get an API key, a persistent
              agent identity, and a built-in{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                @agentlair.dev
              </code>{" "}
              email address.
            </p>

            <BrowserTip>
              Go to{" "}
              <a
                href="/register"
                className="text-primary underline underline-offset-4"
              >
                agentlair.dev/register
              </a>{" "}
              and click <strong className="text-foreground">"Create Free Account"</strong>.
              Your API key appears immediately.
            </BrowserTip>

            <CodeBlock
              code={`curl -X POST https://agentlair.dev/v1/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-agent"}'
→ {
    "api_key": "al_live_k7x9m2p4...",
    "account_id": "acc_7kX9mP2qR4wL",
    "email_address": "my-agent@agentlair.dev",
    "tier": "free"
  }`}
              language="bash"
              title="Terminal"
            />

            <Tip>
              <strong className="text-foreground">Save your API key!</strong>{" "}
              It's shown only once. Store it as{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                AGENTLAIR_API_KEY
              </code>{" "}
              in your environment. Your{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                email_address
              </code>{" "}
              is auto-assigned and ready to use immediately.
            </Tip>
          </StepCard>

          {/* ── Step 2: Send Email ───────────────────────────────────────────── */}
          <StepCard number={2} title="Send your first email">
            <p>
              Use the{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                email_address
              </code>{" "}
              from step 1 to send an email from your agent. The{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                text
              </code>{" "}
              field carries the plain-text body.
            </p>

            <BrowserTip>
              Open the{" "}
              <a
                href="/dashboard"
                className="text-primary underline underline-offset-4"
              >
                dashboard
              </a>
              , find the <strong className="text-foreground">Compose Email</strong>{" "}
              section, fill in the form, and click{" "}
              <strong className="text-foreground">Send</strong>.
            </BrowserTip>

            <CodeBlock
              code={`curl -X POST https://agentlair.dev/v1/email/send \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "my-agent@agentlair.dev",
    "to": ["your-real-email@gmail.com"],
    "subject": "Hello from AgentLair!",
    "text": "This is my agent speaking."
  }'`}
              language="bash"
              title="Terminal"
            />

            <Tip>
              <strong className="text-foreground">Use an external address for testing.</strong>{" "}
              Sending to another{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">@agentlair.dev</code>{" "}
              address works — it delivers to their inbox. For this test, use Gmail,
              Outlook, or any external address so you can verify receipt directly in
              your regular email client.
            </Tip>
          </StepCard>

          {/* ── Step 3: Store Secret ─────────────────────────────────────────── */}
          <StepCard number={3} title="Store a secret in Vault">
            <p>
              Keep your agent's credentials safe across container restarts.{" "}
              <strong className="text-foreground">Zero-knowledge design:</strong>{" "}
              secrets are encrypted client-side before leaving your machine —
              AgentLair stores only ciphertext. The vault API accepts{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                PUT /v1/vault/&#123;key&#125;
              </code>{" "}
              with a{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                &#123;"ciphertext": "..."&#125;
              </code>{" "}
              body.
            </p>

            <CodeBlock
              code="npm install @agentlair/vault-crypto"
              language="bash"
              title="Install"
            />

            <CodeBlock
              code={`import { VaultCrypto } from '@agentlair/vault-crypto';

const seed = VaultCrypto.generateSeed();
const vc = VaultCrypto.fromSeed(seed);

// Encrypt before storing
const ct = await vc.encrypt('sk-openai-abc123', 'openai-key');
await fetch('https://agentlair.dev/v1/vault/openai-key', {
  method: 'PUT',
  headers: {
    'Authorization': \`Bearer \${process.env.AGENTLAIR_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ ciphertext: ct }),
});

// Retrieve and decrypt later
const res = await fetch('https://agentlair.dev/v1/vault/openai-key', {
  headers: { 'Authorization': \`Bearer \${process.env.AGENTLAIR_API_KEY}\` },
});
const plain = await vc.decrypt((await res.json()).ciphertext, 'openai-key');`}
              language="typescript"
              title="vault.ts"
            />

            <Tip>
              <strong className="text-foreground">Save the seed hex.</strong>{" "}
              Call{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                vc.seedHex()
              </code>{" "}
              and store it in an env var — you need it to decrypt. Or use{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                encryptSeedBackup()
              </code>{" "}
              with a passphrase for recovery.{" "}
              <a
                href="/vault"
                className="text-primary underline underline-offset-4"
              >
                Learn more about Vault →
              </a>
            </Tip>
          </StepCard>

          {/* ── Step 4: Check Trust Score ────────────────────────────────────── */}
          <StepCard number={4} title="Check your trust score">
            <p>
              Every agent starts with a cold-start score of{" "}
              <strong className="text-foreground">30</strong>. Trust builds
              through consistent, transparent behavior observed across all
              services using AgentLair for verification.
            </p>

            <CodeBlock
              code={`# Use your account_id from step 1
curl https://agentlair.dev/v1/trust/acc_7kX9mP2qR4wL \\
  -H "Authorization: Bearer YOUR_API_KEY"
→ {
    "agentId": "acc_7kX9mP2qR4wL",
    "score": 30,
    "atfLevel": "intern",
    "trend": "stable",
    "dimensions": {
      "consistency":  { "score": 30 },
      "restraint":    { "score": 30 },
      "transparency": { "score": 30 }
    },
    "observationCount": 1
  }`}
              language="bash"
              title="Terminal"
            />

            <div className="rounded-xl border overflow-hidden text-sm">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-semibold text-foreground">Level</th>
                    <th className="px-4 py-2 text-left font-semibold text-foreground">Score</th>
                    <th className="px-4 py-2 text-left font-semibold text-foreground">Meaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-muted-foreground">
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs">intern</td>
                    <td className="px-4 py-2">0–39</td>
                    <td className="px-4 py-2">No behavioral history — you start here</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs">junior</td>
                    <td className="px-4 py-2">40–59</td>
                    <td className="px-4 py-2">Some signal, limited cross-org coverage</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs">senior</td>
                    <td className="px-4 py-2">60–79</td>
                    <td className="px-4 py-2">Established behavioral baseline</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs">principal</td>
                    <td className="px-4 py-2">80–100</td>
                    <td className="px-4 py-2">Deep history, high transparency</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <Tip>
              Score builds through consistent behavior, transparent audit trails,
              and cross-organizational verification. Use the{" "}
              <a href="/docs/audit-logger" className="text-primary underline underline-offset-4">
                Audit Logger
              </a>{" "}
              to log agent actions and accelerate trust accumulation.
            </Tip>
          </StepCard>

          {/* ── Completion card ──────────────────────────────────────────────── */}
          <Card className="text-center">
            <CardContent className="space-y-6 px-6 py-8">
              <div className="space-y-2">
                <div className="text-3xl">✓</div>
                <h2 className="text-foreground text-2xl font-bold tracking-tight">
                  Your agent is live
                </h2>
                <p className="text-muted-foreground mx-auto max-w-md">
                  You registered, sent email, stored a secret, and have a live
                  trust score. Here's what to explore next:
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {nextSteps.map((item) => {
                  const Icon = item.icon;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className="group block rounded-xl border p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <Icon className="text-primary size-4" />
                        <h3 className="text-foreground text-sm font-bold">
                          {item.title}
                        </h3>
                        <ArrowRight className="text-muted-foreground ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {item.description}
                      </p>
                    </a>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ── Optional: Additional addresses ───────────────────────────────── */}
          <div className="pt-4 border-t">
            <h2 className="text-foreground text-lg font-bold mb-4">Optional setup</h2>
            <div className="space-y-6">

              <StepCard number={5} title="Claim additional email addresses" optional>
                <p>
                  Pick any available{" "}
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">@agentlair.dev</code>{" "}
                  address for your agent. You can claim up to 10 on the free tier.
                </p>
                <CodeBlock
                  code={`curl -X POST https://agentlair.dev/v1/email/claim \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"address": "research-agent@agentlair.dev"}'
→ {
    "claimed": true,
    "address": "research-agent@agentlair.dev"
  }`}
                  language="bash"
                  title="Terminal"
                />
              </StepCard>

              <StepCard number={6} title="Check your inbox" optional>
                <p>
                  After an external address replies to your email, check what arrived.
                </p>
                <BrowserTip>
                  The{" "}
                  <a
                    href="/dashboard"
                    className="text-primary underline underline-offset-4"
                  >
                    dashboard
                  </a>{" "}
                  shows your inbox under each address. Click a message to read it.
                </BrowserTip>
                <CodeBlock
                  code={`curl https://agentlair.dev/v1/email/inbox?address=my-agent@agentlair.dev \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
                  language="bash"
                  title="Terminal"
                />
              </StepCard>

              <StepCard number={7} title="Set a recovery email" optional>
                <p>
                  Attach a personal email to your account. Enables magic-link
                  dashboard login and API key recovery.
                </p>
                <CodeBlock
                  code={`curl -X POST https://agentlair.dev/v1/account/recovery-email \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "you@example.com"}'`}
                  language="bash"
                  title="Terminal"
                />
              </StepCard>

              <StepCard number={8} title="Set up your Agent Calendar" optional>
                <p>
                  Every agent address has a built-in calendar. Create events via
                  REST, then share a public iCal URL — humans subscribe in
                  Google Calendar, Apple Calendar, or any calendar app.
                </p>
                <CodeBlock
                  code={`curl -X POST https://agentlair.dev/v1/calendar/events \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "address": "my-agent@agentlair.dev",
    "title": "Weekly sync",
    "start": "2026-04-01T10:00:00Z",
    "end": "2026-04-01T11:00:00Z"
  }'
→ { "event_id": "evt_abc123", "ical_url": "https://agentlair.dev/v1/calendar/my-agent@agentlair.dev/ical" }`}
                  language="bash"
                  title="Terminal"
                />
                <Tip>
                  <strong className="text-foreground">Subscribe in Google Calendar:</strong>{" "}
                  Open Google Calendar → click <strong className="text-foreground">+</strong>{" "}
                  next to "Other calendars" → "From URL" → paste the iCal URL.{" "}
                  <a href="/calendar" className="text-primary underline underline-offset-4">
                    Learn more →
                  </a>
                </Tip>
              </StepCard>

              <StepCard number={9} title="Use the Python SDK" optional>
                <p>
                  If you're building Python agents, install the official SDK and
                  skip raw HTTP entirely. Async-first, fully typed, one dependency:{" "}
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">httpx</code>.
                </p>
                <CodeBlock
                  code="pip install git+https://github.com/piiiico/agentlair-python.git"
                  language="bash"
                  title="Install"
                />
                <CodeBlock
                  code={`import asyncio
import agentlair

async def main():
    async with agentlair.AgentLair("al_live_...") as lair:
        score = await lair.trust.score()
        print(f"Trust: {score['score']}/100 ({score['atfLevel']})")

        await lair.email.send(
            from_address="my-agent@agentlair.dev",
            to="you@example.com",
            subject="Hello from Python",
            text="Sent via the AgentLair Python SDK.",
        )

asyncio.run(main())`}
                  language="python"
                  title="agent.py"
                />
                <Tip>
                  Full source and docs at{" "}
                  <a
                    href="https://github.com/piiiico/agentlair-python"
                    className="text-primary underline underline-offset-4"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    github.com/piiiico/agentlair-python
                  </a>.
                  PyPI publish is in progress — git-install works today.
                </Tip>
              </StepCard>

              <StepCard number={10} title="Issue an Agent Authentication Token (AAT)" optional>
                <p>
                  Issue a short-lived{" "}
                  <strong className="text-foreground">signed JWT</strong> your
                  agent can present to any external service. The receiving service
                  verifies it offline via AgentLair's JWKS endpoint — no round-trip
                  needed. Attach it as a Bearer token in downstream requests.
                </p>

                <CodeBlock
                  code={`curl -X POST https://agentlair.dev/v1/tokens/issue \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "label": "my-service-token",
    "ttl": 3600,
    "audience": "https://your-service.com",
    "scopes": ["read", "write"]
  }'
→ {
    "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_at": "2026-04-25T13:11:32.000Z",
    "expires_in": 3600,
    "jti": "aat_u6hT2o4LASbDsuGc",
    "audit_url": "https://agentlair.dev/v1/audit/aat_u6hT2o4LASbDsuGc"
  }`}
                  language="bash"
                  title="Terminal"
                />

                <Tip>
                  <strong className="text-foreground">audience</strong> is the
                  URI of the service you're calling — it gets embedded in the JWT
                  so the receiver can confirm the token was minted for them.{" "}
                  <strong className="text-foreground">scopes</strong> must be a
                  non-empty array. Verify tokens at your service with:{" "}
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                    GET https://agentlair.dev/.well-known/jwks.json
                  </code>.{" "}
                  <a href="/docs/api-reference#post-v1tokensissue" className="text-primary underline underline-offset-4">
                    Full AAT reference →
                  </a>
                </Tip>
              </StepCard>

              <StepCard number={11} title="Create an Agent Pod" optional>
                <p>
                  Pods give each of your clients a fully isolated environment —
                  their own API key, email address, vault, and calendar — all
                  under your master account. Ideal for multi-tenant products.
                </p>
                <BrowserTip>
                  Open the{" "}
                  <a
                    href="/pods"
                    className="text-primary underline underline-offset-4"
                  >
                    Pods dashboard
                  </a>{" "}
                  and click <strong className="text-foreground">"Create Pod"</strong>.
                </BrowserTip>
                <CodeBlock
                  code={`curl -X POST https://agentlair.dev/v1/pods \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "acme-corp"}'
→ {
    "pod_id": "pod_abc123",
    "api_key": "al_live_pod_...",
    "name": "acme-corp"
  }`}
                  language="bash"
                  title="Terminal"
                />
                <Tip>
                  <strong className="text-foreground">One master key, many clients.</strong>{" "}
                  Hand each pod's API key to your client — it's scoped exclusively
                  to that pod's email, vault, and calendar.{" "}
                  <a href="/pods" className="text-primary underline underline-offset-4">
                    Learn more →
                  </a>
                </Tip>
              </StepCard>

            </div>
          </div>

          <div className="text-muted-foreground text-center text-sm pb-8">
            <strong className="text-foreground">Need help?</strong> Email{" "}
            <a
              href="mailto:hello@agentlair.dev"
              className="text-primary underline underline-offset-4"
            >
              hello@agentlair.dev
            </a>{" "}
            — we respond within 24 hours.
          </div>

        </div>
      </section>
    </>
  );
}
