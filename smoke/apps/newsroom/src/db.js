// Server-only state: comments, who is reading what, and the two front-page
// queries with the latency a real backing service has. Never served over HTTP.

import { articleBody, marketsFor, mostReadFor, storyBySlug, storyList } from './data/news.js';

// The "most read" rail comes from an analytics service that answers slowly;
// the markets brief from a cache that answers fast. The front page streams
// around the slow one.
export const SLOW_MS = Number(process.env.NEWSROOM_SLOW_MS) || 1200;
export const FAST_MS = Number(process.env.NEWSROOM_FAST_MS) || 120;

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

export async function queryMostRead(page, signal) {
  await wait(SLOW_MS, signal);
  return mostReadFor(page);
}

export async function queryMarkets(page, signal) {
  await wait(FAST_MS, signal);
  return marketsFor(page);
}

// --- Comments --------------------------------------------------------------

const comments = new Map();
let nextId = 1;
for (const story of storyList()) {
  comments.set(story.slug, [
    { id: nextId++, author: 'Mara', body: `Thanks for covering ${story.section.toLowerCase()} like this.` },
    { id: nextId++, author: 'Jun', body: 'Would like to see the figures for last year too.' },
  ]);
}

export function commentsFor(slug) {
  return (comments.get(slug) ?? []).slice();
}

export function addComment(slug, author, body) {
  if (!storyBySlug(slug)) throw new Error(`no such article: ${slug}`);
  const list = comments.get(slug);
  const comment = { id: nextId++, author: author || 'Anonymous', body };
  list.push(comment);
  return comment;
}

export function getArticle(slug) {
  return articleBody(slug);
}

// --- Reading now -------------------------------------------------------------
// A reader counts while their page has pinged in the last 10 seconds.

const READ_WINDOW_MS = 10_000;
const readers = new Map(); // slug -> Map(readerId -> last ping)

export function pingReader(slug, readerId) {
  if (!storyBySlug(slug)) return 0;
  const now = Date.now();
  let map = readers.get(slug);
  if (!map) readers.set(slug, (map = new Map()));
  map.set(readerId, now);
  for (const [id, at] of map) if (now - at > READ_WINDOW_MS) map.delete(id);
  return map.size;
}
