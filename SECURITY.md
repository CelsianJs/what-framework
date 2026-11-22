# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

**Email:** security@whatfw.com (or 78920650+zvndev@users.noreply.github.com)

**Do NOT** open a public GitHub issue for security vulnerabilities.

## Response Timeline
- Acknowledgment: within 48 hours
- Assessment: within 1 week
- Fix: within 30 days for critical issues

## Supported Versions
| Version | Supported |
|---------|-----------|
| 0.15.x  | Yes       |
| < 0.15  | No        |

We support the latest published minor. All 14 packages release together at the same version,
so "0.15.x" applies across the whole `what-*` / `create-what` / `eslint-plugin-what` set.

## The Host header

The Host header is client input: a sender chooses it, and a proxy may forward it as it came. The
Node entry points (`toNodeListener`, `whatMiddleware`, `nodeActionMiddleware`) accept a Host only as
a host (a DNS name or IPv4 address, or a bracketed IPv6 literal, with an optional port) and answer
400 to anything else (a path, a query, a backslash, userinfo). Over HTTP/2 the host is `:authority`
when the request sends no Host, validated the same way. The path What routes on comes from the
request target, never from the Host, and it is the target's own path: a target whose path holds a
dot segment (`/public/../admin`, or percent-encoded, `%2e%2e`, `.%2E`) or a backslash is answered
400, because URL parsing would resolve it to a path a server in front (an Express route, a proxy
ACL) never routed. Browsers never send one. This holds at the Node entry points
(`toNodeListener`, `whatMiddleware`, `nodeActionMiddleware`) and `what dev`/`what preview`; a Fetch
entry (`fetchActionHandler`, the Vercel, Cloudflare and Vura adapters) receives a URL its platform
already parsed, so the platform's routing is the one a guard has to agree with there. A cached
(ISR) page is keyed on the request's origin as well as its path, so a Host one sender chose never
reaches another host's visitors; a regeneration with no request renders a path's default entry
from no visitor's request, and refreshes at most 16 stored origins of a path at a time. Still
allowlist the hosts your proxy forwards: a page that builds absolute URLs from `request.url` (a
canonical link, a fetch to the app's own API) builds them on the host the request named.

`what dev` answers only a Host that is localhost (or `*.localhost`), an IP address, its `--host`
or a name in `allowedHosts`, so a page that rebinds its own domain to the developer's machine
cannot read the dev sources (403).

## Server actions

A server action is a public, unauthenticated endpoint: its id is in the page (and can be computed
from the source), and the client chooses every argument. CSRF protection (Fetch Metadata, Origin,
the double-submit token) stops another site from posting in a visitor's name; it does not stop a
client from calling an action itself. Authorize the caller and validate the arguments inside the
action: the built-in endpoints run each call with `getRequest()` returning its request (cookies,
headers), and with a query cache of its own.

### The state a form posted without JavaScript

A `<Form>` whose action is the dispatch of `useActionState(serverAction)` posts the state it holds
(`_state`, JSON) and gets the action's result back on the next render of the page in a cookie. What
holds, and what does not:

- The cookie is the action's own (`what-as-` and the action id in hex), `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Max-Age=60`, `Secure` over HTTPS and in production, and at most
  3 KB; a larger result is not sent (`ERR_ACTION_STATE_TOO_LARGE`). The endpoint sets it only on
  the 303 of a post that passed the CSRF checks and an action that returned.
- `createRequestHandler` reads it before the ISR cache: a request that carries one is rendered for
  its visitor alone, never stored and never served from the cache, and its response clears every
  state cookie it carried (`Max-Age=0`) and is `private, no-store`. A cookie that does not parse
  is cleared and ignored.
- The state, posted or in the cookie, is client data: the visitor can set it to anything, and a
  script on a sibling subdomain can set the cookie. A render shows it escaped like any value. Never
  authorize, look up or write anything from it; the action validates `previousState` as it
  validates its other arguments.
- `HttpOnly` keeps the page's scripts from reading the result; it does not make it secret from the
  visitor, whose own data it is. Do not return another user's data, or a token, in it.

## Hydration

`hydrate()` adopts the DOM the browser built from the server's response instead of building
it again. It never parses a string, so it cannot make markup more trusted than the response
was; what it decides is how much of the response outlives the walk.

**The trust baseline.** After `hydrate()`, the container holds exactly what a client render of
the same tree with the same data holds: no element, attribute, URL, event handler, shadow root,
script, style or raw HTML that the client render would not produce. Markup that matches the
client's is kept as it is; anything else is replaced by the client's rendering or removed, and
reported (`ERR_HYDRATION_MISMATCH` in development, `onHydrationError` in every build), apart from
attributes: a claimed element's attributes are corrected to the client's without a report, so
monitoring through `onHydrationError` does not see an injected handler or URL attribute (it is
removed all the same). In detail, on both clients (h() vnodes and compiled JSX built with
`hydratable`):

- **Attributes.** A claimed element ends with exactly the attributes a client render gives it.
  A server attribute survives only where a prop renders exactly that value; every other prop is
  written by the client's setter, which applies the same URL and attribute rules as a client
  render (a refused value, `javascript:` and the like, leaves no attribute, also when an earlier
  write or the server set one), and an attribute no prop renders (an `on*` handler, a stale one,
  `data-hk`) is removed. A compiled element takes exactly its template's attributes.
- **Content.** An element the client leaves empty keeps the server's content only where the
  protocol marks it as kept: an island's host, which the island hydrates, and an element whose
  raw HTML a `{ __html }` prop or binding writes, kept only when it is the same. Anywhere else
  the content is removed and reported (`extra-nodes`).
- **Shadow roots.** An element hosting a shadow root (a declarative one, `<template
  shadowrootmode="open">` in the response) is replaced by the client's element and reported
  (`shadow-root`), also inside a static subtree the compiled client adopts whole.
- **Scripts, templates and leftovers.** Nodes the client does not render are removed and
  reported wherever they are. Only at the container's top level are the stream's own elements
  left in place: its `application/json` data elements, the content templates of boundaries not
  yet swapped in, and its inline `_$W` scripts.
- **Elements from data.** A vnode is recognised by a private brand only what-core's producers
  give, so an object from JSON, a store or a server action shaped like an element renders as
  text. what-react's `isValidElement` accepts only elements (a vnode, or an object carrying
  React's element symbol, which JSON cannot), and `cloneElement` returns anything else
  unchanged.
- **Keyed rows.** A keyed list's server row is adopted only as the row of its own key (the server
  writes the rows' keys with the list), never as another key's: rows in another order are moved to
  their keys, and a list whose server rows the client cannot match by key is built by the client.
  A server node, and what the user typed into it before hydration, stays with its key. The
  mismatch is reported (kind `key`).
- **Event handlers** belong to the component, row or root that set them: once it is disposed
  (an unmount, a later `hydrate()` of the same container) the handler never runs again, also on
  an element that outlived it.

**What hydration does not decide.** The data channel (`<script type="application/json">` with
the server's values) is part of the response too: a value adopted from it is rendered with the
client's own escaping and rules, like any data, but it is the server's value. A response an
attacker can change can therefore change what the page shows, as it could without hydration;
the baseline is that it cannot make the page run code or show markup that the client's render
of that data would not. Two limits:

- A *closed* declarative shadow root (`shadowrootmode="closed"`) is invisible to script, so
  hydration cannot see or remove one. Keep untrusted markup out of the server's output, and
  serve pages with a Content Security Policy.
- Scripts in the response run when the browser parses it, before `hydrate()`. Removing a
  leftover `<script>` afterwards does not undo it: the server's escaping (every value
  what-server writes is escaped, URLs are scheme-checked, `srcdoc` and `outerHTML` are never
  written) is what keeps them out.
