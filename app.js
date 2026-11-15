'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  type: 'all',
  sort: 'new',
  q: '',
  reactions: new Set(loadJSON('spill_reactions', [])),
  codes: loadJSON('spill_codes', []),
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode */ }
}

/* ── small helpers ──────────────────────────────────────── */
function relTime(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ── feed ───────────────────────────────────────────────── */
async function loadFeed() {
  const wrap = $('#cards');
  try {
    const data = await SpillStore.feed({ type: state.type, sort: state.sort, q: state.q });
    wrap.replaceChildren(...data.posts.map(card));
    $('#empty').hidden = data.posts.length > 0;
    focusFromHash();
  } catch {
    wrap.replaceChildren();
    $('#empty').hidden = false;
    $('#empty').textContent = 'Could not reach the wall. Refresh in a moment.';
  }
}

/* A stable, shareable link to one drop: page#post-id */
function permalink(post) {
  return `${location.origin}${location.pathname}#${post.id}`;
}

async function copyLink(post) {
  const url = permalink(post);
  try {
    await navigator.clipboard.writeText(url);
    history.replaceState(null, '', '#' + post.id);
    toast('Link to this drop copied.');
  } catch {
    toast(url);
  }
}

/* Highlight whatever the URL points at, e.g. .../confessions.html#p3 */
function focusFromHash() {
  const id = (location.hash || '').replace('#', '');
  if (!id) return;
  const node = $$('.card').find((c) => c.dataset.postId === id);
  if (!node) return;
  node.classList.remove('is-target');
  void node.offsetWidth;
  node.classList.add('is-target');
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function card(post) {
  const node = el('article', 'card' + (post.type === 'expose' ? ' is-expose' : ''));
  node.dataset.postId = post.id;

  const top = el('div', 'card-top');
  top.append(el('span', 'pill', post.type === 'expose' ? 'Exposé' : 'Confession'));
  top.append(el('span', 'alias', post.alias));
  top.append(el('span', 'dotsep', '·'));
  top.append(el('span', 'time', relTime(post.createdAt)));
  node.append(top);

  node.append(el('h3', null, post.title));

  const body = el('p', 'card-body', post.body);
  node.append(body);

  if (post.body.length > 340) {
    const more = el('button', 'more', 'Read it all');
    more.addEventListener('click', () => {
      node.classList.toggle('is-open');
      more.textContent = node.classList.contains('is-open') ? 'Fold it back' : 'Read it all';
    });
    node.append(more);
  }

  if (post.tags.length) {
    const tags = el('div', 'tags');
    post.tags.forEach((t) => tags.append(el('span', 'tag', '#' + t)));
    node.append(tags);
  }

  const foot = el('div', 'card-foot');
  const reactions = [
    ['felt', '♥', 'Felt this'],
    ['same', '=', 'Same'],
    ['oof', '!', 'Yikes'],
  ];
  for (const [kind, ico, label] of reactions) {
    const btn = el('button', 'react');
    btn.dataset.kind = kind;
    btn.title = label;
    btn.append(el('span', 'ico', ico), el('span', 'n', String(post.reactions[kind])));
    if (state.reactions.has(post.id + ':' + kind)) btn.classList.add('is-on');
    btn.addEventListener('click', () => react(post.id, kind, btn));
    foot.append(btn);
  }

  const flag = el('button', 'flag', '⚑ report');
  flag.addEventListener('click', () => report(post.id, flag));
  foot.append(flag);

  const link = el('button', 'cardlink', '🔗');
  link.title = 'Copy a link to this drop';
  link.addEventListener('click', () => copyLink(post));
  foot.append(link);

  node.append(foot);
  return node;
}

async function react(id, kind, btn) {
  const key = id + ':' + kind;
  if (state.reactions.has(key)) return toast('One reaction per drop.');
  try {
    const data = await SpillStore.react(id, kind);
    $('.n', btn).textContent = data.reactions[kind];
    btn.classList.add('is-on');
    state.reactions.add(key);
    saveJSON('spill_reactions', [...state.reactions]);
  } catch (e) {
    toast(e.message || 'Could not react.');
  }
}

async function report(id, btn) {
  try {
    const data = await SpillStore.report(id);
    if (data.ok) {
      btn.textContent = '⚑ reported';
      btn.disabled = true;
    }
    toast(data.message);
  } catch (e) {
    toast(e.message || 'Could not report.');
  }
}

async function loadStats() {
  try {
    const data = await SpillStore.stats();
    for (const [k, v] of Object.entries(data)) {
      const node = $(`[data-stat="${k}"]`);
      if (node) node.textContent = Number(v).toLocaleString();
    }
    const conf = $('#wallCountConf');
    const exp = $('#wallCountExp');
    if (conf) conf.textContent = Number(data.confessions || 0).toLocaleString();
    if (exp) exp.textContent = Number(data.exposes || 0).toLocaleString();
  } catch { /* leave dashes */ }
}

/* ── filters ────────────────────────────────────────────── */
$$('.segmented button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.type = btn.dataset.filter;
    $$('.segmented button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    loadFeed();
  });
});
$('#sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  loadFeed();
});
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value.trim();
  searchTimer = setTimeout(() => {
    state.q = value;
    loadFeed();
  }, 260);
});

/* ── modal plumbing ─────────────────────────────────────── */
const modal = $('#modal');
const views = { composer: $('#composerView'), success: $('#successView'), tracker: $('#trackerView') };

function showView(name) {
  for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
  modal.querySelector('.modal-card').scrollTop = 0;
}

function openModal(view = 'composer') {
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  showView(view);
  if (view === 'composer') setTimeout(() => $('#title').focus(), 60);
  if (view === 'tracker') renderTracker();
}
function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
}

$$('[data-close]').forEach((n) => n.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) closeModal();
});

$$('[data-open-composer]').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (btn.classList.contains('linkbtn')) return openModal('tracker');
    setType(btn.dataset.mode || 'confession');
    resetComposer();
    openModal('composer');
  })
);

/* ── composer ───────────────────────────────────────────── */
let dropType = 'confession';

function setType(type) {
  dropType = type === 'expose' ? 'expose' : 'confession';
  $$('.type-toggle button').forEach((b) => {
    const on = b.dataset.type === dropType;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('#submit').textContent = dropType === 'expose' ? 'Send exposé to review' : 'Send confession to review';
  $('#body').placeholder =
    dropType === 'expose'
      ? 'What happened, who it affected, and what proof exists. No names of private people, no links — those are stripped.'
      : 'Start anywhere. No names, no numbers, no links — those get removed automatically.';
}
$$('.type-toggle button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));

function resetComposer() {
  $('#title').value = '';
  $('#body').value = '';
  $('#tags').value = '';
  $('#consent').checked = false;
  $('#formError').hidden = true;
  $('#submit').disabled = false;
  $('#submit').textContent = dropType === 'expose' ? 'Send exposé to review' : 'Send confession to review';
  updateCounts();
}

function updateCounts() {
  const t = $('#title').value.length;
  const b = $('#body').value.length;
  $('#titleCount').textContent = `${t}/90`;
  $('#bodyCount').textContent = `${b}/1400`;
  scan();
}

const SCANS = [
  { re: /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, label: 'an email address' },
  { re: /https?:\/\/\S+|www\.\S+/gi, label: 'a link' },
  { re: /(^|\s)@[A-Za-z0-9_.]{2,30}/g, label: 'a social handle' },
  { re: /\+?\d[\d\s().-]{8,}\d/g, label: 'a phone-number-like number' },
  { re: /\b(?:jl\.?|jalan|street|st\.)\s+[A-Za-z]/gi, label: 'what looks like an address' },
];

function scan() {
  const text = $('#title').value + '\n' + $('#body').value;
  const found = SCANS.filter((s) => new RegExp(s.re.source, s.re.flags).test(text)).map((s) => s.label);
  const box = $('#safety');
  box.classList.remove('warn', 'ok');
  if (!text.trim()) {
    $('#safetyText').textContent = 'We’ll scan for names, numbers and links as you type.';
  } else if (found.length) {
    box.classList.add('warn');
    $('#safetyText').textContent =
      'Heads up — this contains ' + [...new Set(found)].join(' and ') +
      '. It gets removed automatically before a moderator sees it, so write it that way or it’ll read strangely.';
  } else {
    box.classList.add('ok');
    $('#safetyText').textContent = 'Nothing identifying detected. Keep it that way and it moves through review faster.';
  }
}
$('#title').addEventListener('input', updateCounts);
$('#body').addEventListener('input', updateCounts);

$('#submit').addEventListener('click', async () => {
  const payload = {
    type: dropType,
    title: $('#title').value.trim(),
    body: $('#body').value.trim(),
    tags: $('#tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    consent: $('#consent').checked,
  };
  const err = $('#formError');
  err.hidden = true;

  if (payload.title.length < 4) return fail(err, 'Give it a headline of at least 4 characters.');
  if (payload.body.length < 20) return fail(err, 'Tell us a bit more — at least 20 characters.');
  if (!payload.consent) return fail(err, 'Tick the box to confirm this is your own story and follows the rules.');

  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const data = await SpillStore.create(payload);
    state.codes.unshift({ code: data.code, title: payload.title, type: payload.type, at: Date.now() });
    state.codes = state.codes.slice(0, 30);
    saveJSON('spill_codes', state.codes);

    $('#codeOut').textContent = data.code;
    $('#successCopy').textContent = data.redactions?.length
      ? `Queued for review. We removed ${[...new Set(data.redactions)].join(', ')} from it automatically — everything else stays as you wrote it.`
      : 'Queued for review. A human reads every drop before it goes live, usually within a day.';
    showView('success');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = dropType === 'expose' ? 'Send exposé to review' : 'Send confession to review';
    fail(err, e.message || 'Something went wrong.');
  }
});

function fail(node, message) {
  node.textContent = message;
  node.hidden = false;
}

/* ── the GitHub Actions route ──────────────────────────────
   Detects owner/repo from the Pages URL so there's nothing to configure.
   Falls back to window.SPILL_REPO if you use a custom domain. */
function detectRepo() {
  if (window.SPILL_REPO) return window.SPILL_REPO;
  const host = location.hostname;
  if (!/\.github\.io$/i.test(host)) return null;
  const owner = host.split('.')[0];
  const first = location.pathname.split('/').filter(Boolean)[0];
  return owner + '/' + (first || owner + '.github.io');
}

function issueBody({ type, title, body, tags }) {
  return [
    '### What kind of drop is this?',
    type === 'expose' ? 'Exposé' : 'Confession',
    '',
    '### Headline',
    title,
    '',
    '### The story',
    body,
    '',
    '### Tags',
    tags.length ? tags.join(', ') : '_No response_',
    '',
    '### Confirm',
    '- [x] This is my own story or something I can back up. It targets no private individual, and I accept a moderator may reject it.',
  ].join('\n');
}

$('#ghSubmit').addEventListener('click', async () => {
  const repo = detectRepo();
  const payload = {
    type: dropType,
    title: $('#title').value.trim(),
    body: $('#body').value.trim(),
    tags: $('#tags').value.split(',').map((t) => t.trim()).filter(Boolean),
  };
  if (payload.title.length < 4 || payload.body.length < 20) {
    return toast('Fill in a headline and a story first.');
  }
  if (!repo) {
    return toast('Could not work out the GitHub repo. Set window.SPILL_REPO in store.js or use the local draft button.');
  }

  const markdown = issueBody(payload);
  const base = `https://github.com/${repo}/issues/new?template=drop.md`;
  const url =
    base +
    '&title=' + encodeURIComponent('[drop] ' + payload.title.slice(0, 60)) +
    '&body=' + encodeURIComponent(markdown);

  if (url.length > 7500) {
    // GitHub 404s on very long URLs — hand over the text instead
    try {
      await navigator.clipboard.writeText(markdown);
      window.open(`https://github.com/${repo}/issues/new?template=drop.md`, '_blank', 'noopener');
      toast('Too long for a prefilled link — the drop is on your clipboard, paste it into the form.');
    } catch {
      toast('Too long to prefill. Open the repo’s “New issue” page and paste your drop there.');
    }
    return;
  }
  window.open(url, '_blank', 'noopener');
  toast('Opening GitHub — submit the issue and the bot takes it from there.');
});

$('#copyCode').addEventListener('click', async () => {
  const code = $('#codeOut').textContent;
  try {
    await navigator.clipboard.writeText(code);
    toast('Code copied.');
  } catch {
    toast('Select the code and copy it manually.');
  }
});
$('#trackFromSuccess').addEventListener('click', () => {
  showView('tracker');
  renderTracker();
});

/* ── tracker ────────────────────────────────────────────── */
async function renderTracker() {
  const list = $('#trackerList');
  list.replaceChildren();
  if (!state.codes.length) {
    list.append(el('p', 'hint', 'No drops from this browser yet. Post one and it will show up here with its review status.'));
    return;
  }
  for (const entry of state.codes.slice(0, 12)) {
    const row = el('div', 'track-row');
    row.append(el('span', 'tcode', entry.code));
    row.append(el('span', 'ttitle', entry.title));
    const badge = el('span', 'status unknown', 'checking');
    row.append(badge);
    list.append(row);

    try {
      const data = await SpillStore.lookup(entry.code);
      badge.className = 'status ' + data.status;
      badge.textContent = data.status;
      if (data.reason) badge.title = data.reason;
      if (data.source === 'github') row.append(el('span', 'hint', 'via GitHub'));
    } catch {
      badge.className = 'status unknown';
      badge.textContent = 'unknown';
    }
  }
}

async function lookupCode(code) {
  const errBox = $('#trackError');
  errBox.hidden = true;
  const clean = code.trim().toLowerCase();
  if (!clean) return;
  try {
    const data = await SpillStore.lookup(clean);
    const list = $('#trackerList');
    const row = el('div', 'track-row');
    row.append(el('span', 'tcode', data.code || clean));
    row.append(el('span', 'ttitle', data.title));
    const badge = el('span', 'status ' + data.status, data.status);
    if (data.reason) badge.title = data.reason;
    row.append(badge);
    if (data.source === 'github') row.append(el('span', 'hint', 'via GitHub'));
    list.prepend(row);
    if (!state.codes.some((c) => c.code === data.code)) {
      state.codes.unshift({ code: data.code, title: data.title, type: data.type, at: Date.now() });
      saveJSON('spill_codes', state.codes);
    }
    $('#codeInput').value = '';
  } catch (e) {
    fail(errBox, e.message || 'Could not look that up.');
  }
}
$('#codeGo').addEventListener('click', () => lookupCode($('#codeInput').value));
$('#codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') lookupCode(e.target.value);
});

/* ── boot ───────────────────────────────────────────────── */
setType('confession');
updateCounts();
loadFeed();
loadStats();

window.addEventListener('hashchange', focusFromHash);

/* arriving from a wall page via "Spill something" */
if (location.hash === '#compose') {
  resetComposer();
  openModal('composer');
}
