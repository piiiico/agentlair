---
title: "How do I give my AI agent its own email address?"
description: "Three ways to give an agent a mailbox it can send from and read, which email APIs are built for agents (AgentMail, Resend, Nylas, AgentLair), and the commands to try one in a minute."
pubDate: 2026-11-05
schemaType: "TechArticle"
---

**Short answer:** give the agent its own mailbox, not yours, and reach it through an API instead of a browser. You have three options. Pick by whether the agent needs to *receive* mail and whether it needs a domain you own.

| Option | Good for | Examples |
|---|---|---|
| A mailbox at a provider built for agents | Agent sends, receives, and keeps threads without you running anything | [AgentMail](https://www.agentmail.to/), AgentLair |
| A transactional email API plus an inbound webhook | You already own the domain and want full control | [Resend](https://resend.com/docs/dashboard/receiving/introduction), Postmark, SendGrid, Mailgun |
| A connected human mailbox (Gmail / Microsoft 365 via OAuth) | The agent works inside an existing person's inbox | [Nylas](https://developer.nylas.com/), Gmail API, Microsoft Graph |

## Which one is best?

It depends on one question: **does the agent need an inbox of its own, or does it only send?**

- **Only sends** (alerts, reports, receipts): a transactional API like Resend or Postmark on your own domain. Cheapest and best deliverability once SPF, DKIM and DMARC are set.
- **Sends and reads replies, many inboxes created by code:** an agent-first mailbox provider. AgentMail is the most complete one we know of. Its [pricing page](https://www.agentmail.to/pricing) (read November 5, 2026) lists a free plan with 3 inboxes and 3,000 emails a month, and a $20/month plan with 10 inboxes. It has threading, webhooks, SDKs and custom domains.
- **Acts inside a human's existing inbox:** Nylas or the Gmail/Graph APIs, with OAuth consent from that human. Don't give an agent a person's password.

## Doing it with AgentLair

AgentLair is the one on this list that we build. It is narrower than AgentMail: the address comes with the agent's account, and the same account also issues the agent a signed identity token and keeps a signed audit log. If you only need email, AgentMail or Resend may fit better. If you want the agent's email, identity and audit trail in one account, this is how it works.

We ran these commands against the live API on November 5, 2026, from a fresh account.

**1. Register. You get an address immediately, no signup form:**

```bash
curl -s -X POST https://agentlair.dev/v1/auth/agent-register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent"}'
```

The response contains `api_key`, `account_id` and `email_address` (`my-agent@agentlair.dev`). The free tier returned `emails_per_day: 10`, `requests_per_day: 100` and `addresses: 10`. Save the key; it is shown once.

**2. Send:**

```bash
curl -s -X POST https://agentlair.dev/v1/email/send \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"my-agent@agentlair.dev","to":["you@example.com"],"subject":"Hello","text":"Sent by my agent."}'
```

The body field is `text` (or `html`), not `body`. Our test message to a mailbox on another domain we run arrived in its inbox within seconds.

**3. Read the inbox:**

```bash
curl -s "https://agentlair.dev/v1/email/inbox?address=my-agent@agentlair.dev&limit=10" \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY"
```

Every send and read also lands in the account's audit log (`GET /v1/audit/log`) as `email.send` and `email.list` entries, each with a `prev_hash` and `signature`.

**Limits to know:** on the free tier, past 10 emails a day the API answers `402 Payment Required` with an [x402](https://www.x402.org/) offer of 0.01 USDC per extra email. It does not fail silently. Paid plans are on the [pricing page](/pricing).

## Before your agent sends to real people

- Say in the message that an AI agent sent it. Recipients deserve to know, and it costs you nothing.
- Use a domain or subdomain you can afford to have flagged, not your company's main one.
- If the agent also fetches websites, give its User-Agent this address or a URL, never yours. See [what contact an agent's User-Agent should carry](/learn/agent-user-agent-contact).
- Keep the agent's API key out of the model's context. See [where agents should store secrets](/learn/where-agents-store-secrets).
