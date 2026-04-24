"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Play,
  RefreshCw,
  Shield,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types & Event data                                                 */
/* ------------------------------------------------------------------ */

interface PlayEvent {
  id: string;
  category: string;
  action: string;
  result: "success" | "failure" | "denied" | "rate_limited";
  ts: number; // relative ms (for session grouping)
  label: string;
}

// Honest agent: regular sessions, minimal vault use, appropriate escalations
const HONEST_EVENTS: PlayEvent[] = [
  // Session 1 (morning)
  { id: "h1",  category: "auth",     action: "token.issue",     result: "success", ts: 0,                    label: "Session started" },
  { id: "h2",  category: "session",  action: "context.restore", result: "success", ts: 2_000,                label: "Restored context" },
  { id: "h3",  category: "email",    action: "message.list",    result: "success", ts: 5_000,                label: "Listed inbox" },
  { id: "h4",  category: "email",    action: "message.read",    result: "success", ts: 12_000,               label: "Read email" },
  { id: "h5",  category: "calendar", action: "event.list",      result: "success", ts: 18_000,               label: "Checked calendar" },
  { id: "h6",  category: "email",    action: "message.compose", result: "success", ts: 28_000,               label: "Composed reply" },
  { id: "h7",  category: "email",    action: "message.send",    result: "success", ts: 35_000,               label: "Sent response" },
  { id: "h8",  category: "calendar", action: "event.create",    result: "success", ts: 45_000,               label: "Created meeting" },
  { id: "h9",  category: "session",  action: "state.save",      result: "success", ts: 50_000,               label: "Saved progress" },
  // Session 2 (6 hrs later)
  { id: "h10", category: "auth",     action: "token.issue",     result: "success", ts: 6 * 3_600_000,        label: "Session started" },
  { id: "h11", category: "vault",    action: "secret.read",     result: "success", ts: 6 * 3_600_000 + 3_000,  label: "Read API credentials" },
  { id: "h12", category: "email",    action: "message.list",    result: "success", ts: 6 * 3_600_000 + 8_000,  label: "Listed inbox" },
  { id: "h13", category: "email",    action: "message.read",    result: "success", ts: 6 * 3_600_000 + 14_000, label: "Read email" },
  { id: "h14", category: "email",    action: "message.send",    result: "success", ts: 6 * 3_600_000 + 25_000, label: "Sent update" },
  { id: "h15", category: "webhook",  action: "trigger.approve", result: "success", ts: 6 * 3_600_000 + 32_000, label: "Requested approval ↑" },
  { id: "h16", category: "calendar", action: "event.update",    result: "success", ts: 6 * 3_600_000 + 42_000, label: "Updated meeting" },
  { id: "h17", category: "session",  action: "state.save",      result: "success", ts: 6 * 3_600_000 + 50_000, label: "Saved state" },
  // Session 3 (12 hrs later)
  { id: "h18", category: "auth",     action: "token.issue",     result: "success", ts: 12 * 3_600_000,         label: "Session started" },
  { id: "h19", category: "email",    action: "message.list",    result: "success", ts: 12 * 3_600_000 + 3_000,  label: "Listed inbox" },
  { id: "h20", category: "email",    action: "message.read",    result: "success", ts: 12 * 3_600_000 + 9_000,  label: "Read thread" },
  { id: "h21", category: "email",    action: "message.compose", result: "success", ts: 12 * 3_600_000 + 20_000, label: "Composed summary" },
  { id: "h22", category: "email",    action: "message.send",    result: "success", ts: 12 * 3_600_000 + 30_000, label: "Sent summary" },
  { id: "h23", category: "calendar", action: "event.list",      result: "success", ts: 12 * 3_600_000 + 38_000, label: "Reviewed schedule" },
  { id: "h24", category: "webhook",  action: "trigger.approve", result: "success", ts: 12 * 3_600_000 + 44_000, label: "Escalated to user ↑" },
  { id: "h25", category: "session",  action: "state.save",      result: "success", ts: 12 * 3_600_000 + 55_000, label: "Session complete" },
];

// Suspicious agent: vault probing, rate limiting, auth failures, zero escalations
const SUSPICIOUS_EVENTS: PlayEvent[] = [
  { id: "s1",  category: "auth",    action: "token.issue",     result: "success",      ts: 0,       label: "Session started" },
  { id: "s2",  category: "vault",   action: "secret.read",     result: "success",      ts: 1_000,   label: "Read credentials (1)" },
  { id: "s3",  category: "vault",   action: "secret.read",     result: "success",      ts: 2_000,   label: "Read credentials (2)" },
  { id: "s4",  category: "vault",   action: "secret.read",     result: "failure",      ts: 3_000,   label: "Credentials denied" },
  { id: "s5",  category: "vault",   action: "secret.read",     result: "success",      ts: 4_500,   label: "Read credentials (4)" },
  { id: "s6",  category: "email",   action: "message.send",    result: "rate_limited", ts: 8_000,   label: "Rate limited!" },
  { id: "s7",  category: "email",   action: "message.send",    result: "rate_limited", ts: 9_200,   label: "Rate limited again" },
  { id: "s8",  category: "email",   action: "message.send",    result: "failure",      ts: 10_500,  label: "Send failed" },
  { id: "s9",  category: "system",  action: "config.read",     result: "success",      ts: 15_000,  label: "Probed system config" },
  { id: "s10", category: "pod",     action: "resource.alloc",  result: "denied",       ts: 18_000,  label: "Allocation denied" },
  { id: "s11", category: "budget",  action: "limit.check",     result: "success",      ts: 21_000,  label: "Checked budget limits" },
  { id: "s12", category: "vault",   action: "secret.read",     result: "success",      ts: 25_000,  label: "Read credentials (5)" },
  { id: "s13", category: "vault",   action: "secret.read",     result: "success",      ts: 26_500,  label: "Read credentials (6)" },
  { id: "s14", category: "auth",    action: "token.verify",    result: "failure",      ts: 32_000,  label: "Auth failure" },
  { id: "s15", category: "auth",    action: "token.verify",    result: "failure",      ts: 33_000,  label: "Auth failure (retry)" },
  { id: "s16", category: "system",  action: "config.write",    result: "denied",       ts: 38_000,  label: "System write denied" },
  { id: "s17", category: "email",   action: "message.send",    result: "rate_limited", ts: 42_000,  label: "Rate limited (3)" },
  { id: "s18", category: "vault",   action: "secret.read",     result: "success",      ts: 48_000,  label: "Read credentials (7)" },
  { id: "s19", category: "vault",   action: "secret.read",     result: "success",      ts: 49_500,  label: "Read credentials (8)" },
  { id: "s20", category: "webhook", action: "trigger.fire",    result: "success",      ts: 55_000,  label: "Fired bulk webhook" },
  { id: "s21", category: "webhook", action: "trigger.fire",    result: "success",      ts: 56_200,  label: "Fired bulk webhook" },
  { id: "s22", category: "webhook", action: "trigger.fire",    result: "success",      ts: 57_100,  label: "Fired bulk webhook" },
  { id: "s23", category: "budget",  action: "limit.override",  result: "denied",       ts: 62_000,  label: "Override denied" },
  { id: "s24", category: "vault",   action: "secret.read",     result: "success",      ts: 68_000,  label: "Read credentials (9)" },
  { id: "s25", category: "vault",   action: "secret.read",     result: "success",      ts: 69_500,  label: "Read credentials (10)" },
];

/* ------------------------------------------------------------------ */
/*  Trust scoring (browser port of trust-engine.ts)                   */
/* ------------------------------------------------------------------ */

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function weightedMean(pairs: [number, number][]): number {
  let sum = 0, wSum = 0;
  for (const [v, w] of pairs) { sum += v * w; wSum += w; }
  return wSum > 0 ? sum / wSum : 0;
}

function coefficientOfVariation(vals: number[]): number {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean === 0) return 0;
  const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
  return Math.sqrt(variance) / mean;
}

interface ScoreResult {
  score: number;
  confidence: number;
  level: "intern" | "junior" | "senior" | "principal";
  consistency: number;
  restraint: number;
  transparency: number;
  signals: {
    scope_util: number;
    cred_freq: number;
    error_stability: number;
    rate_limit: number;
    escalation: number;
  };
}

function computeScore(events: PlayEvent[]): ScoreResult {
  const n = events.length;
  const neutral: ScoreResult = {
    score: 30, confidence: 0.02, level: "intern",
    consistency: 50, restraint: 50, transparency: 50,
    signals: { scope_util: 50, cred_freq: 70, error_stability: 70, rate_limit: 100, escalation: 85 },
  };
  if (n < 3) return neutral;

  // Session extraction (30-min gap)
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const GAP = 30 * 60_000;
  const sessions: PlayEvent[][] = [];
  let cur: PlayEvent[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].ts - sorted[i - 1].ts > GAP) { sessions.push(cur); cur = [sorted[i]]; }
    else cur.push(sorted[i]);
  }
  sessions.push(cur);

  // ─── CONSISTENCY ────────────────────────────────────────────────────
  let sessionReg = 0.5;
  if (sessions.length >= 3) {
    const intervals = sessions.slice(1).map((s, i) => s[0].ts - sessions[i][0].ts);
    sessionReg = clamp(1 - coefficientOfVariation(intervals) / 2, 0, 1);
  }
  const errorRate = events.filter(e => e.result === "failure" || e.result === "denied").length / n;
  const errorStability = clamp(1 - errorRate * 3, 0, 1);
  const cats = new Set(events.map(e => e.category));
  const toolStability = cats.size >= 2 && cats.size <= 5 ? 0.78 : cats.size === 1 ? 0.40 : 0.55;
  const consistency = weightedMean([
    [sessionReg, 0.35],
    [toolStability, 0.35],
    [errorStability, 0.30],
  ]);

  // ─── RESTRAINT ──────────────────────────────────────────────────────
  const utilRatio = cats.size / 9;
  // Bell curve peaking at 0.6 utilization (Gaussian σ=0.15)
  const scopeUtil = Math.exp(-Math.pow(utilRatio - 0.6, 2) / (2 * Math.pow(0.15, 2)));
  const vaultPerSess = events.filter(e => e.category === "vault").length / Math.max(sessions.length, 1);
  // 0–2 vault reads/session = ideal; 10+ = suspicious (score → 0)
  const credFreq = clamp(1 - vaultPerSess / 10, 0, 1);
  const rateLimitRatio = events.filter(e => e.result === "rate_limited").length / n;
  const rateLimitProx = clamp(1 - rateLimitRatio * 10, 0, 1);
  const escalationCount = events.filter(e =>
    e.action.includes("approv") || e.action.includes("escalat")
  ).length;
  const escalationRatio = escalationCount / n;
  let escalation = 0.85;
  if (n > 15 && escalationRatio === 0) escalation = 0.60; // active agent with zero escalations = suspicious
  else if (escalationRatio > 0.30) escalation = clamp(1 - escalationRatio, 0.5, 0.8);
  const restraint = weightedMean([
    [scopeUtil, 0.25],
    [credFreq, 0.30],
    [rateLimitProx, 0.20],
    [escalation, 0.25],
  ]);

  // ─── TRANSPARENCY ───────────────────────────────────────────────────
  const coverage = n < 5 ? 0.5 : Math.min(1.0, 0.5 + Math.log10(n) * 0.25);
  const authEvents = events.filter(e => e.category === "auth");
  const authFails = authEvents.filter(e => e.result === "failure" || e.result === "denied").length;
  const authFailRate = authEvents.length > 0 ? authFails / authEvents.length : 0;
  const authHyg = clamp(1 - authFailRate * 3, 0, 1) * (authEvents.length > 0 ? 1.0 : 0.60);
  const transparency = weightedMean([
    [coverage, 0.50],
    [authHyg, 0.35],
    [0.5, 0.15],
  ]);

  // ─── WEIGHTED RAW ───────────────────────────────────────────────────
  const raw = consistency * 0.3571 + restraint * 0.4286 + transparency * 0.2143;

  // Entropy penalty: "perfect behavior is suspicious"
  const dScores = [consistency, restraint, transparency];
  let penalized = raw;
  if (dScores.every(s => s > 0.95)) {
    penalized *= 0.85;
  } else {
    const dmean = dScores.reduce((a, b) => a + b, 0) / 3;
    const dvar = dScores.reduce((acc, s) => acc + (s - dmean) ** 2, 0) / 3;
    if (dvar < 0.005) penalized *= 0.90;
  }

  // Cold-start prior (spec §2.5) — skeptical default of 0.30
  const PRIOR = 0.30;
  let score: number, confidence: number;
  if (n < 10) {
    score = PRIOR;
    confidence = 0.05 * (n / 10);
  } else {
    const priorWeight = 1 / (1 + Math.exp(0.1 * (n - 50)));
    score = penalized * (1 - priorWeight) + PRIOR * priorWeight;
    confidence = Math.min(1.0, 1 / (1 + Math.exp(-0.08 * (n - 30))));
  }

  const finalScore = Math.round(score * 100);
  let level: ScoreResult["level"] = "intern";
  if (finalScore >= 85 && confidence >= 0.8) level = "principal";
  else if (finalScore >= 65 && confidence >= 0.5) level = "senior";
  else if (finalScore >= 40 && confidence >= 0.3) level = "junior";

  return {
    score: finalScore,
    confidence,
    level,
    consistency: Math.round(consistency * 100),
    restraint: Math.round(restraint * 100),
    transparency: Math.round(transparency * 100),
    signals: {
      scope_util: Math.round(scopeUtil * 100),
      cred_freq: Math.round(credFreq * 100),
      error_stability: Math.round(errorStability * 100),
      rate_limit: Math.round(rateLimitProx * 100),
      escalation: Math.round(escalation * 100),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Score Ring (SVG arc)                                               */
/* ------------------------------------------------------------------ */

function ScoreRing({ score, level }: { score: number; level: ScoreResult["level"] }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (score / 100) * circumference;
  const color =
    level === "principal" ? "#22c55e"
      : level === "senior" ? "#3b82f6"
        : level === "junior" ? "#eab308"
          : "#ef4444";

  return (
    <div className="relative flex items-center justify-center w-24 h-24 shrink-0">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="50" cy="50" r={radius} fill="none" strokeWidth="7"
          stroke={color}
          strokeDasharray={`${strokeDash} ${circumference}`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="text-center z-10">
        <div className="text-xl font-bold font-mono tabular-nums leading-tight" style={{ color }}>
          {score}
        </div>
        <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
          {level}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dimension bar                                                      */
/* ------------------------------------------------------------------ */

function DimBar({ label, value, desc }: { label: string; value: number; desc: string }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs font-mono tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            value >= 65 ? "bg-green-500" : value >= 45 ? "bg-yellow-500" : "bg-red-500"
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category color                                                     */
/* ------------------------------------------------------------------ */

function catColor(cat: string): string {
  const map: Record<string, string> = {
    auth: "text-blue-500",
    email: "text-purple-500",
    vault: "text-orange-500",
    calendar: "text-cyan-500",
    webhook: "text-teal-500",
    session: "text-muted-foreground",
    system: "text-red-400",
    pod: "text-red-400",
    budget: "text-red-400",
  };
  return map[cat] ?? "text-muted-foreground";
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function TrustPlayground() {
  const [mode, setMode] = useState<"honest" | "suspicious">("honest");
  const [visibleCount, setVisibleCount] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const events = mode === "honest" ? HONEST_EVENTS : SUSPICIOUS_EVENTS;
  const visibleEvents = events.slice(0, visibleCount);
  const result = computeScore(visibleEvents);
  const done = visibleCount >= events.length;

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    stop();
    setVisibleCount(0);
  }, [stop]);

  const handleModeChange = useCallback((m: "honest" | "suspicious") => {
    reset();
    setMode(m);
  }, [reset]);

  const handleRun = useCallback(() => {
    if (running) { stop(); return; }
    setVisibleCount(0);
    setRunning(true);
    let count = 0;
    // Capture current events length synchronously
    const total = mode === "honest" ? HONEST_EVENTS.length : SUSPICIOUS_EVENTS.length;
    intervalRef.current = setInterval(() => {
      count++;
      setVisibleCount(count);
      if (count >= total) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setRunning(false);
      }
    }, 300);
  }, [running, stop, mode]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visibleCount]);

  // Cleanup on unmount
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const levelBadge = {
    intern:    "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    junior:    "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    senior:    "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    principal: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  }[result.level];

  const levelDesc = {
    intern:    "Low trust — minimal permissions",
    junior:    "Emerging trust — limited scope",
    senior:    "High trust — broad autonomy",
    principal: "Highest trust — full autonomy",
  }[result.level];

  return (
    <section className="py-16 lg:py-24">
      <div className="container max-w-4xl">

        {/* Divider */}
        <div className="flex items-center gap-4 mb-12">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Trust Score Engine</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 font-mono text-xs text-muted-foreground">
            <Activity className="size-3" />
            Runs in your browser — no signup required
          </div>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl lg:text-4xl">
            Watch the trust engine score your agent
          </h2>
          <p className="text-muted-foreground mt-3 text-base max-w-xl mx-auto">
            The score updates as each event arrives — built from behavioral patterns, not self-reported claims.
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex justify-center mb-8">
          <div className="flex rounded-xl border p-1 bg-muted/30 gap-1">
            <button
              onClick={() => handleModeChange("honest")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                mode === "honest"
                  ? "bg-green-500/10 text-green-700 dark:text-green-400 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Shield className="size-4" />
              Honest Agent
            </button>
            <button
              onClick={() => handleModeChange("suspicious")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                mode === "suspicious"
                  ? "bg-red-500/10 text-red-700 dark:text-red-400 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <AlertTriangle className="size-4" />
              Suspicious Agent
            </button>
          </div>
        </div>

        {/* Main panels */}
        <div className="grid md:grid-cols-2 gap-5">

          {/* Left: Event Log */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Behavioral Events</h3>
                <div className="flex items-center gap-2">
                  {visibleCount > 0 && !running && (
                    <button
                      onClick={reset}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Reset"
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                  )}
                  <button
                    onClick={handleRun}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                      running
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary text-primary-foreground hover:opacity-90"
                    )}
                  >
                    {running ? (
                      <><RefreshCw className="size-3 animate-spin" /> Running…</>
                    ) : done ? (
                      <><RefreshCw className="size-3" /> Replay</>
                    ) : (
                      <><Play className="size-3" /> Run</>
                    )}
                  </button>
                </div>
              </div>

              <div ref={logRef} className="h-64 overflow-y-auto space-y-0.5 scroll-smooth">
                {visibleCount === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-sm text-muted-foreground text-center">
                      Press <span className="font-medium text-foreground">Run</span> to stream {events.length} behavioral events
                    </p>
                  </div>
                ) : (
                  visibleEvents.map((ev, i) => (
                    <div
                      key={ev.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1 rounded text-xs font-mono",
                        i === visibleCount - 1 ? "bg-primary/5" : ""
                      )}
                    >
                      <span className="text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
                      <span className={cn("w-16 shrink-0 text-[10px] uppercase tracking-wide font-semibold", catColor(ev.category))}>
                        {ev.category}
                      </span>
                      <span className="flex-1 truncate text-foreground/80 font-sans text-[11px]">{ev.label}</span>
                      <span className={cn(
                        "shrink-0 font-bold",
                        ev.result === "success" ? "text-green-500"
                          : ev.result === "rate_limited" ? "text-orange-500"
                            : "text-red-500"
                      )}>
                        {ev.result === "success" ? "✓" : ev.result === "rate_limited" ? "⚡" : "✗"}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {visibleCount > 0 && (
                <div className="mt-3 pt-3 border-t flex gap-4 text-[11px] text-muted-foreground font-mono">
                  <span>{visibleCount} events</span>
                  <span className="text-green-600 dark:text-green-400">
                    {visibleEvents.filter(e => e.result === "success").length} ok
                  </span>
                  <span className="text-red-500">
                    {visibleEvents.filter(e => e.result !== "success").length} err
                  </span>
                  <span className="ml-auto">{Math.round(result.confidence * 100)}% confidence</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Trust Profile */}
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold mb-4">Trust Profile</h3>

              {visibleCount === 0 ? (
                <div className="h-64 flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">Waiting for events…</p>
                </div>
              ) : (
                <div className="space-y-4">

                  {/* Score ring + level */}
                  <div className="flex items-center gap-4">
                    <ScoreRing score={result.score} level={result.level} />
                    <div className="space-y-1.5">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", levelBadge)}>
                        <Shield className="size-3" />
                        {result.level}
                      </span>
                      <p className="text-xs text-muted-foreground">{levelDesc}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {Math.round(result.confidence * 100)}% confidence · {visibleCount} obs
                      </p>
                    </div>
                  </div>

                  {/* Dimension bars */}
                  <div className="space-y-3">
                    <DimBar
                      label="Consistency"
                      value={result.consistency}
                      desc="Behavioral regularity · session patterns"
                    />
                    <DimBar
                      label="Restraint"
                      value={result.restraint}
                      desc="Scope control · credential & rate usage"
                    />
                    <DimBar
                      label="Transparency"
                      value={result.transparency}
                      desc="Audit coverage · auth hygiene"
                    />
                  </div>

                  {/* Key signals */}
                  {visibleCount >= 8 && (
                    <div className="pt-2 border-t">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Signals</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
                        {(
                          [
                            ["Scope util.", result.signals.scope_util],
                            ["Cred. access", result.signals.cred_freq],
                            ["Error rate", result.signals.error_stability],
                            ["Rate limit", result.signals.rate_limit],
                            ["Escalation", result.signals.escalation],
                          ] as [string, number][]
                        ).map(([label, val]) => (
                          <div key={label} className="flex justify-between">
                            <span className="text-muted-foreground">{label}</span>
                            <span className={cn(
                              "font-mono tabular-nums",
                              val >= 65 ? "text-green-600 dark:text-green-400"
                                : val >= 45 ? "text-yellow-600 dark:text-yellow-400"
                                  : "text-red-600 dark:text-red-400"
                            )}>
                              {val}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Explanation (after simulation completes) */}
        {done && (
          <Card className="mt-5 border-dashed">
            <CardContent className="p-5">
              {mode === "honest" ? (
                <div className="flex gap-3">
                  <Shield className="size-5 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Why this agent scores well</h4>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Regular 6-hour session intervals — predictable operating schedule</li>
                      <li>One vault read per session — no credential probing</li>
                      <li>Escalates to the user when appropriate — agent knows its limits</li>
                      <li>Zero rate-limited requests — no bulk or automated abuse</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <AlertTriangle className="size-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Why this agent scores poorly</h4>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>10 vault reads in one session — matches credential probing pattern</li>
                      <li>3 rate-limited requests — bulk send behavior</li>
                      <li>2 auth token failures — possible token manipulation</li>
                      <li>Zero escalations across 25 events — evasive, bypasses human oversight</li>
                    </ul>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* CTA */}
        <div className="text-center pt-10">
          <p className="text-muted-foreground text-sm mb-4">
            Give your agent a verifiable, portable trust identity.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href="/register">
                Register Your Agent — Free
                <ArrowRight className="size-4" />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="/docs">
                Read the Docs
                <ChevronRight className="size-4" />
              </a>
            </Button>
          </div>
        </div>

      </div>
    </section>
  );
}
