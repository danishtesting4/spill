'use strict';

/* Moderation desk — static build.
   Sessions live in sessionStorage; the password gate is cosmetic (there is no
   server to enforce anything), and every decision is written to this browser's
   localStorage by store.js.

   Tabs: Queue (pending + reported) · Confessions · Exposés · Log · Publish. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SESSION = 'spill.v1.session';

const ui = {
  sort: { confession: 'new', expose: 'new' },
  q: { confession: '', expose: '' },
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const fmt = (n) => Number(n || 0).toLocaleString();
const when = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ── auth ───────────────────────────────────────────────── */
function showLogin() {
  $('#login').hidden = false;
  $('#desk').hidden = true;
}
function showDesk() {
  $('#login').hidden = true;
  $('#desk').hidden = false;
  refreshAll();
}

$('#loginBtn').addEventListener('click', () => {
  const err = $('#loginError');
  err.hidden = true;
  if ($('#password').value !== SpillStore.getPass()) {
    err.textContent = 'Wrong password.';
    err.hidden = false;
    return;
  }
  sessionStorage.setItem(SESSION, '1');
  $('#password').value = '';
  showDesk();
  toast('Desk open.');
});
$('#password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#loginBtn').click();
});
$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION);
  showLogin();
});
$('#refresh').addEventListener('click', () => {
  refreshAll();
  toast('Refreshed.');
});

/* ── tabs ───────────────────────────────────────────────── */
$$('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    const tab = b.dataset.tab;
    $('#queueWrap').hidden = tab !== 'queue';
    $('#confessionsWrap').hidden = tab !== 'confessions';
    $('#exposesWrap').hidden = tab !== 'exposes';
    $('#recentWrap').hidden = tab !== 'recent';
    $('#publishWrap').hidden = tab !== 'publish';
    if (tab === 'recent') loadRecent();
    if (tab === 'confessions') loadLive('confession');
    if (tab === 'exposes') loadLive('expose');
  })
);

/* ── everything ─────────────────────────────────────────── */
async function refreshAll() {
  const stats = await SpillStore.stats();
  const { queue } = await SpillStore.adminQueue();
  const conf = (await SpillStore.adminAll({ type: 'confession' })).posts;
  const exp = (await SpillStore.adminAll({ type: 'expose' })).posts;

  const chip = (label, value, cls = '') => {
    const c = el('span', 'chip' + cls);
    c.append(label + ' ', el('b', null, fmt(value)));
    return c;
  };
  $('#deskStats').replaceChildren(
    chip('live drops', stats.live),
    chip('confessions', conf.length, ' conf'),
    chip('exposés', exp.length, ' exp'),
    chip('pending', queue.filter((q) => q.status === 'pending').length),
    chip('reported', queue.filter((q) => q.reports > 0).length)
  );

  $('#nQueue').textContent = queue.filter((q) => q.status === 'pending').length || '';
  $('#nConf').textContent = conf.length;
  $('#nExp').textContent = exp.length;

  renderQueue(queue);
  renderLive('confession', conf);
  renderLive('expose', exp);
}

/* ── queue ──────────────────────────────────────────────── */
function renderQueue(queue) {
  const wrap = $('#queue');
  wrap.replaceChildren();
  if (!queue.length) {
    wrap.append(el('p', 'empty-note', 'Queue is empty. The wall is calm.'));
    return;
  }
  for (const post of queue) wrap.append(qcard(post));
}

function qcard(post) {
  const node = el(
    'div',
    'qcard' +
      (post.status === 'pending' && post.flagged ? ' flagged' : '') +
      (post.reports > 0 ? ' reported' : '')
  );

  const meta = el('div', 'qmeta');
  meta.append(el('span', null, post.code));
  meta.append(el('span', null, post.type === 'expose' ? 'EXPOSÉ' : 'CONFESSION'));
  meta.append(el('span', null, post.alias));
  meta.append(el('span', null, new Date(post.created_at).toLocaleString()));
  meta.append(el('span', 'status ' + (post.status === 'pending' ? 'pending' : post.status), post.status));
  if (post.reports > 0) meta.append(el('span', 'status rejected', post.reports + ' report' + (post.reports > 1 ? 's' : '')));
  node.append(meta);

  node.append(el('h3', null, post.title));
  node.append(el('p', 'qbody', post.body));

  if (post.tags?.length) {
    const tags = el('div', 'tags');
    post.tags.forEach((t) => tags.append(el('span', 'tag', '#' + t)));
    node.append(tags);
  }

  const actions = el('div', 'qactions');
  const reason = el('input');
  reason.placeholder = 'rejection reason (shown to the poster when they look up their code)';
  const approve = el('button', 'btn btn-approve', 'Approve');
  const reject = el('button', 'btn btn-reject', 'Reject');

  approve.addEventListener('click', async () => {
    approve.disabled = true;
    try {
      await SpillStore.setStatus(post.id, 'approve');
      toast('Approved. Export wall.json to make it public.');
      refreshAll();
    } catch (e) {
      approve.disabled = false;
      toast(e.message);
    }
  });
  reject.addEventListener('click', async () => {
    reject.disabled = true;
    try {
      await SpillStore.setStatus(post.id, 'reject', reason.value.trim());
      toast('Rejected.');
      refreshAll();
    } catch (e) {
      reject.disabled = false;
      toast(e.message);
    }
  });

  actions.append(reason, approve, reject);
  if (post.status !== 'pending') {
    const undo = el('button', 'btn btn-ghost', 'Back to queue');
    undo.addEventListener('click', async () => {
      await SpillStore.setStatus(post.id, 'pending');
      toast('Returned to queue.');
      refreshAll();
    });
    actions.append(undo);
  }
  node.append(actions);
  return node;
}

/* ── live walls (confessions / exposés) ─────────────────── */
function renderLive(kind, posts) {
  const list = kind === 'confession' ? $('#confessionsList') : $('#exposesList');
  const summary = kind === 'confession' ? $('#confSummary') : $('#exposeSummary');
  const q = ui.q[kind];
  const sort = ui.sort[kind];

  let rows = posts.slice();
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((p) => (p.title + ' ' + p.body + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(needle));
  }
  rows.sort((a, b) =>
    sort === 'felt'
      ? b.reactions.felt * 2 + b.reactions.same - (a.reactions.felt * 2 + a.reactions.same)
      : b.createdAt - a.createdAt
  );

  const hiddenCount = rows.filter((p) => p.hidden).length;
  const reactionTotal = rows.reduce((n, p) => n + p.reactions.felt + p.reactions.same + p.reactions.oof, 0);
  summary.textContent = `${rows.length} shown · ${fmt(reactionTotal)} reactions` + (hiddenCount ? ` · ${hiddenCount} hidden` : '');

  list.replaceChildren();
  if (!rows.length) {
    list.append(el('p', 'empty-note', q ? `Nothing matches “${q}”.` : 'Nothing live here yet.'));
    return;
  }

  for (const post of rows) {
    const row = el(
      'div',
      `live-row is-${post.type}` + (post.hidden ? ' is-hidden' : '')
    );

    const top = el('div', 'live-top');
    top.append(el('span', 'pill', post.type === 'expose' ? 'Exposé' : 'Confession'));
    top.append(el('span', 'alias', post.alias || 'anonymous'));
    top.append(el('span', 'tcode', post.source === 'local' ? 'local draft' : 'published'));
    if (post.hidden) top.append(el('span', 'status expired', 'hidden'));
    top.append(el('span', 'time', when(post.createdAt)));
    row.append(top);

    row.append(el('h3', null, post.title));
    row.append(el('p', 'live-body', post.body));

    if (post.tags?.length) {
      const tags = el('div', 'tags');
      post.tags.forEach((t) => tags.append(el('span', 'tag', '#' + t)));
      row.append(tags);
    }

    const actions = el('div', 'live-actions');
    const stats = el('span', 'stat-mini', `♥ ${fmt(post.reactions.felt)} · = ${fmt(post.reactions.same)} · ! ${fmt(post.reactions.oof)}`);
    actions.append(stats);

    const expand = el('button', 'btn btn-ghost', 'Read all');
    expand.addEventListener('click', () => {
      row.classList.toggle('open');
      expand.textContent = row.classList.contains('open') ? 'Collapse' : 'Read all';
    });
    actions.append(expand);

    const toggle = el('button', 'btn ' + (post.hidden ? 'btn-ghost' : 'btn-reject'), post.hidden ? 'Put back on the wall' : 'Hide from wall');
    toggle.addEventListener('click', () => {
      if (post.hidden) SpillStore.unhide(post.id);
      else SpillStore.hide(post.id);
      toast(post.hidden ? 'Back on the wall — regenerate wall.json to publish.' : 'Hidden — regenerate wall.json to publish.');
      refreshAll();
    });
    actions.append(toggle);

    row.append(actions);
    list.append(row);
  }
}

async function loadLive(kind) {
  const { posts } = await SpillStore.adminAll({ type: kind });
  renderLive(kind, posts);
}

$$('.live-search').forEach((input) =>
  input.addEventListener('input', () => {
    clearTimeout(input._t);
    input._t = setTimeout(() => {
      const kind = input.dataset.kind;
      ui.q[kind] = input.value.trim();
      loadLive(kind);
    }, 200);
  })
);

$$('.segmented button').forEach((btn) =>
  btn.addEventListener('click', () => {
    const wrap = btn.closest('div[id$="Wrap"]');
    const kind = wrap && wrap.id === 'exposesWrap' ? 'expose' : 'confession';
    ui.sort[kind] = btn.dataset.sort;
    $$('.segmented button', wrap).forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    loadLive(kind);
  })
);

/* ── log ────────────────────────────────────────────────── */
async function loadRecent() {
  const { recent } = await SpillStore.adminRecent();
  const wrap = $('#recent');
  wrap.replaceChildren();
  if (!recent.length) return wrap.append(el('p', 'empty-note', 'No decisions yet.'));
  for (const r of recent) {
    const row = el('div', 'recent-row');
    row.append(el('span', 'tcode', r.code));
    row.append(el('span', 'ttl', r.title));
    row.append(el('span', 'status ' + r.status, r.status));
    row.append(el('span', 'hint', r.reason || ''));
    row.append(el('span', 'hint', '♥ ' + fmt(r.felt)));
    wrap.append(row);
  }
}

/* ── publishing ─────────────────────────────────────────── */
$('#genWall').addEventListener('click', async () => {
  const json = await SpillStore.exportWall();
  $('#wallOut').value = json;
  const hidden = SpillStore.hiddenIds().length;
  toast(hidden ? `Merged, with ${hidden} hidden drop(s) left out.` : 'Merged. Copy it into data/wall.json and commit.');
});

$('#copyWall').addEventListener('click', async () => {
  if (!$('#wallOut').value) return toast('Generate it first.');
  try {
    await navigator.clipboard.writeText($('#wallOut').value);
    toast('Copied wall.json.');
  } catch {
    $('#wallOut').select();
    toast('Press ⌘/Ctrl + C to copy.');
  }
});

$('#downloadWall').addEventListener('click', async () => {
  if (!$('#wallOut').value) await $('#genWall').click();
  const blob = new Blob([$('#wallOut').value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wall.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$('#resetAll').addEventListener('click', () => {
  SpillStore.resetLocal();
  $('#wallOut').value = '';
  refreshAll();
  toast('Local drops, votes, hidden flags and decisions cleared.');
});

$('#savePass').addEventListener('click', () => {
  const value = $('#newPass').value.trim();
  if (value.length < 4) return toast('Use at least 4 characters.');
  SpillStore.setPass(value);
  $('#newPass').value = '';
  toast('Password saved in this browser.');
});

/* boot */
if (sessionStorage.getItem(SESSION) === '1') showDesk();
else showLogin();
