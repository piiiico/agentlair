---
title: "Four AI Frameworks Fell This Week. None of Them Had To."
description: "LiteLLM supply chain. Langflow CISA KEV. LangChain CVSS 9.3. These aren't separate problems. They're the same architectural flaw repeating itself across every framework in the stack."
pubDate: 2026-03-28
authorName: "Pico"
---

In seven days, the AI developer stack suffered its worst security run on record.

**March 24**: TeamPCP pushed poisoned LiteLLM packages to PyPI. A malicious `.pth` file loaded automatically on Python import, silently harvesting cloud credentials, API keys, and Kubernetes secrets from every machine that ran `pip install litellm`. No fork bomb. No noise. Just a quiet credential exfiltration across 480 million weekly downloads.

**March 27**: CISA added Langflow to its Known Exploited Vulnerabilities catalog. CVE-2026-33017 — a single crafted HTTP request triggers arbitrary Python execution via an exposed API endpoint. Langflow runs AI agent workflows, which means it runs with broad filesystem and network access. Exploited within hours of disclosure.

**March 27** (same day): Three CVEs disclosed in LangChain and LangGraph. CVE-2026-34070: path traversal in LangChain's prompt loader, enabling arbitrary file reads without validation. CVE-2025-67644: SQL injection in LangGraph's SQLite checkpoint, leaking conversation history. CVE-2025-68664 (CVSS 9.3, the "LangGrinch"): passing a crafted data structure tricks LangChain's deserializer into treating it as a serialized LangChain object — and the API keys and environment secrets in memory walk out the door.

Four frameworks. Five CVEs. Fifty-two million LangChain downloads a week.

---

## The Monoculture

These aren't four separate problems. They're the same problem in four places.

Every affected framework shares one structural property: **credentials live where code runs**.

Your LangChain agent needs to call OpenAI. So you put `OPENAI_API_KEY` in your environment variables, and LangChain reads it via `os.getenv()`. Now the key lives in your Python process. Langflow stores credentials in its local SQLite database so it can reconnect to integrations. LiteLLM keeps API keys in memory to route requests across 100+ providers. They have to — that's how they work.

When CVE-2025-68664 tricks LangChain's deserializer, your API keys are right there in memory. When the LiteLLM `.pth` attack injects code into the Python path, your credentials are right there in the environment. When Langflow's exposed endpoint lets an attacker run arbitrary Python, your secrets are in the SQLite file on disk.

The attack doesn't need to be sophisticated. Any code execution, any deserialization of untrusted input, any path traversal into the right directory — the credentials are local, so any access to the process is access to the credentials.

---

## Patching Is Not the Architecture

The vendors responded. LangChain released `langchain-core ≥1.2.22`. LangGraph released `langgraph-checkpoint-sqlite 3.0.1`. Langflow released 1.8.2. LiteLLM yanked the compromised versions.

This is the right response to the discovered vulnerabilities. It is not a fix to the underlying pattern.

CVE-2025-67644 will be patched. CVE-2026-34070 will be patched. New CVEs will be filed. A recent analysis of 177,000 MCP tools found that action tools went from 27% to 65% of usage in 16 months. The blast radius of any single framework vulnerability is expanding, not shrinking. Frameworks running with broader access will have more to lose when the next bug ships.

Patch velocity can't outrun the attack surface. The architecture has to change.

---

## What Vault-First Looks Like

The structural fix is out-of-process credential storage.

If your credentials don't live in your framework, no framework vulnerability can leak them.

AgentLair's vault stores credentials server-side. Your agent makes a request:

```
GET /vault/{key_name}
Authorization: Bearer <agent-ed25519-token>
```

The vault checks the requesting agent's identity — a unique Ed25519 keypair bound to that agent at registration. If the identity is valid and the key is authorized, the vault returns the secret over an encrypted channel and logs the access with timestamp, requesting agent ID, and key name.

The credential is never in your LangChain process. It's never in your environment variables. It's never in your `.pth` files.

CVE-2025-68664 exploits in-memory deserialization. If your OpenAI key isn't in LangChain's memory, there's nothing to deserialize out. The TeamPCP `.pth` attack reads environment variables. If your API keys aren't in environment variables, there's nothing to harvest.

---

## The Execution Layer

Langflow's CVE-2026-33017 is a different class: not credential theft but arbitrary execution. An exposed API endpoint runs unsandboxed Python. This is harder to architect around at the framework level.

But it maps onto another gap: agent actions without approval gates.

When CVE-2026-33017 fires, it runs arbitrary Python with whatever access Langflow already has — filesystem writes, network connections, database queries. All in scope.

An approval gate intercepts actions before execution. Not "does this Python code look safe" (that's gameable) — but "is this action type within the approved scope for this agent?" If your Langflow instance isn't authorized to execute shell commands, an RCE that tries to run shell commands hits a gate instead of a filesystem.

This doesn't fix Langflow's CVE. It bounds the blast radius of any exploit, not just this one.

---

## The Week as a Signal

This week wasn't exceptional. It was representative.

The frameworks getting hit aren't unusually buggy. LangChain has been in production long enough to have mature tooling and engaged security researchers. Langflow is widely deployed precisely because it works well.

What they share isn't poor code quality. It's an architecture where credentials and execution authority live in-process, accessible to any bug in any dependency, any attacker in any supply chain, any CVE in any component they touch.

Vault-first changes that. The credential is a request to an external service with a logged audit event, not a local variable. The compromise of a framework becomes a credential-less intrusion rather than a silent harvest.

None of the frameworks that fell this week had to fall. The architecture was the choice.

---

*AgentLair provides a vault API and agent identity layer for AI frameworks. Credentials stored out-of-process, accessed over an authenticated, audited channel. [Read the docs →](https://agentlair.dev/docs)*
