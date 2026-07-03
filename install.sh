#!/usr/bin/env bash
set -euo pipefail

PACKAGE_SPEC="${CODEX_PROVIDER_NPM_SPEC:-codex-provider@0.1.0-alpha.0}"
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/codex-provider"
RAW_SKILL_URL="${CODEX_PROVIDER_SKILL_URL:-https://raw.githubusercontent.com/Gan-Xing/CodexProvider/main/skills/codex-provider/SKILL.md}"

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
}

if ! need_command node; then
  echo "Node.js >=24 is required before installing codex-provider." >&2
  echo "Install Node 24 first, then rerun this script." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "Node.js >=24 is required; current version is $(node -v)." >&2
  echo "Use nvm install 24 && nvm use 24, then rerun this script." >&2
  exit 1
fi

if need_command corepack; then
  corepack enable >/dev/null 2>&1 || true
fi

if ! need_command npm; then
  echo "npm is required to install the published codex-provider CLI." >&2
  echo "Local checkout fallback: run pnpm pack, then npm i -g ./codex-provider-*.tgz." >&2
  exit 1
fi

echo "Installing ${PACKAGE_SPEC}..."
npm install -g "$PACKAGE_SPEC"

mkdir -p "$SKILL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
LOCAL_SKILL="$SCRIPT_DIR/skills/codex-provider/SKILL.md"

if [ -f "$LOCAL_SKILL" ]; then
  cp "$LOCAL_SKILL" "$SKILL_DIR/SKILL.md"
else
  if ! need_command curl; then
    echo "curl is required to install the codex-provider skill from GitHub." >&2
    echo "CLI installed, but skill installation did not complete." >&2
    exit 1
  fi
  curl -fsSL "$RAW_SKILL_URL" -o "$SKILL_DIR/SKILL.md"
fi

echo "codex-provider CLI and skill are installed."
echo "Next prompt for Codex:"
echo "Use the codex-provider skill. Connect Codex to OpenRouter with model deepseek/deepseek-chat."
