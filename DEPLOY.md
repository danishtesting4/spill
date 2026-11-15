# Deploy SPILL to your GitHub

Everything is committed and ready (`main`, one clean commit). Two ways to land it.

---

## Option A — one command

Requires the GitHub CLI ([install](https://cli.github.com)) and one login:

```bash
gh auth login          # once: GitHub.com → HTTPS → login with a browser
cd spill-pages
./deploy.sh
```

That single script:

1. creates the public repo `spill` on your account (or reuses it if it exists)
2. enables **Pages** with `build_type=workflow`
3. sets **workflow permissions to read-and-write** — without this, approved drops never deploy
4. turns **Issues** on (the moderation queue)
5. pushes `main`
6. waits for the first Pages run and prints the live URL

Flags: `--name my-spill`, `--private`, `--dry-run` (prints the whole plan, changes nothing).

No `gh`? Two alternatives:

```bash
# repo already created at github.com/new
git remote add origin https://github.com/<you>/spill.git && git push -u origin main

# or let the CLI do it in one line
gh repo create spill --public --source=. --remote=origin --push
```

…then set the three things by hand:

| Where | Setting |
| --- | --- |
| Settings → Pages | **Source: GitHub Actions** |
| Settings → Actions → General | Workflow permissions: **Read and write** |
| Settings → General → Features | **Issues** must be on (that's the moderation queue) |

Push to `main` triggers `.github/workflows/pages.yml`. The URL appears in the Actions run and in
Settings → Pages: `https://<you>.github.io/spill/`.

---

## Option B — hand it to an agent with a scoped token

Create a **fine-grained** token at <https://github.com/settings/personal-access-tokens/new>:

- **Repository access:** only the one repo you want, or "All repositories" if the repo doesn't exist yet
- **Permissions:** `Contents: Read and write`, `Administration: Read and write` (needed to create the repo),
  `Pages: Read and write` if you also want Pages enabled automatically

Keep the expiry short (7 days is plenty). Then the agent can create the repo, push, enable Pages and
confirm the first deploy. Revoke the token afterwards — it's a one-time deploy credential.

**Don't** paste a classic `ghp_…` token with broad scopes, and don't reuse one from another project.

---

## First-run checklist

1. **Wall loads** — the 8 demo drops appear from `data/wall.json`.
2. **Local draft** — composer → *Send to review* → you get a drop code → *My drops* shows `pending`.
3. **GitHub route** — composer → *Send via GitHub* opens the prefilled issue form, repository already correct.
4. **Moderation** — submit that issue → a bot comment arrives with a drop code and `status:pending` →
   add the `approve` label → the drop appears on the wall in ~1 minute.
5. **Expiry** — Actions → *Sweep stale drops* → Run workflow. Nothing should change on a fresh queue.

If step 4 does nothing, it's almost always a **196 permissions** problem: Settings → Actions → General →
Workflow permissions → "Read and write".

## Custom domain (optional)

Settings → Pages → Custom domain. Drop a `CNAME` file in the repo root with the domain, and keep the
`README.md` note that `store.js` falls back to `window.SPILL_REPO` when the host isn't `*.github.io` —
otherwise the composer can't detect your repo and *Send via GitHub* will complain.
