import {
  ArrowRight,
  BookOpen,
  Calendar,
  Lock,
  Rocket,
} from "lucide-react";

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

const langchainCode = `import { tool } from "@langchain/core/tools";
import { z } from "zod";

// 1. Register your agent (one-time, no human required)
const reg = await fetch(\`https://agentlair.dev/v1/auth/agent-register\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "my-langchain-agent" }),
}).then(r => r.json());
// => { api_key: "al_live_...", email_address: "my-langchain-agent@agentlair.dev" }

// 2. Define email tools
const sendEmail = tool(
  async ({ to, subject, body }) => {
    const res = await fetch(\`https://agentlair.dev/v1/email/send\`, {
      method: "POST",
      headers: {
        "Authorization": \`Bearer \${reg.api_key}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: reg.email_address,
        to: [to], subject, text: body,
      }),
    });
    return \`Sent! ID: \${(await res.json()).id}\`;
  },
  {
    name: "send_email",
    description: "Send email from the agent's inbox",
    schema: z.object({
      to: z.string(), subject: z.string(), body: z.string(),
    }),
  }
);`;

const crewaiCode = `import requests
from crewai import Agent, Task, Crew
from crewai.tools import tool

BASE = "https://agentlair.dev"

# 1. Register your agent (one-time, no human required)
reg = requests.post(f"{BASE}/v1/auth/agent-register",
    json={"name": "my-crewai-agent"}).json()
# => {"api_key": "al_live_...", "email_address": "my-crewai-agent@agentlair.dev"}

HEADERS = {"Authorization": f"Bearer {reg['api_key']}",
           "Content-Type": "application/json"}

# 2. Define email tools
@tool("send_email")
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email from the agent's inbox."""
    resp = requests.post(f"{BASE}/v1/email/send", headers=HEADERS,
        json={"from": reg["email_address"], "to": [to],
              "subject": subject, "text": body})
    return f"Sent! ID: {resp.json()['id']}"

@tool("check_inbox")
def check_inbox() -> str:
    """Check the agent's inbox for new messages."""
    resp = requests.get(f"{BASE}/v1/email/inbox",
        headers=HEADERS,
        params={"address": reg["email_address"]})
    msgs = resp.json().get("messages", [])
    return "\\n".join(f"From: {m['from']} | {m['subject']}" for m in msgs)

# 3. Create agent with email tools
agent = Agent(
    role="Email Agent",
    goal="Monitor inbox and send responses",
    tools=[send_email, check_inbox],
)`;

const vercelCode = `import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const BASE = "https://agentlair.dev";

// 1. Register your agent
const reg = await fetch(\`\${BASE}/v1/auth/agent-register\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "my-vercel-agent" }),
}).then(r => r.json());

// 2. Use as an AI SDK tool
const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: {
    sendEmail: tool({
      description: "Send email from the agent's inbox",
      parameters: z.object({
        to: z.string(), subject: z.string(), body: z.string(),
      }),
      execute: async ({ to, subject, body }) => {
        const res = await fetch(\`\${BASE}/v1/email/send\`, {
          method: "POST",
          headers: {
            "Authorization": \`Bearer \${reg.api_key}\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: reg.email_address,
            to: [to], subject, text: body,
          }),
        });
        return (await res.json());
      },
    }),
  },
  prompt: "Send a welcome email to user@example.com",
});`;

const mcpConfigCode = `{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["@agentlair/mcp@latest"],
      "env": {
        "AGENTLAIR_API_KEY": "al_live_..."
      }
    }
  }
}`;

// ---------------------------------------------------------------------------
// Tab data
// ---------------------------------------------------------------------------

interface FrameworkTab {
  id: string;
  label: string;
  title: string;
  description: string;
  installCmd: string;
  installTitle?: string;
  language: string;
  code: string;
  note: React.ReactNode;
}

const frameworkTabs: FrameworkTab[] = [
  {
    id: "langchain",
    label: "LangChain",
    title: "LangChain (TypeScript)",
    description:
      "Add email tools to any LangChain agent. Agents can send and receive email from a dedicated @agentlair.dev address.",
    installCmd: "npm install langchain @langchain/openai",
    language: "typescript",
    code: langchainCode,
    note: (
      <>
        <strong className="text-foreground">How it works:</strong>{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          agent-register
        </code>{" "}
        creates a persistent agent identity with a real email address. No human
        verification required &mdash; your agent owns its inbox from the first
        request.
      </>
    ),
  },
  {
    id: "crewai",
    label: "CrewAI",
    title: "CrewAI (Python)",
    description:
      "Equip CrewAI agents with full send/receive email capabilities. Each agent gets its own @agentlair.dev mailbox.",
    installCmd: "pip install crewai requests",
    language: "python",
    code: crewaiCode,
    note: (
      <>
        <strong className="text-foreground">How it works:</strong> Each tool is
        a plain Python function decorated with{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          @tool
        </code>
        . CrewAI picks up tool descriptions automatically &mdash; no manual
        schema required.
      </>
    ),
  },
  {
    id: "vercel",
    label: "Vercel AI SDK",
    title: "Vercel AI SDK (TypeScript)",
    description:
      "Drop-in email tool for any generateText or streamText call. Works with GPT-4o, Claude, Gemini — any model.",
    installCmd: "npm install ai @ai-sdk/openai",
    language: "typescript",
    code: vercelCode,
    note: (
      <>
        <strong className="text-foreground">How it works:</strong> The{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          tool()
        </code>{" "}
        helper from the AI SDK wraps the AgentLair REST call. Works with any
        model that supports tool use &mdash; just swap{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          openai()
        </code>{" "}
        for{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          anthropic()
        </code>
        ,{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          google()
        </code>
        , etc.
      </>
    ),
  },
  {
    id: "mcp",
    label: "MCP",
    title: "MCP (Claude Desktop / Cursor)",
    description:
      "Add AgentLair as an MCP server. Your AI assistant gets 13 tools automatically — email (send_email, check_inbox, claim_address) and calendar (create_event, list_events, update_event, delete_event, get_ical_feed).",
    installCmd: "npx @agentlair/mcp@latest",
    installTitle: "Install",
    language: "bash",
    code: mcpConfigCode,
    note: (
      <>
        <strong className="text-foreground">How it works:</strong> Add this to
        your{" "}
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          claude_desktop_config.json
        </code>{" "}
        or Cursor MCP settings. Restart the app and AgentLair tools appear
        automatically in Claude's tool list. Get your API key at{" "}
        <a
          href="/#web-signup"
          className="text-primary underline underline-offset-4"
        >
          agentlair.dev
        </a>
        .
      </>
    ),
  },
];

// ---------------------------------------------------------------------------
// Key facts & next steps
// ---------------------------------------------------------------------------

const keyFacts = [
  {
    label: "Self-registration",
    detail: (
      <>
        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
          POST /v1/auth/agent-register
        </code>{" "}
        &mdash; no human verification needed
      </>
    ),
  },
  {
    label: "Free Tier",
    detail: "10 emails/day, 100 API requests/day, 10 addresses",
  },
  {
    label: "API Docs",
    detail: (
      <>
        Full reference at{" "}
        <a
          href="/api"
          className="text-primary underline underline-offset-4"
        >
          /api
        </a>
      </>
    ),
  },
  {
    label: "Need Help?",
    detail: (
      <a
        href="mailto:hello@agentlair.dev"
        className="text-primary underline underline-offset-4"
      >
        hello@agentlair.dev
      </a>
    ),
  },
];

const nextSteps = [
  {
    href: "/api",
    icon: BookOpen,
    title: "API Reference",
    description:
      "Full endpoint documentation with request/response examples.",
  },
  {
    href: "/getting-started",
    icon: Rocket,
    title: "Getting Started",
    description:
      "Step-by-step guide to claiming your first agent email address.",
  },
  {
    href: "/vault",
    icon: Lock,
    title: "Vault (Secret Storage)",
    description:
      "Store API keys and secrets securely for your agents.",
  },
  {
    href: "/calendar",
    icon: Calendar,
    title: "Agent Calendar",
    description:
      "Create events via REST. Share an iCal feed. Humans subscribe in any calendar app.",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntegrationsPage() {
  return (
    <>
      <Background>
        <PageHeader
          title="Framework Integrations"
          description="Give your AI agents email with 3 lines of code. Works with every major agent framework."
        />
      </Background>

      <section className="pb-28 lg:pb-32">
        <div className="container max-w-3xl space-y-8">
          {/* Framework tabs */}
          <Tabs defaultValue="langchain">
            <TabsList className="flex-wrap">
              {frameworkTabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {frameworkTabs.map((tab) => (
              <TabsContent key={tab.id} value={tab.id}>
                <Card>
                  <CardContent className="space-y-4">
                    <h2 className="text-foreground text-lg font-bold">
                      {tab.title}
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      {tab.description}
                    </p>

                    <div className="space-y-1">
                      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                        Install
                      </p>
                      <CodeBlock
                        code={tab.installCmd}
                        language="bash"
                        title="Terminal"
                      />
                    </div>

                    <div className="space-y-1">
                      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                        {tab.id === "mcp"
                          ? "Claude Desktop / Cursor config"
                          : "Code"}
                      </p>
                      <CodeBlock
                        code={tab.code}
                        language={tab.language}
                        title={
                          tab.id === "mcp"
                            ? "claude_desktop_config.json"
                            : tab.title
                        }
                      />
                    </div>

                    <div className="text-muted-foreground rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                      {tab.note}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>

          {/* Key Facts */}
          <div className="space-y-4">
            <h2 className="text-foreground text-lg font-bold">Key Facts</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {keyFacts.map((fact) => (
                <Card key={fact.label}>
                  <CardContent className="space-y-1">
                    <p className="text-primary text-xs font-semibold uppercase tracking-wider">
                      {fact.label}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {fact.detail}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Next Steps */}
          <div className="space-y-4">
            <h2 className="text-foreground text-lg font-bold">Next Steps</h2>
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
        </div>
      </section>
    </>
  );
}
