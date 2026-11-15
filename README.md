# SPILL — GitHub Pages + GitHub Actions build

Anonymous confessions and evidence-first exposés. Dark neon, moderation-first, and **no server to run**:
GitHub Pages serves the site, GitHub Actions does the backend work, and the repo itself is the database.

---

## The walls

| Page | What's on it |
| --- | --- |
| `index.html` | mixed feed, composer, drop-code tracker, house rules |
| `confessions.html` | confession-only wall: own hero, live counts, sort by newest / most felt, search |
| `exposes.html` | exposé-only wall, with the receipts framing and a report reminder |
| `admin.html` | moderation desk (see below) |

Each wall is a real, standalone page — linkable, searchable, and safe to share on its own. They all read
`data/wall.json`, so publishing once updates every wall.

## The moderation desk (`admin.html`, password `nightfall`)

| Tab | What it does |
| --- | --- |
| **Queue** | pending drops + anything reported, approve / reject with a reason / send back |
| **Confessions** | every live confession: alias, date, reaction counts, full text, search, sort |
| **Exposés** | every live exposé, same controls, plus hide-from-wall for claims that stop being safe |
| **Log** | last 40 decisions with reasons |
| **Publish & settings** | merge approvals into `wall.json` (hidden drops excluded), copy/download, password, reset |

Hiding a post marks it locally and leaves it out of the next `wall.json` export — regenerate and commit to
make it disappear from the public site. Counts for both kinds are in the header chips, so you can see the
shape of the wall at a glance (e.g. *confessions 5 · exposés 3 · pending 2*).

## Three ways a drop can travel

| Path | Who can post | Where it lives | Publish step |
| --- | --- | --- | --- |
| **Local draft** (default, `index.html`) | anyone, no account | that visitor's `localStorage` | approve in `admin.html` → export `wall.json` → commit |
| **GitHub issue** (`Send via GitHub` in the composer) | needs a GitHub account | issue → `data/pending/<n>.json` | moderator adds the `approve` label → bot commits to `data/wall.json` |
| **Anonymous form** (spreadsheet → CSV) | anyone, no account | row in a form response sheet | job imports the row as a bot-opened issue → same label flow |

All three end up in `data/wall.json`, which is what the wall renders. The two automated paths share one
rules engine (`scripts/lib/rules.mjs`), so validation, screening and scrubbing are identical.

---

## The Actions pipeline

```
issue opened
   │
   ├─ intake (scripts/ingest.mjs)
   │     validate length/type/consent ──► fail → label needs-fix, comment what to fix
   │     hard-block screen (CSAM, doxxing) ──► label needs-fix, close
   │     flag screen (threats, self-harm, intimate images) ──► still queued, label flagged
   │     scrub emails / phones / handles / links / addresses
   │     write data/pending/<issue>.json  (with drop code + alias)
   │     REWRITE the public issue with the scrubbed text
   │     label status:pending, comment the drop code
   │
   ├─ moderator adds label `approve`
   │     → append to data/wall.json, delete pending file
   │     → data/drops.json records status: approved
   │     → comment the alias + code, label status:published, close issue
   │     → commit → Pages redeployed in ~1 min
   │
   ├─ moderator adds label `reject`
   │     → data/drops.json records status: rejected + your reason
   │       (it reads your last maintainer comment on the issue)
   │     → comment, label status:rejected, close
   │
   └─ sweeper (daily, scripts/sweep.mjs)
         3 days undecided → one nudge comment, marked so it can't repeat
         7 days undecided → closed, status:expired, code reports `expired`
         closed by hand     → pending draft cleaned up, same status
```

A queue nobody clears is a pile of public issues containing someone's worst week, so nothing is allowed to
sit there forever. Tune it with repo variables `NUDGE_DAYS` and `STALE_DAYS`.
Statuses a drop code can now report: `pending`, `approved`, `rejected`, `expired`.

Two things that make this more than a toy:

- **The scrubber actually matters here.** On the client it's a courtesy; inside Actions it's enforced.
  The raw text is rewritten on the public issue before it stays public.
- **Drop codes work across devices.** `data/drops.json` is published, so a code can be checked from any
  browser — `localStorage` is no longer the only memory.

### Setup

1. Push this folder to a repo, then **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Actions → General → Workflow permissions**: allow read and write (the workflows request
   `contents: write` and `issues: write` explicitly; org-level policy can still block it).
3. **Settings → General → Features**: keep **Issues** on — that's the moderation queue.
4. Open an issue using the *Drop something* template, then try the `approve` label.
   The workflow auto-creates its own labels (`drop`, `status:*`, `flagged`, `needs-fix`, `spam`).

### Anonymous submissions (no GitHub account)

GitHub issues need an account, which is anonymity with a receipt. To drop that requirement, point a free form
service at the pipeline: `.github/workflows/import-form.yml` polls a CSV every 30 minutes, opens each new row
as an issue **as the bot**, and runs the same intake inline — so the poster never has an identity in the repo.

**Full copy-paste setup: [`docs/forms.md`](docs/forms.md).** Short version:

1. Google Form with four questions (`What kind of drop is this?` / `Headline` / `The story` / `Tags`),
   no email collection, no sign-in requirement.
2. Link responses to a Sheet, add the ~20-line Apps Script from the doc, deploy it as a web app that returns
   CSV only when a token matches — this keeps responses private instead of publishing them to the web.
3. Repo → **Settings → Secrets and variables → Actions → Secrets**: `FORM_CSV_URL` = the `/exec?token=…` URL.
   (Optional variable `FORM_MAX_PER_RUN`, default 15.)
4. Actions → *Import anonymous form submissions* → Run workflow.

Tally works too, but its free plan only exports CSV as a manual download, so you'd bridge through Google
Sheets or its API — details in the doc. The form host still sees the submitter's IP and timestamp; that's
better than a GitHub account, not equal to Tor.

### Costs and limits

- Public repo: Actions minutes and Pages hosting are free; this uses well under a minute per drop.
- Workflow latency is 10–40 seconds, occasionally minutes under load. Not a chat app.
- Commits made with the default `GITHUB_TOKEN` don't trigger other workflows (GitHub blocks the recursion),
  so `ingest.yml` and `import-form.yml` each run the Pages deploy themselves instead of relying on `pages.yml`.
- Everything in the repo is public, including `data/pending` — that's why the scrub runs *before* the
  pending file is written.
- If you outgrow it, `store.js` is the only file that changes to point at Supabase, a Cloudflare Worker or
  the original Express app in `../spill`.

---

## Files

```
spill-pages/
├─ index.html                  # mixed wall, composer (local draft + GitHub route), drop-code tracker, rules
├─ confessions.html            # confession wall
├─ exposes.html                # exposé wall
├─ wall.js                     # shared renderer for the two standalone walls
├─ admin.html                  # moderation desk: queue, live confessions, live exposés, log, publish
├─ styles.css                  # the whole design system
├─ store.js                    # browser data layer: localStorage + data/wall.json + data/drops.json
├─ app.js · admin.js           # UI logic
├─ data/
│  ├─ wall.json                # THE PUBLIC WALL — published drops live here
│  ├─ drops.json               # code → status index (so codes work on any device)
│  ├─ pending/<issue>.json     # queued drops awaiting a label (written by Actions)
│  └─ imported.json            # form-row dedupe log
├─ docs/forms.md               # anonymous submission setup (Google Forms, Tally)
├─ scripts/
│  ├─ ingest.mjs               # issue events → intake / approve / reject
│  ├─ import-form.mjs          # form CSV → bot-opened issues
│  ├─ sweep.mjs                # nudge, expire and clean up stale queue items
│  └─ lib/rules.mjs            # validate, screen, scrub, parse, publish  (shared, no deps)
│      lib/intake.mjs          # GitHub API client + intake, used by every entrypoint
├─ .github/
│  ├─ ISSUE_TEMPLATE/drop.md   # the submission form (also prefilled by the composer)
│  └─ workflows/
│     ├─ pages.yml             # deploy on push to main
│     ├─ ingest.yml            # issues → wall + redeploy
│     ├─ import-form.yml       # scheduled form import
│     └─ sweep.yml             # daily stale-queue sweep
├─ .nojekyll
└─ README.md
```

## Preview locally

```bash
python3 -m http.server 4173        # site
node scripts/ingest.mjs --dry-run  # pipeline, no API calls (needs SPILL_EVENT_JSON)
```

`--dry-run` prints every GitHub call it *would* make and still writes to `SPILL_ROOT`, so you can test the
whole pipeline offline:

```bash
SPILL_ROOT=/tmp/try SPILL_EVENT_JSON='{"action":"opened","issue":{"number":1,"user":{"login":"me"},"body":"### What kind of drop is this?\n\nConfession\n\n### Headline\n\nTest\n\n### The story\n\nLong enough to pass validation, honestly.\n\n### Confirm\n\n- [x] yes"}}' \
  node scripts/ingest.mjs --dry-run
```

## Known limits of the static build

- Local drafts never leave the browser, and clearing site data deletes them.
- The `admin.html` password gates a screen, not data. Nothing in a static site can be protected.
- Reactions and reports on published drops are per browser; there's no aggregate counter.
- Issue-based submissions are attached to a GitHub account. Use the form path if that's unacceptable.
- Screening is regex-based: it catches the obvious things and assumes a human reads the rest.
- Undecided drops expire after 7 days by default rather than waiting forever — `STALE_DAYS` controls it.
