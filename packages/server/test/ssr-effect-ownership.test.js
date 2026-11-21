// Every server render owns the effects and computeds its components create,
// and disposes them when it ends (functional review C1).
//
// A plain effect() created in a component body during SSR used to stay
// subscribed to the module-scope signal it read. A later request that wrote
// that signal re-ran it inside its own render, where getResponse() returned
// the LATER request's response: one user's cookie was written onto another
// user's response. Every render also leaked those effects (heap 40 -> 185 MB
// over 30,000 renders).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, effect, computed, signal, getResponse, useLoaderData, Suspense, createResource } from 'what-core';
import {
  createResponse,
  generateStaticPage,
  renderDocument,
  renderDocumentStream,
  renderPage,
  renderToHydratableString,
  renderToStream,
  renderToString,
  renderToStringAsync,
  renderToStringWithHead,
} from '../src/node.js';
import { collect } from './stream-helpers.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a finished render leaves no live reactive work behind', () => {
  const renderers = {
    renderToString: (vnode) => renderToString(vnode),
    renderToHydratableString: (vnode) => renderToHydratableString(vnode),
    renderToStringWithHead: (vnode) => renderToStringWithHead(vnode),
    renderToStringAsync: (vnode) => renderToStringAsync(vnode),
    renderToStream: (vnode) => collect(renderToStream(vnode)),
    renderDocument: (vnode) => renderDocument({ default: () => vnode }),
    renderDocumentStream: async (vnode) => collect(await renderDocumentStream({ default: () => vnode })),
    renderPage: (vnode) => renderPage({ default: () => vnode }),
    generateStaticPage: (vnode) => generateStaticPage({ component: () => vnode, mode: 'static' }),
  };

  for (const [name, render] of Object.entries(renderers)) {
    it(`${name}: an effect and a computed made during the render never run again`, async () => {
      const store = signal(0);
      let effectRuns = 0;
      let computedRuns = 0;
      function Widget() {
        effect(() => { store(); effectRuns++; });
        const doubled = computed(() => { computedRuns++; return store() * 2; });
        return h('p', null, () => doubled());
      }
      await render(h(Widget, {}));
      assert.equal(effectRuns, 1, 'the effect ran once, during the render');
      const computedAfterRender = computedRuns;
      store(1);
      await delay(0);
      assert.equal(effectRuns, 1, 'a write after the render re-ran an effect of a finished render');
      assert.equal(computedRuns, computedAfterRender);
    });
  }
});

describe('one request cannot write into another request\'s response', () => {
  it('a finished request\'s effect does not run in a later request (the review\'s CartBadge)', async () => {
    const cartCount = signal(0);
    function CartBadge() {
      const user = useLoaderData().user;
      effect(() => { cartCount(); getResponse().setHeader('set-cookie', `last-cart-user=${user}`); });
      return h('span', null, 'cart');
    }
    function AddToCart() { cartCount((c) => c + 1); return h('p', null, 'added'); }
    async function Slow() { await delay(5); return h('p', null, 'done'); }

    const bob = createResponse();
    await renderDocument({ default: () => h(CartBadge, {}), loader: () => ({ user: 'bob' }) }, { response: bob });
    assert.deepEqual(bob.headers.getSetCookie(), ['last-cart-user=bob'], 'the effect runs once, for its own request');

    const alice = createResponse();
    const stream = await renderDocumentStream({ default: () => h('div', null, h(AddToCart, {}), h(Slow, {})), loader: () => ({ user: 'alice' }) }, { response: alice });
    await collect(stream);
    assert.deepEqual(alice.headers.getSetCookie(), []);
  });

  it('an effect of a render still streaming does not run in the context of a render that writes its signal', async () => {
    const shared = signal(0);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const seen = [];
    function Watcher() {
      effect(() => {
        shared();
        seen.push(useLoaderData() && useLoaderData().user);
        getResponse().setHeader('x-watcher', 'bob');
      });
      return h('span', null, 'w');
    }
    function Waits() {
      const [v] = createResource(() => gate.then(() => 'ok'));
      return h('b', null, () => v());
    }
    function Writer() { shared((n) => n + 1); return h('p', null, 'wrote'); }

    const bobStream = await renderDocumentStream({
      default: () => h('main', null, h(Watcher, {}), h(Suspense, { fallback: '...' }, h(Waits, {}))),
      loader: () => ({ user: 'bob' }),
    });
    const bobBody = collect(bobStream);
    await bobStream.shellReady;

    const alice = createResponse();
    await renderDocument({ default: () => h(Writer, {}), loader: () => ({ user: 'alice' }) }, { response: alice });
    await delay(0);
    release();
    await bobBody;

    assert.equal(alice.headers.get('x-watcher'), null, 'bob\'s effect wrote onto alice\'s response');
    assert.ok(!seen.includes('alice'), `bob's effect read alice's loader data: ${JSON.stringify(seen)}`);
  });
});

describe('retention', () => {
  it('thousands of renders leave no effect subscribed to a module-scope signal', async () => {
    const store = signal(0);
    let runs = 0;
    function Leaky() {
      effect(() => { store(); runs++; });
      return h('i', null, 'x');
    }
    const RENDERS = 2000;
    for (let i = 0; i < RENDERS; i++) renderToString(h(Leaky, {}));
    for (let i = 0; i < 50; i++) await collect(renderToStream(h(Leaky, {})));
    for (let i = 0; i < 50; i++) await renderToStringAsync(h(Leaky, {}));
    const before = runs;
    store(1);
    await delay(0);
    assert.equal(runs - before, 0, `one write re-ran ${runs - before} effects from finished renders`);
  });
});
