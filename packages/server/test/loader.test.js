// Server data loaders (Phase 2). A page module's `export const loader` runs
// before SSR; its result is passed as a `loaderData` prop AND readable via
// useLoaderData() from any descendant. Params flow into the loader + component.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, useLoaderData } from 'what-core';
import { renderPage } from '../src/index.js';

describe('renderPage / loaders', () => {
  it('runs a sync loader and passes loaderData as a prop', async () => {
    const mod = {
      loader: () => ({ n: 1 }),
      default: ({ loaderData }) => h('p', {}, `n=${loaderData.n}`),
    };
    const { body, loaderData } = await renderPage(mod, { params: {}, query: {} });
    assert.deepEqual(loaderData, { n: 1 });
    assert.match(body, /<p>n=1<\/p>/);
  });

  it('awaits an async loader before rendering', async () => {
    const mod = {
      loader: async () => ({ n: 2 }),
      default: ({ loaderData }) => h('p', {}, `n=${loaderData.n}`),
    };
    const { body } = await renderPage(mod, {});
    assert.match(body, /n=2/);
  });

  it('exposes loader data to nested children via useLoaderData()', async () => {
    function Child() {
      const d = useLoaderData();
      return h('span', {}, `child:${d.x}`);
    }
    const mod = {
      loader: () => ({ x: 9 }),
      default: () => h('div', {}, h(Child)),
    };
    const { body } = await renderPage(mod, {});
    assert.match(body, /child:9/);
  });

  it('passes params to both the loader and the component', async () => {
    const mod = {
      loader: ({ params }) => ({ from: params.slug }),
      default: ({ slug, loaderData }) => h('p', {}, `${slug}|${loaderData.from}`),
    };
    const { body } = await renderPage(mod, { params: { slug: 'hi' } });
    assert.match(body, /hi\|hi/);
  });

  it('gives the loader { params, query, request }', async () => {
    let received;
    const mod = {
      loader: (ctx) => { received = ctx; return {}; },
      default: () => h('p', {}, 'ok'),
    };
    const req = { url: '/x' };
    await renderPage(mod, { params: { a: '1' }, query: { q: 'z' }, request: req });
    assert.deepEqual(received.params, { a: '1' });
    assert.deepEqual(received.query, { q: 'z' });
    assert.equal(received.request, req);
  });

  it('handles a page with no loader (loaderData undefined, no throw)', async () => {
    const mod = { default: () => h('p', {}, 'ok') };
    const { body, loaderData } = await renderPage(mod, {});
    assert.equal(loaderData, undefined);
    assert.match(body, /ok/);
  });

  it('collects <Head> during a loader render too', async () => {
    const { h: hh, Head } = await import('what-core');
    const mod = {
      loader: () => ({ title: 'Loaded' }),
      default: ({ loaderData }) => hh('div', {}, hh(Head, { title: loaderData.title }), 'body'),
    };
    const { head } = await renderPage(mod, {});
    assert.match(head, /<title>Loaded<\/title>/);
  });
});
