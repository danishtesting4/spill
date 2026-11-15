#!/usr/bin/env node
/* SPILL — issue event handler (the "server").
 *
 *   opened / edited / reopened → intake()
 *   labeled approve            → publish into data/wall.json
 *   labeled reject             → record status + reason, close
 *
 * Moderation surface = GitHub issue labels. The commit it makes is what
 * makes the site rebuild — see .github/workflows/ingest.yml.
 */

import { readFileSync } from 'node:fs';
import { P, LABELS, loadPending, removePending, publish, recordStatus, readJSON } from './lib/rules.mjs';
import { makeApi, intake } from './lib/intake.mjs';

const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || '';

function loadEvent() {
  if (process.env.GITHUB_EVENT_PATH) return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (process.env.SPILL_EVENT_JSON) return JSON.parse(process.env.SPILL_EVENT_JSON);
  throw new Error('No event payload found (set GITHUB_EVENT_PATH or SPILL_EVENT_JSON).');
}

const api = makeApi({ token: TOKEN, repo: REPO, dry: DRY });
const event = loadEvent();
const issue = event.issue;

if (!issue) {
  console.log('Event has no issue payload; nothing to do.');
  process.exit(0);
}

if (['opened', 'edited', 'reopened'].includes(event.action)) {
  const result = await intake(issue, api, { dry: DRY });
  console.log('intake:', result.state, result.record?.code ?? '');
} else if (event.action === 'labeled') {
  const label = event.label?.name;
  const actor = event.sender?.login || 'moderator';

  if (label === 'approve') {
    const record = loadPending(issue.number);
    if (!record) {
      await api.comment(
        issue.number,
        'No queued draft for this issue — it may have been edited after review, or already published. Edit the issue to re-run intake.'
      );
    } else {
      const post = publish(record);
      removePending(issue.number);
      await api.removeLabel(issue.number, LABELS.pending);
      await api.addLabels(issue.number, [LABELS.published]);
      await api.comment(
        issue.number,
        [
          `**Published** by @${actor}.`,
          ``,
          `Drop code: \`${record.code}\``,
          `Appears as **${post.alias}** — the wall rebuilds in about a minute.`,
        ].join('\n')
      );
      await api.close(issue.number, 'completed');
      console.log('published', record.code);
    }
  } else if (label === 'reject') {
    const record = loadPending(issue.number);
    if (!record) {
      await api.comment(issue.number, 'No queued draft for this issue — nothing to reject.');
    } else {
      let reason = 'Does not meet the house rules.';
      if (!DRY && TOKEN) {
        const list = await api.comments(issue.number);
        const mine = (Array.isArray(list) ? list : []).filter(
          (c) => c.user?.login === actor || /OWNER|MEMBER|COLLABORATOR/.test(c.author_association || '')
        );
        const last = mine.at(-1)?.body?.replace(/\s+/g, ' ').trim();
        if (last && last.length > 3) reason = last.slice(0, 200);
      }
      recordStatus(record, 'rejected', reason);
      removePending(issue.number);
      await api.removeLabel(issue.number, LABELS.pending);
      await api.addLabels(issue.number, [LABELS.rejected]);
      await api.comment(
        issue.number,
        `**Not published.**\n\nReason on record: “${reason}”\n\nThe drop code \`${record.code}\` now reports this, so whoever holds the code sees why.`
      );
      await api.close(issue.number, 'not_planned');
      console.log('rejected', record.code, '|', reason);
    }
  } else {
    console.log('label ignored:', label);
  }
} else {
  console.log('action ignored:', event.action);
}

console.log('drops.json entries:', readJSON(P.drops, []).length);
