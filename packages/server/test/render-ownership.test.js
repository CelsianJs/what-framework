// Every server render owns what it creates: component frames are owners under
// the render's root, so their effects, computeds and cleanups are released
// with the render, including what an async component creates after an
// `await` (directly, or through a renderToString it calls there).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, signal, effect, onCleanup, flushSync } from 'what-core';
import { renderToStream, renderToString } from '../src/node.js';
import { collect } from './stream-helpers.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('server render ownership', () => {
  it('releases an effect an async component creates after an await', async () => {
    const shared = signal(0);
    let runs = 0;
    async function Page() {
      await delay(5);
      effect(() => { shared(); runs++; });
      return h('p', null, 'page');
    }
    const html = await collect(renderToStream(h('div', null, h(Page, {}))));
    assert.match(html, /page/);
    assert.equal(runs, 1);
    shared(1);
    flushSync();
    assert.equal(runs, 1, 'nothing a finished request created runs later');
  });

  it('disposes at once what an async component creates after its render was released', async () => {
    const shared = signal(0);
    let runs = 0;
    let resume;
    const resumed = new Promise((resolve) => { resume = resolve; });
    async function Slow() {
      await delay(30);
      effect(() => { shared(); runs++; });
      resume();
      return h('p', null, 'slow');
    }
    const stream = renderToStream(h('div', null, h(Slow, {})));
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.return?.();
    await resumed;
    shared(1);
    flushSync();
    assert.ok(runs <= 1, 'an effect created under a released render does not stay subscribed');
  });

  it('runs a component\'s cleanups when its render is released', () => {
    const log = [];
    function Page() {
      onCleanup(() => log.push('page'));
      return h('p', null, 'x');
    }
    renderToString(h(Page, {}));
    assert.deepEqual(log, ['page']);
  });

  it('releases what a renderToString called after an await creates, with the render', async () => {
    const shared = signal(0);
    let inner = 0;
    let innerHtml = '';
    function Inner() {
      effect(() => { shared(); inner++; });
      return h('em', null, 'inner');
    }
    async function Outer() {
      await delay(5);
      innerHtml = renderToString(h(Inner, {}));
      return h('p', null, 'outer');
    }
    await collect(renderToStream(h('div', null, h(Outer, {}))));
    assert.match(innerHtml, /inner/);
    shared(1);
    flushSync();
    assert.equal(inner, 1);
  });
});
