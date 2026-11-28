// On the server, one request's query data never answers another's. Each
// render has a cache of its own, and so does a page's loader, which runs in its
// request's render context: what it prefetches is that request's, and the page
// reads it without fetching again. Outside every render (module scope, a timer,
// code after an await on a runtime without AsyncLocalStorage) the cache is not
// the process-wide one a browser page has: each call gets an empty cache of its
// own, so nothing is shared between users.
//
// No DOM in this file: it is the server process the rule is for.

import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { query, prefetchQuery, setQueryData, getQueryData } from 'what-core/data';
import { renderDocument, renderToStringAsync } from '../src/index.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the server query cache', () => {
  it('a loader\'s prefetch is its own request\'s, and the page reads it from there', async () => {
    let fetches = 0;
    const page = {
      async loader({ params }) {
        await prefetchQuery(['me'], async () => { fetches++; await delay(5); return `profile-${params.user}`; }, { staleTime: 60_000 });
        return null;
      },
      default() {
        const me = query(['me'], async () => { fetches++; return 'fetched-by-the-page'; }, { staleTime: 60_000 });
        return h('p', { id: 'me' }, () => me());
      },
    };
    const users = Array.from({ length: 20 }, (_, i) => `u${i}`);
    const pages = await Promise.all(users.map((user) => renderDocument(page, { params: { user } })));
    users.forEach((user, i) => assert.match(pages[i], new RegExp(`<p[^>]*id="me"[^>]*>(<!--\\$-->)?profile-${user}<`), `${user} sees their own data`));
    assert.equal(fetches, users.length, 'one fetch per request: the loader\'s, which the page read');
  });

  it('outside every render, each call has an empty cache of its own: nothing set there reaches anyone', async () => {
    await renderToStringAsync(h('p', null, 'the server runtime is set up'));
    const warn = console.warn;
    console.warn = () => {};
    try {
      setQueryData(['shared'], 'alice');
      assert.equal(getQueryData(['shared']), undefined);
      await prefetchQuery(['shared'], async () => 'alice', { staleTime: 60_000 });
      const { body } = await renderToStringAsync(h(() => {
        const value = query(['shared'], async () => 'bob', { staleTime: 60_000 });
        return h('p', null, () => value());
      }));
      assert.match(body, /bob/, 'a render never sees what was cached outside it');
    } finally {
      console.warn = warn;
    }
  });
});

// A server with a DOM global (jsdom or happy-dom installed for an SSR
// library, a Workers polyfill) and no AsyncLocalStorage: a render's code after
// an `await` runs outside its context, and must get a cache of its own there,
// not the one a browser page keeps. Deciding "server" by `typeof document`
// handed 39 of 40 renders another user's data.
describe('a server with a DOM global and no AsyncLocalStorage', () => {
  it('never hands a render another request\'s query data', () => {
    const url = (path) => JSON.stringify(new URL(path, import.meta.url).href);
    const script = `
      delete process.getBuiltinModule;
      delete globalThis.AsyncLocalStorage;
      const { installDOM } = await import(${url('../../../test-utils/dom.js')});
      installDOM();
      const { h, Suspense } = await import(${url('../../core/src/index.js')});
      const { query } = await import(${url('../../core/src/entries/data.js')});
      const { renderToStringAsync } = await import(${url('../src/index.js')});
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      async function Viewer({ uid }) {
        await delay(Math.random() * 5);
        const viewer = query(['viewer'], async () => { await delay(Math.random() * 5); return 'viewer-' + uid; });
        return h('p', null, () => viewer());
      }
      console.warn = () => {};
      const pages = await Promise.all(Array.from({ length: 40 }, (_, i) => renderToStringAsync(h(Suspense, { fallback: 'loading' }, h(Viewer, { uid: 'u' + i })))));
      console.log(JSON.stringify(pages.map((page) => /viewer-(u\\d+)/.exec(page.body)?.[1] ?? 'none')));
    `;
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const seen = JSON.parse(out.stdout.trim().split('\n').pop());
    assert.deepEqual(seen, seen.map((_, i) => `u${i}`));
  });
});
