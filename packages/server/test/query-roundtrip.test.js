// The query cache through the server and back: a server render fetches each
// key once, per request (one request's data never answers another), sends it
// in the hydration channel under its key, and the hydrating client adopts it:
// no client fetch, no fallback, and the hooks on the same key see it right
// after the walk (a hook shows its first state on the server and in the walk,
// wherever it renders relative to the query).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let core;
let data;
let internal;
let server;
let collect;

before(async () => {
  ({ cleanup } = installDOM());
  core = await import('what-core');
  data = await import('what-core/data');
  internal = await import('what-core/internal');
  server = await import('../src/index.js');
  ({ collect } = await import('./stream-helpers.js'));
});
after(() => cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));
const bodyOf = (html) => html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const payloadOf = (html) => JSON.parse(html.match(/<script id="__what_data" type="application\/json">(.*?)<\/script>/)[1]);

// Each test reads its own key: the client cache lives for the whole file.
function app(calls, who, id) {
  const { h, Suspense } = core;
  const fetchUser = async (key) => {
    calls.push(`${key.join('/')}@${internal.getServerContext() ? 'server' : 'client'}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { name: who() };
  };
  function Name() {
    const user = data.query(['user', id], fetchUser);
    return h('b', null, () => user().name);
  }
  function Status() {
    const q = data.useQuery({ queryKey: ['user', id], queryFn: ({ queryKey }) => fetchUser(queryKey), refetchOnWindowFocus: false });
    return h('i', { id: 'status' }, () => q.status());
  }
  return function App() {
    return h('main', null, h(Suspense, { fallback: h('em', { id: 'fb' }, 'loading') }, h(Name), h(Name), h(Status)));
  };
}

// A hook on the key outside the boundary that fetches it, before and after it:
// the server renders both before the query's value is there.
function around(calls, id) {
  const { h, Suspense } = core;
  const fetchUser = async (key) => {
    calls.push(`${key.join('/')}@${internal.getServerContext() ? 'server' : 'client'}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { name: 'Lin' };
  };
  function Name() {
    const user = data.query(['user', id], fetchUser);
    return h('b', null, () => user().name);
  }
  function Status({ id: el }) {
    const q = data.useQuery({ queryKey: ['user', id], queryFn: ({ queryKey }) => fetchUser(queryKey), refetchOnWindowFocus: false });
    return h('i', { id: el }, () => q.status());
  }
  function Swr() {
    const s = data.useSWR(['user', id], (key) => fetchUser(key), { revalidateOnFocus: false });
    return h('u', null, () => (s.data() ? s.data().name : 'none'));
  }
  return function App() {
    return h('main', null, h(Status, { id: 'before' }), h(Swr), h(Suspense, { fallback: h('em', null, 'loading') }, h(Name)), h(Status, { id: 'after' }));
  };
}

describe('query() through the server and back', () => {
  it('a document carries each key once, and the hydrating client fetches nothing', async () => {
    const calls = [];
    const App = app(calls, () => 'Ada', 1);
    const html = await server.renderDocument({ default: App });
    assert.match(html, /<b[^>]*>(<!--\$-->)?Ada(<!--\/\$-->)?<\/b><b[^>]*>(<!--\$-->)?Ada/);
    assert.deepEqual(calls, ['user/1@server'], 'two readers on the server, one request');
    assert.deepEqual(payloadOf(html).resources, { 'query:user:1': { name: 'Ada' } });

    document.body.innerHTML = bodyOf(html);
    internal.__resetHydrationData();
    calls.length = 0;
    const b = document.querySelector('b');
    core.hydrate(core.h(App, {}), document.body);
    for (let i = 0; i < 4; i++) await drain();
    assert.deepEqual(calls, [], 'the client adopted the value: no request');
    assert.equal(document.querySelector('b'), b, 'and kept the server\'s DOM');
    assert.equal(document.querySelector('main').textContent.startsWith('AdaAda'), true);
    assert.equal(document.getElementById('status').textContent, 'success', 'a hook on the same key reads the adopted entry');
    assert.deepEqual(data.getQueryData(['user', 1]), { name: 'Ada' });
  });

  it('a streamed boundary carries its keys, and the client adopts them', async () => {
    const calls = [];
    const App = app(calls, () => 'Grace', 2);
    const html = await collect(server.renderToStream(core.h(App, {})));
    document.body.innerHTML = `<div id="app">${html}</div>`;
    internal.__resetHydrationData();
    core.applyStreamedBoundaries();
    calls.length = 0;
    core.hydrate(core.h(App, {}), document.getElementById('app'));
    for (let i = 0; i < 4; i++) await drain();
    assert.deepEqual(calls, []);
    assert.match(document.querySelector('main').textContent, /^GraceGrace/);
  });

  for (const via of ['renderDocument', 'renderToStream']) {
    it(`hooks on the key outside the query's boundary hydrate without a mismatch, then show the value with no request (${via})`, async () => {
      const calls = [];
      const id = via === 'renderDocument' ? 4 : 5;
      const App = around(calls, id);
      let container;
      if (via === 'renderDocument') {
        const html = await server.renderDocument({ default: App });
        document.body.innerHTML = bodyOf(html);
        container = document.body;
      } else {
        const html = await collect(server.renderToStream(core.h(App, {})));
        document.body.innerHTML = `<div id="app">${html}</div>`;
        container = document.getElementById('app');
      }
      assert.equal(document.getElementById('before').textContent, 'loading', 'the server renders a hook\'s first state');
      assert.equal(document.getElementById('after').textContent, 'loading');
      internal.__resetHydrationData();
      if (via === 'renderToStream') core.applyStreamedBoundaries();
      calls.length = 0;
      const mismatches = [];
      core.hydrate(core.h(App, {}), container, { onHydrationError: (info) => mismatches.push(info) });
      assert.deepEqual(mismatches, [], 'the walk renders the hooks as the server did');
      for (let i = 0; i < 4; i++) await drain();
      assert.deepEqual(calls, [], 'no request: the page carried the value');
      assert.equal(document.getElementById('before').textContent, 'success');
      assert.equal(document.getElementById('after').textContent, 'success');
      assert.equal(document.querySelector('u').textContent, 'Lin');
    });
  }

  it('two requests rendering at once never share a cached value', async () => {
    const calls = [];
    let current = 'first';
    const first = server.renderDocument({ default: app(calls, () => 'first', 3) });
    current = 'second';
    const second = server.renderDocument({ default: app(calls, () => current, 3) });
    const [a, b] = await Promise.all([first, second]);
    assert.match(a, /<b[^>]*>(<!--\$-->)?first</);
    assert.match(b, /<b[^>]*>(<!--\$-->)?second</);
    assert.equal(calls.length, 2, 'each request fetched its own');
  });
});
