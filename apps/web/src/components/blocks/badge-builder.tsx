"use client";

import { useState, useCallback } from "react";
import {
  Check,
  Copy,
  Shield,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BADGE_BASE = "https://agentlair.dev/badge";
const DEMO_AGENT_ID = "acc_picoclaw";

const STYLES = [
  { value: "flat", label: "Flat" },
  { value: "flat-square", label: "Flat Square" },
  { value: "for-the-badge", label: "For the Badge" },
] as const;

type BadgeStyle = (typeof STYLES)[number]["value"];

/* ------------------------------------------------------------------ */
/*  CopyButton                                                         */
/* ------------------------------------------------------------------ */

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={cn(
        "text-muted-foreground hover:text-foreground transition-colors",
        className
      )}
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Badge Preview Card                                                 */
/* ------------------------------------------------------------------ */

function BadgePreview({
  agentId,
  style,
  compact,
  label,
}: {
  agentId: string;
  style: BadgeStyle;
  compact: boolean;
  label: string;
}) {
  const params = new URLSearchParams();
  if (style !== "flat") params.set("style", style);
  if (compact) params.set("compact", "true");
  if (label) params.set("label", label);
  const qs = params.toString();
  const badgeUrl = `${BADGE_BASE}/${agentId}${qs ? `?${qs}` : ""}`;
  const trustUrl = `https://agentlair.dev/trust/${agentId}`;
  const markdown = `[![AgentLair Trust](${badgeUrl})](${trustUrl})`;
  const html = `<a href="${trustUrl}"><img src="${badgeUrl}" alt="AgentLair Trust Badge" /></a>`;

  // Force re-render on param change by adding cache-bust key
  const imgKey = `${agentId}-${style}-${compact}-${label}`;

  return (
    <div className="space-y-6">
      {/* Live Preview */}
      <div className="flex items-center justify-center min-h-[60px] bg-muted/50 rounded-lg p-6 border border-border/50">
        <a href={trustUrl} target="_blank" rel="noopener noreferrer">
          <img
            key={imgKey}
            src={badgeUrl}
            alt="AgentLair Trust Badge"
            className="max-h-[28px]"
          />
        </a>
      </div>

      {/* Code Snippets */}
      <div className="space-y-3">
        <CodeSnippet label="Badge URL" code={badgeUrl} />
        <CodeSnippet label="Markdown" code={markdown} />
        <CodeSnippet label="HTML" code={html} />
      </div>
    </div>
  );
}

function CodeSnippet({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="bg-muted/80 border border-border/50 rounded-md px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all text-foreground/80">
        {code}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Style Selector                                                     */
/* ------------------------------------------------------------------ */

function StyleSelector({
  value,
  onChange,
}: {
  value: BadgeStyle;
  onChange: (v: BadgeStyle) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {STYLES.map((s) => (
        <button
          key={s.value}
          onClick={() => onChange(s.value)}
          className={cn(
            "px-3 py-1.5 text-sm rounded-md border transition-colors",
            value === s.value
              ? "border-primary bg-primary/10 text-primary font-medium"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trust Level Examples                                               */
/* ------------------------------------------------------------------ */

function TrustLevelExamples() {
  const levels = [
    {
      tier: "Pending",
      color: "#9e9e9e",
      desc: "No behavioral data yet. Badge shown for newly registered agents.",
    },
    {
      tier: "Low 28",
      color: "#f44336",
      desc: "Intern level (0-39). Limited behavioral history or inconsistent patterns.",
    },
    {
      tier: "Medium 52",
      color: "#ff9800",
      desc: "Junior level (40-64). Building a track record of consistent behavior.",
    },
    {
      tier: "High 78",
      color: "#4caf50",
      desc: "Senior level (65-84). Strong behavioral consistency across multiple dimensions.",
    },
    {
      tier: "Verified 92",
      color: "#2196f3",
      desc: "Principal level (85-100). Highest trust tier with high confidence.",
    },
  ];

  return (
    <div className="space-y-3">
      {levels.map((l) => (
        <div key={l.tier} className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <BadgeSvgPreview label="AgentLair Trust" value={l.tier} color={l.color} />
          </div>
          <p className="text-sm text-muted-foreground">{l.desc}</p>
        </div>
      ))}
    </div>
  );
}

/** Inline SVG badge for examples (no network request needed) */
function BadgeSvgPreview({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  // Simple width estimation
  const charWidth = 6.5;
  const pad = 12;
  const labelWidth = Math.round(label.length * charWidth + pad);
  const valueWidth = Math.round(value.length * charWidth + pad);
  const totalWidth = labelWidth + valueWidth;
  const height = 20;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={totalWidth}
      height={height}
      role="img"
      className="inline-block"
    >
      <clipPath id={`r-${value}`}>
        <rect width={totalWidth} height={height} rx={3} fill="#fff" />
      </clipPath>
      <g clipPath={`url(#r-${value})`}>
        <rect width={labelWidth} height={height} fill="#555" />
        <rect x={labelWidth} width={valueWidth} height={height} fill={color} />
        <linearGradient id={`s-${value}`} x2="0" y2="100%">
          <stop offset="0" stopColor="#bbb" stopOpacity="0.1" />
          <stop offset="1" stopOpacity="0.1" />
        </linearGradient>
        <rect
          rx={3}
          width={totalWidth}
          height={height}
          fill={`url(#s-${value})`}
        />
      </g>
      <g
        fill="#fff"
        textAnchor="middle"
        fontFamily="Verdana,Geneva,DejaVu Sans,sans-serif"
        fontSize="11"
      >
        <text x={labelWidth / 2} y={14} fill="#fff">
          {label}
        </text>
        <text x={labelWidth + valueWidth / 2} y={14} fill="#fff">
          {value}
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const BadgeBuilder = () => {
  const [agentId, setAgentId] = useState(DEMO_AGENT_ID);
  const [style, setStyle] = useState<BadgeStyle>("flat");
  const [compact, setCompact] = useState(false);
  const [customLabel, setCustomLabel] = useState("");

  return (
    <section className="py-16 px-4 max-w-4xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
          <ShieldCheck className="size-4" />
          Trust Badges
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          Show your agent's trust score
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Embeddable shields.io-style badges that display real-time behavioral
          trust scores. Add them to READMEs, docs, or anywhere you publish agent
          metadata.
        </p>
      </div>

      {/* Builder */}
      <Card className="mb-12">
        <CardContent className="p-6 space-y-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            Badge Builder
          </h2>

          {/* Agent ID input */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Agent ID</label>
            <input
              type="text"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="acc_your_agent_id"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Your AgentLair account ID (starts with acc_)
            </p>
          </div>

          {/* Style selector */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Style</label>
            <StyleSelector value={style} onChange={setStyle} />
          </div>

          {/* Options row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Custom Label{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="AgentLair Trust"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={compact}
                  onChange={(e) => setCompact(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-sm">
                  Compact mode{" "}
                  <span className="text-muted-foreground">(label: "AL")</span>
                </span>
              </label>
            </div>
          </div>

          {/* Preview */}
          <div className="pt-2 border-t border-border/50">
            <h3 className="text-sm font-medium mb-3">Preview & Code</h3>
            <BadgePreview
              agentId={agentId}
              style={style}
              compact={compact}
              label={customLabel}
            />
          </div>
        </CardContent>
      </Card>

      {/* Trust Levels Reference */}
      <Card className="mb-12">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">Trust Levels</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Badge color and label reflect the agent's behavioral trust score,
            computed from audit trail analysis across three dimensions:
            consistency, restraint, and transparency.
          </p>
          <TrustLevelExamples />
        </CardContent>
      </Card>

      {/* How It Works */}
      <Card className="mb-12">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="font-medium mb-1">1. Behavioral Observation</div>
              <p className="text-muted-foreground">
                Every API call your agent makes through AgentLair is
                cryptographically logged in an immutable audit trail.
              </p>
            </div>
            <div>
              <div className="font-medium mb-1">2. Trust Computation</div>
              <p className="text-muted-foreground">
                The trust engine analyzes 90 days of behavior across consistency,
                restraint, and transparency dimensions to produce a score from
                0-100.
              </p>
            </div>
            <div>
              <div className="font-medium mb-1">3. Real-time Badge</div>
              <p className="text-muted-foreground">
                The badge SVG is generated server-side with 5-minute caching. No
                JavaScript required — works as a plain &lt;img&gt; tag anywhere.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Reference */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">API Reference</h2>
          <div className="space-y-4 text-sm">
            <div>
              <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">
                GET /badge/:agentId
              </code>
              <p className="text-muted-foreground mt-1">
                Returns an SVG badge image. No authentication required.
              </p>
            </div>
            <div>
              <div className="font-medium mb-2">Query Parameters</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-medium">Param</th>
                      <th className="text-left py-2 pr-4 font-medium">Default</th>
                      <th className="text-left py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono text-xs">style</td>
                      <td className="py-2 pr-4">flat</td>
                      <td className="py-2">
                        flat, flat-square, or for-the-badge
                      </td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2 pr-4 font-mono text-xs">label</td>
                      <td className="py-2 pr-4">AgentLair Trust</td>
                      <td className="py-2">Custom left-side label text</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-mono text-xs">compact</td>
                      <td className="py-2 pr-4">false</td>
                      <td className="py-2">
                        If true, uses short label "AL"
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="font-medium mb-2">Response</div>
              <p className="text-muted-foreground">
                Content-Type: <code className="bg-muted px-1 rounded text-xs">image/svg+xml</code>.
                Cache-Control: 5 minutes. CORS: <code className="bg-muted px-1 rounded text-xs">*</code> (embeddable anywhere).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
