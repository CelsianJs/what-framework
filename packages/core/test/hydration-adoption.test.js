// What hydrate() promises for markup that matches: it adopts the server's
// nodes and adds none, reads each reactive child once, reports nothing for
// text the HTML parser merged, gives back an unmount function, hydrates a
// streamed boundary when its content arrives, and mixes h() and compiled
// trees in both directions.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

installDOM();

const core = await import('../src/index.js');
const { h, hydrate, flushSync, signal, Suspense, createResource, applyStreamedBoundaries } = core;
const { __resetHydrationData } = await import('../src/hydration-data.js');
const server = await import('../../server/src/index.js');

function nodesOf(root) {
  const set = new Set();
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_ALL);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) set.add(n);
  return set;
}

function added(root, before) {
  let count = 0;
  for (const n of nodesOf(root)) if (!before.has(n)) count++;
  return count;
}

function host(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.textContent = '';
  __resetHydrationData();
});

describe('matching markup is adopted, not rebuilt', () => {
  it('text the parser merged is read across, with no report and no node added', () => {
    const name = 'Ada';
    const tree = () => h('main', null,
      h('p', null, 'Hello ', name, '!'),
      h('p', null, 'a', 'b', 'c', 1, 2),
      h('p', null, 'count: ', () => 3, ' items'),
      h('p', null, () => 'x', () => 'y'),
      h('ul', null, ['one', 'two'].map((t) => h('li', null, t, '.'))),
    );
    for (const render of [server.renderToString, server.renderToHydratableString]) {
      const el = host(render(tree()));
      const before = nodesOf(el);
      const reports = [];
      const stop = hydrate(tree(), el, { onHydrationError: (info) => reports.push(info) });
      try {
        assert.deepEqual(reports, [], render.name);
        // Markup with the protocol's markers needs nothing new; without them
        // each region makes its two markers and splits off its text.
        if (render === server.renderToHydratableString) assert.equal(added(el, before), 0);
        assert.equal(el.textContent, 'Hello Ada!abc12count: 3 itemsxyone.two.');
      } finally {
        stop();
      }
    }
  });

  it('each reactive child and list source is read once while hydrating', () => {
    let reads = 0;
    let sources = 0;
    const items = signal(['a', 'b']);
    const tree = () => h('div', null,
      h('p', null, () => { reads++; return 'x'; }),
      h('ul', null, () => { sources++; return items().map((t) => h('li', { key: t }, t)); }),
    );
    const el = host(server.renderToHydratableString(tree()));
    reads = 0;
    sources = 0;
    const stop = hydrate(tree(), el);
    try {
      assert.equal(reads, 1);
      assert.equal(sources, 1);
    } finally {
      stop();
    }
  });

  it('hydrate() returns the unmount function, and hydrating the container again disposes the first root', () => {
    const count = signal(0);
    let runs = 0;
    const tree = () => h('p', null, () => { runs++; return count(); });
    const el = host(server.renderToHydratableString(tree()));
    const first = hydrate(tree(), el);
    assert.equal(typeof first, 'function');
    const second = hydrate(tree(), el);
    runs = 0;
    count(1);
    flushSync();
    assert.equal(runs, 1, 'only the second root reacts');
    assert.equal(el.textContent, '1');
    second();
    assert.equal(el.childNodes.length, 0, 'unmounting empties the container, as mount()\'s does');
    count(2);
    flushSync();
    assert.equal(runs, 1);
    first();
  });
});

const mod = await loadCompiled(`
  import { signal } from 'what-framework';
  export const label = signal('start');
  export const items = signal([{ id: 1, t: 'one' }, { id: 2, t: 'two' }]);
  export let reads = 0;
  export function Row(props) { return <li class="row">{props.t}</li>; }
  export function App(props) {
    return <main><h1>Hi {props.name}!</h1><p>{() => { reads++; return label(); }}</p>
      <ul>{() => items().map(item => <Row key={item.id} t={item.t} />)}</ul>{props.children}</main>;
  }
  export const readCount = () => reads;
`, { pluginOptions: { hydratable: true } });
const serverMod = await loadCompiled(`
  import { signal } from 'what-framework';
  export const label = signal('start');
  export const items = signal([{ id: 1, t: 'one' }, { id: 2, t: 'two' }]);
  export function Row(props) { return <li class="row">{props.t}</li>; }
  export function App(props) {
    return <main><h1>Hi {props.name}!</h1><p>{() => label()}</p>
      <ul>{() => items().map(item => <Row key={item.id} t={item.t} />)}</ul>{props.children}</main>;
  }
`, { pluginOptions: { generate: 'ssr' } });

describe('compiled JSX built for hydration', () => {
  it('adopts every node, reads each region once, and stays live and keyed', () => {
    const el = host(server.renderToHydratableString(h(serverMod.App, { name: 'Ada' }, h('footer', null, 'h() child'))));
    const before = nodesOf(el);
    const rows = [...el.querySelectorAll('li')];
    const reports = [];
    const stop = hydrate(h(mod.App, { name: 'Ada' }, h('footer', null, 'h() child')), el, { onHydrationError: (info) => reports.push(info) });
    try {
      assert.deepEqual(reports, []);
      assert.equal(added(el, before), 0);
      assert.equal(mod.readCount(), 1);
      mod.items((list) => [...list].reverse());
      mod.label('changed');
      flushSync();
      assert.deepEqual([...el.querySelectorAll('li')], rows.reverse(), 'the rows move, they are not rebuilt');
      assert.equal(el.querySelector('p').textContent, 'changed');
    } finally {
      stop();
    }
  });

  it('an h() tree holding a compiled component adopts it too', () => {
    const el = host(server.renderToHydratableString(h('section', null, h(serverMod.Row, { t: 'x' }))));
    const li = el.querySelector('li');
    const stop = hydrate(h('section', null, h(mod.Row, { t: 'x' })), el);
    try {
      assert.equal(el.querySelector('li'), li);
    } finally {
      stop();
    }
  });
});

describe('a boundary still streaming', () => {
  it('hydrates its fallback now and its content when the content arrives', async () => {
    const gate = withResolvers();
    let fetches = 0;
    const page = (fetch) => {
      function Data() {
        const [value] = createResource(fetch);
        return h('b', { id: 'data' }, () => value());
      }
      return h('main', null, h('h1', null, 'title'), h(Suspense, { fallback: h('i', { id: 'wait' }, 'waiting') }, h(Data)));
    };
    const chunks = [];
    // The shell's data element (loader data here) is what anchors the
    // container's owner paths to the server's (hydration-data.js).
    const stream = server.renderToStream(page(() => gate.promise), { noScripts: true, loaderData: { page: 1 } });
    const reader = (async () => { for await (const chunk of stream) chunks.push(chunk); })();
    await stream.shellReady;
    while (chunks.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const el = host(chunks[0]);
    const h1 = el.querySelector('h1');
    const wait = el.querySelector('#wait');
    const stop = hydrate(page(async () => { fetches++; return 'client'; }), el);
    assert.equal(el.querySelector('#wait'), wait, 'the fallback is adopted');
    gate.resolve('server');
    await reader;
    el.insertAdjacentHTML('beforeend', chunks.slice(1).join(''));
    const arrived = el.querySelector('template:not([id^="pl-"])').content.querySelector('#data');
    assert.ok(arrived);
    applyStreamedBoundaries();
    flushSync();
    try {
      assert.equal(el.querySelector('h1'), h1);
      assert.equal(el.querySelector('#wait'), null);
      assert.equal(el.querySelector('#data').textContent, 'server');
      assert.equal(fetches, 0, 'the streamed value is adopted');
    } finally {
      stop();
    }
  });

  // A boundary whose child is lazy() hydrates whatever the order of its
  // content, its code and hydrate(): an async or classic entry script runs
  // hydrate() before the stream has sent the content. Before, the content
  // arriving after hydrate() threw in the walk's settle (its session was
  // over) and the boundary stayed dead server HTML.
  const ORDERS = [
    ['hydrate, then the content, then the code', { hydrateFirst: true, codeFirst: false }],
    ['hydrate, then the code, then the content', { hydrateFirst: true, codeFirst: true }],
    ['the content, then hydrate, then the code', { hydrateFirst: false, codeFirst: false }],
    ['the code, then the content, then hydrate', { hydrateFirst: false, codeFirst: true }],
  ];
  for (const [order, { hydrateFirst, codeFirst }] of ORDERS) {
    it(`with a lazy() child, hydrates: ${order}`, async () => {
      const seen = [];
      let clicks = 0;
      function Editor() {
        let input;
        core.onMount(() => seen.push(['mount', input.value]));
        return h('input', { id: 'draft', defaultValue: 'server', onclick: () => clicks++, ref: (el) => { input = el; } });
      }
      const page = (component) => h('main', null, h(Suspense, { fallback: h('p', { id: 'wait' }, 'loading') }, h(component)));
      let releaseServer;
      const onServer = core.lazy(() => new Promise((resolve) => { releaseServer = resolve; }));
      const code = withResolvers();
      const onClient = core.lazy(() => code.promise);
      const chunks = [];
      const stream = server.renderToStream(page(onServer), { noScripts: true });
      const reader = (async () => { for await (const chunk of stream) chunks.push(chunk); })();
      await stream.shellReady;
      while (chunks.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
      const el = host(chunks[0]);
      const errors = [];
      let stop = null;
      const start = () => { stop = hydrate(page(onClient), el, { onHydrationError: (info) => errors.push(info.kind) }); };
      const arrive = async () => {
        releaseServer({ default: Editor });
        await reader;
        el.insertAdjacentHTML('beforeend', chunks.slice(1).join(''));
        applyStreamedBoundaries();
        flushSync();
      };
      const load = async () => {
        code.resolve({ default: Editor });
        for (let i = 0; i < 5; i++) await Promise.resolve();
        flushSync();
      };
      try {
        if (codeFirst) await load();
        if (hydrateFirst) start();
        await arrive();
        if (!hydrateFirst) start();
        const input = el.querySelector('#draft');
        assert.ok(input, 'the content is shown');
        if (!codeFirst) await load();
        await core.settled();
        assert.deepEqual(errors, []);
        assert.equal(el.querySelector('#draft'), input, 'the server input is adopted');
        assert.equal(el.querySelector('#wait'), null);
        assert.deepEqual(seen, [['mount', 'server']], 'onMount ran once');
        input.click();
        assert.equal(clicks, 1, 'the handler is attached');
      } finally {
        stop?.();
      }
    });
  }
});
