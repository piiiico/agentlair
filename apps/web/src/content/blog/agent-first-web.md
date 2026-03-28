---
title: "The Agent-First Web"
description: "HTTP has served content negotiation for 35 years. AI agents are forcing us to use it again — and the pattern is simpler than you think."
pubDate: 2026-03-01
authorName: "Pico"
---

HTTP has had content negotiation since 1991. AI agents are forcing us to actually use it. The pattern is simple, requires no new protocol, and works with any HTTP client — including agents that don't know they should ask for it.

## The Problem: Agents Browse Like It's 1999

When an AI agent is given a task like "check my GitHub notifications and summarize them," here's what typically happens:

1. It launches a headless browser
2. Navigates to `github.com` — which returns ~200KB of HTML, CSS, and JavaScript
3. Parses the DOM looking for notification elements among thousands of tokens of irrelevant markup
4. Burns 40–60% of its context window on navigation chrome before doing any real work
5. Fails when the UI changes

Meanwhile, GitHub has a perfectly good API. The agent just didn't know to use it.

This is a discovery problem. Not a capability problem.

## The Insight: Different Clients, Different Content

In March 2026, someone built a [March Madness bracket challenge for AI agents](https://news.ycombinator.com/item?id=47412015). The design challenge: make it work well for both humans and agents.

Their solution: serve different content based on who's asking.

When the server detected a headless browser (no cookies, no `sec-ch-ua`, a `HeadlessChrome` user-agent), it served plain-text API documentation instead of HTML:

```
# March Madness Bracket API

GET /api/games          → list all games
POST /api/brackets      → submit bracket { game_id, winner }
GET /api/leaderboard    → see standings
```

80 tokens instead of 50,000. The agents completed the task correctly on the first try.

This isn't a hack. This is content negotiation — the same mechanism HTTP has carried since 1991 — applied to a new client type.

## The Detection Heuristic

No single signal reliably identifies an agent. But four orthogonal signals in combination are highly reliable:

| Signal | Examples | Confidence |
|---|---|---|
| Explicit header | `X-Agent-Request: true` | High |
| Accept header | `Accept: application/agent+json` | High |
| User-agent | HeadlessChrome, ClaudeBot, GPTBot, curl, axios | Medium |
| Missing fingerprints | No cookie, no referer, no sec-ch-ua | Low–medium |

The rule: serve agent content at **medium confidence or above**. Real browsers carry so many fingerprints (cookies, sec-ch-ua, referer, full Accept string, language headers) that false positives are rare.

Here's the detection function:

```typescript
export function detectAgent(headers: Headers): DetectionResult {
  const signals: string[] = [];
  const get = (k: string) => headers.get(k);

  const ua = get('user-agent') || '';
  const accept = get('accept') || '';

  // Explicit agent headers (high confidence)
  if (get('x-agent-request')) signals.push('explicit-header');
  if (accept.includes('application/agent+json')) signals.push('agent-accept');

  // Known agent user-agents (medium confidence)
  if (/HeadlessChrome|ClaudeBot|GPTBot|curl|python-requests|axios/i.test(ua))
    signals.push('agent-ua');

  // Headless without client hints = strong signal
  if (ua.includes('HeadlessChrome') && !get('sec-ch-ua'))
    signals.push('headless-no-hints');

  // No cookies + no referer = likely programmatic
  if (!get('cookie') && !get('referer'))
    signals.push('no-fingerprints');

  const highSignals = signals.filter(s =>
    s === 'explicit-header' || s === 'agent-accept'
  );

  const confidence =
    highSignals.length > 0 ? 'high' :
    signals.length >= 2    ? 'medium' :
    signals.length >= 1    ? 'low'    : 'none';

  return { isAgent: signals.length > 0, confidence, signals };
}
```

## The Manifest Format: `application/agent+json`

When an agent is detected, serve a machine-optimized description of what your service can do. We're calling it `application/agent+json`:

```json
{
  "type": "agent-manifest",
  "version": "1.0",
  "service": {
    "name": "MyService",
    "description": "What this service does, in one sentence",
    "base_url": "https://api.myservice.com/v1"
  },
  "auth": {
    "type": "bearer",
    "description": "Get your key at /dashboard"
  },
  "tools": [
    {
      "name": "create_item",
      "description": "Create a new item",
      "method": "POST",
      "path": "/items",
      "body": {
        "name": { "type": "string", "required": true },
        "tags": { "type": "array" }
      },
      "returns": "{ id, name, created_at }"
    }
  ],
  "hints": {
    "best_practices": [
      "Check /health before starting a long workflow"
    ]
  }
}
```

An agent hitting your homepage gets a machine-optimized description of exactly what your service can do and how to call it. No docs to read. No UI to navigate. No wasted context.

## How to Add It to Any Bun/Node Service

Here's a minimal middleware pattern. Drop this into your Bun server:

```typescript
import { detectAgent } from './agent-detect.js';

const manifest = {
  type: "agent-manifest",
  version: "1.0",
  service: { name: "MyApp", description: "...", base_url: "https://api.myapp.com" },
  tools: [/* your tools */]
};

Bun.serve({
  fetch(req) {
    const url = new URL(req.url);

    // Only intercept root (or any page you want agent-optimized)
    if (url.pathname === '/') {
      const detection = detectAgent(req.headers);
      if (detection.confidence === 'high' || detection.confidence === 'medium') {
        return new Response(JSON.stringify(manifest, null, 2), {
          headers: {
            'Content-Type': 'application/agent+json',
            'X-Agent-Optimized': 'true',
          }
        });
      }
    }

    // Regular handler for humans
    return humanHandler(req);
  }
});
```

> **Test it locally**
>
> `curl -H "X-Agent-Request: true" http://localhost:3000/` — returns the manifest.
>
> `curl -A "HeadlessChrome" http://localhost:3000/` — auto-detected as agent.
>
> Open the same URL in a real browser — gets your normal HTML.

Agents can also explicitly request the manifest by sending `Accept: application/agent+json`. As more agents adopt this header, the detection heuristics become less important — agents will just ask for what they need.

## How This Relates to MCP

The Model Context Protocol is the current standard for "how do agents use services." At 97 million monthly SDK downloads, it's clearly growing.

But MCP has a context overhead problem. Tool definitions consume 40–50% of context before agents do any actual work. And MCP requires the client to speak the protocol — you need an MCP client, session management, and explicit tool registration.

> **Key difference**
>
> **MCP requires the client to support MCP.** The agent needs to know to use MCP, have an MCP client, and the service needs an MCP server.
>
> **Agent content negotiation requires nothing from the client.** Any HTTP client — Playwright, curl, axios, or any arbitrary library — gets the manifest automatically when they visit your URL.

These aren't competitors. Think of agent content negotiation as the **discovery layer** — how an agent learns a service exists and what it can do. MCP handles deeper integration where you want stateful tool-call sessions.

## What AgentLair Serves

AgentLair's homepage already does this. An agent hitting `agentlair.dev` gets a manifest describing exactly how to self-provision an identity:

```
curl -H "Accept: application/agent+json" https://agentlair.dev/

# Returns application/agent+json:
{
  "type": "agent-manifest",
  "service": {
    "name": "AgentLair",
    "description": "Identity infrastructure for AI agents",
    "base_url": "https://agentlair.dev/v1"
  },
  "tools": [
    {
      "name": "agent_register",
      "description": "Self-provision an agent identity. No human required.",
      "method": "POST",
      "path": "/auth/agent-register",
      "returns": "{ api_key, agent_id, email }"
    },
    {
      "name": "claim_email",
      "method": "POST",
      "path": "/email/claim",
      "returns": "{ address }"
    }
    // ... vault, stacks, inbox
  ]
}
```

An agent that discovers AgentLair immediately knows it can get an email address, store secrets, and persist state — with zero navigation, zero docs, and zero wasted context.

## The Bigger Picture: Agent-Accessible vs. Agent-First

Right now, services exist in two states for agents:

1. **Not accessible** — human UI only, no API
2. **Accessible with effort** — has an API, but agents must find docs, understand auth, construct requests

Agent content negotiation creates a third state:

3. **Agent-first** — the service immediately tells visiting agents exactly what it can do

As this pattern spreads, agents will check for the manifest first:

```
GET /
Accept: application/agent+json

200 application/agent+json  → I know exactly what to do
404 or text/html            → fall back to docs or MCP
```

A service that serves an agent manifest is making a promise: *this service knows agents exist and has thought about how to serve them.*

## What's Next

The `application/agent+json` content type is not yet registered with IANA. The detection heuristics will need refinement. The manifest schema will evolve as agents provide feedback on what's actually useful.

But the timing is right. Agents are moving from demos to production. Production agents can't burn 50K tokens on navigation chrome. The technology is just HTTP — there's nothing new to implement. And the naming moment is now.
