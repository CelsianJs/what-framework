// Isomorphic route matching — pure functions with no window/location/document
// dependencies, so they are safe to import on the server (deploy adapter) as
// well as in the client Router/FileRouter. Moved verbatim from index.js.

export function compilePath(path) {
  // /users/:id -> regex + param names
  // /posts/* -> catch-all (params.rest); /docs/*slug, the compiler's file
  //   router's [...slug], names it (params.slug)
  // /[slug] -> dynamic (file-based syntax)
  // (group) -> route group (ignored in URL)

  // Remove route groups from path (they don't affect URL matching)
  const normalized = comparable(path
    .replace(/\([\w-]+\)\//g, '') // Remove (group)/ prefixes
    .replace(/\[\.\.\.(\w+)\]/g, (_, name) => `*:${name}`) // Preserve catch-all name
    .replace(/\[(\w+)\]/g, ':$1')); // File-based [param] to :param

  const paramNames = [];
  /** @type {string | null} */
  let catchAll = null;
  // The static segments, which rank a catch-all (specificity).
  let statics = 0;

  const regexStr = normalized
    .split('/')
    .map(segment => {
      // '*', '*name' (the compiler's file router) or '*:name' ([...name]).
      if (segment[0] === '*') {
        catchAll = segment.replace(/^\*:?/, '') || 'rest';
        paramNames.push(catchAll);
        return '(.+)';
      }
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      if (segment) statics++;
      // As the URL holds it: the URL parser percent-encodes a path's spaces,
      // controls, non-ASCII characters and "<>`{}, and keeps an escape
      // already written ('%C3%A9', which comparable() put in upper case).
      return segment.replace(/[^\x21-\x7e]|["<>`{}]/gu, encodeURIComponent).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  const regex = new RegExp(`^${regexStr}$`);
  return { regex, paramNames, catchAll, statics };
}

// Compiled patterns are stable per route path, so cache them instead of
// rebuilding a RegExp for every route on every request.
const patternCache = new Map();
const PATTERN_CACHE_MAX = 1000;

// Each entry also holds the route's rank (specificity below).
function getPattern(path) {
  let compiled = patternCache.get(path);
  if (!compiled) {
    compiled = compilePath(path);
    compiled.rank = specificity(compiled);
    if (patternCache.size >= PATTERN_CACHE_MAX) patternCache.clear();
    patternCache.set(path, compiled);
  }
  return compiled;
}

// The `([^/]+)` segment guard runs against the still-encoded path, so a param
// only becomes multi-segment once it is decoded ("%2e%2e%2f" -> "../"). Reject
// any decoded value that smuggles in a separator or a traversal segment, and
// treat malformed percent-escapes as a non-match instead of throwing.
function decodeParam(value, isCatchAll) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const segments = decoded.split(/[/\\]/);
  if (!isCatchAll && segments.length > 1) return null;
  if (segments.includes('..')) return null;
  return decoded;
}

// A route's rank, lower first: fewer params first, and a catch-all after
// every other route. Of two catch-alls, the one whose segments before its
// rest say more comes first, a static segment counting 10 and a param 3:
// '/users/:id/*' (13), '/docs/*' (10), '/:lang/*' (3), '/*' (0). Two routes
// of equal rank keep the order they are listed in.
function specificity({ paramNames, catchAll, statics }) {
  return catchAll === null ? paramNames.length : 1e6 - 10 * statics - 3 * (paramNames.length - 1);
}

// A path as a route and a URL are compared: without the slashes that end it
// after a segment ('/about/' is matched as '/about', as a static host serves
// about/index.html at both; the root, and '//', are as they are), and with
// its percent escapes in upper case, as the URL parser writes the ones it
// makes ('/caf%c3%a9' is '/caf%C3%A9', the route '/café'). An escape decodes
// the same in either case; a '%' that starts none ('/50%off') and the
// characters after it are left as they are. A link's path and the URL on
// screen are compared the same way (index.js Link), as `_comparable`.
function comparable(path) {
  return path.replace(/([^/])\/+$/, '$1').replace(/%[\da-f]{2}/gi, (escape) => escape.toUpperCase());
}

export { comparable as _comparable };

export function matchRoute(path, routes) {
  path = comparable(path);
  // Filter out routes without a path (layout-only routes, etc.)
  // `filter` already copies, so sorting below never touches the caller's array.
  const sorted = routes.filter(r => r.path);

  // Sort routes by specificity (more specific first), counted on the compiled
  // pattern, so `[id]` and `[...rest]` rank as `:id` and `*` do.
  sorted.sort((a, b) => getPattern(a.path).rank - getPattern(b.path).rank);

  for (const route of sorted) {
    const { regex, paramNames, catchAll } = getPattern(route.path);
    const match = path.match(regex);
    if (match) {
      const params = {};
      let rejected = false;
      paramNames.forEach((name, i) => {
        const decoded = decodeParam(match[i + 1], name === catchAll);
        if (decoded === null) {
          rejected = true;
          return;
        }
        params[name] = decoded;
      });
      if (rejected) continue;
      return { route, params };
    }
  }
  return null;
}

// Null-prototype so query keys like "toString" or "__proto__" stay plain data
// instead of colliding with inherited members or replacing the prototype.
export function parseQuery(search) {
  const params = Object.create(null);
  if (!search) return params;
  // Match the platform's form-query decoding: '+' is a space, values may
  // contain '=', and malformed escapes remain data rather than aborting SSR.
  for (const [decodedKey, decodedVal] of new URLSearchParams(search)) {
    if (Object.prototype.hasOwnProperty.call(params, decodedKey)) {
      // Collect repeated keys into arrays
      if (Array.isArray(params[decodedKey])) {
        params[decodedKey].push(decodedVal);
      } else {
        params[decodedKey] = [params[decodedKey], decodedVal];
      }
    } else {
      params[decodedKey] = decodedVal;
    }
  }
  return params;
}
