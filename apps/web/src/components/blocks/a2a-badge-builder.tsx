"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Copy, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  encodeCardUrl,
  validateCardUrl,
  buildBadgeUrl,
  buildScoreUrl,
  buildMarkdownSnippet,
  buildHtmlSnippet,
  buildAsciidocSnippet,
  buildGithubActionYaml,
  type BadgeStyle,
} from "@/lib/a2a-badge";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ScoreCheck {
  id: string;
  layer: string;
  name: string;
  pass: boolean;
  severity: string;
}

interface ScoreData {
  target: string;
  agent_name: string;
  scores: {
    L1_identity: number;
    L2_authentication: number;
    L3_authorization: number;
    L4_behavioral: number;
    overall: number;
  };
  grade: string;
  checks: ScoreCheck[];
}

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
/*  CodeSnippet                                                        */
/* ------------------------------------------------------------------ */

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
/*  StyleSelector                                                      */
/* ------------------------------------------------------------------ */

const STYLES = [
  { value: "flat" as const, label: "Flat" },
  { value: "flat-square" as const, label: "Flat Square" },
  { value: "for-the-badge" as const, label: "For the Badge" },
];

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
/*  Rubric Panel                                                       */
/* ------------------------------------------------------------------ */

const LAYER_LABELS: Record<string, string> = {
  L1: "L1 Identity",
  L2: "L2 Authentication",
  L3: "L3 Authorization",
  L4: "Behavioral",
};

const SEVERITY_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

function RubricPanel({ data }: { data: ScoreData }) {
  const layers = ["L1", "L2", "L3", "L4"];

  const checksByLayer: Record<string, ScoreCheck[]> = {};
  for (const check of data.checks) {
    if (!checksByLayer[check.layer]) checksByLayer[check.layer] = [];
    checksByLayer[check.layer].push(check);
  }

  const layerScore: Record<string, number> = {
    L1: data.scores.L1_identity,
    L2: data.scores.L2_authentication,
    L3: data.scores.L3_authorization,
    L4: data.scores.L4_behavioral,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Overall score: {data.scores.overall}
        </span>
        <span className="text-sm font-mono font-bold">
          Grade: {data.grade}
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all"
          style={{ width: `${data.scores.overall}%` }}
        />
      </div>
      {layers.map((layer) => {
        const checks = checksByLayer[layer] ?? [];
        const pass = checks.filter((c) => c.pass).length;
        return (
          <div key={layer} className="border border-border/50 rounded-md overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-muted/40">
              <span className="text-sm font-medium">
                {LAYER_LABELS[layer] ?? layer}
              </span>
              <span className="text-xs text-muted-foreground">
                {pass}/{checks.length} pass — score {layerScore[layer] ?? 0}
              </span>
            </div>
            <div className="divide-y divide-border/50">
              {checks.map((check) => (
                <div
                  key={check.id}
                  className="flex items-center gap-3 px-4 py-2 text-sm"
                >
                  <span
                    className={cn(
                      "flex-shrink-0 size-4 rounded-full flex items-center justify-center text-xs",
                      check.pass
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    )}
                  >
                    {check.pass ? (
                      <Check className="size-2.5" />
                    ) : (
                      <span>x</span>
                    )}
                  </span>
                  <span className="flex-1 text-foreground/80">{check.name}</span>
                  <Badge variant={SEVERITY_VARIANT[check.severity] ?? "outline"}>
                    {check.severity}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const A2ABadgeBuilder = () => {
  const [cardUrl, setCardUrl] = useState("");
  const [committedUrl, setCommittedUrl] = useState("");
  const [style, setStyle] = useState<BadgeStyle>("flat");
  const [label, setLabel] = useState("");
  const [scoreData, setScoreData] = useState<ScoreData | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  const validation = validateCardUrl(committedUrl);
  const encoded = validation.ok ? encodeCardUrl(committedUrl) : "";

  const badgeUrl = validation.ok
    ? buildBadgeUrl({ encoded, style, label: label || undefined })
    : "";

  const handleUrlBlur = useCallback(() => {
    setCommittedUrl(cardUrl);
  }, [cardUrl]);

  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        setCommittedUrl(cardUrl);
      }
    },
    [cardUrl]
  );

  useEffect(() => {
    if (!validation.ok || typeof window === "undefined") return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    setScoreLoading(true);
    setScoreData(null);
    setScoreError(null);

    fetch(buildScoreUrl(encoded), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Non-200 response");
        return res.json() as Promise<ScoreData>;
      })
      .then((data) => {
        setScoreData(data);
        setScoreLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") {
          setScoreError("Audit unavailable — try again shortly.");
        } else {
          setScoreError("Audit unavailable — try again shortly.");
        }
        setScoreLoading(false);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [encoded, validation.ok]);

  const imgKey = `${encoded}-${style}-${label}`;

  return (
    <section className="py-16 px-4 max-w-4xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
          <ClipboardList className="size-4" />
          A2A Card Audit
        </div>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          Audit your A2A agent card
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Paste your agent card URL. Get a live trust score, a rubric breakdown, and an embeddable badge in three clicks.
        </p>
      </div>

      {/* Builder */}
      <Card className="mb-8">
        <CardContent className="p-6 space-y-6">
          {/* URL Input */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Agent card URL
            </label>
            <input
              type="url"
              value={cardUrl}
              onChange={(e) => setCardUrl(e.target.value)}
              onBlur={handleUrlBlur}
              onKeyDown={handleUrlKeyDown}
              placeholder="https://example.com/.well-known/agent-card.json"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {committedUrl && !validation.ok && (
              <p className="text-xs text-destructive mt-1">{validation.error}</p>
            )}
            {!committedUrl && (
              <p className="text-xs text-muted-foreground mt-1">
                Press Enter or click outside to run the audit.
              </p>
            )}
          </div>

          {/* Style Selector */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Badge style
            </label>
            <StyleSelector value={style} onChange={setStyle} />
          </div>

          {/* Label override */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Custom label{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="A2A Trust"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Empty state */}
          {!committedUrl && (
            <div className="flex items-center justify-center min-h-[80px] bg-muted/30 rounded-lg border border-dashed border-border/70 text-muted-foreground text-sm">
              Enter a card URL above to see a live audit and badge preview.
            </div>
          )}

          {/* Preview */}
          {validation.ok && (
            <div className="pt-2 border-t border-border/50 space-y-4">
              <h3 className="text-sm font-medium">Badge preview</h3>
              <div className="flex items-center justify-center min-h-[60px] bg-muted/50 rounded-lg p-6 border border-border/50">
                <a href={committedUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    key={imgKey}
                    src={badgeUrl}
                    alt="A2A Trust Audit Badge"
                    className="max-h-[28px]"
                  />
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rubric panel */}
      {validation.ok && (
        <Card className="mb-8">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Rubric breakdown</h3>
            {scoreLoading && (
              <p className="text-sm text-muted-foreground">Loading audit results...</p>
            )}
            {scoreError && (
              <p className="text-sm text-destructive">{scoreError}</p>
            )}
            {scoreData && <RubricPanel data={scoreData} />}
          </CardContent>
        </Card>
      )}

      {/* Embed snippets */}
      {validation.ok && (
        <Card className="mb-8">
          <CardContent className="p-6 space-y-4">
            <h3 className="text-lg font-semibold">Embed snippets</h3>
            <div className="space-y-3">
              <CodeSnippet label="Badge URL" code={badgeUrl} />
              <CodeSnippet
                label="Markdown"
                code={buildMarkdownSnippet({ badgeUrl, cardUrl: committedUrl })}
              />
              <CodeSnippet
                label="HTML"
                code={buildHtmlSnippet({ badgeUrl, cardUrl: committedUrl })}
              />
              <CodeSnippet
                label="AsciiDoc"
                code={buildAsciidocSnippet({ badgeUrl, cardUrl: committedUrl })}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* GitHub Action CTA */}
      {validation.ok && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <h3 className="text-lg font-semibold">Run on every PR</h3>
            <p className="text-sm text-muted-foreground">
              Drop this workflow into your repo to audit the agent card on every pull request that touches it.
            </p>
            <CodeSnippet
              label=".github/workflows/a2a-audit.yml"
              code={buildGithubActionYaml(committedUrl)}
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
};
