import { ArrowRight, Box, Calendar, KeyRound, Mail, Shield, Vault } from "lucide-react";

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
// Code examples
// ---------------------------------------------------------------------------

const tsCode = `import fetch from 'node-fetch'; // or native fetch

const PARENT_API_KEY = 'al_live_...'; // your root account key

// 1. Create a pod (isolated namespace for one customer / agent)
const pod = await fetch('https://api.agentlair.dev/v1/pods', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${PARENT_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name: 'acme-corp' }),
}).then(r => r.json());
// { id: "pod_abc123", name: "acme-corp", status: "active" }

// 2. Create an API key scoped to that pod
const podKey = await fetch(\`https://api.agentlair.dev/v1/pods/\${pod.id}/keys\`, {
  method: 'POST',
  headers: { 'Authorization': \`Bearer \${PARENT_API_KEY}\` },
}).then(r => r.json());
// { api_key: "al_pod_xyz..." }

// 3. Use the pod key — fully isolated from all other pods
const email = await fetch('https://api.agentlair.dev/v1/emails', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${podKey.api_key}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ local_part: 'support' }),
}).then(r => r.json());
// { address: "support@acme-corp.agentlair.dev" }
// This email, vault, calendar — visible ONLY to this pod`;

const curlCode = `PARENT_KEY="al_live_..."

# 1. Create a pod
POD_ID=$(curl -s -X POST https://api.agentlair.dev/v1/pods \\
  -H "Authorization: Bearer $PARENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"acme-corp"}' | jq -r .id)

echo "Pod created: $POD_ID"

# 2. Create an API key for the pod
POD_KEY=$(curl -s -X POST https://api.agentlair.dev/v1/pods/$POD_ID/keys \\
  -H "Authorization: Bearer $PARENT_KEY" | jq -r .api_key)

echo "Pod key: $POD_KEY"

# 3. Use pod key — isolated namespace
curl -X POST https://api.agentlair.dev/v1/emails \\
  -H "Authorization: Bearer $POD_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"local_part":"support"}'
# -> { "address": "support@acme-corp.agentlair.dev" }

# List all your pods (from parent key)
curl https://api.agentlair.dev/v1/pods \\
  -H "Authorization: Bearer $PARENT_KEY"`;

const codeTabs = [
  {
    id: "ts",
    label: "TypeScript",
    code: tsCode,
    language: "typescript",
    title: "pods.ts",
    note: null,
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
    id: "caps",
    label: "Spending Caps",
    code: `const PARENT_API_KEY = 'al_live_...';
const POD_ID = 'pod_abc123';

// Set spending caps: values are atomic USDC (1 USDC = 1_000_000)
await fetch(\`https://api.agentlair.dev/v1/pods/\${POD_ID}\`, {
  method: 'PATCH',
  headers: {
    'Authorization': \`Bearer \${PARENT_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    spending_caps: {
      daily:   10_000_000,  //  10 USDC / day
      weekly:  50_000_000,  //  50 USDC / week
      monthly: 150_000_000, // 150 USDC / month
    },
  }),
}).then(r => r.json());
// { id: "pod_abc123", spending_caps: { daily: 10000000, weekly: 50000000, monthly: 150000000 } }

// When the cap is exceeded, API returns HTTP 402:
// { error: "Spending cap exceeded: daily limit of 10 USDC reached (current: 10.000001 USDC).",
//   code: "spending_cap_exceeded",
//   cap: { period: "daily", limit_usdc: "10", current_usdc: "10.000001" } }

// Remove all caps
await fetch(\`https://api.agentlair.dev/v1/pods/\${POD_ID}\`, {
  method: 'PATCH',
  headers: {
    'Authorization': \`Bearer \${PARENT_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ spending_caps: null }),
});`,
    language: "typescript",
    title: "spending-caps.ts",
    note: "Caps fail-open: if the cap check itself errors, the payment is not blocked. Caps are enforced at payment time (x402). The pod returns 402 spending_cap_exceeded when the limit is reached.",
  },
];

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const useCases = [
  {
    icon: "🏢",
    title: "SaaS platforms",
    description:
      "Deploy one agent per customer. Each customer's email addresses, vault secrets, and calendar entries stay in their own pod — completely sandboxed from every other customer.",
  },
  {
    icon: "🧪",
    title: "Dev / staging environments",
    description:
      "Create a pod for development, another for staging, another for production. Test against real infrastructure without any risk of cross-contamination.",
  },
  {
    icon: "👥",
    title: "Team separation",
    description:
      "Different pods for different teams or projects. Billing stays under one parent account. Access and data are fully separated per pod.",
  },
  {
    icon: "🏷️",
    title: "White-label deployments",
    description:
      "Deploy agents under client brands. Each client gets their own isolated namespace — their own email domain, secrets, observations. No data leakage between clients.",
  },
];

const isolationItems = [
  { label: "Email addresses", description: "Each pod claims its own email addresses — inboxes, sent items, and threads are pod-scoped." },
  { label: "Vault secrets", description: "Credentials stored under a pod key are visible only to that pod. The parent account cannot read pod vault entries." },
  { label: "Calendar", description: "Events, availability, and scheduling data are fully isolated per pod." },
  { label: "Observations", description: "Audit logs and behavioral traces are scoped to the pod that generated them." },
  { label: "API keys", description: "Pods can have multiple API keys. Rotate or revoke individual keys without affecting other pods." },
  { label: "Spending caps", description: "Set daily, weekly, or monthly USDC limits per pod. When a cap is reached the pod returns 402 spending_cap_exceeded — payments are blocked at the pod level, not the account level." },
];

const apiEndpoints = [
  {
    method: "POST",
    endpoint: "/v1/pods",
    description: 'Create a pod (body: {"name": "..."})',
  },
  {
    method: "GET",
    endpoint: "/v1/pods",
    description: "List all pods under the parent account",
  },
  {
    method: "GET",
    endpoint: "/v1/pods/{id}",
    description: "Get pod details and status",
  },
  {
    method: "POST",
    endpoint: "/v1/pods/{id}/keys",
    description: "Create a new API key scoped to this pod",
  },
  {
    method: "GET",
    endpoint: "/v1/pods/{id}/keys",
    description: "List all API keys for a pod",
  },
  {
    method: "PATCH",
    endpoint: "/v1/pods/{id}",
    description: "Update pod name or spending caps (daily/weekly/monthly USDC)",
  },
  {
    method: "DELETE",
    endpoint: "/v1/pods/{id}",
    description: "Suspend pod (all pod keys are immediately invalidated)",
  },
];

const nextSteps = [
  {
    href: "/getting-started",
    icon: ArrowRight,
    title: "Get API Key — Free",
    description: "Create a parent account in 30 seconds. No credit card, no IAM, no human setup.",
  },
  {
    href: "/vault",
    icon: KeyRound,
    title: "Vault",
    description: "Zero-knowledge encrypted credential storage. Each pod gets its own isolated vault namespace.",
  },
  {
    href: "/",
    icon: Mail,
    title: "Agent Email",
    description: "Give each pod its own email address. Isolated inboxes per pod, out of the box.",
  },
  {
    href: "/calendar",
    icon: Calendar,
    title: "Calendar",
    description: "Per-pod scheduling and availability. Agents manage time without cross-pod visibility.",
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PodsHero() {
  return (
    <Background>
      <PageHeader
        title="One account. Infinite agents. Total isolation."
        description="Pods are isolated virtual accounts inside your parent account. Each pod gets its own API keys, email addresses, vault, and calendar. Multi-tenancy for AI agents — without managing separate accounts."
        badges={["Live", "Multi-tenancy"]}
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
            See how it works
          </a>
        </div>
      </div>
    </Background>
  );
}

function PodsConcept() {
  return (
    <div id="how-it-works" className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">What is a Pod?</h2>
      <p className="text-muted-foreground text-sm">
        A Pod is a complete, isolated namespace living inside your AgentLair account.
        Think of it as a sub-account: it has its own API keys, its own email addresses,
        its own vault, its own calendar — but it bills and is managed through a single parent account.
      </p>
      <Card>
        <CardContent className="divide-y p-0">
          <div className="flex items-start gap-4 px-6 py-4">
            <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              1
            </div>
            <div className="space-y-1">
              <h3 className="text-foreground text-sm font-semibold">Create a pod with your parent key</h3>
              <p className="text-muted-foreground text-sm">
                One{" "}
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">POST /v1/pods</code>{" "}
                call creates a fully isolated namespace. Name it after your customer, project, or environment.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 px-6 py-4">
            <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              2
            </div>
            <div className="space-y-1">
              <h3 className="text-foreground text-sm font-semibold">Issue a pod-scoped API key</h3>
              <p className="text-muted-foreground text-sm">
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">POST /v1/pods/{"{id}"}/keys</code>{" "}
                returns a key that only sees that pod&apos;s resources. Hand it to the agent or store it in your SaaS platform.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 px-6 py-4">
            <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              3
            </div>
            <div className="space-y-1">
              <h3 className="text-foreground text-sm font-semibold">Agent operates in a complete, isolated namespace</h3>
              <p className="text-muted-foreground text-sm">
                Every API call made with the pod key — email, vault, calendar — is scoped to that pod.
                Cross-pod data access is architecturally impossible, not just policy-enforced.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 px-6 py-4">
            <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              4
            </div>
            <div className="space-y-1">
              <h3 className="text-foreground text-sm font-semibold">Suspend or delete when done</h3>
              <p className="text-muted-foreground text-sm">
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">DELETE /v1/pods/{"{id}"}</code>{" "}
                instantly invalidates all pod API keys. Offboard a customer in a single API call.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PodsCodeExamples() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Get started in 3 API calls</h2>
      <p className="text-muted-foreground text-sm">
        Create a pod, issue a key, start operating — isolated from everything else.
      </p>
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

function PodsUseCases() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Use cases</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {useCases.map((uc) => (
          <Card key={uc.title}>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xl leading-none">{uc.icon}</span>
                <h3 className="text-foreground text-sm font-semibold">{uc.title}</h3>
              </div>
              <p className="text-muted-foreground text-sm">{uc.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PodsIsolation() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">What&apos;s isolated per pod</h2>
      <p className="text-muted-foreground text-sm">
        Each pod is a complete namespace. Everything your agent touches is scoped to the pod that owns it.
      </p>
      <Card>
        <CardContent className="divide-y p-0">
          {isolationItems.map((item) => (
            <div key={item.label} className="flex items-start gap-4 px-6 py-4">
              <span className="mt-0.5 font-bold text-green-500">✓</span>
              <div className="space-y-0.5">
                <h3 className="text-foreground text-sm font-semibold">{item.label}</h3>
                <p className="text-muted-foreground text-sm">{item.description}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="space-y-2 py-4">
          <h3 className="text-foreground text-sm font-semibold">
            Multiple API keys per pod
          </h3>
          <p className="text-muted-foreground text-sm">
            Issue separate keys for read vs. write operations, or for different agent roles
            within the same pod. Rotate or revoke individual keys without disrupting the pod.
            The parent account key can manage all pods but cannot read pod-scoped secrets.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PodsApiRef() {
  return (
    <div className="space-y-4">
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
      <p className="text-muted-foreground text-sm">
        All pod management endpoints require the{" "}
        <strong className="text-foreground">parent account API key</strong>. Pod-scoped keys
        only work within their own namespace and cannot create or modify pods.
      </p>
    </div>
  );
}

function PodsCta() {
  return (
    <>
      <div className="space-y-6 text-center">
        <div>
          <h2 className="text-foreground text-xl font-bold">
            Multi-tenancy without the overhead.
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            One parent account. Infinite isolated pods. Free to start.
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
            href="/dashboard"
            className="border-border text-foreground hover:border-primary/50 hover:text-primary rounded-lg border px-6 py-3 text-sm font-semibold transition-colors"
          >
            Dashboard
          </a>
        </div>
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
// Main component
// ---------------------------------------------------------------------------

export function Pods() {
  return (
    <>
      <PodsHero />

      <section className="pb-28 lg:pb-32">
        <div className="container max-w-3xl space-y-16">
          <PodsConcept />
          <PodsCodeExamples />
          <PodsUseCases />
          <PodsIsolation />
          <PodsApiRef />
          <PodsCta />
        </div>
      </section>
    </>
  );
}
