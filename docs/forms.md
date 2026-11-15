# Anonymous submissions without a GitHub account

GitHub issues need an account, which is anonymity with a receipt attached. This document wires a free form
service to the pipeline so people can drop something with no account at all — and an Actions job turns each
response into a queued drop.

```
form service → spreadsheet/CSV → import-form.yml (every 30 min) → issue opened AS THE BOT
                                                              → same intake: validate, screen, scrub, queue
                                                              → moderator labels approve / reject
                                                              → data/wall.json → Pages rebuild
```

The poster's identity never reaches the repo: the issue is authored by `github-actions[bot]`, not by them.
What the form host knows is a separate question — covered at the bottom.

---

## Recommended: Google Forms + a private Apps Script endpoint

Google Forms is free, needs no account from the respondent, and has a stable automation path. The catch is
that "Publish to the web" makes **every response readable by anyone with the link** — unacceptable for a
confession site. So instead, serve the sheet through a tiny Apps Script that requires a token.

### 1. Build the form

<https://forms.new> → four questions, titled exactly like this (the importer is fuzzy, but these match):

| Question | Type | Notes |
| --- | --- | --- |
| What kind of drop is this? | Multiple choice | options: `Confession`, `Exposé` |
| Headline | Short answer | response validation → maximum 90 characters |
| The story | Paragraph | response validation → maximum 1400 characters |
| Tags | Short answer | "up to 5, comma separated" |

Settings to leave **off** (Settings tab):

- **Collect email addresses** — off. Otherwise every drop carries an address.
- **Limit to 1 response** — off. It forces a Google sign-in, which defeats the point.
- **Require sign-in** (under Responses) — off.

### 2. Connect a sheet

Responses tab → **Link to Sheets** → create a new spreadsheet. Google writes rows into `Form responses 1`.

### 3. Add the endpoint (Apps Script)

In that spreadsheet: **Extensions → Apps Script**, paste this, then replace `PASTE_A_LONG_RANDOM_STRING`:

```js
const TOKEN = 'PASTE_A_LONG_RANDOM_STRING';
const SHEET = 'Form responses 1';

function doGet(e) {
  if (!e || e.parameter.token !== TOKEN) {
    return ContentService.createTextOutput('nope').setMimeType(ContentService.MimeType.TEXT);
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET);
  const rows = sheet.getDataRange().getValues();
  const csv = rows
    .map((row) => row.map((cell) => {
      const s = String(cell == null ? '' : cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','))
    .join('\n');
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.TEXT);
}

/* Optional: drop rows that have already been imported, so the sheet doesn't
   become a permanent archive of people's confessions. Set a time-driven
   trigger on this function (hourly) and keep the window wider than your
   import interval. */
function purgeOldRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET);
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const cutoff = Date.now() - 6 * 60 * 60 * 1000; // 6 hours
  const keep = values.slice(1).filter((row) => new Date(row[0]).getTime() > cutoff);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (keep.length) sheet.getRange(2, 1, keep.length, header.length).setValues(keep);
}
```

Deploy: **Deploy → New deployment → Web app** → *Execute as:* **Me** → *Who has access:* **Anyone** →
Deploy → copy the `/exec` URL. It looks like:

```
https://script.google.com/macros/s/AKfy…/exec
```

### 4. Store it in the repo

**Settings → Secrets and variables → Actions → Secrets → New repository secret**

- Name: `FORM_CSV_URL`
- Value: `https://script.google.com/macros/s/AKfy…/exec?token=PASTE_A_LONG_RANDOM_STRING`

A **secret** (not a variable) matters here: it's the credential for reading the responses, and the workflow
never echoes it. Optional variable: `FORM_MAX_PER_RUN` (default 15).

### 5. Run it

**Actions → Import anonymous form submissions → Run workflow.** Submit a test response first.
Within a minute you should see an issue labelled `drop` + `status:pending`, authored by the bot, with the
raw text already scrubbed. Then approve or reject it with labels.

The job runs every 30 minutes on its own afterwards.

---

## Alternative: published CSV (faster, less private)

If you don't care that responses are readable by anyone who finds the link:

1. Link the form to a sheet, then **File → Share → Publish to web → [sheet] → CSV**.
2. Tick **Automatically republish when changes are made**, hit Publish, copy the `…/pub?output=csv` URL.
3. Put *that* URL in `FORM_CSV_URL` (a variable is fine — it's public anyway).

Convenient, but it turns your inbox into a public wall of unmoderated confessions. That's why the Apps Script
route above is the recommendation.

## Alternative: Tally

Tally forms are nicer to fill in, but its free plan exports CSV as a **manual download** — there's no
stable public URL to poll, so the scheduled import can't read it directly. Two workable paths:

- **Tally → Google Sheets integration**, then publish *that* sheet (public route above), or point the
  Apps Script route at a sheet Tally writes into.
- **Tally API + your own export step**, if you're on a plan with API access: fetch submissions in a small
  script and commit `data/pending/*.json` yourself.

Other services (Formspree, Jotform, Airtable) work the same way: if you can produce a URL that returns CSV,
`FORM_CSV_URL` doesn't care who's behind it.

---

## What the importer understands

Headers are matched loosely (lowercased, punctuation stripped, exact match first, then partial), so all of
these work without editing the sheet:

| Field | Recognised headers |
| --- | --- |
| type | `type`, `kind`, `what kind of drop is this`, `drop type`, `kind of drop`, `confession or expose` |
| headline | `headline`, `title`, `subject`, `one sentence`, `summary` |
| story | `story`, `body`, `what happened`, `what's your story`, `tell us what happened`, `details` |
| tags | `tags`, `topics`, `labels`, `keywords` |

Rows are deduped by a hash of headline + story (`data/imported.json`). Empty rows and rows without a headline
or story are skipped. CSV quoting, embedded commas and `""` escapes are handled.

---

## The anonymity trade-offs, stated plainly

- **The form host still sees** the submitter's IP and timestamp, and Google's abuse systems see the session.
  That's better than a GitHub account, not equal to Tor.
- **Nothing here is end-to-end anonymous** if someone submits something truly distinctive — stylometry is
  real. The old rule applies: don't publish details that only you could know.
- **The published-sheet route leaks everything.** Use the token route.
- **Rows linger** in the spreadsheet until you purge them. Set up `purgeOldRows` and keep the retention
  window short.
- **A moderator still sees first drafts.** Scrubbing removes emails, numbers, handles, links and addresses —
  not names, not context, not a confession that names a colleague in prose.
