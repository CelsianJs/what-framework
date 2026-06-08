// Async Suspense SSR (Phase 5): createResource suspends on the server, the
// engine awaits + re-renders with resolved data; sync render shows the fallback;
// streaming resolves the boundary content.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Suspense, createResource } from 'what-core';
import { renderToString, renderToStream, renderToStringAsync } from '../src/index.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function collect(stream) {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out;
}

function AsyncThing() {
  const [data] = createResource(async () => { await delay(5); return 'LOADED'; }, { key: 'thing' });
  return h('p', {}, data());
}
function Page() {
  return h(Suspense, { fallback: h('span', {}, 'loading...') }, h(AsyncThing));
}

describe('Suspense SSR', () => {
  it('renderToStringAsync resolves the async resource', async () => {
    const { body } = await renderToStringAsync(h(Page));
    assert.match(body, /LOADED/);
    assert.doesNotMatch(body, /loading\.\.\./);
  });

  it('sync renderToString shows the fallback (cannot await)', () => {
    const html = renderToString(h(Page));
    assert.match(html, /loading\.\.\./);
    assert.doesNotMatch(html, /<__suspense/, 'must not emit a literal <__suspense> tag');
  });

  it('renderToStream resolves the boundary content', async () => {
    const html = await collect(renderToStream(h(Page)));
    assert.match(html, /LOADED/);
  });

  it('exposes resolved resources for the hydration payload', async () => {
    const { resources } = await renderToStringAsync(h(Page));
    assert.equal(resources.thing, 'LOADED');
  });
});
