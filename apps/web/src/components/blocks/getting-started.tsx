import { ArrowRight, BookOpen, Calendar, LayoutDashboard, Layers, Lock } from "lucide-react";

import { Background } from "@/components/background";
import { CodeBlock } from "@/components/shared/code-block";
import { PageHeader } from "@/components/shared/page-header";
import { StepCard } from "@/components/shared/step-card";
import { Card, CardContent } from "@/components/ui/card";

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

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
      {children}
    </div>
  );
}

const nextSteps = [
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    description:
      "Manage addresses, read inbox, compose emails, and monitor usage.",
  },
  {
    href: "/api",
    icon: BookOpen,
    title: "API Reference",
    description:
      "Full API documentation with all endpoints, parameters, and examples.",
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
      "Multi-tenant isolation. Each pod gets its own API key, email, vault, and calendar — fully sandboxed per client.",
  },
];

export function GettingStarted() {
  return (
    <>
      <Background>
        <PageHeader
          title="Getting Started with AgentLair"
          description="Set up your agent's email in under 2 minutes. Works from browser or terminal."
        />
      </Background>

      <section className="pb-28 lg:pb-32">
        <div className="container max-w-3xl space-y-6">
          {/* Step 1: Get an API key */}
          <StepCard number={1} title="Get an API key">
            <p>
              One call creates your account. No email, no credit card, no
              verification — instant access.
            </p>

            <BrowserTip>
              Go to the{" "}
              <a
                href="/#web-signup"
                className="text-primary underline underline-offset-4"
              >
                homepage signup
              </a>{" "}
              and click <strong className="text-foreground">"Create Free Account"</strong>.
              Your key appears immediately.
            </BrowserTip>

            <CodeBlock
              code={`curl -X POST https://agentlair.dev/v1/auth/keys
→ {
    "api_key": "al_live_k7x9m2p4...",
    "account_id": "acc_...",
    "tier": "free"
  }`}
              language="bash"
              title="Terminal"
            />

            <Tip>
              <strong className="text-foreground">Save your API key!</strong>{" "}
              It's shown only once. If you lose it, set a recovery email (step
              5) to regain access via the dashboard.
            </Tip>
          </StepCard>

          {/* Step 2: Claim an email address */}
          <StepCard number={2} title="Claim an email address">
            <p>
              Pick any available <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">@agentlair.dev</code> address for your agent.
            </p>

            <BrowserTip>
              The{" "}
              <a
                href="/dashboard"
                className="text-primary underline underline-offset-4"
              >
                dashboard
              </a>{" "}
              lets you claim and manage addresses under your account.
            </BrowserTip>

            <CodeBlock
              code={`curl -X POST https://agentlair.dev/v1/email/claim \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"address": "my-agent@agentlair.dev"}'
→ {
    "claimed": true,
    "address": "my-agent@agentlair.dev"
  }`}
              language="bash"
              title="Terminal"
            />

            <Tip>
              You can claim up to 10 addresses on the free tier. Use descriptive names like{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                research-agent@agentlair.dev
              </code>{" "}
              or{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                outreach-bot@agentlair.dev
              </code>
              .
            </Tip>
          </StepCard>

          {/* Step 3: Send your first email */}
          <StepCard number={3} title="Send your first email">
            <p>
              Send a test email to yourself to verify everything works.
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
  -d '{"from": "my-agent@agentlair.dev",
       "to": ["your-real-email@gmail.com"],
       "subject": "Hello from AgentLair!",
       "text": "This is my agent speaking."}'`}
              language="bash"
              title="Terminal"
            />

            <Tip>
              <strong className="text-foreground">Use an external address for testing.</strong>{" "}
              Sending from one <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">@agentlair.dev</code>{" "}
              address to another will not appear in the inbox — inbound routing rejects{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">@agentlair.dev</code> senders
              as a spoofing prevention measure. Use your Gmail, Outlook, or any
              external address to receive the test email, then reply to it.
            </Tip>
          </StepCard>

          {/* Step 4: Check your inbox */}
          <StepCard number={4} title="Check your inbox">
            <p>
              Reply to the email you just sent, then check your agent's inbox.
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

          {/* Step 5: Set a recovery email (optional) */}
          <StepCard number={5} title="Set a recovery email" optional>
            <p>
              Attach a personal email to your account. This enables magic-link
              dashboard login and key recovery.
            </p>

            <BrowserTip>
              On the{" "}
              <a
                href="/dashboard"
                className="text-primary underline underline-offset-4"
              >
                dashboard
              </a>
              , click{" "}
              <strong className="text-foreground">"Update recovery email"</strong>{" "}
              in the account card.
            </BrowserTip>

            <CodeBlock
              code={`curl -X POST https://agentlair.dev/v1/account/recovery-email \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "you@example.com"}'`}
              language="bash"
              title="Terminal"
            />
          </StepCard>

          {/* Step 6: Store secrets in Vault (optional) */}
          <StepCard number={6} title="Store secrets in Vault" optional>
            <p>
              Keep your agent's API keys and credentials safe across container
              restarts. Client-side encrypted &mdash; AgentLair never sees the
              plaintext.
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
    'Authorization': \`Bearer \${apiKey}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ ciphertext: ct }),
});

// Retrieve and decrypt
const res = await fetch('https://agentlair.dev/v1/vault/openai-key', {
  headers: { 'Authorization': \`Bearer \${apiKey}\` }
});
const plain = await vc.decrypt(
  (await res.json()).ciphertext,
  'openai-key'
);`}
              language="typescript"
              title="vault-crypto"
            />

            <Tip>
              <strong className="text-foreground">Tip:</strong> Save the hex
              seed (
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                vc.seedHex()
              </code>
              ) in an env var. Or use{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                encryptSeedBackup()
              </code>{" "}
              with a passphrase for recovery.{" "}
              <a
                href="/vault"
                className="text-primary underline underline-offset-4"
              >
                Learn more about Vault &rarr;
              </a>
            </Tip>
          </StepCard>

          {/* Step 7: Set up Agent Calendar (optional) */}
          <StepCard number={7} title="Set up your Agent Calendar" optional>
            <p>
              Every agent address has a built-in calendar. Create events via
              REST, then share a public iCal URL &mdash; humans subscribe in
              Google Calendar, Apple Calendar, or any calendar app. The agent
              owns the schedule; humans just follow it.
            </p>

            <CodeBlock
              code={`# Create an event
curl -X POST https://agentlair.dev/v1/calendar/events \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"address": "my-agent@agentlair.dev",
       "title": "Weekly sync",
       "start": "2026-04-01T10:00:00Z",
       "end": "2026-04-01T11:00:00Z"}'
→ { "event_id": "evt_abc123", "ical_url": "https://agentlair.dev/v1/calendar/my-agent@agentlair.dev/ical" }`}
              language="bash"
              title="Terminal"
            />

            <CodeBlock
              code={`# Get the iCal feed URL (subscribe in any calendar app)
curl https://agentlair.dev/v1/calendar/my-agent@agentlair.dev/ical
→ text/calendar — paste this URL into Google Calendar`}
              language="bash"
              title="Terminal"
            />

            <Tip>
              <strong className="text-foreground">
                Subscribe in Google Calendar:
              </strong>{" "}
              Open Google Calendar &rarr; click <strong className="text-foreground">+</strong>{" "}
              next to "Other calendars" &rarr; "From URL" &rarr; paste the iCal
              URL above. Your agent's schedule appears in real-time, updated
              automatically as the agent creates or modifies events.{" "}
              <a
                href="/calendar"
                className="text-primary underline underline-offset-4"
              >
                Learn more about Agent Calendar &rarr;
              </a>
            </Tip>
          </StepCard>

          {/* Step 8: Create a pod (optional) */}
          <StepCard number={8} title="Create an Agent Pod" optional>
            <p>
              Pods give each of your clients a fully isolated environment &mdash;
              their own API key, email address, vault, and calendar &mdash;
              all under your master account. Ideal for multi-tenant products.
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
              Each pod gets a generated API key you hand to your client.
            </BrowserTip>

            <CodeBlock
              code={`# Create a pod for a client
curl -X POST https://agentlair.dev/v1/pods \\
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

            <CodeBlock
              code={`# Use the pod's own API key for all its operations
curl -X POST https://agentlair.dev/v1/email/claim \\
  -H "Authorization: Bearer al_live_pod_..." \\
  -H "Content-Type: application/json" \\
  -d '{"address": "acme-agent@agentlair.dev"}'

# The pod's email, vault, and calendar are fully isolated —
# invisible to other pods and to your master account inbox.`}
              language="bash"
              title="Terminal"
            />

            <Tip>
              <strong className="text-foreground">One master key, many clients.</strong>{" "}
              Your master API key manages pod lifecycle (create, list, delete).
              Each pod's API key is scoped exclusively to that pod &mdash; hand
              it directly to your client or use it inside a sandboxed agent session.{" "}
              <a
                href="/pods"
                className="text-primary underline underline-offset-4"
              >
                Learn more about Agent Pods &rarr;
              </a>
            </Tip>
          </StepCard>

          {/* You're all set! */}
          <Card className="text-center">
            <CardContent className="space-y-6 px-6 py-8">
              <div className="space-y-2">
                <h2 className="text-foreground text-2xl font-bold tracking-tight">
                  You're all set!
                </h2>
                <p className="text-muted-foreground">
                  Your agent has email, encrypted secret storage, a calendar,
                  and multi-tenant pod isolation for serving multiple clients.
                  Here's what to explore next:
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

          {/* Help tip */}
          <div className="text-muted-foreground text-center text-sm">
            <strong className="text-foreground">Need help?</strong> Email{" "}
            <a
              href="mailto:hello@agentlair.dev"
              className="text-primary underline underline-offset-4"
            >
              hello@agentlair.dev
            </a>{" "}
            &mdash; we respond within 24 hours.
          </div>
        </div>
      </section>
    </>
  );
}
