#!/usr/bin/env node
/* SPILL — anonymous bridge.
 *
 * GitHub issues require a GitHub account, which is a weak form of anonymity
 * at best. If you'd rather people submit without any account at all, point a
 * form service at a spreadsheet, publish it as CSV, and let this job turn new
 * rows into issues *as the bot*. Posters stay anonymous; moderation is still
 * plain GitHub labels.
 *
 *   repo variable FORM_CSV_URL = the published-to-web CSV of your responses
 *   repo variable FORM_MAX_PER_RUN (optional, default 15)
 *
 * Expected columns (case-insensitive, order doesn't matter):
 *   type | headline (or title) | story (or body) | tags
 *
 * Runs on a schedule. See .github/workflows/import-form.yml.
 */

import { createHash } from 'node:crypto';
import { P, readJSON, writeJSON } from './lib/rules.mjs';
import { makeApi, intake } from './lib/intake.mjs';

const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || '';
const CSV_URL = process.env.FORM_CSV_URL || '';
const MAX = Number(process.env.FORM_MAX_PER_RUN || 15);
const SEEN_FILE = P.drops.replace(/drops\.json$/, 'imported.json');

/* ── tiny CSV parser (quotes, embedded commas + newlines) ──── */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* Header matching is deliberately forgiving: form services name things
   "What kind of drop is this?" / "Your story" / "Subject", and none of
   that should need a spreadsheet edit before it works. */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const FIELDS = {
  type: ['type', 'kind', 'what kind of drop is this', 'kind of drop', 'confession or expose', 'drop type'],
  title: ['headline', 'title', 'subject', 'one sentence', 'summary'],
  body: ['story', 'body', 'what happened', 'what s your story', 'your story', 'tell us what happened', 'details'],
  tags: ['tags', 'topics', 'labels', 'keywords'],
};

function pick(row, field) {
  const keys = FIELDS[field];
  const entries = Object.entries(row).map(([h, v]) => [norm(h), String(v ?? '').trim()]);
  const exact = entries.find(([h]) => keys.includes(h));
  if (exact) return exact[1];
  const partial = entries.find(([h]) => h && keys.some((k) => h.includes(k)));
  return partial ? partial[1] : '';
}

function asIssueBody({ type, title, body, tags }) {
  return [
    '### What kind of drop is this?',
    /expos/i.test(type) ? 'Exposé' : 'Confession',
    '',
    '### Headline',
    title,
    '',
    '### The story',
    body,
    '',
    '### Tags',
    tags || '_No response_',
    '',
    '### Confirm',
    '- [X] Submitted through the anonymous form, agreeing to the house rules.',
    '',
    '<!-- spill:form-import -->',
  ].join('\n');
}

if (!CSV_URL) {
  console.log('FORM_CSV_URL is not set — nothing to import. See README «Anonymous submissions».');
  process.exit(0);
}

const api = makeApi({ token: TOKEN, repo: REPO, dry: DRY });

const res = await fetch(CSV_URL, { headers: { 'User-Agent': 'spill-import' } });
if (!res.ok) {
  console.error(`Could not fetch the form CSV (${res.status}).`);
  process.exit(1);
}
const rows = parseCSV(await res.text());
if (rows.length < 2) {
  console.log('CSV has no data rows.');
  process.exit(0);
}

const header = rows[0];
const seen = new Set(readJSON(SEEN_FILE, []));
let created = 0;

for (const cells of rows.slice(1)) {
  if (created >= MAX) { console.log(`Per-run cap of ${MAX} reached; the rest waits for the next run.`); break; }

  const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  const entry = {
    type: pick(row, 'type'),
    title: pick(row, 'title'),
    body: pick(row, 'body'),
    tags: pick(row, 'tags'),
  };
  if (!entry.title && !entry.body) continue;

  const hash = createHash('sha256').update(entry.title + '|' + entry.body).digest('hex').slice(0, 24);
  if (seen.has(hash)) continue;

  const issue = await api.createIssue({
    title: `[drop] ${entry.title.slice(0, 70) || 'untitled drop'}`,
    body: asIssueBody(entry),
    labels: [],
  });

  // Offline rehearsal (no token): synthesise a number so the whole pipeline
  // still runs against a scratch SPILL_ROOT.
  const offline = !TOKEN && !DRY;
  const issueNumber = issue.number ?? (offline ? 900 + created : undefined);
  console.log('created issue', issueNumber ?? '(dry)', '|', entry.title.slice(0, 50));

  if (issueNumber) {
    // issues opened by GITHUB_TOKEN don't fire workflows, so run intake inline
    const result = await intake(
      { number: issueNumber, body: asIssueBody(entry), user: { login: 'anonymous-form' } },
      api,
      { dry: DRY }
    );
    console.log('  →', result.state, result.record?.code ?? '');
  }

  seen.add(hash);
  created++;
}

if (!DRY) writeJSON(SEEN_FILE, [...seen].slice(-2000));
console.log(`imported ${created} new row(s).`);
