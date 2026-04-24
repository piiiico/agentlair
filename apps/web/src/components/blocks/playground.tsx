"use client";

import { useState, useCallback } from "react";

import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Eye,
  KeyRound,
  Play,
  RefreshCw,
  Shield,
  ShieldOff,
  Sparkles,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function base64urlEncode(obj: object): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlDecode(str: string): object | null {
  try {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

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
      aria-label="Copy"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Sample token construction                                          */
/* ------------------------------------------------------------------ */

const SAMPLE_HEADER = { alg: "EdDSA", typ: "JWT", kid: "a1b2c3d4" };

const SAMPLE_PAYLOAD = {
  iss: "https://agentlair.dev",
  sub: "acc_demo_7x9k2m",
  aud: "https://mcp.example.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  jti: "aat_pg_" + Math.random().toString(36).slice(2, 10),
  did: "did:web:agentlair.dev:agents:acc_demo_7x9k2m",
  al_scopes: ["mcp:tools:read", "mcp:tools:execute"],
  al_audit_url: "https://agentlair.dev/v1/audit/aat_pg_demo",
  al_name: "research-agent-7",
  al_email: "research-agent-7@agentlair.dev",
  al_trust: {
    score: 750,
    level: "trusted",
    confidence: 0.95,
    computed_at: new Date().toISOString().replace(/\.\d+Z/, "Z"),
    trend: "improving",
  },
};

function buildSampleToken(): string {
  const h = base64urlEncode(SAMPLE_HEADER);
  const p = base64urlEncode(SAMPLE_PAYLOAD);
  // Demo signature (not cryptographically valid)
  const s = "dGhpc19pc19hX2RlbW9fc2lnbmF0dXJlX25vdF9jcnlwdG9ncmFwaGljYWxseV92YWxpZA";
  return `${h}.${p}.${s}`;
}

/* ------------------------------------------------------------------ */
/*  Claim descriptions                                                 */
/* ------------------------------------------------------------------ */

const CLAIM_DESCRIPTIONS: Record<string, string> = {
  iss: "Token issuer — the AgentLair platform",
  sub: "Subject — the agent's account ID",
  aud: "Audience — the service this token is for",
  exp: "Expiration — Unix timestamp when the token expires",
  iat: "Issued at — Unix timestamp of token creation",
  jti: "JWT ID — unique token identifier for revocation",
  did: "Decentralized Identifier — W3C DID for cross-platform identity",
  al_scopes: "Authorized scopes — what this agent can do",
  al_audit_url: "Audit trail URL — full log of this token's usage",
  al_name: "Agent name — human-readable identifier",
  al_email: "Agent email — the agent's @agentlair.dev address",
  al_trust: "Behavioral trust attestation — computed from on-chain activity",
};

/* ------------------------------------------------------------------ */
/*  Step badge                                                         */
/* ------------------------------------------------------------------ */

function StepBadge({
  step,
  label,
  active,
}: {
  step: number;
  label: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {step}
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  JSON Viewer with claim highlights                                  */
/* ------------------------------------------------------------------ */

function JsonViewer({
  data,
  highlightKey,
  showDescriptions,
}: {
  data: object;
  highlightKey?: string;
  showDescriptions?: boolean;
}) {
  const [expandedTooltip, setExpandedTooltip] = useState<string | null>(null);

  const renderValue = (value: unknown, indent: number): React.ReactNode => {
    if (value === null) return <span className="text-orange-500">null</span>;
    if (typeof value === "boolean")
      return <span className="text-orange-500">{String(value)}</span>;
    if (typeof value === "number")
      return <span className="text-cyan-500">{value}</span>;
    if (typeof value === "string")
      return <span className="text-green-500">"{value}"</span>;
    if (Array.isArray(value)) {
      if (value.length === 0) return <span>{"[]"}</span>;
      return (
        <span>
          {"[\n"}
          {value.map((item, i) => (
            <span key={i}>
              {"  ".repeat(indent + 1)}
              {renderValue(item, indent + 1)}
              {i < value.length - 1 ? "," : ""}
              {"\n"}
            </span>
          ))}
          {"  ".repeat(indent)}
          {"]"}
        </span>
      );
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      return (
        <span>
          {"{\n"}
          {entries.map(([k, v], i) => (
            <span key={k}>
              {"  ".repeat(indent + 1)}
              <span className="text-purple-400">"{k}"</span>
              {": "}
              {renderValue(v, indent + 1)}
              {i < entries.length - 1 ? "," : ""}
              {"\n"}
            </span>
          ))}
          {"  ".repeat(indent)}
          {"}"}
        </span>
      );
    }
    return <span>{String(value)}</span>;
  };

  const entries = Object.entries(data as Record<string, unknown>);

  return (
    <pre className="overflow-x-auto text-xs leading-relaxed font-mono">
      <code>
        {"{\n"}
        {entries.map(([key, value], i) => {
          const isHighlighted = key === highlightKey;
          const desc =
            showDescriptions && CLAIM_DESCRIPTIONS[key]
              ? CLAIM_DESCRIPTIONS[key]
              : null;

          return (
            <span key={key}>
              <span
                className={cn(
                  "relative inline",
                  isHighlighted &&
                    "bg-yellow-500/10 dark:bg-yellow-400/10 -mx-1 px-1 rounded"
                )}
                onMouseEnter={() => desc && setExpandedTooltip(key)}
                onMouseLeave={() => setExpandedTooltip(null)}
              >
                {"  "}
                <span
                  className={cn(
                    "text-purple-400",
                    isHighlighted && "text-yellow-500 dark:text-yellow-400 font-bold"
                  )}
                >
                  "{key}"
                </span>
                {": "}
                {renderValue(value, 1)}
                {i < entries.length - 1 ? "," : ""}
                {isHighlighted && (
                  <span className="ml-2 text-yellow-600 dark:text-yellow-400 text-[10px] font-sans font-medium uppercase tracking-wider">
                    ← trust attestation
                  </span>
                )}
              </span>
              {expandedTooltip === key && desc && (
                <>
                  {"\n"}
                  <span className="text-muted-foreground text-[10px] font-sans">
                    {"  "}
                    {"  ↳ "}
                    {desc}
                  </span>
                </>
              )}
              {"\n"}
            </span>
          );
        })}
        {"}"}
      </code>
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/*  Trust Score Badge                                                   */
/* ------------------------------------------------------------------ */

function TrustBadge({ score, level }: { score: number; level: string }) {
  const color =
    score >= 750
      ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20"
      : score >= 500
        ? "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20"
        : score >= 250
          ? "text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
          : "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        color
      )}
    >
      <Shield className="size-3" />
      {score} — {level}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Token Parts Visualizer                                             */
/* ------------------------------------------------------------------ */

function TokenParts({ token }: { token: string }) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  return (
    <div className="font-mono text-xs break-all leading-relaxed">
      <span className="text-blue-500">{parts[0]}</span>
      <span className="text-muted-foreground">.</span>
      <span className="text-green-500">{parts[1]}</span>
      <span className="text-muted-foreground">.</span>
      <span className="text-purple-500">{parts[2]}</span>
      <div className="mt-2 flex gap-4 text-[10px] font-sans font-medium uppercase tracking-wider">
        <span className="text-blue-500">header</span>
        <span className="text-green-500">payload</span>
        <span className="text-purple-500">signature</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lifecycle step data                                                */
/* ------------------------------------------------------------------ */

const LIFECYCLE_STEPS = [
  {
    title: "Issue a token",
    icon: KeyRound,
    method: "POST",
    endpoint: "/v1/tokens/issue",
    auth: true,
    request: `{
  "audience": "https://mcp.example.com",
  "scopes": ["mcp:tools:read", "mcp:tools:execute"],
  "ttl": 3600
}`,
    response: `{
  "token": "eyJhbGciOiJFZERTQSI...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "jti": "aat_a1b2c3d4e5f6"
}`,
    note: "Agent requests a scoped identity token. EdDSA-signed, cryptographically verifiable.",
  },
  {
    title: "Verify the token",
    icon: Eye,
    method: "POST",
    endpoint: "/v1/tokens/introspect",
    auth: false,
    request: `{
  "token": "eyJhbGciOiJFZERTQSI..."
}`,
    response: `{
  "active": true,
  "sub": "acc_demo_7x9k2m",
  "scope": "mcp:tools:read mcp:tools:execute",
  "al_trust": {
    "score": 750,
    "level": "trusted"
  }
}`,
    note: "Any MCP server can verify the token — no API key needed. Public endpoint, RFC 7662.",
  },
  {
    title: "Revoke the token",
    icon: XCircle,
    method: "POST",
    endpoint: "/v1/tokens/revoke",
    auth: true,
    request: `{
  "jti": "aat_a1b2c3d4e5f6",
  "reason": "scope_change"
}`,
    response: `{
  "revoked": true,
  "jti": "aat_a1b2c3d4e5f6",
  "reason": "scope_change",
  "revoked_at": "${new Date().toISOString().replace(/\.\d+Z/, "Z")}"
}`,
    note: "Instant revocation. Token ID is added to the revocation list.",
  },
  {
    title: "Re-verify — now inactive",
    icon: ShieldOff,
    method: "POST",
    endpoint: "/v1/tokens/introspect",
    auth: false,
    request: `{
  "token": "eyJhbGciOiJFZERTQSI..."
}`,
    response: `{
  "active": false
}`,
    note: "Same introspect call — now returns inactive. The MCP server rejects the agent.",
  },
];

/* ------------------------------------------------------------------ */
/*  Main Playground component                                          */
/* ------------------------------------------------------------------ */

export function Playground() {
  const [sampleToken] = useState(buildSampleToken);
  const [tokenInput, setTokenInput] = useState("");
  const [decoded, setDecoded] = useState<{
    header: object;
    payload: Record<string, unknown>;
  } | null>(null);
  const [generated, setGenerated] = useState(false);

  const [verifyResult, setVerifyResult] = useState<Record<string, unknown> | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [activeLifecycleStep, setActiveLifecycleStep] = useState(-1);

  /* Step 1: Generate & Decode */
  const handleGenerate = useCallback(() => {
    const parts = sampleToken.split(".");
    const header = base64urlDecode(parts[0]);
    const payload = base64urlDecode(parts[1]);
    if (header && payload) {
      setDecoded({ header, payload: payload as Record<string, unknown> });
      setTokenInput(sampleToken);
      setGenerated(true);
      setVerifyResult(null);
    }
  }, [sampleToken]);

  /* Step 2: Verify */
  const handleVerify = useCallback(async () => {
    const token = tokenInput || sampleToken;
    setVerifyLoading(true);
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const resp = await fetch("https://agentlair.dev/v1/tokens/introspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await resp.json();
      setVerifyResult(data as Record<string, unknown>);
    } catch {
      setVerifyError("Network error — could not reach AgentLair API.");
    } finally {
      setVerifyLoading(false);
    }
  }, [tokenInput, sampleToken]);

  /* Step 3: Lifecycle play-through */
  const handlePlayLifecycle = useCallback(() => {
    setActiveLifecycleStep(0);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step >= LIFECYCLE_STEPS.length) {
        clearInterval(interval);
      } else {
        setActiveLifecycleStep(step);
      }
    }, 1800);
  }, []);

  return (
    <section className="py-28 lg:pt-40 lg:pb-32">
      <div className="container max-w-3xl">
        {/* Hero */}
        <div className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 font-mono text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            Interactive — no signup required
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl">
            Try AgentLair
          </h1>
          <p className="text-muted-foreground mt-3 text-lg max-w-xl mx-auto">
            See how agent identity works in 30 seconds. Generate a token, verify
            it live, and watch the full lifecycle.
          </p>
        </div>

        <div className="space-y-8">
          {/* ====== Step 1: Generate & Decode ====== */}
          <Card>
            <CardContent className="px-6 pt-6 pb-6">
              <StepBadge step={1} label="Generate an AAT" active={!generated} />
              <p className="text-muted-foreground text-sm mb-4">
                An AgentLair Agent Token (AAT) is an EdDSA-signed JWT that gives
                an AI agent a portable, verifiable identity.
              </p>

              {!generated ? (
                <Button onClick={handleGenerate} className="w-full sm:w-auto">
                  <KeyRound className="size-4" />
                  Generate Token
                </Button>
              ) : (
                <div className="space-y-4">
                  {/* Raw token */}
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Raw JWT
                      </span>
                      <CopyButton text={sampleToken} />
                    </div>
                    <TokenParts token={sampleToken} />
                  </div>

                  {/* Decoded header */}
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <span className="text-xs font-medium text-blue-500 uppercase tracking-wide mb-2 block">
                      Header
                    </span>
                    <JsonViewer data={decoded!.header} />
                  </div>

                  {/* Decoded payload */}
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-green-500 uppercase tracking-wide">
                        Payload
                      </span>
                      {(decoded!.payload.al_trust as { score?: number; level?: string })?.score != null && (
                        <TrustBadge
                          score={
                            (decoded!.payload.al_trust as { score: number }).score
                          }
                          level={
                            (decoded!.payload.al_trust as { level: string }).level
                          }
                        />
                      )}
                    </div>
                    <JsonViewer
                      data={decoded!.payload}
                      highlightKey="al_trust"
                      showDescriptions
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ====== Step 2: Verify ====== */}
          <Card>
            <CardContent className="px-6 pt-6 pb-6">
              <StepBadge
                step={2}
                label="Verify a Token"
                active={generated && !verifyResult}
              />
              <p className="text-muted-foreground text-sm mb-4">
                Anyone can verify an AAT — no API key needed. This calls the
                real{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                  POST /v1/tokens/introspect
                </code>{" "}
                endpoint on agentlair.dev.
              </p>

              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">
                    Token to verify
                  </label>
                  <textarea
                    className="w-full bg-transparent font-mono text-xs resize-none outline-none min-h-[60px] text-foreground placeholder:text-muted-foreground/50"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={
                      generated
                        ? undefined
                        : "Generate a token in Step 1, or paste your own AAT here..."
                    }
                    spellCheck={false}
                  />
                </div>

                <Button
                  onClick={handleVerify}
                  disabled={verifyLoading || (!tokenInput && !generated)}
                  variant={verifyResult ? "outline" : "default"}
                  className="w-full sm:w-auto"
                >
                  {verifyLoading ? (
                    <>
                      <RefreshCw className="size-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <Eye className="size-4" />
                      {verifyResult ? "Verify Again" : "Verify with AgentLair"}
                    </>
                  )}
                </Button>

                {verifyError && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
                    {verifyError}
                  </div>
                )}

                {verifyResult && (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Introspection Response
                      </span>
                      <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground">
                        LIVE
                      </span>
                    </div>

                    {/* Active/Inactive badge */}
                    <div className="flex items-center gap-2">
                      {(verifyResult as Record<string, unknown>).active ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-sm font-medium text-green-600 dark:text-green-400">
                          <Shield className="size-4" />
                          Active — Token is valid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400">
                          <ShieldOff className="size-4" />
                          Inactive — Token rejected
                        </span>
                      )}
                    </div>

                    <pre className="text-xs font-mono overflow-x-auto leading-relaxed">
                      <code>
                        {JSON.stringify(verifyResult, null, 2)}
                      </code>
                    </pre>

                    {!(verifyResult as Record<string, unknown>).active && generated && (
                      <p className="text-xs text-muted-foreground">
                        The demo token isn't cryptographically signed by
                        AgentLair's key, so introspect correctly returns
                        inactive.{" "}
                        <a
                          href="/register"
                          className="text-primary hover:underline"
                        >
                          Register an agent
                        </a>{" "}
                        to issue real tokens.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ====== Step 3: Token Lifecycle ====== */}
          <Card>
            <CardContent className="px-6 pt-6 pb-6">
              <StepBadge step={3} label="Token Lifecycle" active={false} />
              <p className="text-muted-foreground text-sm mb-4">
                The full lifecycle: issue, verify, revoke, re-verify. This is
                how MCP servers and relying parties work with AgentLair.
              </p>

              {activeLifecycleStep === -1 ? (
                <Button
                  onClick={handlePlayLifecycle}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  <Play className="size-4" />
                  Play Lifecycle Demo
                </Button>
              ) : (
                <div className="space-y-4">
                  {LIFECYCLE_STEPS.map((step, i) => {
                    const visible = i <= activeLifecycleStep;
                    const Icon = step.icon;

                    return (
                      <div
                        key={i}
                        className={cn(
                          "transition-all duration-500",
                          visible
                            ? "opacity-100 translate-y-0"
                            : "opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden"
                        )}
                      >
                        <div className="rounded-lg border bg-muted/30 overflow-hidden">
                          {/* Step header */}
                          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/40">
                            <Icon className="size-4 text-muted-foreground" />
                            <span className="font-medium text-sm">
                              {step.title}
                            </span>
                            <span
                              className={cn(
                                "ml-auto text-[10px] font-mono rounded px-1.5 py-0.5",
                                step.method === "POST"
                                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                  : "bg-green-500/10 text-green-600 dark:text-green-400"
                              )}
                            >
                              {step.method}
                            </span>
                            <code className="text-[10px] font-mono text-muted-foreground">
                              {step.endpoint}
                            </code>
                            {!step.auth && (
                              <span className="text-[10px] font-mono rounded px-1.5 py-0.5 bg-green-500/10 text-green-600 dark:text-green-400">
                                public
                              </span>
                            )}
                          </div>

                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
                            {/* Request */}
                            <div className="p-3">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                                Request
                              </span>
                              <pre className="text-xs font-mono leading-relaxed text-foreground/80 overflow-x-auto">
                                <code>{step.request}</code>
                              </pre>
                            </div>
                            {/* Response */}
                            <div className="p-3">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                                Response
                              </span>
                              <pre className="text-xs font-mono leading-relaxed text-foreground/80 overflow-x-auto">
                                <code>{step.response}</code>
                              </pre>
                            </div>
                          </div>

                          {/* Note */}
                          <div className="px-4 py-2 border-t bg-muted/20">
                            <p className="text-xs text-muted-foreground">
                              {step.note}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {activeLifecycleStep >= LIFECYCLE_STEPS.length - 1 && (
                    <Button
                      onClick={() => setActiveLifecycleStep(-1)}
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                    >
                      <RefreshCw className="size-3.5" />
                      Replay
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ====== CTA ====== */}
          <div className="text-center pt-4 pb-8">
            <p className="text-muted-foreground text-sm mb-4">
              That's the full token lifecycle. Ready to give your agents an
              identity?
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button asChild size="lg">
                <a href="/register">
                  Register Your Agent — Free
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="/docs/api-reference">
                  API Reference
                  <ChevronRight className="size-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
