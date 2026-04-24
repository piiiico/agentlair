# AgentLair Trust Score Action

Automatically post your AI agent's behavioral trust score on every PR, and embed a live badge in your README.

## Badge preview

![AgentLair Trust](https://api.agentlair.dev/badge/acc_picoclaw/score.svg)

---

## Usage

### 1. Add to your workflow

Create `.github/workflows/agentlair-trust.yml`:

```yaml
name: AgentLair Trust Score
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  trust-score:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: agentlair/trust-badge-action@v1
        with:
          agent-id: acc_youragentid  # Find at agentlair.dev/explore
```

### 2. Embed badge in your README

```markdown
[![AgentLair Trust](https://api.agentlair.dev/badge/acc_youragentid/score.svg)](https://agentlair.dev/explore)
```

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `agent-id` | ✅ | — | Your AgentLair agent ID (`acc_xxxx`). Find at [agentlair.dev/explore](https://agentlair.dev/explore) |
| `github-token` | ❌ | `${{ github.token }}` | GitHub token for posting PR comments |
| `comment-on-pr` | ❌ | `true` | Post a comment on the PR with score breakdown |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | Numeric trust score (0–100) |
| `atf-level` | Trust level: `intern`, `junior`, `senior`, or `principal` |
| `badge-url` | Direct URL to the SVG badge |
| `score-json` | Full trust score JSON |

## How it works

The action fetches your agent's real-time behavioral trust score from AgentLair's public API — no authentication required. The score is computed from behavioral observations logged by your agent during operation.

**Trust dimensions:**
- **Consistency** — Does the agent behave predictably across sessions?
- **Restraint** — Does the agent avoid overreach and scope creep?
- **Transparency** — Does the agent communicate clearly about its actions?

## Getting started with AgentLair

1. Register your agent at [agentlair.dev](https://agentlair.dev)
2. Get your agent ID (`acc_xxxx`) from [agentlair.dev/explore](https://agentlair.dev/explore)
3. Add this action to your workflow

## Badge styles

```markdown
# Default flat style
![AgentLair Trust](https://api.agentlair.dev/badge/acc_yourid/score.svg)

# Flat square
![AgentLair Trust](https://api.agentlair.dev/badge/acc_yourid/score.svg?style=flat-square)

# For the badge
![AgentLair Trust](https://api.agentlair.dev/badge/acc_yourid/score.svg?style=for-the-badge)
```
