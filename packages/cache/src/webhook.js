// On-demand revalidation webhook — the CMS-trigger path. A POST with a shared
// secret purges paths/tags so a Sanity/Contentful/WP "published" event can warm
// or drop cache entries. The adapter mounts this at e.g. /__what_revalidate.

import { createHash, timingSafeEqual } from 'node:crypto';

// Constant-time compare over fixed-width digests, so neither the secret's
// contents nor its LENGTH leak through response timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digest = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// One request must not be able to force an unbounded number of blocking origin
// renders. CMS webhooks publish a handful of paths at a time.
const MAX_BATCH = 100;

/**
 * @param {{ revalidatePath: Function, revalidateTag: Function }} engine cache engine
 * @param {object} [options]
 * @param {string} [options.secret] shared secret the caller must present
 * @param {string} [options.header] header carrying the secret
 * @param {boolean} [options.regenerate] re-render each invalidated entry
 * @param {number} [options.maxBatch] cap on paths + tags per request
 * @returns {(reqLike: { headers?: Record<string, any>, body?: any }) =>
 *   Promise<{ status: number, body: any }>}
 */
export function createRevalidateWebhook(engine, options = {}) {
  const { secret, header = 'x-what-revalidate-secret', regenerate = false, maxBatch = MAX_BATCH } = options;

  return async function handle(reqLike) {
    const provided = (reqLike.headers || {})[header] || (reqLike.headers || {})[header.toLowerCase()];
    if (!secret || !safeEqual(provided || '', secret)) {
      return { status: 401, body: { message: 'Unauthorized' } };
    }

    const body = reqLike.body;
    if (!body || typeof body !== 'object') {
      return { status: 400, body: { message: 'Invalid body' } };
    }

    // `regenerate` is operator policy: the request body must not be able to turn
    // blocking re-renders on.
    const { paths, tags } = body;
    if (!Array.isArray(paths) && !Array.isArray(tags)) {
      return { status: 400, body: { message: 'Provide `paths` and/or `tags` arrays' } };
    }
    const total = (Array.isArray(paths) ? paths.length : 0) + (Array.isArray(tags) ? tags.length : 0);
    if (total > maxBatch) {
      return { status: 400, body: { message: `Too many entries: ${total} exceeds the ${maxBatch} per-request limit` } };
    }

    /** @type {{ paths: any[], tags: any[] }} */
    const revalidated = { paths: [], tags: [] };
    if (Array.isArray(paths)) {
      for (const p of paths) {
        await engine.revalidatePath(p, { regenerate });
        revalidated.paths.push(p);
      }
    }
    if (Array.isArray(tags)) {
      for (const t of tags) {
        await engine.revalidateTag(t, { regenerate });
        revalidated.tags.push(t);
      }
    }

    return { status: 200, body: { revalidated: true, ...revalidated } };
  };
}
