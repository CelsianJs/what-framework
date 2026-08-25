// Hydration must adopt the CLIENT's value when it differs from the server's.
//
// This file runs with dev mode forced OFF, which is the configuration the bug
// lived in. Correcting the DOM on a text mismatch used to sit inside the
// dev-only warning branch, and "dev mode" was decided by reading
// `process.env.NODE_ENV` -- a check no browser can ever pass, because browsers
// have no `process`. So in every real browser the correction was skipped and the
// server's text stayed on screen.
//
// The visible symptom is not "a warning is missing". It is that any state the
// server cannot know renders stale: a cart restored from localStorage shows 0
// items, a saved theme shows the default, a relative timestamp shows the build
// time. It self-heals on the next write to that node, so it reads like a broken
// store rather than a hydration bug, and it is invisible to every test that runs
// under Node.
//
// `globalThis.__WHAT_DEV__` must be set BEFORE importing: __DEV__ is resolved
// once at module evaluation. Hence a dedicated file.

globalThis.__WHAT_DEV__ = false;

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { signal, computed, flushSync, __DEV__ } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { hydrate } = await import('../src/render.js');
const { renderToString } = await import('what-server');

// Server render, then hand the HTML to a client whose state differs. Mirrors a
// store hydrated from localStorage, which is the shape that surfaced this.
function serverThenClient({ serverValue, clientValue }) {
  const Badge = (count) => () => h('a', { class: 'badge' },
    h('span', { 'data-count': '' }, () => String(count())),
  );
  const Page = (count) => () => h('div', { class: 'page' },
    h(Badge(count), {}),
    h('main', {}, h('h1', {}, 'Shop')),
  );

  const server = signal(serverValue);
  document.body.innerHTML = renderToString(h(Page(computed(() => server())), {}));
  const serverText = document.querySelector('[data-count]').textContent;

  const client = signal(clientValue);
  hydrate(h(Page(computed(() => client())), {}), document.body);
  flushSync();

  return {
    serverText,
    hydratedText: document.querySelector('[data-count]').textContent,
    node: document.querySelector('[data-count]'),
    client,
  };
}

describe('hydration adopts the client value with dev mode off', () => {
  let warnings;
  let originalWarn;

  before(() => {
    originalWarn = console.warn;
    warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  after(() => { console.warn = originalWarn; });

  it('is running in the configuration the bug required', () => {
    assert.equal(__DEV__, false, 'this file must run with dev mode off');
  });

  it('replaces stale server text with the client value', () => {
    const { serverText, hydratedText } = serverThenClient({ serverValue: 0, clientValue: 3 });
    assert.equal(serverText, '0', 'the server rendered its own value');
    assert.equal(hydratedText, '3', 'hydration must show the client value, not the server value');
  });

  it('corrects even with no `process` global, which is every browser', () => {
    // The exact condition the bug needed. Node always has `process`, so a test
    // that does not remove it cannot see this failure at all: that is why the
    // defect survived a full suite and only appeared in a real browser.
    const savedProcess = globalThis.process;
    try {
      delete globalThis.process;
      const { hydratedText } = serverThenClient({ serverValue: 0, clientValue: 6 });
      assert.equal(hydratedText, '6', 'a browser must not keep the stale server text');
    } finally {
      globalThis.process = savedProcess;
    }
  });

  it('does so without emitting a warning when dev mode is off', () => {
    warnings.length = 0;
    serverThenClient({ serverValue: 0, clientValue: 7 });
    assert.deepEqual(warnings, [], 'production hydration must correct silently');
  });

  it('reuses the existing text node rather than replacing it', () => {
    // Correcting must not mean re-creating: the point of hydration is DOM reuse.
    // The server's text node itself has to survive, carrying the new value.
    const serverSignal = signal(0);
    const Page = (count) => () => h('span', { 'data-count': '' }, () => String(count()));
    document.body.innerHTML = renderToString(h(Page(computed(() => serverSignal())), {}));

    const serverTextNode = document.querySelector('[data-count]').firstChild;
    assert.equal(serverTextNode.nodeType, 3);
    assert.equal(serverTextNode.data, '0');

    hydrate(h(Page(computed(() => signal(5)())), {}), document.body);
    flushSync();

    assert.equal(serverTextNode.data, '5', 'the server text node must be updated in place');
    assert.ok(serverTextNode.isConnected, 'and must still be in the document');
  });

  it('stays reactive after the correction', () => {
    const { client, node } = serverThenClient({ serverValue: 0, clientValue: 2 });
    assert.equal(node.textContent, '2');
    client(11);
    flushSync();
    assert.equal(node.textContent, '11', 'the effect must still be bound to the corrected node');
  });

  it('leaves a matching value untouched', () => {
    const { hydratedText } = serverThenClient({ serverValue: 4, clientValue: 4 });
    assert.equal(hydratedText, '4');
  });
});
