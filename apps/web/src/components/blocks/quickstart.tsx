import { useState } from "react";
import { Check, Copy, ArrowRight, BookOpen, Code2, FileText, Github, LayoutDashboard, ShieldCheck, Zap, Terminal } from "lucide-react";

import { Background } from "@/components/background";
import { PageHeader } from "@/components/shared/page-header";
import { StepCard } from "@/components/shared/step-card";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Copy-enabled code block ─────────────────────────────────────────────────

function CopyCodeBlock({
  code,
  language,
  title,
  className,
}: {
  code: string;
  language?: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: silently fail
    }
  };

  return (
    <div
      className={cn(
        "bg-card group relative overflow-hidden rounded-2xl border shadow-lg",
        className
      )}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="size-3 rounded-full bg-red-400/60" />
        <div className="size-3 rounded-full bg-yellow-400/60" />
        <div className="size-3 rounded-full bg-green-400/60" />
        {title && (
          <span className="text-muted-foreground ml-2 font-mono text-xs">
            {title}
          </span>
        )}
        {/* Copy button */}
        <button
          onClick={handleCopy}
          aria-label="Copy to clipboard"
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs transition-all",
            "text-muted-foreground hover:text-foreground hover:bg-primary/10",
            copied && "text-green-600 dark:text-green-400"
          )}
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto p-6 font-mono text-sm leading-relaxed">
        <code className={language ? `language-${language}` : undefined}>
          {code}
        </code>
      </pre>
    </div>
  );
}

// ─── Tab switcher ─────────────────────────────────────────────────────────────

function TabSwitcher({
  tabs,
  children,
}: {
  tabs: string[];
  children: (activeTab: string) => React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState(tabs[0]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              activeTab === tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      {children(activeTab)}
    </div>
  );
}

// ─── Output block ─────────────────────────────────────────────────────────────

function OutputBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
      <div className="mb-2 font-mono text-xs text-muted-foreground">
        → Response
      </div>
      <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
        {children}
      </pre>
    </div>
  );
}

// ─── Info tip ─────────────────────────────────────────────────────────────────

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
      {children}
    </div>
  );
}

// ─── Connector between steps ──────────────────────────────────────────────────

function StepConnector({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-2 py-1">
      <div className="h-px flex-1 border-t border-dashed border-primary/30" />
      <span className="font-mono text-xs text-primary/60">{label}</span>
      <div className="h-px flex-1 border-t border-dashed border-primary/30" />
    </div>
  );
}

// ─── Next-step links ──────────────────────────────────────────────────────────

const nextSteps = [
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    description:
      "View your account, inbox, sent messages, and agent activity. Sign in with your API key.",
  },
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
      "All endpoints: registration, token issuance, introspection, trust scoring.",
  },
  {
    href: "/docs/audit-logger",
    icon: Zap,
    title: "Audit Logger",
    description:
      "Log agent actions to build behavioral history and improve your trust score.",
  },
  {
    href: "https://github.com/piiiico/agentlair",
    icon: Github,
    title: "GitHub",
    description:
      "SDKs, examples, and open-source tooling for integrating with AgentLair.",
  },
];

// ─── Main component ───────────────────────────────────────────────────────────

export function Quickstart() {
  return (
    <>
      <Background>
        <PageHeader
          title="Zero to Trust Score in 3 Minutes"
          description="Install the SDK, create an account, emit a behavioral event, and see your live trust score."
          badges={["SDK", "TypeScript", "Live API"]}
        />
      </Background>

      <section className="pb-28 lg:pb-32">
        <div className="container max-w-3xl space-y-4">

          {/* Step 0: Install */}
          <StepCard number={1} title="Install the SDK">
            <p>
              The official SDK works in Node ≥ 18, Bun, Deno, and browsers.
              Zero dependencies.
            </p>

            <TabSwitcher tabs={["npm", "bun", "pnpm", "yarn"]}>
              {(tab) => (
                <CopyCodeBlock
                  code={
                    tab === "npm" ? "npm install @agentlair/sdk" :
                    tab === "bun" ? "bun add @agentlair/sdk" :
                    tab === "pnpm" ? "pnpm add @agentlair/sdk" :
                    "yarn add @agentlair/sdk"
                  }
                  language="bash"
                  title="Terminal"
                />
              )}
            </TabSwitcher>
          </StepCard>

          <StepConnector label="then →" />

          {/* Step 2: Create account */}
          <StepCard number={2} title="Create your agent account">
            <p>
              One call — no email, no credit card. You get an API key and a
              persistent agent identity.
            </p>

            <TabSwitcher tabs={["TypeScript", "curl"]}>
              {(tab) => tab === "TypeScript" ? (
                <>
                  <CopyCodeBlock
                    code={`import { AgentLair } from '@agentlair/sdk';

// Creates account instantly — no signup form
const { api_key, account_id } = await AgentLair.createAccount({
  name: 'my-agent',
});

console.log('API key:', api_key);     // al_live_...
console.log('Agent ID:', account_id); // acc_...`}
                    language="typescript"
                    title="quickstart.ts"
                  />

                  <Tip>
                    <strong className="text-foreground">Save your API key.</strong>{" "}
                    It's shown once — store it in{" "}
                    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                      AGENTLAIR_API_KEY
                    </code>{" "}
                    in your environment.
                  </Tip>
                </>
              ) : (
                <>
                  <CopyCodeBlock
                    code={`curl -X POST https://agentlair.dev/v1/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-agent"}'`}
                    language="bash"
                    title="Terminal"
                  />

                  <OutputBlock>{`{
  "api_key": "al_live_k7x9m2p4...",
  "account_id": "acc_7kX9mP2qR4wL",
  "email_address": "my-agent@agentlair.dev",
  "tier": "free"
}`}</OutputBlock>
                </>
              )}
            </TabSwitcher>
          </StepCard>

          <StepConnector label="use api_key →" />

          {/* Step 3: Emit first event */}
          <StepCard number={3} title="Emit your first behavioral event">
            <p>
              Trust scores are built from behavioral events — what your agent
              does, how consistently, and with what transparency.
              Send your first event now.
            </p>

            <TabSwitcher tabs={["TypeScript", "curl"]}>
              {(tab) => tab === "TypeScript" ? (
                <>
                  <CopyCodeBlock
                    code={`const lair = new AgentLair(process.env.AGENTLAIR_API_KEY!);

// Emit a behavioral event — tool use, session start, etc.
await lair.events.emit({
  category: 'tool',       // 'tool' | 'session' | 'resource' | 'error'
  action: 'web_search',
  result: 'success',
});

console.log('Event accepted!');`}
                    language="typescript"
                    title="quickstart.ts"
                  />

                  <OutputBlock>{`{ "accepted": 1, "rejected": 0 }`}</OutputBlock>
                </>
              ) : (
                <>
                  <CopyCodeBlock
                    code={`curl -X POST https://agentlair.dev/v1/events \\
  -H "Authorization: Bearer al_live_k7x9m2p4..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "events": [{
      "category": "tool",
      "action": "web_search",
      "result": "success"
    }]
  }'`}
                    language="bash"
                    title="Terminal"
                  />

                  <OutputBlock>{`{ "accepted": 1, "rejected": 0 }`}</OutputBlock>
                </>
              )}
            </TabSwitcher>

            <Tip>
              Events feed the trust algorithm. The more consistently your agent
              behaves — and the more services observe it — the higher its score
              climbs.
            </Tip>
          </StepCard>

          <StepConnector label="then check →" />

          {/* Step 4: Check trust score */}
          <StepCard number={4} title="Check your trust score">
            <p>
              Every agent starts with a cold-start prior of{" "}
              <strong className="text-foreground">score 30</strong>. Trust builds
              through consistent, transparent behavior over time — across all
              services that use AgentLair for verification.
            </p>

            <TabSwitcher tabs={["TypeScript", "curl"]}>
              {(tab) => tab === "TypeScript" ? (
                <>
                  <CopyCodeBlock
                    code={`// No need to pass an ID — SDK fetches your own score
const { score, atfLevel, trend } = await lair.trust.score();

console.log(\`Trust score: \${score} (\${atfLevel})\`);
// → Trust score: 30 (intern)`}
                    language="typescript"
                    title="quickstart.ts"
                  />
                </>
              ) : (
                <>
                  <CopyCodeBlock
                    code={`# Replace acc_7kX9mP2qR4wL with your account_id from Step 2
curl https://agentlair.dev/v1/trust/acc_7kX9mP2qR4wL \\
  -H "Authorization: Bearer al_live_k7x9m2p4..."`}
                    language="bash"
                    title="Terminal"
                  />
                </>
              )}
            </TabSwitcher>

            <OutputBlock>{`{
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
}`}</OutputBlock>

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
              Score builds through consistent behavior, transparent audit
              trails, and cross-organizational verification. Use the{" "}
              <a href="/docs/audit-logger" className="text-primary underline underline-offset-4">
                Audit Logger
              </a>{" "}
              to log agent actions and accelerate trust accumulation.
            </Tip>
          </StepCard>

          {/* Full script: copy-paste the whole thing */}
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Complete script — copy and run</span>
            </div>
            <CopyCodeBlock
              code={`import { AgentLair } from '@agentlair/sdk';

// Step 1: Create account
const { api_key, account_id } = await AgentLair.createAccount({ name: 'my-agent' });
console.log('API key (save this):', api_key);

const lair = new AgentLair(api_key);

// Step 2: Emit a behavioral event
await lair.events.emit({ category: 'tool', action: 'web_search', result: 'success' });

// Step 3: Check trust score
const { score, atfLevel } = await lair.trust.score();
console.log(\`Trust score: \${score} (\${atfLevel})\`);
// → Trust score: 30 (intern)`}
              language="typescript"
              title="quickstart.ts"
            />
            <p className="text-xs text-muted-foreground">
              Run with{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono">npx tsx quickstart.ts</code>
              {" "}or{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono">bun quickstart.ts</code>
            </p>
          </div>

          {/* Completion card */}
          <Card className="text-center">
            <CardContent className="space-y-6 px-6 py-8">
              <div className="space-y-2">
                <div className="text-3xl">✓</div>
                <h2 className="text-foreground text-2xl font-bold tracking-tight">
                  Your agent has a live trust score
                </h2>
                <p className="text-muted-foreground mx-auto max-w-md">
                  You installed the SDK, created an agent identity, emitted a
                  behavioral event, and checked your trust score. Here's what to
                  explore next:
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

              <div className="text-muted-foreground text-sm">
                <strong className="text-foreground">Questions?</strong>{" "}
                Email{" "}
                <a
                  href="mailto:hello@agentlair.dev"
                  className="text-primary underline underline-offset-4"
                >
                  hello@agentlair.dev
                </a>{" "}
                — we respond within 24 hours.
              </div>
            </CardContent>
          </Card>

        </div>
      </section>
    </>
  );
}
