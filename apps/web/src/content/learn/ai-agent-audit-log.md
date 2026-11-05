---
title: "How do I keep an audit log of everything my AI agent did?"
description: "Log every run, model call, tool call and approval with shared IDs, send it somewhere the agent cannot edit, and make entries tamper-evident. OpenTelemetry for the traces, a signed log for the record, and a check you can run yourself."
pubDate: 2026-11-05
schemaType: "TechArticle"
---

**Short answer:** treat it as a security record, not debug output. Give every run an ID, log each model call, tool call, approval and outbound action against that ID, and write the log **somewhere the agent cannot change**. If the agent can edit or delete its own log, you don't have an audit log.

## What to record

For each action, enough to answer "who did what, on whose behalf, with what result":

- **Run context:** run ID, parent run ID (for sub-agents), the user or service that started it, agent name and version, model and its configuration.
- **Each step:** timestamp, action type (model call, tool call, HTTP request, file write, email), target, input summary or hash, result status, error.
- **Decisions by people:** who approved or denied what, and when.
- **Side effects:** anything that left the system: payments, messages, deploys, deletes.

Hash or redact sensitive inputs rather than storing them raw. A log full of customer data is a breach waiting to happen.

## Where to send it

- **Traces for engineers:** [OpenTelemetry](https://opentelemetry.io/) has [semantic conventions for generative AI](https://github.com/open-telemetry/semantic-conventions-genai), so model and tool calls show up as spans in whatever backend you already run (Grafana, Datadog, Honeycomb, Langfuse and others).
- **A record for auditors and incident reviews:** append-only storage the agent's credentials can't write to directly. Object storage with write-once retention, a separate logging account, or a hosted signed log.
- **Guidance:** OWASP and NIST both publish logging guidance that applies to agents. The [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) is a good checklist.

OpenTelemetry traces are great for debugging, but by themselves they are not tamper-evident. For "prove this is what happened", you also want each entry signed or hash-chained.

## Make it tamper-evident

Two common techniques:

- **Signatures:** whoever writes the log signs each entry. Changing an entry breaks its signature.
- **Hash chain:** each entry includes the hash of the one before. Deleting or reordering entries breaks the chain.

Both only help if the signing key belongs to someone other than the agent.

## Doing it with AgentLair

AgentLair is our product. It writes an audit entry server-side for each API call an agent makes through its account (email, vault, tokens), so the agent doesn't log itself. We checked this on November 5, 2026 with a fresh free account. After a handful of calls (issuing a token, sending an email, reading the inbox, storing a vault key), the log held an entry for each, including a failed request:

```bash
curl -s https://agentlair.dev/v1/audit/log -H "Authorization: Bearer $AGENTLAIR_API_KEY"
```

Each entry has `timestamp`, `category`, `action` (for example `email.send`, `auth.token_issue`), `method`, `path`, `status`, a hashed client IP, `prev_hash` and an Ed25519 `signature`. Fetch the verification key from `GET /v1/audit/verification-key` (authenticated) and check any entry:

```ts
const { public_key } = await (await fetch("https://agentlair.dev/v1/audit/verification-key",
  { headers: { Authorization: `Bearer ${KEY}` } })).json();
const key = await crypto.subtle.importKey("raw",
  Uint8Array.from(atob(public_key), (c) => c.charCodeAt(0)), { name: "Ed25519" }, false, ["verify"]);
for (const { signature, ...entry } of entries) {
  const ok = await crypto.subtle.verify("Ed25519", key,
    Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
    new TextEncoder().encode(JSON.stringify(entry)));
}
```

All 11 entries in our test verified, and each failed after we changed its `status` field.

**Limits, stated plainly:** AgentLair logs only what passes through AgentLair. Tool calls your agent makes elsewhere (your database, GitHub, a shell) need your own logging, such as OpenTelemetry. The hash chain runs across the whole platform, not per account, so one account can check each entry's signature but cannot check the chain on its own. And the signing key is ours, so you are trusting AgentLair not to rewrite history. That is better than trusting the agent, but it is still trust.
