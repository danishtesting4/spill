/* Shared rules engine for the Actions backend.
   Runs inside GitHub Actions, so — unlike the browser copy — this
   cannot be bypassed by a submitter. No dependencies. */

import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.SPILL_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const LABELS = {
  drop: 'drop',
  pending: 'status:pending',
  published: 'status:published',
  rejected: 'status:rejected',
  expired: 'status:expired',
  needsFix: 'needs-fix',
  flagged: 'flagged',
  spam: 'spam',
};

/* ── scrubbing ─────────────────────────────────────────────── */
export function scrub(text) {
  const notes = [];
  let out = String(text ?? '');
  out = out.replace(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => (notes.push('email'), '[email removed]'));
  out = out.replace(/https?:\/\/\S+|www\.\S+/gi, () => (notes.push('link'), '[link removed]'));
  out = out.replace(/(^|\s)@[A-Za-z0-9_.]{2,30}/g, (_m, p1) => (notes.push('handle'), p1 + '[handle removed]'));
  out = out.replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => {
    const digits = (m.match(/\d/g) || []).length;
    if (digits < 9) return m;
    notes.push('phone');
    return '[number removed]';
  });
  out = out.replace(/\b(\d{1,3}[A-Za-z]?[\s,]*(?:street|st\.|road|rd\.|avenue|ave\.|lane|ln\.|jalan|jl\.)\b[^.\n]{0,40})/gi,
    () => (notes.push('address'), '[address removed]'));
  return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), notes: [...new Set(notes)] };
}

/* ── validation ────────────────────────────────────────────── */
export const LIMITS = { titleMin: 4, titleMax: 90, bodyMin: 20, bodyMax: 1400, tags: 5 };

export function validate({ type, title, body }) {
  const errors = [];
  if (!['confession', 'expose'].includes(type)) errors.push('Pick a kind: confession or expose.');
  if (!title || title.length < LIMITS.titleMin) errors.push(`Headline needs at least ${LIMITS.titleMin} characters.`);
  if (title && title.length > LIMITS.titleMax) errors.push(`Headline maxes out at ${LIMITS.titleMax} characters.`);
  if (!body || body.length < LIMITS.bodyMin) errors.push(`The story needs at least ${LIMITS.bodyMin} characters.`);
  if (body && body.length > LIMITS.bodyMax) errors.push(`The story maxes out at ${LIMITS.bodyMax} characters.`);
  return errors;
}

/* Hard blocks are the things no moderator should have to read.
   Everything else is *flagged* — it still reaches a human, who decides.
   (A confession like "I wanted to kill him" is a story, not a threat.) */
const BLOCK = [
  { re: /\b(child porn(ography)?|csam|underage (nudes|pics|photos))\b/i, why: 'sexual content involving minors' },
  { re: /\b(just )?(post|share|drop) (his|her|their) (address|home address)\b/i, why: 'doxxing a private person' },
];

const FLAG = [
  { re: /\b(kill|murder|shoot|stab|strangle)\s+(you|him|her|them)\b/i, why: 'threat language' },
  { re: /\b(home address|where (he|she|they) live[s]?)\b/i, why: 'mentions where someone lives' },
  { re: /\b(suicid\w*|kill(ing)? myself|end(ing)? it all|self[- ]harm|want(ed)? to die)\b/i, why: 'self-harm mention — needs a careful read' },
  { re: /\b(leak(ed|ing)? (her|his|their) (nudes|photos)|revenge porn|non[- ]consensual)\b/i, why: 'possible intimate-image content' },
];

export function screen(text) {
  return {
    block: BLOCK.filter((b) => b.re.test(text)).map((b) => b.why),
    flag: FLAG.filter((b) => b.re.test(text)).map((b) => b.why),
  };
}

export function cleanTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const tag = String(item || '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 20);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === LIMITS.tags) break;
  }
  return out;
}

/* ── anonymous identity for a drop ─────────────────────────── */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function makeCode() {
  return [...crypto.randomBytes(10)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
const ADJ = ['velvet', 'neon', 'quiet', 'restless', 'midnight', 'paper', 'glass', 'hollow', 'electric', 'slow',
  'feverish', 'borrowed', 'soft', 'crooked', 'amber', 'salt', 'static', 'wandering', 'unfinished', 'secondhand'];
const NOUN = ['moth', 'heron', 'violin', 'lantern', 'corridor', 'typewriter', 'comet', 'doorway', 'kettle', 'mirror',
  'orchard', 'signal', 'atlas', 'sparrow', 'cinema', 'harbour', 'switchboard', 'cassette', 'window', 'static'];
const pick = (a) => a[crypto.randomInt(a.length)];
export const makeAlias = () => `${pick(ADJ)} ${pick(NOUN)} #${crypto.randomInt(10, 100)}`;

/* ── issue form parsing ────────────────────────────────────── */
const FIELD = {
  type: /^(what kind|kind of drop|type)/i,
  title: /^(headline|title)/i,
  body: /^(the story|story|what happened|body)/i,
  tags: /^(tags|topics)/i,
  confirm: /^(confirm|rules|i confirm)/i,
};

/** GitHub issue-form markdown → structured drop */
export function parseIssue(body) {
  const sections = {};
  const clean = String(body || '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const parts = clean.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const [heading, ...rest] = part.split('\n');
    const value = rest.join('\n').trim().replace(/^_No response_$/i, '').trim();
    for (const [key, re] of Object.entries(FIELD)) {
      if (re.test(heading.trim())) sections[key] = value;
    }
  }
  const rawType = (sections.type || '').toLowerCase();
  const type = /expos/.test(rawType) ? 'expose' : 'confession';
  const confirmed = /\[[xX]\]/.test(sections.confirm || '');
  return {
    type,
    title: (sections.title || '').split('\n')[0].trim(),
    body: (sections.body || '').trim(),
    tags: cleanTags(sections.tags || ''),
    confirmed,
  };
}

/** The scrubbed version we write back over the public issue. */
export function formatIssueBody(parsed) {
  return [
    `### What kind of drop is this?`,
    parsed.type === 'expose' ? 'Exposé' : 'Confession',
    ``,
    `### Headline`,
    parsed.title,
    ``,
    `### The story`,
    parsed.body,
    ``,
    `### Tags`,
    parsed.tags.length ? parsed.tags.join(', ') : '_No response_',
    ``,
    `### Confirm`,
    `- [X] Scrubber applied automatically. Do not re-add names, numbers, emails or links.`,
    ``,
    `<!-- spill:scrubbed -->`,
  ].join('\n');
}

/* ── repo files ────────────────────────────────────────────── */
export const P = {
  wall: path.join(ROOT, 'data/wall.json'),
  drops: path.join(ROOT, 'data/drops.json'),
  pending: path.join(ROOT, 'data/pending'),
};

export function readJSON(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
export function writeJSON(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
}

export function savePending(issueNumber, record) {
  writeJSON(path.join(P.pending, `${issueNumber}.json`), record);
}
export function removePending(issueNumber) {
  const file = path.join(P.pending, `${issueNumber}.json`);
  if (existsSync(file)) unlinkSync(file);
}
export function loadPending(issueNumber) {
  const file = path.join(P.pending, `${issueNumber}.json`);
  if (!existsSync(file)) return null;
  return readJSON(file, null);
}

/** Publish a pending record into data/wall.json + data/drops.json. */
export function publish(record) {
  const wall = readJSON(P.wall, []);
  const post = {
    id: 'p' + (wall.length + 1),
    code: 'published',
    type: record.type,
    title: record.title,
    body: record.body,
    alias: record.alias,
    tags: record.tags || [],
    status: 'approved',
    felt: 0,
    same: 0,
    oof: 0,
    createdAt: record.createdAt || Date.now(),
    source: 'published',
  };
  wall.push(post);
  writeJSON(P.wall, wall);

  const drops = readJSON(P.drops, []);
  const idx = drops.findIndex((d) => d.code === record.code);
  const entry = {
    code: record.code,
    status: 'approved',
    title: record.title,
    type: record.type,
    issue: record.issue ?? null,
    updatedAt: Date.now(),
    reason: null,
  };
  if (idx >= 0) drops[idx] = entry;
  else drops.push(entry);
  writeJSON(P.drops, drops);
  return post;
}

export function recordStatus(record, status, reason = null) {
  const drops = readJSON(P.drops, []);
  const idx = drops.findIndex((d) => d.code === record.code);
  const entry = {
    code: record.code,
    status,
    title: record.title,
    type: record.type,
    issue: record.issue ?? null,
    updatedAt: Date.now(),
    reason,
  };
  if (idx >= 0) drops[idx] = entry;
  else drops.push(entry);
  writeJSON(P.drops, drops);
}
