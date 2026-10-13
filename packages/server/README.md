# what-server

Server-side rendering, streaming, islands architecture, and static site generation for [What Framework](https://whatfw.com). Zero JavaScript shipped by default -- islands opt in to client interactivity.

## Install

```bash
npm install what-server what-core
```

Or use via the main package:

```js
import { renderToString, renderToStream } from 'what-framework/server';
```

## Render to String

```js
import { renderToString } from 'what-server';
import { h } from 'what-core';

function App() {
  return h('div', null,
    h('h1', null, 'Hello from the server'),
    h('p', null, 'This page ships zero JavaScript.')
  );
}

const html = renderToString(h(App));
// <div><h1>Hello from the server</h1><p>This page ships zero JavaScript.</p></div>
```

## Streaming SSR

```js
import { renderToStream } from 'what-server';

for await (const chunk of renderToStream(h(App))) {
  response.write(chunk);
}
response.end();
```

## Page Modes

```js
import { definePage } from 'what-server';

export const page = definePage({
  mode: 'static',  // Pre-render at build time (default)
  // mode: 'server'  // Render on each request
  // mode: 'client'  // Render in browser (SPA)
  // mode: 'hybrid'  // Static shell + interactive islands
});
```

## Static Generation

```js
import { generateStaticPage } from 'what-server';

const html = generateStaticPage({
  component: App,
  title: 'My Page',
  meta: { description: 'A statically generated page' },
  mode: 'static',
});
```

## Server Components

Mark components as server-only. They render on the server and ship no JavaScript to the client.

```js
import { server } from 'what-server';

const Header = server(({ title }) => h('header', null, title));
```

## Server Actions

```js
import { action, useAction, formAction, useFormAction } from 'what-server/actions';

// Define a server action
const addTodo = action(async (text) => {
  await db.todos.create({ text });
});

// Use in a component
function TodoForm() {
  const { execute, isPending } = useAction(addTodo);
  return h('button', { onclick: () => execute('New todo') }, 'Add');
}

// Form action
const submitForm = formAction(async (formData) => {
  const email = formData.get('email');
  await subscribe(email);
});
```

## Request Handler & CSRF (on by default)

`createRequestHandler` is the full-stack entry: route match → render → action
dispatch, as a Web-Fetch `(Request) => Response` handler.

```js
import { createRequestHandler } from 'what-server';

const handle = createRequestHandler({ routes }); // CSRF protection is ON — zero config
```

How the default CSRF wiring works (double-submit cookie):

1. Every HTML response ensures a `what-csrf` cookie (`SameSite=Lax`, readable
   by JS so the fetch client can echo it).
2. Uncached HTML renders also embed `<meta name="what-csrf-token">` with the
   same token (ISR-cached pages skip the meta tag so a per-user token is never
   baked into shared cache entries — clients read the cookie instead).
3. `POST /__what_action` validates the client-supplied token (`X-CSRF-Token`
   header for fetch clients, `_csrf` form field for plain HTML forms) against
   the cookie. Mismatch or missing token → `403`.

Opt out explicitly (e.g. token-authed APIs behind another gateway):

```js
createRequestHandler({ routes, csrf: false });
```

Passing your own `actionHandler` also disables the auto-provisioning — a
custom handler owns its CSRF policy via `createActionHandler({ getCsrfToken })`
or `{ skipCsrf: true }`.

### Plain HTML form posts (progressive enhancement)

`POST /__what_action` accepts `application/x-www-form-urlencoded` bodies, so
forms work without any client JavaScript:

```html
<form method="post" action="/__what_action">
  <input type="hidden" name="_action" value="my-action-id">
  <input type="hidden" name="_csrf" value="{token from the what-csrf-token meta tag}">
  <input type="hidden" name="_redirect" value="/thanks">
  <input name="email">
  <button>Subscribe</button>
</form>
```

- Action id: `_action` (or `data-action`) hidden field, or `?action=` query param.
- The action receives **one argument**: the form fields as a plain object
  (reserved `_action` / `_csrf` / `_redirect` fields stripped; repeated field
  names become arrays).
- Success responds `303 See Other` (POST/redirect/GET) to `_redirect` (must be
  a local path), else the Referer path, else `/`.
- Failures respond with an HTML error page and a matching status (`403` bad
  CSRF, `404` unknown action, `500` action error).

The JSON path is unchanged: fetch clients send `X-What-Action` + JSON
`{ args }` and get JSON back.

## Deploying

All five deploy adapters wrap the same Web-Fetch core (`createRequestHandler`),
so routes, actions, CSRF, and ISR behave identically everywhere. Node, static,
Vercel and Cloudflare are covered by `test/deploy-readiness.test.js`, Vura by
`test/adapter-vura.test.js`.

### Node (self-hosted: VPS, Docker, Fly, Railway)

```js
// server.js
import { createServer } from 'what-server';
import { routes } from './routes.js';

createServer({ routes }).listen(process.env.PORT || 3000);
```

Run `node server.js`. That's the deploy. `createServer` accepts the same
options as `createRequestHandler` (`cache` for ISR, `scheduler` for background
revalidation — the scheduler is stopped cleanly on SIGTERM/SIGINT). To mount
inside an existing Express/connect app use `whatMiddleware(options)` (calls
`next()` on 404), or convert any Web-Fetch handler with `toNodeListener(handler)`.

### Static export (any CDN: Nginx, S3, GitHub Pages, Netlify)

```js
import { exportStatic } from 'what-server';
const { pages } = await exportStatic({ routes, outDir: 'dist' });
```

Renders every `static`/`hybrid` route to `dist/<path>/index.html` plus a
`__what_data.json` per page (loader data for client-side navigation). Dynamic
routes need `getStaticPaths`. Upload `dist/` to any static host — no special
server config required (the layout is plain `path/index.html`). Note: server
actions and per-user CSRF need a runtime — pair a static export with one of
the runtime adapters if you use actions.

### Vercel

```js
// build.mjs — emit a Build Output API v3 directory
import { buildVercelOutput } from 'what-server';

await buildVercelOutput({
  files: { 'index.mjs': bundledHandlerCode }, // your build bundles routes + createVercelHandler into this
  staticDir: 'public',                         // optional: CDN-served assets
});
```

The function entry must export the Web-Fetch handler:

```js
// (bundled into index.mjs)
import { createVercelHandler } from 'what-server';
import { routes } from './routes.js';
export default createVercelHandler({ routes });
```

Then deploy the prebuilt output: `vercel deploy --prebuilt`. The emitted
layout is `config.json` (version 3, filesystem-first routing) +
`functions/render.func/{.vc-config.json,index.mjs}` + `static/`. ISR maps to
Vercel's native `s-maxage`/`stale-while-revalidate` headers emitted by the
cache engine. Calling `buildVercelOutput()` without `files` writes
`config.json` only (your build step owns `functions/` — backward compatible).

### Vura

A Vura deploy is static files plus ONE scale-to-zero Function. The Function
entry exports the handler:

```js
// function.js
import { createVuraHandler } from 'what-server';
import { routes } from './routes.js';
export default createVuraHandler({ routes });
```

`createVuraHandler` also accepts an existing Web-Fetch handler, so an app that
already builds one (the create-what full-stack `server.js` exports
`createHandler()`) reuses it: `export default createVuraHandler(createHandler())`.
It returns the Function module shape Vura loads, `{ fetch(request, env) }`, and
rebuilds `request.url` from the edge's `x-forwarded-host` and
`x-forwarded-proto` headers, so absolute URLs, Secure cookies and origin checks
see the public origin rather than the platform's internal one. `env` is exposed
to loaders as `request.__env`, as on Cloudflare.

The build script writes Vura's output directory:

```js
// build.js
import { buildVuraOutput } from 'what-server';

await buildVuraOutput({
  entry: 'function.js',
  staticFiles: [
    { from: 'public', to: '/' },  // public/favicon.svg -> /favicon.svg
    'src/entry-client.js',        // served at /src/entry-client.js
    'src/pages',                  // whole directories work too
  ],
});
```

It deletes and rewrites `dist/` with:

- `dist/static/**`: the listed files at their URL paths, served by the CDN.
- `dist/functions/_/index.js`: `entry` bundled by esbuild into one ESM file
  with every dependency inlined (only Node builtins stay external), because the
  Function runs with no `node_modules`. esbuild is resolved from the project, so
  add it as a devDependency (`npm i -D esbuild`); `buildVuraOutput` throws a
  clear error without it.
- `dist/manifest.json`: a Vura manifest v1 with one catch-all serverless route
  (`/*`, all HTTP methods, compute class `function`, 1 GB by default, set with
  `memory`). Its `requiredFeatures` are `["api", "function-compute"]`, so the
  deploy needs no dedicated compute. It also sets `"filesystemFirst": true`,
  which tells the edge to serve a file from `dist/static` before routing to the
  catch-all Function. Without it the client JS and CSS would reach the
  Function and 404.

The CDN answers requests for files in `dist/static`; every other request
(pages, `POST /__what_action`, `POST /__what_revalidate`) reaches the Function.
Options are `projectRoot` (default `process.cwd()`), `outDir` (default `dist`,
must be inside the project), `entry`, `staticFiles` and `memory`. Paths with
`..` segments, absolute sources, and targets that would leave `dist/static` are
refused before anything is written. Missing sources are skipped and returned in
`skipped`. ISR uses the origin cache engine inside the Function, so an
in-memory store is per instance; pass a shared what-isr store for one cache
across instances. The poll scheduler (`createScheduler`) does not run inside a
Function, which only runs while it serves a request. To revalidate on a
schedule, have an external cron call `POST /__what_revalidate` (set
`WHAT_REVALIDATE_SECRET` so the webhook is mounted).

### Cloudflare Workers

```js
// worker.js
import { createCloudflareHandler } from 'what-server';
import { routes } from './routes.js';
export default createCloudflareHandler({ routes });
```

```toml
# wrangler.toml
name = "my-what-app"
main = "worker.js"
compatibility_date = "2026-01-01"
```

`wrangler dev` to verify locally, `wrangler deploy` to ship. The handler is a
standard ES module worker (`{ fetch(request, env, ctx) }`); `env`/`ctx` are
exposed to loaders/renderers as `request.__env` / `request.__ctx` for KV/D1
bindings and `ctx.waitUntil`. For ISR across isolates, pass a KV/redis-backed
`what-isr` store as `cache` (in-memory caches don't survive isolate recycling).
Manual verification step (workerd is not a repo dependency): run
`wrangler dev worker.js` and load `/` — module shape and request handling are
covered by automated tests.

## Sub-path Exports

| Path | Contents |
|---|---|
| `what-server` | `renderToString`, `renderToStream`, `definePage`, `generateStaticPage`, `server` |
| `what-server/islands` | Islands hydration runtime |
| `what-server/actions` | Server actions and mutations |

## API

| Export | Description |
|---|---|
| `renderToString(vnode)` | Render a component tree to an HTML string |
| `renderToStream(vnode)` | Render as an async iterator for streaming |
| `definePage(config)` | Define page rendering mode and metadata |
| `generateStaticPage(page, data?)` | Generate a full HTML document |
| `server(Component)` | Mark a component as server-only |
| `action(fn)` | Define a server action |
| `formAction(fn)` | Define a form-based server action |
| `useAction(action)` | Hook to call a server action |
| `useFormAction(action)` | Hook for form server actions |
| `useOptimistic(state)` | Optimistic UI updates |
| `useMutation(fn)` | Mutation with loading/error states |
| `invalidatePath(path)` | Revalidate a page path |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
