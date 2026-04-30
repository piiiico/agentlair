"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WaitlistModal } from "@/components/ui/waitlist-modal";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Identity verification for individual agents",
    features: [
      "3 agents",
      "1,000 verifications/month",
      "500 behavioral events/day",
      "7-day event history",
      "AAT issuance (Ed25519 JWT)",
      "JWKS endpoint (.well-known/jwks.json)",
      "Basic agent profile page",
      "Community support (GitHub Issues)",
    ],
    cta: "Get Started",
    href: "/register",
    waitlist: false,
    highlighted: false,
  },
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    description: "Audit trail, email, and vault for production agents",
    features: [
      "25 agents",
      "50,000 verifications/month",
      "Ed25519-signed hash-chained audit trail",
      "1-year audit log retention",
      "Agent email (@agentlair.dev)",
      "Encrypted credential vault",
      "10 pods (sub-identities)",
      "Webhook notifications",
      "5,000 behavioral events/day",
      "30-day event history + aggregation",
      "Trust level: senior achievable",
      "Email support",
    ],
    cta: "Join Waitlist",
    href: null,
    waitlist: true,
    highlighted: true,
  },
  {
    name: "Pro",
    price: "$149",
    period: "/month",
    description: "Cross-org behavioral trust scoring — the moat",
    features: [
      "200 agents",
      "500,000 verifications/month",
      "50,000 behavioral events/day",
      "90-day event history + ZK-ready Merkle roots",
      "Trust level: principal achievable",
      "Cross-org behavioral trust scoring",
      "ATF compliance engine",
      "Trust API (10K queries/month)",
      "x402 payment integration",
      "W3C VC issuance",
      "Priority support",
    ],
    cta: "Join Waitlist",
    href: null,
    waitlist: true,
    highlighted: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "Govern your agent fleet at scale",
    features: [
      "Unlimited agents",
      "Custom event volume + retention",
      "ZK-proof behavioral attestations",
      "Custom trust policies",
      "SSO/SAML",
      "EU data residency",
      "99.9% uptime SLA",
      "Dedicated support",
    ],
    cta: "Contact Us",
    href: "mailto:hei@agentlair.dev",
    waitlist: false,
    highlighted: false,
  },
];


export const Pricing = ({ className }: { className?: string }) => {
  const [modalTier, setModalTier] = useState<string | null>(null);

  return (
    <section id="pricing" className={cn("py-28 lg:py-32", className)}>
      <div className="container max-w-6xl">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
            Simple, transparent pricing
          </h2>
          <p className="text-muted-foreground mx-auto max-w-xl leading-snug text-balance">
            Start free. Identity verification from day one.
            Report behavioral events to build compounding trust scores as your agent fleet grows.
          </p>
        </div>

        <div className="mt-8 grid items-start gap-5 text-start md:mt-12 md:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`${
                plan.highlighted
                  ? "outline-primary origin-top outline-4"
                  : ""
              }`}
            >
              <CardContent className="flex flex-col gap-7 px-6 py-5">
                <div className="space-y-2">
                  <h3 className="text-foreground font-semibold">{plan.name}</h3>
                  <div className="space-y-1">
                    <div className="text-foreground text-2xl font-bold">
                      {plan.price}
                      {plan.period && (
                        <span className="text-muted-foreground text-sm font-normal">
                          {plan.period}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <span className="text-muted-foreground text-sm">
                  {plan.description}
                </span>

                <div className="space-y-3">
                  {plan.features.map((feature) => (
                    <div
                      key={feature}
                      className="text-muted-foreground flex items-center gap-1.5"
                    >
                      <Check className="size-5 shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                </div>

                {plan.waitlist ? (
                  <Button
                    className="w-fit"
                    variant={plan.highlighted ? "default" : "outline"}
                    onClick={() => setModalTier(plan.name)}
                  >
                    {plan.cta}
                  </Button>
                ) : (
                  <Button
                    className="w-fit"
                    variant={plan.highlighted ? "default" : "outline"}
                    asChild
                  >
                    <a href={plan.href!}>{plan.cta}</a>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {modalTier && (
        <WaitlistModal
          tier={modalTier}
          open={!!modalTier}
          onClose={() => setModalTier(null)}
        />
      )}
    </section>
  );
};
