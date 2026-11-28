// An ISR entry is keyed on the request's origin as well as its path, query and
// vary: a shared render sees `request.url`, so a Host one sender chose (it
// reaches a loader through `new URL('/api', request.url)`) never reaches
// another host's visitors, and "a cached render sees exactly what its key is
// made of" holds for the URL too (round 5, V2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, createCacheEngine, createMemoryStore } from '../src/index.js';

test('the key carries the origin, when the request names one', () => {
  assert.notEqual(cacheKey({ origin: 'http://a.test', path: '/p' }), cacheKey({ origin: 'http://b.test', path: '/p' }));
  assert.notEqual(cacheKey({ origin: 'http://a.test', path: '/p' }), cacheKey({ origin: 'https://a.test', path: '/p' }));
  assert.equal(cacheKey({ path: '/p', query: { b: '2', a: '1' } }), cacheKey({ path: '/p', query: { a: '1', b: '2' } }));
});

test('each host gets its own entry; the same host is a hit', async () => {
  const engine = createCacheEngine({ store: createMemoryStore() });
  let renders = 0;
  const render = async (match) => {
    renders++;
    return { html: `<p>${new URL(match.request.url).host}</p>`, status: 200 };
  };
  const match = (host) => ({ path: '/p', query: {}, params: {}, config: { mode: 'static', revalidate: 60 }, request: new Request(`http://${host}/p`) });
  const first = await engine.handle(match('attacker.test'), render);
  const second = await engine.handle(match('app.test'), render);
  const third = await engine.handle(match('app.test'), render);
  assert.match(first.body ?? first.html, /attacker\.test/);
  assert.match(second.body ?? second.html, /app\.test/);
  assert.doesNotMatch(second.body ?? second.html, /attacker/);
  assert.equal(renders, 2);
  assert.match(third.body ?? third.html, /app\.test/);
});
