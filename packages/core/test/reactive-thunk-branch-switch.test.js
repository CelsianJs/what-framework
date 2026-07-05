// Regression: a reactive `() => cond ? <Comp/> : <div/>` thunk that is the
// DIRECT child of an intrinsic element must fully remove the previous branch
// on every switch — including when the previous branch was a bare component.
//
// Root cause (fixed): components realize to a DocumentFragment
// `[<!--c:start-->, ...content, <!--c:end-->]`. The single-node "replace" fast
// path in reconcileInsert treated that fragment `value` as one node and called
// `parent.replaceChild(fragment, current)`. replaceChild EMPTIES the fragment
// (its children move into the DOM), so the value returned as the new `current`
// was the now-empty fragment — it no longer referenced the real inserted nodes.
// The next switch away therefore could not find or remove those nodes, and each
// return to the component branch APPENDED another copy. In the dashboard this
// stacked 4 empty-states.
//
// Branches returning a single intrinsic element swap cleanly (real replaceChild
// on a real node), which is exactly the asymmetry this test pins down. The 0.11.3
// thunk-array fix (valuesToNodes flattening) did NOT cover this direct-child
// single-value path — it only hits arrays.
//
// These tests exercise the compiled runtime primitives (insert + _$createComponent)
// exactly as the babel plugin emits `insert(el, () => cond() ? <Comp/> : <div/>, marker)`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { signal, flushSync } = await import('../src/reactive.js');
const { insert, _$createComponent } = await import('../src/render.js');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// Bare component: realizes to a fragment [c:start, <div class="empty">, c:end].
function EmptyState() {
  const el = document.createElement('div');
  el.className = 'empty';
  el.textContent = 'Nothing here';
  return el;
}

describe('reactive thunk branch switch: bare component <-> intrinsic element', () => {
  it('does not accumulate component fragments when toggling away and back', () => {
    const app = getContainer();
    const show = signal(true);
    const marker = document.createComment('$');
    app.appendChild(marker);

    // compiled: insert(app, () => show() ? <EmptyState/> : <div class="list"/>, marker)
    insert(app, () => {
      if (show()) return _$createComponent(EmptyState, null, []);
      const el = document.createElement('div');
      el.className = 'list';
      el.textContent = 'list';
      return el;
    }, marker);

    assert.equal(app.querySelectorAll('div.empty').length, 1);
    assert.equal(app.querySelectorAll('div.list').length, 0);

    show(false); flushSync();
    assert.equal(app.querySelectorAll('div.empty').length, 0, 'component removed on switch to intrinsic');
    assert.equal(app.querySelectorAll('div.list').length, 1);

    show(true); flushSync();
    assert.equal(app.querySelectorAll('div.empty').length, 1, 'exactly one empty-state after first return');
    assert.equal(app.querySelectorAll('div.list').length, 0);

    // Repeat several cycles — copies must NOT stack.
    show(false); flushSync();
    assert.equal(app.querySelectorAll('div.empty').length, 0, 'no orphaned component after 2nd switch away');
    show(true); flushSync();
    show(false); flushSync();
    show(true); flushSync();
    assert.equal(app.querySelectorAll('div.empty').length, 1, 'no stacking after repeated toggles');
    assert.equal(app.querySelectorAll('div.list').length, 0);
  });

  it('bare component <-> bare component: no fragment stacking', () => {
    const app = getContainer();
    const show = signal(true);
    const marker = document.createComment('$');
    app.appendChild(marker);

    function A() { const el = document.createElement('div'); el.className = 'a'; return el; }
    function B() { const el = document.createElement('div'); el.className = 'b'; return el; }

    insert(app, () => (show() ? _$createComponent(A, null, []) : _$createComponent(B, null, [])), marker);

    assert.equal(app.querySelectorAll('div.a').length, 1);
    assert.equal(app.querySelectorAll('div.b').length, 0);

    for (let i = 0; i < 4; i++) {
      show(false); flushSync();
      assert.equal(app.querySelectorAll('div.a').length, 0, `A removed on cycle ${i}`);
      assert.equal(app.querySelectorAll('div.b').length, 1, `exactly one B on cycle ${i}`);
      show(true); flushSync();
      assert.equal(app.querySelectorAll('div.b').length, 0, `B removed on cycle ${i}`);
      assert.equal(app.querySelectorAll('div.a').length, 1, `exactly one A on cycle ${i}`);
    }
  });

  it('bare component <-> null: component fully removed', () => {
    const app = getContainer();
    const show = signal(true);
    const marker = document.createComment('$');
    app.appendChild(marker);

    insert(app, () => (show() ? _$createComponent(EmptyState, null, []) : null), marker);

    assert.equal(app.querySelectorAll('div.empty').length, 1);
    for (let i = 0; i < 3; i++) {
      show(false); flushSync();
      assert.equal(app.querySelectorAll('div.empty').length, 0, `empty removed on cycle ${i}`);
      show(true); flushSync();
      assert.equal(app.querySelectorAll('div.empty').length, 1, `exactly one empty on cycle ${i}`);
    }
  });
});
