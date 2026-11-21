# what-isr

Origin-first incremental static regeneration for [What Framework](https://whatfw.com):
stale-while-revalidate at the origin, on-demand and poll regeneration, and
Cache-Control headers that let any standards-compliant CDN cache at the edge
too. It works on any host with no CDN, and never imports what-server.

```bash
npm install what-isr
```

```js
import { createRequestHandler } from 'what-server';
import { createCacheEngine, createMemoryStore } from 'what-isr';

const cache = createCacheEngine({ store: createMemoryStore() });
const handle = createRequestHandler({ routes, cache });
```

Routes with `page: { mode: 'static' }` or `'hybrid'` go through the cache;
`mode: 'server'` routes never do. A fresh entry is served as a `HIT`; an entry
past `revalidate` but within `swr` is served at once as `STALE` while one
background regeneration refreshes it; a cold or expired entry renders
(`MISS`). Concurrent requests for the same key share one regeneration.

## What is stored, and what a render's response changes

A render may set its own response: a loader's `response`, or `getResponse()`
in a component (what-server). Because an entry is shared between visitors, the
engine applies one rule to it:

| The render... | Stored? | Shared with waiting requests? | Sent as |
|---|---|---|---|
| answers 200 and sets nothing private | yes | yes | `public, s-maxage=…, stale-while-revalidate=…`, with the headers it set |
| sets `Set-Cookie` | no | no | its own headers and cookies, `private, no-store` |
| sets `Cache-Control` with `private`, `no-store` or `no-cache` | no | no | its own headers, with that `Cache-Control` |
| sets `Vary` | no | no | its own headers, `private, no-store` |
| reads a request header the route's `vary` does not name (what-server marks it `usedRequestHeaders`) | no | no | its own headers, `private, no-store` |
| redirects, or answers any status but 200 | no | no | its status, its `Location`, its own headers, `private, no-store` |

- **Replayed headers.** A stored entry keeps the headers the render set
  (`Content-Language`, `Link`, an app's `X-*` header) and sends them on every
  `HIT` and `STALE`.
- **Headers the engine owns.** `Cache-Control`, `Vary`, `X-What-Cache`,
  `Cache-Tag` and `Surrogate-Key` come from the route's config, not from the
  render. Framing and hop-by-hop headers (`Content-Length`,
  `Transfer-Encoding`, `Connection`, …) and `Location` are never stored.
- **Cookies.** `Set-Cookie` is never stored and never replayed. A render that
  sets one is private: its cookie reaches its own requester only.
- **Waiting requests.** A request that waited on a regeneration whose result is
  not a public 200 renders for itself, with its own request; it never receives
  another visitor's private page, cookie or redirect.

Declare `vary` on a route (`page: { vary: ['cookie:session', 'accept-language'] }`)
to keep one entry per value instead of refusing to cache it.

## Shared regenerations and aborts

A regeneration is shared work, so it is not tied to the request that started
it. `render(routeMatch, ctx)` receives `ctx.signal`, which aborts only when
every request waiting on that regeneration has gone, and never for a
background refresh (a `STALE` hit, `revalidatePath(..., { regenerate: true })`,
the poll scheduler). A request's own signal is `routeMatch.signal` (the deploy
adapter sets it from the `Request`): when it aborts, that request stops waiting
at once and is rejected with its abort reason, and the regeneration carries on
for everyone else.

## Stores

`createMemoryStore({ max })`, `createFilesystemStore({ dir })` and
`createRedisStore({ client, prefix })` share one async interface (`get`, `set`,
`delete`, `deleteByTag`, `deleteByPath`, `clear`, `keys`). Build entries with
`makeEntry(out, config, now)`, which fills the time fields and decides
`private` and the stored `headers` from `out.headers` by the rule above.

## Invalidation

`engine.revalidatePath(path, { regenerate })` and
`engine.revalidateTag(tag, { regenerate })` purge the origin store (and the CDN,
when a CDN adapter is configured). Only same-origin local paths are accepted.
`createRevalidateWebhook(engine, { secret })` exposes them over HTTP, and
`createScheduler()` regenerates registered routes on an interval.

## License

MIT
