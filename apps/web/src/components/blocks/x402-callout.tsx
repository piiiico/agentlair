// ─── Identity-over-Payments Callout ───────────────────────────────────────────
//
// Circle, Stripe, and Coinbase have commoditized x402 payments (50M+ txns).
// What's not solved: knowing which agent made the call. This callout positions
// AgentLair's AAT as the missing identity layer above commodity payment rails.

import { Fingerprint } from "lucide-react";

import { Button } from "@/components/ui/button";

const CURL_EXAMPLE = `# Circle / Stripe / Coinbase handle the payment.
# AgentLair answers: which agent sent it?

curl https://agentlair.dev/v1/trust/acc_abc123 \\
  -H "Authorization: Bearer <AAT>"
# → 200 OK: identity verified, trust score 94, owner: hakon@example.com
# → 403: agent unknown — no registered identity, reject or charge more`;

export function X402Callout() {
  return (
    <section className="container max-w-4xl py-16 lg:py-20">
      <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-8 py-10 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary">
          <Fingerprint className="size-3" />
          The missing layer
        </div>

        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Payments are solved. Identity isn't.
        </h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-sm leading-relaxed">
          Circle, Stripe, and Coinbase now handle x402 nanopayments at 50M+ transactions.
          None of them answer the follow-on question:{" "}
          <em>which agent made the call, who owns it, and should I trust it?</em>{" "}
          AgentLair's Agent Authentication Token (AAT) is the cryptographic answer — EdDSA-signed,
          JWKS-verifiable, tethered to a named owner. Identity that travels with every payment.
        </p>

        <div className="mt-6 overflow-x-auto rounded-lg bg-muted p-4 text-left">
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
            {CURL_EXAMPLE}
          </pre>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="default" size="sm">
            <a href="/docs/agent-auth-token">AAT docs</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/quickstart">Quickstart</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
