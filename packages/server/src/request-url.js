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

const HOST = /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_.])?|\[[0-9A-Fa-f:.]+\])(?::(\d{1,5}))?$/;

/** Whether `host` is a Host header value naming a host (see above). */
export function isHost(host) {
  if (typeof host !== 'string') return false;
  const match = HOST.exec(host);
  return match !== null && (match[1] === undefined || Number(match[1]) <= 65535);
}

/**
 * The URL of a request for the path `target` at `host` over `scheme`
 * ('http' or 'https'), or null when `target` is not a path or `host` is not
 * a host.
 */
export function requestUrl(scheme, host, target) {
  if (typeof target !== 'string' || !target.startsWith('/') || !isHost(host)) return null;
  try {
    return new URL(`${scheme}://${host}${target}`);
  } catch {
    return null;
  }
}
