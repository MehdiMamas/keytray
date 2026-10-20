#!/usr/bin/env bash
# Usage: scripts/release.sh <version>   e.g. scripts/release.sh 0.5.1
# Bumps package.json + package-lock.json, commits and tags. Never pushes.
set -euo pipefail

v="${1:-}"
if [[ ! "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <x.y.z>" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean; commit or stash first." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$v" >/dev/null; then
  echo "Tag v$v already exists." >&2
  exit 1
fi

npm version "$v" --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release v$v."
git tag "v$v"

branch=$(git rev-parse --abbrev-ref HEAD)
echo
echo "Committed and tagged v$v locally. Nothing was pushed. To release:"
echo "  git push origin $branch v$v"
