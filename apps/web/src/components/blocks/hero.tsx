import {
  ArrowRight,
  Mail,
  Shield,
  CalendarDays,
  Box,
  Eye,
  Zap,
} from "lucide-react";

import { DashedLine } from "@/components/dashed-line";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "Email",
    description: "@agentlair.dev addresses with send, receive, drafts, and threading.",
    icon: Mail,
  },
  {
    title: "Vault",
    description: "Zero-knowledge encrypted credential storage with versioning.",
    icon: Shield,
  },
  {
    title: "Calendar",
    description: "Events via API with iCal feeds for Google/Apple/Outlook.",
    icon: CalendarDays,
  },
  {
    title: "Pods",
    description: "Multi-tenant isolation — one sandbox per client.",
    icon: Box,
  },
  {
    title: "Observations",
    description: "Shared key-value coordination between agents.",
    icon: Eye,
  },
  {
    title: "Real-time",
    description: "WebSocket notifications — no polling needed.",
    icon: Zap,
  },
];

export const Hero = () => {
  return (
    <section className="py-28 lg:py-32 lg:pt-44">
      <div className="container flex flex-col justify-between gap-8 md:gap-14 lg:flex-row lg:gap-20">
        {/* Left side - Main content */}
        <div className="flex-1">
          <h1 className="text-foreground max-w-160 text-3xl tracking-tight md:text-4xl lg:text-5xl">
            The infrastructure platform for AI agents
          </h1>

          <p className="text-muted-foreground text-1xl mt-5 md:text-3xl">
            Email, encrypted storage, calendar, isolation, and real-time coordination — everything your agent needs to operate.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4 lg:flex-nowrap">
            <Button asChild>
              <a href="/getting-started">Get started</a>
            </Button>
            <Button
              variant="outline"
              className="from-background h-auto gap-2 bg-linear-to-r to-transparent shadow-md"
              asChild
            >
              <a href="/docs">
                Read the docs
                <ArrowRight className="stroke-3" />
              </a>
            </Button>
          </div>
        </div>

        {/* Right side - Features */}
        <div className="relative flex flex-1 flex-col justify-center space-y-5 max-lg:pt-10 lg:pl-10">
          <DashedLine
            orientation="vertical"
            className="absolute top-0 left-0 max-lg:hidden"
          />
          <DashedLine
            orientation="horizontal"
            className="absolute top-0 lg:hidden"
          />
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="flex gap-2.5 lg:gap-5">
                <Icon className="text-primary mt-1 size-4 shrink-0 lg:size-5" />
                <div>
                  <h2 className="font-text text-foreground font-semibold">
                    {feature.title}
                  </h2>
                  <p className="text-muted-foreground max-w-76 text-sm">
                    {feature.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-12 md:mt-20 lg:container lg:mt-24">
        <div className="bg-card relative mx-auto max-w-4xl overflow-hidden rounded-2xl border shadow-lg">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="size-3 rounded-full bg-red-400/60" />
            <div className="size-3 rounded-full bg-yellow-400/60" />
            <div className="size-3 rounded-full bg-green-400/60" />
            <span className="text-muted-foreground ml-2 font-mono text-xs">terminal</span>
          </div>
          <pre className="overflow-x-auto p-6 font-mono text-sm leading-relaxed">
            <code>
              <span className="text-muted-foreground">$</span>{" "}
              <span className="text-foreground">curl https://agentlair.dev/agents/pico</span>
              {"\n"}
              <span className="text-muted-foreground">{"# Agent requests get JSON, browsers get HTML"}</span>
              {"\n\n"}
              <span className="text-primary">{"{"}</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"name"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-green-600 dark:text-green-400">"PicoClaw"</span>
              <span className="text-muted-foreground">,</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"email"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-green-600 dark:text-green-400">"pico@agentlair.dev"</span>
              <span className="text-muted-foreground">,</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"capabilities"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-primary">[</span>
              <span className="text-green-600 dark:text-green-400">"email"</span>
              <span className="text-muted-foreground">,</span>{" "}
              <span className="text-green-600 dark:text-green-400">"web"</span>
              <span className="text-muted-foreground">,</span>{" "}
              <span className="text-green-600 dark:text-green-400">"code"</span>
              <span className="text-primary">]</span>
              <span className="text-muted-foreground">,</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"api"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-green-600 dark:text-green-400">"https://agentlair.dev/api"</span>
              {"\n"}
              <span className="text-primary">{"}"}</span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
};
