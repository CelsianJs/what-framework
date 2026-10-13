import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createCacheEngine } from '../src/isr.js';
import { createMemoryStore } from '../src/stores/memory-store.js';
import { makeEntry } from '../src/stores/store-interface.js';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const config = { mode: 'hybrid', revalidate: 60, swr: 0 };
const routeFor = (user) => ({ path: '/account', query: {}, config, user });

describe('private ISR in-flight isolation', () => {
  for (const marker of ['private', 'usedRequestHeaders']) {
    for (const state of ['cold', 'expired']) {
      it(`${state} followers rerender their own request when ${marker} is returned`, async () => {
        const gate = deferred();
        const started = deferred();
        const store = createMemoryStore();
        const calls = [];
        const engine = createCacheEngine({
          store, now: () => 100_000,
          render: async (route) => {
            calls.push(route.user);
            if (route.user === 'alice') { started.resolve(); await gate.promise; }
            return { html: route.user, [marker]: true };
          },
        });
        const key = engine.keyFor(routeFor('alice'));
        if (state === 'expired') {
          await store.set(key, makeEntry({ html: 'old public', path: '/account' }, config, 0));
        }
        const alice = engine.handle(routeFor('alice'));
        await started.promise;
        const bob = engine.handle(routeFor('bob'));
        const carol = engine.handle(routeFor('carol'));
        await setImmediate();
        assert.deepEqual(calls, ['alice'], 'followers initially wait for the shared render');
        gate.resolve();
        const results = await Promise.all([alice, bob, carol]);
        assert.deepEqual(results.map((out) => out.html), ['alice', 'bob', 'carol']);
        assert.deepEqual(calls, ['alice', 'bob', 'carol']);
        for (const out of results) {
          assert.equal(out.cacheStatus, 'MISS');
          assert.match(out.headers['Cache-Control'], /private, no-store/);
        }
        assert.equal(engine._inFlight.size, 0);
        assert.equal((await store.get(key))?.html, state === 'expired' ? 'old public' : undefined);
      });
    }
  }

  it('keeps private follower overrides independent and leaves a newer public flight registered', async () => {
    const store = createMemoryStore();
    const engine = createCacheEngine({ store });
    const aliceGate = deferred();
    const bobGate = deferred();
    const publicGate = deferred();
    const calls = [];
    const renderFor = (user, gate, privateResult) => async (route) => {
      calls.push(user);
      assert.equal(route.user, user, 'each override gets its own route match');
      await gate.promise;
      return { html: user, private: privateResult };
    };
    const alice = engine.handle(routeFor('alice'), renderFor('alice', aliceGate, true));
    await setImmediate();
    const bob = engine.handle(routeFor('bob'), renderFor('bob', bobGate, true));
    await setImmediate();
    aliceGate.resolve();
    assert.equal((await alice).html, 'alice');
    await setImmediate();
    assert.deepEqual(calls, ['alice', 'bob'], 'a private follower must run its override');
    const publicRequest = engine.handle(routeFor('public'), renderFor('public', publicGate, false));
    await setImmediate();
    const key = engine.keyFor(routeFor('public'));
    const publicFlight = engine._inFlight.get(key);
    assert.ok(publicFlight);
    bobGate.resolve();
    assert.equal((await bob).html, 'bob');
    assert.equal(engine._inFlight.get(key), publicFlight, 'a follower must not clean up another render');
    const publicFollower = engine.handle(routeFor('follower'), async () => {
      assert.fail('public followers must remain deduplicated');
    });
    await setImmediate();
    publicGate.resolve();
    assert.deepEqual((await Promise.all([publicRequest, publicFollower])).map((out) => out.html), ['public', 'public']);
    assert.deepEqual(calls, ['alice', 'bob', 'public']);
    assert.equal(engine._inFlight.size, 0);
  });

  it('a private follower failure cannot fail another follower or remove a newer flight', async () => {
    const store = createMemoryStore();
    const engine = createCacheEngine({ store });
    const aliceGate = deferred();
    const bobGate = deferred();
    const publicGate = deferred();
    const alice = engine.handle(routeFor('alice'), async () => {
      await aliceGate.promise;
      return { html: 'alice', private: true };
    });
    await setImmediate();
    const bob = engine.handle(routeFor('bob'), async () => {
      await bobGate.promise;
      throw new Error('bob failed');
    });
    const bobOutcome = bob.then((value) => ({ value }), (error) => ({ error }));
    const carol = engine.handle(routeFor('carol'), async () => ({ html: 'carol', usedRequestHeaders: true }));
    await setImmediate();
    aliceGate.resolve();
    assert.equal((await alice).html, 'alice');
    assert.equal((await carol).html, 'carol');
    const publicRequest = engine.handle(routeFor('public'), async () => {
      await publicGate.promise;
      return { html: 'public' };
    });
    await setImmediate();
    const key = engine.keyFor(routeFor('public'));
    const publicFlight = engine._inFlight.get(key);
    bobGate.resolve();
    assert.match((await bobOutcome).error.message, /bob failed/);
    assert.equal(engine._inFlight.get(key), publicFlight);
    publicGate.resolve();
    assert.equal((await publicRequest).html, 'public');
    assert.equal(engine._inFlight.size, 0);
    assert.equal((await store.get(key)).html, 'public');
  });

  it('failed shared regeneration releases the key so a later request can retry', async () => {
    const gate = deferred();
    let calls = 0;
    const engine = createCacheEngine({
      store: createMemoryStore(),
      render: async () => {
        calls++;
        if (calls === 1) { await gate.promise; throw new Error('upstream failed'); }
        return { html: 'recovered' };
      },
    });
    const alice = engine.handle(routeFor('alice'));
    const bob = engine.handle(routeFor('bob'));
    const failures = Promise.all([assert.rejects(alice, /upstream failed/), assert.rejects(bob, /upstream failed/)]);
    await setImmediate();
    gate.resolve();
    await failures;
    assert.equal(calls, 1);
    assert.equal(engine._inFlight.size, 0);
    assert.equal((await engine.handle(routeFor('carol'))).html, 'recovered');
    assert.equal(calls, 2);
  });
});
