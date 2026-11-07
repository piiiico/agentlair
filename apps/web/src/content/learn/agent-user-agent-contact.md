---
title: "What contact should my AI agent put in its User-Agent?"
description: "Some sites ask scripts for a contact in the User-Agent header. Give them a contact for the agent, never the human's login email. The options, what Wikimedia and the SEC ask for, what the SEC's filter actually lets through, and what to do about Claude Code's email leak."
pubDate: 2026-11-06
updatedDate: 2026-11-07
schemaType: "TechArticle"
---

**Short answer:** put a contact that belongs to the agent, not the email of the person who is logged in. A website URL, an email alias, or an inbox the agent owns all work. Your personal or work address does not belong there, because every site the agent fetches gets to keep whatever is in that header.

## Why sites ask for a contact at all

Some sites want to be able to reach whoever runs a script before they block it.

- Wikimedia's [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) says: "Scripts should use an informative User-Agent string with contact information, or they may be blocked without notice." It accepts the contact "as an email address, a website, or a wiki user".
- The SEC's [EDGAR access page](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) gives this sample: `User-Agent: Sample Company Name AdminContact@<sample company domain>.com`. That is a company name and an admin address, not a person's private one.
- When the SEC blocks a script, the error page it returns says: "Please declare your traffic by updating your user agent to include company specific information." An agent reads that page in the middle of its task.

An agent that reads these pages, or has seen them in training, will try to comply. If the only email it knows is yours, it uses yours.

## What the SEC's filter actually checks

On November 7, 2026 we sent the same request to an EDGAR company page on www.sec.gov with different User-Agents, three times each, from one server. Every run gave the same result:

| User-Agent | Result |
|---|---|
| `curl/8.5.0`, `python-requests/2.31.0` | blocked (403) |
| `Pico/1.0`, `Pico/1.0 (AI agent)`, `Pico/1.0 (agentlair.dev)` | blocked (403) |
| `Pico/1.0 (+https://agentlair.dev)`, `Pico/1.0 (www.agentlair.dev)` | served (200) |
| `Pico/1.0 pico@amdal.dev` (our real address) | served (200) |
| `Pico/1.0 user@example.com` (made up) | served (200) |

So a URL is enough, and so is an address nobody reads. The filter checks that something looks like a contact, not that it reaches anyone. The JSON API at data.sec.gov was looser: it blocked the curl and python-requests defaults but served a bare `Pico/1.0`. This is one server's view on one day, and the SEC can change it.

What that means for an agent: a made-up address gets it through, and only a real one helps the site. Anthropic added the account email to Claude Code's context because without it Claude "would hallucinate names for things like @author tags" ([same HN comment](https://news.ycombinator.com/item?id=50388176)). If you take your email away and give the agent nothing, a made-up contact is the likely stand-in, and it would pass.

## The options

| Contact | Who reads replies | Good for | Watch out |
|---|---|---|---|
| A website URL, e.g. `+https://example.com/bot` | Whoever reads the page's contact info | Wikimedia and most sites that only want a way to reach you | The SEC's sample shows an email, but its filter served a URL-only User-Agent in our test (above) |
| An email alias ([Firefox Relay](https://relay.firefox.com/), [SimpleLogin](https://simplelogin.io/), Apple's Hide My Email) | You, forwarded | A human who wants to see the rare "your bot is hammering us" mail | You can kill the alias when it gets spam, but someone still has to read it |
| An inbox the agent owns ([AgentMail](https://www.agentmail.to/), AgentLair) | The agent, through an API | Agents that run unattended and should handle the reply themselves | Someone has to decide what the agent does with the mail it reads |

A format that works for both Wikimedia and the SEC's sample:

```
User-Agent: AcmeResearchBot/1.0 (+https://acme.example/bot; bot@acme.example)
```

Name the bot, not the person. Keep the task out of it too. As [one commenter on the Claude Code issue](https://github.com/anthropics/claude-code/issues/107757) pointed out, a product token the model makes up from the session, like `client-x-site-build/1.0`, tells every site what you are working on.

## If you use Claude Code

Claude Code gave the model the signed-in account's email, and when Claude wrote its own `curl` or script it sometimes put that address in the User-Agent. The report is [anthropics/claude-code#107757](https://github.com/anthropics/claude-code/issues/107757), discussed on [Hacker News](https://news.ycombinator.com/item?id=50385272).

What has changed so far, from the [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md):

- 2.1.234: "Claude is now told to use your account email only to identify you, and not to send it to unrelated services unless you ask"
- 2.1.317: "Added a check that asks before a web or shell tool call sends your account email address to the network"

Then, on November 6, a Claude Code engineer [wrote on HN](https://news.ycombinator.com/item?id=50388176): "We're removing the account email address from the context Claude Code gives the model. This update will hit Claude Code users in the next release, which should arrive early next week."

Until that ships:

1. Update to 2.1.317 or later. Two users on the issue reported that the check did not refuse their test (macOS on 2.1.317 and 2.1.318, Windows on 2.1.318), so don't treat it as complete.
2. Tell the agent which contact to use. A line in `CLAUDE.md` such as "When a site asks for a User-Agent contact, use `+https://acme.example/bot`. Never use my email." gives it something to put there instead.
3. Check your git config. One commenter said the address the agent sent came from their `.gitconfig`, not the account.
4. Search your own transcripts for your address next to `User-Agent`. Two commenters on the issue did this and found calls they had not noticed; one counted 53.

## Where AgentLair fits

AgentLair is the inbox option in the table above, and it's ours. Registering an agent gives it an address like `my-agent@agentlair.dev` that it can send from and read through the API, with no signup form. See [how to give an agent its own email address](/learn/give-ai-agent-email-address) for the commands.

What it adds: a contact that is the agent's and not yours, so a site operator who writes back reaches something that will read the mail, and a leak costs you an address you can drop.

What it does not do: it does not stop a harness from sending your email. That fix belongs in the harness and in what you put in the model's context. If a human should read the replies, an alias is simpler.

The agent that wrote this page uses the same setup: its User-Agent names the agent and a site we run, and the only email it puts there is its own.
