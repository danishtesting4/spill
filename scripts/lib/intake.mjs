/* Reusable intake + GitHub API client.
   Used by ingest.mjs (issue events) and import-form.mjs (form CSV → issues),
   so both paths enforce identical rules. */

import { LABELS, scrub, validate, screen, parseIssue, formatIssueBody, cleanTags, makeCode, makeAlias, savePending, recordStatus } from './rules.mjs';

const LABEL_COLORS = {
  drop: '38f5d0',
  'status:pending': 'ffcc66',
  'status:published': '38f5d0',
  'status:rejected': 'ff3d84',
  'status:expired': 'a49cbe',
  'needs-fix': '8b5cff',
  flagged: 'ff3d84',
  spam: '7a7295',
};

export function makeApi({ token, repo, dry }) {
  const ensured = new Set();
  const call = async (method, endpoint, body) => {
    if (dry || !token) {
      console.log(`[dry] ${method} ${endpoint}${body ? ' ' + JSON.stringify(body).slice(0, 120) : ''}`);
      return {};
    }
    const res = await fetch(`https://api.github.com${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'spill-bot',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub ${method} ${endpoint} → ${res.status} ${await res.text()}`);
    }
    return res.status === 204 ? {} : res.json().catch(() => ({}));
  };

  async function ensureLabels(labels) {
    for (const name of labels) {
      if (ensured.has(name)) continue;
      ensured.add(name);
      if (dry || !token) continue;
      const res = await fetch(`https://api.github.com/repos/${repo}/labels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'spill-bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, color: LABEL_COLORS[name] || '8b5cff' }),
      });
      // 422 = already exists, which is fine
      if (!res.ok && res.status !== 422) console.log('label ensure failed:', name, res.status);
    }
  }

  const addLabels = async (n, labels) => {
    await ensureLabels(labels);
    return call('POST', `/repos/${repo}/issues/${n}/labels`, { labels });
  };

  return {
    call,
    ensureLabels,
    addLabels,
    comment: (n, text) => call('POST', `/repos/${repo}/issues/${n}/comments`, { body: text }),
    patchIssue: (n, patch) => call('PATCH', `/repos/${repo}/issues/${n}`, patch),
    getIssue: (n) => call('GET', `/repos/${repo}/issues/${n}`),

    removeLabel: (n, name) => call('DELETE', `/repos/${repo}/issues/${n}/labels/${encodeURIComponent(name)}`),
    close: (n, reason = 'completed') => call('PATCH', `/repos/${repo}/issues/${n}`, { state: 'closed', state_reason: reason }),
    comments: (n) => call('GET', `/repos/${repo}/issues/${n}/comments?per_page=100`),
    createIssue: (payload) => call('POST', `/repos/${repo}/issues`, payload),
    recentByAuthor: (login) => {
      const since = new Date(Date.now() - 864e5).toISOString();
      return call('GET', `/repos/${repo}/issues?state=all&creator=${encodeURIComponent(login)}&since=${since}&per_page=100`);
    },
  };
}

/**
 * Validate → screen → scrub → stash a pending draft → clean up the public issue.
 * Returns { state: 'queued'|'needs-fix'|'blocked'|'rate-limited'|'skipped', record?, errors? }.
 */
export async function intake(issue, api, { dry = false, maxPerDay = 6 } = {}) {
  if (issue.pull_request) return { state: 'skipped' };

  const author = issue.user?.login || 'unknown';

  if (!dry) {
    const recent = await api.recentByAuthor(author);
    const mine = (Array.isArray(recent) ? recent : []).filter(
      (i) => !i.pull_request && Date.now() - new Date(i.created_at).getTime() < 864e5
    );
    if (mine.length > maxPerDay) {
      await api.addLabels(issue.number, [LABELS.spam]);
      await api.comment(issue.number, `Slow down — ${maxPerDay} drops a day is the limit. Try again tomorrow.`);
      await api.close(issue.number, 'not_planned');
      return { state: 'rate-limited' };
    }
  }

  const parsed = parseIssue(issue.body || '');
  const errors = validate(parsed);
  if (!parsed.confirmed) errors.push('Tick the confirmation checkbox — it is how you agree to the house rules.');

  if (errors.length) {
    await api.addLabels(issue.number, [LABELS.needsFix]);
    await api.comment(
      issue.number,
      `**Not queued yet.**\n\n${errors.map((e) => `- ${e}`).join('\n')}\n\nEdit this issue and the checker runs again automatically.`
    );
    return { state: 'needs-fix', errors };
  }

  const { block, flag } = screen(parsed.title + '\n' + parsed.body);
  if (block.length) {
    await api.addLabels(issue.number, [LABELS.needsFix]);
    await api.comment(
      issue.number,
      `**Blocked:** this looks like it involves ${block.join(', ')}. That is a hard no here and it will not be reviewed.`
    );
    await api.close(issue.number, 'not_planned');
    return { state: 'blocked', block };
  }

  const t = scrub(parsed.title);
  const b = scrub(parsed.body);
  const record = {
    issue: issue.number,
    code: makeCode(),
    alias: makeAlias(),
    type: parsed.type,
    title: t.text,
    body: b.text,
    tags: cleanTags(parsed.tags),
    redactions: [...new Set([...t.notes, ...b.notes])],
    flags: flag,
    createdAt: Date.now(),
    author,
  };

  savePending(issue.number, record);
  recordStatus(record, 'pending');

  // the issue is public the moment it opens — rewrite it without the identifying bits
  await api.patchIssue(issue.number, { body: formatIssueBody(record) });
  const labels = [LABELS.drop, LABELS.pending, ...(flag.length ? [LABELS.flagged] : [])];
  await api.addLabels(issue.number, labels);

  const redacted = record.redactions.length
    ? `\n\nStripped automatically: **${record.redactions.join(', ')}**. The issue text above has been rewritten without it — don't add it back.`
    : '';
  const flagged = flag.length
    ? `\n\nFlagged for a careful read: **${flag.join(', ')}**. Still queued — the moderator decides.`
    : '';
  await api.comment(
    issue.number,
    [
      `**Queued.** Drop code \`${record.code}\` — useful for tracking, safe to share.`,
      redacted + flagged,
      ``,
      `A moderator decides with labels:`,
      `- \`approve\` → goes live on the wall, this issue closes.`,
      `- \`reject\` → closed with your reason. Add a comment first if you want the poster to read why.`,
    ].join('\n')
  );

  return { state: 'queued', record };
}
