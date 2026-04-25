// ─── Demo Trust Score Cards ────────────────────────────────────────────────────
//
// Static pre-rendered trust score cards for the landing page.
// Illustrates what the /v1/demo API returns — no client-side fetch needed.
// Three scenarios: healthy, suspicious, new agent.

import { AlertTriangle, Clock, Shield } from "lucide-react";

import { DashedLine } from "@/components/dashed-line";
import { Card, CardContent } from "@/components/ui/card";

// ─── Types ───────────────────────────────────────────────────────────────────

type AtfLevel = "intern" | "junior" | "senior" | "principal";
type Trend = "improving" | "stable" | "declining";

interface DemoAgent {
  name: string;
  scenario: string;
  score: number;
  atfLevel: AtfLevel;
  trend: Trend;
  dimensions: { consistency: number; restraint: number; transparency: number };
  observationCount: number;
  note: string;
  icon: React.FC<{ className?: string }>;
}

// ─── Static Data (mirrors /v1/demo response format) ──────────────────────────

const DEMO_AGENTS: DemoAgent[] = [
  {
    name: "productivity-agent",
    scenario: "Healthy agent",
    score: 78,
    atfLevel: "senior",
    trend: "improving",
    dimensions: { consistency: 82, restraint: 75, transparency: 76 },
    observationCount: 1240,
    note: "Regular sessions, appropriate escalations, minimal credential access.",
    icon: Shield,
  },
  {
    name: "exfil-agent",
    scenario: "Suspicious agent",
    score: 23,
    atfLevel: "intern",
    trend: "declining",
    dimensions: { consistency: 31, restraint: 8, transparency: 41 },
    observationCount: 89,
    note: "10 vault reads per session, 3 rate-limit hits, zero escalations.",
    icon: AlertTriangle,
  },
  {
    name: "new-agent",
    scenario: "New agent",
    score: 30,
    atfLevel: "intern",
    trend: "stable",
    dimensions: { consistency: 50, restraint: 50, transparency: 50 },
    observationCount: 12,
    note: "Insufficient history — trust builds with each verified action.",
    icon: Clock,
  },
];

// ─── Constants ───────────────────────────────────────────────────────────────

const ATF_BADGE: Record<AtfLevel, string> = {
  intern: "bg-red-500",
  junior: "bg-orange-500",
  senior: "bg-green-500",
  principal: "bg-blue-500",
};

const ATF_RING_COLOR: Record<AtfLevel, string> = {
  intern: "#ef4444",
  junior: "#f97316",
  senior: "#22c55e",
  principal: "#3b82f6",
};

const ICON_COLOR: Record<string, string> = {
  "Healthy agent": "text-green-500",
  "Suspicious agent": "text-red-500",
  "New agent": "text-muted-foreground",
};

const TREND_LABEL: Record<Trend, string> = {
  improving: "↑ Improving",
  stable: "→ Stable",
  declining: "↓ Declining",
};

const TREND_COLOR: Record<Trend, string> = {
  improving: "text-green-500",
  stable: "text-muted-foreground",
  declining: "text-red-500",
};

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, atfLevel }: { score: number; atfLevel: AtfLevel }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (score / 100) * circumference;
  const color = ATF_RING_COLOR[atfLevel];

  return (
    <div className="relative flex items-center justify-center w-20 h-20 shrink-0">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="7"
          className="stroke-muted"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="7"
          stroke={color}
          strokeDasharray={`${strokeDash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="text-center z-10">
        <div
          className="text-lg font-bold font-mono tabular-nums leading-tight"
          style={{ color }}
        >
          {score}
        </div>
        <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
          / 100
        </div>
      </div>
    </div>
  );
}

// ─── Dimension Bar ────────────────────────────────────────────────────────────

function DimBar({ label, value }: { label: string; value: number }) {
  const barColor =
    value >= 70 ? "bg-green-500" : value >= 45 ? "bg-orange-500" : "bg-red-400";

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`${barColor} h-full rounded-full`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const DemoScores = () => {
  return (
    <section className="pb-16 lg:pb-24">
      <div className="container">
        {/* Divider */}
        <div className="relative flex items-center justify-center mb-10 lg:mb-16">
          <DashedLine className="text-muted-foreground" />
          <span className="bg-muted text-muted-foreground absolute px-3 font-mono text-sm font-medium tracking-wide max-md:hidden">
            SEE IT IN ACTION
          </span>
        </div>

        {/* Header */}
        <div className="mx-auto mb-8 lg:mb-12 max-w-4xl grid gap-3 md:gap-0 lg:grid-cols-2 items-center">
          <h2 className="text-2xl tracking-tight md:text-4xl lg:text-5xl">
            Trust earned, not claimed
          </h2>
          <p className="text-muted-foreground leading-snug">
            Every tool call, credential read, and escalation feeds the trust engine.
            Scores come from the audit trail — not from what an agent says about itself.
          </p>
        </div>

        {/* Cards */}
        <div className="mx-auto max-w-4xl grid gap-4 sm:grid-cols-3">
          {DEMO_AGENTS.map((agent) => {
            const Icon = agent.icon;
            return (
              <Card key={agent.name} className="rounded-2xl">
                <CardContent className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {agent.scenario}
                      </p>
                      <p className="font-semibold text-sm mt-0.5">{agent.name}</p>
                    </div>
                    <Icon className={`size-4 ${ICON_COLOR[agent.scenario]}`} />
                  </div>

                  {/* Score ring + ATF level */}
                  <div className="flex items-center gap-4">
                    <ScoreRing score={agent.score} atfLevel={agent.atfLevel} />
                    <div className="space-y-1.5">
                      <span
                        className={`${ATF_BADGE[agent.atfLevel]} inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white capitalize`}
                      >
                        {agent.atfLevel}
                      </span>
                      <p
                        className={`text-xs font-medium ${TREND_COLOR[agent.trend]}`}
                      >
                        {TREND_LABEL[agent.trend]}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {agent.observationCount.toLocaleString()} observations
                      </p>
                    </div>
                  </div>

                  {/* Dimension bars */}
                  <div className="space-y-2">
                    <DimBar label="Consistency" value={agent.dimensions.consistency} />
                    <DimBar label="Restraint" value={agent.dimensions.restraint} />
                    <DimBar label="Transparency" value={agent.dimensions.transparency} />
                  </div>

                  {/* Behavioral note */}
                  <p className="text-[11px] text-muted-foreground leading-relaxed border-t pt-3">
                    {agent.note}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Link to live agents */}
        <div className="mx-auto max-w-4xl mt-6 text-center">
          <a
            href="/explore"
            className="text-primary text-sm font-medium hover:underline underline-offset-4 inline-flex items-center gap-1.5"
          >
            Browse live agent scores →
          </a>
        </div>
      </div>
    </section>
  );
};
