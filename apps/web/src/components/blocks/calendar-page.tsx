import { ArrowRight, Calendar, Key, Mail, Shield } from "lucide-react";

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

const curlCode = `# 1. Get an API key (30 seconds)
API_KEY=$(curl -s -X POST https://api.agentlair.dev/v1/auth/keys | jq -r .api_key)

# 2. Create an event
curl -s -X POST https://api.agentlair.dev/v1/calendar/events \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "summary": "Product demo — Acme Corp",
    "start": "2026-04-01T14:00:00Z",
    "end": "2026-04-01T15:00:00Z",
    "description": "Quarterly review call",
    "location": "https://meet.example.com/demo"
  }'
# -> { "id": "evt_01JNXK...", "summary": "Product demo — Acme Corp", ... }

# 3. Get the public iCal subscription URL
curl -s https://api.agentlair.dev/v1/calendar/feed \\
  -H "Authorization: Bearer $API_KEY"
# -> { "feed_url": "https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=..." }

# 4. Share feed_url with anyone — they add it to their calendar app, done`;

const tsCode = `// Create an event — works from any agent, LLM runner, or Cloudflare Worker
const event = await fetch('https://api.agentlair.dev/v1/calendar/events', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${apiKey}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    summary: 'Product demo — Acme Corp',
    start: '2026-04-01T14:00:00Z',
    end: '2026-04-01T15:00:00Z',
    description: 'Quarterly review call',
    location: 'https://meet.example.com/demo',
    attendees: ['ceo@acme.com'],
  }),
}).then(r => r.json());
// event.id -> "evt_01JNXK..."

// Fetch the subscription URL once, share it in your onboarding flow
const { feed_url } = await fetch(
  'https://api.agentlair.dev/v1/calendar/feed',
  { headers: { 'Authorization': \`Bearer \${apiKey}\` } },
).then(r => r.json());
// feed_url -> "https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=..."

// List upcoming events
const { events } = await fetch(
  \`https://api.agentlair.dev/v1/calendar/events?from=\${new Date().toISOString()}\`,
  { headers: { 'Authorization': \`Bearer \${apiKey}\` } },
).then(r => r.json());`;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const problemStats = [
  {
    number: "OAuth",
    text: "Google Calendar API requires a human user to authorize access — there is no service account path for consumer accounts",
  },
  {
    number: "~0",
    text: "AI agent frameworks include a calendar primitive — scheduling is left as an exercise for the developer",
  },
  {
    number: "1 hr+",
    text: "typical setup time for a calendar integration — OAuth app registration, consent screen, token refresh logic, all before the first event is created",
  },
];

const howItWorksSteps = [
  {
    num: 1,
    title: "Agent creates events via JSON API",
    body: (
      <>
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          POST /v1/calendar/events
        </code>{" "}
        with{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          summary
        </code>
        ,{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          start
        </code>
        ,{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          end
        </code>
        . Optional:{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          description
        </code>
        ,{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          location
        </code>
        ,{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          attendees
        </code>
        . Returns the event ID immediately.
      </>
    ),
  },
  {
    num: 2,
    title: "Public iCal feed URL generated automatically",
    body: (
      <>
        Every account gets a permanent{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=...
        </code>{" "}
        URL. No configuration needed — it exists from the moment you create your
        account.
      </>
    ),
  },
  {
    num: 3,
    title: "Users subscribe from their existing calendar app",
    body: (
      <>
        Paste the iCal URL into Google Calendar &rarr; &ldquo;Other calendars
        &rsaquo; From URL&rdquo;. Events appear within minutes. No app install.
        No account creation. Works on every device.
      </>
    ),
  },
];

const codeTabs = [
  {
    id: "curl",
    label: "curl",
    code: curlCode,
    language: "bash",
    title: "terminal",
  },
  {
    id: "ts",
    label: "TypeScript",
    code: tsCode,
    language: "typescript",
    title: "agent.ts",
  },
];

const subscribeSteps = [
  {
    icon: "🗓",
    name: "Google Calendar",
    instructions: "Other calendars \u2192 From URL \u2192 paste link \u2192 Add calendar",
  },
  {
    icon: "🍎",
    name: "Apple Calendar",
    instructions: "File \u2192 New Calendar Subscription \u2192 paste link \u2192 OK",
  },
  {
    icon: "📧",
    name: "Outlook",
    instructions: "Add calendar \u2192 Subscribe from web \u2192 paste link \u2192 Import",
  },
  {
    icon: "⚡",
    name: "Any iCal-compatible app",
    instructions:
      "The feed URL is a standard .ics file. If it speaks iCal (RFC 5545), it works.",
  },
];

const calendarClients = [
  "Google Calendar",
  "Apple Calendar",
  "Outlook",
  "Thunderbird",
  "Fantastical",
  "Notion Calendar",
  "Cron",
  "Any .ics client",
];

const keyFeatures = [
  {
    title: "Agent-owned identity",
    description:
      "No Google account. No user OAuth. Your agent is the calendar owner — events appear under its name, not yours.",
  },
  {
    title: "Email invite notifications",
    description:
      "Add attendees to any event. Invite emails sent automatically via AgentLair Email — no SMTP setup required.",
  },
  {
    title: "iCal standard (RFC 5545)",
    description:
      "Events rendered as valid VEVENT blocks. All-day events, date-time events, UTC and floating times all supported.",
  },
  {
    title: "Vault integration",
    description:
      "Store Google/Outlook OAuth tokens in Vault, use them to write to a user\u2019s calendar — without touching your own infra.",
  },
];

const pricingFree = [
  "100 events",
  "Public iCal feed URL",
  "Email invites (via AgentLair Email)",
  "All calendar clients",
  "No credit card required",
];

const pricingPro = [
  "10,000 events",
  "Multiple calendars per account",
  "Event filtering by date range",
  "x402 autonomous payments",
  "Priority support",
];

const includedItems = [
  "iCalendar (RFC 5545) compliant feed",
  "Permanent, stable subscription URL",
  "All-day and date-time events",
  "UTC and floating time support",
  "Attendee fields (email invites)",
  "Location and description fields",
  "Edge-deployed on Cloudflare (200+ PoPs)",
  "Works with existing AgentLair API key",
];

const comparisons = [
  {
    title: "vs Google Calendar API",
    description:
      "Requires a human OAuth consent flow. No service account path for consumer accounts. Domain-wide delegation needs Google Workspace ($6+/user/mo).",
  },
  {
    title: "vs Cronofy / Nylas",
    description:
      "Connect to existing human calendars — they don\u2019t provision new ones. Enterprise pricing. We give your agent its own calendar with one API call.",
  },
  {
    title: "vs Cal.com",
    description:
      "Scheduling platform for humans, not agents. Requires a UI and a human on the other side. We\u2019re infrastructure — your agent is in control.",
  },
  {
    title: "vs self-hosted CalDAV",
    description:
      "Radicale/Baikal require persistent storage, ops, and deployment. We handle the infra — your agent gets a calendar endpoint, not a server to manage.",
  },
];

const apiEndpoints = [
  {
    method: "POST",
    endpoint: "/v1/calendar/events",
    description:
      "Create an event (body: summary, start, end, description?, location?, attendees?)",
  },
  {
    method: "GET",
    endpoint: "/v1/calendar/events",
    description: "List events (?from=ISO&to=ISO optional date range filter)",
  },
  {
    method: "DELETE",
    endpoint: "/v1/calendar/events/{id}",
    description: "Delete a single event by ID",
  },
  {
    method: "GET",
    endpoint: "/v1/calendar/feed",
    description: "Get (or create) public iCal subscription URL",
  },
  {
    method: "GET",
    endpoint: "/v1/calendar/feed.ics",
    description: "Public iCal feed (?cal_token=, no auth required)",
  },
];

const nextSteps = [
  {
    href: "/getting-started",
    icon: Key,
    title: "Get API Key \u2014 Free",
    description:
      "Create an account in 30 seconds. No credit card, no OAuth, no human setup.",
  },
  {
    href: "/vault",
    icon: Shield,
    title: "Store OAuth Tokens in Vault",
    description:
      "Securely store Google/Outlook tokens for writing to user calendars.",
  },
  {
    href: "/integrations",
    icon: Calendar,
    title: "Framework Integrations",
    description:
      "LangChain, CrewAI, Vercel AI SDK, Claude MCP \u2014 works with everything.",
  },
  {
    href: "/",
    icon: Mail,
    title: "Agent Email",
    description:
      "Give your agents a real email address. Claim @agentlair.dev in 30 seconds.",
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CalendarHero() {
  return (
    <Background>
      <PageHeader
        title="Your agent's own calendar."
        description="No Google account. No OAuth dance. No human in the loop. Agents create events via API. A public iCal feed URL is generated instantly."
        badges={["Live", "iCal standard"]}
      />
      <div className="container pb-12">
        <div className="flex flex-wrap gap-3">
          <a
            href="/getting-started"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
          >
            Get API Key &mdash; Free &rarr;
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

function CalendarProblem() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">
        Calendar apps are built for humans
      </h2>
      <p className="text-muted-foreground text-sm">
        Every major calendar API assumes the entity scheduling the meeting is a
        human with a Google account. That assumption breaks the moment an AI
        agent needs to manage time.
      </p>
      <Card>
        <CardContent className="divide-y p-0">
          {problemStats.map((stat) => (
            <div
              key={stat.number}
              className="flex items-baseline gap-4 px-6 py-4"
            >
              <span className="text-destructive min-w-12 text-2xl font-extrabold">
                {stat.number}
              </span>
              <span className="text-muted-foreground text-sm">{stat.text}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-sm">
        Your agent needs to schedule. It should take one API call.
      </p>
    </div>
  );
}

function CalendarHowItWorks() {
  return (
    <div id="how-it-works" className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">How it works</h2>
      <p className="text-muted-foreground text-sm">
        Three steps. Your agent handles all three.
      </p>
      <Card>
        <CardContent className="divide-y p-0">
          {howItWorksSteps.map((step) => (
            <div
              key={step.num}
              className="flex items-start gap-4 px-6 py-4"
            >
              <div className="bg-primary text-primary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {step.num}
              </div>
              <div className="space-y-1">
                <h3 className="text-foreground text-sm font-semibold">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-sm">{step.body}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CalendarCodeExamples() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">
        Get started in 60 seconds
      </h2>
      <p className="text-muted-foreground text-sm">Pick your tool:</p>
      <Tabs defaultValue="curl">
        <TabsList className="flex-wrap">
          {codeTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="subscribe">Subscribe URL</TabsTrigger>
        </TabsList>
        {codeTabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            <Card>
              <CardContent>
                <CodeBlock
                  code={tab.code}
                  language={tab.language}
                  title={tab.title}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
        <TabsContent value="subscribe">
          <Card>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                After creating your first event, get your subscription URL:
              </p>
              <div className="bg-muted rounded-lg border border-primary/30 p-4 font-mono text-sm text-green-500 break-all">
                https://api.agentlair.dev/v1/calendar/feed.ics?cal_token=
                <span className="text-primary">your_token</span>
              </div>
              <p className="text-muted-foreground text-sm">
                Share this URL anywhere. Here&rsquo;s how users subscribe:
              </p>
              <div className="divide-y">
                {subscribeSteps.map((step) => (
                  <div
                    key={step.name}
                    className="flex items-center gap-3 py-3 text-sm"
                  >
                    <div className="bg-card border-border flex size-8 shrink-0 items-center justify-center rounded-md border text-base">
                      {step.icon}
                    </div>
                    <div className="text-muted-foreground">
                      <strong className="text-foreground">{step.name}</strong>{" "}
                      &mdash; {step.instructions}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                The token is in the URL. No authentication required for
                subscribers &mdash; paste and go.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CalendarCompatible() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">
        Compatible with everything
      </h2>
      <p className="text-muted-foreground text-sm">
        The feed is a standard iCalendar file (RFC 5545). If it speaks iCal, it
        subscribes.
      </p>
      <div className="flex flex-wrap gap-2">
        {calendarClients.map((client) => (
          <span
            key={client}
            className="bg-card border-border rounded-md border px-3 py-1.5 text-sm"
          >
            {client}
          </span>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        Building a calendar integration?{" "}
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

function CalendarFeatures() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Key features</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {keyFeatures.map((feat) => (
          <Card key={feat.title}>
            <CardContent className="space-y-2">
              <h3 className="text-foreground text-sm font-semibold">
                {feat.title}
              </h3>
              <p className="text-muted-foreground text-sm">
                {feat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CalendarPricing() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">Pricing</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Free */}
        <Card>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-foreground font-semibold">Free</h3>
              <div className="text-foreground text-3xl font-extrabold">$0</div>
            </div>
            <ul className="space-y-1.5">
              {pricingFree.map((item) => (
                <li
                  key={item}
                  className="text-muted-foreground flex items-center gap-2 text-sm"
                >
                  <span className="font-bold text-green-500">&check;</span>
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
                <h3 className="text-foreground font-semibold">Starter</h3>
                <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  Popular
                </span>
              </div>
              <div className="text-foreground text-3xl font-extrabold">
                $29{" "}
                <span className="text-muted-foreground text-sm font-normal">
                  /month
                </span>
              </div>
            </div>
            <ul className="space-y-1.5">
              {pricingPro.map((item) => (
                <li
                  key={item}
                  className="text-muted-foreground flex items-center gap-2 text-sm"
                >
                  <span className="font-bold text-green-500">&check;</span>
                  {item}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <p className="text-muted-foreground text-center text-sm">
        Free tier is permanent &mdash; no expiry, no bait-and-switch.
        <br />
        Autonomous agents:{" "}
        <strong className="text-foreground">x402 payments</strong> available
        &mdash; agents pay per-call at $0.001/request when limits are hit.
      </p>
    </div>
  );
}

function CalendarIncluded() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">
        What&rsquo;s included
      </h2>
      <p className="text-muted-foreground text-sm">
        Built on open standards. No vendor lock-in, no proprietary format.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {includedItems.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 font-bold text-green-500">&check;</span>
            <span className="text-muted-foreground">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarComparisons() {
  return (
    <div className="space-y-4">
      <h2 className="text-foreground text-xl font-bold">
        Why not just use&hellip;?
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {comparisons.map((comp) => (
          <Card key={comp.title}>
            <CardContent className="space-y-2">
              <h3 className="text-foreground text-sm font-semibold">
                {comp.title}
              </h3>
              <p className="text-muted-foreground text-sm">
                {comp.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CalendarApiRef() {
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
                    <td className="text-muted-foreground px-6 py-3">
                      {ep.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CalendarCta() {
  return (
    <>
      <div className="space-y-6 text-center">
        <div>
          <h2 className="text-foreground text-xl font-bold">
            Your agent&rsquo;s own calendar.
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Free tier. No Google account. No OAuth. No human setup.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="/getting-started"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
          >
            Get API Key &mdash; Free &rarr;
          </a>
          <a
            href="/vault"
            className="border-border text-foreground hover:border-primary/50 hover:text-primary rounded-lg border px-6 py-3 text-sm font-semibold transition-colors"
          >
            Store OAuth tokens in Vault
          </a>
        </div>
        <p className="text-muted-foreground text-xs">
          <a
            href="/v1/calendar/events"
            className="text-primary underline underline-offset-4"
          >
            API reference
          </a>{" "}
          &middot;{" "}
          <a
            href="/dashboard"
            className="text-primary underline underline-offset-4"
          >
            Dashboard
          </a>{" "}
          &middot;{" "}
          <a href="/" className="text-primary underline underline-offset-4">
            Email
          </a>{" "}
          &middot;{" "}
          <a
            href="/vault"
            className="text-primary underline underline-offset-4"
          >
            Vault
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
                className="hover:border-primary/50 hover:bg-primary/5 group block rounded-xl border p-5 transition-colors"
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
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component — composes all sub-sections
// ---------------------------------------------------------------------------

export function CalendarPage() {
  return (
    <>
      <CalendarHero />

      <section className="pb-28 lg:pb-32">
        <div className="container max-w-3xl space-y-16">
          <CalendarProblem />
          <CalendarHowItWorks />
          <CalendarCodeExamples />
          <CalendarCompatible />
          <CalendarFeatures />
          <CalendarPricing />
          <CalendarIncluded />
          <CalendarComparisons />
          <CalendarApiRef />
          <CalendarCta />
        </div>
      </section>
    </>
  );
}
