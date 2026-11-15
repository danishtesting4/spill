#!/usr/bin/env node
/* SPILL — sweeper.
 *
 * A queue nobody clears is just a pile of public issues containing
 * someone's worst week. This job makes sure nothing sits there forever.
 *
 *   older than NUDGE_DAYS → one gentle comment on the issue
 *   older than STALE_DAYS → closed, labelled status:expired, and the drop
 *                           code is updated so the poster sees why
 *   issue closed without a decision → same, cleaned up silently
 *
 * Defaults: nudge 3 days, expire 7 days. Override with repo variables
 * NUDGE_DAYS / STALE_DAYS. Run from .github/workflows/sweep.yml.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { P, LABELS, readJSON, loadPending, removePending, recordStatus } from './lib/rules.mjs';
import { makeApi } from './lib/intake.mjs';

const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || '';
const STALE_DAYS = Number(process.env.STALE_DAYS || 7);
const NUDGE_DAYS = Number(process.env.NUDGE_DAYS || 3);
const DAY = 864e5;

const api = makeApi({ token: TOKEN, repo: REPO, dry: DRY });

function pendingFiles() {
  try {
    return readdirSync(P.pending).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

const now = Date.now();
const actions = [];

for (const file of pendingFiles()) {
  const issueNumber = Number(file.replace(/\.json$/, ''));
  const record = loadPending(issueNumber);
  if (!record) continue;

  const age = now - (record.createdAt || now);
  const ageDays = Math.floor(age / DAY);

  // someone closed it by hand — clean up instead of leaving it queued
  let issue = null;
  if (!DRY && TOKEN) {
    try {
      issue = await api.call('GET', `/repos/${REPO}/issues/${issueNumber}`);
    } catch {
      issue = null;
    }
  }
  const closedByHand = issue && issue.state === 'closed';

  if (closedByHand) {
    actions.push({ kind: 'expire', issueNumber, record, reason: 'Closed without a decision.', silent: true });
    continue;
  }

  if (age > STALE_DAYS * DAY) {
    actions.push({
      kind: 'expire',
      issueNumber,
      record,
      reason: `Expired — no decision within ${STALE_DAYS} days.`,
      silent: false,
    });
    continue;
  }

  if (age > NUDGE_DAYS * DAY) {
    let alreadyNudged = false;
    if (!DRY && TOKEN) {
      try {
        const list = await api.comments(issueNumber);
        alreadyNudged = (Array.isArray(list) ? list : []).some((c) => /spill:nudge/.test(c.body || ''));
      } catch {
        alreadyNudged = false;
      }
    }
    if (!alreadyNudged) actions.push({ kind: 'nudge', issueNumber, record, ageDays });
  }
}

if (!actions.length) {
  console.log(`Sweep: ${pendingFiles().length} pending drop(s), nothing to do.`);
  process.exit(0);
}

for (const action of actions) {
  const { issueNumber, record } = action;

  if (action.kind === 'nudge') {
    await api.comment(
      issueNumber,
      [
        `<!-- spill:nudge -->`,
        `**Still queued** — this has been waiting ${action.ageDays} days.`,
        ``,
        `Nothing is wrong with it; a moderator just hasn't got to it. It expires automatically at ${STALE_DAYS} days, ` +
          `and the drop code \`${record.code}\` keeps reporting \`pending\` until then.`,
      ].join('\n')
    );
    console.log(`nudged #${issueNumber} (${action.ageDays}d)`);
    continue;
  }

  recordStatus(record, 'expired', action.reason);
  removePending(issueNumber);

  if (!action.silent) {
    await api.comment(
      issueNumber,
      `**Expired, not judged.**\n\nThis waited ${STALE_DAYS} days without a decision, so it's been closed to keep the queue honest. ` +
        `The drop code \`${record.code}\` now reports \`expired\`. Nothing was published.`
    );
  }
  await api.addLabels(issueNumber, [LABELS.expired]);
  await api.removeLabel(issueNumber, LABELS.pending);
  await api.close(issueNumber, 'not_planned');
  console.log(`expired #${issueNumber} — ${record.code}`);
}

const remaining = pendingFiles().length;
console.log(`Sweep done: ${actions.length} action(s), ${remaining} still queued. drops.json: ${readJSON(P.drops, []).length} entries.`);
