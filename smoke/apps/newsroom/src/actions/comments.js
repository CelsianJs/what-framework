// Server actions. Importing this module registers them, so /__what_action can
// dispatch them. Server-only: it reaches the database.

import { action, revalidateTag } from 'what-framework/server';

/**
 * Post a comment on an article. Article pages are ISR-cached and tagged
 * 'articles', so the comment is invisible until the tag is revalidated: the
 * next request for the article renders it fresh.
 *
 * Called with the form's fields: from a plain <form> post without JavaScript,
 * or from the comment form island with it.
 */
export const postComment = action(async (fields) => {
  const { addComment } = await import('../db.js');
  const slug = String(fields?.slug ?? '');
  const author = String(fields?.author ?? '').trim().slice(0, 60);
  const body = String(fields?.body ?? '').trim();
  if (body.length < 2) throw new Error('A comment needs at least two characters');
  if (body.length > 2000) throw new Error('A comment is at most 2,000 characters');
  const comment = addComment(slug, author, body);
  await revalidateTag('articles');
  return { ok: true, comment };
}, { id: 'postComment' });
