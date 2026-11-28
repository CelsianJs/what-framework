// What Framework - Server: the URL of a request a server received, from its
// scheme, its Host header and its request target.
//
// The Host header is client input: the sender chooses it, and a proxy may
// forward it as it came. Joined to the target as a string, a Host that holds
// a path delimiter names the path What routes: `GET /public` with
// `Host: h/admin?` became `http://h/admin?/public`, so What rendered /admin
// where an Express guard in front had routed /public. So a Host is accepted
// only as a host: a DNS name or an IPv4 address (letters, digits, `-`, `_`
// and `.`) or a bracketed IPv6 literal, with an optional port up to 65535.
// Userinfo, a path, a query, a fragment, a backslash or whitespace is not a
// host, and the request is answered 400. The path always comes from the
// target, which must be a path (origin-form).
//
// The path What routes is the target's own, as a server in front (an
// Express route, a proxy ACL) saw it. URL parsing resolves dot segments
// (`/public/../admin`, and `%2e%2e`, `.%2E`) and reads a backslash as a slash,
// so a target that holds one names a path the server in front never routed:
// it is answered 400. Browsers never send one.

const HOST = /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_.])?|\[[0-9A-Fa-f:.]+\])(?::(\d{1,5}))?$/;

/** Whether `host` is a Host header value naming a host (see above). */
export function isHost(host) {
  if (typeof host !== 'string') return false;
  const match = HOST.exec(host);
  return match !== null && (match[1] === undefined || Number(match[1]) <= 65535);
}

// A dot segment, literal or percent-encoded, or a backslash, in a target's
// path (before its query or fragment).
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

/** Whether the path of `target` is the path URL parsing reads from it (see above). */
export function isPlainPath(target) {
  const end = target.search(/[?#]/);
  const path = end < 0 ? target : target.slice(0, end);
  return !path.includes('\\') && !DOT_SEGMENT.test(path);
}

/**
 * The host a Node request's headers name: its Host header, else (HTTP/2) its
 * `:authority`, which requestUrl validates as it does a Host; localhost when
 * they name none. An HTTP/2 request whose Host and `:authority` differ is
 * malformed (RFC 9113 section 8.3.1): something in front may have routed or
 * cached it by the one the page would not see. It names no host (null), so
 * it is answered 400.
 */
export function nodeRequestHost(headers) {
  const { host } = headers;
  const authority = headers[':authority'];
  if (host != null && authority != null && String(host).toLowerCase() !== String(authority).toLowerCase()) return null;
  return host ?? authority ?? 'localhost';
}

/**
 * The URL of a request for the path `target` at `host` over `scheme`
 * ('http' or 'https'), or null when `target` is not a path (or holds a dot
 * segment or a backslash) or `host` is not a host.
 */
export function requestUrl(scheme, host, target) {
  if (typeof target !== 'string' || !target.startsWith('/') || !isPlainPath(target) || !isHost(host)) return null;
  try {
    return new URL(`${scheme}://${host}${target}`);
  } catch {
    return null;
  }
}

// --- The origin a request was sent to ---
//
// The scheme is the one a proxy in front reports in X-Forwarded-Proto (its
// first value, when it is http or https), else the one the server knows of
// the connection (a TLS socket, the platform's own URL). X-Forwarded-Proto is
// believed without configuration: a page on another site cannot set it on a
// visitor's request (a form cannot set headers, and a fetch that sets one is
// preflighted), so only the proxy or the sender itself can, and neither is a
// cross-site request; what a sender claims there names an origin it could
// have named in the Host header too. Behind a TLS proxy that does not send it,
// the server sees http: have the proxy send it. The CSRF check compares this
// origin with the page's; the Node adapter builds a request's URL with this
// scheme, and the request handler hands the cache engine a URL with it, so an
// ISR entry is keyed on the origin the visitor asked for.

// A header of a plain object of lowercase names, or of a Headers.
const header = (headers, name) => (headers == null ? undefined : typeof headers.get === 'function' ? headers.get(name) : headers[name]);

/** The scheme ('http' or 'https') a request with `headers` was sent over, `scheme` when no proxy reports one. */
export function requestScheme(headers, scheme) {
  const forwarded = String(header(headers, 'x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  return forwarded === 'https' || forwarded === 'http' ? forwarded : scheme;
}

/**
 * The origin a request was sent to, scheme included (an https page posting
 * to an http host is another origin): its Host header's host, else its URL's,
 * over requestScheme's scheme (the URL's, a bare path's being http). Null
 * when no host is named.
 */
export function requestOrigin(headers, url) {
  /** @type {URL | null} */
  let parsed = null;
  try {
    parsed = new URL(String(url));
  } catch { /* a path: no scheme or host of its own */ }
  const host = header(headers, 'host') || (parsed && parsed.host);
  if (!host || !isHost(host)) return null;
  try {
    return new URL(`${requestScheme(headers, parsed && parsed.protocol === 'https:' ? 'https' : 'http')}://${host}`).origin;
  } catch {
    return null;
  }
}
