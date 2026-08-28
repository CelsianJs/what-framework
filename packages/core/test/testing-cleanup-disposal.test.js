// cleanup() must dispose what render() mounted.
//
// render() dropped the disposer mount() returns, and cleanup() cleared innerHTML
// and detached the container. That removes NODES and touches not one effect, so
// every page a suite mounted stayed live for the rest of the process: still
// answering signal writes, still running the intervals its onCleanup was there
// to clear. The disposer render() threw away was the only handle that existed,
// so no app could work around it from outside.
//
// What it did to a real 30k-line suite: one file never finished, with a worker
// pinned at 140% CPU that no per-test timeout could interrupt, and other files
// that passed alone and timed out when run together. Capturing render().unmount
// by hand and disposing in afterEach took that suite from 17.29s to 8.42s.
//
// The counts and the timer ledger below are the deterministic form of both
// symptoms. A test that only checked the markup passes either way: the leaked
// tree is detached, so nothing it does is visible in the DOM.
//
// This is a SEPARATE defect from insert() dropping a compiled region's disposer,
// and each one is measured separately here: the h() cases fail without the
// cleanup() fix alone, the compiled cases need both.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { signal, flushSync } = await import('../src/reactive.js');
const { render, renderTest, cleanup } = await import('../src/testing.js');
const { h } = await import('../src/h.js');
const { _$template, insert, _$createComponent } = await import('../src/render.js');
const { onCleanup } = await import('../src/hooks.js');

const tmpl = _$template('<div><!--$--></div>');

// A ledger rather than a wall clock: a leaked interval is proven by an id that
// was never cleared, which does not depend on how long the test waits.
let started;
let cleared;
let realSetInterval;
let realClearInterval;

beforeEach(() => {
  started = [];
  cleared = [];
  realSetInterval = globalThis.setInterval;
  realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => {
    const id = realSetInterval(fn, ms);
    started.push(id);
    return id;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
    return realClearInterval(id);
  };
});

afterEach(() => {
  for (const id of started) realClearInterval(id);
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  cleanup();
});

// A page in each dialect, both polling and both reading the same signal.
function hPage(query, count) {
  return function Page() {
    const id = setInterval(() => {}, 1000);
    onCleanup(() => clearInterval(id));
    return h('div', null, () => { count.n++; return query(); });
  };
}

function compiledPage(query, count) {
  return function Page() {
    const el = tmpl();
    insert(el, () => { count.n++; return query(); }, el.firstChild);
    return el;
  };
}

describe('cleanup() disposes what render() mounted', () => {
  it('an h() page stops answering signal writes', () => {
    const query = signal(0);
    const count = { n: 0 };
    render(h(hPage(query, count), null));
    flushSync();

    cleanup();
    count.n = 0;
    query(1);
    flushSync();

    assert.equal(count.n, 0, `expected the page disposed, ${count.n} effect(s) ran`);
  });

  it('a compiled page stops answering signal writes', () => {
    const query = signal(0);
    const count = { n: 0 };
    render(_$createComponent(compiledPage(query, count), null, []));
    flushSync();

    cleanup();
    count.n = 0;
    query(1);
    flushSync();

    assert.equal(count.n, 0, `expected the page disposed, ${count.n} effect(s) ran`);
  });

  it('clears the intervals the page started', () => {
    render(h(hPage(signal(0), { n: 0 }), null));
    flushSync();
    assert.equal(started.length, 1, 'the page should have started one interval');

    cleanup();

    assert.deepEqual(cleared, started, 'every interval the page started must be cleared');
  });

  it('twenty render/cleanup rounds leave nothing behind', () => {
    // The shape behind "passes alone, times out in the suite": each round adds
    // one more live page, so the cost of a signal write grows with the number of
    // tests that ran before it.
    const query = signal(0);
    const count = { n: 0 };
    for (let i = 0; i < 20; i++) {
      render(h(hPage(query, count), null));
      cleanup();
      render(_$createComponent(compiledPage(query, count), null, []));
      cleanup();
    }
    flushSync();

    count.n = 0;
    query(1);
    flushSync();

    assert.equal(count.n, 0, `expected nothing live, ${count.n} effect(s) ran`);
    assert.equal(cleared.length, started.length, 'every interval must be cleared');
  });

  // The last two are controls for the new registry rather than for the bug:
  // both passed before it existed, because unmount() always disposed and
  // cleanup() never did. What they guard now is the opposite failure, a tree
  // disposed twice because it was still in the registry when cleanup() ran.
  it('render().unmount() still works, and a later cleanup() does not double-dispose', () => {
    const query = signal(0);
    const count = { n: 0 };
    const { unmount } = render(h(hPage(query, count), null));
    flushSync();

    unmount();
    cleanup();

    assert.deepEqual(cleared, started, 'the interval is cleared exactly once');
    count.n = 0;
    query(1);
    flushSync();
    assert.equal(count.n, 0);
  });

  it('renderTest().unmount() disposes without cleanup() firing it again', () => {
    const query = signal(0);
    const count = { n: 0 };
    const harness = renderTest(hPage(query, count), {});
    flushSync();

    harness.unmount();

    assert.deepEqual(cleared, started, 'the interval is cleared exactly once');
    count.n = 0;
    query(1);
    flushSync();
    assert.equal(count.n, 0);
  });
});
