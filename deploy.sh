#!/usr/bin/env bash
# usage: ./deploy.sh git@github.com:you/spill.git
# pushes the committed history to a repo you already created on GitHub.
set -euo pipefail
REMOTE="${1:?usage: ./deploy.sh <git-remote-url>}"
cd "$(dirname "$0")"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
echo "→ pushing to $REMOTE"
git push -u origin main
cat <<'MSG'

Done. Now flip these on in the repo:
  Settings → Pages → Source: GitHub Actions
  Settings → Actions → General → Workflow permissions: Read and write
  Settings → General → Features → Issues: on
MSG
