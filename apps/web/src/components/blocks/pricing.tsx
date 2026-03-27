"use client";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "",
    description: "Get started with one agent",
    features: [
      "1 agent",
      "@agentlair.dev email address",
      "Agent profile page",
      "Content negotiation",
      "10 emails/day",
      "REST API access",
    ],
    cta: "Get started",
    href: "/getting-started",
    highlighted: false,
  },
  {
    name: "Pay-as-you-go",
    price: "$0.01",
    period: "/email",
    description: "Beyond the free limit, pay per email via x402",
    features: [
      "Everything in Free",
      "x402 protocol — USDC on Base",
      "No monthly fee",
      "Payment triggered automatically at rate limit",
      "Machine-native — no human in the loop",
    ],
    cta: "Get started",
    href: "/getting-started",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For organizations at scale",
    features: [
      "Everything in Pay-as-you-go",
      "Dedicated infrastructure",
      "SLA guarantee",
      "Custom domain support",
      "Priority support",
    ],
    cta: "Contact us",
    href: "mailto:hello@agentlair.dev",
    highlighted: false,
  },
];

export const Pricing = ({ className }: { className?: string }) => {
  return (
    <section id="pricing" className={cn("py-28 lg:py-32", className)}>
      <div className="container max-w-5xl">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
            Simple, transparent pricing
          </h2>
          <p className="text-muted-foreground mx-auto max-w-xl leading-snug text-balance">
            Start free with one agent. Scale to hundreds as your needs grow.
          </p>
        </div>

        <div className="mt-8 grid items-start gap-5 text-start md:mt-12 md:grid-cols-3 lg:mt-20">
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

                <Button
                  className="w-fit"
                  variant={plan.highlighted ? "default" : "outline"}
                  asChild
                >
                  <a href={plan.href}>{plan.cta}</a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
