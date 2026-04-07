---
title: "Memorix + AgentLair: Internal Coordination Meets External Reachability"
description: "Memorix manages what happens inside your agent team. AgentLair manages what comes in from outside. Together, they give agent teams a clean boundary."
pubDate: 2026-04-07
authorName: "Pico"
---

Every agent team has two boundary problems: coordination inside the team, and reachability from outside it.

Memorix solves the first. It gives each agent a stable identity, an inbox, file locking, and task coordination primitives — everything needed for agents in a team to work together without stepping on each other.

But Memorix is deliberately scoped to internal primitives. When an external caller — a human, a webhook, another agent team — needs to trigger your agents, or when your agents need to send an outbound notification, Memorix doesn't cover that. That's the boundary.

**AgentLair fills exactly that gap.** Each agent gets a stable email address. External callers send to that address. Your agents send from it. No credentials flow across the boundary.

---

## The Boundary Problem

Consider a CI/CD orchestrator built on Memorix: an agent team where a coordinator dispatches work to specialised worker agents. Internally, this runs cleanly — Memorix handles task queuing, locks, and state.

Now add external requirements:

- A developer needs to approve a deployment before the pipeline continues
- A worker agent hits a blocker and needs to escalate to a human
- The pipeline completes and needs to notify downstream systems

None of these are internal coordination. They're I/O across the team boundary. Solving them with internal primitives (polling endpoints, shared state) creates coupling that Memorix was designed to avoid.

The cleaner model: each agent that needs external reachability claims an AgentLair email address. External callers send emails to trigger the agent. The agent reads from its inbox, acts, and replies — or sends a new message to a different address.

---

## Setup

```bash
# Get an API key — no form, no email required
curl -s -X POST https://api.agentlair.dev/v1/auth/keys
# → { "api_key": "al_live_...", "backup_key": "al_bak_..." }

export AL_KEY="al_live_..."
```

---

## Give Your Memorix Agent an Email Address

Each agent that needs external reachability claims a unique address:

```bash
# Claim an address for your coordinator agent
curl -s -X POST https://api.agentlair.dev/v1/email/claim \
  -H "Authorization: Bearer $AL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"local": "ci-coordinator"}'

# → { "address": "ci-coordinator@agentlair.dev" }
```

The address persists across restarts. Publish it to whoever needs to trigger your agent.

---

## Receive Triggers from External Callers

Your coordinator polls its inbox on each work cycle:

```typescript
async function checkInbox(apiKey: string): Promise<Email[]> {
  const res = await fetch('https://api.agentlair.dev/v1/email/inbox', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const { messages } = await res.json();
  return messages;
}

// In your Memorix task loop:
async function coordinatorLoop(memorix: MemorxClient, apiKey: string) {
  while (true) {
    // Check external triggers
    const emails = await checkInbox(apiKey);
    for (const email of emails) {
      await memorix.enqueue('deployment-task', {
        trigger: email.subject,
        requester: email.from,
        replyTo: email.from, // capture for later reply
      });
    }

    // Process internal queue as normal
    await processQueue(memorix);
    await sleep(5000);
  }
}
```

---

## Send Outbound Notifications

When an agent needs to notify a human or downstream system, it sends from its claimed address:

```typescript
async function notifyApprover(
  apiKey: string,
  approverEmail: string,
  deploymentId: string
): Promise<void> {
  await fetch('https://api.agentlair.dev/v1/email/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ci-coordinator@agentlair.dev',
      to: approverEmail,
      subject: `Deployment approval required: ${deploymentId}`,
      text: `Reply with "approve" or "reject".`,
    }),
  });
}
```

The approver replies. The coordinator picks it up on the next inbox poll. No webhook infra. No credential sharing.

---

## Webhooks for Low-Latency Triggers

For time-sensitive pipelines, register a webhook instead of polling:

```bash
curl -s -X POST https://api.agentlair.dev/v1/email/webhooks \
  -H "Authorization: Bearer $AL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "ci-coordinator@agentlair.dev",
    "url": "https://your-agent-host.example.com/trigger",
    "secret": "your-hmac-secret"
  }'
```

AgentLair delivers each inbound email to your URL within seconds. The agent wakes up on demand rather than on a polling interval.

---

## The Credential Boundary

The key property of this architecture: **external callers need no credentials inside your agent team**.

A developer who wants to trigger a deployment sends an email. They don't need an API key, a Memorix token, or any knowledge of your internal topology. If you rotate your Memorix credentials, external triggers still work. If you replace Memorix with a different orchestration layer, the email addresses stay the same.

The email address is the public interface. Everything inside is private.

---

## Summary

| Layer | Tool | Scope |
|-------|------|-------|
| Internal coordination | Memorix | Agent identity, task queues, file locks |
| External reachability | AgentLair | Email addresses, inbound triggers, outbound notifications |

Memorix documents this as the intended model: "Memorix can stay focused on internal coordination primitives while an external channel like AgentLair handles reachability."

Get an API key at [agentlair.dev](https://agentlair.dev) — no form, no email.
