// One edit form, with server validation, with and without JavaScript:
//
//   const [state, dispatch] = useActionState(savePost, null);
//   <Form action={dispatch}>
//     <input name="title" defaultValue={() => state()?.fields?.title ?? post.title} />
//     {() => state()?.error && <p role="alert">{state().error}</p>}
//   </Form>
//
// Without JavaScript the form posts to the action endpoint with the state it
// held; the endpoint runs savePost(state, fields), answers 303 back to the
// page, and carries what the action returned in a one-time cookie, which the
// page's next render starts its useActionState from (and clears). That render
// is the visitor's own: never stored in the ISR cache, never served from it.
// With JavaScript the dispatch's result lands as the state, then the form is
// reset to the defaults that state gives, so the typed title survives.
// Before, the endpoint ran savePost(fields) and dropped what it returned, and
// a mounted form reset to the original title.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { createCacheEngine, createMemoryStore } from 'what-isr';

const { h, useActionState, hydrate, settled } = await import('what-core');
const { __resetHydrationData } = await import('what-core/internal');
const { Form, action, createRequestHandler, renderDocument } = await import('../src/index.js');

const calls = [];
const savePost = action(async (previous, fields) => {
  calls.push([previous, fields]);
  const title = String(fields.title ?? '');
  if (title.length < 3) return { error: 'Title needs three characters', fields: { title } };
  return { saved: true, fields: { title } };
}, { id: 'posts/save' });
action(async (...args) => {
  calls.push(args);
  return { ok: true };
}, { id: 'posts/plain' });

function Editor() {
  const [state, dispatch] = useActionState(savePost, null);
  return h(Form, { action: dispatch },
    h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? 'Hello world' }),
    () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
    () => (state()?.saved ? h('p', { role: 'status' }, 'Saved') : null),
    h('button', { type: 'submit' }, 'Save'));
}

const routes = [{ path: '/edit', component: Editor, page: { mode: 'hybrid', revalidate: 60 } }];
const origin = 'http://blog.test';

function post(handle, body, headers = {}) {
  return handle(new Request(`${origin}/__what_action`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', referer: `${origin}/edit`, ...headers },
    body: new URLSearchParams(body).toString(),
  }));
}

const alerts = (html) => [...html.matchAll(/role="alert">([^<]*)</g)].map((m) => m[1]);
const titleValue = (html) => (/<input name="title" value="([^"]*)"/.exec(html) || [])[1];

beforeEach(() => { calls.length = 0; });

describe('a useActionState form without JavaScript', () => {
  it('renders the action endpoint, the action id and the state it holds', async () => {
    const handle = createRequestHandler({ routes });
    const html = await (await handle(new Request(`${origin}/edit`))).text();
    assert.match(html, /<form[^>]*method="post"[^>]*action="\/__what_action"|<form[^>]*action="\/__what_action"[^>]*method="post"/);
    assert.match(html, /<input type="hidden" name="_action" value="posts\/save">/);
    assert.match(html, /<input type="hidden" name="_state" value="null">/);
  });

  it('runs the action with the previous state, comes back to the page with its result once, and keeps it out of the cache', async () => {
    const store = createMemoryStore();
    const handle = createRequestHandler({ routes, cache: createCacheEngine({ store, logger: { warn() {}, error() {} } }) });
    const first = await handle(new Request(`${origin}/edit`));
    assert.equal(first.headers.get('x-what-cache'), 'MISS');
    await first.text();

    const res = await post(handle, { _action: 'posts/save', _state: 'null', title: 'x' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/edit');
    assert.deepEqual(calls, [[null, { title: 'x' }]]);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /^what-as-[0-9a-f]+=[^;]+; Path=\/; Max-Age=60; HttpOnly; SameSite=Lax$/);

    const back = await handle(new Request(`${origin}/edit`, { headers: { cookie: `what-csrf=t; ${cookie.split(';')[0]}` } }));
    const html = await back.text();
    assert.deepEqual(alerts(html), ['Title needs three characters']);
    assert.equal(titleValue(html), 'x');
    assert.match(html, /name="_state" value="\{&quot;error&quot;:&quot;Title needs three characters&quot;,&quot;fields&quot;:\{&quot;title&quot;:&quot;x&quot;\}\}"/);
    assert.equal(back.headers.get('cache-control'), 'private, no-store');
    assert.equal(back.headers.get('x-what-cache'), null, 'not served from or through the cache');
    assert.ok(back.headers.getSetCookie().some((c) => c.startsWith(`${cookie.split('=')[0]}=; Path=/; Max-Age=0; HttpOnly`)), 'cleared');

    const again = await handle(new Request(`${origin}/edit`));
    const shared = await again.text();
    assert.equal(again.headers.get('x-what-cache'), 'HIT', 'the shared entry is the one stored before');
    assert.deepEqual(alerts(shared), []);
    assert.equal(titleValue(shared), 'Hello world');
  });

  it('carries a valid save back too, and a forged state renders only as text', async () => {
    const handle = createRequestHandler({ routes });
    const res = await post(handle, { _action: 'posts/save', _state: 'null', title: 'A title' });
    const html = await (await handle(new Request(`${origin}/edit`, { headers: { cookie: res.headers.get('set-cookie').split(';')[0] } }))).text();
    assert.match(html, /role="status">Saved</);
    assert.equal(titleValue(html), 'A title');

    const name = res.headers.get('set-cookie').split('=')[0];
    const forged = encodeURIComponent(JSON.stringify({ error: '<img src=x onerror=alert(1)>', fields: { title: '"><script>x</script>' } }));
    const page = await (await handle(new Request(`${origin}/edit`, { headers: { cookie: `${name}=${forged}` } }))).text();
    assert.deepEqual(alerts(page), ['&lt;img src=x onerror=alert(1)&gt;']);
    assert.equal(titleValue(page), '&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
    assert.doesNotMatch(page, /<img src=x|<script>x/);
    const broken = await handle(new Request(`${origin}/edit`, { headers: { cookie: `${name}=%7Bnot-json` } }));
    assert.equal(titleValue(await broken.text()), 'Hello world', 'a state that does not parse is no state');
    assert.ok(broken.headers.getSetCookie().some((c) => c.startsWith(`${name}=; Path=/; Max-Age=0`)), 'and is cleared');
  });

  it('refuses a state that is not JSON or over the limit, and drops a result over the limit', async () => {
    const handle = createRequestHandler({ routes });
    assert.equal((await post(handle, { _action: 'posts/save', _state: '{nope', title: 'x' })).status, 400);
    assert.equal((await post(handle, { _action: 'posts/save', _state: JSON.stringify('y'.repeat(4000)), title: 'x' })).status, 400);
    const warn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const res = await post(handle, { _action: 'posts/save', _state: 'null', title: 'z'.repeat(5000) });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('set-cookie'), null);
      assert.match(warnings.join('\n'), /ERR_ACTION_STATE_TOO_LARGE Server action "posts\/save" returned \d+ bytes/);
    } finally {
      console.warn = warn;
    }
  });

  it('leaves a server action\'s own form as it was: the fields alone, no cookie', async () => {
    const handle = createRequestHandler({ routes });
    const res = await post(handle, { _action: 'posts/plain', title: 'x' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.deepEqual(calls, [[{ title: 'x' }]]);
  });
});

describe('a useActionState form with JavaScript', () => {
  it('lands the state, then resets to the defaults it gives: the typed title stays, the error shows', async () => {
    const env = installDOM();
    const handle = createRequestHandler({ routes });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => handle(new Request(new URL(url, origin), { ...init, headers: { ...init.headers, 'sec-fetch-site': 'same-origin' } }));
    try {
      document.body.innerHTML = '<main></main>';
      const host = document.querySelector('main');
      const { mount } = await import('what-core');
      const order = [];
      const { effect } = await import('what-core');
      function Watched() {
        const [state, dispatch] = useActionState(savePost, null);
        effect(() => { if (state() !== null) order.push(`state, title ${host.querySelector('[name=title]').value}`); });
        return h(Form, { action: dispatch, onReset: () => order.push('reset') },
          h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? 'Hello world' }),
          () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null));
      }
      const stop = mount(h(Watched), host);
      const title = host.querySelector('[name=title]');
      title.value = 'x';
      host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      for (let i = 0; i < 20 && host.querySelector('[role=alert]') === null; i++) {
        await settled();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.deepEqual(calls, [[null, { title: 'x' }]]);
      assert.equal(host.querySelector('[role=alert]').textContent, 'Title needs three characters');
      assert.equal(host.querySelector('[name=title]'), title);
      assert.equal(title.value, 'x');
      assert.equal(title.defaultValue, 'x');
      assert.deepEqual(order, ['state, title x', 'reset']);
      stop();
    } finally {
      globalThis.fetch = realFetch;
      env.cleanup();
    }
  });

  it('hydrates a page rendered from a posted state from that state', async () => {
    const html = await renderDocument({ default: Editor }, { actionStates: new Map([['posts/save', { error: 'Title needs three characters', fields: { title: 'x' } }]]) });
    const env = installDOM();
    try {
      __resetHydrationData();
      document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
      const field = document.querySelector('[name=title]');
      assert.equal(field.value, 'x');
      const problems = [];
      const stop = hydrate(h(Editor), document.body, { onHydrationError: (info) => problems.push(info.kind) });
      assert.deepEqual(problems, []);
      assert.equal(document.querySelector('[name=title]'), field);
      assert.equal(field.value, 'x');
      assert.equal(field.defaultValue, 'x');
      assert.equal(document.querySelector('[role=alert]').textContent, 'Title needs three characters');
      stop();
    } finally {
      env.cleanup();
    }
  });
});

describe('a <Form> with no csrfToken prop, hydrated', () => {
  it('adopts the fields the server rendered: the page\'s own token is not one of them', async () => {
    const html = await renderDocument({ default: Editor }, { csrfToken: 'page-token' });
    const env = installDOM();
    try {
      __resetHydrationData();
      document.head.innerHTML = '<meta name="what-csrf-token" content="page-token">';
      document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
      const problems = [];
      const stop = hydrate(h(Editor), document.body, { onHydrationError: (info) => problems.push(info.kind) });
      assert.deepEqual(problems, []);
      assert.equal(document.querySelector('input[name=what-csrf-token]'), null);
      stop();
    } finally {
      env.cleanup();
    }
  });
});
