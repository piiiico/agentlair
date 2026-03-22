---
name: configure
description: Set up the AgentLair email channel — save API key and address, review access policy. Use when the user asks to configure AgentLair email, pastes an API key, or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(curl *)
---

# /agentlair-email:configure — AgentLair Email Channel Setup

Writes credentials to `~/.claude/channels/agentlair-email/.env` and orients
the user on access policy. The server reads both files at boot.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read both state files and give the user a complete picture:

1. **API Key** — check `~/.claude/channels/agentlair-email/.env` for
   `AGENTLAIR_API_KEY`. Show set/not-set; if set, show first 8 chars masked
   (`al_live_...`).

2. **Address** — check for `AGENTLAIR_ADDRESS` in the same file. Show the
   full address if set.

3. **Access** — read `~/.claude/channels/agentlair-email/access.json` (missing
   file = defaults: `policy: "open"`, empty allowlist). Show:
   - Policy and what it means in one line
   - Allowed senders: count and list

4. **What next** — end with a concrete next step based on state:
   - No API key → *"Run `/agentlair-email:configure <api-key> <address>` to
     set up. Get an API key at https://agentlair.dev/dashboard."*
   - Key set, no address → *"Run `/agentlair-email:configure --address
     you@agentlair.dev` to set the monitoring address."*
   - Both set, policy is open → *"Ready. Anyone who knows your address can
     email you. Run `/agentlair-email:access policy allowlist` to restrict
     access."*
   - Both set, allowlist configured → *"Ready. Only approved senders can
     reach you."*

**Push toward lockdown — always.** Open policy is convenient but a prompt
injection risk. Once setup is complete, suggest switching to allowlist.

### `<api-key>` or `<api-key> <address>` — save credentials

1. Parse `$ARGUMENTS`:
   - If one arg starting with `al_` → API key only
   - If two args → first is API key, second is address
   - If arg contains `@agentlair.dev` → address only
2. `mkdir -p ~/.claude/channels/agentlair-email`
3. Read existing `.env` if present; update/add the relevant lines, preserve
   other keys. Write back, no quotes around values.
4. Confirm, then show the no-args status so the user sees where they stand.

### `--address <addr>` — set monitoring address only

Update `AGENTLAIR_ADDRESS` in `.env`, preserve other keys.

### `clear` — remove credentials

Delete the `.env` file or specific keys.

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads `.env` once at boot. Credential changes need a session
  restart or `/reload-plugins`. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes via
  `/agentlair-email:access` take effect immediately, no restart.
