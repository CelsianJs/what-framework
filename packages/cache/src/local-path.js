// Revalidation targets must be same-origin local paths before they reach a CDN
// adapter. A CDN purge sends the CDN API token as a request header, so an
// attacker-supplied absolute URL ("https://attacker.example/x",
// "http://169.254.169.254/") would exfiltrate that token and turn on-demand
// revalidation into an SSRF primitive.
//
// Backslashes matter: browsers and `new URL()` treat "\" like "/", so
// "/\evil.com" canonicalizes to http://evil.com. Reject anything starting with
// two slash-or-backslash chars or containing a backslash, then canonicalize via
// URL and require the localhost origin.

/** @returns {string|null} the canonical local "path?query", or null if unsafe. */
export function safeLocalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (/^[/\\]{2}/.test(value) || value.includes('\\')) return null;
  try {
    const u = new URL(value, 'http://localhost');
    if (u.origin !== 'http://localhost') return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}
