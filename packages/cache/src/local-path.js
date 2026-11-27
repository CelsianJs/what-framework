// Revalidation targets must be same-origin local paths before they reach a CDN
// adapter. A CDN purge sends the CDN API token as a request header, so an
// attacker-supplied absolute URL ("https://attacker.example/x",
// "http://169.254.169.254/") would exfiltrate that token and turn on-demand
// revalidation into an SSRF primitive.
//
// This is what-server's safeLocalPath (packages/server/src/action-handler.js),
// which gates a redirect's Location header, character for character: the
// engine never imports what-server, so it carries its own copy, and
// packages/server/test/redirect-predicate-parity.test.js fails when the two
// differ. Harden both together.
//
// Backslashes matter: browsers and `new URL()` treat "\" like "/", so
// "/\evil.com" canonicalizes to http://evil.com. Reject anything starting with
// two slash-or-backslash chars or containing a backslash, then canonicalize via
// URL and require the localhost origin. The canonical path is checked again:
// removing dot segments and tabs makes "/.//evil", "/x/..//evil" and
// "/%2e//evil" into "//evil", which an adapter that resolves the path against
// its origin sends to another host.

/** @returns {string|null} the canonical local "path?query", or null if unsafe. */
export function safeLocalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  // Reject protocol-relative / backslash-smuggled targets up front.
  if (/^[/\\]{2}/.test(value) || value.includes('\\')) return null;
  try {
    const u = new URL(value, 'http://localhost');
    if (u.origin !== 'http://localhost' || u.pathname.startsWith('//')) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * The path a base names, as what-server's `basePath` and what-router's
 * setBase() read one: '/app/', '/app', 'app/' and 'app' are all '/app'. '' and
 * '/' are no base, nor is one that is not a path ('./', a URL, '//host').
 * @param {unknown} base
 */
export function basePathOf(base) {
  return typeof base === 'string' && !/^([a-z][\w+.-]*:|[/\\]{2}|\.)|\\/i.test(base) ? ('/' + base.replace(/^\//, '')).replace(/\/+$/, '') : '';
}

/**
 * The absolute URL a CDN purges for the local path `target`, below `baseUrl`
 * with its own path kept ('https://example.com/shop' and '/x' are
 * 'https://example.com/shop/x'); null for a target that is not a local path,
 * or a baseUrl that is not an absolute URL. The path is joined to the
 * origin's text, so no path can name another host.
 * @param {string | undefined} baseUrl
 * @param {unknown} target
 */
export function purgeUrlBelow(baseUrl, target) {
  const local = safeLocalPath(target);
  if (!baseUrl || local === null) return null;
  try {
    const base = new URL(baseUrl);
    return new URL(base.origin + base.pathname.replace(/\/+$/, '') + local).href;
  } catch {
    return null;
  }
}
