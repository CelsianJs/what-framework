// What a hydrated component is, and what belongs to it.
//
// A component finds its server data by its owner path. The path comes from
// the server's key where its output starts (data-hk), so a component whose
// position differs from the server's (a branch only one side rendered, the
// children a boundary tried before its fallback, a built-in one side lowered
// away) still finds its own values and never a neighbour's. Each hydrate()
// call counts from its container's anchor. A late boundary walks under the
// hook and counter of the call it belongs to. Event handlers belong to their
// owner; children a component renders elsewhere are built there.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const core = await import('../src/index.js');
const { h, hydrate, mount, flushSync, signal, createResource, ErrorBoundary, Suspense, Show, lazy, onCleanup, applyStreamedBoundaries } = core;
const { __resetHydrationData } = await import('../src/hydration-data.js');
const server = await import('../../server/src/index.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const bodyOf = (html) => html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

// A component that fetches its label: `fetches` records the client's
// requests, so an adopted value is one with no request.
function dataComponent(side, fetches) {
  return function Data({ id }) {
    const [value] = createResource(() => {
      if (side === 'client') fetches.push(id);
      return Promise.resolve(`${side} ${id}`);
    });
    return h('b', { id }, () => value() ?? 'pending');
  };
}

async function roundTrip(page) {
  const html = await server.renderDocument({ default: page('server', []) }, {}, { onError: () => {} });
  document.body.innerHTML = bodyOf(html);
  __resetHydrationData();
  const fetches = [];
  const reports = [];
  const stop = hydrate(h(page('client', fetches)), document.body, { onHydrationError: (r) => reports.push(r) });
  await tick();
  flushSync();
  return { fetches, reports, stop, text: document.querySelector('main').textContent };
}

beforeEach(() => {
  document.body.innerHTML = '';
  __resetHydrationData();
});

describe('a component finds its own server data wherever the trees diverged before it', () => {
  it('after a branch only the server rendered', async () => {
    const page = (side, fetches) => {
      const Data = dataComponent(side, fetches);
      return function Page() {
        return h('main', null, () => (side === 'server' ? h(Data, { id: 'A' }) : null), h(Data, { id: 'B' }));
      };
    };
    const { fetches, text, stop } = await roundTrip(page);
    assert.deepEqual(fetches, []);
    assert.equal(text, 'server B');
    stop();
  });

  it('after a branch only the client renders: that component fetches, the next adopts', async () => {
    const page = (side, fetches) => {
      const Data = dataComponent(side, fetches);
      return function Page() {
        return h('main', null, () => (side === 'client' ? h(Data, { id: 'A' }) : null), h(Data, { id: 'B' }));
      };
    };
    const { fetches, text, stop } = await roundTrip(page);
    assert.deepEqual(fetches, ['A'], 'A has no server value; it does not take B\'s');
    assert.equal(text, 'client Aserver B');
    stop();
  });

  it('an <ErrorBoundary> fallback the server rendered adopts its own value, not a discarded child\'s', async () => {
    const page = (side, fetches) => {
      const Data = dataComponent(side, fetches);
      function Fail() { throw new Error('oops'); }
      return function Page() {
        return h('main', null, h(ErrorBoundary, { fallback: () => h(Data, { id: 'fallback' }) }, h(Data, { id: 'discarded' }), h(Fail)), h(Data, { id: 'tail' }));
      };
    };
    const { fetches, text, reports, stop } = await roundTrip(page);
    assert.deepEqual(fetches, ['discarded'], 'only the children the client tries again fetch');
    assert.equal(text, 'server fallbackserver tail');
    assert.deepEqual(reports, []);
    stop();
  });

  it('a second hydrate() of the same container counts from its anchor again', async () => {
    const page = (side, fetches) => {
      const Data = dataComponent(side, fetches);
      return function Page() { return h('main', null, h(Data, { id: 'same' })); };
    };
    const html = await server.renderDocument({ default: page('server', []) }, {}, {});
    document.body.innerHTML = bodyOf(html);
    __resetHydrationData();
    const fetches = [];
    hydrate(h(page('client', fetches)), document.body);
    const stop = hydrate(h(page('client', fetches)), document.body);
    await tick();
    flushSync();
    assert.deepEqual(fetches, []);
    assert.equal(document.querySelector('main').textContent, 'server same');
    stop();
  });
});

const compiledShow = await loadCompiled(`
  import { createResource, Show } from 'what-framework';
  export function make(side, fetches) {
    function Data({ id }) {
      const [value] = createResource(() => { if (side === 'client') fetches.push(id); return Promise.resolve(side + ' ' + id); });
      return <b id={id}>{() => value() ?? 'pending'}</b>;
    }
    return function Page() { return <main><Show when={true}><Data id="inside" /></Show><Data id="tail" /></main>; };
  }
`, { pluginOptions: { hydratable: true } });
const compiledShowServer = await loadCompiled(`
  import { createResource, Show } from 'what-framework';
  export function make(side) {
    function Data({ id }) {
      const [value] = createResource(() => Promise.resolve(side + ' ' + id));
      return <b id={id}>{() => value() ?? 'pending'}</b>;
    }
    return function Page() { return <main><Show when={true}><Data id="inside" /></Show><Data id="tail" /></main>; };
  }
`, { pluginOptions: { generate: 'ssr' } });

function runtimeShow(side, fetches) {
  const Data = dataComponent(side, fetches);
  return function Page() { return h('main', null, h(Show, { when: true }, h(Data, { id: 'inside' })), h(Data, { id: 'tail' })); };
}

describe('a built-in the compiler lowers away has the same owner paths both ways', () => {
  for (const [label, serverPage, clientPage] of [
    ['compiled server, runtime <Show> on the client', compiledShowServer.make, runtimeShow],
    ['runtime <Show> on the server, compiled client', runtimeShow, compiledShow.make],
  ]) {
    it(label, async () => {
      const html = await server.renderDocument({ default: serverPage('server', []) }, {}, {});
      document.body.innerHTML = bodyOf(html);
      __resetHydrationData();
      const fetches = [];
      const reports = [];
      const stop = hydrate(h(clientPage('client', fetches)), document.body, { onHydrationError: (r) => reports.push(r.kind) });
      await tick();
      flushSync();
      assert.deepEqual(fetches, []);
      assert.deepEqual(reports, []);
      assert.equal(document.querySelector('main').textContent, 'server insideserver tail');
      stop();
    });
  }
});

describe('a streamed boundary', () => {
  it('a pending <Suspense> fallback adopts its own server value', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fallbackFetches = [];
    function app(fetch, side) {
      function Data() { const [value] = createResource(fetch, { key: 'content' }); return h('b', null, () => value() ?? 'pending'); }
      function Fallback() {
        const [value] = createResource(() => { if (side === 'client') fallbackFetches.push('fallback'); return Promise.resolve(`fallback from ${side}`); });
        return h('i', null, () => value() ?? 'pending');
      }
      return function Page() { return h('main', null, h(Suspense, { fallback: h(Fallback) }, h(Data))); };
    }
    const stream = server.renderToStream(h(app(() => gate, 'server')), { noScripts: true })[Symbol.asyncIterator]();
    document.body.innerHTML = Buffer.from((await stream.next()).value).toString();
    __resetHydrationData();
    const reports = [];
    const stop = hydrate(h(app(() => { throw new Error('the client adopts the keyed value'); }, 'client')), document.body, { onHydrationError: (r) => reports.push(r.kind) });
    await tick();
    flushSync();
    assert.deepEqual(fallbackFetches, []);
    assert.equal(document.querySelector('i').textContent, 'fallback from server');
    // The late content's mismatch goes to the same hook.
    release('server content');
    const chunk = Buffer.from((await stream.next()).value).toString().replace('<!--$-->server content', '<!--$-->stale markup');
    document.body.insertAdjacentHTML('beforeend', chunk);
    assert.equal(applyStreamedBoundaries(), 1);
    assert.equal(document.querySelector('b').textContent, 'server content');
    assert.deepEqual(reports, ['text']);
    stop();
  });
});

describe('a component that suspends while it hydrates server content', () => {
  it('keeps the server\'s content up until it lands, then adopts it', async () => {
    let resolve;
    const Chunk = lazy(() => new Promise((r) => { resolve = r; }));
    function Panel() {
      const n = signal(0);
      return h('button', { id: 'panel', onclick: () => n(n() + 1) }, () => `clicked ${n()}`);
    }
    const tree = (Inner) => h('main', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'wait') }, h('p', null, 'before'), h(Inner)));
    document.body.innerHTML = server.renderToHydratableString(tree(Panel));
    const button = document.querySelector('#panel');
    const frames = [];
    const observer = new window.MutationObserver(() => frames.push(document.querySelector('#fb') !== null));
    observer.observe(document.body, { childList: true, subtree: true });
    const stop = hydrate(tree(Chunk), document.body);
    flushSync();
    assert.equal(document.querySelector('#panel'), button);
    resolve({ default: Panel });
    for (let i = 0; i < 50 && document.querySelector('#panel').textContent !== 'clicked 0'; i++) await tick();
    await tick();
    flushSync();
    observer.disconnect();
    assert.equal(document.querySelector('#panel'), button, 'the server\'s button is the component\'s');
    assert.ok(!frames.includes(true), 'the fallback never showed');
    button.click();
    flushSync();
    assert.equal(button.textContent, 'clicked 1');
    stop();
  });
});

const compiledPortal = await loadCompiled(`
  import { Portal } from 'what-framework';
  function Port() { return <b>PORT</b>; }
  export function Page() { return <main><Portal target="#portal"><Port /></Portal><em>TAIL</em></main>; }
`, { pluginOptions: { hydratable: true } });
const compiledPortalServer = await loadCompiled(`
  import { Portal } from 'what-framework';
  function Port() { return <b>PORT</b>; }
  export function Page() { return <main><Portal target="#portal"><Port /></Portal><em>TAIL</em></main>; }
`, { pluginOptions: { generate: 'ssr' } });

const islandSource = (target) => loadCompiled(`
  import { createResource } from 'what-framework';
  export function make(fetch) {
    function Panel({ children }) { const [read] = createResource(fetch); return <section><b>{() => read() ?? 'pending'}</b>{children}</section>; }
    return function Page() { return <main><Panel client:load><u>slot</u></Panel><footer>tail</footer></main>; };
  }
`, { pluginOptions: target });
const islandClient = await islandSource({ hydratable: true });
const islandServer = await islandSource({ generate: 'ssr' });

describe('children a component renders elsewhere are built there', () => {
  it('a compiled portal\'s children do not claim the nodes where the portal stands', () => {
    document.body.innerHTML = `<aside id="portal"></aside><div id="app">${server.renderToHydratableString(h(compiledPortalServer.Page))}</div>`;
    const app = document.querySelector('#app');
    const tail = app.querySelector('em');
    const reports = [];
    const stop = hydrate(h(compiledPortal.Page), app, { onHydrationError: (r) => reports.push(r.kind) });
    assert.deepEqual(reports, []);
    assert.equal(app.querySelector('em'), tail);
    assert.equal(document.querySelector('#portal').textContent, 'PORT');
    stop();
  });

  it('a compiled island\'s slot hydrates inside the island, with its server data', async () => {
    const html = await server.renderDocument({ default: islandServer.make(() => Promise.resolve('server value')) }, {}, {});
    document.body.innerHTML = bodyOf(html);
    __resetHydrationData();
    const section = document.querySelector('section');
    const slot = document.querySelector('u');
    let fetches = 0;
    const reports = [];
    const stop = hydrate(h(islandClient.make(() => { fetches++; return Promise.resolve('client value'); })), document.body, { onHydrationError: (r) => reports.push(r.kind) });
    for (let i = 0; i < 20 && !document.querySelector('[data-island-hydrated]'); i++) await tick();
    flushSync();
    assert.equal(document.querySelector('section'), section);
    assert.equal(document.querySelector('u'), slot);
    assert.equal(fetches, 0);
    assert.equal(document.querySelector('section').textContent, 'server valueslot');
    assert.deepEqual(reports, []);
    stop();
  });
});

const compiledButton = await loadCompiled(`
  import { onCleanup } from 'what-framework';
  export function make(counter) { return function Page() { onCleanup(() => counter.clean++); return <button onClick={() => counter.click++} onFocus={() => counter.focus++}>go</button>; }; }
  export function Blank() { return <button>go</button>; }
`, { pluginOptions: { hydratable: true } });

function hButton(counter) {
  return function Page() {
    onCleanup(() => counter.clean++);
    return h('button', { onClick: () => counter.click++, onFocus: () => counter.focus++ }, 'go');
  };
}

describe('an event handler belongs to its owner', () => {
  for (const [label, make, blank] of [['h()', hButton, () => h('button', null, 'go')], ['compiled', compiledButton.make, () => h(compiledButton.Blank)]]) {
    it(`${label}: a handler of a replaced hydrate() root never runs again`, () => {
      const host = document.body.appendChild(document.createElement('div'));
      host.innerHTML = '<button>go</button>';
      const counter = { click: 0, clean: 0, focus: 0 };
      hydrate(h(make(counter)), host);
      const button = host.firstChild;
      button.click();
      const stop = hydrate(blank(), host);
      assert.equal(host.firstChild, button, 'the second hydrate() claimed the same button');
      button.click();
      button.dispatchEvent(new window.FocusEvent('focus'));
      assert.deepEqual(counter, { click: 1, clean: 1, focus: 0 });
      stop();
    });

    it(`${label}: after unmount, a kept element inserted again calls nothing`, () => {
      for (const start of [mount, hydrate]) {
        const host = document.body.appendChild(document.createElement('div'));
        host.innerHTML = '<button>go</button>';
        const counter = { click: 0, clean: 0, focus: 0 };
        const stop = start(h(make(counter)), host);
        const button = host.querySelector('button');
        stop();
        document.body.appendChild(button);
        button.click();
        button.dispatchEvent(new window.FocusEvent('focus'));
        assert.deepEqual(counter, { click: 0, clean: 1, focus: 0 }, start.name);
        button.remove();
        host.remove();
      }
    });
  }
});

describe('one report per region', () => {
  const compiledPair = loadCompiled('export function Page({ left, right }) { return <p>{left} / {right}</p>; }', { pluginOptions: { hydratable: true } });
  it('two mismatching regions in one parent report twice, on both clients', async () => {
    const { Page } = await compiledPair;
    for (const tree of [(l, r) => h('p', null, l, ' / ', r), (l, r) => h(Page, { left: l, right: r })]) {
      const host = document.body.appendChild(document.createElement('div'));
      host.innerHTML = '<p><!--$-->wrong-left<!--/$--> / <!--$-->wrong-right<!--/$--></p>';
      const reports = [];
      const stop = hydrate(tree(() => 'left', () => 'right'), host, { onHydrationError: (r) => reports.push(r.expected) });
      assert.deepEqual(reports, ['"left"', '"right"']);
      assert.equal(host.textContent, 'left / right');
      stop();
    }
  });
});
