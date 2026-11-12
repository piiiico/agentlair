---
title: "How can an AI agent prove its identity to another service?"
description: "An agent proves who it is by signing with a key the other side can check: cloud workload identity, SPIFFE, Web Bot Auth, or a signed JWT like AgentLair's AAT. What each proves, what none of them prove, and a token you can verify yourself."
pubDate: 2026-11-05
schemaType: "TechArticle"
---

**Short answer:** the same way any software does. The agent holds a private key, and the service checks a signature against a public key published by someone it trusts. "Identity" here means *who is calling and who vouches for it*. It does not mean *which model is answering* or *whether it behaves well*. Those are separate questions, and mixing them up is the most common mistake in this area.

## Three questions people mean by "agent identity"

1. **Who is calling?** Which account, workload or operator sent this request. Solved today with keys and signed tokens. Everything below is about this.
2. **Which model produced this answer?** Only the model provider can prove that. Anthropic published research on November 2, 2026 on [provable inference](https://www.anthropic.com/research/provable-inference): a zero-knowledge proof that "the committed model produces these output tokens when evaluated", which "anyone who holds the commitment, the prompt, and the reply can check". The post calls it "intermediate progress, and not a completed research agenda": it covers an integer model under greedy decoding, and its benchmark (Llama 4 Maverick, one H100) costs about 70 to 95 times the GPU time of normal inference. Nothing in the post says it runs on any public model API today. Until it does, a model name inside a token is something the issuer *asserts*, not something anyone proves.
3. **What did it do, and can it be trusted next time?** That is records and track record: audit logs and behavior over time. See [audit logs for agents](/learn/ai-agent-audit-log) and [agent-to-agent trust](/learn/agent-to-agent-trust).

## Ways to prove "who is calling"

| Method | Who issues it | Fits when |
|---|---|---|
| Cloud workload identity (AWS IAM roles, Google Cloud service accounts, Azure managed identity) | Your cloud | The agent and the service both run in one cloud or trust its OIDC issuer |
| [SPIFFE](https://spiffe.io/) SVIDs (X.509 or JWT) | Your own SPIRE server | Many services across clusters inside one organization |
| OAuth client credentials / token exchange | Your identity provider (Okta, Entra ID, Auth0…) | The agent acts for a user or an enterprise app |
| [Web Bot Auth](/web-bot-auth) (HTTP Message Signatures) | The agent's operator, key published at a well-known URL | Agents calling public websites and CDNs |
| A signed agent token (AgentLair AAT, others) | A third-party issuer the service already trusts | Agents calling services *outside* the agent's own organization |

If both sides are inside one company, use what that company already has: workload identity or SPIFFE. For a list of services that issue these credentials, see [which services give agents verifiable credentials](/learn/agent-identity-credential-services). A separate agent identity service only earns its place when the agent calls someone who doesn't share your identity provider.

## Try it: issue and verify an AgentLair token

We ran this on November 5, 2026 from a fresh free account (register: `POST /v1/auth/agent-register`).

```bash
curl -s -X POST https://agentlair.dev/v1/tokens/issue \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"audience":"https://example.com","scopes":["email:send"]}'
```

Both `audience` and a non-empty `scopes` array are required. The response is an EdDSA JWT valid for one hour. Decoded, our live token carried exactly these claims:

```
iss, sub, aud, exp, iat, jti, did, al_scopes, al_audit_url, al_name
```

`sub` is the account, `did` is a `did:web` identifier for it, `al_scopes` is what you asked for. Accounts with at least 10 behavioral observations also get an `al_trust` snapshot. There is **no model claim**, on purpose: we could only assert one, not prove it.

Any service can check the token without an AgentLair account. The key is at `https://agentlair.dev/.well-known/jwks.json`:

```ts
const [h, p, s] = token.split(".");
const { kid } = JSON.parse(Buffer.from(h, "base64url").toString());
const { keys } = await (await fetch("https://agentlair.dev/.well-known/jwks.json")).json();
const key = await crypto.subtle.importKey("jwk", keys.find((k) => k.kid === kid),
  { name: "Ed25519" }, false, ["verify"]);
const ok = await crypto.subtle.verify("Ed25519", key,
  Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`));
```

On our test token this returned `true`, and `false` after we changed one byte. Also check `aud` is you and `exp` is in the future. A JWT library like `jose` does all of this in one call.

## What this does not prove

A valid signature proves the token came from the issuer and names an account. It does not prove the agent is honest, that its operator is who they say, or which model sits behind the account. Specs that carry a model name, such as the OIDC-A proposal's required `agent_model` claim ([arXiv 2509.25974](https://arxiv.org/abs/2509.25974)), carry a string the issuer wrote. Treat it that way.
