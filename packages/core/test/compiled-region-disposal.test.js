// Compiled reactive child regions must die when their DOM does.
//
// insert() is the compiler's emit target for every `{() => ...}` hole, and it
// dropped the disposer that effect() returns. Nothing could reach the effect
// afterwards, so it kept running forever: 50 toggles of a conditional left 50
// stranded effects behind the live one, and every subsequent signal write ran
// all 51. The h() path never had the bug, because createDOM hangs its disposer
// on the comment markers it creates, which is exactly what disposeTree looks
// for. So the leak was invisible to anyone testing with h() and certain for
// anyone on the recommended build setup.
//
// The counts here are the whole point. A region that has leaked still RENDERS
// correctly (the stranded effects write the same values into detached nodes),
// so an assertion about markup passes either way. Execution count is the only
// thing that separates one live region from fifty-one.
//
// The shapes are hand-written copies of what the compiler emits for
// `{() => cond() && <span>{() => sig()}</span>}`, the ternary form, and a keyed
// list. Written out rather than compiled so this file pins the RUNTIME contract:
// insert() must dispose whatever it created, whoever called it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { signal, effect, flushSync } = await import('../src/reactive.js');
const { _$template, insert, _$createComponent, mapArray } = await import('../src/render.js');
const { mount } = await import('../src/dom.js');

const tmplDiv = _$template('<div><!--$--></div>');
const tmplSpan = _$template('<span><!--$--></span>');
const tmplLi = _$template('<li><!--$--></li>');

function container() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// `<span>{() => sig()}</span>` as the compiler builds it, counting evaluations.
function span(sig, count) {
  const el = tmplSpan();
  insert(el, () => { count.n++; return sig(); }, el.firstChild);
  return el;
}

function toggle(cond, times) {
  for (let i = 0; i < times; i++) {
    cond(false);
    flushSync();
    cond(true);
    flushSync();
  }
}

describe('compiled reactive regions are disposed with their DOM', () => {
  it('`{() => cond() && <span/>}` leaves exactly one live inner region after 50 toggles', () => {
    const cond = signal(true);
    const sig = signal(0);
    const count = { n: 0 };
    const el = tmplDiv();
    insert(el, () => cond() && span(sig, count), el.firstChild);
    container().appendChild(el);
    flushSync();

    toggle(cond, 50);
    count.n = 0;
    sig(1);
    flushSync();

    assert.equal(count.n, 1, `expected 1 live inner region, ${count.n} ran`);
  });

  it('the ternary form leaves exactly one live inner region after 20 toggles', () => {
    const cond = signal(true);
    const sig = signal(0);
    const count = { n: 0 };
    const el = tmplDiv();
    insert(el, () => (cond() ? span(sig, count) : null), el.firstChild);
    container().appendChild(el);
    flushSync();

    toggle(cond, 20);
    count.n = 0;
    sig(1);
    flushSync();

    assert.equal(count.n, 1, `expected 1 live inner region, ${count.n} ran`);
  });

  it('a region with no marker of its own is disposed through its parent', () => {
    // insert(parent, child) with no marker appends at the end of the parent, so
    // the parent is the only stable anchor the region has. what-server's island
    // runtime calls insert this way.
    const cond = signal(true);
    const sig = signal(0);
    const count = { n: 0 };
    const el = tmplDiv();
    insert(el, () => {
      if (!cond()) return null;
      const inner = document.createElement('span');
      insert(inner, () => { count.n++; return sig(); });
      return inner;
    }, el.firstChild);
    container().appendChild(el);
    flushSync();

    toggle(cond, 20);
    count.n = 0;
    sig(1);
    flushSync();

    assert.equal(count.n, 1, `expected 1 live inner region, ${count.n} ran`);
  });

  it('mount()\'s disposer stops a compiled region', () => {
    const sig = signal(0);
    const count = { n: 0 };
    const dispose = mount(_$createComponent(function App() {
      const el = tmplDiv();
      insert(el, () => { count.n++; return sig(); }, el.firstChild);
      return el;
    }, null, []), container());
    flushSync();

    dispose();
    count.n = 0;
    sig(1);
    flushSync();

    assert.equal(count.n, 0, `expected the region to be dead, it ran ${count.n} time(s)`);
  });

  it('a compiled keyed list stops diffing once the branch holding it is switched off', () => {
    // The list inserter has its own effect, and insert() returns early for it,
    // so it leaked by the same route: the list kept reconciling an invisible
    // array and kept every row's own region alive.
    const cond = signal(true);
    const items = signal([1, 2, 3]);
    const cell = signal(0);
    let listRuns = 0;
    let rowRuns = 0;

    const el = tmplDiv();
    insert(el, () => (cond() ? (() => {
      const wrap = tmplDiv();
      insert(wrap, mapArray(() => { listRuns++; return items(); }, (n) => {
        const li = tmplLi();
        insert(li, () => { rowRuns++; return n + cell(); }, li.firstChild);
        return li;
      }, { key: (n) => n, raw: true }), wrap.firstChild);
      return wrap;
    })() : null), el.firstChild);
    container().appendChild(el);
    flushSync();

    toggle(cond, 20);

    listRuns = 0;
    items([1, 2, 3, 4]);
    flushSync();
    assert.equal(listRuns, 1, `expected 1 live list, ${listRuns} reconciled`);

    rowRuns = 0;
    cell(1);
    flushSync();
    assert.equal(rowRuns, 4, `expected 4 live rows, ${rowRuns} ran`);
  });

  it('a removed list disposes its rows\' item scopes', () => {
    // A row's effects live in a per-item scope that only a RECONCILE released,
    // and a list removed whole never reconciles again. Deliberately not a
    // component and not an insert() region: both of those are anchored on their
    // own DOM node and were already reachable, so only a scope-registered effect
    // shows whether the list itself was disposed.
    const cond = signal(true);
    const cell = signal(0);
    let runs = 0;

    const el = tmplDiv();
    insert(el, () => (cond() ? (() => {
      const wrap = tmplDiv();
      insert(wrap, mapArray(() => [1, 2, 3], (n) => {
        effect(() => { void cell(); runs++; });
        const li = tmplLi();
        li.firstChild.textContent = String(n);
        return li;
      }, { key: (n) => n, raw: true }), wrap.firstChild);
      return wrap;
    })() : null), el.firstChild);
    container().appendChild(el);
    flushSync();

    cond(false);
    flushSync();

    runs = 0;
    cell(1);
    flushSync();
    assert.equal(runs, 0, `expected every row scope disposed, ${runs} effect(s) still ran`);
  });

});
