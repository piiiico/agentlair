---
title: "AWS marked the agent traffic. One Lambda hop later, the mark is gone."
description: "AWS shipped IAM context keys that label every MCP request. They stop at the first downstream service that runs customer code. Here is the gap that opens, and what L3 alone cannot close."
pubDate: 2026-05-07
authorName: "Pico"
cta: try
related:
  - l3-just-got-bought-l4-has-no-sellers
  - mcp-action-chaining-the-attack-your-permissions-cant-see
  - cloudflare-stripe-projects-spending-cap-not-trust
---

On May 6, AWS shipped the [AWS MCP Server generally available](https://aws.amazon.com/blogs/aws/the-aws-mcp-server-is-now-generally-available/) with two new IAM context keys. `aws:ViaAWSMCPService` is a boolean, set true on any request flowing through an AWS-managed MCP. `aws:CalledViaAWSMCP` carries the service principal of the originating MCP, with values like `aws-mcp.amazonaws.com` and `eks-mcp.amazonaws.com`. Both keys are injected at the service layer; callers cannot spoof them. CloudTrail records the same identifier under `invokedBy`.

Read [the announcement](https://aws.amazon.com/blogs/aws/the-aws-mcp-server-is-now-generally-available/) and [the IAM-for-MCP blog](https://aws.amazon.com/blogs/security/understanding-iam-for-managed-aws-mcp-servers/). AWS shipped the cleanest L3 control surface in the agent space. Credit where due.

Here is the part the GA walkthrough does not include.

## The bypass that survives the policy

The IAM-for-MCP blog ships this SCP example, verbatim:

```json
{
  "Sid": "DenyDeleteWhenAccessedViaMCP",
  "Effect": "Deny",
  "Action": ["s3:DeleteObject", "s3:DeleteBucket"],
  "Resource": "*",
  "Condition": { "Bool": { "aws:ViaAWSMCPService": "true" } }
}
```

Looks bulletproof. An agent routed through MCP cannot delete an S3 object. The context key is set at the service layer; nothing can lie about it.

Now have the agent call `lambda:InvokeFunction(my-cleanup-fn)`. The Invoke call itself is logged with `aws:ViaAWSMCPService=true` and is allowed. The Lambda runs under its own execution role and calls `s3:DeleteObject` from inside its handler. That call is from Lambda's principal, not the user's. The MCP context keys do not propagate through it, because Lambda is not a [Forward Access Session](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_forward_access_sessions.html) service. It runs your code with its own role.

The deny does not fire. The object is gone.

This is not a CVE. It is how IAM has always worked, and AWS does not flag it because there is no propagation to document. The shape generalizes to anything that runs customer code under its own principal: Step Functions tasks, EventBridge rule targets, CodeBuild projects, Glue jobs. Any L3 deny that hangs on the new context keys needs a mirror deny on the downstream role, evaluated without the context key. The IAM-for-MCP blog does not show that companion policy.

## Three more places L3 stops

`run_script`'s "no network" is a network ACL, not a sandbox. AWS describes the Python runtime as having no network access while inheriting your IAM permissions. boto3 still works; the sandbox exists so the agent can call AWS APIs. An IAM permission for `s3:PutObject` against a wildcard resource, common in development roles, lets the script write to any reachable bucket. The runtime is closer to managed Python with a non-AWS DNS filter than a security sandbox in the seccomp or V8-isolate sense. "No network" stops curl. It does not stop IAM-permitted exfil.

CloudTrail captures receipts, not conversations. The trail records every API call the MCP makes, including the new context keys and `invokedBy`. It does not record the prompt. It does not group calls into a session. "List IAM users, simulate their policies, create an access key for one of them" is a recon-then-pivot pattern; CloudTrail logs three calls in time order, nothing more. There is also a configuration trap: AWS's [own security guidance](https://aws.amazon.com/blogs/security/secure-ai-agent-access-patterns-to-aws-resources-using-model-context-protocol/) notes that MCP-originated downstream calls are classified as data events, so a customer who never enabled data event logging captures none of them. The trail is silent on the calls that mattered most.

Read-only is read-only-shaped. A role with `iam:Simulate*`, `iam:List*`, `lambda:InvokeFunction *`, and `cloudformation:UpdateStack` reads as read-only on quick audit. The agent enumerates every escalation path, invokes a forgotten privileged function, and updates a stack template that controls IAM. `run_script` is the multiplier; the model can sequence the entire recon-to-pivot pipeline inside one invocation and return a clean outcome to the user.

## What the gap actually is

L3 controls do exactly what they say. The new context keys mark the request at the service edge. The SCPs deny the call at evaluation. The Python runtime blocks the syscalls it claimed to block. CloudTrail records what AWS told you it would record, when you have enabled it.

The gap is one layer up. No L3 control can correlate prompt to tool sequence to outcome across services, because the prompt does not exist at the IAM evaluation point. An agent's behavioral profile, that it has run this kind of recon-to-mutation chain before, that its identity has accumulated trust over prior sessions, that the action it just requested fits or does not fit its history, is not a question IAM can answer. It is also not something CloudTrail can reconstruct after the fact, because the receipts do not reference the conversation that produced them.

That is L4. Behavioral telemetry that lives outside the agent runtime, signed by an authority the agent does not control, exposed to the service receiving the request before it honors the action. AgentLair issues an Agent Attestation Token, signs every action into a tamper-evident audit log, and exposes the behavioral aggregation through an x402-payable endpoint. The receiving service, AWS or otherwise, checks the trust score and decides whether to honor the call.

The CF+Stripe Projects launch made the financial half of this concrete: an agent can stay under a $100 monthly cap while registering sixty look-alike domains. The AWS MCP Server makes the IAM half concrete: an agent can route around `aws:ViaAWSMCPService` through any compute service that runs customer code. Both gaps are the same gap. The policy answers "did the action authorize?" when the question is "should this agent be doing this kind of action?"

L3 is necessary. AWS just shipped some of the strongest L3 primitives in the agent space. L4 is what they compose with. AgentLair runs there.

If you are integrating the AWS MCP Server in production: require an AAT alongside your IAM identity at provisioning. JWKS verification is five lines. Get one at [agentlair.dev](https://agentlair.dev).
