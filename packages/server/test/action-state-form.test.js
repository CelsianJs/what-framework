// One edit form, with server validation, with and without JavaScript:
//
//   const [state, dispatch] = useActionState(savePost, null);
//   <Form action={dispatch}>
//     <input name="title" defaultValue={() => state()?.fields?.title ?? post.title} />
//     {() => state()?.error && <p role="alert">{state().error}</p>}
//   </Form>
//
// Without JavaScript the form posts to the page it is on, with the state it
// held and its useActionState's key. The request handler runs
// savePost(state, fields) under the action endpoint's rules and renders that
// page with what the action returned, for that form alone: another form of
// the same action on the page keeps its own defaults. That render is the
// visitor's own: never stored in the ISR cache, never served from it. There is
// no cookie and no size limit but the body's. An action that redirects
// (getResponse().redirect()) answers 303 there, and with JavaScript the
// client navigates there once what it revalidates has landed.
// Before, the form posted to the action endpoint, which redirected back
// (to the Referer) with the result in a 3 KB cookie keyed by the action id:
// a long draft came back as the saved one, and every form of the action
// showed the result.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { createCacheEngine, createMemoryStore } from 'what-isr';

const { h, useActionState, useLoaderData, hydrate, settled, getResponse } = await import('what-core');
const { __resetHydrationData } = await import('what-core/internal');
const { Form, action, createRequestHandler, createFormPostHandler, renderDocument } = await import('../src/index.js');

const calls = [];
const saved = new Map();
const savePost = action(async (previous, fields) => {
  calls.push([previous, fields]);
  const title = String(fields.title ?? '');
  if (title.trim().length < 3) return { error: 'Title needs three characters', fields: { title, body: fields.body } };
  saved.set(fields.slug, title);
  return { saved: true, fields: { title, body: fields.body } };
}, { id: 'posts/save' });
action(async (...args) => {
  calls.push(args);
  return { ok: true };
}, { id: 'posts/plain' });
action(async () => {
  throw new Error('database down');
}, { id: 'posts/broken' });
const cookie = action(async (_previous, fields) => {
  getResponse().setHeader('set-cookie', 'flash=saved; Path=/; HttpOnly');
  getResponse().setHeader('set-cookie', 'last=' + encodeURIComponent(fields.slug) + '; Path=/');
  return { saved: true };
}, { id: 'posts/cookie' });
const publish = action(async (_previous, fields) => {
  const title = String(fields.title ?? '');
  if (title.trim().length < 3) return { error: 'Title needs three characters', fields: { title } };
  saved.set(fields.slug, title);
  getResponse().redirect('/posts/' + encodeURIComponent(fields.slug));
  return { saved: true };
}, { id: 'posts/publish' });

function Editor({ post, save = savePost }) {
  const [state, dispatch] = useActionState(save, null);
  return h(Form, { action: dispatch, id: 'editor-' + post.slug },
    h('input', { type: 'hidden', name: 'slug', value: post.slug }),
    h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? post.title }),
    h('textarea', { name: 'body', defaultValue: () => state()?.fields?.body ?? '' }),
    () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
    () => (state()?.saved ? h('p', { role: 'status' }, 'Saved') : null),
    h('button', { type: 'submit' }, 'Save'));
}

function EditPage() {
  const { posts } = useLoaderData();
  return h('main', null, ...posts.map((post) => h(Editor, { post })));
}
const loadPosts = () => ({ posts: [{ slug: 'one', title: 'One original' }, { slug: 'two', title: 'Two original' }] });

const routes = [{ path: '/edit', component: EditPage, loader: loadPosts, page: { mode: 'hybrid', revalidate: 60 } }];
const origin = 'http://blog.test';

// A header given as null is not sent.
function post(handle, path, body, headers = {}) {
  const sent = Object.entries({ 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers }).filter(([, v]) => v !== null);
  return handle(new Request(`${origin}${path}`, {
    method: 'POST',
    headers: Object.fromEntries(sent),
    body: new URLSearchParams(body).toString(),
  }));
}

// The forms of a page: each one's hidden fields, alerts and title.
function forms(html) {
  return [...html.matchAll(/<form[^>]*id="editor-([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)].map(([, slug, inner]) => ({
    slug,
    key: (/name="_actionKey" value="([^"]*)"/.exec(inner) || [])[1],
    state: (/name="_state" value="([^"]*)"/.exec(inner) || [])[1],
    alerts: [...inner.matchAll(/role="alert">([^<]*)</g)].map((m) => m[1]),
    status: /role="status">Saved</.test(inner),
    title: (/<input name="title" value="([^"]*)"/.exec(inner) || [])[1],
    // The parser drops the newline the server writes first in a textarea.
    body: (/<textarea name="body">\n?([^<]*)<\/textarea>/.exec(inner) || [])[1],
  }));
}

async function page(handle) {
  const res = await handle(new Request(`${origin}/edit`));
  return forms(await res.text());
}

// The fields editor `slug`'s form posts, as the browser would send them.
function fieldsOf(form, slug, values) {
  return { _action: 'posts/save', _state: 'null', _actionKey: form.key, slug, ...values };
}

beforeEach(() => {
  calls.length = 0;
  saved.clear();
});

describe('a useActionState form without JavaScript', () => {
  it('posts to the page it is on, with the action id, the state it holds and its key', async () => {
    const handle = createRequestHandler({ routes });
    const html = await (await handle(new Request(`${origin}/edit`))).text();
    const tags = [...html.matchAll(/<form[^>]*>/g)].map((m) => m[0]);
    assert.equal(tags.length, 2);
    for (const tag of tags) {
      assert.match(tag, /method="post"/);
      assert.doesNotMatch(tag, /\saction=/, 'no action attribute: the browser posts to the address it shows');
    }
    const [one, two] = forms(html);
    assert.equal(one.state, 'null');
    assert.ok(one.key && two.key && one.key !== two.key, `each form has a key of its own: ${one.key}, ${two.key}`);
    assert.match(html, /<input type="hidden" name="_action" value="posts\/save">/);
  });

  it('posts to its permalink when one is given', async () => {
    function Permalinked() {
      const [, dispatch] = useActionState(savePost, null, '/posts/one/edit');
      return h(Form, { action: dispatch }, h('button', {}, 'Save'));
    }
    const html = await renderDocument({ default: Permalinked }, { request: new Request(`${origin}/edit`) });
    assert.match(html, /<form[^>]*action="\/posts\/one\/edit"/);
  });

  it('runs the action with the previous state and renders the page with its result, outside the cache', async () => {
    const store = createMemoryStore();
    const handle = createRequestHandler({ routes, cache: createCacheEngine({ store, logger: { warn() {}, error() {} } }) });
    const first = await handle(new Request(`${origin}/edit`));
    assert.equal(first.headers.get('x-what-cache'), 'MISS');
    const [one] = forms(await first.text());

    const res = await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x', body: 'Draft' }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [[null, { slug: 'one', title: 'x', body: 'Draft' }]]);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.headers.get('x-what-cache'), null, 'not served from or through the cache');
    assert.equal(res.headers.get('location'), null);
    assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith('what-as-')), 'no state cookie');
    const [back] = forms(await res.text());
    assert.deepEqual(back.alerts, ['Title needs three characters']);
    assert.equal(back.title, 'x');
    assert.equal(back.body, 'Draft');
    assert.equal(back.state, '{&quot;error&quot;:&quot;Title needs three characters&quot;,&quot;fields&quot;:{&quot;title&quot;:&quot;x&quot;,&quot;body&quot;:&quot;Draft&quot;}}');

    const again = await handle(new Request(`${origin}/edit`));
    assert.equal(again.headers.get('x-what-cache'), 'HIT', 'the shared entry is the one stored before');
    const [shared] = forms(await again.text());
    assert.deepEqual(shared.alerts, []);
    assert.equal(shared.title, 'One original');
  });

  it('brings a long draft back whole: no limit but the body limit', async () => {
    const handle = createRequestHandler({ routes });
    const [one] = await page(handle);
    for (const size of [4 * 1024, 64 * 1024]) {
      const body = 'An ordinary paragraph from a draft article. '.repeat(Math.ceil(size / 44)).slice(0, size);
      const res = await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x', body }));
      assert.equal(res.status, 200);
      const [back] = forms(await res.text());
      assert.deepEqual(back.alerts, ['Title needs three characters']);
      assert.equal(back.body.length, body.length, `${size} bytes`);
      // The state it renders with posts back too: the next submit gets it.
      const state = JSON.parse(back.state.replaceAll('&quot;', '"'));
      assert.equal(state.fields.body.length, body.length);
    }
    const tooLarge = await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x', body: 'y'.repeat(1024 * 1024) }));
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(calls.length, 2, 'the over-limit post never reached the action');
  });

  it('takes a larger body with `bodyLimit`, and answers one over it with a page', async () => {
    const handle = createRequestHandler({ routes, bodyLimit: 4 * 1024 * 1024 });
    const [one] = await page(handle);
    const body = 'x'.repeat(1536 * 1024);
    const res = await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x', body }), { accept: 'text/html' });
    assert.equal(res.status, 200);
    assert.equal(forms(await res.text())[0].body.length, body.length);
    const over = await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x', body: 'y'.repeat(4 * 1024 * 1024) }), { accept: 'text/html' });
    assert.equal(over.status, 413);
    assert.match(over.headers.get('content-type'), /text\/html/);
    assert.match(await over.text(), /over the 4194304 bytes this site accepts/);
    const endpoint = await handle(new Request(`${origin}/__what_action`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-what-action': 'posts/save', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ args: [null, { title: 'y'.repeat(4 * 1024 * 1024) }] }),
    }));
    assert.equal(endpoint.status, 413);
    assert.match(endpoint.headers.get('content-type'), /json/, 'a fetch call gets JSON');
    for (const bodyLimit of [0, -1, 1.5, '1mb', Infinity]) {
      assert.throws(() => createRequestHandler({ routes, bodyLimit }), /bodyLimit/, String(bodyLimit));
    }
  });

  it('comes back to the form that was posted, and to no other form of the same action', async () => {
    const handle = createRequestHandler({ routes });
    const [one] = await page(handle);

    const invalid = forms(await (await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x' }))).text());
    assert.deepEqual(invalid.map((f) => f.alerts), [['Title needs three characters'], []]);
    assert.deepEqual(invalid.map((f) => f.title), ['x', 'Two original']);

    const ok = forms(await (await post(handle, '/edit', fieldsOf(one, 'one', { title: 'One only' }))).text());
    assert.deepEqual(ok.map((f) => f.status), [true, false]);
    assert.deepEqual(ok.map((f) => f.title), ['One only', 'Two original']);
    assert.equal(ok[1].state, 'null', 'the second form still holds its initial state');

    // The second editor, saved untouched from that page, saves its own title.
    const second = forms(await (await post(handle, '/edit', fieldsOf(ok[1], 'two', { title: ok[1].title }))).text());
    assert.deepEqual(second.map((f) => f.status), [false, true]);
    assert.equal(saved.get('two'), 'Two original');
    assert.equal(saved.get('one'), 'One only');

    // A key no form on the page has seeds none of them.
    const stray = forms(await (await post(handle, '/edit', { ...fieldsOf(one, 'one', { title: 'x' }), _actionKey: 'nobody:0' })).text());
    assert.deepEqual(stray.map((f) => f.alerts), [[], []]);
  });

  it('renders a forged state only as text', async () => {
    const forging = action(async (previous) => previous, { id: 'posts/echo' });
    function Echo() {
      const [state, dispatch] = useActionState(forging, null);
      return h(Form, { action: dispatch, id: 'editor-echo' },
        () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
        h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? '' }));
    }
    const handle = createRequestHandler({ routes: [{ path: '/echo', component: Echo }] });
    const [form] = forms(await (await handle(new Request(`${origin}/echo`))).text());
    const forged = JSON.stringify({ error: '<img src=x onerror=alert(1)>', fields: { title: '"><script>x</script>' } });
    const html = await (await post(handle, '/echo', { _action: 'posts/echo', _state: forged, _actionKey: form.key })).text();
    const [back] = forms(html);
    assert.deepEqual(back.alerts, ['&lt;img src=x onerror=alert(1)&gt;']);
    assert.equal(back.title, '&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
    assert.doesNotMatch(html, /<img src=x|<script>x/);

    // Members that would stand in for the methods a render calls to write a
    // value as text are not read: the page renders, with no SSR error.
    const errors = [];
    const error = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      for (const raw of ['{"error":{"toString":"x"}}', '{"error":{"valueOf":1,"toString":1}}', '{"fields":{"title":{"toString":"x"}}}', '{"error":["a",{"toString":"x"}]}']) {
        const res = await post(handle, '/echo', { _action: 'posts/echo', _state: raw, _actionKey: form.key });
        const page = await res.text();
        assert.equal(res.status, 200, raw);
        assert.doesNotMatch(page, /SSR Error/, raw);
      }
    } finally {
      console.error = error;
    }
    assert.deepEqual(errors, []);
  });

  it('takes the action endpoint\'s rules: origin, token, registered id, a JSON state, and a failure is the action\'s', async () => {
    const handle = createRequestHandler({ routes });
    const [one] = await page(handle);
    const cross = await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x' }), { 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403);
    const noToken = await post(handle, '/edit', fieldsOf(one, 'one', { title: 'x' }), { 'sec-fetch-site': null });
    assert.equal(noToken.status, 403, 'neither Fetch Metadata nor Origin, and no token: the double-submit check');
    const badToken = await post(handle, '/edit', { ...fieldsOf(one, 'one', { title: 'x' }), _csrf: 'forged' }, { 'sec-fetch-site': null, cookie: 'what-csrf=real' });
    assert.equal(badToken.status, 403);
    const withToken = await post(handle, '/edit', { ...fieldsOf(one, 'one', { title: 'x' }), _csrf: 'real' }, { 'sec-fetch-site': null, cookie: 'what-csrf=real' });
    assert.equal(withToken.status, 200);
    assert.equal(calls.length, 1, 'only the post with the right token ran');

    assert.equal((await post(handle, '/edit', { ...fieldsOf(one, 'one', { title: 'x' }), _state: '{nope' })).status, 400);
    assert.equal((await post(handle, '/edit', { ...fieldsOf(one, 'one', { title: 'x' }), _action: 'posts/unknown' })).status, 404);
    const broken = await post(handle, '/edit', { ...fieldsOf(one, 'one', {}), _action: 'posts/broken' });
    assert.equal(broken.status, 500);
    assert.doesNotMatch(await broken.text(), /database down/, 'the action\'s error stays on the server');

    const skipped = createRequestHandler({ routes, csrf: false });
    assert.equal((await post(skipped, '/edit', fieldsOf(one, 'one', { title: 'x' }), { 'sec-fetch-site': 'cross-site' })).status, 200, 'csrf: false');
  });

  it('leaves a POST to a page without `_action` as it was: the page reads its body', async () => {
    let read = null;
    const handle = createRequestHandler({
      routes: [{
        path: '/search',
        component: () => h('p', null, 'Results'),
        loader: async ({ request }) => {
          read = request.method === 'POST' ? Object.fromEntries(await request.formData()) : null;
          return {};
        },
        page: { mode: 'server' },
      }],
    });
    const res = await post(handle, '/search', { q: 'signals' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Results/);
    assert.deepEqual(read, { q: 'signals' });
    assert.deepEqual(calls, []);
  });

  it('answers 303 to where the action redirected, with the cookies it set', async () => {
    function PublishPage() {
      return h('main', null, h(Editor, { post: { slug: 'one', title: 'One original' }, save: publish }));
    }
    const handle = createRequestHandler({ routes: [{ path: '/publish', component: PublishPage }, { path: '/cookie', component: () => h(Editor, { post: { slug: 'one', title: '' }, save: cookie }) }] });
    const [form] = forms(await (await handle(new Request(`${origin}/publish`))).text());

    const invalid = await post(handle, '/publish', { ...fieldsOf(form, 'one', { title: 'x' }), _action: 'posts/publish' });
    assert.equal(invalid.status, 200, 'errors render in place');
    assert.deepEqual(forms(await invalid.text())[0].alerts, ['Title needs three characters']);

    const published = await post(handle, '/publish', { ...fieldsOf(form, 'one', { title: 'A new title' }), _action: 'posts/publish' });
    assert.equal(published.status, 303);
    assert.equal(published.headers.get('location'), '/posts/one');
    assert.equal(saved.get('one'), 'A new title');

    const [cookieForm] = forms(await (await handle(new Request(`${origin}/cookie`))).text());
    const withCookies = await post(handle, '/cookie', { ...fieldsOf(cookieForm, 'one', {}), _action: 'posts/cookie' });
    assert.equal(withCookies.status, 200);
    assert.deepEqual(withCookies.headers.getSetCookie().filter((c) => !c.startsWith('what-csrf=')), ['flash=saved; Path=/; HttpOnly', 'last=one; Path=/']);
    assert.equal(withCookies.headers.get('cache-control'), 'private, no-store');
  });

  it('answers a fetch call with the redirect in X-What-Redirect and the cookies it set', async () => {
    const handle = createRequestHandler({ routes: [] });
    const call = (id, args) => handle(new Request(`${origin}/__what_action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': id, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ args }),
    }));
    const invalid = await call('posts/publish', [null, { slug: 'one', title: 'x' }]);
    assert.equal(invalid.status, 200);
    assert.equal(invalid.headers.get('x-what-redirect'), null);
    assert.deepEqual(await invalid.json(), { error: 'Title needs three characters', fields: { title: 'x' } });
    const published = await call('posts/publish', [null, { slug: 'one', title: 'A new title' }]);
    assert.equal(published.status, 200, 'never a 3xx: fetch would follow it');
    assert.equal(published.headers.get('x-what-redirect'), '/posts/one');
    assert.deepEqual(await published.json(), { saved: true });
    const withCookies = await call('posts/cookie', [null, { slug: 'one' }]);
    assert.deepEqual(withCookies.headers.getSetCookie(), ['flash=saved; Path=/; HttpOnly', 'last=one; Path=/']);
    assert.equal(withCookies.headers.get('content-type'), 'application/json');
  });

  it('serves a custom server through createFormPostHandler and renderDocument', async () => {
    const run = createFormPostHandler({ skipCsrf: true });
    const shown = await renderDocument({ default: EditPage, loader: loadPosts }, { request: new Request(`${origin}/edit`) });
    const [one] = forms(shown);
    assert.equal(await run({ method: 'POST', headers: {}, body: { q: 'x' }, url: `${origin}/edit` }), null, 'not a form the framework runs');
    const outcome = await run({ method: 'POST', headers: {}, body: fieldsOf(one, 'one', { title: 'x' }), url: `${origin}/edit` });
    assert.deepEqual(outcome.actionState, { action: 'posts/save', key: one.key, state: { error: 'Title needs three characters', fields: { title: 'x', body: undefined } } });
    const html = await renderDocument({ default: EditPage, loader: loadPosts }, { request: new Request(`${origin}/edit`), actionState: outcome.actionState });
    assert.deepEqual(forms(html).map((f) => f.alerts), [['Title needs three characters'], []]);
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

  it('hydrates each form of a page rendered from a posted state from its own state', async () => {
    const shown = await renderDocument({ default: EditPage, loader: loadPosts }, { request: new Request(`${origin}/edit`) });
    const [, two] = forms(shown);
    const state = { error: 'Title needs three characters', fields: { title: 'x', body: 'Draft' } };
    const html = await renderDocument({ default: EditPage, loader: loadPosts }, { request: new Request(`${origin}/edit`), actionState: { action: 'posts/save', key: two.key, state } });
    assert.deepEqual(forms(html).map((f) => f.alerts), [[], ['Title needs three characters']]);
    const env = installDOM();
    try {
      __resetHydrationData();
      document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
      const [first, second] = document.querySelectorAll('[name=title]');
      const problems = [];
      const stop = hydrate(h(EditPage, { loaderData: loadPosts() }), document.body, { onHydrationError: (info) => problems.push(info.kind) });
      assert.deepEqual(problems, []);
      assert.deepEqual([...document.querySelectorAll('[name=title]')], [first, second]);
      assert.deepEqual([first.value, second.value], ['One original', 'x']);
      assert.equal(second.defaultValue, 'x');
      assert.deepEqual([...document.querySelectorAll('[role=alert]')].map((el) => el.closest('form').id), ['editor-two']);
      assert.equal(document.querySelector('#editor-one [name=_state]').value, 'null');
      stop();
    } finally {
      env.cleanup();
    }
  });
});

describe('a <Form> with no csrfToken prop, hydrated', () => {
  it('adopts the fields the server rendered: the page\'s own token is not one of them', async () => {
    const html = await renderDocument({ default: EditPage, loader: loadPosts }, { csrfToken: 'page-token' });
    const env = installDOM();
    try {
      __resetHydrationData();
      document.head.innerHTML = '<meta name="what-csrf-token" content="page-token">';
      document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
      const problems = [];
      const stop = hydrate(h(EditPage, { loaderData: loadPosts() }), document.body, { onHydrationError: (info) => problems.push(info.kind) });
      assert.deepEqual(problems, []);
      assert.equal(document.querySelector('input[name=what-csrf-token]'), null);
      stop();
    } finally {
      env.cleanup();
    }
  });
});
