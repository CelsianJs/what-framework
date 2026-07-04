// Regression: a reactive `() => expr` thunk passed as a COMPONENT child or an
// arbitrary component prop must stay live wherever it lands in a render
// position — not only when it is the direct child of an intrinsic element.
//
// Root cause (fixed): the compiler lowers `<Card><Sib/>{() => x()}</Card>` to
//   _$createComponent(Card, null, [<Sib/>, () => x()])
// so `props.children` is an ARRAY containing the thunk. When the component
// renders `{props.children}` the compiler emits `_$insert(el, props.children)`.
// A plain array child skips insert()'s function/effect branch and goes straight
// to reconcileInsert -> valuesToNodes, which resolved the thunk exactly ONCE
// (value()) with no reactive effect — so it rendered the initial value and
// never updated. A single-thunk child worked only by luck (props.children was
// the thunk itself, hitting insert()'s function branch).
//
// These tests exercise the compiled runtime primitives (_$createComponent +
// insert) exactly as the babel plugin emits them, verified against real
// compiler output.

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

// Mirrors compiled `function C(props){ const el=_tmpl(); insert(el, props.children, marker); return el; }`
function makeChildrenComponent() {
  return function C(props) {
    const el = document.createElement('div');
    const marker = document.createComment('$');
    el.appendChild(marker);
    insert(el, props.children, marker);
    return el;
  };
}

describe('reactive thunk as component child / prop stays live', () => {
  it('(a) thunk as the sole component child updates', () => {
    const app = getContainer();
    const count = signal(0);
    const C = makeChildrenComponent();
    // <C>{() => count()}</C>  ->  _$createComponent(C, null, [() => count()])
    app.appendChild(_$createComponent(C, null, [() => count()]));

    assert.equal(app.textContent, '0');
    count(5);
    flushSync();
    assert.equal(app.textContent, '5');
  });

  it('(b) thunk alongside a sibling child (props.children is an array) updates', () => {
    const app = getContainer();
    const count = signal(0);
    const C = makeChildrenComponent();
    const sib = document.createElement('span');
    sib.textContent = 'x';
    // <C><span>x</span>{() => count()}</C>
    //   -> _$createComponent(C, null, [<span/>, () => count()])
    app.appendChild(_$createComponent(C, null, [sib, () => count()]));

    assert.equal(app.textContent, 'x0');
    count(7);
    flushSync();
    assert.equal(app.textContent, 'x7', 'thunk sibling must re-render on signal change');

    // sibling must be preserved across updates (not orphaned/duplicated)
    assert.equal(app.querySelectorAll('span').length, 1);
  });

  it('(c) thunk as an arbitrary prop rendered into an array position updates', () => {
    const app = getContainer();
    const label = signal('a');
    // component renders both a static sibling and the prop in one insert:
    //   <div>{[props.left, props.right]}</div>
    function Card(props) {
      const el = document.createElement('div');
      const marker = document.createComment('$');
      el.appendChild(marker);
      insert(el, [props.left, props.right], marker);
      return el;
    }
    app.appendChild(_$createComponent(Card, { left: 'L', right: () => label() }, []));

    assert.equal(app.textContent, 'La');
    label('z');
    flushSync();
    assert.equal(app.textContent, 'Lz');
  });

  it('(d) multiple thunks in the children array update independently', () => {
    const app = getContainer();
    const a = signal(1);
    const b = signal(2);
    const C = makeChildrenComponent();
    app.appendChild(_$createComponent(C, null, ['[', () => a(), '|', () => b(), ']']));

    assert.equal(app.textContent, '[1|2]');
    a(9);
    flushSync();
    assert.equal(app.textContent, '[9|2]');
    b(8);
    flushSync();
    assert.equal(app.textContent, '[9|8]');
  });

  it('(e) a thunk returning a component vnode stays reactive in an array position', async () => {
    const app = getContainer();
    const show = signal(true);
    function Inner() {
      const el = document.createElement('em');
      el.textContent = 'inner';
      return el;
    }
    const C = makeChildrenComponent();
    // children array with a sibling forces the array path
    app.appendChild(_$createComponent(C, null, ['pre', () => (show() ? _$createComponent(Inner, null, []) : 'none')]));

    assert.equal(app.querySelectorAll('em').length, 1);
    assert.ok(app.textContent.includes('inner'));
    show(false);
    flushSync();
    assert.equal(app.querySelectorAll('em').length, 0, 'inner component must unmount when thunk flips');
    assert.ok(app.textContent.includes('none'));
    show(true);
    flushSync();
    assert.equal(app.querySelectorAll('em').length, 1, 'inner component must remount when thunk flips back');
  });
});
