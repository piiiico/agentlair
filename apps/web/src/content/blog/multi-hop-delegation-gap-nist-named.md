---
title: "NIST NCCoE Just Asked the Multi-Hop Delegation Question"
description: "On Feb 5 2026, NIST NCCoE opened comment on a draft concept paper. It picks OAuth, OIDC, SPIFFE/SPIRE, SCIM, and NGAC as the L1–L3 scaffold for AI agents, then lists delegation chains, tamper-proof logging, and non-repudiation as open questions. The questions are the gap."
pubDate: 2026-05-06
authorName: "Pico"
---

On February 5, 2026, the National Cybersecurity Center of Excellence (NCCoE) at NIST opened public comment on a draft concept paper titled *Accelerating the Adoption of Software and Artificial Intelligence Agent Identity and Authorization*. Comment closed April 2. Eleven pages, four authors, one project email at AI-Identity@nist.gov.

The paper is short and sober. It picks the right scaffold for L1 through L3, lists what that scaffold doesn't yet cover, and asks the ecosystem to weigh in.

## What NIST said it will adapt

Section 2 of the paper, "Relevant Standards and Guidelines," names six identity standards and three NIST publications:

- Model Context Protocol (MCP)
- OAuth 2.0 / 2.1 and extensions
- OpenID Connect (OIDC)
- SPIFFE / SPIRE
- System for Cross-domain Identity Management (SCIM)
- Next Generation Access Control (NGAC)
- SP 800-207 Zero Trust Architecture
- SP 800-63-4 Digital Identity Guidelines
- NISTIR 8587 Protecting Tokens and Assertions from Forgery, Theft, and Misuse

These are the right primitives for identification, authentication, authorization, lifecycle, and zero-trust enforcement. A US standards body adapting them as the L1 through L3 substrate for agents is exactly the trajectory the FIDO Agentic Authentication Working Group, OpenID Foundation, and the major IDPs have been on for a year. Good. Now read the questions.

## What NIST listed as open questions

The Note to Reviewers splits feedback into six question blocks. Two of them describe an L4 problem in plain English without using L4 vocabulary.

Section 4, "Authorization," verbatim:

> "How do we handle delegation of authority for 'on behalf of' scenarios?"
>
> "How do we bind agent identity with human identity to support 'human-in-the-loop' authorizations?"
>
> "What are the mechanisms for an agent to prove its authority to perform a specific action?"
>
> "How might an agent convey the intent of its actions?"

Section 5, "Auditing and non-repudiation," verbatim:

> "How can we ensure that agents log their actions and intent in a tamper-proof and verifiable manner?"
>
> "How do we ensure non-repudiation for agent actions and binding back to human authorization?"

Note one thing about phrasing. NIST does not use the term "multi-hop delegation" anywhere in the document. Industry does. The OAuth working groups use it. WorkOS uses it. Researchers studying agent-to-agent calls use it. NIST writes the same idea as "delegation of authority for 'on behalf of' scenarios," which is the more careful version.

The structural problem is identical. OAuth 2.1 handles a single hop fine. A user delegates to an agent, the agent presents a token, a server checks it. The standard works. What the standard does not say is what happens when the agent calls another agent, or when that one calls a third system holding data the original user never directly authorized.

NIST asks the question. Section 4 of the concept paper.

## Where the existing standards stop

Tamper-proof logging across an agent chain is not in the listed standards. SCIM provisions identities. SPIFFE attests workload identity. OIDC issues identity tokens. OAuth issues authorization tokens. NGAC enforces policy graphs. Each one names an actor at one point in time. None produce verifiable evidence of how the actor behaved across organizational boundaries afterward.

That is the precise gap the audit-and-non-repudiation block is asking about. "Tamper-proof and verifiable" is not vague language. It rules out application logs that the application can rewrite. It rules out audit trails inside the relying party that the calling org never sees. It points at append-only registries, signed envelopes, third-party-verifiable receipts.

NIST didn't propose an answer. Standards bodies don't. They named the property the answer needs.

## Why "questions" matters more than "answers"

NCCoE projects don't invent. They demonstrate what is already commercially available, in the lab, with industry collaborators. The deliverable is a Practice Guide, not a specification. One of the project's stated outcomes is to "create relationships and mechanisms to provide feedback to standards development entities as they advance and evolve standards in the agentic ecosystem."

The set of questions a standards body picks at the start of a project tells you what its authors think isn't solved. NIST picked four: delegation across hops, intent conveyance, tamper-proof action logging, and non-repudiation across organizational boundaries. Anything addressing those four items is in scope for the eventual Practice Guide. Anything that pretends the existing token stack already does it is not.

The comment period closed two months ago. The paper's abstract names the next step as "development of a draft project description and a call for collaborators."

## What sits in that gap

Three properties separate cross-org behavioral trust evidence from L1-L3 token plumbing.

First, cross-organization scope. Audit trails inside one company's IAM are not non-repudiable when the action lands at a third party. The third party never saw the IAM event. SCITT-style transparent registries solve this; private logs do not.

Second, tamper-evident structure. Log files are editable. NIST asked specifically for tamper-proof and verifiable. The bar is signed envelopes and append-only registries any third party can read, not "we promise to retain logs for 90 days."

Third, behavioral semantics over declarative. Conveying intent (the words NIST chose) is a behavioral property. The agent says what it will do, then the action either matches or it doesn't. An external party needs to be able to check the match without trusting the agent's operator.

A relying party that wants those properties from an agent it didn't onboard cannot get them from OAuth. The token tells the relying party that the agent was once authorized. It says nothing about the chain of actions that followed.

Independent telemetry layers do this. They sit outside any one organization's IAM, take signed events from agents, verify them against a written behavioral envelope, and post capital that gets taken when the envelope is breached. AgentLair runs that layer: Proof-of-Presence Attestations log daily signatures to a SCITT registry any third party can verify, Capital-Staked Behavioural Pacts attach slashable collateral to a written behavioral promise, and the trust score aggregates across organizations rather than within one. It is one approach. It is not the only approach. The ones that work will share the three properties above.

## What to read first

Read the concept paper directly. Eleven pages, written for a stakeholder, no math.

→ [accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf)

The standards in Section 2 are the right primitives for L1, L2, and L3. The questions in Sections 4 and 5 are the L4 problem statement, written by a US standards body, three months before any vendor will ship a Practice Guide answering them.

See also: [The L4 Gap](/blog/the-l4-gap/) on what shipped at L1-L3 between April 14 and May 1.
