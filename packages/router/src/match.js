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

export function matchRoute(path, routes) {
  // Filter out routes without a path (layout-only routes, etc.)
  const routable = routes.filter(r => r.path);

  // Sort routes by specificity (more specific first)
  const sorted = routable.sort((a, b) => {
    const aSpecific = (a.path.match(/:/g) || []).length + (a.path.includes('*') ? 100 : 0);
    const bSpecific = (b.path.match(/:/g) || []).length + (b.path.includes('*') ? 100 : 0);
    return aSpecific - bSpecific;
  });

  for (const route of sorted) {
    const { regex, paramNames } = compilePath(route.path);
    const match = path.match(regex);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { route, params };
    }
  }
  return null;
}

export function parseQuery(search) {
  const params = {};
  if (!search) return params;
  const qs = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of qs.split('&')) {
    const [key, val] = pair.split('=');
    if (!key) continue;
    const decodedKey = decodeURIComponent(key);
    const decodedVal = val ? decodeURIComponent(val) : '';
    if (decodedKey in params) {
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
