import { GitMerge, Package } from "lucide-react";

import { DashedLine } from "../dashed-line";
import { Card, CardContent } from "@/components/ui/card";

const integrations = [
  {
    name: "task-orchestrator",
    author: "jpicklyk",
    description:
      "MCP-based workflow automation for Claude agents. Added JWKS ActorVerifier pointing to AgentLair as the reference identity provider — every audited action now verifies agent identity against AgentLair's trust store.",
    tech: "TypeScript · MCP",
    status: "Shipped v3.2.0",
  },
  {
    name: "springdrift",
    author: "seamus-brady",
    description:
      "Gleam/BEAM agent platform. Integrated behavioral telemetry via fire-and-forget POSTs — every gate event builds a persistent audit record on AgentLair, compounding the agent's trust score over time.",
    tech: "Gleam · BEAM",
    status: "Merged PR #38",
  },
];

const packages = [
  {
    name: "@agentlair/sdk",
    version: "0.4.2",
    description: "Agent identity & trust API",
    command: "npm i @agentlair/sdk",
  },
  {
    name: "@agentlair/mcp",
    version: "1.2.0",
    description: "MCP server — trust queries in one command",
    command: "npx @agentlair/mcp@latest",
  },
  {
    name: "@agentlair/vault-crypto",
    version: "0.1.0",
    description: "Zero-knowledge credential encryption",
    command: "npm i @agentlair/vault-crypto",
  },
];

export const Integrations = () => {
  return (
    <section className="pb-28 lg:pb-32">
      <div className="container">
        {/* Section divider */}
        <div className="relative flex items-center justify-center">
          <DashedLine className="text-muted-foreground" />
          <span className="bg-muted text-muted-foreground absolute px-3 font-mono text-sm font-medium tracking-wide max-md:hidden">
            ALREADY IN PRODUCTION
          </span>
        </div>

        {/* Heading */}
        <div className="mx-auto mt-10 grid max-w-4xl items-center gap-3 md:gap-0 lg:mt-24 lg:grid-cols-2">
          <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
            Shipped in the wild
          </h2>
          <p className="text-muted-foreground leading-snug">
            Two open-source agent frameworks have already integrated AgentLair
            in production — JWKS identity verification and behavioral telemetry
            running on real agent workloads.
          </p>
        </div>

        {/* Integration Cards */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 md:mt-12 lg:mt-20">
          {integrations.map((integration, i) => (
            <Card
              key={i}
              className="group h-full rounded-2xl transition-colors hover:border-primary/50"
            >
              <CardContent className="p-6 md:p-8">
                <div className="mb-4 flex items-start justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-mono text-xs font-medium text-green-400">
                    <GitMerge className="size-3" />
                    {integration.status}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {integration.tech}
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold tracking-tight">
                  {integration.name}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  by {integration.author}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {integration.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* npm Packages */}
        <div className="mt-12 lg:mt-16">
          <div className="mb-6 flex items-center justify-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <p className="font-mono text-sm text-muted-foreground">
              3 packages on npm
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {packages.map((pkg, i) => (
              <div
                key={i}
                className="rounded-xl border bg-card p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-xs font-semibold text-foreground truncate">
                    {pkg.name}
                  </p>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    v{pkg.version}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pkg.description}
                </p>
                <p className="mt-3 rounded bg-muted/60 px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  {pkg.command}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
