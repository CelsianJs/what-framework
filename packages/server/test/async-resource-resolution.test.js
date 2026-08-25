// A keyless createResource() never resolved on the server.
//
// createResource assigns a key from a per-render-context counter:
//
//   const key = options.key != null ? options.key : `__r${ctx.resourceCounter++}`;
//
// Both server resolve loops re-render the tree after awaiting the pending
// promises, and neither reset that counter. So pass 0 stored `__r0` and
// suspended; pass 1 asked for `__r1`, found nothing cached, started a *second*
// fetch and suspended again. Twelve passes later the loop gave up and emitted
// the Suspense fallback — after paying for twelve sequential fetches.
//
// The effect: `renderToStream` and `renderToStringAsync` shipped the loading
// state as final HTML, and so did `renderDocument`, the full-stack entry point.
// Passing an explicit `key` bypassed the counter and worked, which is why the
// feature looked functional in any example that used one.
//
// Nothing caught it because every existing Suspense test asserts boundary
// structure — that a fallback renders, that a marker tag does not leak into the
// output — and none of them asserts that data actually arrives.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { h, Suspense, createResource } from 'what-core';
import { renderToString, renderToStream, renderToStringAsync } from '../src/index.js';

async function collect(vnode) {
  let out = '';
  for await (const chunk of renderToStream(vnode)) out += chunk;
  return out;
}

/** A resource that takes a tick to arrive, with no explicit key. */
function slow(value, ms = 10) {
  return () => new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('server-side async resources resolve', () => {
  it('renderToStream emits resolved data, not the fallback', async () => {
    function Slow() {
      const [data] = createResource(slow('SLOW-DATA'));
      return h('p', { id: 'slow' }, data());
    }
    const html = await collect(
      h('div', null, h(Suspense, { fallback: h('p', null, 'loading') }, h(Slow))),
    );
    assert.match(html, /SLOW-DATA/);
    assert.doesNotMatch(html, /loading/);
  });

  it('renderToStringAsync emits resolved data, not the fallback', async () => {
    function Slow() {
      const [data] = createResource(slow('ASYNC-DATA'));
      return h('p', null, data());
    }
    const { body, resources } = await renderToStringAsync(
      h('div', null, h(Suspense, { fallback: h('p', null, 'loading') }, h(Slow))),
    );
    assert.match(body, /ASYNC-DATA/);
    assert.doesNotMatch(body, /loading/);
    // The hydration payload carries it too, so the client does not refetch.
    assert.ok(Object.values(resources).includes('ASYNC-DATA'));
  });

  it('resolves several keyless resources in one boundary', async () => {
    function Two() {
      const [a] = createResource(slow('AAA'));
      const [b] = createResource(slow('BBB', 20));
      return h('p', null, a(), '-', b());
    }
    const html = await collect(
      h(Suspense, { fallback: h('p', null, 'loading') }, h(Two)),
    );
    assert.match(html, /AAA-BBB/);
  });

  it('does not steal the key of a resource rendered before the boundary', async () => {
    // The counter is context-wide, so a boundary that reset it to zero on each
    // attempt would re-issue keys already taken by an earlier sibling and serve
    // that sibling's value inside the boundary. It has to restore its own
    // starting point, not zero.
    function Before() {
      const [data] = createResource(slow('OUTSIDE'));
      return h('span', { id: 'before' }, data());
    }
    function Inside() {
      const [data] = createResource(slow('INSIDE', 20));
      return h('span', { id: 'inside' }, data());
    }
    const { body } = await renderToStringAsync(
      h('div', null,
        h(Suspense, { fallback: h('i', null, 'l1') }, h(Before)),
        h(Suspense, { fallback: h('i', null, 'l2') }, h(Inside)),
      ),
    );
    assert.match(body, /id="before">OUTSIDE</);
    assert.match(body, /id="inside">INSIDE</);
  });

  it('still honours an explicit key', async () => {
    function Slow() {
      const [data] = createResource(slow('KEYED'), { key: 'mine' });
      return h('p', null, data());
    }
    const { resources } = await renderToStringAsync(
      h(Suspense, { fallback: h('p', null, 'loading') }, h(Slow)),
    );
    assert.equal(resources.mine, 'KEYED');
  });

  it('fetches each resource once, not once per resolve pass', async () => {
    let calls = 0;
    function Counted() {
      const [data] = createResource(() => {
        calls++;
        return new Promise((r) => setTimeout(() => r('ONCE'), 10));
      });
      return h('p', null, data());
    }
    const html = await collect(h(Suspense, { fallback: h('p', null, 'l') }, h(Counted)));
    assert.match(html, /ONCE/);
    assert.equal(calls, 1);
  });

  it('still shows the fallback under the synchronous renderToString', async () => {
    // Documented behaviour: a bare synchronous render has nothing to await.
    function Slow() {
      const [data] = createResource(slow('NEVER'));
      return h('p', null, data());
    }
    const html = renderToString(
      h(Suspense, { fallback: h('p', null, 'loading') }, h(Slow)),
    );
    assert.match(html, /loading/);
  });
});
