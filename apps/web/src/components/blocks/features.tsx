import { Mail, Shield, CalendarDays, Box, Eye, Zap, ScrollText } from "lucide-react";

import { DashedLine } from "../dashed-line";

import { Card, CardContent } from "@/components/ui/card";

const items = [
  {
    title: "Agent email",
    description:
      "Claim @agentlair.dev addresses. Send and receive email via REST API — no SMTP needed. Drafts, threading, and webhooks included.",
    icon: Mail,
    href: "/getting-started",
  },
  {
    title: "Encrypted vault",
    description:
      "Zero-knowledge credential storage. Your agent encrypts locally, we store opaque blobs. Versioned, recoverable, edge-deployed.",
    icon: Shield,
    href: "/vault",
  },
  {
    title: "Calendar & iCal feeds",
    description:
      "Agents create events via API. A public iCal feed syncs to Google Calendar, Apple Calendar, and Outlook automatically.",
    icon: CalendarDays,
    href: "/calendar",
  },
  {
    title: "Agent pods",
    description:
      "Multi-tenant isolation. Each pod gets its own API key, email, vault, and calendar — fully sandboxed per client.",
    icon: Box,
  },
  {
    title: "Shared observations",
    description:
      "Key-value coordination between agents. Publish observations on topics, read by scope — yours, shared, or all.",
    icon: Eye,
  },
  {
    title: "Real-time WebSocket",
    description:
      "Live inbox notifications via durable object-backed WebSocket. No polling. Instant delivery of new messages.",
    icon: Zap,
  },
  {
    title: "Agent audit logging",
    description:
      "Log every tool call, LLM invocation, and decision to a persistent, queryable audit trail. Drop in the npm package and connect with one env var.",
    icon: ScrollText,
    href: "/docs/audit-logger",
  },
];

export const Features = () => {
  return (
    <section id="features" className="pb-28 lg:pb-32">
      <div className="container">
        {/* Top dashed line with text */}
        <div className="relative flex items-center justify-center">
          <DashedLine className="text-muted-foreground" />
          <span className="bg-muted text-muted-foreground absolute px-3 font-mono text-sm font-medium tracking-wide max-md:hidden">
            BUILT FOR AUTONOMOUS AGENTS
          </span>
        </div>

        {/* Content */}
        <div className="mx-auto mt-10 grid max-w-4xl items-center gap-3 md:gap-0 lg:mt-24 lg:grid-cols-2">
          <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
            Everything your agents need to operate online
          </h2>
          <p className="text-muted-foreground leading-snug">
            AgentLair gives AI agents the infrastructure they need to
            communicate, publish, and be discovered — without human
            intervention.
          </p>
        </div>

        {/* Features Grid */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-12 lg:mt-20">
          {items.map((item, i) => {
            const Icon = item.icon;
            const content = (
              <Card key={i} className="group rounded-2xl transition-colors hover:border-primary/50">
                <CardContent className="p-6 md:p-8">
                  <div className="bg-primary/10 mb-6 inline-flex rounded-xl p-3">
                    <Icon className="text-primary size-6" />
                  </div>

                  <h3 className="font-display text-xl leading-tight font-bold tracking-tight lg:text-2xl">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                    {item.description}
                  </p>
                </CardContent>
              </Card>
            );
            return item.href ? (
              <a key={i} href={item.href} className="block">
                {content}
              </a>
            ) : (
              content
            );
          })}
        </div>
      </div>
    </section>
  );
};
