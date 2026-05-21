#!/usr/bin/env sh
set -eu

method="${GLOSS_INSTALL_METHOD:-npm}"

if [ "$method" = "brew" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required for GLOSS_INSTALL_METHOD=brew" >&2
    exit 1
  fi
  brew install iamrajjoshi/tap/gloss
elif [ "$method" = "npm" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required. Install Node.js first: https://nodejs.org/" >&2
    exit 1
  fi
  npm install -g getgloss
else
  echo "Unknown GLOSS_INSTALL_METHOD: $method" >&2
  exit 1
fi

gloss --version

