// One hydration data channel: the client adopts what the server rendered with
// instead of fetching it again (R4).
//
// A keyless createResource() was serialized under a render-order counter key
// (`__r0`) that the client never looked up, so every keyless resource was
// fetched twice per page view: once on the server, once on hydrate. Streamed
// pages carried no data at all. Keyless resources are now named by their
// component's owner path, the server sends them with keyed ones, rejected
// resources travel as error records, and the client reads every data element
// on the page, buffered or streamed.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let core;
let server;
let collect;

before(async () => {
  ({ cleanup } = installDOM());
  core = { ...await import('what-core'), ...await import('what-core/internal') };
  server = await import('../src/index.js');
  ({ collect } = await import('./stream-helpers.js'));
});
after(() => cleanup());

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

// The failed-resource assertions read the server error's message, which a page
// carries only in development.
process.env.NODE_ENV = 'development';

function makeApp(calls, { failKeyless = false } = {}) {
  const { h, Suspense, createResource } = core;
  const fetchKeyed = () => { calls.keyed++; return tick().then(() => 'K'); };
  const fetchA = () => { calls.keyless++; return tick(8).then(() => 'A'); };
  const fetchB = () => {
    calls.keyless++;
    return tick(2).then(() => (failKeyless ? Promise.reject(Object.assign(new Error('db down'), { code: 'E_DB' })) : 'B'));
  };
  function Inner() {
    const [b, { error }] = createResource(fetchB);
    return h('em', { id: 'b' }, () => (error() ? `error:${error().message}` : b()));
  }
  function Page() {
    const [k] = createResource(fetchKeyed, { key: 'k' });
    const [a] = createResource(fetchA);
    return h('div', { id: 'root' },
      h('span', { id: 'k' }, () => k()),
      h('span', { id: 'a' }, () => a()),
      h(Suspense, { fallback: h('i', null, '...') }, h(Inner, {})));
  }
  return () => h(Suspense, { fallback: h('p', null, 'loading') }, h(Page, {}));
}

// innerHTML does not run the stream's inline swap scripts, so the boundaries
// are settled the way a page whose scripts did not run settles them, before
// hydrating (what a browser has done by the time a module script runs).
function hydrateInto(html, App) {
  document.body.innerHTML = `<div id="app">${html}</div>`;
  core.__resetHydrationData();
  core.applyStreamedBoundaries();
  core.hydrate(core.h(App, {}), document.getElementById('app'));
}

function bodyOf(documentHtml) {
  return documentHtml.slice(documentHtml.indexOf('<body>') + 6, documentHtml.indexOf('</body>'));
}

describe('a server-rendered page hydrates without fetching again', () => {
  it('renderDocument: keyed and keyless resources are adopted (R4)', async () => {
    const calls = { keyed: 0, keyless: 0 };
    const App = makeApp(calls);
    const html = await server.renderDocument({ default: App });
    assert.deepEqual(calls, { keyed: 1, keyless: 2 });

    const payload = JSON.parse(html.match(/<script id="__what_data" type="application\/json">(.*?)<\/script>/)[1]);
    assert.deepEqual(payload.resources, { k: 'K' });
    assert.deepEqual(Object.values(payload.owned).sort(), ['A', 'B']);

    hydrateInto(bodyOf(html), App);
    await tick(20);
    assert.deepEqual(calls, { keyed: 1, keyless: 2 }, 'the client fetched again');
    assert.equal(document.getElementById('a').textContent, 'A');
    assert.equal(document.getElementById('b').textContent, 'B');
    assert.equal(document.getElementById('k').textContent, 'K');
  });

  it('renderToStream: the streamed page carries the data too', async () => {
    const calls = { keyed: 0, keyless: 0 };
    const App = makeApp(calls);
    const html = await collect(server.renderToStream(core.h(App, {})));
    assert.match(html, /<script type="application\/json" data-what-data>/);

    hydrateInto(html, App);
    await tick(20);
    assert.deepEqual(calls, { keyed: 1, keyless: 2 });
    assert.equal(document.getElementById('a').textContent, 'A');
    assert.equal(document.getElementById('b').textContent, 'B');
  });

  it('a resource that failed on the server is adopted as failed, not fetched again', async () => {
    const calls = { keyed: 0, keyless: 0 };
    const App = makeApp(calls, { failKeyless: true });
    const html = await server.renderDocument({ default: App });
    const payload = JSON.parse(html.match(/<script id="__what_data" type="application\/json">(.*?)<\/script>/)[1]);
    // E_DB is the app's code, not a framework ERR_* code, so it stays on the server.
    assert.deepEqual(Object.values(payload.ownedErrors), [{ message: 'db down' }]);

    hydrateInto(bodyOf(html), App);
    await tick(20);
    assert.deepEqual(calls, { keyed: 1, keyless: 2 });
    assert.equal(document.getElementById('b').textContent, 'error:db down');
  });

  it('an island does not take a value meant for another part of the page', async () => {
    const { h, createResource, Island, Suspense } = core;
    let islandFetches = 0;
    function Static() {
      const [v] = createResource(() => Promise.resolve('PAGE VALUE'));
      return h('p', null, () => v());
    }
    function Widget() {
      const [v] = createResource(() => { islandFetches++; return Promise.resolve('WIDGET VALUE'); });
      return h('span', { id: 'widget' }, () => v());
    }
    const Page = () => h(Suspense, { fallback: '...' }, h('main', null, h(Static, {}), h(Island, { component: Widget, mode: 'load' })));
    const html = await server.renderDocument({ default: Page });
    assert.match(html, /data-island/);
    const fetchesOnServer = islandFetches;
    document.body.innerHTML = bodyOf(html);
    core.__resetHydrationData();
    const islandRoot = document.querySelector('[data-island]');
    core.hydrate(h(Widget, {}), islandRoot);
    await tick(10);
    assert.equal(islandFetches, fetchesOnServer + 1, 'the island refetches instead of adopting by position');
    assert.equal(document.getElementById('widget').textContent, 'WIDGET VALUE');
  });

  it('a later client render (not a hydration) fetches normally', async () => {
    const calls = { keyed: 0, keyless: 0 };
    const App = makeApp(calls);
    const html = await server.renderDocument({ default: App });
    hydrateInto(bodyOf(html), App);
    document.body.innerHTML = '<div id="again"></div>';
    core.mount(core.h(App, {}), '#again');
    await tick(30);
    assert.equal(calls.keyless, 4, 'mount after hydration must not adopt stale server values');
  });
});

describe('owner keys', () => {
  it('do not depend on which resource resolved first, and match across renderers', async () => {
    const { h, Suspense, createResource } = core;
    const make = (delays) => function Page() {
      const Item = ({ ms, label }) => {
        const [v] = createResource(() => tick(ms).then(() => label));
        return h('li', null, () => v());
      };
      return h('ul', null, h(Suspense, { fallback: 'x' }, delays.map((ms, i) => h(Item, { ms, label: `v${i}` }))));
    };
    const a = await server.renderToStringAsync(h(make([12, 1, 6]), {}));
    const b = await server.renderToStringAsync(h(make([1, 12, 6]), {}));
    assert.deepEqual(Object.keys(a.owned), Object.keys(b.owned));
    assert.deepEqual(a.owned, b.owned);

    const streamed = await collect(server.renderToStream(h(make([6, 1, 12]), {})));
    const data = JSON.parse(streamed.match(/data-what-data>(.*?)<\/script>/)[1]);
    assert.deepEqual(data.owned, a.owned);
  });
});

describe('the data channel stays script-safe', () => {
  it('escapes markup in resource values on both paths', async () => {
    const { h, Suspense, createResource } = core;
    const evil = '</script><script>alert(1)</script><!--';
    function Page() {
      const [v] = createResource(() => Promise.resolve(evil));
      const [w] = createResource(() => Promise.resolve(evil), { key: 'w' });
      return h('p', null, () => v(), () => w());
    }
    const App = () => h(Suspense, { fallback: 'x' }, h(Page, {}));
    for (const html of [await server.renderDocument({ default: App }), await collect(server.renderToStream(h(App, {})))]) {
      const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g);
      for (const script of scripts) {
        const inner = script.replace(/^<script\b[^>]*>/, '').replace(/<\/script>$/, '');
        assert.ok(!/<\/script|<script|<!--/i.test(inner), `unescaped markup in ${script}`);
      }
    }
  });

  it('sends a generic message, and no library code, for a failed resource in production', () => {
    const contextModule = fileURLToPath(new URL('../src/context.js', import.meta.url));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { errorRecord } = await import(${JSON.stringify(contextModule)});
      console.log(JSON.stringify([
        errorRecord(Object.assign(new Error('password=hunter2'), { code: '28P01' })),
        errorRecord(Object.assign(new Error('timed out'), { code: 'ERR_SSR_SUSPENSE_TIMEOUT' })),
      ]));
    `], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const [library, framework] = JSON.parse(result.stdout);
    assert.equal(library.code, undefined, 'a database code describes the server as surely as its message');
    assert.ok(!library.message.includes('hunter2'), library.message);
    assert.equal(framework.code, 'ERR_SSR_SUSPENSE_TIMEOUT');
    assert.ok(!framework.message.includes('timed out'), framework.message);
  });
});
