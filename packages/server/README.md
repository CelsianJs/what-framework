# what-server

Server-side rendering, streaming, islands architecture, and static site generation for [What Framework](https://whatfw.com). Zero JavaScript shipped by default -- islands opt in to client interactivity.

## Install

```bash
npm install what-framework
```

Or use via the main package:

```js
import { renderToString, renderToStream } from 'what-framework/server';
```

## Render to String

```js
import { renderToString } from 'what-framework/server';
import { h } from 'what-framework';

function App() {
  return h('div', null,
    h('h1', null, 'Hello from the server'),
    h('p', null, 'This page ships zero JavaScript.')
  );
}

const html = renderToString(h(App));
// <div><h1>Hello from the server</h1><p>This page ships zero JavaScript.</p></div>
```

Views written in JSX render on the server too. what-compiler/vite compiles a
module Vite transforms for the server with the server target (its `ssr`
option, on by default), and every renderer here accepts that output; with the
Babel plugin, pass `generate: 'ssr'` for the server build.

## Hydration

A page the client will hydrate is rendered with `renderToHydratableString`, or
any of the async and streaming renderers below, which all write the same
hydratable markup: `data-hk="<owner path>"` on the first element of each
component, `<!--$-->…<!--/$-->` around a reactive child, `<!--[]-->…<!--/[]-->`
around an array, and `<!--b-->…<!--/b-->` around a `<Suspense>` or
`<ErrorBoundary>` (`<!--b!-->` when it rendered its fallback). The children of
a `<textarea>` or `<title>` are written as escaped text with no markers (the
parser reads a comment there as text), and every renderer writes a newline
right after `<pre>`, `<textarea>` and `<listing>`, the one the parser drops, so
content that begins with a newline keeps it. The protocol is described in
[docs/ARCHITECTURE.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ARCHITECTURE.md#server-rendering).

```js
// client (what-framework), for the full-page document what-server renders
// (renderDocument, createRequestHandler, the scaffold): the route is written
// directly under <body>
import { hydrate } from 'what-framework';
const unmount = hydrate(<App />, document.body, {
  onHydrationError: (mismatch) => report(mismatch), // optional; production too
});
```

A page that writes its own wrapper around the markup hydrates that wrapper:

```js
// server
import { renderToHydratableString } from 'what-framework/server';
const page = `<div id="app">${renderToHydratableString(<App />)}</div>`;

// client
hydrate(<App />, '#app');
```

`hydrate()` and `mount()` given no element (`null`, or a selector that matches
nothing) throw `ERR_MOUNT_TARGET_MISSING`.

`hydrate()` adopts the server's nodes instead of creating new ones: where the
markup matches, it adds no node, runs each reactive child once and fetches no
resource or async `computed` the server already sent. It returns the unmount function, and
hydrating the same container again disposes the first root.

- **Compiled JSX** on the client must be compiled for hydration. The Vite
  plugin (`what-compiler/vite`) does that when its config says the project
  renders on the server (`appType: 'custom'`, an SSR build, or a client build
  with `build.ssrManifest`); otherwise set `what({ hydratable: true })` for the
  client build. JSX compiled without it renders the page again on the client and
  reports an `ERR_HYDRATION_MISMATCH` of kind `not-hydratable` once.
- **`h()` and the JSX runtime** (`jsxImportSource: 'what-framework'`) hydrate
  as they are.
- **Mismatches** (the client renders something the server did not) are reported
  as `ERR_HYDRATION_MISMATCH` in development and to `onHydrationError` in every
  build, one per region, with the kind, the component, its owner path and the
  DOM path; the one element or text node that differs is rendered on the
  client. A late streamed boundary reports to the same hook.
- **Nothing the server wrote that the client does not render survives**
  (SECURITY.md, Hydration): an attribute stays only where a prop renders
  exactly its value, an element the client leaves empty is emptied (an
  island's host and matching `{ __html }` excepted), and an element hosting a
  declarative shadow root is replaced (kind `shadow-root`). Event handlers
  belong to their owner, so a handler of a root that a later `hydrate()`
  replaced never runs again.
- **Server data is found by identity.** A component takes its owner path from
  the `data-hk` the server put where its output starts, so a branch only one
  side renders, or a boundary's fallback, never hands it a neighbour's value.
- **Vnodes are branded.** Only `h()`, the JSX runtime and the boundaries make
  vnodes: an object from JSON shaped like one renders as text on every server
  path and on the client. An island prop that is a vnode is revived on the
  client by the path the server recorded (`data-island-vnodes`).

## Streaming SSR

`renderToStream` sends the shell first: everything outside a `<Suspense>` that
is still waiting goes out in one chunk, with each fallback in place. Each
boundary follows as soon as its data is ready, as a `<template>` and a small
swap script, with its resolved data sent ahead of it so the client hydrates
without fetching again.

```js
import { renderToStream } from 'what-framework/server';
import { h } from 'what-framework';

function App() {
  return h('main', null, h('h1', null, 'Hello from the server'));
}

// Node: pipe into the response (honours backpressure, ends it when done).
export async function handleNode(req, res) {
  const stream = renderToStream(h(App), {
    onError: (error, { phase }) => console.error(`[ssr ${phase}]`, error),
  });
  await stream.shellReady;          // status and headers are final from here
  res.writeHead(200, { 'content-type': 'text/html' });
  stream.pipe(res);
}

// Fetch-style hosts (Workers, Deno, Bun, Vercel): a pull-based ReadableStream.
export function handleFetch(request) {
  return new Response(renderToStream(h(App), { request }).readable, {
    headers: { 'content-type': 'text/html' },
  });
}

// Or iterate string chunks.
export async function renderChunks(write) {
  for await (const chunk of renderToStream(h(App))) write(chunk);
}
```

Consume a stream once, one way. It is not a promise: for the whole page as one
settled string (caches, ISR, crawlers), use `renderDocument` or
`renderToStringAsync`. Options: `nonce` (set on every script), `noScripts` (no
inline scripts; the client entry calls what-core's `applyStreamedBoundaries()`
before hydrating), `signal` (abort), `onError` (called for every error the
render contains or fails on), `loaderData`, `request`, `response` (a
`createResponse()`; the stream also exposes it as `stream.response`), `idPrefix`
(a letter, then letters, digits, `_` or `-`; anything else throws
`ERR_SSR_INVALID_ID_PREFIX`). `renderDocumentStream(pageModule, reqCtx,
options)` streams a whole document; the deploy adapters use it for
`mode: 'server'` routes unless the route sets `page.stream: false` or the
handler has a custom `render`.

The buffered forms (`renderToStringAsync`, `renderDocument`, and on top of them
ISR, `exportStatic` and `page.stream: false`) run on the same engine: they wait
for everything the stream waits for (a resource inside or outside a
`<Suspense>`, an async component, `lazy()`), and their body is the streamed
page once every boundary has been swapped in. A render that cannot complete
rejects with the `Error` that failed it.

How a stream ends:

- `allReady` resolves when the last boundary has been sent. When the render
  fails, or is aborted before then, it rejects with the reason.
- Stopping a stream from the consumer side (`abort()`, a destroyed writable,
  cancelling `readable`, leaving the loop) aborts the render's own signal: the
  loader and every resource fetcher see it. After the shell, the document's
  closing tags are still written and pending boundaries keep their fallbacks.
- Ending a render, in any of these ways, removes its listener from the signal
  you passed and disposes every `effect()` and `computed()` its components
  created, so a finished request never runs code in a later one.
- A boundary the server cannot render (its data never settled) keeps its
  fallback: the stream sends its `failed` record and removes the placeholder,
  so the fallback hydrates as one and the client renders the boundary itself.
- `<Head>` tags set inside a boundary that streams after the shell travel with
  that boundary and are applied to `document.head` (development warns once with
  `ERR_SSR_LATE_HEAD`, since the HTML `<head>` does not carry them).
- Boundary ids are `${idPrefix}${random}-${n}`, new for every stream, and the
  swap finds its nodes as `<template>` elements, so page markup carrying any id
  cannot take a boundary over.

The client entry of a streamed page should run once the document has loaded (a
`type="module"` script does) and call `applyStreamedBoundaries()` before
`hydrate()` when the stream used `noScripts`; it is harmless to call it on any
streamed page.

Error details stay on the server unless `NODE_ENV` is exactly `development`: a
resource's error record and a component's `<!-- SSR Error -->` comment carry a
generic message otherwise (no `NODE_ENV`, `staging`, or a runtime without
`process`), and only framework `ERR_*` codes travel as `code`.

## Loaders, status and redirects

A page's `loader` receives `{ params, query, request, signal, response }`.
`signal` aborts when the client disconnects. `response` sets the status,
headers and redirects; components reach the same object with what-core's
`getResponse()`:

```js
export async function loader({ params, signal, response }) {
  const post = await db.post(params.id, { signal });
  if (!post) response.setStatus(404);
  if (post?.movedTo) response.redirect(post.movedTo, 301);
  response.setHeader('set-cookie', 'seen=1; Path=/');   // Set-Cookie appends
  return post;
}
```

The response is committed with the first byte. A buffered render
(`renderToString(vnode, { response })`, `renderToStringAsync`, which returns
it as `response`, `renderDocument`, a route with `page.stream: false`) sends
nothing before it has finished, so whatever a component sets counts. A
streamed render sends its shell first: what the shell's components set counts,
including a status decided by data read outside any `<Suspense>` (the shell
waits for it), and a redirect made by then is a real 3xx. After the shell,
`setStatus` and `setHeader` do nothing (with a development warning) and a
redirect is sent as a script. The Node and edge adapters send exactly what the
tree set. Server resource fetchers receive `{ signal, request }`; `signal` is the
render's own, which aborts when the client goes away or the stream's consumer
stops reading.

`redirect(path, status = 302)` takes a same-origin path only (`/account?tab=2`,
fragment kept), by the same rule as the action handler's `_redirect` field, so
it is safe to hand request data (`redirect(query.next)`). The path is the
app's: below a base (the request handler's `basePath: '/app'`, else
what-router's base), `redirect('/login')` answers `Location: /app/login`, as
a server action's redirect and what-router's `redirect()` do. Leaving the site
is a separate, explicit call:

```js
response.redirectExternal('https://billing.example.com/portal', 303);
```

`redirectExternal` takes an absolute `http:` or `https:` URL with no
credentials, or a `mailto:` or `tel:` URL. A target either method refuses (`https://evil.example` through
`redirect`, `//host`, `/\host`, `javascript:`) is not an error: the response
redirects to the app's root (`/`, or `/app/` below a base) instead, and
development logs `ERR_SSR_UNSAFE_REDIRECT`.
A status that is not a redirect status throws a `RangeError`.

### Cached routes and the response

A `static` or `hybrid` route served through an ISR cache (`what-isr`) shares
one render between visitors, so what a render sets decides what can be shared:

- **Private renders are never stored.** A render is private when it sets a
  cookie, sets `Cache-Control` with `private`, `no-store` or `no-cache`, sets
  `Vary`, or reads a request header the route's `vary` does not name (a
  cookie, `Authorization`, `Accept-Language`; development warns which). The
  Cookie header carries every cookie, so reading it reads each cookie the
  request has: with `vary: ['cookie:theme']`, a visitor who also sends `uid`
  gets a private render. A copy of the request (`request.clone()`) counts the
  same. The request is a real `Request`, so it can be used whole
  (`new Request(request)`, `fetch(request)`); used that way it carries only the
  headers and cookies the route's `vary` names. A private render is
  sent to its own visitor only, with its own headers and cookies, as
  `private, no-store` (or the private `Cache-Control` it set), and every
  visitor waiting on the same regeneration renders for themselves.
- **Redirects and other statuses go to their own visitor only**, with their
  status and `Location`, and are never stored or shared.
- **A stored page keeps its own headers.** On a public 200 render, the headers
  it set (`Content-Language`, `Link`, an `X-*` header) are stored with the
  entry and sent again on every HIT and STALE. The cache owns `Cache-Control`
  (from the route's `revalidate`/`swr`), `Vary`, `X-What-Cache`, `Cache-Tag`
  and `Surrogate-Key`. `Set-Cookie` is never stored or replayed.
- **No public response carries a cookie.** When the CSRF cookie has to be set
  on a cached page (a visitor without one), that response is sent
  `private, no-store`, so no shared cache keeps one visitor's token.
- **A regeneration is shared work.** Its loader and fetchers get a signal that
  aborts only when every visitor waiting on it has gone (never for a background
  refresh). A visitor who disconnects stops waiting at once; the others still
  get the page.

Declare per-visitor variation with `vary` (`page: { vary: ['cookie:session'] }`)
to cache one entry per value, or use `mode: 'server'` for pages that are
different for every visitor.

## Page Modes

```js
import { definePage } from 'what-framework/server';

export const page = definePage({
  mode: 'static',  // Pre-render at build time (default)
  // mode: 'server'  // Render on each request
  // mode: 'client'  // Render in browser (SPA)
  // mode: 'hybrid'  // Static shell + interactive islands
});
```

## Static Generation

```js
import { generateStaticPage } from 'what-framework/server';

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
import { h } from 'what-framework';
import { server } from 'what-framework/server';

const Header = server(({ title }) => h('header', null, title));
```

## Server Actions

```js
import { action, Form } from 'what-framework/server';
import { h, useActionState, useFormStatus, startTransition } from 'what-framework';

// Define a server action. `revalidate` purges the cached pages on the server
// and refetches what was read on those paths on the client; `invalidates`
// refetches query keys on the client.
export const addTodo = action(async ({ text }) => {
  await db.todos.create({ text });
  return { ok: true };
}, { id: 'addTodo', revalidate: ['/todos'], invalidates: [['todos']] });

// A form: a real <form method="post"> without JavaScript; with it, a
// transition whose status useFormStatus() reads.
function SaveButton() {
  const status = useFormStatus();
  return h('button', { disabled: () => status.pending() }, () => (status.pending() ? 'Adding…' : 'Add'));
}
function TodoForm() {
  return h(Form, { action: addTodo, redirect: '/todos' }, h('input', { name: 'text' }), h(SaveButton));
}

// Action IDs belong to the JavaScript realm: one realm serves one app's
// actions (an ID registered twice warns in development,
// ERR_DUPLICATE_ACTION_ID, and the later registration is called).

// Or call it: on the client it runs as a transition (or joins the one it is
// called in) and resolves once what it revalidates has landed.
function AddButton() {
  const [result, run, isPending] = useActionState((_, text) => addTodo({ text }), null);
  return h('button', { onclick: () => run('New todo'), disabled: () => isPending() }, () => (result() ? 'Added' : 'Add'));
}

// Inside your own transition, with an optimistic overlay.
function addLater(text, addOptimistic) {
  return startTransition(async () => {
    addOptimistic(text);
    await addTodo({ text });
  });
}
```

### An edit form with server validation

`<Form action={serverAction} redirect>` is fire and redirect: without
JavaScript what the action returns is not carried back. A form that shows what
the server said uses the dispatch of `useActionState(serverAction, initial)`:

```js
import { action, Form } from 'what-framework/server';
import { getResponse, h, useActionState } from 'what-framework';

export const saveTitle = action(async (previous, fields) => {
  const typed = String(fields.title ?? '');
  const title = typed.trim();
  if (title.length < 3) return { error: 'Title needs three characters', fields: { title: typed } };
  await db.posts.update(fields.slug, { title });
  getResponse().redirect(`/posts/${fields.slug}`);   // a save goes to the post
  return { saved: true };
}, { id: 'saveTitle' });

function EditTitle({ post }) {
  const [state, save] = useActionState(saveTitle, null);
  return h(Form, { action: save },
    h('input', { type: 'hidden', name: 'slug', value: post.slug }),
    h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? post.title }),
    () => state()?.error && h('p', { role: 'alert' }, state().error),
    h('button', { type: 'submit' }, 'Save'));
}
```

The action is called as `saveTitle(previousState, fields)`. With JavaScript
its result becomes `state`, then the form resets to the defaults that state
gives, so the typed title stays. Without JavaScript the form posts to the page
it is on (it has no `action` attribute; `useActionState`'s `permalink` names
another URL), with its state in a hidden `_state` field and the hook's key in
`_actionKey`. `createRequestHandler` runs the action by the action endpoint's
rules (the CSRF checks, the body limit, registered ids only, the reserved
fields, the request's context) and renders the matched page with what it
returned, seeded into that form's `useActionState` alone, with the render's
status and
`cache-control: private, no-store`, outside the ISR cache. There is no size
limit but the body's. Reloading that page, or going back to it, posts the form
again, as with any form POST; a redirect on success avoids it. The state is the visitor's to set: show it, trust it for nothing.

The body limit is `bodyLimit` (bytes, 1 MB by default) on `createRequestHandler`,
`nodeActionMiddleware`, `fetchActionHandler` and `createFormPostHandler`, and it
covers every body the handler reads: an action call, a form posted to a page
(read to look for `_action`, so a page's own urlencoded or multipart POST is
held to it too) and the revalidate webhook. A body over it is answered 413, by
one rule on every entry point: a short HTML page for a browser's form post (an
urlencoded or multipart body, or a request that accepts `text/html`), JSON for
an action call (`X-What-Action`, what the action client sends) and anything
else. The recipe above returns the fields as typed in the state, so a re-post
carries the draft twice (its field, and `_state`'s `fields`): a draft fits in
about half the limit. A site that takes long drafts raises it,
`createRequestHandler({ routes, bodyLimit: 4 * 1024 * 1024 })`.

**A form with a file.** Give the form `enctype="multipart/form-data"`, as HTML
requires, and the action gets the file as a Web `File` in its fields, with and
without JavaScript: the endpoint and a page post read a multipart body with the
platform's own parser into the same fields an urlencoded one gives (a repeated
name an array), and the action client sends a call whose fields hold a file as
that form, multipart, the state as `_state`. As in any form, a name sent once
is one value: a call's `{ tags: ['a'] }` arrives as `tags: 'a'`, so read a
field that can repeat as `[].concat(fields.tags)`. A file input with nothing chosen
is an empty `File` (`size` 0, name `''`), as the platform's parser gives it:
test `size === 0`, not the empty string. The whole body, every field and file in it, is within
`bodyLimit`: raise it for uploads. A form without the multipart `enctype`
posts a file's name alone, with JavaScript too, as the browser's own submit of
it does. An action's result never carries a file (JSON has no form for its
bytes): a `File` in it is `null` in the state, with and without JavaScript, so
return what the page shows about the file (its name, its size) and echo the
text fields only. A file input cannot be filled in again after a validation
error (a browser rule): the visitor chooses the file again.

```js
export const signup = action(async (previous, fields) => {
  const avatar = fields.avatar;                     // a File; an empty one (size 0) when none was chosen
  if (!(avatar instanceof File) || avatar.size === 0) {
    return { error: 'Attach an avatar', fields: { email: fields.email } };
  }
  await saveAvatar(fields.email, await avatar.arrayBuffer());
  getResponse().redirect('/welcome');
  return { saved: true };
}, { id: 'signup' });
```

A body over `bodyLimit` runs nothing. Without JavaScript the visitor gets the
server's 413 page, which names the limit. With JavaScript the call rejects with
`ERR_PAYLOAD_TOO_LARGE` (`status` 413, `limit` the bytes allowed; a proxy's or
platform's own 413 carries no `limit`, and the message then says the server
accepts less in one request), which, as any
error an action throws, reaches the nearest `<ErrorBoundary>` above the
component that dispatched it: a page with none shows nothing. Check a file's size before the form is sent, which keeps what the
visitor typed and tells them why, and put the form in a boundary for the rest
(another refused call is `ERR_ACTION_FAILED` with its `status`):

```jsx
const MAX_UPLOAD = 1_000_000; // bodyLimit, less room for the other fields

function Signup() {
  const [state, save] = useActionState(signup, null);
  return <Form action={save} enctype="multipart/form-data">
    <input name="email" defaultValue={state()?.fields?.email ?? ''} />
    <input type="file" name="avatar" onChange={(e) => {
      const file = e.target.files[0];
      e.target.setCustomValidity(file && file.size > MAX_UPLOAD ? 'Choose a file under 1 MB' : '');
    }} />
    <button type="submit">Create account</button>
  </Form>;
}

// The boundary goes around the component whose useActionState dispatched the
// action: that component is where the action's error is thrown.
<ErrorBoundary fallback={({ error, reset }) => (
  <p role="alert">
    {error.code === 'ERR_PAYLOAD_TOO_LARGE' && error.limit !== undefined ? `Too large: the limit is ${error.limit} bytes.` : error.message}
    <button onClick={reset}>Try again</button>
  </p>
)}>
  <Signup />
</ErrorBoundary>
```

Which form is "that form" is the hook's key. Inside a keyed list (a `<For key>`
row, a `.map()` row with a `key`) the key follows the row's key, as React's key
path does, so a record's editor gets its own result back when records were
added, removed or reordered between the page and the post. Another form of the
same action keeps its own state. A list's or a component's place is where it
is written, so a list or a component before it that is there in one render and
not in the other (a Pinned table the record joins, a section shown while it
has rows) moves no other list's rows. A helper function called twice in a
component renders the same JSX twice, told apart by order: write it as a
component when one of its calls is conditional (docs/DATA.md). Forms that
repeat without a key are told apart by position only, and a
change in their order in between hands the result to the form now in that
place. A row key is a string or a finite number. The page carries it as a
digest under the render's salt, which hides a long random key but not one
that can be guessed: the salt is in the page, so a guess is checked in a
moment, and a small number or an email address is found. Keep secrets out of
row keys (docs/DATA.md).

`getResponse()` in an action is the response of its call: `redirect(path)`
(a same-origin path, as in a loader) answers a no-JS post with 303 and, with
JavaScript, sends `X-What-Redirect`, which the client follows once the
action's revalidation has landed (through the mounted `<Router>`, else by
loading the page). `setHeader()` (a cookie) reaches the response either way.

**Below a base path** (what-router's `setBase('/app')`, or Vite's
`base: '/app/'`), an action posts to `/app/__what_action`, and a `<Form>`'s
action, `redirect` and permalink are written below the base. A path an action
redirects to is a URL of the app, as a loader's and the router's are: the
response of its call sends `/app/x`, in a no-JS post's 303 (a request handler
with `basePath: '/app'`) and in `X-What-Redirect` alike, and with JavaScript
the `<Router>` goes there.

**A custom server.** `nodeActionMiddleware` serves only the action endpoint.
For page-posted forms, run the post with `createFormPostHandler(options)` (the
action endpoint's options, `bodyLimit` among them) before rendering the page,
and render with what it resolved to. Pass the Web `request` and leave `body`
out, and it reads an urlencoded or multipart body itself, from a copy, up to
`bodyLimit` (a body you parsed yourself goes in `body`, a file as a `File`):

```js
import { createFormPostHandler, renderDocument } from 'what-server';

// The same options as the action endpoint: here the token is the app's own CSRF cookie.
const runFormPost = createFormPostHandler({ getCsrfToken: (req) => /(?:^|;\s*)app-csrf=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] });

// `request` is the Web Request: the handler reads its form body itself.
export async function answerPage(page, { request, ctx }) {
  const posted = await runFormPost({ method: 'POST', headers: Object.fromEntries(request.headers), url: request.url, request });
  if (posted === null) return { html: await renderDocument(page, ctx) };       // not a form the framework runs
  if (posted.response) return posted.response;                                // a refusal, a failure, or the action's 303
  const html = await renderDocument(page, { ...ctx, actionState: posted.actionState });
  return { html, headers: { ...posted.headers, 'cache-control': 'private, no-store' } };
}
```

The client callable posts JSON to `/__what_action` (a form's fields with a file
in them as multipart), rejects with the action's
error (`ERR_ACTION_FAILED`, or `TIMEOUT` after `timeout`, default 30 s), and
rolls back the optimistic overlays of its transition when it fails. See
the installed `what-framework/skills/what/SKILL.md` and the [online data guide](https://github.com/CelsianJs/what-framework/blob/main/docs/DATA.md).

**An action is a public endpoint.** Its id is in the page (`_action`,
`data-action`) and can be computed from the source, so anyone can post it,
with any arguments: CSRF protection stops other sites from posting in a
visitor's name, not a client from calling an action itself. An action checks
its caller and its arguments. The built-in endpoints (`createRequestHandler`,
`nodeActionMiddleware`, `fetchActionHandler`, `createActionHandler`) run each
call in a context of its own: `getRequest()` there is the request, with its
cookies and headers, and the query cache it reads is the call's own. Where
the runtime has no AsyncLocalStorage (Workers without `nodejs_compat`), the
context lasts until the action's first `await`: read `getRequest()` before
it, as below. After it, `getRequest()` is null and a query read gets an empty
cache of its own, never another caller's.

```js
import { action, getRequest } from 'what-server';

export const deleteTodo = action(async (id) => {
  const user = await sessionUser(getRequest());   // your session lookup
  if (!user) throw new Error('Not signed in');
  if (typeof id !== 'string') throw new Error('Bad id');
  await db.todos.delete({ id, owner: user.id });
}, { id: 'deleteTodo' });
```

## Request Handler & CSRF (on by default)

`createRequestHandler` is the full-stack entry: route match → render → action
dispatch, as a Web-Fetch `(Request) => Response` handler.

```js
import { createRequestHandler } from 'what-framework/server';

const handle = createRequestHandler({ routes }); // CSRF protection is ON — zero config
```

Its built-in renderer answers each page with the status, headers and redirect
the loader and the page set on `response` (`response.redirect()` in a loader, a
`<Router>` middleware's redirect, `response.setStatus(404)`), and hands the
loader the visitor's `csrfToken` on an uncached route. `createRouteRenderer(document)`
returns that renderer, for an ISR engine's `render` (scheduled regeneration)
or to wrap it, so an app never re-implements it. A scheduled regeneration has
no request: the engine renders it from a GET request for the path, at the
origin of each entry it refreshes, or the path's default entry when none is
stored (what-isr's README, "Regenerations with no request"), and the renderer
renders a match with no request as a GET of its path too:

```js
import { createRequestHandler, createRouteRenderer } from 'what-framework/server';
import { createCacheEngine, createMemoryStore } from 'what-isr';

const document = { clientEntry: '/src/entry-client.js' };
const cache = createCacheEngine({ store: createMemoryStore(), render: createRouteRenderer(document) });
const handle = createRequestHandler({ routes, cache, document });
```

The renderer goes to the engine, not to the handler: the handler renders
requests with its built-in renderer already, and a handler given a `render`
of its own (even this one) renders `mode: 'server'` routes buffered instead
of streaming them.

How the default CSRF protection works:

1. `POST /__what_action` refuses a request the browser marks cross-site
   (`Sec-Fetch-Site: cross-site` or `same-site`, or an `Origin` that is not
   this host) with `403`, and accepts one it marks same-origin. That is how a
   form on a cached or streamed page posts: its shared HTML carries no
   visitor's token. `csrf: { trustedOrigins: ['https://app.example'] }` lets
   other origins of the app post. An `Origin` is compared with this server's
   origin, scheme included: the scheme is the connection's (a TLS socket, or
   the URL the platform hands the handler), or `X-Forwarded-Proto` when a proxy
   sends it. That header is believed without configuration, because a page on
   another site cannot set it on a visitor's request. Behind a TLS-terminating
   proxy, have the proxy send it (nginx: `proxy_set_header X-Forwarded-Proto
   $scheme;`), or list the `https://` origin in `trustedOrigins`; otherwise the
   server takes itself for `http`. The Node adapter's `request.url` and the ISR
   cache take their scheme by the same rule; on a fetch platform (Bun, Deno,
   Cloudflare, Vercel) a loader's `request.url` and an action's
   `getRequest().url` stay the URL the platform hands the handler.
2. A request that carries neither header (an old browser, a script) must
   carry the double-submit token: every HTML response ensures a `what-csrf`
   cookie (`SameSite=Lax`, readable by JS so the fetch client can echo it),
   uncached HTML renders also embed `<meta name="what-csrf-token">` and hand
   the token to the loader as `ctx.csrfToken` (ISR-cached pages never carry
   one), and the endpoint checks the token (`X-CSRF-Token` header for fetch
   clients, `_csrf` or `what-csrf-token` field for plain HTML forms) against
   the cookie. Mismatch or missing token → `403`. A token sent with a
   same-origin request is checked too.

Opt out explicitly (e.g. token-authed APIs behind another gateway):

```js
createRequestHandler({ routes, csrf: false });
```

Passing your own `actionHandler` also disables the auto-provisioning — a
custom handler owns its CSRF policy via `createActionHandler({ getCsrfToken })`
or `{ skipCsrf: true }`. A form posted to a page is checked by the `csrf`
option either way (the `what-csrf` cookie as its token).

### Plain HTML form posts (progressive enhancement)

`POST /__what_action` accepts `application/x-www-form-urlencoded` and
`multipart/form-data` bodies (a form with a file input), so forms work without
any client JavaScript:

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
  (reserved `_action` / `_csrf` / `_redirect` / `_state` / `_actionKey` fields
  stripped; repeated field names become arrays; a file is a Web `File`). A form that posts `_state`
  (JSON) is called with two, `(state, fields)`; a `_state` that is not JSON is
  a `400`.
- Success responds `303 See Other` (POST/redirect/GET) to the action's
  `getResponse().redirect()`, else `_redirect` (must be a local path; `<Form>`
  writes the page it is on when it has no `redirect`), else the Referer path,
  else `/`.
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
import { createServer } from 'what-framework/server';
import { routes } from './routes.js';

createServer({ routes }).listen(process.env.PORT || 3000);
```

Run `node server.js`. That's the deploy. `createServer` accepts the same
options as `createRequestHandler` (`cache` for ISR, `scheduler` for background
revalidation — the scheduler is stopped cleanly on SIGTERM/SIGINT). To mount
inside an existing Express/connect app use `whatMiddleware(options)` (calls
`next()` on 404), or convert any Web-Fetch handler with `toNodeListener(handler)`.
The listener reads each body before the handler, up to the `bodyLimit`
`createRequestHandler` gave its handler: a handler you wrap in a function of
your own (logging, headers) has none, so pass the limit,
`toNodeListener(wrapped, { bodyLimit: 4 * 1024 * 1024 })`.

### Static export (any CDN: Nginx, S3, GitHub Pages, Netlify)

```js
import { exportStatic } from 'what-framework/server';
const { pages } = await exportStatic({ routes, outDir: 'dist' });
```

Renders every `static`/`hybrid` route to `dist/<path>/index.html` plus a
`__what_data.json` per page (loader data for client-side navigation). Dynamic
routes need `getStaticPaths`. Each page's loader and components get a
`request` (a GET of the URL the page's file is served at, `/about/` for
`about/index.html`, so a `<Router>` in the page shows its route, and its
route state and relative links are the ones the browser hydrates with at
that URL) and a `response` as on a server: a page that redirects is written as a
redirect stub (a meta refresh to the target and a canonical link) and listed in
`redirects`; a page that sets another status than 200 is not written (a static
host cannot send it) and is listed in `skipped`, with a warning. The result is
`{ pages, redirects, skipped }`. A site served below a path (a GitHub Pages
project site) passes it as `basePath` (`'/app'`, `'/app/'` or `'app'`), the
router's base: each page is rendered for its URL below it (what-router renders
below it with no `setBase` of its own), and the files are still written to
`dist/<path>/index.html`. Upload `dist/` to any static host — no special
server config required (the layout is plain `path/index.html`). Note: server
actions and per-user CSRF need a runtime — pair a static export with one of
the runtime adapters if you use actions.

### Vercel

```js
// build.mjs — emit a Build Output API v3 directory
import { buildVercelOutput } from 'what-framework/server';

await buildVercelOutput({
  files: { 'index.mjs': bundledHandlerCode }, // your build bundles routes + createVercelHandler into this
  staticDir: 'public',                         // optional: CDN-served assets
});
```

The function entry must export the Web-Fetch handler:

```js
// (bundled into index.mjs)
import { createVercelHandler } from 'what-framework/server';
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
import { createVuraHandler } from 'what-framework/server';
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
import { buildVuraOutput } from 'what-framework/server';

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
import { createCloudflareHandler } from 'what-framework/server';
import { routes } from './routes.js';
export default createCloudflareHandler({ routes });
```

```toml
# wrangler.toml
name = "my-what-app"
main = "worker.js"
compatibility_date = "2026-01-01"
```

Enable AsyncLocalStorage with the `nodejs_compat` compatibility flag
(`compatibility_flags = ["nodejs_compat"]`): without it, code a component or
a server action runs after an `await` loses its request (`getRequest()` is
null), and the queries it reads get an empty cache of their own instead of the
request's (their data is then not in the page's data channel). An action's
code before its first `await` still sees its request.

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
| `what-server/ssr-runtime` | The runtime half of what-compiler's server target (compiled output imports it as `what-framework/ssr-runtime`); not for application code |

## API

| Export | Description |
|---|---|
| `renderToString(vnode)` | Render a component tree to an HTML string |
| `renderToHydratableString(vnode)` | The same, with the hydration keys and markers `hydrate()` reads |
| `renderToStream(vnode, options?)` | Stream HTML shell-first; returns `{ shellReady, allReady, response, pipe, readable, abort }`, also async-iterable |
| `renderToStringAsync(vnode, init?, options?)` | The settled page as a string: `{ body, head, loaderData, resources, owned, ctx, response }`. `init` is `{ loaderData?, signal?, request?, response? }` (a `createResponse()`); any other field rejects with a `TypeError` |
| `renderDocument(page, reqCtx?, options?)` | Run the loader and render a whole document, settled |
| `renderDocumentStream(page, reqCtx?, options?)` | Run the loader and stream a whole document |
| `createResponse()` | A response object to pass as `reqCtx.response` from a custom server |
| `getRequest()` | The request being answered: in a server render, a loader, or an action the built-in endpoints run; else null |
| `ensureServerRuntime()` | Install the async request context where the host has one (every render calls it) |
| `definePage(config)` | Define page rendering mode and metadata |
| `generateStaticPage(page, data?)` | Generate a full HTML document |
| `server(Component)` | Mark a component as server-only |
| `action(fn, options?)` | Define a server action; on the client a transition that revalidates `revalidate` paths and `invalidates` query keys inside it |
| `Form` | `<Form action={serverActionOrDispatch} redirect?>`: a real form that runs as a transition when mounted; `useFormStatus()` reads it. Without JavaScript the dispatch of `useActionState(serverAction)` posts to its page, which renders with the action's result for that form |
| `createFormPostHandler(options?)` | Run a form posted to a page by the action endpoint's rules, for a custom server: `null`, `{ response }` or `{ actionState, headers }` |
| `useOptimistic(state, update?)` | The root entry's `useOptimistic`, re-exported: `[optimistic, addOptimistic]` as in React 19; call `addOptimistic` inside `startTransition` and the overlay drops when the action's transition commits ([ASYNC.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ASYNC.md)) |
| `invalidatePath(path)` / `onRevalidate(path, cb)` | what-framework/data's, re-exported: refetch what was read on `path` and run its callbacks |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
