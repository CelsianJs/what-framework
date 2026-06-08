// Server action: create a post, then revalidate the cached pages it affects.
// In a JSX app you'd call createPostAction(data) from a form; here it's wired
// through the /__what_action handler. revalidatePath purges the origin ISR cache
// (and any CDN) so the new post shows up immediately.

import { action, revalidatePath } from 'what-framework/server';
import { createPost } from '../db.js';

export const createPostAction = action(
  async ({ title, body }) => {
    const post = createPost({ title, body });
    return { ok: true, slug: post.slug };
  },
  { id: 'createPost', revalidate: ['/'] } // purge the home listing on success
);
