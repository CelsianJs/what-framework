import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createRequestHandler } from '../src/index.js';
import { createCacheEngine, createMemoryStore } from 'what-isr';

describe('request handler ISR in-flight privacy', () => {
  for (const marker of ['private', 'usedRequestHeaders']) {
    for (const state of ['cold', 'expired']) {
      it(`isolates ${state} concurrent Request objects when render returns ${marker}`, async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const store = createMemoryStore();
        const calls = [];
        const page = { mode: 'hybrid', revalidate: 60, swr: 0 };
        let now = 0;
        const cache = createCacheEngine({ store, now: () => now, render: async () => ({ html: 'old public' }) });
        if (state === 'expired') {
          await cache.regenerate({ path: '/account', query: {}, config: page });
          now = 120_000;
        }
        const handle = createRequestHandler({
          csrf: false,
          routes: [{ path: '/account', page }], cache,
          render: async ({ request }) => {
            const user = request.headers.get('x-user');
            calls.push(user);
            if (user === 'alice') await gate;
            return { html: user, [marker]: true };
          },
        });
        const get = (user) => handle(new Request('http://local.test/account', { headers: { 'x-user': user } }));
        const alice = get('alice');
        await setImmediate();
        const bob = get('bob');
        await setImmediate();
        assert.deepEqual(calls, ['alice']);
        release();
        const responses = await Promise.all([alice, bob]);
        assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ['alice', 'bob']);
        assert.deepEqual(calls, ['alice', 'bob']);
        for (const response of responses) {
          assert.equal(response.status, 200);
          assert.match(response.headers.get('cache-control'), /private, no-store/);
        }
        const keys = await store.keys();
        assert.equal(keys.length, state === 'expired' ? 1 : 0);
        if (keys.length) assert.equal((await store.get(keys[0])).html, 'old public');
      });
    }
  }

  for (const mode of ['public', 'vary', 'server']) {
    it(`preserves the ${mode} concurrency control`, async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const store = createMemoryStore();
      const calls = [];
      const page = { mode: mode === 'server' ? 'server' : 'hybrid', revalidate: 60 };
      if (mode === 'vary') page.vary = ['header:x-user'];
      const handle = createRequestHandler({
        csrf: false, routes: [{ path: '/account', page }],
        cache: createCacheEngine({ store }),
        render: async ({ request }) => {
          const user = request.headers.get('x-user');
          calls.push(user);
          await gate;
          return { html: mode === 'public' ? 'public' : user };
        },
      });
      const get = (user) => handle(new Request('http://local.test/account', { headers: { 'x-user': user } }));
      const alice = get('alice');
      const bob = get('bob');
      await setImmediate();
      assert.equal(calls.length, mode === 'public' ? 1 : 2);
      release();
      const responses = await Promise.all([alice, bob]);
      assert.deepEqual(await Promise.all(responses.map((response) => response.text())), mode === 'public' ? ['public', 'public'] : ['alice', 'bob']);
      assert.equal((await store.keys()).length, mode === 'server' ? 0 : mode === 'vary' ? 2 : 1);
      if (mode === 'public') {
        assert.match(responses[0].headers.get('cache-control'), /public/);
        assert.equal((await get('carol')).headers.get('x-what-cache'), 'HIT');
        assert.equal(calls.length, 1);
      } else {
        assert.match(responses[0].headers.get('cache-control'), /private, no-store/);
      }
    });
  }
});
