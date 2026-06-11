# @agentlair/mcp-trust-attestation

Behavioral trust attestation middleware for MCP servers. Implements the
SEP-2133 unofficial extension `dev.agentlair/trust-attestation` for the
BHC-S spec `urn:agentlair:bhc-s:v1`.

Mount it on any HTTP-transport MCP server in three lines. No AgentLair
API key required at policy time. Verifiers fetch the descriptor and
attestation tokens directly from your server.

## Install

```sh
npm install @agentlair/mcp-trust-attestation hono
```

Requires Node >= 20. `hono` is a peer dependency (works with any 4.x).

## Quickstart

```ts
import { Hono } from 'hono';
import { createAttestationMiddleware } from '@agentlair/mcp-trust-attestation';

const app = new Hono();
app.use('/.well-known/agentlair-trust', createAttestationMiddleware({ serverId: 'url_sha256:abc...' }));
app.use('/agentlair/trust-attestation/:subject', createAttestationMiddleware({ serverId: 'url_sha256:abc...' }));
```

That's it. Your MCP server now exposes:

- `GET /.well-known/agentlair-trust` — the BHC-S issuer descriptor.
- `GET /agentlair/trust-attestation/:subject`: per-subject attestation
  JWT, proxied from AgentLair and cached locally.

## MCP server-card extension

To surface the attestation in your `initialize` response per SEP-2133:

```ts
import { buildServerCardExtension } from '@agentlair/mcp-trust-attestation';

const initializeResponse = {
  protocolVersion: '2025-03-26',
  capabilities: { tools: {} },
  serverInfo: { name: 'my-server', version: '1.0.0' },
  extensions: { ...buildServerCardExtension({ serverId: 'url_sha256:abc...' }) },
};
```

## Verify an attestation (client side)

```ts
import { verifyAttestation } from '@agentlair/mcp-trust-attestation';

const result = await verifyAttestation(jwt, { issuer: 'https://agentlair.dev' });
if (result.ok) {
  // result.payload — verified BHC-S claims
}
```

## node:http (no Hono)

```ts
import http from 'node:http';
import { createNodeHttpHandler } from '@agentlair/mcp-trust-attestation';

const handler = createNodeHttpHandler({ serverId: 'url_sha256:abc...' });
http.createServer(handler).listen(3000);
```

## Reference

- BHC-S spec: <https://agentlair.dev/docs/bhc-s>
- SEP-2133 (Extensions): the unofficial extension framework this package implements
- Reference server: [`@agentlair/mcp-demo-attested`](../mcp-demo-attested)

Licensed under Apache-2.0.
