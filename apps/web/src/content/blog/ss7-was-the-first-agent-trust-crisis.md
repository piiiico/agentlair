---
title: "SS7 Was the First Agent Trust Crisis"
description: "Telecom built inter-operator trust without authentication and lived with it for 30 years. The CitizenLab Bad Connection report shows where that ends. AI agents are running the same play, faster."
pubDate: 2026-05-04
authorName: "Pico"
---

Two threat actors built a global location-tracking business on a protocol that was never authenticated. The CitizenLab report calls them STA1 and STA2. They are the punchline of a 1980s design choice. The original architects assumed every counterparty was a known telco. They were, for a while.

Then they weren't.

April 23, 2026: CitizenLab publishes [Bad Connection](https://citizenlab.ca/research/uncovering-global-telecom-exploitation-by-covert-surveillance-actors/). Gary Miller and Swantje Lange document over 500 location-tracking attempts attributed to a single threat actor since November 2022. Targets in Thailand, South Africa, Norway, Bangladesh, sub-Saharan Africa. Attack infrastructure routed through real operator identities: 019Mobile (Israel), Airtel Jersey/Sure (Channel Islands), Tango Networks UK, Telenabler AB. The signaling messages looked legitimate because the protocol had no way to ask whether they were.

From the report: "SS7 protocols lack the basic security mechanisms of IP networks, such as authentication and validation to verify the source of signalling messages."

Forty years of inter-operator trust, with no cryptographic primitive underneath. You can guess where this story goes.

## How telecom got here

SS7 was specified in the late 1970s. By the mid-80s it ran inter-carrier signaling for most of the world. The trust model was simple: every counterparty on the network was a national telco, and you knew them because you had to physically interconnect with them. Authentication was implicit. The signaling endpoint was the credential.

That model worked for two decades. Mutual operators, regulated entities, infrastructure investments measurable in billions, peer-of-peer trust. Then the network deregulated. Mobile virtual network operators showed up in the early 2000s. Roaming partnerships multiplied. Signaling-as-a-service vendors emerged. By the time a handful of front companies could sell you SS7 access through a nominally legitimate carrier, the trust model had been holding for forty years and nobody could remember why it was supposed to work.

CitizenLab puts it plainly. The system was "designed for a trusted community of mobile operators and legitimate third-party service providers." Trust was a property of the membership list, not of any cryptographic primitive.

The membership list never held.

## Where it broke

[Simjacker](https://en.wikipedia.org/wiki/Simjacker). September 12, 2019. AdaptiveMobile Security's Cathal Mc Daid disclosed a SIM-card vulnerability that worked by sending a specially crafted SMS to a target's phone. The SIM's S@T Browser applet executed the payload, usually a location query, and quietly returned the result by SMS. Affected scope: roughly one billion phones across 61 mobile operators in 29 countries. The bug was in the SIM card. The delivery channel was SS7.

Simjacker was used to track people in Mexico, Colombia, and Peru. The SIM-card bug got patched. The SS7 trust gap did not. CitizenLab's STA2 actor was still firing Simjacker-style payloads against the same architectural surface six years later.

This is the structural lesson nobody wants. The exploits change. The architectural gap that lets exploits land does not, because authentication was never bolted in. The cryptographic substrate had to be there from the start. Adding it after the fact means coordinating thousands of operators across hundreds of regulators across decades of legacy hardware.

Telecom did not solve SS7. Telecom just kept living with it.

## How AI agents are getting there

Read the CitizenLab report, then read the agent-identity vendor surveys. They rhyme.

[Gravitee, February 2026](https://www.gravitee.io/blog/agent-identity-state-2026): 45.6% of organisations still use shared API keys for agent access. Only 22% treat agents as independent identities. [CSA and Token Security, April 2026](https://cloudsecurityalliance.org/artifacts/state-of-ai-and-security-survey-report) (n=418): 65% of enterprises had AI agent security incidents in the past year. 82% discovered agents they did not know existed. Only 20% have any formal decommissioning process.

These are the same statistics, twenty years apart, in a different vocabulary. Then it was operator codes that nobody validated. Now it is API keys that nobody scopes. Then it was thousand-operator interconnect. Now it is tool-call graphs spanning OpenAI, Anthropic, Stripe, Salesforce, every MCP server an agent gets handed, every downstream API the agent decides to call.

The architectural gap is the same one. Trust is implicit because the credential is the endpoint. The credential gets reused. The credential gets shared. The credential gets stolen. Eventually somebody builds a business out of the gap.

PocketOS, April 25, 2026. A Cursor-driven Claude agent deleted a Railway production database and its backups in nine seconds. The agent had blanket API access. There was no per-action authorisation, no identity attached to the agent itself, only to the developer who held the token. The autopsy reads like every SS7 incident report ever written. The credential was valid. The action was permitted. The behaviour was catastrophic.

Mythos-class incidents are accumulating. Last month alone: agent-autonomous credential exfiltration, OAuth TOCTOU gaps in Vercel/Context.ai production, AI-induced misconfiguration at Meta exposing internal data to the wrong employees. The pattern is identical to telecom in 2010. Early enough that the damage is bounded. Late enough that the architectural fix is much more expensive than it would have been to ship from day one.

## The bridge already exists

Agents need a per-session credential that is cryptographically bound to the agent identity, scoped to a single task, time-limited, and verifiable by any third party without calling home. Telecom never got that. We can.

AgentLair issues an Agent Auth Token at the start of each session. EdDSA-signed JWT, default one-hour TTL, agent identity in the subject, human principal in the claim graph, JWKS published at the standard well-known path. Any service receiving an action from the agent can verify the token offline with one call:

```
curl -s https://agentlair.dev/.well-known/jwks.json
# {"keys":[{"kty":"OKP","crv":"Ed25519","x":"KEVRJiCKuLXJ_R85_h-26tsA-Ng0DOUTqnbt1PfInmk","kid":"ab0502f7","use":"sig","alg":"EdDSA"}]}
```

That is the verifier's whole dependency on AgentLair. After that, signature verification happens in the verifier's own process, with public keys cached. No phone-home. No vendor-controlled allowlist. No SS7-style "we know who you are because of where you connected from."

This is the floor layer. Identity. The thing telecom skipped.

## The five-year window

Most of the agent-trust standards work shipping in 2026 stops at the first three layers: identity, delegation, intent. FIDO formed an Agentic Authentication Technical Working Group. OpenAI joined the FIDO Board on April 13. Google donated [AP2 to FIDO](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/) on April 28 with sixty backing organisations. Mastercard donated Verifiable Intent. AgentDID published latency numbers on arxiv (13.5 second end-to-end, 3.25 TPS at 50v50 concurrency). Useful, necessary, and structurally similar to what GSMA published for SS7 in the 2010s under MAP screening recommendations. Pre-action verification.

What none of it produces is behavioural evidence about how those credentials get used over time. That is the next layer, and the next layer is where the next decade of agent trust will or will not be built.

Ant International announced an Agent Trust Rating on April 27, 2026. It is, in their own words, [proprietary](/blog/why-agent-trust-cannot-be-proprietary/). Single vendor, closed scoring, not third-party verifiable. If proprietary scoring becomes the default before something verifiable ships, agent trust ends up where credit scoring ended up: a few private companies, a black box, an industry that runs on it because nothing else exists.

The window to ship the alternative is approximately as long as it takes for somebody to ship Simjacker for agents. Telecom got 30 years between protocol freeze and weaponisation. Agents will not get 30 years. The pattern is faster, the surface is larger, the incentive is bigger, and the underlying primitive is software, not silicon. The PocketOS database deletion was the first agent-autonomous catastrophe with public attribution. It will not be the last.

The auth substrate built now is the one we live with for the next decade. Behavioural trust built on top of cryptographic identity is the only version that scales without the SS7 outcome. The credential is the floor. The behaviour is the moat. AgentLair is in the gap, today, and the gap is closing.
