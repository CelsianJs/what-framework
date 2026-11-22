// A regeneration with no request (createScheduler's engine.regenerate(route),
// revalidatePath and revalidateTag with `regenerate`) renders through
// createRouteRenderer, as the full-stack starter wires it, and refreshes what
// visitors read: each origin's stored entry, rendered from a GET request at
// that origin, or, with none stored, the path's default entry, which a
// request whose origin has no entry of its own is served. Before, the
// renderer threw on a match with no request (`request.signal`), and an entry
// the engine stored without one was keyed on no origin and never read.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { createCacheEngine, createMemoryStore, createScheduler } from 'what-isr';
import { createRequestHandler, createRouteRenderer } from '../src/index.js';

function app({ origin } = {}) {
  const seen = [];
  const Page = ({ loaderData }) => h('p', { id: 'seen' }, loaderData.seen);
  const loader = ({ request }) => {
    seen.push(`${request.method} ${request.url}`);
    return { seen: `render ${seen.length} at ${new URL(request.url).host}` };
  };
  const routes = [{ path: '/', component: Page, loader, page: { mode: 'static', revalidate: 60 } }];
  const render = createRouteRenderer();
  const cache = createCacheEngine({ store: createMemoryStore(), render, logger: { warn() {}, error() {} }, origin });
  const handle = createRequestHandler({ routes, cache, render });
  const visit = async (host) => {
    const res = await handle(new Request(`http://${host}/`));
    return { cache: res.headers.get('x-what-cache'), text: (/id="seen"[^>]*>([^<]*)</.exec(await res.text()) || [])[1] };
  };
  return { routes, cache, visit, seen };
}

const homeRoute = (routes) => ({ path: '/', query: {}, params: {}, config: routes[0].page, route: routes[0] });

describe('a regeneration with no request', () => {
  it('renders through createRouteRenderer, and a visit from any origin is served the default entry it made', async () => {
    const { routes, cache, visit, seen } = app();
    await cache.regenerate(homeRoute(routes));
    assert.deepEqual(seen, ['GET http://localhost/']);
    assert.deepEqual(await visit('a.test'), { cache: 'HIT', text: 'render 1 at localhost' });
    assert.deepEqual(await visit('b.test'), { cache: 'HIT', text: 'render 1 at localhost' });
    assert.equal(seen.length, 1);
  });

  it('renders the default entry at the engine\'s origin when it has one', async () => {
    const { routes, cache, visit, seen } = app({ origin: 'https://blog.example' });
    await cache.regenerate(homeRoute(routes));
    assert.deepEqual(seen, ['GET https://blog.example/']);
    assert.equal((await visit('blog.example')).text, 'render 1 at blog.example');
  });

  it('refreshes the entry of every origin stored for the path, each at its origin', async () => {
    const { routes, cache, visit, seen } = app();
    assert.equal((await visit('a.test')).cache, 'MISS');
    assert.equal((await visit('b.test')).cache, 'MISS');
    seen.length = 0;
    await cache.regenerate(homeRoute(routes));
    assert.deepEqual(seen.sort(), ['GET http://a.test/', 'GET http://b.test/']);
    const a = await visit('a.test');
    const b = await visit('b.test');
    assert.equal(a.cache, 'HIT');
    assert.equal(b.cache, 'HIT');
    assert.match(a.text, /at a\.test$/);
    assert.match(b.text, /at b\.test$/);
  });

  it('after revalidatePath, regenerates each origin it purged', async () => {
    const { routes, cache, visit, seen } = app();
    await visit('a.test');
    seen.length = 0;
    await cache.revalidatePath('/', { regenerate: true, routeResolver: () => homeRoute(routes) });
    assert.deepEqual(seen, ['GET http://a.test/']);
    assert.equal((await visit('a.test')).cache, 'HIT');
  });

  it('keeps one host\'s render from another host', async () => {
    // A visitor's render is its origin's: after the scheduler refreshed it,
    // another host still renders its own.
    const first = app();
    await first.visit('evil.test');
    await first.cache.regenerate(homeRoute(first.routes));
    const other = await first.visit('a.test');
    assert.equal(other.cache, 'MISS');
    assert.match(other.text, /at a\.test$/);
    // A default entry, which no visitor's request made, is what a host with
    // no entry of its own is served; a sender's Host never replaces it.
    const second = app();
    await second.cache.regenerate(homeRoute(second.routes));
    assert.deepEqual(await second.visit('evil.test'), { cache: 'HIT', text: 'render 1 at localhost' });
    assert.deepEqual(await second.visit('a.test'), { cache: 'HIT', text: 'render 1 at localhost' });
  });

  it('renders at most 16 stored origins in one regeneration', async () => {
    const { routes, cache, visit, seen } = app();
    for (let i = 0; i < 20; i++) await visit(`h${i}.test`);
    seen.length = 0;
    await cache.regenerate(homeRoute(routes));
    assert.equal(seen.length, 16);
    assert.ok(seen.every((line) => /h(?:[4-9]|1\d)\.test/.test(line)), 'the most recently used');
  });

  it('runs from a scheduler, as the full-stack starter registers it, with no error', async () => {
    const { routes, cache, visit } = app();
    const errors = [];
    const timers = [];
    const scheduler = createScheduler(cache, {
      logger: { error: (...args) => errors.push(args.join(' ')) },
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer() {},
      random: () => 0,
    });
    scheduler.register(homeRoute(routes), { intervalMs: 1000 }).start();
    timers.shift()();
    await new Promise((resolve) => setTimeout(resolve, 20));
    scheduler.stop();
    assert.deepEqual(errors, []);
    assert.equal((await visit('localhost:3000')).cache, 'HIT');
  });
});
