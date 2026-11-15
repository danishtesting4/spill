#!/usr/bin/env bash
# SPILL — deploy to GitHub.
#
#   ./deploy.sh https://github.com/<you>/spill.git    # git only, no gh needed
#   ./deploy.sh --remote git@github.com:<you>/spill.git
#   ./deploy.sh                                       # with gh installed: creates the repo too
#   ./deploy.sh --retrigger                           # re-run the deploy after enabling Pages
#   ./deploy.sh --dry-run                             # print the plan, change nothing
#
# Git-only path: create an empty repo at https://github.com/new first (no README,
# no .gitignore), then pass its URL. Pages has to be switched on by hand — one click —
# because that setting has no git equivalent. Everything else is automated.

set -euo pipefail
cd "$(dirname "$0")"

REMOTE=""
NAME="spill"
VISIBILITY="--public"
DRY=0
RETRIGGER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --remote)   REMOTE="${2:?--remote needs a value}"; shift 2 ;;
    --name)     NAME="${2:?--name needs a value}"; shift 2 ;;
    --private)  VISIBILITY="--private"; shift ;;
    --retrigger) RETRIGGER=1; shift ;;
    --dry-run)  DRY=1; shift ;;
    -h|--help)  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)         echo "unknown option: $1 (try --help)"; exit 1 ;;
    *)          REMOTE="$1"; shift ;;
  esac
done

say()  { printf '\033[1m→\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = "1" ]; then printf '  [dry] %s\n' "$*"; else "$@"; fi; }

command -v git >/dev/null || die "git is not installed."

# ── retrigger mode: empty commit, push ───────────────────────
if [ "$RETRIGGER" = "1" ]; then
  say "re-running the deploy workflow with an empty commit"
  run git commit --allow-empty -m "chore: retrigger Pages deploy"
  run git push
  ok "pushed — watch Actions → Deploy SPILL to GitHub Pages"
  exit 0
fi

# ── work out owner/repo ──────────────────────────────────────
parse_remote() {
  local url="$1"
  case "$url" in
    https://github.com/*|http://github.com/*) SLUG="${url#*github.com/}"; SLUG="${SLUG%.git}" ;;
    git@github.com:*)                        SLUG="${url#git@github.com:}"; SLUG="${SLUG%.git}" ;;
    ssh://git@github.com/*)                  SLUG="${url#ssh://git@github.com/}"; SLUG="${SLUG%.git}" ;;
    *) SLUG="" ;;
  esac
  SLUG="${SLUG%/}"
}

HAS_GH=0
command -v gh >/dev/null && HAS_GH=1

if [ -z "$REMOTE" ] && [ "$HAS_GH" = "1" ] && gh auth status >/dev/null 2>&1; then
  OWNER=$(gh api user -q .login)
  SLUG="$OWNER/$NAME"
  REMOTE="https://github.com/$SLUG.git"
  say "GitHub CLI found — I can create the repo too ($SLUG)"
else
  if [ -z "$REMOTE" ]; then
    # maybe origin is already configured
    if git remote get-url origin >/dev/null 2>&1; then
      REMOTE=$(git remote get-url origin)
      say "using existing origin: $REMOTE"
    else
      cat <<'MSG'
✗ No remote to push to, and no signed-in GitHub CLI.

Two steps, then re-run this command:

  1. Create an empty repo (no README, no .gitignore):
       https://github.com/new    →  name: spill  →  Public

  2. Run:
       ./deploy.sh https://github.com/<your-username>/spill.git

(Install the GitHub CLI instead if you'd rather skip step 1:
 https://cli.github.com → gh auth login → ./deploy.sh)
MSG
      exit 1
    fi
  fi
  parse_remote "$REMOTE"
fi

if [ -n "${SLUG:-}" ]; then
  OWNER="${SLUG%%/*}"; REPO="${SLUG#*/}"
  [ -z "$OWNER" ] || [ -z "$REPO" ] || [ "$OWNER" = "$SLUG" ] && die "could not parse owner/repo from: $REMOTE"
  if [ "$REPO" = "$OWNER.github.io" ]; then
    PAGES_URL="https://$OWNER.github.io/"
  else
    PAGES_URL="https://$OWNER.github.io/$REPO/"
  fi
  ok "target: $SLUG"
else
  PAGES_URL=""
  warn "remote isn't a github.com URL — pushing only, no Pages check"
fi

if [ -n "$(git status --porcelain)" ]; then
  warn "uncommitted changes in the working tree — they will NOT be deployed"
fi

# ── create the repo when gh is available ─────────────────────
if [ -z "${SLUG_FROM_ARG:-}" ] && [ "$HAS_GH" = "1" ] && [ -z "${REMOTE_FROM_ORIGIN:-}" ]; then
  if [ -n "${SLUG:-}" ] && ! gh repo view "$SLUG" >/dev/null 2>&1; then
    say "creating $SLUG"
    if [ "$DRY" = "1" ]; then
      echo "  [dry] gh repo create $SLUG $VISIBILITY --enable-issues"
    else
      gh repo create "$SLUG" "$VISIBILITY" --enable-issues \
        --description "Anonymous confessions and evidence-first exposés — static site with GitHub Actions moderation" >/dev/null
      ok "created"
    fi
  fi
fi

# ── remote + push ────────────────────────────────────────────
say "pushing $(git rev-parse --short HEAD) → ${SLUG:-$REMOTE}"
if [ "$DRY" = "1" ]; then
  echo "  [dry] git remote add/set-url origin $REMOTE"
  echo "  [dry] git push -u origin main"
else
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$REMOTE"
  else
    git remote add origin "$REMOTE"
  fi
  git push -u origin main
  ok "pushed"
fi

# ── Pages: one manual click, then we verify ──────────────────
if [ -n "$PAGES_URL" ] && [ "$DRY" != "1" ]; then
  say "waiting for $PAGES_URL (up to 3 min)"
  echo "  If this stays 404, Pages isn't switched on yet:"
  echo "    Settings → Pages → Build and deployment → Source: GitHub Actions"
  echo "    then: ./deploy.sh --retrigger"
  LIVE=0
  for i in $(seq 1 18); do
    CODE=$(curl -s -o /dev/null -L --max-time 10 -w '%{http_code}' "$PAGES_URL" || echo 000)
    printf '  %2ss  %s\n' "$((i*10))" "$CODE"
    if [ "$CODE" = "200" ]; then LIVE=1; break; fi
    sleep 10
  done
  if [ "$LIVE" = "1" ]; then
    ok "live"
  else
    warn "not live yet — flip Pages on (Settings → Pages → Source: GitHub Actions), then run ./deploy.sh --retrigger"
  fi
fi

cat <<MSG

$(printf '\033[1m')What's next$(printf '\033[0m')
  site        ${PAGES_URL:-<your Pages URL>}
  admin desk  ${PAGES_URL:-<your Pages URL>}admin.html
  repo        https://github.com/${SLUG:-<owner>/<repo>}
  new drop    https://github.com/${SLUG:-<owner>/<repo>}/issues/new?template=drop.md

  Approve a drop = add the "approve" label to its issue. The wall rebuilds in ~1 min.
  No extra permission settings needed: every workflow declares its own scopes
  (contents/issues/pages: write), which overrides the repo-wide default.
MSG
