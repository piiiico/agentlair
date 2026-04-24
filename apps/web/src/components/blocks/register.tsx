"use client";

import { useState } from "react";

import { ArrowRight, Check, Copy, Key, Shield, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface RegisterResult {
  api_key: string;
  account_id: string;
  email_address: string;
  tier: string;
  status: string;
  created_at: string;
  limits: { emails_per_day: number; requests_per_day: number };
  next_steps?: string[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}

function CodeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {label}
        </p>
        <p className="mt-0.5 truncate font-mono text-sm">{value}</p>
      </div>
      <CopyButton text={value} />
    </div>
  );
}

export function Register() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = {};
      if (name.trim()) body.name = name.trim();
      if (recoveryEmail.trim()) body.recovery_email = recoveryEmail.trim();

      const resp = await fetch("https://agentlair.dev/v1/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.message || data.error || "Registration failed. Please try again.");
        return;
      }

      setResult(data as RegisterResult);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    const jwksUrl = "https://agentlair.dev/.well-known/jwks.json";
    return (
      <section className="py-28 lg:pt-44 lg:pb-32">
        <div className="container max-w-2xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-green-500/10">
              <Check className="size-5 text-green-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Agent registered</h1>
              <p className="text-muted-foreground text-sm">
                Save your credentials — the API key won't be shown again.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Card className="border-yellow-500/20 bg-yellow-500/5">
              <CardContent className="px-5 py-4">
                <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                  ⚠ Save your API key now — it will not be shown again.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <h2 className="font-semibold">Your credentials</h2>
              </CardHeader>
              <CardContent className="space-y-3">
                <CodeRow label="API Key" value={result.api_key} />
                <CodeRow label="Email Address" value={result.email_address} />
                <CodeRow label="Account ID" value={result.account_id} />
                <CodeRow label="JWKS Endpoint" value={jwksUrl} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <h2 className="font-semibold">Use your API key</h2>
              </CardHeader>
              <CardContent>
                <div className="bg-card overflow-hidden rounded-xl border">
                  <div className="flex items-center gap-2 border-b px-4 py-2">
                    <div className="size-2.5 rounded-full bg-red-400/60" />
                    <div className="size-2.5 rounded-full bg-yellow-400/60" />
                    <div className="size-2.5 rounded-full bg-green-400/60" />
                    <span className="text-muted-foreground ml-1 font-mono text-xs">
                      terminal
                    </span>
                  </div>
                  <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
                    <code>
                      <span className="text-muted-foreground"># Check your account</span>
                      {"\n"}
                      <span className="text-foreground">{`curl https://agentlair.dev/v1/account/me \\`}</span>
                      {"\n"}
                      <span className="text-foreground">{`  -H "Authorization: Bearer ${result.api_key.slice(0, 20)}..."`}</span>
                      {"\n\n"}
                      <span className="text-muted-foreground"># Verify an AAT (JWKS)</span>
                      {"\n"}
                      <span className="text-foreground">{`curl ${jwksUrl}`}</span>
                    </code>
                  </pre>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <h2 className="font-semibold">Next steps</h2>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <a
                    href="/docs"
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <Shield className="text-primary size-5 shrink-0" />
                      <div>
                        <p className="font-medium">Read the docs</p>
                        <p className="text-muted-foreground text-sm">
                          Integrations, API reference, SDK guides
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                  </a>
                  <a
                    href="/getting-started"
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <Zap className="text-primary size-5 shrink-0" />
                      <div>
                        <p className="font-medium">5-minute quickstart</p>
                        <p className="text-muted-foreground text-sm">
                          Send your first email, store a secret
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                  </a>
                  <a
                    href="/pricing"
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <Key className="text-primary size-5 shrink-0" />
                      <div>
                        <p className="font-medium">Upgrade for more</p>
                        <p className="text-muted-foreground text-sm">
                          Audit trail, email vault, behavioral trust scoring
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-28 lg:pt-44 lg:pb-32">
      <div className="container max-w-lg">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 font-mono text-xs text-muted-foreground">
            <Key className="size-3" />
            Free tier — no credit card required
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Register your agent
          </h1>
          <p className="text-muted-foreground mt-3 text-lg">
            Get an API key, email address, and JWKS endpoint in seconds.
          </p>
        </div>

        <Card>
          <CardContent className="px-6 py-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="agent-name">
                  Agent name{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <Input
                  id="agent-name"
                  type="text"
                  placeholder="my-agent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                />
                <p className="text-muted-foreground text-xs">
                  Becomes your email address: <code className="font-mono">{name ? `${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}@agentlair.dev` : "my-agent@agentlair.dev"}</code>
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium"
                  htmlFor="agent-description"
                >
                  Description{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <Input
                  id="agent-description"
                  type="text"
                  placeholder="What does this agent do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={200}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium"
                  htmlFor="recovery-email"
                >
                  Operator email{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <Input
                  id="recovery-email"
                  type="email"
                  placeholder="you@example.com"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Receive account recovery and verification emails.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? "Registering..." : "Register Agent — Free"}
              </Button>
            </form>

            <div className="mt-6 space-y-2 border-t pt-5">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Free tier includes
              </p>
              <ul className="space-y-1.5">
                {[
                  "3 agents",
                  "1,000 verifications/month",
                  "JWKS endpoint (.well-known/jwks.json)",
                  "No credit card required",
                ].map((item) => (
                  <li
                    key={item}
                    className="text-muted-foreground flex items-center gap-2 text-sm"
                  >
                    <Check className="size-4 shrink-0 text-green-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          Already have an API key?{" "}
          <a href="/getting-started" className="text-primary hover:underline">
            View getting started guide
          </a>
        </p>
      </div>
    </section>
  );
}
