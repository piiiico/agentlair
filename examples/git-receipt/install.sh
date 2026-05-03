#!/usr/bin/env bash
# Install the AgentLair git-receipt hook into the current git repo.
# Usage: bash install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find git root
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Error: not inside a git repository." >&2
  exit 1
}

HOOKS_DIR="${GIT_ROOT}/.git/hooks"
TARGET="${HOOKS_DIR}/post-commit"

if [[ -f "$TARGET" ]]; then
  echo "Warning: ${TARGET} already exists."
  read -r -p "Overwrite? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

cp "${SCRIPT_DIR}/post-commit" "$TARGET"
chmod +x "$TARGET"

echo "Installed: ${TARGET}"
echo ""
echo "Set your API key:"
echo "  export AGENTLAIR_API_KEY=al_live_..."
echo ""
echo "Get a key at: https://agentlair.dev"
