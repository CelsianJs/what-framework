// Island hydration: a server-rendered island must reuse its DOM through the
// core hydrate() (not silently do nothing), and pick up island store state from
// the #__what_data payload renderDocument emits.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM();

const { h, signal } = await import('what-core');
const { renderToString, renderDocument } = await import('../src/index.js');
const {
  Island,
  island,
  hydrateIslands,
  createIslandStore,
  useIslandStore,
} = await import('../src/islands.js');

// Run a render as the server would see it: no `document` global.
async function asServer(fn) {
  const saved = globalThis.document;
  delete globalThis.document;
  try {
    return await fn();
  } finally {
    globalThis.document = saved;
  }
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

let clicks = 0;

function Counter({ label }) {
  const count = signal(0);
  return h('button', { onclick: () => { clicks++; count(c => c + 1); } }, `${label}:${count()}`);
}

describe('island hydration', () => {
  it('reuses the server-rendered DOM and wires handlers', async () => {
    const html = await asServer(() =>
      renderToString(
        Island({
          name: 'counter',
          props: { label: 'hi' },
          mode: 'load',
          children: [h(Counter, { label: 'hi' })],
        })
      )
    );
    assert.match(html, /data-island="counter"/);
    assert.match(html, /<button>hi:0<\/button>/);

    const app = document.getElementById('app');
    app.innerHTML = html;
    const buttonBefore = app.querySelector('button');

    island('counter', () => ({ default: Counter }), { mode: 'load' });
    hydrateIslands();
    await flush();

    const buttonAfter = app.querySelector('button');
    assert.equal(buttonAfter, buttonBefore, 'hydrate() should reuse the existing node, not remount');
    assert.equal(app.querySelectorAll('button').length, 1, 'island must not be rendered twice');
    assert.equal(app.querySelector('[data-island]'), null, 'island marker should be cleaned up');

    buttonAfter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(clicks, 1, 'handlers should be attached by hydration');
  });

  it('hydrates island stores from the #__what_data payload', async () => {
    function Page() {
      const store = createIslandStore('cart', { items: 0 });
      store.items = 3;
      return h('p', {}, `items:${store.items}`);
    }

    const html = await asServer(() => renderDocument({ default: Page }));
    const payloadScript = html.match(/<script id="__what_data"[\s\S]*?<\/script>/);
    assert.ok(payloadScript, 'renderDocument should emit the hydration payload');

    document.body.innerHTML = payloadScript[0];
    hydrateIslands();

    const store = useIslandStore('cart', { items: 0 });
    assert.equal(store.items, 3, 'island store state should survive into the client');
  });
});
