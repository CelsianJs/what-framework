// getStaticPaths resolution + fallback decisions for dynamic routes.
//
// Known paths (in getStaticPaths) are pre-rendered at build. Unknown params at
// request time follow the route's `fallback`:
//   'blocking' -> render on first hit, then cache (ISR)
//   true       -> serve a skeleton immediately, regenerate in the background
//   false      -> 404

/** Run a page's getStaticPaths (if any). Returns { paths, fallback }. */
export async function resolveStaticPaths(getStaticPaths, ctx = {}) {
  if (typeof getStaticPaths !== 'function') return { paths: [], fallback: false };
  const result = await getStaticPaths(ctx);
  return {
    paths: (result && result.paths) || [],
    fallback: result && 'fallback' in result ? result.fallback : false,
  };
}

/** Build a concrete URL from a route pattern + params. Supports :param and *catchall. */
export function buildPath(pattern, params = {}) {
  return pattern.replace(/[:*]([A-Za-z0-9_]+)/g, (_, name) => {
    const v = params[name];
    return v == null ? '' : String(v);
  });
}

/** Is this param set among the pre-built static paths? */
export function isKnownParams(staticPaths, params) {
  return staticPaths.some((entry) => {
    const p = entry.params || {};
    const keys = new Set([...Object.keys(p), ...Object.keys(params)]);
    for (const k of keys) if (String(p[k]) !== String(params[k])) return false;
    return true;
  });
}

/** Decide what to do for a requested dynamic path. */
export function decideFallback(fallback, isKnown) {
  if (isKnown) return 'serve';
  if (fallback === 'blocking') return 'render';
  if (fallback === true) return 'skeleton';
  return 'notfound';
}
