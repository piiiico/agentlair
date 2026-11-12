---
title: "Which services give AI agents verifiable identity credentials like JWTs?"
description: "A short list of services that issue AI agents a signed credential another service can check: Microsoft Entra Agent ID, AWS AgentCore Identity, Okta's ID-JAG, SPIFFE JWT-SVIDs, Vigil's VC-JWTs, The Colony's agent SSO and AgentLair's AAT. What each one issues, where it fits, and how to check a token yourself."
pubDate: 2026-11-12
schemaType: "TechArticle"
---

**Short answer:** if your agent lives inside one company's cloud or identity provider, use that provider: Microsoft Entra Agent ID, AWS Bedrock AgentCore Identity, Okta, or SPIFFE for your own workloads. If the agent has to prove itself to services that do *not* share your identity provider, you need a token from an issuer they can check on their own. Vigil (W3C VC-JWTs), The Colony (OIDC id_tokens) and AgentLair (EdDSA JWTs, the one we build) do that. All of them prove *which account is calling*. None of them proves the agent is honest, or which model is behind it.

We read each provider's own documentation on November 12, 2026. Links go to the page we read.

## The list

| Service | What it issues | Fits when |
|---|---|---|
| [Microsoft Entra Agent ID](https://learn.microsoft.com/en-us/entra/agent-id/what-is-agent-id-platform) | Tokens from Entra's OAuth 2.0 / OIDC service, for app-only and delegated access | You are a Microsoft 365 / Entra shop. Microsoft's page says extending Entra security features to agents requires Microsoft Agent 365. |
| [Amazon Bedrock AgentCore Identity](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity.html) | Agent identities "implemented as workload identities", plus managed credentials for AWS and third-party services | The agent runs on AWS and calls AWS or OAuth-protected APIs for a user |
| [Okta AI agent token exchange](https://developer.okta.com/docs/guides/ai-agent-token-exchange/secret/main/) | Token exchange for registered AI agents, including ID-JAG (Identity Assertion JWT) via Cross App Access | Your users and apps already sit in Okta |
| [SPIFFE / SPIRE](https://spiffe.io/) | JWT-SVIDs and X.509-SVIDs from your own SPIRE server | Agents talking to other services inside your own infrastructure |
| [Agent Auth by Vigil](https://usevigil.dev/) | A `did:key` identity and W3C Verifiable Credentials as VC-JWTs, verifiable offline | You want the W3C credential format specifically. Vigil says it is free during its beta. |
| [The Colony agent SSO](https://thecolony.ai/developers/agent-sso) | An OIDC `id_token`, exchanged from a Colony API JWT | Your agent signs in to apps that have integrated with The Colony |
| [AgentLair AAT](/docs) | An EdDSA JWT, one hour, checkable against a public JWKS | Your agent calls services outside your organization, and you don't want them to need an account with anyone |

If Vigil's VC-JWT format is what you need, use Vigil. We don't issue W3C Verifiable Credentials. If the agent never leaves your own cloud, use the cloud's identity. A separate issuer only earns its place when the receiving side has no reason to trust your identity provider.

## An enterprise token vs a portable one

Entra, AgentCore and Okta tokens are checked by services that *already* trust that tenant: your own APIs, or apps you have connected. That covers most enterprise agents.

The harder case is an agent calling a site it has never seen: a public API, another company's MCP server, a shop. That site has no relationship with your tenant. What it can do is fetch a public key from a well-known URL and check a signature. Vigil, The Colony and AgentLair are built for that case. So is [Web Bot Auth](/web-bot-auth), which signs each HTTP request instead of issuing a token.

## Check one yourself

On November 12, 2026 we issued an AgentLair token from a free test account:

```bash
curl -s -X POST https://agentlair.dev/v1/tokens/issue \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"audience":"https://example.com","scopes":["email:send"]}'
```

It carried these claims, and expired one hour after it was issued:

```
iss, sub, aud, exp, iat, jti, did, al_scopes, al_audit_url, al_name
```

The receiving side needs no account. It reads the key from `https://agentlair.dev/.well-known/jwks.json` and checks the Ed25519 signature. The ten-line check is on [how an AI agent proves its identity](/learn/how-ai-agent-proves-identity). On this token it returned `true`, and `false` after we changed one character. The free plan on the [pricing page](/pricing) covers 3 agents and 1,000 verifications a month.

## What none of these prove

A valid signature proves an issuer vouched for an account. It doesn't prove the agent will behave, or that a model name inside the token is true. Vigil's own example puts `agent_model` in the registration request. That is a string the agent sent, not a fact anyone checked. For "can I trust this agent next time", you need its record: see [agent-to-agent trust](/learn/agent-to-agent-trust) and [audit logs](/learn/ai-agent-audit-log).
