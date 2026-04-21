// ─── Trust Score Explorer ────────────────────────────────────────────────────
//
// Public trust score explorer. Fetches from /badge/:agentId/score.json (no auth).
// Featured agent: Pico (acc_qgdxSULsXsmtHklZ) — the first AI agent on AgentLair.

"use client";
import { useEffect, useState } from "react";
import { Background } from "@/components/background";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DimensionData {
  score: number;
  confidence: number;
}

interface TrustScore {
  agentId: string;
  score: number;
  confidence: number;
  atfLevel: "intern" | "junior" | "senior" | "principal";
  trend: "improving" | "stable" | "declining";
  dimensions: {
    consistency: DimensionData;
    restraint: DimensionData;
    transparency: DimensionData;
  };
  observationCount: number;
  computedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FEATURED_AGENT_ID = "acc_qgdxSULsXsmtHklZ";
const API_BASE = "https://api.agentlair.dev";

const ATF_LABEL: Record<string, string> = {
  intern: "Intern",
  junior: "Junior",
  senior: "Senior",
  principal: "Principal",
};

const ATF_COLOR: Record<string, string> = {
  intern: "bg-red-500",
  junior: "bg-orange-500",
  senior: "bg-green-500",
  principal: "bg-blue-500",
};

const TREND_LABEL: Record<string, string> = {
  improving: "↑ Improving",
  stable: "→ Stable",
  declining: "↓ Declining",
};

const TREND_COLOR: Record<string, string> = {
  improving: "text-green-500",
  stable: "text-muted-foreground",
  declining: "text-red-500",
};

const DIMENSION_LABEL: Record<string, string> = {
  consistency: "Consistency",
  restraint: "Restraint",
  transparency: "Transparency",
};

const DIMENSION_DESCRIPTION: Record<string, string> = {
  consistency: "Session regularity, tool stability, and error patterns",
  restraint: "Scope discipline, credential hygiene, and escalation appropriateness",
  transparency: "Audit coverage, chain integrity, and telemetry reporting",
};

// ─── Score Gauge ─────────────────────────────────────────────────────────────

function ScoreGauge({ score, atfLevel }: { score: number; atfLevel: string }) {
  const pct = Math.min(100, Math.max(0, score));
  const radius = 80;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  // Arc spans 240° (from 150° to 390°, so bottom 120° is empty)
  const arc = circumference * (240 / 360);
  const filled = arc * (pct / 100);
  const offset = circumference * (150 / 360); // rotate start point

  const colorMap: Record<string, string> = {
    intern: "#ef4444",
    junior: "#f97316",
    senior: "#22c55e",
    principal: "#3b82f6",
  };
  const color = colorMap[atfLevel] ?? "#f97316";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="200" height="160" viewBox="0 0 200 160" className="overflow-visible">
          {/* Track */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeDasharray={`${arc} ${circumference - arc}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            className="text-muted/30"
            style={{ transform: "rotate(0deg)", transformOrigin: "100px 100px" }}
          />
          {/* Fill */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={`${filled} ${circumference - filled}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            style={{
              transform: "rotate(0deg)",
              transformOrigin: "100px 100px",
              transition: "stroke-dasharray 1s ease",
            }}
          />
          {/* Score number */}
          <text
            x="100"
            y="98"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground"
            style={{ fontSize: "2.5rem", fontWeight: 800, fontFamily: "inherit" }}
          >
            {score}
          </text>
          <text
            x="100"
            y="118"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            style={{ fontSize: "0.7rem", fontFamily: "inherit" }}
          >
            / 100
          </text>
        </svg>
      </div>
    </div>
  );
}

// ─── Dimension Bar ────────────────────────────────────────────────────────────

function DimensionBar({
  name,
  score,
  confidence,
}: {
  name: string;
  score: number;
  confidence: number;
}) {
  const pct = Math.min(100, Math.max(0, score));

  const barColor =
    score >= 70
      ? "bg-green-500"
      : score >= 45
        ? "bg-orange-500"
        : "bg-red-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-sm font-semibold">
          {DIMENSION_LABEL[name] ?? name}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {score}
          <span className="text-muted-foreground/60 ml-1 text-[10px]">
            / 100
          </span>
        </span>
      </div>
      <div className="bg-muted/40 h-2 w-full overflow-hidden rounded-full">
        <div
          className={`${barColor} h-full rounded-full transition-all duration-1000`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {DIMENSION_DESCRIPTION[name]}
        <span className="ml-2 opacity-60">
          ({Math.round(confidence * 100)}% confidence)
        </span>
      </p>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex flex-col items-center gap-4">
        <div className="bg-muted h-40 w-48 rounded-full" />
        <div className="bg-muted h-6 w-32 rounded" />
      </div>
      <div className="grid gap-4">
        {["consistency", "restraint", "transparency"].map((d) => (
          <div key={d} className="space-y-2">
            <div className="bg-muted h-4 w-28 rounded" />
            <div className="bg-muted h-2 w-full rounded-full" />
            <div className="bg-muted h-3 w-64 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Explore() {
  const [data, setData] = useState<TrustScore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/badge/${FEATURED_AGENT_ID}/score.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TrustScore>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  return (
    <>
      <Background>
        <PageHeader
          title="Agent Trust Score Explorer"
          description="Real behavioral trust scores for AI agents — computed from audit trails, not self-reports."
          badges={["Live", "Public"]}
        />
      </Background>

      <section className="pb-28 lg:pb-32">
        <div className="container max-w-3xl space-y-12">

          {/* What is this */}
          <div className="space-y-3">
            <h2 className="text-foreground text-xl font-bold">What is an agent trust score?</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              AgentLair&apos;s trust engine analyzes every action an AI agent takes — tool calls, credential usage, escalation patterns, audit trail integrity — and computes a behavioral trust score from 0 to 100. The score is derived from three dimensions: how <strong className="text-foreground">consistent</strong> the agent behaves, how much <strong className="text-foreground">restraint</strong> it exercises, and how <strong className="text-foreground">transparent</strong> its actions are.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Trust is earned by doing. It cannot be set by a developer or claimed by an agent — it&apos;s measured from the audit trail.
            </p>
          </div>

          {/* Featured agent */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-foreground text-xl font-bold">Featured: Pico</h2>
              <a
                href={`/badge/${FEATURED_AGENT_ID}`}
                className="text-muted-foreground hover:text-primary text-xs underline underline-offset-4 transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                Embed badge →
              </a>
            </div>
            <p className="text-muted-foreground text-sm">
              Pico is the first AI agent on AgentLair — a Claude-based autonomous agent that has been building AgentLair itself. Below is its live trust profile, computed from {data ? data.observationCount.toLocaleString() : "5,000+"} audit events.
            </p>

            <Card>
              <CardContent className="space-y-8 py-6">
                {loading && <LoadingSkeleton />}

                {error && (
                  <div className="text-muted-foreground rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm">
                    Failed to load trust score: {error}. Try refreshing.
                  </div>
                )}

                {data && (
                  <>
                    {/* Score + metadata */}
                    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-8">
                      <div className="shrink-0">
                        <ScoreGauge score={data.score} atfLevel={data.atfLevel} />
                      </div>
                      <div className="flex-1 space-y-4 text-center sm:text-left">
                        <div>
                          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                            <span
                              className={`${ATF_COLOR[data.atfLevel]} rounded-full px-3 py-1 text-xs font-bold text-white`}
                            >
                              {ATF_LABEL[data.atfLevel]} Agent
                            </span>
                            <span
                              className={`text-sm font-semibold ${TREND_COLOR[data.trend]}`}
                            >
                              {TREND_LABEL[data.trend]}
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-2 text-sm">
                            Based on{" "}
                            <strong className="text-foreground">
                              {data.observationCount.toLocaleString()}
                            </strong>{" "}
                            audit events with{" "}
                            <strong className="text-foreground">
                              {(data.confidence * 100).toFixed(1)}%
                            </strong>{" "}
                            confidence.
                          </p>
                        </div>

                        <div className="grid grid-cols-3 gap-3 text-center">
                          {(["consistency", "restraint", "transparency"] as const).map((dim) => (
                            <div key={dim}>
                              <div className="text-foreground text-xl font-extrabold">
                                {data.dimensions[dim].score}
                              </div>
                              <div className="text-muted-foreground text-[10px] capitalize">
                                {dim}
                              </div>
                            </div>
                          ))}
                        </div>

                        <p className="text-muted-foreground text-[11px]">
                          Agent ID:{" "}
                          <code className="bg-muted rounded px-1 font-mono text-[10px]">
                            {data.agentId}
                          </code>
                        </p>
                      </div>
                    </div>

                    {/* Dimensional breakdown */}
                    <div className="space-y-5">
                      <h3 className="text-foreground text-sm font-semibold">
                        Dimensional Breakdown
                      </h3>
                      {(["consistency", "restraint", "transparency"] as const).map((dim) => (
                        <DimensionBar
                          key={dim}
                          name={dim}
                          score={data.dimensions[dim].score}
                          confidence={data.dimensions[dim].confidence}
                        />
                      ))}
                    </div>

                    {/* Computed at */}
                    <p className="text-muted-foreground text-right text-[11px]">
                      Computed{" "}
                      {new Date(data.computedAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* How scores work */}
          <div className="space-y-4">
            <h2 className="text-foreground text-xl font-bold">ATF Maturity Levels</h2>
            <p className="text-muted-foreground text-sm">
              The Agent Trust Framework (ATF) defines four maturity levels — Intern, Junior, Senior, and Principal. Levels are determined by overall score, confidence, and observation history.
            </p>
            <Card>
              <CardContent className="divide-y p-0">
                {[
                  {
                    level: "Principal",
                    color: "bg-blue-500",
                    score: "80+",
                    description: "Highly trusted. Consistent, restrained, fully transparent behavior over many observations.",
                  },
                  {
                    level: "Senior",
                    color: "bg-green-500",
                    score: "60–79",
                    description: "Trusted for most autonomous tasks. Some variance in behavioral dimensions.",
                  },
                  {
                    level: "Junior",
                    color: "bg-orange-500",
                    score: "40–59",
                    description: "Limited trust. Suitable for low-stakes tasks with human oversight.",
                  },
                  {
                    level: "Intern",
                    color: "bg-red-500",
                    score: "0–39",
                    description: "Minimal trust. Insufficient observation history or problematic behavioral patterns.",
                  },
                ].map((item) => (
                  <div key={item.level} className="flex items-start gap-4 px-6 py-4">
                    <span
                      className={`${item.color} mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white`}
                    >
                      {item.level}
                    </span>
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-xs font-semibold tabular-nums">
                        Score: {item.score}
                      </div>
                      <p className="text-muted-foreground text-sm">{item.description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Public API */}
          <div className="space-y-4">
            <h2 className="text-foreground text-xl font-bold">Public API</h2>
            <p className="text-muted-foreground text-sm">
              Trust scores are publicly readable — no API key required for the score endpoint.
            </p>
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">GET</code>
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs break-all">
                    https://api.agentlair.dev/badge/{"{agentId}"}/score.json
                  </code>
                </div>
                <p className="text-muted-foreground text-xs">
                  Returns JSON with score, ATF level, dimensional breakdown, and observation count. No authentication required. Cached for 5 minutes.
                </p>
                <a
                  href={`https://api.agentlair.dev/badge/${FEATURED_AGENT_ID}/score.json`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary text-xs underline underline-offset-4"
                >
                  Try it: Pico&apos;s score.json →
                </a>
              </CardContent>
            </Card>
          </div>

          {/* CTA */}
          <div className="space-y-4 text-center">
            <h2 className="text-foreground text-xl font-bold">
              Build agents that earn trust.
            </h2>
            <p className="text-muted-foreground text-sm">
              Connect your agent to AgentLair to start accumulating trust. Every action is recorded. Every audit event counts.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="/getting-started"
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-3 text-sm font-semibold transition-colors"
              >
                Get API Key — Free →
              </a>
              <a
                href="/thesis"
                className="border-border text-foreground hover:border-primary/50 hover:text-primary rounded-lg border px-6 py-3 text-sm font-semibold transition-colors"
              >
                Read the Trust Thesis
              </a>
            </div>
            <p className="text-muted-foreground text-xs">
              <a href="/badge" className="text-primary underline underline-offset-4">
                Trust badges for GitHub READMEs
              </a>{" "}
              ·{" "}
              <a href="/vault" className="text-primary underline underline-offset-4">
                Credential Vault
              </a>{" "}
              ·{" "}
              <a href="/docs" className="text-primary underline underline-offset-4">
                Documentation
              </a>
            </p>
          </div>

        </div>
      </section>
    </>
  );
}
