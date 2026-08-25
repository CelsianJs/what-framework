// Hooks must decide "am I rendering on the server?" from the active render
// scope, not from whether a `document` object happens to exist.
//
// `typeof document === 'undefined'` is an environmental sniff, and the
// environment lies constantly: jsdom and happy-dom are installed globally by a
// huge number of projects, several test setups load one for the whole process,
// and some SSR runtimes ship a DOM shim outright. In every one of those a REAL
// server render sees a `document` and the hooks silently take the CLIENT path:
//
//   useLoaderData()  -> returns the stale #__what_data hydration payload from
//                       the PREVIOUS render instead of this request's loader
//                       result, so page N renders page N-1's data.
//   createResource() -> starts a browser-style fetch and returns null, so the
//                       server emits empty HTML and never suspends.
//
// This is the same defect class 0.12.0 fixed for renderToString (see the
// comment above renderToHydratableString in what-server): the scope, not the
// DOM, is the authority. what-core already exposes the right predicate as
// isServerRender() in server-context.js.
//
// The jsdom setup below is deliberately at module scope so `document` exists
// BEFORE what-core is imported, exactly as it would in a process that loads a
// DOM shim from a test setup file.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const STALE_PAYLOAD = { loaderData: { from: 'PREVIOUS_RENDER' }, resources: {}, islandStores: {} };

installDOM(
  '<!doctype html><html><body>' +
    `<script id="__what_data" type="application/json">${JSON.stringify(STALE_PAYLOAD)}</script>` +
    '</body></html>'
);

const { useLoaderData, createResource, runWithServerContext } = await import('../src/index.js');

// Mirrors what-server's createRenderContext(loaderData) closely enough for the
// hooks that read it. Kept local so this file never imports what-server.
function renderContext(loaderData) {
  return { head: null, loaderData, resources: new Map(), islandStores: new Map(), resourceCounter: 0 };
}

describe('useLoaderData under a DOM shim (jsdom present during a server render)', () => {
  it('returns THIS render context loaderData, not the stale hydration payload', () => {
    const fresh = { from: 'THIS_REQUEST_LOADER' };
    const seen = runWithServerContext(renderContext(fresh), () => useLoaderData());
    assert.deepEqual(
      seen,
      fresh,
      'a server render with a document must read the render scope, not #__what_data'
    );
  });

  it('reports undefined loaderData as undefined, not as the payload', () => {
    // A page with no loader has no data. Falling back to the payload here would
    // hand the component another request's data under a different name.
    const seen = runWithServerContext(renderContext(undefined), () => useLoaderData());
    assert.equal(seen, undefined);
  });

  it('still reads the hydration payload on the genuine client (no render scope)', () => {
    assert.deepEqual(useLoaderData(), STALE_PAYLOAD.loaderData);
  });
});

describe('createResource under a DOM shim (jsdom present during a server render)', () => {
  it('suspends into the render context instead of starting a client fetch', async () => {
    const ctx = renderContext(undefined);
    let fetched = 0;

    let thrown = null;
    let returned;
    try {
      returned = runWithServerContext(ctx, () =>
        createResource(async () => { fetched++; return 'SERVER_VALUE'; }, { key: 'thing' })
      );
    } catch (e) {
      thrown = e;
    }

    assert.equal(returned, undefined, 'server branch must not return a client resource tuple');
    assert.ok(
      thrown && typeof thrown.then === 'function',
      'a server render must suspend (throw a thenable) so <Suspense> can await it'
    );

    // Second pass, the way renderToStringAsync re-renders: the resolved value
    // comes back synchronously out of the render context cache.
    await thrown;
    const [data, { loading }] = runWithServerContext(ctx, () =>
      createResource(async () => { fetched++; return 'SERVER_VALUE'; }, { key: 'thing' })
    );
    assert.equal(data(), 'SERVER_VALUE');
    assert.equal(loading(), false);
    assert.equal(fetched, 1, 'the fetcher runs once per render, from the context cache');
  });

  it('still fetches client-side on the genuine client (no render scope)', async () => {
    let fetched = 0;
    const [data] = createResource(async () => { fetched++; return 'CLIENT_VALUE'; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(fetched, 1);
    assert.equal(data(), 'CLIENT_VALUE');
  });
});
