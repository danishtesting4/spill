#!/usr/bin/env bash
# SPILL — one-command deploy to GitHub.
#
#   ./deploy.sh                       # repo "spill", public, on your account
#   ./deploy.sh --name my-spill      # different repo name
#   ./deploy.sh --private            # private repo (Pages needs a paid plan)
#   ./deploy.sh --dry-run            # print what it would do, change nothing
#
# Needs the GitHub CLI, logged in:  https://cli.github.com  →  gh auth login
# Everything it configures can also be done by hand (see DEPLOY.md).

set -euo pipefail
cd "$(dirname "$0")"

NAME="spill"
VISIBILITY="--public"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --name)    NAME="${2:?--name needs a value}"; shift 2 ;;
    --private) VISIBILITY="--private"; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)"; exit 1 ;;
  esac
done

say() { printf '\033[1m→\033[0m %s\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

run() {
  if [ "$DRY" = "1" ]; then printf '  [dry] %s\n' "$*"; else "$@"; fi
}

# ── preflight ────────────────────────────────────────────────
command -v git >/dev/null || die "git is not installed."
if ! command -v gh >/dev/null && [ "$DRY" = "1" ]; then
  warn "GitHub CLI not found — showing the plan with placeholder values"
  GH_MISSING=1
elif ! command -v gh >/dev/null; then
  cat <<'MSG'
✗ GitHub CLI (gh) is not installed.

Either install it — https://cli.github.com — and re-run:
    brew install gh      /      winget install GitHub.cli      /      apt install gh

…or skip the script entirely:
    1. create an empty repo at https://github.com/new  (no README, no .gitignore)
    2. git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main
    3. Settings → Pages → Source: GitHub Actions
MSG
  exit 1
fi

if [ "${GH_MISSING:-0}" = "1" ]; then
  OWNER="you"
elif ! gh auth status >/dev/null 2>&1; then
  [ "$DRY" = "1" ] || die "Not logged in. Run: gh auth login"
  warn "not logged in — showing the plan with placeholder values"
  OWNER="you"
else
  OWNER=$(gh api user -q .login)
  ok "logged in as $OWNER"
fi
SLUG="$OWNER/$NAME"

if [ -n "$(git status --porcelain)" ]; then
  warn "working tree has uncommitted changes — they will NOT be deployed"
fi

# ── 1. the repo ──────────────────────────────────────────────
say "repo $SLUG"
if [ "${GH_MISSING:-0}" != "1" ] && gh repo view "$SLUG" >/dev/null 2>&1; then
  ok "already exists"
  run git remote remove origin 2>/dev/null || true
  URL=$(gh repo view "$SLUG" --json sshUrl -q .sshUrl 2>/dev/null || echo "https://github.com/$SLUG.git")
  run git remote add origin "$URL"
else
  if [ "$DRY" = "1" ]; then
    echo "  [dry] gh repo create $SLUG $VISIBILITY --description '…'"
  else
    gh repo create "$SLUG" "$VISIBILITY" \
      --description "Anonymous confessions and evidence-first exposés — static site with GitHub Actions moderation" \
      --enable-issues >/dev/null
    ok "created"
    git remote remove origin 2>/dev/null || true
    git remote add origin "https://github.com/$SLUG.git"
  fi
fi

# ── 2. settings that make the pipeline work ──────────────────
say "enabling Pages (build_type=workflow)"
if [ "$DRY" = "1" ]; then
  echo "  [dry] gh api -X POST repos/$SLUG/pages -f build_type=workflow"
else
  if gh api -X POST "repos/$SLUG/pages" -f build_type=workflow >/dev/null 2>&1; then
    ok "enabled"
  else
    warn "could not enable Pages via API — do it in Settings → Pages → GitHub Actions"
  fi
fi

say "allowing workflows to write (needed for approve → commit → deploy)"
if [ "$DRY" = "1" ]; then
  echo "  [dry] gh api -X PUT repos/$SLUG/actions/permissions/workflow -f default_workflow_permissions=write"
else
  if gh api -X PUT "repos/$SLUG/actions/permissions/workflow" \
       -f default_workflow_permissions=write >/dev/null 2>&1; then
    ok "read and write"
  else
    warn "could not set it — do it in Settings → Actions → General → Workflow permissions"
  fi
fi

say "issue forms on (that's the moderation queue)"
run gh api -X PATCH "repos/$SLUG" -F has_issues=true >/dev/null 2>&1 || warn "could not toggle issues"

# ── 3. push ──────────────────────────────────────────────────
say "pushing $(git rev-parse --short HEAD) → $SLUG"
run git push -u origin main

# ── 4. watch the first deploy ────────────────────────────────
if [ "$DRY" != "1" ]; then
  say "waiting for the deploy (up to 4 min)"
  for i in $(seq 1 24); do
    read -r STATE RESULT <<<"$(gh run list --limit 1 --json status,conclusion \
      -q '.[0] | "\(.status) \(.conclusion // "-")"' 2>/dev/null || echo "unknown -")"
    printf '  %ss status=%s conclusion=%s\n' "$((i*8))" "$STATE" "$RESULT"
    [ "$STATE" = "completed" ] && break
    sleep 8
  done
  if [ "$RESULT" = "success" ]; then
    ok "deployed"
  else
    warn "run finished as: $RESULT — check Actions → Deploy SPILL to GitHub Pages"
  fi

  URL=$(gh api "repos/$SLUG/pages" -q .html_url 2>/dev/null || true)
  [ -n "$URL" ] && printf '\n\033[1m  %s\033[0m\n' "$URL"
  SHEET="$(gh api "repos/$SLUG" -q .html_url 2>/dev/null || echo "https://github.com/$SLUG")"
  printf '  admin desk: %s/site/admin.html\n' "$(printf '%s' "$URL" | sed 's#/$##')"
  printf '  repo:       %s\n\n' "$SHEET"
else
  echo
  echo "  [dry] push, then watch: gh run watch"
fi

cat <<'MSG'
Next, once it's live (2 clicks):
  Settings → Actions → General → Workflow permissions → Read and write
  (if the script already managed it, skip this)

Try the pipeline: Issues → New issue → "Drop something" → submit → add the "approve" label.
The wall rebuilds in about a minute.
MSG
