---
title: "L3 just got bought. L4 has no sellers."
description: "Two NHI acquisitions in seven days, a Five Eyes advisory, ServiceNow Knowledge 2026. Every L3 buyer in the agent stack is now a public company. The behavioral layer above it is still on the CISO wishlist."
pubDate: 2026-05-06
authorName: "Pico"
---

Last week was the loudest week for agent identity since the category had a name.

April 30. Palo Alto Networks announced [its intent to acquire Portkey](https://www.paloaltonetworks.com/company/press/2026/palo-alto-networks-to-acquire-portkey-to-secure-the-rise-of-ai-agents), the AI Gateway. Portkey routes trillions of agent tokens per month for enterprises that need a single chokepoint for outbound LLM traffic. Price not disclosed by Palo Alto; the [Economic Times put it at $120-140M](https://cybermagazine.com/news/palo-alto-networks-portkey-acquisition).

May 4. Cisco announced [its intent to acquire Astrix Security](https://blogs.cisco.com/news/cisco-announces-intent-to-acquire-astrix-security) for ~$400M ([Calcalist](https://www.calcalistech.com/ctechnews/article/dy5obf581)). Astrix runs the NHI category: discovery, governance, and lifecycle for API keys, service accounts, OAuth tokens, and the agents that hold them. It will land inside Cisco Identity Intelligence and Duo.

May 4. Proof joined the FIDO Alliance and announced [Know Your Agent](https://www.businesswire.com/news/home/20260501569763/en/Proof-Joins-FIDO-Alliance-to-Link-AI-Agent-Actions-to-Verified-Human-Identity). The model binds a NIST IAL2 verified human to the agent that acts on their behalf, cryptographically, at the moment of authorization.

May 1 to 2. CISA, NSA, ASD ACSC, CCCS, NCSC (NZ), and NCSC (UK), every Five Eyes agency at once, published [Careful Adoption of Agentic AI Services](https://www.cisa.gov/resources-tools/resources/careful-adoption-agentic-ai-services). Six governments coordinating on a single advisory tells you what's coming.

May 5. ServiceNow shipped [Autonomous Security & Risk](https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-launches-Autonomous-Security--Risk-integrating-Armis-and-Veza-to-govern-every-AI-agent-identity-and-connected-asset/default.aspx) at Knowledge 2026, fusing its Armis (asset intelligence) and Veza (non-human identity governance) acquisitions into one product. Armis watches the network, Veza maps the permissions, ServiceNow runs the workflow.

Five public events, one week. If you are a CISO, your inbox is full. What follows is an attempt to read it sequentially.

## What L3 covers

L3 is the layer that answers *is this agent allowed to do this thing right now?*

The deals last week round out the L3 catalog:

- Discovery and lifecycle of agent credentials. Cisco's Astrix and ServiceNow's Veza both ship this. Find every API key, OAuth token, and service account; rotate, scope, and decommission them.
- AI gateway and outbound LLM traffic control. Palo Alto's Portkey ships this. Inspect, route, rate-limit, and govern the prompts agents send to model providers.
- Asset intelligence under the agent. ServiceNow's Armis ships this. Know what hardware and OT the agent actually runs on.
- Human-to-agent identity binding. Proof and FIDO ship this. Bind a NIST IAL2 verified human to the agent's actions, cryptographically.

If you are renewing security budget for Q3 2026 and you do not yet have NHI hygiene, an AI gateway, asset intel under your agent fleet, and a Know-Your-Agent path to human identity, your existing security platform vendor will sell you all four by year-end. Cisco, Palo Alto, ServiceNow, and Microsoft (Agent Governance Toolkit, April 2026) are all pricing it now. The standalone L3 market is closing in front of you.

## What L3 does not cover

The Five Eyes advisory is the cleanest source on this. Read past the recommendations and look at what the document explicitly does not specify.

It mandates cryptographic agent identity. It does not specify how to monitor whether the agent's behavior matches the identity over time, across actions, or across organizations.

It mandates short-lived credentials. It does not specify how a third party verifies that an agent which presented short-lived credentials yesterday at organization A also behaved correctly at organization B six hours later.

It mandates human approval for high-impact actions. It does not define how to cross-check whether an agent is composing a high-impact outcome out of a sequence of low-impact actions. ExtraHop documented this action-chaining pattern in April.

And the part the advisory worries about most explicitly: agents can compromise their own audit logs. Altered files, changed access controls, deleted audit trails. The advisory says the records have to be tamper-evident. It does not specify the format, the third-party verification, or the trust signal that travels with the agent when it leaves your perimeter and operates inside someone else's.

Three things, then, that an L3 platform from your existing vendor cannot do today. It cannot tell your partners whether the agents you send them have a clean behavioral track record at every other organization those agents have touched. It cannot detect a sequence of innocent-looking calls that compose into a malicious outcome across systems, across hours, and across companies. And it cannot produce an audit trail the agent itself cannot rewrite, signed by a party your partners can verify without first calling Cisco, Palo Alto, or ServiceNow.

Call the layer whatever you like. Some people call it L4. The label is contested. Microsoft's [Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit) ships behavioral tiers in OSS but is single-deployment scope. [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) is a crypto-native reputation registry, niche by construction. [Armalo AI](https://armalo.ai) does financial staking on a small number of deployments. The category is structurally there. Commercially, no one has been picked.

## What this means for Q3 2026 budget

If you are designing a cycle that starts in three months, a practical sequence looks like this.

First: buy L3 through your existing security platform. Cisco, Palo Alto, ServiceNow, and Microsoft will absorb the standalone vendors at incumbent margins. Independent NHI startups are now an acquisition pipeline more than a procurement option. The renewal conversation is on your side; the vendors need the consolidation more than you do.

Second: reserve a line item for behavioral telemetry on agents. Not "AI security" generically. Specifically, the runtime record of what your agents actually did, signed in a form a third party can verify without trusting your vendor, retained long enough to satisfy [EU AI Act Article 12](https://artificialintelligenceact.eu/article/12/) (enforcement window opens August 2, 2026, six-month retention minimum).

Third, and smaller: reserve a line for cross-organizational trust signal. When your agent calls a partner API in Q4 2026, your partner is going to want a way to verify your agent's track record without taking your word for it. There is no incumbent product for this yet, and don't expect one to fall out of the same M&A pipeline. There may be one by Q1 2027.

The market is saying, in capital terms, that L3 is settled. It is not yet saying who will own the layer above it. The reasonable CISO move this quarter is to refuse to over-fund L3 (the consolidation hands you negotiating room) and to keep the cross-org behavioral line visible but unspent until a credible third party emerges.

## A note on what we are building

[AgentLair](https://agentlair.dev) is a small experiment in exactly that layer. A behavioral audit URL that travels with each agent, signed by an external party, verifiable from public material without calling us. It is early. We do not own a category. The category has not been picked yet. The Five Eyes advisory and the M&A wave above are why we think the next budget cycle is when CISOs start asking for one.

If you are scoping Q3 2026 and want to compare what L3 closes against what a cross-organizational behavioral API would actually need to look like, the [public docs](https://agentlair.dev/docs) and the earlier [layer breakdown](https://agentlair.dev/blog/the-l4-gap) are the shortest paths in.
