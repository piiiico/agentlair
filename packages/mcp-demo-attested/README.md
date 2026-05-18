# @agentlair/mcp-demo-attested

Minimal reference MCP server that proves the
[`@agentlair/mcp-trust-attestation`](../mcp-trust-attestation) SDK
works end-to-end: one `echo` tool over stdio plus the BHC-S descriptor
and per-subject attestation routes wired in three lines.

## Run

```sh
npx @agentlair/mcp-demo-attested
```

The HTTP attestation surface comes up on `localhost:8787` (override with
`ATTESTED_HTTP_PORT`). The MCP stdio transport connects on the standard
streams, ready for any MCP client.

## What it demonstrates

- `GET /.well-known/agentlair-trust` returns the BHC-S issuer descriptor.
- `GET /agentlair/trust-attestation/:subject` returns the per-subject
  attestation JWT (proxied from AgentLair, cached locally).
- `GET /` returns the MCP server-card payload, including the
  `dev.agentlair/trust-attestation` extension.

## Config

| Env var | Default | Notes |
|---|---|---|
| `ATTESTED_SERVER_ID` | `url_sha256:0000...` | Subject identifier |
| `ATTESTED_HTTP_PORT` | `8787` | Port for the HTTP attestation surface |
| `ATTESTED_DISABLE_HTTP` | unset | Set to `1` to run stdio-only |

Licensed under Apache-2.0.
