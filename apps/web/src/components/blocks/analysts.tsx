// ─── Analyst Validation Section ─────────────────────────────────────────────
//
// Deloitte governance gap stats + Forrester AEGIS framework as third-party
// validation that cross-org behavioral monitoring is the missing enterprise layer.
//
// Sources:
//   Deloitte "State of AI in the Enterprise", Jan 2026, n=3,235, 24 countries
//   Forrester AEGIS Framework, Aug 2025 — "least agency" principle

import { DashedLine } from "@/components/dashed-line";

const STATS = [
  {
    value: "74%",
    label: "of enterprises expect to use AI agents by 2027",
    context: "n=3,235 across 24 countries",
  },
  {
    value: "21%",
    label: "have mature governance in place for those agents",
    context: "The other 79% are running blind.",
  },
];

const DELOITTE_SOURCE = {
  label: "Deloitte State of AI in the Enterprise, Jan 2026",
  url: "https://www.deloitte.com/us/en/what-we-do/capabilities/applied-artificial-intelligence/content/state-of-ai-in-the-enterprise.html",
};

const AEGIS = {
  title: "Forrester AEGIS Framework (Aug 2025)",
  body: `Forrester's enterprise security framework for agentic AI names "least agency" as a core principle — constraining what agents can do based on observed behavior, not claimed intent. Six domains. Thirty-nine controls. The governance layer most enterprises are still missing.`,
  url: "https://www.forrester.com/report/introducing-forresters-aegis-framework-agentic-ai-enterprise-guardrails-for-information-security/RES185394",
};

export const Analysts = () => {
  return (
    <section className="pb-16 lg:pb-24">
      <div className="container">
        {/* Divider */}
        <div className="relative flex items-center justify-center mb-10 lg:mb-16">
          <DashedLine className="text-muted-foreground" />
          <span className="bg-muted text-muted-foreground absolute px-3 font-mono text-sm font-medium tracking-wide max-md:hidden">
            ANALYST CONTEXT
          </span>
        </div>

        {/* Header */}
        <div className="mx-auto mb-10 lg:mb-14 max-w-4xl grid gap-3 md:gap-0 lg:grid-cols-2 items-center">
          <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
            Agents are scaling faster than governance
          </h2>
          <p className="text-muted-foreground leading-snug">
            The adoption-governance gap is not a prediction — it's already measured.
            Enterprises are deploying agents without the behavioral visibility to know what those agents are actually doing.
          </p>
        </div>

        {/* Stat blocks */}
        <div className="mx-auto max-w-4xl grid gap-4 sm:grid-cols-2 mb-6">
          {STATS.map((s) => (
            <div
              key={s.value}
              className="rounded-2xl border bg-card p-8 md:p-10 flex flex-col gap-3"
            >
              <p className="text-primary font-mono text-5xl font-bold tracking-tight lg:text-6xl">
                {s.value}
              </p>
              <p className="text-foreground font-semibold leading-snug text-lg">
                {s.label}
              </p>
              <p className="text-muted-foreground text-sm">{s.context}</p>
            </div>
          ))}
        </div>

        {/* Deloitte citation */}
        <div className="mx-auto max-w-4xl mb-10 text-right">
          <a
            href={DELOITTE_SOURCE.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
          >
            {DELOITTE_SOURCE.label} ↗
          </a>
        </div>

        {/* Forrester AEGIS callout */}
        <div className="mx-auto max-w-4xl rounded-2xl border bg-card p-8 md:p-10">
          <div className="flex flex-col gap-4 md:flex-row md:gap-8 md:items-start">
            <div className="shrink-0">
              <span className="bg-primary/10 text-primary font-mono text-xs font-semibold px-3 py-1.5 rounded-full">
                FORRESTER
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <p className="font-semibold text-foreground text-base md:text-lg leading-snug">
                {AEGIS.title}
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {AEGIS.body}
              </p>
              <a
                href={AEGIS.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-xs font-mono hover:underline underline-offset-4 self-start"
              >
                Read the framework ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
