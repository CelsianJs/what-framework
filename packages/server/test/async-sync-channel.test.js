// A value the server's fetcher answers at once travels in the hydration data
// channel like one that landed later (docs/ASYNC.md, "Server rendering and
// hydration"): a resource, or a computed() whose function takes `{ signal }`,
// that returns a plain value is recorded, and the hydrating client adopts it
// without running the function again. A plain synchronous computed is not:
// the client computes it again.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let core;
let internal;
let server;
before(async () => {
  ({ cleanup } = installDOM());
  core = await import('what-core');
  internal = await import('what-core/internal');
  server = await import('../src/index.js');
});
after(() => cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));
const bodyOf = (html) => html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

describe('a synchronous answer in the server data channel', () => {
  it('a resource or a { signal } computed that answers with a plain value is sent, and adopted with no client call', async () => {
    const { h, createResource, computed, Suspense } = core;
    const calls = [];
    const where = () => (internal.getServerContext() ? 'server' : 'client');
    function Page() {
      const [keyless] = createResource(() => { calls.push('keyless@' + where()); return 'plain'; });
      const [keyed] = createResource(() => { calls.push('keyed@' + where()); return 'keyed plain'; }, { key: 'k' });
      const fetched = computed(({ signal }) => { calls.push('fetched@' + where() + (signal.aborted ? ' (aborted)' : '')); return 'asked'; });
      const derived = computed(() => { calls.push('derived@' + where()); return 'derived'; });
      return h(Suspense, { fallback: 'fb' }, h('p', null, () => [keyless(), keyed(), fetched(), derived()].join(' / ')));
    }
    const html = await server.renderDocument({ default: Page });
    assert.match(html.replace(/<!--[^>]*-->/g, ''), /<p>plain \/ keyed plain \/ asked \/ derived<\/p>/);
    const payload = JSON.parse(html.match(/<script id="__what_data" type="application\/json">(.*?)<\/script>/)[1]);
    assert.ok(JSON.stringify(payload).includes('"plain"'), 'the keyless value is in the channel');
    assert.ok(JSON.stringify(payload).includes('"keyed plain"'), 'the keyed value is in the channel');
    assert.ok(JSON.stringify(payload).includes('"asked"'), 'the value of a function that takes { signal } is in the channel');
    assert.ok(!JSON.stringify(payload).includes('"derived"'), 'a plain derivation is not sent');
    document.body.innerHTML = bodyOf(html);
    calls.length = 0;
    internal.__resetHydrationData();
    const stop = core.hydrate(h(Page, {}), document.body);
    for (let i = 0; i < 3; i++) await drain();
    // The adopted computed's function runs once with an aborted signal, to learn
    // what it reads (docs/ASYNC.md); the derivation is computed again.
    assert.deepEqual(calls, ['fetched@client (aborted)', 'derived@client'], 'the client fetched nothing, and computed the derivation again');
    assert.equal(document.querySelector('p').textContent, 'plain / keyed plain / asked / derived');
    stop();
  });
});
