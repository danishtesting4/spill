'use strict';

/* Shared renderer for the standalone walls (confessions.html / exposes.html).
   The combined feed on index.html stays in app.js; this is the read-only
   single-kind wall: hero stats, sort, search, reactions, report. */

const TYPE = document.body.dataset.wall; // 'confession' | 'expose'
const IS_EXPOSE = TYPE === 'expose';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = {
  sort: 'new',
  q: '',
  reactions: (() => {
    try { return new Set(JSON.parse(localStorage.getItem('spill_reactions') || '[]')); }
    catch { return new Set(); }
  })(),
};

function saveReactions() {
  try { localStorage.setItem('spill_reactions', JSON.stringify([...state.reactions])); } catch {}
}

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

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

/* ── card ───────────────────────────────────────────────── */
function card(post) {
  const node = el('article', 'card' + (post.type === 'expose' ? ' is-expose' : ''));

  const top = el('div', 'card-top');
  top.append(el('span', 'pill', post.type === 'expose' ? 'Exposé' : 'Confession'));
  top.append(el('span', 'alias', post.alias || 'anonymous'));
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

  if (post.tags?.length) {
    const tags = el('div', 'tags');
    post.tags.forEach((t) => tags.append(el('span', 'tag', '#' + t)));
    node.append(tags);
  }

  const foot = el('div', 'card-foot');
  [['felt', '♥', 'Felt this'], ['same', '=', 'Same'], ['oof', '!', 'Yikes']].forEach(([kind, ico, label]) => {
    const btn = el('button', 'react');
    btn.dataset.kind = kind;
    btn.title = label;
    btn.append(el('span', 'ico', ico), el('span', 'n', String(post.reactions[kind])));
    if (state.reactions.has(post.id + ':' + kind)) btn.classList.add('is-on');
    btn.addEventListener('click', async () => {
      const key = post.id + ':' + kind;
      if (state.reactions.has(key)) return toast('One reaction per drop.');
      try {
        const data = await SpillStore.react(post.id, kind);
        $('.n', btn).textContent = data.reactions[kind];
        btn.classList.add('is-on');
        state.reactions.add(key);
        saveReactions();
      } catch (e) {
        toast(e.message || 'Could not react.');
      }
    });
    foot.append(btn);
  });

  const flag = el('button', 'flag', '⚑ report');
  flag.addEventListener('click', async () => {
    try {
      const r = await SpillStore.report(post.id);
      if (r.ok) { flag.textContent = '⚑ reported'; flag.disabled = true; }
      toast(r.message);
    } catch (e) {
      toast(e.message || 'Could not report.');
    }
  });
  foot.append(flag);
  node.append(foot);
  return node;
}

/* ── render ─────────────────────────────────────────────── */
async function render() {
  const grid = $('#wall');
  const { posts } = await SpillStore.feed({ type: TYPE, sort: state.sort, q: state.q });

  if (!posts.length) {
    grid.replaceChildren();
    $('#empty').hidden = false;
    $('#empty').textContent = state.q
      ? `Nothing on this wall matches “${state.q}”.`
      : IS_EXPOSE
        ? 'No exposés on the wall yet. Every one needs receipts, so they come in slowly.'
        : 'No confessions on the wall yet. Be the first.';
  } else {
    $('#empty').hidden = true;
    grid.replaceChildren(...posts.map(card));
  }

  // hero numbers, from the unfiltered set
  const all = (await SpillStore.feed({ type: TYPE })).posts;
  const reactions = all.reduce((n, p) => n + p.reactions.felt + p.reactions.same + p.reactions.oof, 0);
  const week = all.filter((p) => p.createdAt > Date.now() - 7 * 864e5).length;
  $('#statLive').textContent = all.length.toLocaleString();
  $('#statReactions').textContent = reactions.toLocaleString();
  $('#statWeek').textContent = week.toLocaleString();
}

$$('.segmented button').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.sort = btn.dataset.sort;
    $$('.segmented button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    render();
  })
);

let timer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(timer);
  const v = e.target.value.trim();
  timer = setTimeout(() => { state.q = v; render(); }, 220);
});

render();
