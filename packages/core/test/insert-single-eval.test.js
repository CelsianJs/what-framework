// SPRINT v0.11 C3 — insert() must evaluate a function child exactly ONCE at
// mount. The old implementation called child() outside the effect (to choose
// the text fast path) and then AGAIN inside the effect's first run — double
// work, and double side effects: a child that builds DOM created a discarded
// extra tree whose effects stayed registered.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { signal, flushSync } = await import('../src/reactive.js');
const { insert } = await import('../src/render.js');
const { h } = await import('../src/h.js');
const { createDOM } = await import('../src/dom.js');

describe('insert() single evaluation at mount (C3)', () => {
  it('text child: exactly 1 evaluation at mount, updates still work', () => {
    const parent = document.createElement('div');
    const s = signal('a');
    let evals = 0;
    insert(parent, () => { evals++; return s(); });

    assert.equal(evals, 1, `child() evaluated ${evals} times at mount`);
    assert.equal(parent.textContent, 'a');

    s('b');
    flushSync();
    assert.equal(evals, 2);
    assert.equal(parent.textContent, 'b');
  });

  it('DOM-node child: exactly 1 evaluation at mount', () => {
    const parent = document.createElement('div');
    let evals = 0;
    insert(parent, () => {
      evals++;
      const el = document.createElement('span');
      el.textContent = 'x';
      return el;
    });
    assert.equal(evals, 1, `child() evaluated ${evals} times at mount`);
    assert.equal(parent.querySelectorAll('span').length, 1);
  });

  it('component vnode child: component function runs exactly once at mount', () => {
    const parent = document.createElement('div');
    let componentRuns = 0;
    let childEvals = 0;
    function Comp() {
      componentRuns++;
      return createDOM(h('p', {}, 'comp'));
    }
    insert(parent, () => { childEvals++; return h(Comp, {}); });
    assert.equal(childEvals, 1, 'child() must be evaluated once');
    assert.equal(componentRuns, 1, 'component must be constructed once');
    assert.equal(parent.querySelectorAll('p').length, 1);
  });

  it('null child: exactly 1 evaluation, type change to text still reconciles', () => {
    const parent = document.createElement('div');
    const s = signal(null);
    let evals = 0;
    insert(parent, () => { evals++; return s(); });
    assert.equal(evals, 1);

    s('now text');
    flushSync();
    assert.equal(parent.textContent, 'now text');
  });

  it('text → element type change falls back to reconcile and keeps updating', () => {
    const parent = document.createElement('div');
    const s = signal('start');
    insert(parent, () => {
      const v = s();
      if (v === 'el') {
        const el = document.createElement('b');
        el.textContent = 'bold';
        return el;
      }
      return v;
    });
    assert.equal(parent.textContent, 'start');

    s('el');
    flushSync();
    assert.ok(parent.querySelector('b'), 'switched to element');

    s('back to text');
    flushSync();
    assert.equal(parent.querySelector('b'), null);
    assert.equal(parent.textContent, 'back to text');
  });
});
