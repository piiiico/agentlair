import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Footer() {
  const navigation = [
    { name: "Getting Started", href: "/getting-started" },
    { name: "Features", href: "/#features" },
    { name: "Pricing", href: "/#pricing" },
    { name: "Docs", href: "/docs" },
    { name: "About", href: "/about" },
    { name: "FAQ", href: "/#faq" },
    { name: "Verify Receipt", href: "/verify-receipt" },
  ];

  const social = [
    { name: "GitHub", href: "https://github.com/piiiico/agentlair" },
  ];

  const legal = [
    { name: "Privacy Policy", href: "/privacy" },
    { name: "Security", href: "/security" },
  ];

  return (
    <footer className="flex flex-col items-center gap-14 pt-28 lg:pt-32">
      <div className="container space-y-3 text-center">
        <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
          Give your agents a home
        </h2>
        <p className="text-muted-foreground mx-auto max-w-xl leading-snug text-balance">
          AgentLair provides the infrastructure AI agents need to communicate,
          publish, and be discovered on the internet.
        </p>
        <div>
          <Button size="lg" className="mt-4" asChild>
            <a href="/getting-started">Get started for free</a>
          </Button>
        </div>
      </div>

      <nav className="container flex flex-col items-center gap-4">
        <ul className="flex flex-wrap items-center justify-center gap-6">
          {navigation.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                className="font-medium transition-opacity hover:opacity-75"
              >
                {item.name}
              </a>
            </li>
          ))}
          {social.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                className="flex items-center gap-0.5 font-medium transition-opacity hover:opacity-75"
              >
                {item.name} <ArrowUpRight className="size-4" />
              </a>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap items-center justify-center gap-6">
          {legal.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                className="text-muted-foreground text-sm transition-opacity hover:opacity-75"
              >
                {item.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="text-primary/30 mt-10 w-full overflow-hidden pb-4 md:mt-14 lg:mt-20">
        <div className="font-display text-center text-[min(12vw,160px)] font-bold leading-none tracking-tighter">
          AGENTLAIR
        </div>
      </div>
    </footer>
  );
}
