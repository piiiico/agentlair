"use client";

import { useState } from "react";

import { Check, ChevronsUpDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface FeatureSection {
  category: string;
  features: {
    name: string;
    free: true | false | null | string;
    starter: true | false | null | string;
    pro: true | false | null | string;
    enterprise: true | false | null | string;
  }[];
}

const pricingPlans = [
  {
    name: "Free",
    button: {
      text: "Get Started",
      href: "/register",
      variant: "outline" as const,
    },
  },
  {
    name: "Starter",
    button: {
      text: "Join Waitlist",
      href: "mailto:hei@agentlair.dev?subject=AgentLair Starter Waitlist",
      variant: "outline" as const,
    },
  },
  {
    name: "Pro",
    button: {
      text: "Join Waitlist",
      href: "mailto:hei@agentlair.dev?subject=AgentLair Pro Waitlist",
      variant: "outline" as const,
    },
  },
  {
    name: "Enterprise",
    button: {
      text: "Contact Us",
      href: "mailto:hei@agentlair.dev",
      variant: "outline" as const,
    },
  },
];

const comparisonFeatures: FeatureSection[] = [
  {
    category: "Agents & Verifications",
    features: [
      {
        name: "Agent registrations",
        free: "3",
        starter: "25",
        pro: "200",
        enterprise: "Unlimited",
      },
      {
        name: "Token verifications/month",
        free: "1,000",
        starter: "50,000",
        pro: "500,000",
        enterprise: "Negotiated",
      },
      {
        name: "Overage per verification",
        free: false,
        starter: "$0.0002",
        pro: "$0.00015",
        enterprise: "$0.0001",
      },
      {
        name: "AAT issuance (Ed25519 JWT)",
        free: "Unlimited",
        starter: "Unlimited",
        pro: "Unlimited",
        enterprise: "Unlimited",
      },
    ],
  },
  {
    category: "Identity",
    features: [
      {
        name: "JWKS endpoint (.well-known/jwks.json)",
        free: true,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "Basic agent profile page",
        free: true,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "W3C DID compliance",
        free: true,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "Custom domain",
        free: false,
        starter: false,
        pro: false,
        enterprise: true,
      },
    ],
  },
  {
    category: "Audit & Email",
    features: [
      {
        name: "Hash-chained audit trail",
        free: false,
        starter: "100K events/month",
        pro: "1M events/month",
        enterprise: "Negotiated",
      },
      {
        name: "Agent email (@agentlair.dev)",
        free: false,
        starter: "5 addresses",
        pro: "50 addresses",
        enterprise: "Custom",
      },
      {
        name: "Pods (sub-identities)",
        free: false,
        starter: "10",
        pro: "100",
        enterprise: "Unlimited",
      },
      {
        name: "Encrypted credential vault",
        free: false,
        starter: "50 secrets",
        pro: "500 secrets",
        enterprise: "Negotiated",
      },
    ],
  },
  {
    category: "Behavioral Events",
    features: [
      {
        name: "Events/day",
        free: "500",
        starter: "5,000",
        pro: "50,000",
        enterprise: "Negotiated",
      },
      {
        name: "Event retention",
        free: "7 days",
        starter: "30 days",
        pro: "90 days",
        enterprise: "Up to 365 days",
      },
      {
        name: "Daily aggregation",
        free: false,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "Event export (JSONL)",
        free: false,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "ZK-ready Merkle roots",
        free: false,
        starter: false,
        pro: true,
        enterprise: true,
      },
      {
        name: "Overage per event (x402)",
        free: "$0.001",
        starter: "$0.0005",
        pro: "$0.0003",
        enterprise: "$0.0001",
      },
      {
        name: "Max achievable trust level",
        free: "Junior",
        starter: "Senior",
        pro: "Principal",
        enterprise: "Principal",
      },
    ],
  },
  {
    category: "Trust & Intelligence",
    features: [
      {
        name: "Cross-org behavioral trust scoring",
        free: false,
        starter: false,
        pro: true,
        enterprise: true,
      },
      {
        name: "ATF compliance engine",
        free: false,
        starter: false,
        pro: true,
        enterprise: true,
      },
      {
        name: "Trust API queries/month",
        free: false,
        starter: false,
        pro: "10,000",
        enterprise: "Negotiated",
      },
      {
        name: "W3C VC issuance (agent_attestation)",
        free: false,
        starter: false,
        pro: true,
        enterprise: true,
      },
      {
        name: "ZK-proof behavioral attestations",
        free: false,
        starter: false,
        pro: false,
        enterprise: true,
      },
    ],
  },
  {
    category: "Payments & Governance",
    features: [
      {
        name: "x402 payment integration",
        free: false,
        starter: false,
        pro: true,
        enterprise: true,
      },
      {
        name: "Webhook notifications",
        free: false,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "SSO/SAML",
        free: false,
        starter: false,
        pro: false,
        enterprise: true,
      },
      {
        name: "EU data residency",
        free: false,
        starter: false,
        pro: false,
        enterprise: true,
      },
      {
        name: "99.9% uptime SLA",
        free: false,
        starter: false,
        pro: false,
        enterprise: true,
      },
    ],
  },
  {
    category: "Support",
    features: [
      {
        name: "Community support (GitHub Issues)",
        free: true,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "Email support",
        free: false,
        starter: true,
        pro: true,
        enterprise: true,
      },
      {
        name: "Priority support",
        free: false,
        starter: false,
        pro: true,
        enterprise: true,
      },
      {
        name: "Dedicated support",
        free: false,
        starter: false,
        pro: false,
        enterprise: true,
      },
    ],
  },
];

const renderFeatureValue = (value: true | false | null | string) => {
  if (value === true) {
    return <Check className="size-5" />;
  }
  if (value === false) {
    return <X className="size-5 text-muted-foreground/40" />;
  }
  if (value === null) {
    return null;
  }
  // String value
  return (
    <div className="flex items-center gap-2">
      <Check className="size-4" />
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
};

export const PricingTable = () => {
  const [selectedPlan, setSelectedPlan] = useState(0); // Default to Free

  return (
    <section className="pb-28 lg:py-32">
      <div className="container">
        <PlanHeaders
          selectedPlan={selectedPlan}
          onPlanChange={setSelectedPlan}
        />
        <FeatureSections selectedPlan={selectedPlan} />
      </div>
    </section>
  );
};

const PlanHeaders = ({
  selectedPlan,
  onPlanChange,
}: {
  selectedPlan: number;
  onPlanChange: (index: number) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="">
      {/* Mobile View */}
      <div className="md:hidden">
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="">
          <div className="flex items-center justify-between border-b py-4">
            <CollapsibleTrigger className="flex items-center gap-2">
              <h3 className="text-2xl font-semibold">
                {pricingPlans[selectedPlan].name}
              </h3>
              <ChevronsUpDown
                className={`size-5 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <Button
              variant={pricingPlans[selectedPlan].button.variant}
              className="w-fit"
              asChild
            >
              <a href={pricingPlans[selectedPlan].button.href}>
                {pricingPlans[selectedPlan].button.text}
              </a>
            </Button>
          </div>
          <CollapsibleContent className="flex flex-col space-y-2 p-2">
            {pricingPlans.map(
              (plan, index) =>
                index !== selectedPlan && (
                  <Button
                    size="lg"
                    variant="secondary"
                    key={index}
                    onClick={() => {
                      onPlanChange(index);
                      setIsOpen(false);
                    }}
                  >
                    {plan.name}
                  </Button>
                ),
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Desktop View */}
      <div className="grid grid-cols-5 gap-4 max-md:hidden">
        <div className="col-span-1 max-md:hidden"></div>

        {pricingPlans.map((plan, index) => (
          <div key={index} className="">
            <h3 className="mb-3 text-2xl font-semibold">{plan.name}</h3>
            <Button variant={plan.button.variant} className="" asChild>
              <a href={plan.button.href}>{plan.button.text}</a>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

const FeatureSections = ({ selectedPlan }: { selectedPlan: number }) => (
  <>
    {comparisonFeatures.map((section, sectionIndex) => (
      <div key={sectionIndex} className="">
        <div className="border-primary/40 border-b py-4">
          <h3 className="text-lg font-semibold">{section.category}</h3>
        </div>
        {section.features.map((feature, featureIndex) => (
          <div
            key={featureIndex}
            className="text-foreground grid grid-cols-2 font-medium max-md:border-b md:grid-cols-5"
          >
            <span className="inline-flex items-center py-4">
              {feature.name}
            </span>
            {/* Mobile View - Only Selected Plan */}
            <div className="md:hidden">
              <div className="flex items-center gap-1 py-4 md:border-b">
                {renderFeatureValue(
                  [feature.free, feature.starter, feature.pro, feature.enterprise][
                    selectedPlan
                  ],
                )}
              </div>
            </div>
            {/* Desktop View - All Plans */}
            <div className="hidden md:col-span-4 md:grid md:grid-cols-4 md:gap-4">
              {[feature.free, feature.starter, feature.pro, feature.enterprise].map(
                (value, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 border-b py-4"
                  >
                    {renderFeatureValue(value)}
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    ))}
  </>
);
