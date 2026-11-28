// The render hot path does no AsyncLocalStorage lookups.
//
// getServerContext() used to ask the async context provider first, so with
// what-server's Node entry loaded every useLoaderData(), createResource() and
// <Head> paid an AsyncLocalStorage.getStore(), and the string renderer called
// it once per node. A renderer now sets the context for each synchronous slice
// and the provider is consulted only by code that resumes after an `await`.
//
// This file installs a counting provider before anything renders; node:test
// runs each file in its own process, so it is the only one installed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { h, useLoaderData, createResource, Suspense } from 'what-core';
import { __installServerContextStorage, getServerContext } from 'what-core/internal';

const als = new AsyncLocalStorage();
let lookups = 0;
__installServerContextStorage({
  getStore() { lookups++; return als.getStore(); },
  run: (store, fn) => als.run(store, fn),
});

const { renderToString, renderDocument, renderToStream } = await import('../src/index.js');
const { content, settle } = await import('./stream-helpers.js');

function Leaf() {
  const data = useLoaderData();
  return h('li', null, data ? data.label : 'none');
}

describe('render context lookups', () => {
  it('a synchronous render never asks the async provider', async () => {
    lookups = 0;
    const html = await renderDocument({
      default: () => h('ul', null, Array.from({ length: 200 }, (_, i) => h(Leaf, { key: i }))),
      loader: () => ({ label: 'row' }),
    });
    assert.equal((content(html).match(/<li>row<\/li>/g) || []).length, 200);
    assert.equal(lookups, 0);
  });

  it('a bare renderToString asks once, to find out whether a render is already active', () => {
    lookups = 0;
    renderToString(h('ul', null, Array.from({ length: 200 }, (_, i) => h(Leaf, { key: i }))));
    assert.equal(lookups, 1);
  });

  it('a stream asks the provider only after an await', async () => {
    lookups = 0;
    async function Late() {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return h('p', null, useLoaderData().label);
    }
    function Data() {
      const [value] = createResource(() => Promise.resolve('ready'), { key: 'v' });
      return h('b', null, () => value());
    }
    let html = '';
    for await (const chunk of renderToStream(
      h('div', null, h(Leaf, {}), h(Suspense, { fallback: 'x' }, h(Data, {})), h(Late, {})),
      { loaderData: { label: 'L' } },
    )) html += chunk;
    assert.equal(content(settle(html)), '<div><li>L</li><b>ready</b><p>L</p></div>');
    assert.equal(lookups, 1, 'only the useLoaderData() after the await');
  });

  it('outside a render there is no context', () => {
    assert.equal(getServerContext(), null);
  });
});
