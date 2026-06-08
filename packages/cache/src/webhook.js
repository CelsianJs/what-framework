// On-demand revalidation webhook — the CMS-trigger path. A POST with a shared
// secret purges paths/tags so a Sanity/Contentful/WP "published" event can warm
// or drop cache entries. The adapter mounts this at e.g. /__what_revalidate.

// Constant-time string compare (timing-attack safe). Self-contained so the cache
// package stays dependency-free and decoupled from what-server.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/**
 * @param engine  cache engine (revalidatePath / revalidateTag)
 * @param options { secret, header='x-what-revalidate-secret', regenerate=false }
 * @returns async (reqLike:{headers, body:{paths?,tags?,regenerate?}}) -> { status, body }
 */
export function createRevalidateWebhook(engine, options = {}) {
  const { secret, header = 'x-what-revalidate-secret', regenerate = false } = options;

  return async function handle(reqLike) {
    const provided = (reqLike.headers || {})[header] || (reqLike.headers || {})[header.toLowerCase()];
    if (!secret || !safeEqual(provided || '', secret)) {
      return { status: 401, body: { message: 'Unauthorized' } };
    }

    const body = reqLike.body;
    if (!body || typeof body !== 'object') {
      return { status: 400, body: { message: 'Invalid body' } };
    }

    const { paths, tags, regenerate: regen = regenerate } = body;
    if (!Array.isArray(paths) && !Array.isArray(tags)) {
      return { status: 400, body: { message: 'Provide `paths` and/or `tags` arrays' } };
    }

    const revalidated = { paths: [], tags: [] };
    if (Array.isArray(paths)) {
      for (const p of paths) {
        await engine.revalidatePath(p, { regenerate: regen });
        revalidated.paths.push(p);
      }
    }
    if (Array.isArray(tags)) {
      for (const t of tags) {
        await engine.revalidateTag(t, { regenerate: regen });
        revalidated.tags.push(t);
      }
    }

    return { status: 200, body: { revalidated: true, ...revalidated } };
  };
}
