'use strict';

/* ─────────────────────────────────────────────────────────────
   SPILL — static data layer
   GitHub Pages can't run a server, so this module is the back end.
   It keeps drops, review decisions and reactions in localStorage,
   and merges in the curated wall that ships as data/wall.json.

   Swapping this for a real API later = reimplement these same
   methods with fetch(). Nothing in app.js/admin.js needs to change.
   ───────────────────────────────────────────────────────────── */

const SpillStore = (() => {
  const K = {
    posts: 'spill.v1.posts',
    reactions: 'spill.v1.reactions',
    seeded: 'spill.v1.seeded',
    pass: 'spill.v1.adminpass',
  };
  const DEFAULT_PASS = 'nightfall';
  const WALL_URL = './data/wall.json';

  /* GitHub Pages serves with cache-control: max-age=600, so a plain fetch can
     hand back a wall that is ten minutes stale — long after a drop was approved.
     Bucket the query string by the minute: the CDN sees a new URL often enough
     to stay fresh, and repeat loads inside the same minute still hit cache. */
  const bucket = () => Math.floor(Date.now() / 60000);
  const fresh = (path) => `${path}?v=${bucket()}`;

  let memory = {}; // fallback when localStorage is unavailable
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return key in memory ? memory[key] : fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      memory[key] = value;
    }
  }

  /* ── text safety: same rules as the server version ───────── */
  function scrub(text) {
    const notes = [];
    let out = String(text);
    out = out.replace(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => (notes.push('email'), '[email removed]'));
    out = out.replace(/https?:\/\/\S+|www\.\S+/gi, () => (notes.push('link'), '[link removed]'));
    out = out.replace(/(^|\s)@[A-Za-z0-9_.]{2,30}/g, (_m, p1) => (notes.push('handle'), p1 + '[handle removed]'));
    out = out.replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => {
      const digits = (m.match(/\d/g) || []).length;
      if (digits < 9) return m;
      notes.push('phone');
      return '[number removed]';
    });
    return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), notes };
  }

  /* ── generators ─────────────────────────────────────────── */
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  function makeCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  }
  const ADJ = ['velvet', 'neon', 'quiet', 'restless', 'midnight', 'paper', 'glass', 'hollow', 'electric', 'slow',
    'feverish', 'borrowed', 'soft', 'crooked', 'amber', 'salt', 'static', 'wandering', 'unfinished', 'secondhand'];
  const NOUN = ['moth', 'heron', 'violin', 'lantern', 'corridor', 'typewriter', 'comet', 'doorway', 'kettle', 'mirror',
    'orchard', 'signal', 'atlas', 'sparrow', 'cinema', 'harbour', 'switchboard', 'cassette', 'window', 'static'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function makeAlias() {
    return `${pick(ADJ)} ${pick(NOUN)} #${10 + Math.floor(Math.random() * 90)}`;
  }

  /* ── the curated wall that ships with the site ──────────── */
  let wallCache = null;
  async function published() {
    if (wallCache) return wallCache;
    try {
      const res = await fetch(fresh(WALL_URL), { cache: 'no-store' });
      if (!res.ok) throw new Error('no wall');
      const data = await res.json();
      wallCache = Array.isArray(data) ? data : [];
    } catch {
      wallCache = [];
    }
    return wallCache;
  }

  /* ── demo queue so the moderation desk isn't empty ──────── */
  function seedQueue() {
    if (read(K.seeded, false)) return;
    const now = Date.now();
    const seeds = [
      {
        type: 'expose',
        title: 'Someone in my building keeps stealing the laundry detergent',
        body:
          'Three months, five bottles. I set a camera in the laundry room and I know exactly who it is. I am not posting the footage because I checked the rules — but the building manager has done nothing and I want the neighbours to know it is happening on floor 4.',
        tags: ['neighbours', 'pettiness'],
        flagged: true,
      },
      {
        type: 'confession',
        title: 'I told my mother I was working late, but I was at the beach alone',
        body:
          'I drove two hours to sit on a rock and look at water because I could not stand another dinner where she asks about marriage. I did this four times this year. Best four days I have had.',
        tags: ['family', 'escape'],
        flagged: false,
      },
    ];
    const posts = read(K.posts, []);
    seeds.forEach((s, i) => {
      posts.push({
        id: 'l' + (now + i),
        code: makeCode(),
        type: s.type,
        title: s.title,
        body: s.body,
        alias: makeAlias(),
        tags: s.tags,
        status: 'pending',
        flagged: s.flagged,
        reports: 0,
        felt: 0,
        same: 0,
        oof: 0,
        createdAt: now - 1000 * 60 * 120,
        reviewedAt: null,
        reason: null,
        source: 'local',
      });
    });
    write(K.posts, posts);
    write(K.seeded, true);
  }

  /* ── core accessors ────────────────────────────────────── */
  async function allPosts() {
    seedQueue();
    return [...(await published()), ...read(K.posts, [])];
  }
  const isLocal = (post) => post.source === 'local';

  function reactionsFor(post) {
    const log = read(K.reactions, {});
    const bump = (kind) => (log[`${post.id}:${kind}`] ? 1 : 0);
    return {
      felt: (post.felt || 0) + bump('felt'),
      same: (post.same || 0) + bump('same'),
      oof: (post.oof || 0) + bump('oof'),
    };
  }

  function shape(post) {
    return {
      id: post.id,
      code: post.code && post.code !== 'published' ? post.code : null,
      type: post.type,
      title: post.title,
      body: post.body,
      alias: post.alias,
      tags: post.tags || [],
      reactions: reactionsFor(post),
      createdAt: post.createdAt,
      status: post.status,
      reason: post.reason || null,
      source: post.source,
    };
  }

  /* ── public API (mirrors the server endpoints) ─────────── */
  async function feed({ type = 'all', sort = 'new', q = '' } = {}) {
    let posts = (await allPosts()).filter((p) => p.status === 'approved');
    if (type !== 'all') posts = posts.filter((p) => p.type === type);
    if (q) {
      const needle = q.toLowerCase();
      posts = posts.filter((p) =>
        (p.title + ' ' + p.body + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(needle)
      );
    }
    posts.sort((a, b) =>
      sort === 'felt'
        ? reactionsFor(b).felt * 2 + reactionsFor(b).same - (reactionsFor(a).felt * 2 + reactionsFor(a).same)
        : b.createdAt - a.createdAt
    );
    return { posts: posts.map(shape) };
  }

  async function stats() {
    const posts = await allPosts();
    const approved = posts.filter((p) => p.status === 'approved');
    const week = posts.filter((p) => p.createdAt > Date.now() - 7 * 864e5).length;
    return {
      live: approved.length,
      confessions: approved.filter((p) => p.type === 'confession').length,
      exposes: approved.filter((p) => p.type === 'expose').length,
      week,
      queue: posts.filter((p) => p.status === 'pending').length,
    };
  }

  async function create({ type, title, body, tags, consent }) {
    if (!consent) throw new Error('You have to accept the rules first.');
    type = type === 'expose' ? 'expose' : 'confession';
    title = String(title || '').trim();
    body = String(body || '').trim();
    if (title.length < 4) throw new Error('Give it a headline of at least 4 characters.');
    if (title.length > 90) throw new Error('Headlines max out at 90 characters.');
    if (body.length < 20) throw new Error('Tell us a bit more — at least 20 characters.');
    if (body.length > 1400) throw new Error('Keep it under 1400 characters.');

    const t = scrub(title);
    const b = scrub(body);
    const redactions = [...new Set([...t.notes, ...b.notes])];
    const cleanTags = (Array.isArray(tags) ? tags : [])
      .map((x) => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 20))
      .filter(Boolean)
      .filter((x, i, arr) => arr.indexOf(x) === i)
      .slice(0, 5);

    const code = makeCode();
    const posts = read(K.posts, []);
    posts.push({
      id: 'l' + Date.now(),
      code,
      type,
      title: t.text,
      body: b.text,
      alias: makeAlias(),
      tags: cleanTags,
      status: 'pending',
      flagged: redactions.length > 0 || type === 'expose',
      reports: 0,
      felt: 0,
      same: 0,
      oof: 0,
      createdAt: Date.now(),
      reviewedAt: null,
      reason: null,
      source: 'local',
    });
    write(K.posts, posts);
    return { code, status: 'pending', redactions };
  }

  /* data/drops.json is published by the ingest workflow, so a drop code
     works from any device — not just the browser that wrote it. */
  let dropsCache = null;
  async function dropsIndex() {
    if (dropsCache) return dropsCache;
    try {
      const res = await fetch(fresh('./data/drops.json'), { cache: 'no-store' });
      const data = await res.json();
      dropsCache = Array.isArray(data) ? data : [];
    } catch {
      dropsCache = [];
    }
    return dropsCache;
  }

  async function lookup(code) {
    const needle = String(code || '').toLowerCase().trim();
    if (!needle) throw new Error('Paste a drop code first.');

    const post = (await allPosts()).find((p) => p.code === needle);
    if (post) return shape(post);

    const entry = (await dropsIndex()).find((d) => d.code === needle);
    if (entry) {
      return {
        id: 'remote-' + needle,
        code: entry.code,
        type: entry.type,
        title: entry.title,
        body: '',
        alias: null,
        tags: [],
        reactions: { felt: 0, same: 0, oof: 0 },
        createdAt: entry.updatedAt,
        status: entry.status,
        reason: entry.reason || null,
        source: 'github',
        issue: entry.issue ?? null,
      };
    }
    throw new Error('No drop with that code — check the characters, they’re easy to mistype.');
  }

  async function react(id, kind) {
    if (!['felt', 'same', 'oof'].includes(kind)) throw new Error('Unknown reaction.');
    const post = (await allPosts()).find((p) => p.id === id);
    if (!post) throw new Error('Not found.');
    const log = read(K.reactions, {});
    if (log[`${id}:${kind}`]) throw new Error('One reaction per drop.');
    log[`${id}:${kind}`] = true;
    write(K.reactions, log);
    return { reactions: reactionsFor(post) };
  }

  async function report(id) {
    const posts = read(K.posts, []);
    const post = posts.find((p) => p.id === id);
    if (!post) {
      // published drops can't be modified from a static site — tell the truth
      return { ok: false, message: 'Published drops are fixed in the repo — flag it in a GitHub issue instead.' };
    }
    post.reports = (post.reports || 0) + 1;
    post.flagged = true;
    write(K.posts, posts);
    return { ok: true, message: 'Reported. It’s back at the top of the local review queue.' };
  }

  /* ── moderation desk ──────────────────────────────────── */
  async function adminQueue() {
    const posts = await allPosts();
    return {
      queue: posts
        .filter((p) => p.status === 'pending' || (p.reports || 0) > 0)
        .sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) || (b.reports || 0) - (a.reports || 0) || a.createdAt - b.createdAt)
        .map((p) => ({
          id: p.id,
          code: p.code,
          type: p.type,
          title: p.title,
          body: p.body,
          alias: p.alias,
          tags: p.tags || [],
          status: p.status,
          flagged: p.flagged ? 1 : 0,
          reports: p.reports || 0,
          created_at: p.createdAt,
          reason: p.reason || null,
          source: p.source,
        })),
    };
  }

  async function adminRecent() {
    const posts = read(K.posts, []);
    return {
      recent: posts
        .filter((p) => p.status !== 'pending')
        .sort((a, b) => (b.reviewedAt || b.createdAt) - (a.reviewedAt || a.createdAt))
        .slice(0, 40)
        .map((p) => ({
          id: p.id,
          code: p.code,
          title: p.title,
          status: p.status,
          reason: p.reason || '',
          felt: p.felt || 0,
          source: p.source,
        })),
    };
  }

  async function setStatus(id, action, reason) {
    const posts = read(K.posts, []);
    const post = posts.find((p) => p.id === id);
    if (!post) throw new Error('That drop lives in data/wall.json — edit the file to change it.');
    if (action === 'approve') {
      post.status = 'approved';
      post.reason = null;
      post.reviewedAt = Date.now();
    } else if (action === 'reject') {
      post.status = 'rejected';
      post.reason = String(reason || 'Does not meet the house rules.').slice(0, 200);
      post.reviewedAt = Date.now();
    } else {
      post.status = 'pending';
      post.reviewedAt = null;
    }
    write(K.posts, posts);
    return { ok: true };
  }

  /* ── publishing: turn local approved drops into wall.json ─ */
  async function exportWall() {
    const publishedRows = await published();
    const local = read(K.posts, []).filter((p) => p.status === 'approved');
    const merged = [
      ...publishedRows,
      ...local.map((p, i) => ({
        id: 'p' + (publishedRows.length + i + 1),
        code: 'published',
        type: p.type,
        title: p.title,
        body: p.body,
        alias: p.alias,
        tags: p.tags || [],
        status: 'approved',
        felt: p.felt || 0,
        same: p.same || 0,
        oof: p.oof || 0,
        createdAt: p.createdAt,
        source: 'published',
      })),
    ];
    return JSON.stringify(merged, null, 1);
  }

  function getPass() {
    return read(K.pass, DEFAULT_PASS) || DEFAULT_PASS;
  }
  function setPass(value) {
    write(K.pass, value || DEFAULT_PASS);
  }
  function resetLocal() {
    [K.posts, K.reactions, K.seeded].forEach((k) => {
      try { localStorage.removeItem(k); } catch { delete memory[k]; }
    });
  }

  return {
    feed, stats, create, lookup, react, report,
    adminQueue, adminRecent, setStatus, exportWall,
    getPass, setPass, resetLocal, DEFAULT_PASS,
  };
})();
