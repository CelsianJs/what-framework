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

## Hydration

`hydrate()` adopts the DOM the browser built from the server's response instead of building
it again. It never parses a string, so it cannot make markup more trusted than the response
was; what it decides is how much of the response outlives the walk.

**The trust baseline.** After `hydrate()`, the container holds exactly what a client render of
the same tree with the same data holds: no element, attribute, URL, event handler, shadow root,
script, style or raw HTML that the client render would not produce. Markup that matches the
client's is kept as it is; anything else is replaced by the client's rendering or removed, and
reported (`ERR_HYDRATION_MISMATCH` in development, `onHydrationError` in every build). In
detail, on both clients (h() vnodes and compiled JSX built with `hydratable`):

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
