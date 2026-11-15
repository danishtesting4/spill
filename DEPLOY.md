# Deploy SPILL to your GitHub

Everything is committed on `main` and ready to push. No build step, no dependencies.

---

## Option A — git only (no `gh` needed)

**1. Create an empty repo**, 15 seconds: <https://github.com/new>

- Name: `spill`
- Public
- **Do not** add a README, .gitignore or license (the repo already has them)

**2. Unzip and run one command:**

```bash
unzip spill-pages.zip && cd spill-pages
./deploy.sh https://github.com/<your-username>/spill.git
```

That pushes `main`, then watches your Pages URL for up to 3 minutes and reports whether it came up.

**3. One click that git can't do:**

> **Settings → Pages → Build and deployment → Source: GitHub Actions**

Then, if the deploy run happened before you flipped that switch (it will have failed):

```bash
./deploy.sh --retrigger
```

which pushes an empty commit to re-run the workflow. That's it — `https://<you>.github.io/spill/`.

> **You do *not* need** to change Settings → Actions → Workflow permissions. All four workflows declare
> their own scopes (`contents: write`, `issues: write`, `pages: write`, `id-token: write`), and an explicit
> `permissions:` block overrides the repository default. A new repo defaulting to read-only is fine.

---

## Option B — with the GitHub CLI (creates the repo for you)

```bash
brew install gh        # or: winget install GitHub.cli / apt install gh
gh auth login          # GitHub.com → HTTPS → login via browser
unzip spill-pages.zip && cd spill-pages
./deploy.sh
```

The script creates `spill`, enables Pages, turns Issues on, pushes, and watches the first run.

Flags for both options:

| Flag | Effect |
| --- | --- |
| `--name my-spill` | different repo name |
| `--private` | private repo (Pages then needs a paid plan) |
| `--retrigger` | empty commit → re-run the deploy workflow |
| `--dry-run` | print the whole plan, change nothing |

---

## Option C — hand a scoped token to an agent

Fine-grained token at <https://github.com/settings/personal-access-tokens/new>:

- Repository access: only the repo (or "All repositories" if it doesn't exist yet)
- `Contents: Read and write`, `Administration: Read and write` (to create the repo),
  `Pages: Read and write` (to enable Pages)
- Expiry: 7 days, and revoke it after

Then `/home/user/deploy-to-github.sh` (outside this folder) does authenticate → create → push →
enable Pages → poll the deploy. Never paste a broad classic token.

---

## First-run checklist

1. **Wall loads** — 8 demo drops from `data/wall.json`.
2. **Local draft** — composer → *Send to review* → drop code → *My drops* shows `pending`.
3. **GitHub route** — composer → *Send via GitHub* opens the issue form, already prefilled and pointed at
   your repo (it detects `owner/repo` from the Pages URL).
4. **Moderation** — submit that issue → bot comments a drop code → add the **`approve`** label → the drop
   appears on the wall in ~1 minute.
5. **Expiry** — Actions → *Sweep stale drops* → Run workflow; a fresh queue should change nothing.

If step 4 does nothing, look at Actions → *Ingest drop*: the failing step names the problem concretely.

## Cold-start quirk worth knowing

`data/pending/` only exists because of a `.gitkeep` file. If a bot commit ever reports "nothing to commit"
when you expected a queue file, check that the folder still exists — git can't track empty directories.

## Custom domain

Settings → Pages → Custom domain, and add a `CNAME` file to the repo root. Because `store.js` detects the
repo from `*.github.io`, a custom domain needs one line of config or the *Send via GitHub* button won't know
where to post:

```js
// in index.html, before store.js
<script>window.SPILL_REPO = 'your-name/spill';</script>
```
