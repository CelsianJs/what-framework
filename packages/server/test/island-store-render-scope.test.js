// Island stores are chosen by the render scope, not by whether a `document`
// exists (functional review C2, security review #8).
//
// Under a DOM shim (jsdom or happy-dom loaded in the server process) every
// store call took the process-global browser map, so one visitor's store was
// serialized into another visitor's page, and into every later page.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { h, Suspense, createResource } from 'what-core';
import { installDOM } from '../../../test-utils/dom.js';
import { renderDocument, renderToStream } from '../src/node.js';
import { createIslandStore, useIslandStore, getIslandStoresSnapshot } from '../src/islands.js';
import { collect } from './stream-helpers.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cleanup;
before(() => { ({ cleanup } = installDOM()); });
after(() => cleanup());

function payloadOf(html) {
  const out = {};
  for (const match of html.matchAll(/<script[^>]*(?:id="__what_data"|data-what-data)[^>]*>([^<]*)<\/script>/g)) {
    const data = JSON.parse(match[1]);
    if (data.islandStores) Object.assign(out, data.islandStores);
  }
  return out;
}

describe('island stores under a DOM shim', () => {
  it('interleaved streams each carry only their own store', async () => {
    function Cart({ user }) {
      const cart = useIslandStore('cart', { owner: null });
      cart.owner = user;
      return h('p', null, `cart for ${user}`);
    }
    async function Wait() { await delay(20); return h('span', null, 'waited'); }
    const alice = collect(renderToStream(h('div', null, h(Cart, { user: 'alice' }), h(Wait, {}))));
    await delay(5);
    const bob = collect(renderToStream(h('div', null, h(Cart, { user: 'bob' }))));
    assert.deepEqual(payloadOf(await alice), { cart: { owner: 'alice' } });
    assert.deepEqual(payloadOf(await bob), { cart: { owner: 'bob' } });
    assert.deepEqual(getIslandStoresSnapshot(), {}, 'nothing reached the process-global browser map');
    const unrelated = await renderDocument({ default: () => h('p', null, 'no stores') });
    assert.deepEqual(payloadOf(unrelated), {});
  });

  it('one document\'s store never reaches the next document (the review\'s card number)', async () => {
    function Cart({ loaderData }) {
      const cart = useIslandStore('card-cart', { owner: null, card: null });
      if (loaderData.user === 'alice') { cart.owner = 'alice'; cart.card = '4111-1111-1111-1111'; }
      return h('p', null, `hi ${loaderData.user}`);
    }
    await renderDocument({ default: Cart, loader: async () => ({ user: 'alice' }) });
    const bob = await renderDocument({ default: Cart, loader: async () => ({ user: 'bob' }) });
    assert.doesNotMatch(bob, /alice|4111/);
  });

  it('a module-scope store resolves to the current request\'s store inside each render', async () => {
    const session = createIslandStore('module-scope-session', { user: null });
    function Page({ loaderData }) {
      session.user = loaderData.user;
      return h('p', null, `user ${session.user}`);
    }
    const [a, b] = await Promise.all([
      renderDocument({ default: Page, loader: async () => { await delay(5); return { user: 'ann' }; } }),
      renderDocument({ default: Page, loader: async () => ({ user: 'ben' }) }),
    ]);
    assert.deepEqual(payloadOf(a), { 'module-scope-session': { user: 'ann' } });
    assert.deepEqual(payloadOf(b), { 'module-scope-session': { user: 'ben' } });
  });

  it('outside any render, in the page, the same handle reaches the browser store', () => {
    const first = createIslandStore('page-store', { count: 0 });
    first.count = 3;
    assert.equal(useIslandStore('page-store', { count: 99 }).count, 3);
    assert.deepEqual(getIslandStoresSnapshot()['page-store'], { count: 3 });
  });
});

describe('island store writes after the shell', () => {
  it('a streamed boundary that writes a store sends the new snapshot with its data', async () => {
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    function Total() {
      const [v] = createResource(() => gate.then(() => 42));
      const cart = useIslandStore('late-cart', { total: 0 });
      if (v() != null) cart.total = v();
      return h('b', null, () => String(cart.total));
    }
    function Shell() {
      useIslandStore('late-cart', { total: 0 });
      return h(Suspense, { fallback: '...' }, h(Total, {}));
    }
    const stream = renderToStream(h(Shell, {}), { onError: () => {} });
    const body = collect(stream);
    await stream.shellReady;
    open();
    const html = await body;
    assert.deepEqual(payloadOf(html), { 'late-cart': { total: 42 } });
  });
});
