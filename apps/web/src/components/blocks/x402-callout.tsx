// ─── x402 Pay-per-call Callout ────────────────────────────────────────────────
//
// Live revenue path: GET /v1/trust/{agent_id} returns HTTP 402 with an x402 v2
// manifest. Agents pay 0.01 USDC on Base per call, settled on-chain in seconds.
// This component makes that fact visible on the homepage and pricing page.

import { Zap } from "lucide-react";

import { Button } from "@/components/ui/button";

const CURL_EXAMPLE = `curl https://agentlair.dev/v1/trust/acc_abc123
# → HTTP 402 Payment Required
# x402 manifest: 0.01 USDC on Base (eip155:8453)
# payTo: 0x90EE1EbcCFA2021711C595E1410e22401570B4AC`;

export function X402Callout() {
  return (
    <section className="container max-w-4xl py-16 lg:py-20">
      <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-8 py-10 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary">
          <Zap className="size-3" />
          Live now
        </div>

        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Agents pay 0.01 USDC per trust query
        </h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-sm leading-relaxed">
          No subscription. No API key. Hit{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
            /v1/trust/:agent_id
          </code>{" "}
          — get an HTTP 402 back with a complete x402 v2 payment manifest. Your agent pays 0.01 USDC on Base
          and retries. Settles on-chain in seconds.
        </p>

        <div className="mt-6 overflow-x-auto rounded-lg bg-muted p-4 text-left">
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
            {CURL_EXAMPLE}
          </pre>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="default" size="sm">
            <a href="/docs/api-reference#trust">API reference</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/quickstart">Quickstart</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
