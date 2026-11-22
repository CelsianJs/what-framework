// A server-rendered <Suspense> hydrates by adoption and is from then on the
// async model's boundary (docs/ASYNC.md), whichever server path wrote it and
// whichever client adopts it:
//
//   - an async computed list under it, rendered by renderDocument or
//     renderToStream from h() or compiled server code, is adopted by the h()
//     and the compiled client with no node created, no fetch and no frame
//     that shows the fallback;
//   - a refresh() and a transition then keep the adopted rows (the same node
//     objects) and commit in one frame;
//   - a lazy() chunk after the reveal shows the fallback and keeps the
//     children mounted; onMount and useEffect run at the reveal; a streamed
//     boundary that resumes late adopts its content and its async values.
//
// The four things adoption needs from the boundary (render.js
// hydrateSuspense) each have a test below, named after the need.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

installDOM();

const core = await import('../src/index.js');
const { h, hydrate, flushSync, signal, computed, refresh, startTransition, settled, Suspense, ErrorBoundary, lazy, onMount, applyStreamedBoundaries } = core;
const { useEffect } = await import('../src/hooks.js');
const { __resetHydrationData } = await import('../src/hydration-data.js');
const { getServerContext } = await import('../src/server-context.js');
const server = await import('../../server/src/index.js');
const { collect } = await import('../../server/test/stream-helpers.js');

const PRODUCTS = [{ id: 1, name: 'pear', price: 3 }, { id: 2, name: 'fig', price: 5 }, { id: 3, name: 'kiwi', price: 2 }];

// A catalogue API that records where each request was made, and answers after
// a timer, as a network does. `prices` overrides a price on the next answers.
function catalogue() {
  const calls = [];
  const prices = new Map();
  return {
    calls,
    prices,
    list(order, abort) {
      if (abort && abort.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      calls.push(`${order}@${getServerContext() ? 'server' : 'client'}`);
      const rows = PRODUCTS.map((p) => ({ ...p, price: prices.get(p.id) ?? p.price }));
      if (order === 'desc') rows.reverse();
      return new Promise((resolve) => setTimeout(() => resolve(rows), 2));
    },
  };
}

// The page, written with h().
function hPage(api) {
  const state = { order: signal('asc'), products: null };
  function Products() {
    const products = computed(({ signal: abort }) => api.list(state.order(), abort));
    state.products = products;
    return h('ul', { id: 'list' }, () => products().map((p) => h('li', { key: p.id }, `${p.name} ${p.price}`)));
  }
  function App() {
    return h('main', null,
      h('h2', null, () => `sorted ${state.order()}`),
      h(Suspense, { fallback: h('p', { id: 'fb' }, 'loading') }, h(Products, {})),
    );
  }
  return { App, state };
}

// The same page, compiled: once for the server target, once for hydration.
const COMPILED = `
  import { signal, computed, Suspense } from 'what-framework';
  export function page(api) {
    const state = { order: signal('asc'), products: null };
    function Products() {
      const products = computed(({ signal: abort }) => api.list(state.order(), abort));
      state.products = products;
      return <ul id="list">{products().map((p) => <li key={p.id}>{p.name + ' ' + p.price}</li>)}</ul>;
    }
    function App() {
      return <main><h2>{'sorted ' + state.order()}</h2><Suspense fallback={<p id="fb">loading</p>}><Products /></Suspense></main>;
    }
    return { App, state };
  }
`;
const compiledServer = await loadCompiled(COMPILED, { pluginOptions: { generate: 'ssr' } });
const compiledClient = await loadCompiled(COMPILED, { pluginOptions: { hydratable: true } });

const SERVERS = {
  'h() server': (api) => hPage(api),
  'compiled server': (api) => compiledServer.page(api),
};
const CLIENTS = {
  'h() client': (api) => hPage(api),
  'compiled client': (api) => compiledClient.page(api),
};

const bodyOf = (html) => html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

async function serverMarkup(path, page) {
  if (path === 'renderDocument') return bodyOf(await server.renderDocument({ default: page.App }));
  const html = await collect(server.renderToStream(h(page.App, {}), { noScripts: true, loaderData: { page: 1 } }));
  return html;
}

function nodesOf(root) {
  const set = new Set();
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_ALL);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) set.add(n);
  return set;
}

// What the page shows at every point the DOM changed: one entry per
// microtask checkpoint, as a browser could paint them.
function watchFrames(root) {
  const frames = [];
  const look = () => {
    const list = root.querySelector('#list');
    frames.push({
      fallback: root.querySelector('#fb') !== null,
      heading: root.querySelector('h2')?.textContent ?? null,
      rows: list ? [...list.querySelectorAll('li')].map((li) => li.textContent).join(',') : null,
    });
  };
  const observer = new window.MutationObserver(look);
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  return { frames, look, stop: () => observer.disconnect() };
}

// The same node objects, in order (deepEqual compares nodes by their shape).
function sameNodes(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  assert.ok(actual.every((n, i) => n === expected[i]), message);
}

const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(check(), 'timed out');
};

beforeEach(() => {
  document.body.innerHTML = '';
  __resetHydrationData();
});

describe('an async computed list under a server-rendered <Suspense>', () => {
  for (const path of ['renderDocument', 'renderToStream']) {
    for (const [serverName, makeServer] of Object.entries(SERVERS)) {
      for (const [clientName, makeClient] of Object.entries(CLIENTS)) {
        it(`${path}, ${serverName}, ${clientName}: adopted with no node, no fetch and no fallback; refresh and a transition keep the rows`, async () => {
          const serverApi = catalogue();
          const html = await serverMarkup(path, makeServer(serverApi));
          assert.deepEqual(serverApi.calls, ['asc@server']);
          const host = document.createElement('div');
          host.id = 'app';
          host.innerHTML = html;
          document.body.appendChild(host);
          if (path === 'renderToStream') applyStreamedBoundaries();
          assert.equal(host.querySelector('#fb'), null, 'precondition: the server sent the content');

          const api = catalogue();
          const page = makeClient(api);
          const before = nodesOf(host);
          const rows = [...host.querySelectorAll('li')];
          const reports = [];
          const watch = watchFrames(host);
          const stop = hydrate(h(page.App, {}), host, { onHydrationError: (info) => reports.push(info) });
          try {
            await settled();
            assert.deepEqual(reports, []);
            assert.deepEqual(api.calls, [], 'the client fetched nothing');
            let created = 0;
            for (const n of nodesOf(host)) if (!before.has(n)) created++;
            assert.equal(created, 0, 'no node was created');
            assert.ok(watch.frames.every((f) => !f.fallback), 'the fallback never showed');
            sameNodes([...host.querySelectorAll('li')], rows, 'the server\'s rows are the rows');

            // A refresh: the same items as new objects, one price changed. A
            // compiled row follows its new item in place; an h() row is a vnode
            // made again, so the one whose text changed is built again.
            api.prices.set(2, 6);
            watch.frames.length = 0;
            const done = refresh(page.state.products);
            flushSync();
            assert.equal(page.state.products.pending(), true);
            await done;
            await settled();
            const refreshed = [...host.querySelectorAll('li')];
            assert.deepEqual(refreshed.map((li) => li.textContent), ['pear 3', 'fig 6', 'kiwi 2']);
            if (clientName === 'compiled client') sameNodes(refreshed, rows, 'the refresh kept every row');
            else sameNodes([refreshed[0], refreshed[2]], [rows[0], rows[2]], 'the refresh kept the rows it did not change');
            assert.ok(watch.frames.every((f) => !f.fallback));

            // A transition that sorts: the heading and the list commit together.
            watch.frames.length = 0;
            await startTransition(() => page.state.order('desc'));
            await settled();
            sameNodes([...host.querySelectorAll('li')], [...refreshed].reverse(), 'the rows moved, they were not rebuilt');
            assert.equal(host.querySelector('h2').textContent, 'sorted desc');
            assert.ok(watch.frames.length > 0);
            for (const f of watch.frames) {
              assert.equal(f.fallback, false);
              const desc = f.rows === 'kiwi 2,fig 6,pear 3';
              assert.equal(f.heading === 'sorted desc', desc, `torn frame: ${JSON.stringify(f)}`);
            }
            assert.deepEqual(api.calls, ['asc@client', 'desc@client']);
          } finally {
            watch.stop();
            stop();
          }
        });
      }
    }
  }
});

describe('a hydrated <Suspense> behaves as a client-rendered one', () => {
  function adopt(tree, html = server.renderToHydratableString(tree())) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const stop = hydrate(tree(), host);
    flushSync();
    return { host, stop };
  }

  it('a lazy() chunk after the reveal shows the fallback and keeps the children mounted', async () => {
    const show = signal(false);
    let resolve;
    const Chunk = lazy(() => new Promise((r) => { resolve = r; }));
    const tree = () => h('div', null, h(Suspense, { fallback: h('p', { id: 'fb' }, 'loading') },
      h('input', { id: 'name' }),
      () => (show() ? h(Chunk, {}) : null),
    ));
    const { host, stop } = adopt(tree);
    try {
      const input = host.querySelector('#name');
      input.value = 'typed';
      show(true);
      flushSync();
      await until(() => host.querySelector('#fb') !== null);
      assert.equal(host.querySelector('#name'), null, 'the children are out of the document');
      resolve({ default: () => h('b', { id: 'lazy' }, 'chunk') });
      await until(() => host.querySelector('#lazy') !== null);
      assert.equal(host.querySelector('#fb'), null);
      assert.equal(host.querySelector('#name'), input, 'the same children came back');
      assert.equal(input.value, 'typed', 'with their DOM state');
    } finally {
      stop();
    }
  });

  it('runs onMount and useEffect under it once, at the reveal', async () => {
    const ran = [];
    function Child() {
      onMount(() => ran.push('mount'));
      useEffect(() => { ran.push('effect'); }, []);
      return h('p', null, 'child');
    }
    const tree = () => h('div', null, h(Suspense, { fallback: h('i', null, 'wait') }, h(Child, {})));
    const { stop } = adopt(tree);
    await settled();
    assert.deepEqual(ran.sort(), ['effect', 'mount']);
    stop();
  });

  it('runs the effects of children that waited on the client at the reveal, not before', async () => {
    const ran = [];
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    const value = computed(async () => pending);
    function Child() {
      onMount(() => ran.push('mount'));
      return h('p', { id: 'v' }, () => value());
    }
    // The server could not wait (renderToHydratableString): it sent the fallback.
    const tree = () => h('div', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'wait') }, h(Child, {})));
    const html = server.renderToHydratableString(h('div', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'wait') }, h('p', { id: 'v' }, () => { throw new Promise(() => {}); }))));
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const fallback = host.querySelector('#fb');
    const stop = hydrate(tree(), host);
    try {
      flushSync();
      assert.equal(host.querySelector('#fb'), fallback, 'the server\'s fallback is adopted while the value is pending');
      await new Promise((r) => setTimeout(r, 5));
      assert.deepEqual(ran, []);
      resolve('ready');
      await until(() => host.querySelector('#v') !== null);
      await settled();
      assert.equal(host.querySelector('#v').textContent, 'ready');
      assert.equal(host.querySelector('#fb'), null);
      assert.deepEqual(ran, ['mount']);
    } finally {
      stop();
    }
  });

  it('an <ErrorBoundary> reset() fetches again a value the server failed to get', async () => {
    // A request made with an aborted signal is not sent, as with fetch: the
    // run that learns what an adopted value reads sends nothing.
    let up = false;
    const sent = [];
    const request = (abort) => {
      if (abort.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      sent.push(getServerContext() ? 'server' : 'client');
      return up ? Promise.resolve('up') : Promise.reject(new Error('down'));
    };
    const make = () => {
      function Data() {
        const value = computed(({ signal: abort }) => request(abort));
        return h('b', { id: 'data' }, () => value());
      }
      return () => h('div', null, h(ErrorBoundary, { fallback: ({ reset }) => h('button', { id: 'retry', onclick: reset }, 'retry') },
        h(Suspense, { fallback: h('i', null, 'wait') }, h(Data, {}))));
    };
    // The server reports the failed binding and renders it empty; the error
    // travels in the hydration data.
    document.body.innerHTML = bodyOf(await server.renderDocument({ default: make() }, {}, { onError: () => {} }));
    assert.deepEqual(sent, ['server']);
    const consoleError = console.error;
    console.error = () => {};
    const stop = hydrate(h(make(), {}), document.body);
    try {
      await settled();
      const retry = document.querySelector('#retry');
      assert.ok(retry, 'the adopted error reaches the error boundary');
      assert.deepEqual(sent, ['server'], 'the failed value is adopted, not fetched again');
      up = true;
      retry.click();
      await until(() => document.querySelector('#data') !== null);
      await settled();
      assert.equal(document.querySelector('#data').textContent, 'up');
      assert.deepEqual(sent, ['server', 'client']);
    } finally {
      console.error = consoleError;
      stop();
    }
  });
});

describe('what adoption needs from the boundary', () => {
  it('need 1: its state is read once, untracked, right after the children\'s first run', () => {
    const tree = () => h('div', null, h(Suspense, { fallback: h('i', null, 'wait') }, h('p', { id: 'c' }, 'content')));
    const host = document.createElement('div');
    host.innerHTML = server.renderToHydratableString(tree());
    document.body.appendChild(host);
    const content = host.querySelector('#c');
    let outerRuns = 0;
    let stop;
    const tick = signal(0);
    // hydrate() reached from inside another effect: the boundary's state must
    // not become that effect's dependency.
    core.effect(() => {
      tick();
      outerRuns++;
      if (stop === undefined) stop = hydrate(tree(), host);
    });
    flushSync();
    assert.equal(host.querySelector('#c'), content);
    tick(1);
    flushSync();
    assert.equal(outerRuns, 2, 'only its own signal re-ran the outer effect');
    assert.equal(host.querySelector('#c'), content);
    stop();
  });

  it('need 2: its handler is on the owner before the children run, so a suspension inside reaches it and not the boundary around it', async () => {
    let resolve;
    const Chunk = lazy(() => new Promise((r) => { resolve = r; }));
    const show = signal(false);
    const tree = () => h('div', null, h(Suspense, { fallback: h('i', { id: 'outer-fb' }, 'outer') },
      h('p', { id: 'outer' }, 'outer content'),
      h(Suspense, { fallback: h('i', { id: 'inner-fb' }, 'inner') }, () => (show() ? h(Chunk, {}) : h('p', { id: 'inner' }, 'inner content'))),
    ));
    const host = document.createElement('div');
    host.innerHTML = server.renderToHydratableString(tree());
    document.body.appendChild(host);
    const outer = host.querySelector('#outer');
    const stop = hydrate(tree(), host);
    try {
      show(true);
      flushSync();
      await until(() => host.querySelector('#inner-fb') !== null);
      assert.equal(host.querySelector('#outer-fb'), null, 'the outer boundary did not take it');
      assert.equal(host.querySelector('#outer'), outer);
      resolve({ default: () => h('b', { id: 'lazy' }, 'chunk') });
      await until(() => host.querySelector('#lazy') !== null);
    } finally {
      stop();
    }
  });

  it('need 3: the fallback\'s components are numbered after the children the server tried first', () => {
    function Spinner() { return h('i', { id: 'spin' }, 'loading'); }
    function Late() { throw new Promise(() => {}); }
    function Card() { return h('p', null, 'card'); }
    const serverTree = h('main', null, h(Suspense, { fallback: h(Spinner, {}) }, h(Card, {}), h(Late, {})), h(Card, {}));
    const html = server.renderToHydratableString(serverTree);
    assert.match(html, /<!--b!-->/, 'precondition: the server rendered the fallback');
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const spinner = host.querySelector('#spin');
    const reports = [];
    let resolve;
    const Pending = lazy(() => new Promise((r) => { resolve = r; }));
    const stop = hydrate(h('main', null, h(Suspense, { fallback: h(Spinner, {}) }, h(Card, {}), h(Pending, {})), h(Card, {})), host,
      { onHydrationError: (info) => reports.push(info) });
    try {
      assert.equal(host.querySelector('#spin'), spinner, 'the server\'s fallback is adopted');
      assert.deepEqual(reports, [], 'no key mismatch for the fallback or the component after the boundary');
    } finally {
      stop();
      resolve({ default: Card });
    }
  });

  it('need 4: it keeps the arm the walk adopted until the walk is over', async () => {
    let resolve;
    const Chunk = lazy(() => new Promise((r) => { resolve = r; }));
    const serverTree = h('div', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'wait') }, h('p', null, 'before'), h('b', { id: 'chunk' }, 'chunk')), h('footer', { id: 'f' }, 'end'));
    const host = document.createElement('div');
    host.innerHTML = server.renderToHydratableString(serverTree);
    document.body.appendChild(host);
    const footer = host.querySelector('#f');
    const chunk = host.querySelector('#chunk');
    const reports = [];
    // The client's chunk has not loaded: the component suspends in the walk.
    const stop = hydrate(h('div', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'wait') }, h('p', null, 'before'), h(Chunk, {})), h('footer', { id: 'f' }, 'end')), host,
      { onHydrationError: (info) => reports.push(info) });
    try {
      flushSync();
      assert.equal(host.querySelector('#f'), footer, 'the walk after the boundary claimed the server\'s footer');
      assert.deepEqual(reports, [], 'a walk that a suspension drops reports nothing');
      assert.equal(host.querySelector('#fb'), null, 'the fallback does not stand in for the server\'s content');
      assert.equal(host.querySelector('#chunk'), chunk, 'the server\'s content stays up while the chunk loads');
      resolve({ default: () => h('b', { id: 'chunk' }, 'chunk') });
      await until(() => host.querySelector('#chunk') !== null && host.querySelector('#fb') === null);
      assert.equal(host.querySelectorAll('footer').length, 1);
    } finally {
      stop();
    }
  });
});

describe('a streamed boundary that resumes late', () => {
  it('adopts its content and the async values it reads, with no fetch, and is then a live boundary', async () => {
    const gate = withResolvers();
    const make = (api, ran) => {
      function Products() {
        const products = computed(({ signal: abort }) => api(abort));
        onMount(() => ran.push('mount'));
        return h('ul', { id: 'list' }, () => products().map((p) => h('li', { key: p.id }, p.name)));
      }
      return h('main', null, h('h1', null, 'shop'), h(Suspense, { fallback: h('i', { id: 'fb' }, 'loading') }, h(Products, {})));
    };
    const serverCalls = [];
    const stream = server.renderToStream(make(async () => { serverCalls.push('server'); await gate.promise; return PRODUCTS; }, []), { noScripts: true, loaderData: { page: 1 } });
    const chunks = [];
    const reader = (async () => { for await (const chunk of stream) chunks.push(chunk); })();
    await stream.shellReady;
    while (chunks.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const host = document.createElement('div');
    host.innerHTML = chunks[0];
    document.body.appendChild(host);
    const fallback = host.querySelector('#fb');
    const clientCalls = [];
    const ran = [];
    // A request made with an aborted signal is not sent, as with fetch.
    const clientApi = (abort) => {
      if (abort.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      clientCalls.push('client');
      return Promise.resolve(PRODUCTS);
    };
    const stop = hydrate(make(clientApi, ran), host);
    try {
      assert.equal(host.querySelector('#fb'), fallback, 'the fallback is adopted while the content streams');
      assert.deepEqual(ran, []);
      gate.resolve();
      await reader;
      host.insertAdjacentHTML('beforeend', chunks.slice(1).join(''));
      const arrived = [...host.querySelector('template:not([id^="pl-"])').content.querySelectorAll('li')];
      assert.equal(arrived.length, 3);
      applyStreamedBoundaries();
      await settled();
      const rows = [...host.querySelectorAll('li')];
      assert.deepEqual(rows.map((li) => li.textContent), ['pear', 'fig', 'kiwi']);
      assert.deepEqual(clientCalls, [], 'the streamed values are adopted');
      assert.equal(host.querySelector('#fb'), null);
      assert.deepEqual(ran, ['mount'], 'onMount ran at the reveal');
      assert.deepEqual(serverCalls, ['server']);
    } finally {
      stop();
    }
  });
});
