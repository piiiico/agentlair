<!--
  Integration PR Template — for external ecosystem integrations (langchain, vercel/ai, mastra, MCP, n8n, etc.)
  Front-loads operator transparency so maintainers don't stop at the landing page footer.
-->

## Operator transparency

**Who operates AgentLair:** Håkon Åmdal, Norway (EU/EEA). Sole proprietorship — no VC, no anonymous SaaS org.

- Contact: hei@agentlair.dev
- Operator details: https://agentlair.dev/about
- Privacy policy: https://agentlair.dev/privacy
- Security model: https://agentlair.dev/security
- API docs: https://agentlair.dev/docs
- Source (monorepo): https://github.com/piiiico/agentlair

**Track record:** npm scope `@agentlair` — ~1,600 downloads/month aggregate across 5 packages as of 2026-05-17. Repo created 2026-03-13. All infrastructure on Cloudflare Workers + D1; no custom servers.

---

## Security architecture — why this is safer than the SaaS reflex suggests

The most common reviewer concern: "agent task bodies could contain sensitive information — why should they flow through a third-party SaaS?"

They don't. AgentLair's vault is **client-side AES-256-GCM**: your application encrypts data before it leaves your process, and the server stores opaque ciphertext it cannot read. Email transport uses **X25519 ECDH end-to-end encryption** — the server stores only ciphertext; keys are ephemeral per session. The behavioral telemetry collected by this integration (tool call names, latencies, token counts, completion status) contains no task body content — it is the same class of data as OpenTelemetry spans.

Zero-knowledge summary:
- **Vault data:** client-side AES-256-GCM; server stores opaque bytes
- **Email:** X25519 E2E; server stores ciphertext
- **Behavioral telemetry:** structurally equivalent to OTEL spans — no prompt/completion text

---

## What this PR adds

<!-- Describe what the integration adds. Be specific: which hook/middleware/exporter/adapter, what data it collects, what it enables. -->

- [ ] [Component description]
- [ ] [What the user gets]

## Design decisions

<!-- Why this approach vs. alternatives. Keep to 2-3 bullets. -->

- [ ] [Decision and rationale]

## Test plan

<!-- How did you verify this works? -->

- [ ] Unit tests pass: `npm test` / `bun test` / `pytest` (delete as appropriate)
- [ ] Manual test: [describe what you did]
- [ ] Example code runs against live AgentLair endpoint (optional but recommended)

## Checklist

- [ ] I've read the operator transparency block above and the linked pages
- [ ] No sensitive data (task bodies, user PII) is sent to AgentLair — only behavioral metadata
- [ ] The integration is opt-in (requires explicit API key configuration)
