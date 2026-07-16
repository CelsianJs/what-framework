import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { renderDocument, renderToString, renderToStream } from '../src/node.js';
import { createIslandStore, useIslandStore } from '../src/islands.js';

function hydrationPayload(html) {
  const match = html.match(/id="__what_data"[^>]*>([^<]*)</);
  assert.ok(match, 'renderDocument should emit a hydration payload');
  return JSON.parse(match[1]);
}

describe('SSR island store isolation', () => {
  it('retains one shared browser store across island lookups', () => {
    const originalDocument = globalThis.document;
    globalThis.document = {};
    try {
      const first = createIslandStore('browser-shared-store', { count: 0 });
      first.count = 3;
      const second = useIslandStore('browser-shared-store', { count: 99 });

      assert.strictEqual(first, second);
      assert.equal(second.count, 3);
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    }
  });

  it('creates a fresh same-name store for every request', async () => {
    const stores = [];

    function Page({ requestName }) {
      const store = createIslandStore('request-session', {
        requestName,
        visits: 0,
      });
      store.visits += 1;
      stores.push(store);
      return h('p', {}, `${store.requestName}:${store.visits}`);
    }

    const first = await renderDocument({
      default: () => h(Page, { requestName: 'first' }),
    });
    const second = await renderDocument({
      default: () => h(Page, { requestName: 'second' }),
    });

    assert.notStrictEqual(stores[0], stores[1]);
    assert.deepEqual(hydrationPayload(first).islandStores, {
      'request-session': { requestName: 'first', visits: 1 },
    });
    assert.deepEqual(hydrationPayload(second).islandStores, {
      'request-session': { requestName: 'second', visits: 1 },
    });
  });

  it('keeps module-scoped store declarations request-local when components use them', async () => {
    const moduleStore = createIslandStore('module-declared-session', {
      requestName: null,
      visits: 0,
    });

    function Page({ requestName }) {
      moduleStore.requestName = requestName;
      moduleStore.visits += 1;
      return h('p', {}, `${moduleStore.requestName}:${moduleStore.visits}`);
    }

    const first = await renderDocument({
      default: () => h(Page, { requestName: 'first' }),
    });
    const second = await renderDocument({
      default: () => h(Page, { requestName: 'second' }),
    });

    assert.deepEqual(hydrationPayload(first).islandStores, {
      'module-declared-session': { requestName: 'first', visits: 1 },
    });
    assert.deepEqual(hydrationPayload(second).islandStores, {
      'module-declared-session': { requestName: 'second', visits: 1 },
    });
  });

  it('keeps module-scoped stores usable in direct and streaming render APIs', async () => {
    const directStore = createIslandStore('direct-render-store', { value: 'direct' });
    const streamStore = createIslandStore('stream-render-store', { value: 'stream' });

    assert.equal(
      renderToString(h(() => h('p', {}, directStore.value), {})),
      '<p>direct</p>'
    );

    let streamed = '';
    for await (const chunk of renderToStream(h(() => h('p', {}, streamStore.value), {}))) {
      streamed += chunk;
    }
    assert.equal(streamed, '<p>stream</p>');
  });

  it('preserves request-local module stores across awaits in concurrent stream components', async () => {
    const moduleStore = createIslandStore('async-stream-request-store', {
      requestName: null,
      visits: 0,
    });

    function deferred() {
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    const aStarted = deferred();
    const bStarted = deferred();
    const aWrite = deferred();
    const bWrite = deferred();
    const aFinish = deferred();
    const bFinish = deferred();

    async function Page({ requestName, started, write, finish }) {
      started.resolve();
      await write.promise;
      moduleStore.requestName = requestName;
      moduleStore.visits += 1;
      await finish.promise;
      return h('p', {}, `${moduleStore.requestName}:${moduleStore.visits}`);
    }

    async function collect(stream) {
      let html = '';
      for await (const chunk of stream) html += chunk;
      return html;
    }

    const requestA = collect(renderToStream(h(Page, {
      requestName: 'request-a',
      started: aStarted,
      write: aWrite,
      finish: aFinish,
    })));
    const requestB = collect(renderToStream(h(Page, {
      requestName: 'request-b',
      started: bStarted,
      write: bWrite,
      finish: bFinish,
    })));

    await Promise.all([aStarted.promise, bStarted.promise]);
    aWrite.resolve();
    await Promise.resolve();
    bWrite.resolve();
    bFinish.resolve();
    assert.equal(await requestB, '<p>request-b:1</p>');

    aFinish.resolve();
    assert.equal(await requestA, '<p>request-a:1</p>');
  });

  it('snapshots only stores created by the current render', async () => {
    const first = await renderDocument({
      default: () => {
        createIslandStore('first-request-only', { secret: 'alpha' });
        return h('p', {}, 'first');
      },
    });
    const second = await renderDocument({
      default: () => {
        createIslandStore('second-request-only', { secret: 'beta' });
        return h('p', {}, 'second');
      },
    });

    assert.deepEqual(hydrationPayload(first).islandStores, {
      'first-request-only': { secret: 'alpha' },
    });
    assert.deepEqual(hydrationPayload(second).islandStores, {
      'second-request-only': { secret: 'beta' },
    });
  });
});
