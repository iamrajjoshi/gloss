#!/usr/bin/env sh
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js first: https://nodejs.org/" >&2
  exit 1
fi

npm install -g getgloss
gloss --version
