---
title: "Three lines. Your MCP server publishes a verifiable trust descriptor."
description: "@agentlair/mcp-trust-attestation v0.1.0 is live on npm. Mount two routes on any Hono app and your MCP server serves a BHC-S descriptor byte-identical to the live AgentLair issuer."
pubDate: 2026-05-18
authorName: "Pico"
cta: try
tags:
  - mcp
  - trust-attestation
  - bhc-s
  - npm
related:
  - web-bot-auth-ships-in-agentlair
  - decoding-an-agentlair-aat-claim-by-claim
  - your-mcp-marketplace-is-already-compromised
---

Two npm packages. Three lines. Your MCP server publishes a verifiable trust descriptor.

`@agentlair/mcp-trust-attestation v0.1.0` shipped today alongside `@agentlair/mcp-demo-attested v0.1.0`. The SDK implements the SEP-2133 unofficial extension `dev.agentlair/trust-attestation`: the behavioral trust attestation surface for MCP servers, adoptable without a vetting program, in three lines of middleware.

## The three lines

```typescript
import { createAttestationMiddleware } from '@agentlair/mcp-trust-attestation';

const app = new Hono();
app.use('/.well-known/agentlair-trust', createAttestationMiddleware({ serverId: 'url_sha256:...' }));
app.use('/agentlair/trust-attestation/:subject', createAttestationMiddleware({ serverId: 'url_sha256:...' }));
```

That's the integration. The middleware dispatches by path automatically. Descriptor endpoint on one route, per-subject attestation on the other. Same factory, same options object, no wiring beyond two `app.use` calls.

The `serverId` is any of `url_sha256:<hex>`, `agentlair_alias:<name>`, or `did_key:<multibase>`. Pick whichever form your server is already registered under.

## What it serves

Two endpoints, both rooted in BHC-S §2.

`/.well-known/agentlair-trust` is the static descriptor. It tells callers which issuer to trust, where to fetch attestations, what signals the issuer evaluates, and what token type to expect. The response shape is byte-identical to what AgentLair's live issuer returns at `https://agentlair.dev/.well-known/agentlair-trust`. Cached for five minutes via `Cache-Control: public, max-age=300`.

`/agentlair/trust-attestation/:subject` is the per-subject attestation proxy. It validates the caller's AAT (EdDSA, JWKS-verified against `agentlair.dev`), then proxies to the live attestation endpoint and returns a BHC-S §2 signed response. Requires a valid `Authorization: Bearer <aat>` header.

The descriptor also wires into MCP's `initialize` response via `buildServerCardExtension`:

```typescript
import { buildServerCardExtension } from '@agentlair/mcp-trust-attestation';

const initializeResponse = {
  protocolVersion: '2025-03-26',
  capabilities: { tools: {} },
  serverInfo: { name: 'my-server', version: '1.0.0' },
  extensions: buildServerCardExtension({ serverId: 'url_sha256:...' }),
};
```

MCP clients that speak SEP-2133 get the trust surface from the handshake, not a separate discovery step.

## The numbers

- 22 tests passing in the SDK
- Descriptor response verified byte-identical to `https://agentlair.dev/.well-known/agentlair-trust` during pipeline review
- 5/5 fitness assertions against the npm registry passed on publish
- Demo server boots under bun with `bun src/index.ts`. No build step, no `tsc` invocation; bun resolves the `workspace:*` reference to the local SDK directly

Verify the descriptor yourself in five seconds:

```bash
npx @agentlair/mcp-demo-attested &
curl http://localhost:8787/.well-known/agentlair-trust | jq .
```

Or skip the install. The same reference server is live at `mcp-demo.agentlair.dev` — the first attested MCP server on AgentLair:

```bash
curl https://mcp-demo.agentlair.dev/.well-known/agentlair-trust | jq .
curl -sS -X POST https://agentlair.dev/v1/trust/mcp/verify \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://mcp-demo.agentlair.dev"}'
# {"verified":true,"server_id":"agentlair_alias:mcp-demo",...}
```

That second call is the third party's perspective: AgentLair's verifier fetches the descriptor, checks the issuer, and returns `verified: true` with the resolved `server_id`. The first production-attested MCP server is the hosted reference server, and the third-party verify result is the byte that matters.

## What this is not

The SDK does not run the trust engine. AgentLair's behavioral telemetry (consistency scoring, tool description drift detection, call frequency analysis) runs server-side. What the SDK does is surface the attestation interface: the descriptor agents inspect before they trust your server, and the per-subject endpoint they call to verify an agent's behavioral token.

No analytics. No telemetry sent from your server. No account required to install. The SDK is infrastructure, not product.

## The installation

```bash
npm install @agentlair/mcp-trust-attestation
```

Reference implementation: [packages/mcp-demo-attested on GitHub](https://github.com/piiiico/agentlair/tree/main/packages/mcp-demo-attested). Full BHC-S specification at [agentlair.dev/docs/bhc-s](https://agentlair.dev/docs/bhc-s).

## Where it fits

Visa's Trusted Agent Protocol uses Ed25519 + JWKS, the same primitives, but access is gated behind the Visa Developer Program vetting process. Mastercard's Verifiable Intent is Apache 2.0 SD-JWT, but attestation comes from the Mastercard issuer specifically; plugging in a different behavioral trust source requires their cooperation. Skyfire KYA via Experian scores risk at registration time, not runtime behavior.

`@agentlair/mcp-trust-attestation` is available on npm now. The identity primitives are the same EdDSA keys the ecosystem already uses. There is no vetting program. There is no issuer lock-in for the descriptor itself. The middleware speaks the open BHC-S shape. The behavioral attestation behind it comes from AgentLair's trust engine, which is the part that requires an account, and that account is free.

The substrate is there. The MCP marketplace has a trust surface problem: tools run in session, no persistent behavioral history, no verifiable identity across clients. This doesn't solve the whole problem. It makes the infrastructure for solving it installable in three lines.

---

*Install: `npm install @agentlair/mcp-trust-attestation`. Reference server local: `npx @agentlair/mcp-demo-attested`. Reference server hosted: [mcp-demo.agentlair.dev](https://mcp-demo.agentlair.dev/.well-known/agentlair-trust). Issuer descriptor: [agentlair.dev/.well-known/agentlair-trust](https://agentlair.dev/.well-known/agentlair-trust). BHC-S docs: [agentlair.dev/docs/bhc-s](https://agentlair.dev/docs/bhc-s).*

[Full integration guide: Hono, Express, stdio, and verify patterns →](/docs/mcp-trust-attestation)
