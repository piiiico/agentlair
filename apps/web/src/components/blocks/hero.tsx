import {
  ArrowRight,
  Mail,
  Shield,
  Box,
  ScrollText,
  Fingerprint,
  Sparkles,
} from "lucide-react";

import { DashedLine } from "@/components/dashed-line";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "Permanent address",
    description: "@agentlair.dev email that survives session restarts.",
    icon: Mail,
  },
  {
    title: "Permanent credentials",
    description: "Zero-knowledge vault. Not env vars.",
    icon: Shield,
  },
  {
    title: "Permanent record",
    description: "Every action signed, chained, provable.",
    icon: ScrollText,
  },
  {
    title: "Permanent namespace",
    description: "Isolated pods. One per client.",
    icon: Box,
  },
  {
    title: "Permanent reputation",
    description: "Behavioral trust scores across sessions. Observable, not declarative.",
    icon: Sparkles,
  },
];

export const Hero = () => {
  return (
    <section className="py-28 lg:py-32 lg:pt-44">
      <div className="container flex flex-col justify-between gap-8 md:gap-14 lg:flex-row lg:gap-20">
        {/* Left side - Main content */}
        <div className="flex-1">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 font-mono text-xs text-muted-foreground">
            <Fingerprint className="size-3" />
            Persistent identity infrastructure
          </div>

          <h1 className="text-foreground max-w-160 text-3xl tracking-tight md:text-4xl lg:text-5xl">
            Your agent dies every session. Its identity doesn't have to.
          </h1>

          <p className="text-muted-foreground text-1xl mt-5 md:text-2xl">
            Give your agent a permanent address, credentials, audit trail, and
            namespace — everything it needs to operate across sessions.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4 lg:flex-nowrap">
            <Button asChild>
              <a href="/register">Start Free</a>
            </Button>
            <Button
              variant="outline"
              className="from-background h-auto gap-2 bg-linear-to-r to-transparent shadow-md"
              asChild
            >
              <a href="/getting-started">
                Try it in 5 minutes
                <ArrowRight className="stroke-3" />
              </a>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            <a href="/verify" className="underline underline-offset-2 hover:text-foreground">
              Verify any agent →
            </a>{" "}
            Paste a DID or AAT to see the full attestation chain.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <a href="/live" className="underline underline-offset-2 hover:text-foreground">
              Watch the substrate live →
            </a>{" "}
            Real-time SCITT receipts, trust histogram, signed by AgentLair.
          </p>
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
              <span className="text-foreground">curl -X POST https://agentlair.dev/v1/register \</span>
              {"\n"}
              {"  "}
              <span className="text-foreground">-H "Content-Type: application/json" \</span>
              {"\n"}
              {"  "}
              <span className="text-foreground">{`-d '{"name": "my-agent"}'`}</span>
              {"\n\n"}
              <span className="text-primary">{"{"}</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"api_key"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-green-600 dark:text-green-400">"al_live_k7x9m2p4..."</span>
              <span className="text-muted-foreground">,</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"account_id"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-green-600 dark:text-green-400">"acc_7kX9mP2qR4wL"</span>
              <span className="text-muted-foreground">,</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"email_address"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-green-600 dark:text-green-400">"my-agent@agentlair.dev"</span>
              <span className="text-muted-foreground">,</span>
              {"\n"}
              {"  "}
              <span className="text-primary">"tier"</span>
              <span className="text-muted-foreground">:</span>{" "}
              <span className="text-green-600 dark:text-green-400">"free"</span>
              {"\n"}
              <span className="text-primary">{"}"}</span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
};
