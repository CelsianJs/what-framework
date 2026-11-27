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
// redirectExternal(), which takes an absolute http(s) URL with no credentials,
// or a mailto: or tel: URL, as what-router's redirect() leaves the site for
// in the browser. A refused target is
// not an exception: the response redirects to the app's root instead ('/',
// or '/app/' below a base), the same fallback the action handler uses, and
// development logs ERR_SSR_UNSAFE_REDIRECT. A request-supplied target
// therefore never turns into a 500.
//
// The base. A path redirect() is given is a URL of the app, whoever calls it:
// a loader, a component, a server action. The response is the one place that
// puts it below the base the app is served at ('/login' answers Location
// '/app/login'), so `location` is what the browser is sent. The base is the
// request handler's or exportStatic's `basePath`, else what-router's
// (setBase(), or Vite's `base` when Vite builds this module).
//
// what-router's navigate() on a server (and so its redirect(), <Redirect>
// and a middleware verdict) resolves its target as the browser does, against
// the URL the render shows, which is below that base, and hands the response
// the URL the browser would go to (_redirectAt): the client's navigate()
// pushes that same URL, or leaves the app for it when it is outside the base
// ('../../x' at '/app/a/b' is '/x').

import { safeLocalPath } from './action-handler.js';
import { _base } from './actions.js';
import { _isDevMode } from './html.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The canonical same-origin target for `value`, or null when it is not one. */
export function localRedirectTarget(value) {
  if (safeLocalPath(value) === null) return null;
  const url = new URL(value, 'http://localhost');
  return url.pathname + url.search + url.hash;
}

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:']);

/**
 * The canonical target off the site for `value`: an absolute http(s) URL with
 * no credentials, or a mailto: or tel: URL, what what-router's redirect()
 * leaves the site for in the browser; null when it is not one.
 */
export function externalRedirectTarget(value) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
  // "https://trusted.example@evil.example" reads as the trusted host.
  if (url.username || url.password) return null;
  return url.href;
}

// The app's root, which a refused target goes to below `base`.
function refused(method, value, base) {
  if (_isDevMode) {
    console.warn(
      `[what-server] ${method}: refusing unsafe redirect target ${JSON.stringify(value)}; redirecting to ${JSON.stringify(base + '/')} instead. ` +
      '(ERR_SSR_UNSAFE_REDIRECT)',
    );
  }
  return base + '/';
}

/** Whether `value` is a response createResponse() made. */
export function isRenderResponse(value) {
  return RenderResponse.is(value);
}

// A response createResponse() made: what a render accepts as `response`,
// told by its private brand, which nothing else can carry. Its methods are
// its own functions, which work when taken off it (`const { redirect } =
// response`); `committed` is read through the class.
class RenderResponse {
  #committed = false;
  /** @type {((location: string) => void) | null} */
  #lateRedirect = null;

  /** @param {string} base the base a path redirect goes below ('/app'), or '' */
  constructor(base) {
    const late = (what) => {
      if (_isDevMode) {
        console.warn(`[what-server] ${what} after the response was committed (the shell has been sent) has no effect.`);
      }
    };
    const redirectTo = (location, status) => {
      if (!REDIRECT_STATUSES.has(status)) {
        throw new RangeError(`[what-server] redirect: ${status} is not a redirect status (301, 302, 303, 307 or 308).`);
      }
      if (this.#committed) {
        if (this.#lateRedirect) this.#lateRedirect(location);
        return;
      }
      this.location = location;
      this.status = status;
    };
    this.status = 200;
    this.headers = new Headers();
    /** The redirect target, once redirect() has been called. */
    /** @type {string | null} */
    this.location = null;
    /** @param {number} code */
    this.setStatus = (code) => {
      if (this.#committed) return late(`setStatus(${code})`);
      if (!Number.isInteger(code) || code < 200 || code > 599) {
        throw new RangeError(`[what-server] setStatus: ${code} is not a valid response status.`);
      }
      this.status = code;
    };
    // Set-Cookie always appends: several parts of a page may each set a cookie.
    /** @param {string} name @param {unknown} value */
    this.setHeader = (name, value, { append = false } = {}) => {
      if (this.#committed) return late(`setHeader(${JSON.stringify(name)})`);
      if (append || String(name).toLowerCase() === 'set-cookie') this.headers.append(name, String(value));
      else this.headers.set(name, String(value));
    };
    /** Redirect to a path of the app ("/account"), below its base. */
    this.redirect = (location, status = 302) => {
      const path = localRedirectTarget(location);
      redirectTo(path === null ? refused('redirect', location, base) : base + path, status);
    };
    /** Redirect off the site, to an absolute http(s), mailto: or tel: URL. */
    this.redirectExternal = (url, status = 302) => {
      redirectTo(externalRedirectTarget(url) ?? refused('redirectExternal', url, base), status);
    };
    /**
     * Redirect to `location`, a URL of this origin as the browser resolves
     * it, below the base already or outside it: what-router's navigate() on
     * a server, which names `to`, the target the app wrote, when it is
     * refused (null `location`, or one that is no local path).
     * @internal
     * @param {string | null} location
     * @param {unknown} to
     */
    this._redirectAt = (location, to) => {
      redirectTo(localRedirectTarget(location) ?? refused('navigate', to, base), 302);
    };
    /**
     * The base a path redirect goes below, which the render this response
     * answers renders below too.
     * @internal
     */
    this._base = base;
    /**
     * Freeze status and headers. `onRedirect` receives a redirect made after
     * this point (a streamed boundary's render).
     * @internal
     * @param {((location: string) => void) | undefined} [onRedirect]
     */
    this._commit = (onRedirect) => {
      this.#committed = true;
      this.#lateRedirect = onRedirect || null;
    };
  }

  get committed() {
    return this.#committed;
  }

  /** @param {unknown} value */
  static is(value) {
    return typeof value === 'object' && value !== null && #committed in value;
  }
}

/**
 * A response for one request. `base` (internal: the request handler's and
 * exportStatic's `basePath`, normalised) is the path a redirect goes below;
 * without it, what-router's base.
 * @param {string} [base]
 */
export function createResponse(base) {
  return new RenderResponse(base ?? _base());
}
