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
when the request sends no Host, validated the same way, and a request whose Host and `:authority`
differ is malformed (RFC 9113 section 8.3.1) and answered 400: a proxy in front may have routed or
cached it by the other. The path What routes on comes from the
request target, never from the Host, and it is the target's own path: a target whose path holds a
dot segment (`/public/../admin`, or percent-encoded, `%2e%2e`, `.%2E`) or a backslash is answered
400, because URL parsing would resolve it to a path a server in front (an Express route, a proxy
ACL) never routed. Browsers never send one. This holds at the Node entry points
(`toNodeListener`, `whatMiddleware`, `nodeActionMiddleware`) and `what dev`/`what preview`; a Fetch
entry (`fetchActionHandler`, the Vercel, Cloudflare and Vura adapters) receives a URL its platform
already parsed, so the platform's routing is the one a guard has to agree with there. A cached
(ISR) page is keyed on the request's origin as well as its path, so a Host one sender chose never
reaches another host's visitors; a regeneration with no request renders a path's default entry
from no visitor's request, and refreshes at most 16 stored origins of a path at a time, those a
request read most recently first. A planted Host that is requested counts as read: a sender who
requests 16 or more planted Hosts after the real one pushes the real origin out of the next tick's
16, and its entry then waits for a visitor's request to refresh it (served stale, within its
stale-while-revalidate window, or rendered for that visitor). Name the site's origins,
`createCacheEngine({ origins: ['https://shop.example'] })` (the full-stack starter reads
`PUBLIC_ORIGIN`), and that cannot happen: a request for any other origin is rendered for itself
alone (`private, no-store`), never stored or served from the store, and a scheduled regeneration
renders exactly the named origins. The origin is the request's Host with the scheme a proxy in
front reports in `X-Forwarded-Proto` (else the connection's), the rule the CSRF check uses: behind a
TLS proxy that sends it, `origins: ['https://…']` matches. An origin listed without its scheme, or an
empty list, stops the engine with an error. Still allowlist the hosts your proxy forwards: a page that builds absolute URLs from
`request.url` (a canonical link, a fetch to the app's own API) builds them on the host the request
named.

`what dev` and `what preview` answer only a Host that is localhost (or `*.localhost`), an IP
address, their `--host` or a name in `allowedHosts`, so a page that rebinds its own domain to the
developer's machine cannot read the dev sources or the build (403). The value is read as a host
first: `evil.test/.localhost` is no host, not a `.localhost` name. The HMR WebSocket answers a
page's Origin by the same list, at the dev server's port.

## Server actions

A server action is a public, unauthenticated endpoint: its id is in the page (and can be computed
from the source), and the client chooses every argument. CSRF protection (Fetch Metadata, Origin,
the double-submit token) stops another site from posting in a visitor's name; it does not stop a
client from calling an action itself. Authorize the caller and validate the arguments inside the
action: the built-in endpoints run each call with `getRequest()` returning its request (cookies,
headers), and with a query cache of its own.

### Request bodies and files

Every body the framework reads (an action call, a form posted to the action endpoint or to a
page, the revalidate webhook) is read whole into memory up to `bodyLimit` bytes (1 MB by default)
before anything parses it, on every entry point (`createRequestHandler` and the Node adapter in
front of it, `nodeActionMiddleware`, `fetchActionHandler`, `createFormPostHandler` when it reads
the request itself). Content-Length is checked first and the running total while the body
streams, so a chunked body or a false length cannot pass it. A body over it is answered 413 and
never parsed: an HTML page for a browser's form post (an urlencoded or multipart body, or a request
that accepts `text/html`), JSON for an action call (`X-What-Action`) and anything else.
`nodeActionMiddleware` answers as soon as the body passes the limit and reads the rest without
keeping it, so the client reads the 413.

A `multipart/form-data` body (a form with a file) is parsed by the platform's own parser
(`Response#formData`, undici in Node), never by the framework, and only after it is read whole
under the limit. So every bound follows from `bodyLimit`: each file and each field is smaller than
it, and a part takes at least about 40 bytes of boundary and headers, so a body holds at most
`bodyLimit / 40` parts (about 26,000 at the default; an urlencoded body of the same size holds more
fields, two bytes each). Parsing holds the body and the parts it reads at the same time, and a
form posted to a page keeps the request's own copy of the body for the page as well: up to about
three times `bodyLimit` for one request. A file reaches the action as a Web `File` held in memory, its name and type as
the client sent them: check its size and type, never trust its name as a path, and raise the limit
only as far as the server's memory allows for the requests it serves at once. The parsed fields
follow the urlencoded rules: the reserved names are the framework's (a reserved field sent as a
file is a malformed one: a `_state` that is a file is a 400), a name such as `__proto__` is a
field like any other, and the same CSRF checks and registered action ids apply. An action's result
never carries a file back to the page.

### A form posted to a page without JavaScript

A `<Form>` whose action is the dispatch of `useActionState(serverAction)` posts to the page it is on,
with the state it holds (`_state`, JSON) and its hook's key (`_actionKey`). `createRequestHandler`
runs the action and renders the page with the result. What holds, and what does not:

- The post goes through the action endpoint's checks, in the same code (`createFormPostHandler`):
  Fetch Metadata, then Origin, then the double-submit token; a registered action id only; the
  reserved fields kept from the action; the body limit (`bodyLimit`, 1 MB by default); the action
  run in the request's context. A post refused there never reaches the action. The page's `csrf`
  option decides the checks, whatever `actionHandler` is. A POST to a page without `_action` is the
  page's own, and an urlencoded or multipart one over `bodyLimit` is answered 413 before the page
  reads it, as every body over it is.
- The render that answers it is the visitor's own: never stored in or served from the ISR cache,
  and sent `private, no-store`. Nothing is set on the visitor's browser to carry the result: no
  cookie, and no Referer is read.
- The result reaches the one `useActionState` whose key the form posted. The key is a position in
  the component tree, not a secret: a visitor can post any key, and so choose which form on the page
  shows the result of their own post.
- The state, posted or rendered, is client data: the visitor can post anything as `_state`. A render
  shows it escaped like any value. Never authorize, look up or write anything from it; the action
  validates `previousState` as it validates its other arguments. Do not return another user's data,
  or a token, in it: it is in the page.
- An action's `getResponse().redirect()` takes a same-origin path only, by the loaders' rule (an
  absolute URL is refused and goes to `/`); `redirectExternal()` is the explicit way off the site.

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
