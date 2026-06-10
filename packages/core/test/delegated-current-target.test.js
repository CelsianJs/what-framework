// SPRINT v0.11 C9 — e.currentTarget shim in the delegated event walk.
// Document-level delegation walks event.target upward looking for $$event
// handlers. Without a shim, handlers see e.currentTarget === document (the
// real listener), breaking the `self` event modifier and any handler relying
// on the standard "element the listener is attached to" semantics.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { delegateEvents } = await import('../src/render.js');

describe('delegated e.currentTarget shim (C9)', () => {
  it('each handler in the walk sees ITS element as currentTarget', () => {
    delegateEvents(['click']);

    const outer = document.createElement('div');
    const button = document.createElement('button');
    outer.appendChild(button);
    document.body.appendChild(outer);

    let buttonCT = null;
    let outerCT = null;
    button.$$click = (e) => { buttonCT = e.currentTarget; };
    outer.$$click = (e) => { outerCT = e.currentTarget; };

    button.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    assert.strictEqual(buttonCT, button, 'button handler must see the button');
    assert.strictEqual(outerCT, outer, 'ancestor handler must see the ancestor');
    outer.remove();
  });

  it('e.target stays the original click target during the walk', () => {
    const outer = document.createElement('div');
    const button = document.createElement('button');
    outer.appendChild(button);
    document.body.appendChild(outer);

    let seenTarget = null;
    outer.$$click = (e) => { seenTarget = e.target; };
    button.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    assert.strictEqual(seenTarget, button);
    outer.remove();
  });

  it('the `self` modifier semantics work: target === currentTarget only on the source', () => {
    const outer = document.createElement('div');
    const button = document.createElement('button');
    outer.appendChild(button);
    document.body.appendChild(outer);

    const results = [];
    // Mirrors the compiler's __self wrapper: only fire when target === currentTarget
    button.$$click = (e) => { if (e.target === e.currentTarget) results.push('button'); };
    outer.$$click = (e) => { if (e.target === e.currentTarget) results.push('outer'); };

    button.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.deepEqual(results, ['button'],
      'self-gated ancestor handler must NOT fire for a descendant click');
    outer.remove();
  });

  it('stopPropagation (cancelBubble) still halts the walk', () => {
    const outer = document.createElement('div');
    const button = document.createElement('button');
    outer.appendChild(button);
    document.body.appendChild(outer);

    const calls = [];
    button.$$click = (e) => { calls.push('button'); e.stopPropagation(); };
    outer.$$click = () => { calls.push('outer'); };

    button.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.deepEqual(calls, ['button']);
    outer.remove();
  });
});
