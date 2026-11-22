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
