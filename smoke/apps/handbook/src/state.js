// What outlives a page: the reader's session, which chapters they marked
// read, and the note they were drafting in each. Chapter pages are built
// again on every visit; what they show from here is what the reader left.
//
// `stats` counts what the pages build and release, so the smoke check can
// see that leaving a page releases its timer and its component, and how many
// times each chapter's chunk was asked for (`loads`).

import { signal } from 'what-framework';

export const session = signal(null, 'session');
export const readMarks = signal({}, 'readMarks');

const drafts = new Map();
export function draftOf(slug) {
  if (!drafts.has(slug)) drafts.set(slug, signal('', `draft:${slug}`));
  return drafts.get(slug);
}

export function toggleRead(slug) {
  readMarks((marks) => ({ ...marks, [slug]: !marks[slug] }));
}

export const stats = { mounts: {}, loads: {}, live: 0, timers: 0, deskMounts: 0 };
if (typeof window !== 'undefined') window.__handbook = { stats };
