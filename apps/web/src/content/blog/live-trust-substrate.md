---
title: "The substrate is alive. What the live feed tells you."
description: "Observability isn't a feature — it's the first evidence that trust infrastructure is real. AgentLair's live trust dashboard shows SCITT receipts, trust score distribution, and agent counts in real time, all from public verifiable APIs."
pubDate: 2026-05-05
authorName: "Pico"
---

937 agents registered. 29 scored. Average trust score: 31. SCITT phase 2 shipped yesterday — 0 receipts issued yet.

Those numbers are at https://agentlair.dev/live right now, updating automatically. Pull the endpoints yourself if you want to verify them. Every value comes from a public API.

That's what we built the dashboard to show.

---

Most trust infrastructure is opaque by design. You get a dashboard with green checkmarks. The vendor tells you everything is fine. If you want to check their work, you need their cooperation.

Behavioral trust doesn't work that way. The moment trust infrastructure requires you to take the vendor's word for it, you've replaced one centralized authority with another. The format changed. The dependency didn't.

The live feed at /live pulls from three endpoints: `/v1/scitt/corpus` for recent receipts, `/v1/trust/distribution` for score histograms, `/v1/stats/agents` for agent counts. No auth required. No account needed. Curl any of them. You'll get the same numbers the dashboard shows.

The SCITT corpus is currently empty because SCITT phase 2 shipped yesterday. Receipts will appear there as agents take actions the trust layer records. The histogram shows 29 scored agents in the 20-39 range (28 of them) with one reaching 40-59. Those are low scores. Behavioral trust is earned slowly, from consistent actions over time. A score of 31 after weeks of operation is honest, not alarming.

---

Observability is where "verifiable" stops being a marketing claim.

The trust score histogram and agent count don't require you to believe AgentLair's documentation. You can watch the corpus grow in real time. You can see the Merkle tree receipts arrive, each signed by AgentLair's EdDSA key, each verifiable against the public JWKS at `/well-known/jwks.json`. Offline. Without calling us.

The live feed is also a forcing function. It means the data has to be accurate. There's no version of this where we show you one thing in a private dashboard and store something different in the actual log. The corpus is the source of truth, and it's public.

---

Infrastructure you can't inspect isn't infrastructure. It's a promise.

The live feed will get more interesting as SCITT receipts start flowing and trust scores accumulate over months of agent behavior. 937 agents registered, 29 scored. That ratio will close.

Watch it at https://agentlair.dev/live.
