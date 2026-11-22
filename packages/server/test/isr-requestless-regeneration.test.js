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
import { cacheKey, createCacheEngine, createMemoryStore, createScheduler, makeEntry } from 'what-isr';
import { createRequestHandler, createRouteRenderer } from '../src/index.js';

function app({ origin, origins, store = createMemoryStore(), logger = { warn() {}, error() {} } } = {}) {
  const seen = [];
  const Page = ({ loaderData }) => h('p', { id: 'seen' }, loaderData.seen);
  const loader = ({ request }) => {
    seen.push(`${request.method} ${request.url}`);
    return { seen: `render ${seen.length} at ${new URL(request.url).host}` };
  };
  const routes = [{ path: '/', component: Page, loader, page: { mode: 'static', revalidate: 60 } }];
  const render = createRouteRenderer();
  const cache = createCacheEngine({ store, render, logger, origin, origins });
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

// Which origins a regeneration renders, and what it reads to know them
// (round 7, G3). A sender can make the engine store an entry for any Host it
// names, so the origins visitors read come first; a site that names its
// origins caches only those.
describe('the origins a regeneration with no request renders', () => {
  const stored = (html) => makeEntry({ html, status: 200, path: '/' }, { mode: 'static', revalidate: 60 }, Date.now());
  // Entries another process stored (a shared store): this engine never read them.
  const plant = async (store, count) => {
    for (let i = 0; i < count; i++) await store.set(cacheKey({ origin: `http://p${i}.test`, path: '/', query: {} }), stored('planted'));
  };

  it('prefers the origins a request read over ones that are only stored', async () => {
    const store = createMemoryStore();
    const { routes, cache, visit, seen } = app({ store });
    await visit('shop.test');
    await plant(store, 20);
    seen.length = 0;
    await cache.regenerate(homeRoute(routes));
    assert.equal(seen.length, 16);
    assert.ok(seen.includes('GET http://shop.test/'), seen.join(', '));
  });

  it('reads the store\'s keys once per path, not on every tick', async () => {
    const store = createMemoryStore();
    let listed = 0;
    const keys = store.keys.bind(store);
    store.keys = async () => { listed++; return keys(); };
    const { routes, cache, visit, seen } = app({ store });
    await visit('a.test');
    for (let i = 0; i < 3; i++) await cache.regenerate(homeRoute(routes));
    await visit('b.test');
    seen.length = 0;
    await cache.regenerate(homeRoute(routes));
    assert.equal(listed, 1);
    assert.deepEqual(seen.sort(), ['GET http://a.test/', 'GET http://b.test/']);
  });

  it('with `origins`, caches and regenerates exactly the named origins', async () => {
    const store = createMemoryStore();
    const { routes, cache, visit, seen } = app({ store, origins: ['http://shop.test'] });
    for (let i = 0; i < 20; i++) assert.equal((await visit(`p${i}.test`)).cache, 'BYPASS');
    assert.deepEqual(await store.keys(), [], 'nothing stored for a Host the site does not name');
    assert.equal((await visit('p0.test')).cache, 'BYPASS', 'and nothing served from the store');
    assert.equal((await visit('shop.test')).cache, 'MISS');
    assert.equal((await visit('shop.test')).cache, 'HIT');
    seen.length = 0;
    await cache.regenerate(homeRoute(routes));
    assert.deepEqual(seen, ['GET http://shop.test/']);
    seen.length = 0;
    await cache.revalidatePath('/', { regenerate: true });
    assert.deepEqual(seen, ['GET http://shop.test/']);
  });

  it('revalidatePath regenerates from the route it last rendered, and without one only purges', async () => {
    const errors = [];
    const warnings = [];
    const logger = { warn: (...a) => warnings.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) };
    const { cache, visit, seen } = app({ logger });
    await visit('a.test');
    seen.length = 0;
    await cache.revalidatePath('/', { regenerate: true });
    assert.deepEqual(seen, ['GET http://a.test/']);
    assert.equal((await visit('a.test')).cache, 'HIT');
    assert.deepEqual(errors, []);

    // A route only a scheduler rendered (a match with no request) is
    // remembered too.
    const scheduled = app({ logger });
    await scheduled.cache.regenerate(homeRoute(scheduled.routes));
    scheduled.seen.length = 0;
    await scheduled.cache.revalidatePath('/', { regenerate: true });
    assert.deepEqual(scheduled.seen, ['GET http://localhost/']);
    assert.deepEqual(errors, []);

    const cold = app({ logger });
    await cold.cache.store.set(cacheKey({ origin: 'http://a.test', path: '/', query: {} }), stored('old'));
    const purged = await cold.cache.revalidatePath('/', { regenerate: true });
    assert.equal(purged.length, 1);
    assert.deepEqual(cold.seen, []);
    assert.deepEqual(errors, [], 'no TypeError from rendering a match with no route');
    assert.match(warnings.join('\n'), /no route to render it from/);
  });
});
