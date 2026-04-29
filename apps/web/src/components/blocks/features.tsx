import { Mail, Shield, Box, ScrollText, Sparkles } from "lucide-react";

import { DashedLine } from "../dashed-line";
import { Card, CardContent } from "@/components/ui/card";

const items = [
  {
    title: "Permanent address",
    tagline: "Your agent wanted an email. CAPTCHA said no.",
    description:
      "Claim @agentlair.dev addresses. Send and receive email via REST API — no SMTP, no CAPTCHA, no browser required. Drafts, threading, and webhooks included.",
    icon: Mail,
    href: "/getting-started",
    roadmap: false,
  },
  {
    title: "Permanent credentials",
    tagline: "Your secrets shouldn't live in env vars.",
    description:
      "Zero-knowledge credential storage. Your agent encrypts locally, we store opaque blobs. Versioned, recoverable, edge-deployed. Survives container restarts.",
    icon: Shield,
    href: "/vault",
    roadmap: false,
  },
  {
    title: "Permanent record",
    tagline: "Every action signed, chained, provable.",
    description:
      "Log every tool call, LLM invocation, and decision to a persistent, queryable audit trail. EdDSA-signed entries — tamper-evident by construction. Built with EU AI Act Article 12 logging requirements in mind.",
    icon: ScrollText,
    href: "/docs/audit-logger",
    roadmap: false,
  },
  {
    title: "Permanent namespace",
    tagline: "Isolated environments that persist.",
    description:
      "Multi-tenant isolation via pods. Each pod gets its own API key, email, vault, and audit trail — fully sandboxed per client, persistent across sessions.",
    icon: Box,
    href: "/pods",
    roadmap: false,
  },
  {
    title: "Permanent reputation",
    tagline: "Behavioral trust across sessions.",
    description:
      "Trust scores computed from observed behavior — consistency, transparency, topic diversity, and activity volume. Four tiers from untrusted to verified. Query via API to gate permissions or surface agent credibility.",
    icon: Sparkles,
    href: "/docs/api-reference#trust",
    roadmap: false,
  },
];

const competitors = [
  {
    name: "vs AgentMail",
    claim: "They give you a permanent address.",
    ours: "We give you a permanent identity.",
  },
  {
    name: "vs Keycard",
    claim: "Ephemeral credentials per session.",
    ours: "Persistent vault that survives restarts.",
  },
  {
    name: "vs Enterprise IAM",
    claim: "Corporate infra, SSO required.",
    ours: "Internet-native, no org required.",
  },
  {
    name: "vs Claude Code",
    claim: "System-prompt injection on every Read/Grep breaks parallel agents.",
    ours: "Clean orchestration layer. No injected prompts, no subagent refusals.",
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
            FIVE PILLARS OF PERSISTENT IDENTITY
          </span>
        </div>

        {/* Content */}
        <div className="mx-auto mt-10 grid max-w-4xl items-center gap-3 md:gap-0 lg:mt-24 lg:grid-cols-2">
          <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
            Identity that outlasts the session
          </h2>
          <p className="text-muted-foreground leading-snug">
            Agents are stateless by default. AgentLair gives each agent
            a durable identity layer — address, credentials, record, namespace,
            and reputation — that persists regardless of where or how often the
            agent runs.
          </p>
        </div>

        {/* Features Grid */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-12 lg:mt-20">
          {items.map((item, i) => {
            const Icon = item.icon;
            const content = (
              <Card
                key={i}
                className="group rounded-2xl transition-colors hover:border-primary/50"
              >
                <CardContent className="p-6 md:p-8">
                  <div className="mb-6 flex items-start justify-between">
                    <div className="bg-primary/10 inline-flex rounded-xl p-3">
                      <Icon className="text-primary size-6" />
                    </div>
                    {item.roadmap && (
                      <span className="rounded-full border border-muted-foreground/30 bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        ROADMAP
                      </span>
                    )}
                  </div>

                  <h3 className="font-display text-xl leading-tight font-bold tracking-tight lg:text-2xl">
                    {item.title}
                  </h3>
                  <p className="text-primary mt-1 text-sm font-medium italic">
                    "{item.tagline}"
                  </p>
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
              <div key={i}>{content}</div>
            );
          })}
        </div>

        {/* Competitive Positioning */}
        <div className="mt-20 lg:mt-28">
          <div className="relative flex items-center justify-center">
            <DashedLine className="text-muted-foreground" />
            <span className="bg-muted text-muted-foreground absolute px-3 font-mono text-sm font-medium tracking-wide max-md:hidden">
              HOW WE'RE DIFFERENT
            </span>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3 lg:mt-16">
            {competitors.map((c) => (
              <div
                key={c.name}
                className="rounded-2xl border bg-card p-6 md:p-8"
              >
                <p className="font-mono text-xs font-semibold tracking-widest text-muted-foreground">
                  {c.name}
                </p>
                <p className="mt-3 text-sm text-muted-foreground line-through">
                  {c.claim}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {c.ours}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
