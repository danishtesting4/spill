'use strict';

/* Moderation desk — static build.
   Sessions live in sessionStorage; the password gate is cosmetic
   (there is no server to enforce anything), and every decision is
   written to this browser's localStorage by store.js. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SESSION = 'spill.v1.session';

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

function showLogin() {
  $('#login').hidden = false;
  $('#desk').hidden = true;
}
function showDesk() {
  $('#login').hidden = true;
  $('#desk').hidden = false;
  loadQueue();
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
$('#refresh').addEventListener('click', loadQueue);

$$('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#queueWrap').hidden = b.dataset.tab !== 'queue';
    $('#recentWrap').hidden = b.dataset.tab !== 'recent';
    $('#publishWrap').hidden = b.dataset.tab !== 'publish';
    if (b.dataset.tab === 'recent') loadRecent();
  })
);

async function loadQueue() {
  const { queue } = await SpillStore.adminQueue();
  const wrap = $('#queue');
  wrap.replaceChildren();

  const pending = queue.filter((q) => q.status === 'pending');
  const reported = queue.filter((q) => q.status !== 'pending' && q.reports > 0);
  const chip = (label, value) => {
    const c = el('span', 'chip');
    c.append(label + ' ', el('b', null, String(value)));
    return c;
  };
  $('#deskStats').replaceChildren(
    chip('pending', pending.length),
    chip('reported', reported.length),
    chip('flagged for scrutiny', queue.filter((q) => q.flagged).length)
  );

  try {
    const stats = await SpillStore.stats();
    $('#countApproved').textContent = String(stats.live);
  } catch { /* ignore */ }

  if (!queue.length) {
    wrap.append(el('p', 'hint', 'Queue is empty. The wall is calm.'));
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
      loadQueue();
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
      loadQueue();
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
      loadQueue();
    });
    actions.append(undo);
  }
  node.append(actions);
  return node;
}

async function loadRecent() {
  const { recent } = await SpillStore.adminRecent();
  const wrap = $('#recent');
  wrap.replaceChildren();
  if (!recent.length) return wrap.append(el('p', 'hint', 'No decisions yet.'));
  for (const r of recent) {
    const row = el('div', 'recent-row');
    row.append(el('span', 'tcode', r.code));
    row.append(el('span', 'ttl', r.title));
    row.append(el('span', 'status ' + r.status, r.status));
    row.append(el('span', 'hint', r.reason || ''));
    row.append(el('span', 'hint', '♥ ' + (r.felt || 0)));
    wrap.append(row);
  }
}

/* ── publishing ─────────────────────────────────────────── */
$('#genWall').addEventListener('click', async () => {
  const json = await SpillStore.exportWall();
  $('#wallOut').value = json;
  toast('Merged. Copy it into data/wall.json and commit.');
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
  loadQueue();
  toast('Local drops, votes and decisions cleared.');
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
