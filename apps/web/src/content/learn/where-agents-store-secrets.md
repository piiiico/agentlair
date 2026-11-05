---
title: "Where can my autonomous agent store API keys and secrets safely?"
description: "In a secrets manager the agent reaches with a short-lived identity, and ideally never in the model's context at all. Cloud secret managers, HashiCorp Vault, 1Password, and what AgentLair's vault does and doesn't do."
pubDate: 2026-11-05
schemaType: "TechArticle"
---

**Short answer:** in a secrets manager, fetched at run time with a short-lived identity, and kept **out of the model's context**. The safest secret is one the model never sees: a tool or proxy uses the key on the agent's behalf and returns only the result.

Never put secrets in the system prompt, in files the agent can read and paste, in its memory, or in a `.env` the agent's shell can `cat`. Anything in the context window can end up in a log, a reply, or a prompt-injected request to an attacker.

## Good places, by where the agent runs

| Agent runs on | Store secrets in | Agent authenticates with |
|---|---|---|
| AWS | [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) | IAM role on the task/function |
| Google Cloud | [Secret Manager](https://cloud.google.com/secret-manager/docs) | Service account / workload identity |
| Azure | [Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/overview) | Managed identity |
| Anywhere, many services | [HashiCorp Vault](https://developer.hashicorp.com/vault/docs) (or OpenBao) | Short-lived tokens; dynamic database credentials |
| Small team, mixed tools | [1Password service accounts](https://developer.1password.com/docs/service-accounts/) or similar | A scoped service-account token |

The pattern is the same in every row: the agent proves *what it is* with an identity the platform issues, and the secret store decides what it may read. No long-lived master key sits next to the agent.

## Three rules that matter more than the product

1. **Keep the secret out of the model.** Let a tool make the authenticated call. The model asks for "send this email", not for the SMTP password.
2. **Scope and expire.** One key per agent and per purpose, with the narrowest permissions, rotated or short-lived. When something leaks, you revoke one key, not everything.
3. **Log access.** Every read of a secret should leave a record the agent can't erase. See [audit logs for agents](/learn/ai-agent-audit-log).

## AgentLair's vault, honestly

AgentLair (our product) has a small key-value vault for agents that already use an AgentLair account. We tested it on November 5, 2026:

```bash
curl -s -X PUT https://agentlair.dev/v1/vault/my-key \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ciphertext":"<your encrypted blob, base64>"}'

curl -s https://agentlair.dev/v1/vault/my-key -H "Authorization: Bearer $AGENTLAIR_API_KEY"
```

It stored our test value as version 1 and returned it byte for byte. The store and the read each showed up as a signed entry in the account's audit log (`PUT` and `GET` on `/v1/vault/my-key`).

What it is **not**: a replacement for a cloud secrets manager. It returns exactly what you send, so **encrypt before you store**. The vault is built for client-side-encrypted blobs, not for plaintext keys. The free tier holds 10 keys, 3 versions each, up to 16 KB per blob. It doesn't issue dynamic credentials or hide a key from the agent that holds the API key. If your agent runs in AWS, GCP or Azure, use that cloud's secret manager. The AgentLair vault fits agents that live outside a cloud account and need a small, audited place for encrypted state that follows them between sessions.

For the larger question of whether an agent should hold credentials at all, see [Don't let agents hold their own credentials](/blog/dont-let-agents-hold-their-own-credentials).
