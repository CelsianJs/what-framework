// What Framework - Server: the response of one request, settable from the
// loader (its `response` argument) and from any component (what-core's
// getResponse()).
//
// It is committed when the shell is sent: on a streamed route that is the
// first byte, on a buffered one the end of the render. Before that, status,
// headers and a redirect become the real response (a redirect is a real 3xx
// with Location). After it, the status line has gone out: setStatus and
// setHeader do nothing (with a warning in development), and a redirect is sent
// to the browser as a script that replaces the location.
//
// Redirect targets. redirect() takes a same-origin local path only, by the
// same rule as the action handler's `_redirect` (safeLocalPath): it is what a
// loader hands request data to (`redirect(query.next)`), so an absolute URL
// there is an open redirect. Leaving the site is a separate, explicit call,
// redirectExternal(), which takes an absolute http(s) URL. A refused target is
// not an exception: the response redirects to '/' instead, the same fallback
// the action handler uses, and development logs ERR_SSR_UNSAFE_REDIRECT. A
// request-supplied target therefore never turns into a 500.

import { safeLocalPath } from './action-handler.js';
import { _isDevMode } from './html.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The canonical same-origin target for `value`, or null when it is not one. */
export function localRedirectTarget(value) {
  if (safeLocalPath(value) === null) return null;
  const url = new URL(value, 'http://localhost');
  return url.pathname + url.search + url.hash;
}

/** The canonical absolute http(s) target for `value`, or null when it is not one. */
export function externalRedirectTarget(value) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // "https://trusted.example@evil.example" reads as the trusted host.
  if (url.username || url.password) return null;
  return url.href;
}

function refused(method, value) {
  if (_isDevMode) {
    console.warn(
      `[what-server] ${method}: refusing unsafe redirect target ${JSON.stringify(value)}; redirecting to "/" instead. ` +
      '(ERR_SSR_UNSAFE_REDIRECT)',
    );
  }
  return '/';
}

export function createResponse() {
  let committed = false;
  /** @type {((location: string) => void) | null} */
  let lateRedirect = null;

  function late(what) {
    if (_isDevMode) {
      console.warn(`[what-server] ${what} after the response was committed (the shell has been sent) has no effect.`);
    }
  }

  function redirectTo(location, status) {
    if (!REDIRECT_STATUSES.has(status)) {
      throw new RangeError(`[what-server] redirect: ${status} is not a redirect status (301, 302, 303, 307 or 308).`);
    }
    if (committed) {
      if (lateRedirect) lateRedirect(location);
      return;
    }
    response.location = location;
    response.status = status;
  }

  const response = {
    status: 200,
    headers: new Headers(),
    /** The redirect target, once redirect() has been called. */
    location: null,
    get committed() {
      return committed;
    },
    setStatus(code) {
      if (committed) return late(`setStatus(${code})`);
      if (!Number.isInteger(code) || code < 200 || code > 599) {
        throw new RangeError(`[what-server] setStatus: ${code} is not a valid response status.`);
      }
      response.status = code;
    },
    // Set-Cookie always appends: several parts of a page may each set a cookie.
    setHeader(name, value, { append = false } = {}) {
      if (committed) return late(`setHeader(${JSON.stringify(name)})`);
      if (append || String(name).toLowerCase() === 'set-cookie') response.headers.append(name, String(value));
      else response.headers.set(name, String(value));
    },
    /** Redirect to a same-origin path ("/account"). */
    redirect(location, status = 302) {
      redirectTo(localRedirectTarget(location) ?? refused('redirect', location), status);
    },
    /** Redirect off the site, to an absolute http(s) URL. */
    redirectExternal(url, status = 302) {
      redirectTo(externalRedirectTarget(url) ?? refused('redirectExternal', url), status);
    },
  };

  /**
   * Freeze status and headers. `onRedirect` receives a redirect made after
   * this point (a streamed boundary's render).
   * @internal
   */
  response._commit = (onRedirect) => {
    committed = true;
    lateRedirect = onRedirect || null;
  };
  return response;
}
