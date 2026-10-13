// Isomorphic route matching — pure functions with no window/location/document
// dependencies, so they are safe to import on the server (deploy adapter) as
// well as in the client Router/FileRouter. Moved verbatim from index.js.

export function compilePath(path) {
  // /users/:id -> regex + param names
  // /posts/* -> catch-all
  // /[slug] -> dynamic (file-based syntax)
  // (group) -> route group (ignored in URL)

  // Remove route groups from path (they don't affect URL matching)
  const normalized = path
    .replace(/\([\w-]+\)\//g, '') // Remove (group)/ prefixes
    .replace(/\[\.\.\.(\w+)\]/g, (_, name) => `*:${name}`) // Preserve catch-all name
    .replace(/\[(\w+)\]/g, ':$1'); // File-based [param] to :param

  const paramNames = [];
  /** @type {string | null} */
  let catchAll = null;

  const regexStr = normalized
    .split('/')
    .map(segment => {
      if (segment.startsWith('*:')) {
        catchAll = segment.slice(2);
        paramNames.push(catchAll);
        return '(.+)';
      }
      if (segment === '*') {
        catchAll = 'rest';
        paramNames.push('rest');
        return '(.+)';
      }
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  const regex = new RegExp(`^${regexStr}$`);
  return { regex, paramNames, catchAll };
}

// Compiled patterns are stable per route path, so cache them instead of
// rebuilding a RegExp for every route on every request.
const patternCache = new Map();
const PATTERN_CACHE_MAX = 1000;

function getPattern(path) {
  let compiled = patternCache.get(path);
  if (!compiled) {
    compiled = compilePath(path);
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

export function matchRoute(path, routes) {
  // Filter out routes without a path (layout-only routes, etc.)
  // `filter` already copies, so sorting below never touches the caller's array.
  const sorted = routes.filter(r => r.path);

  // Sort routes by specificity (more specific first)
  sorted.sort((a, b) => {
    const aSpecific = (a.path.match(/:/g) || []).length + (a.path.includes('*') ? 100 : 0);
    const bSpecific = (b.path.match(/:/g) || []).length + (b.path.includes('*') ? 100 : 0);
    return aSpecific - bSpecific;
  });

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
