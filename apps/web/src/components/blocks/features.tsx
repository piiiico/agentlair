import { Mail, Shield, Box, ScrollText, Sparkles, Bug, ShoppingCart, FileCheck } from "lucide-react";

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
      "Zero-knowledge credential storage. Your agent encrypts locally, we store opaque blobs. Versioned, recoverable, edge-deployed. Survives container restarts. Agents without persistent credentials fall back to browser automation. Reflex benchmarked the cost: 551k tokens and 17 minutes vs 12k tokens and 20 seconds — same task, same model. The 45x gap isn't a model problem. It's a credential problem.",
    icon: Shield,
    href: "/vault",
    roadmap: false,
  },
  {
    title: "Permanent record",
    tagline: "Every action signed, chained, provable.",
    description:
      "Log every tool call, LLM invocation, and decision to a persistent, queryable audit trail. EdDSA-signed entries — tamper-evident by construction. Verify any attestation receipt in your browser.",
    icon: ScrollText,
    href: "/verify-receipt",
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

        {/* Accountability Layer */}
        <div className="mt-20 lg:mt-28">
          <div className="relative flex items-center justify-center">
            <DashedLine className="text-muted-foreground" />
            <span className="bg-muted text-muted-foreground absolute px-3 font-mono text-sm font-medium tracking-wide max-md:hidden">
              THE MISSING LAYER
            </span>
          </div>

          <div className="mt-10 mx-auto max-w-3xl lg:mt-16">
            <h2 className="text-2xl tracking-tight md:text-3xl lg:text-4xl">
              Circle, Stripe, and Coinbase solved payments. No one solved identity.
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed">
              Circle's Agent Stack launched in May 2026 — wallets, nanopayments down to 0.000001 USDC, an agent marketplace, all built on x402. Stripe and Coinbase followed. The payment layer is commoditized. What none of them answer: <em>which agent made the call, who is its owner, and do I trust it?</em> Today's answer is git commit metadata. That's the gap. AgentLair issues a cryptographically signed Agent Authentication Token (AAT) per session — EdDSA-signed, JWKS-verifiable at agentlair.dev, tethered to a named human owner. Every action is logged to a tamper-evident ledger. Circle processes the nanopayment. AgentLair tells you who sent it and whether to trust them.
            </p>

            {/* Distinction table */}
            <div className="mt-10 overflow-hidden rounded-2xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-5 py-3 text-left font-mono text-xs font-semibold tracking-widest text-muted-foreground">LAYER</th>
                    <th className="px-5 py-3 text-left font-mono text-xs font-semibold tracking-widest text-muted-foreground">HANDLED BY</th>
                    <th className="px-5 py-3 text-left font-mono text-xs font-semibold tracking-widest text-muted-foreground">WHAT IT ANSWERS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="px-5 py-4 font-medium">Payments</td>
                    <td className="px-5 py-4 text-muted-foreground">Circle · Stripe · Coinbase</td>
                    <td className="px-5 py-4 text-muted-foreground">Can the agent spend? How much? Gas-free USDC on-chain in seconds.</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-5 py-4 font-medium">Execution</td>
                    <td className="px-5 py-4 text-muted-foreground">Cloudflare · AWS</td>
                    <td className="px-5 py-4 text-muted-foreground">Did the agent successfully run? Did it provision the infrastructure?</td>
                  </tr>
                  <tr className="bg-primary/5">
                    <td className="px-5 py-4 font-bold text-foreground">Identity</td>
                    <td className="px-5 py-4 font-bold text-foreground">AgentLair</td>
                    <td className="px-5 py-4 font-bold text-foreground">Which agent acted? Who owns it? Is it trusted — and can I prove it?</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Use Cases */}
        <div className="mt-20 lg:mt-28">
          <div className="relative flex items-center justify-center">
            <DashedLine className="text-muted-foreground" />
            <span className="bg-muted text-muted-foreground absolute px-3 font-mono text-sm font-medium tracking-wide max-md:hidden">
              DEPLOYMENT PATTERNS
            </span>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl items-center gap-3 md:gap-0 lg:mt-24 lg:grid-cols-2">
            <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
              Who deploys AgentLair
            </h2>
            <p className="text-muted-foreground leading-snug">
              Named use cases for the cross-org behavioral trust layer — from autonomous security fleets to regulated agentic commerce.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3 md:mt-12 lg:mt-16">
            {[
              {
                icon: Bug,
                label: "AUTONOMOUS SECURITY AGENT GOVERNANCE",
                title: "Govern your security agent fleet",
                body: "Microsoft MDASH runs 100+ adversarial agents simultaneously. OpenAI Codex Security is GA across Enterprise, Business, and Edu tiers. Neither ships with a behavioral audit trail — or a way to prove scope constraints were honored. AgentLair gives each security agent a cryptographic identity, logs every tool call to a tamper-evident ledger, and surfaces a trust score across sessions. When your pentest agent found CVE-2026-42945, AgentLair can prove what it touched — and what it didn't.",
              },
              {
                icon: ShoppingCart,
                label: "AGENTIC COMMERCE",
                title: "Know which agent is buying",
                body: "Circle, Stripe, and Coinbase handle the payment rail. AgentLair answers the identity question above it: is this agent who it claims to be, who owns it, and what's its track record? Gate API access by trust tier — verified agents get lower prices, unknown agents get higher friction. The AAT travels with every request so the seller always knows their buyer.",
              },
              {
                icon: FileCheck,
                label: "EU AI ACT COMPLIANCE",
                title: "Audit artifacts for regulated industries",
                body: "EU AI Act full enforcement lands August 2026. Every agentic deployment in healthcare, finance, and critical infrastructure needs behavioral accountability infrastructure — not just logs, but tamper-evident records an auditor can independently verify. AgentLair's hash-chained attestation ledger is that artifact. One URL per agent per session, verifiable in a browser.",
              },
            ].map((uc) => {
              const Icon = uc.icon;
              return (
                <div key={uc.label} className="rounded-2xl border bg-card p-6 md:p-8">
                  <div className="bg-primary/10 inline-flex rounded-xl p-3 mb-4">
                    <Icon className="text-primary size-5" />
                  </div>
                  <p className="font-mono text-xs font-semibold tracking-widest text-muted-foreground mb-2">
                    {uc.label}
                  </p>
                  <h3 className="font-display text-lg font-bold tracking-tight mb-3">
                    {uc.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {uc.body}
                  </p>
                </div>
              );
            })}
          </div>
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
