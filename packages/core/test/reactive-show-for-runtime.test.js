// Regression: the RUNTIME <Show> / <For> components must be reactive.
//
// Two JSX pipelines reach these built-ins:
//   1. The fine-grained babel plugin lowers <Show> -> a reactive `() => ...`
//      thunk and <For> -> `_$mapArray(...)`. That path is already reactive and
//      is covered by packages/compiler/test.
//   2. The automatic JSX runtime (`jsxImportSource: "what-framework"`, the
//      standard Vite/esbuild/tsc setup) — and any direct `h()` / manual
//      `_$createComponent()` call — turns `<Show .../>` into
//      `_$createComponent(Show, props)`, which invokes the Show()/For()
//      component FUNCTIONS in packages/core/src/components.js.
//
// Those functions used to read their reactive prop (`when()` / `each()`)
// eagerly inside the run-once component body and return STATIC content, so the
// content rendered once and never updated after the signal changed. (This is
// the trap a fresh 0.11.5 app hit: `<Show when={() => authed()}>` never
// advanced.) PR #18 fixed a *different* bug — user-written thunks in a
// component's array child position — and did not touch Show/For, which never
// emit a thunk into a child position.
//
// These tests drive the runtime path exactly as the automatic JSX runtime
// emits it (`_$createComponent(Show|For, props)`), mounted the same way a
// compiled component-root reactive value is mounted (via createDOM into a
// live parent). They FAIL before the fix and pass after.

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
const { h } = await import('../src/h.js');
const { _$createComponent } = await import('../src/render.js');
const { Show, For } = await import('../src/components.js');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// Mount a component vnode into a live parent, mirroring how a component at the
// root of the tree gets realized. _$createComponent returns a DocumentFragment
// (c:start, content, c:end); appending it moves the content into `app`.
function mountInto(app, vnode) {
  app.appendChild(vnode);
}

describe('runtime <Show> stays reactive (automatic JSX runtime / h path)', () => {
  it('(1) <Show when={() => sig()}> flips content when the signal changes', () => {
    const app = getContainer();
    const authed = signal(false);

    // <Show when={() => authed()} fallback={<span>out</span>}><span>in</span></Show>
    //   -> _$createComponent(Show, { when: () => authed(), fallback }, [<span>in</span>])
    mountInto(app, _$createComponent(
      Show,
      { when: () => authed(), fallback: h('span', { class: 'out' }, 'out') },
      [h('span', { class: 'in' }, 'in')],
    ));

    assert.equal(app.querySelector('.in'), null, 'starts hidden');
    assert.ok(app.querySelector('.out'), 'shows fallback initially');

    authed(true);
    flushSync();
    assert.ok(app.querySelector('.in'), '<Show> must advance to children when when() flips true');
    assert.equal(app.querySelector('.out'), null, 'fallback removed once shown');

    authed(false);
    flushSync();
    assert.equal(app.querySelector('.in'), null, '<Show> must hide children when when() flips back');
    assert.ok(app.querySelector('.out'), 'fallback returns');
  });

  it('(2) <Show> also reacts when `when` is passed a bare signal accessor', () => {
    const app = getContainer();
    const open = signal(false);

    // when={open} — the signal getter itself is a function, read reactively.
    mountInto(app, _$createComponent(Show, { when: open }, [h('b', null, 'body')]));

    assert.equal(app.querySelector('b'), null);
    open(true);
    flushSync();
    assert.ok(app.querySelector('b'), '<Show when={signal}> must react to the signal');
  });
});

describe('runtime <For> re-renders on list change (automatic JSX runtime / h path)', () => {
  it('(3) <For each={() => items()}> re-renders when the list changes', () => {
    const app = getContainer();
    const items = signal(['Apple', 'Banana']);

    // <For each={() => items()}>{(item) => <li>{item}</li>}</For>
    mountInto(app, _$createComponent(
      For,
      { each: () => items() },
      [(item) => h('li', null, item)],
    ));

    assert.equal(app.querySelectorAll('li').length, 2, 'initial list rendered');
    assert.ok(app.textContent.includes('Apple'));
    assert.ok(app.textContent.includes('Banana'));

    items(['Apple', 'Banana', 'Cherry']);
    flushSync();
    assert.equal(app.querySelectorAll('li').length, 3, '<For> must re-render when items grow');
    assert.ok(app.textContent.includes('Cherry'));

    items(['Only']);
    flushSync();
    assert.equal(app.querySelectorAll('li').length, 1, '<For> must re-render when items shrink');
    assert.ok(app.textContent.includes('Only'));
    assert.ok(!app.textContent.includes('Apple'));
  });

  it('(4) <For> renders the fallback when the list is empty, then reacts', () => {
    const app = getContainer();
    const items = signal([]);

    mountInto(app, _$createComponent(
      For,
      { each: () => items(), fallback: h('p', { class: 'empty' }, 'nothing') },
      [(item) => h('li', null, item)],
    ));

    assert.ok(app.querySelector('.empty'), 'empty list shows fallback');
    assert.equal(app.querySelectorAll('li').length, 0);

    items(['one', 'two']);
    flushSync();
    assert.equal(app.querySelectorAll('li').length, 2, '<For> must render items when list fills');
    assert.equal(app.querySelector('.empty'), null, 'fallback removed once non-empty');
  });
});

describe('a plain runtime component receiving a reactive thunk child updates', () => {
  it('(5) thunk passed as a component child stays live', () => {
    const app = getContainer();
    const count = signal(0);

    // A plain component that renders its children.
    function Card({ children }) {
      return h('div', { class: 'card' }, children);
    }

    mountInto(app, _$createComponent(Card, null, [() => `count: ${count()}`]));

    assert.ok(app.textContent.includes('count: 0'));
    count(5);
    flushSync();
    assert.ok(app.textContent.includes('count: 5'), 'thunk child must update the plain component');
  });
});
