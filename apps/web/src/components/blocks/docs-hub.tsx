import {
  BookOpen,
  Zap,
  Code2,
  Shield,
  FileText,
  Lock,
  Server,
  Box,
  CalendarDays,
  KeyRound,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DOC_SECTIONS = [
  {
    title: "Getting Started",
    href: "/getting-started",
    icon: Zap,
    description:
      "Register your first agent, issue an AAT, and verify trust. Zero to first API call in 5 minutes.",
    badge: "Start here",
    badgeColor:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  {
    title: "Concepts",
    href: "/docs/concepts",
    icon: BookOpen,
    description:
      "The mental model behind AgentLair: cross-org behavioral trust, AATs, and why L1–L3 identity is insufficient.",
  },
  {
    title: "API Reference",
    href: "/docs/api-reference",
    icon: Code2,
    description:
      "Full endpoint documentation: registration, token issuance, introspection, trust scoring, and JWKS.",
  },
  {
    title: "Audit Logger",
    href: "/docs/audit-logger",
    icon: FileText,
    description:
      "Immutable audit trail for agent actions. Submit behavioral observations and retrieve signed event logs.",
  },
  {
    title: "MCP Server",
    href: "/docs/mcp",
    icon: Server,
    description:
      "Use AgentLair with the Model Context Protocol. Identity-gated tool access for MCP-compatible agents.",
  },
  {
    title: "Vault",
    href: "/docs/vault",
    icon: Lock,
    description:
      "Zero-knowledge secret storage. Store encrypted credentials and retrieve them inside your agent's identity boundary.",
  },
  {
    title: "Security Model",
    href: "/security",
    icon: Shield,
    description:
      "What AgentLair protects, what it explicitly does not, and how the Ed25519 cryptographic model works.",
  },
  {
    title: "Pods",
    href: "/pods",
    icon: Box,
    description:
      "Isolated execution environments for agents. Each pod is a scoped runtime with its own identity and resource limits.",
  },
  {
    title: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    description:
      "Time awareness and scheduling primitives. Give agents persistent temporal context across sessions.",
  },
  {
    title: "Web Bot Auth",
    href: "/docs/web-bot-auth",
    icon: KeyRound,
    description:
      "RFC 9421 HTTP message signatures. Register your Ed25519 key and let servers verify your agent's identity on every request.",
  },
  {
    title: "Web Bot Auth Playground",
    href: "/playground/web-bot-auth",
    icon: KeyRound,
    description:
      "Sign and verify HTTP requests in your browser. See the L3 cryptographic verdict and the behavioral attestation chain side by side.",
    badge: "New",
    badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    title: "al_nid claim",
    href: "/docs/al-nid",
    icon: GitBranch,
    description:
      "AATs carry an al_nid claim binding the token to a Radicle Node ID — derived from the same Ed25519 signing key. One key, two identities.",
  },
  {
    title: "aat-to-radicle",
    href: "/docs/aat-to-radicle",
    icon: GitBranch,
    description:
      "CLI: pipe in an AAT, get a verified rad id update --delegate command. Checks signature against JWKS and cross-references the al_nid against the agent's DID document.",
    badge: "New",
    badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
];

export function DocsHub() {
  return (
    <div className="min-h-screen pt-20">
      {/* ─── Header ─── */}
      <header className="bg-background py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-5">
          <p className="text-primary mb-4 font-mono text-sm font-medium">
            Documentation
          </p>
          <h1 className="font-display mb-6 text-4xl font-bold tracking-tight lg:text-5xl">
            AgentLair Docs
          </h1>
          <p className="text-muted-foreground mb-8 max-w-xl text-lg leading-relaxed">
            Everything you need to give AI agents portable cryptographic
            identity, behavioral trust scores, and secure secret storage.
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-[oklch(0.13_0_0)] px-5 py-3.5 font-mono text-sm text-white/90 shadow">
            <span className="text-white/50">Base URL</span>
            <span>https://agentlair.dev</span>
            <span className="text-white/30">·</span>
            <a
              href="/docs/api-reference"
              className="text-white/60 hover:text-white/90 transition-colors"
            >
              Full API reference →
            </a>
          </div>
        </div>
      </header>

      {/* ─── Docs Grid ─── */}
      <section className="bg-muted/30 border-t py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {DOC_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <a
                  key={section.href}
                  href={section.href}
                  className={cn(
                    "group relative rounded-xl border bg-background p-5 transition-all",
                    "hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <Icon className="text-foreground size-4" />
                    </div>
                    {section.badge && (
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 font-mono text-xs font-medium",
                          section.badgeColor,
                        )}
                      >
                        {section.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="mb-1.5 font-semibold group-hover:text-primary transition-colors">
                    {section.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {section.description}
                  </p>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Quick Links ─── */}
      <section className="bg-background py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="font-display mb-8 text-xl font-semibold tracking-tight">
            Common tasks
          </h2>
          <div className="space-y-3">
            {[
              {
                label: "Register an agent and get an API key",
                href: "/getting-started#register",
                mono: "POST /v1/register",
              },
              {
                label: "Issue an Agent Authentication Token (AAT)",
                href: "/getting-started#issue",
                mono: "POST /v1/tokens/issue",
              },
              {
                label: "Verify an AAT on your server",
                href: "/getting-started#verify",
                mono: "POST /v1/tokens/introspect",
              },
              {
                label: "Check an agent's behavioral trust score",
                href: "/docs/api-reference#trust",
                mono: "GET /v1/trust/:agentId",
              },
              {
                label: "Set up JWKS-based offline verification",
                href: "/docs/api-reference#discovery",
                mono: "GET /.well-known/jwks.json",
              },
              {
                label: "Install the MCP server",
                href: "/docs/mcp",
                mono: "npx @agentlair/mcp@latest",
              },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="group flex items-center justify-between rounded-xl border px-5 py-3.5 transition-colors hover:bg-muted/40"
              >
                <span className="text-sm font-medium">{link.label}</span>
                <code className="text-muted-foreground group-hover:text-foreground font-mono text-xs transition-colors">
                  {link.mono}
                </code>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Footer CTA ─── */}
      <section className="bg-muted/40 border-t py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="font-display mb-4 text-2xl font-semibold">
            Ready to integrate?
          </h2>
          <p className="text-muted-foreground mx-auto mb-8 max-w-md">
            Register your first agent and start building behavioral trust in
            under 5 minutes. Free tier includes 100 API calls/day.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="/getting-started"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-3 font-medium shadow transition-colors"
            >
              Get Started
            </a>
            <a
              href="/docs/api-reference"
              className="text-foreground hover:bg-muted rounded-lg border px-6 py-3 font-medium transition-colors"
            >
              API Reference
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
