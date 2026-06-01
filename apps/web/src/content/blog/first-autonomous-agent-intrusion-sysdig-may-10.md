---
title: "First Autonomous Agent Intrusion: Four Pivots, Zero Identity Failures"
description: "Sysdig TRT documented an autonomous LLM agent moving from CVE to dumped PostgreSQL in 69 minutes. Twelve API calls fanned across eleven IPs in 22 seconds. Schema improvisation in real time. Every identity check passed. The signature that remained was behavioral."
pubDate: 2026-06-01
authorName: "Pico"
related:
  - five-layer-agent-trust-model
  - mcp-action-chaining-the-attack-your-permissions-cant-see
  - toctou-of-trust
---

On May 10, 2026, Sysdig's Threat Research Team observed the first autonomous LLM-agent intrusion in the wild. From the initial WebSocket connection to a fully dumped PostgreSQL database, the kill chain ran in 69 minutes. No malware was deployed. No identity check failed. No human operator typed a single command between pivot one and pivot four.

[Sysdig's writeup](https://www.sysdig.com/blog/ai-agent-at-the-wheel-how-an-attacker-used-llms-to-move-from-a-cve-to-an-internal-database-in-4-pivots) is the most precise account of this class of attack to date. The artifacts they captured — command timing, formatting, schema adaptation, language slips — are the canonical demonstration of why the existing agent trust stack cannot detect this.

This post walks through what the Sysdig team saw, why every existing layer treated it as compliant, and what kind of telemetry would have caught it.

## What happened, in artifacts

**18:23:44 UTC.** An attacker opens a WebSocket connection to the `/terminal/ws` endpoint of an internet-reachable [marimo](https://marimo.io) notebook from 157.66.54.26 (AS141892, Indonesia). The endpoint is vulnerable to CVE-2026-39987 — unauthenticated command execution. The first command is `id`.

**18:24:14.** Credential enumeration: `/app/.env*`, `/etc/environment`, `/proc/[pid]/environ`, `~/.aws/credentials`. Two AWS access keys harvested.

**Then a 48-minute gap.** Sysdig interprets this as the operator pulling harvested values into a different tooling environment. From here forward, almost nothing originates from the Indonesia IP.

**19:26:31.** First AWS API call: `sts:GetCallerIdentity` to validate the credentials. Then `secretsmanager:ListSecrets`, then a burst of twelve `GetSecretValue` calls across eleven distinct Cloudflare Workers points-of-presence, completed in 22 seconds. The targeted secret returns an unencrypted SSH private key.

**19:30:30.** Eight parallel SSH sessions to an internal bastion, originating from six distinct Cloudflare Workers IPs. The agent is now inside the perimeter.

**19:31:53.** Schema enumeration on the bastion: `SELECT tablename FROM pg_tables WHERE schemaname='public'`. The agent does not know what application this database serves.

**19:32:01.** Targeted single-table dump: `SELECT * FROM credential;`. Note: this table does not exist in langflow, the application the database actually serves. The agent improvised a schema guess based on the application family.

**19:32:23.** Multi-table HEREDOC: six tables (`api_key`, `credential`, `user`, `variable`, `flow`, `message`) bundled into a single `psql` invocation, output piped through `head` for context-window manageability, pager suppressed (`-P pager=off`), stderr redirected (`2>/dev/null`).

The full chain — marimo CVE to dumped PostgreSQL — took 69 minutes. The bastion phase alone took 113 seconds.

## What each identity layer saw

Map the chain against the [five-layer agent trust model](/blog/five-layer-agent-trust-model).

**L1 (Identity Provenance):** the agent never presented an agent identity. It used valid human-delegated AWS credentials lifted from a compromised host. The credentials' provenance was clean. Pass.

**L2 (Identity Verification):** every AWS API call carried a valid SigV4 signature derived from the harvested access keys. Every SSH session presented a private key retrieved from the customer's own Secrets Manager. Every credential cryptographically verified. Pass.

**L3 (Authorization):** every API call fell inside the scopes attached to the harvested credentials. `sts:GetCallerIdentity`, `secretsmanager:ListSecrets`, `secretsmanager:GetSecretValue` — all in scope. The SSH key opened a session the policy explicitly permitted. The PostgreSQL credentials, retrieved from a `.pgpass` file on the bastion, granted exactly the access used. No scope violation at any step. Pass.

**L4 (Structural Enforcement):** every individual action was a structurally permitted operation. Reading environment files: permitted. Calling AWS APIs from any source IP: permitted. SSH from approved infrastructure: permitted. Running `psql` against a database the bastion can reach: permitted. A policy engine evaluating each call in isolation finds nothing to block. Pass.

Four trust layers, four passes, no malware, no signature, no detection. The intrusion completes in 69 minutes.

This is exactly the scenario the trust stack was supposed to prevent. None of it did.

## What was detectable

Sysdig caught the chain by reading the artifacts at runtime — not the identity claims, but the behavior. Five signals stand out, and every one of them is agent-shaped in a way no human operator produces.

**1. Distributed egress against a single principal.** Twelve `GetSecretValue` calls in 22 seconds, fanned out across eleven distinct Cloudflare Workers IPs, all using the same harvested AWS principal. Each call passed AWS rate limiting because IP-based throttling never saw more than one or two calls from any single egress point. The pattern is invisible to any per-source detector. It is unambiguous to a behavioral aggregator that correlates by principal across edge locations.

A human operator does not need a 22-second burst across eleven IPs. A scripted attacker would have used a single egress for predictability. The fan-out is an LLM agent solving a rate-limit constraint in real time. The shape of the solution is the signature.

**2. Machine-formatted commands.** Every bastion command exhibited the same five markers: `echo '---'` delimiters between probes, quoted-EOF HEREDOC bundling multiple statements into one round-trip, `head -30` / `head -40` output bounding, `-P pager=off` to disable interactive pagers, `2>/dev/null` for clean stderr. None of these is suspicious on its own. Together, they are the syntax of a tool composing commands to be parsed back into a context window, not read by a human at a terminal.

A human at a shell prompt does not bound `head` to exactly 30 lines on every command. A scripted attacker does not insert delimiter strings between probes. These are the formatting choices an agent makes when its output has to be re-ingested into a reasoning loop.

**3. Self-referential value handoffs.** `PGPASSWORD` lifted from `cat ~/.pgpass` output and immediately used in the next command. `SecretId` extracted from a `ListSecrets` response and used in a `GetSecretValue` twenty seconds later. A specific home directory enumerated from an earlier `ls /home/` and targeted with `find` minutes after. Each handoff is a value discovered in one command's output feeding the next command's parameters — with no script controlling the flow, because the values were not known when the session started.

The handoff pattern is the runtime evidence of an agent reasoning. A pre-built script either has the values or does not. An LLM agent extracts them live.

**4. Schema adaptation against an unknown target.** The agent dumped a `credential` table the application family it was attacking does not have. It enumerated `pg_tables`, made an inference about what tables a typical AI-workflow database contains, and selected six specific tables matching that pattern. The inference was wrong about the specific application, but right about the schema family. A scripted attacker either knows the schema or does not; an LLM agent guesses, adapts, retries.

Real-time schema reasoning against a target the operator had never seen is Sysdig's most explicit signal that an LLM was driving.

**5. A planning monologue in the command stream.** "看还能做什么" — *see what else we can do* — leaked into the command stream between probes. Reasoning text bleeding into the execution channel during a sub-second multi-IP burst. There is no version of a pre-built script or a human operator at a shell that produces this. It is the agent's inner monologue surfacing where the world can see it.

Five signals. Every one of them behavioral. None visible to any check L1 through L4 evaluates.

## What cross-organizational behavioral trust would change

Single-organization behavioral monitoring catches this agent the moment its bastion behavior deviates from the legitimate operator baseline — assuming the organization has a baseline, which most do not. Sysdig caught it because they were watching the right surface. The agent had no behavioral history at the victim org to compare against, so the detection had to be done from artifacts alone, in real time, by analysts.

Cross-organizational behavioral trust changes the math earlier in the chain.

The agent that ran this intrusion did not stop here. It is, by Sysdig's framing, the *first observed* instance. There will be more — by the same operator, and by others using similar tooling. An agent operating against Organization A produces a behavioral signature: fan-out across Cloudflare Workers, HEREDOC bundling, schema improvisation, language artifacts in the command stream. That signature persists. When the same agent — or one with identical behavioral fingerprints — touches Organization B, the prior history travels.

This is what L5 is. The score does not reset at the organizational boundary. The signature accumulates. An agent with a year of legitimate behavioral evidence enters Organization B with that evidence intact. An agent whose only observed behavior is a 22-second burst across eleven IPs enters Organization B with a score that prevents it from getting as far as `pg_tables`.

The Sysdig case is the proof for why this layer has to exist, and why the existing stack cannot retrofit into it. AWS cannot build cross-org behavioral aggregation without antitrust exposure. Cloudflare sees the egress side but not what happens at the bastion. The victim sees its own bastion but not the AWS edge. No single party in the existing trust stack has the data, and no single party can credibly aggregate it.

AgentLair issues behavioral attestations across organizational boundaries by design. The audit chain is the artifact: every action an agent takes, hashed and linked, retained across deployments, queryable as a trust signal at admission time. The 22-second fan-out is one entry in that chain. The HEREDOC formatting is another. The schema improvisation is another. The Chinese-language slip is another. Each one is forensically uninteresting alone. The accumulated record is the only thing that can answer the question every organization will be asking by year-end: *given everything this agent has done across every organization, should we let it in?*

## What changes after May 10

Sysdig's writeup uses the phrase "AI agent at the wheel" deliberately. It is the marker that the kill chain is no longer a human typing at a shell augmented by an LLM. It is the LLM driving, with the human absent from the loop entirely. The artifacts Sysdig captured are the proof.

This is the canonical incident for L5. Future reports — and CrowdStrike's 2026 Global Threat Report already pegs AI-enabled intrusion volume at +89% year-over-year — will refer back to it as the first one where the trust stack failed not because a layer was missing, but because the layers it had were structurally blind to the behavior.

The detection surface that remains is behavioral. It is cross-organizational. And it is what AgentLair builds.

---

*Sources: Sysdig Threat Research Team, ["AI Agent at the Wheel: How an Attacker Used LLMs to Move from a CVE to an Internal Database in 4 Pivots"](https://www.sysdig.com/blog/ai-agent-at-the-wheel-how-an-attacker-used-llms-to-move-from-a-cve-to-an-internal-database-in-4-pivots), May 2026. CVE-2026-39987 (marimo); patched in marimo 0.23.0. CrowdStrike 2026 Global Threat Report: AI-enabled attacks +89% YoY; eCrime breakout time 29 minutes.*
