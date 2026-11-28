// class and classList on the client: a function entry in classList is a
// reactive accessor on every path (compiled, h(), setProp, spread), and class
// and classList compose in prop order under updates. Before, function entries
// were read once, untracked, and a reactive class wiped the classes classList
// had applied. The server comparison lives in
// packages/server/test/ssr-classlist.test.js.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { signal, flushSync, mount, h } = await import('what-framework');
const { setProp, spread, setClass, setClassList, classList } = await import('../src/render.js');
const { __subsOf, createRoot } = await import('../src/reactive.js');

let host;
beforeEach(() => {
  host = document.getElementById('app');
  host.textContent = '';
});

const compiled = await loadCompiled(`
  export const Entry = (p) => <div classList={{ on: () => p.active() }} />;
  export const ClassThenList = (p) => <div class={p.variant()} classList={{ on: p.active() }} />;
  export const ListThenClass = (p) => <div classList={{ on: p.active() }} class={p.variant()} />;
`);

// Each path returns the element and the disposer of the owner it was built
// under: a binding stops when that owner is disposed.
function owned(build) {
  return createRoot((dispose) => [build(), dispose]);
}

describe('classList function entries are reactive on every path', () => {
  const paths = {
    compiled: (active) => { const unmount = mount(() => compiled.Entry({ active }), host); return [host.firstElementChild, unmount]; },
    'h()': (active) => { const unmount = mount(h('div', { classList: { on: () => active() } }), host); return [host.firstElementChild, unmount]; },
    setProp: (active) => owned(() => { const el = host.appendChild(document.createElement('div')); setProp(el, 'classList', { on: () => active() }); return el; }),
    spread: (active) => owned(() => { const el = host.appendChild(document.createElement('div')); spread(el, { classList: { on: () => active() } }); return el; }),
  };
  for (const [name, make] of Object.entries(paths)) {
    it(name, () => {
      const active = signal(false);
      const [el, dispose] = make(active);
      assert.equal(el.className, '');
      active(true);
      flushSync();
      assert.equal(el.className, 'on');
      active(false);
      flushSync();
      assert.equal(el.className, '');
      dispose();
      assert.equal(__subsOf(active).length, 0, 'the entry stops with its owner');
    });
  }
});

describe('class and classList compose in prop order', () => {
  it('a classList after a reactive class keeps its classes when class changes', () => {
    const variant = signal('btn');
    const active = signal(true);
    mount(() => compiled.ClassThenList({ variant, active }), host);
    const el = host.firstElementChild;
    assert.equal(el.className, 'btn on');
    variant('btn big');
    flushSync();
    assert.equal(el.className, 'btn big on');
    active(false);
    flushSync();
    assert.equal(el.className, 'btn big');
    variant('on');
    flushSync();
    assert.equal(el.className, '', 'a class the classList turns off stays off');
  });

  it('a class after the classList replaces it, then and on later writes', () => {
    const variant = signal('btn');
    const active = signal(true);
    mount(() => compiled.ListThenClass({ variant, active }), host);
    const el = host.firstElementChild;
    assert.equal(el.className, 'btn');
    active(false);
    flushSync();
    active(true);
    flushSync();
    assert.equal(el.className, 'btn');
    variant('big');
    flushSync();
    assert.equal(el.className, 'big');
  });

  it('a key that leaves the classList falls back to the class attribute', () => {
    const which = signal(true);
    const el = host.appendChild(document.createElement('div'));
    setProp(el, 'class', 'base a');
    setClassList(el, () => (which() ? { a: false, b: true } : { c: true }));
    assert.deepEqual([...el.classList].sort(), ['b', 'base']);
    which(false);
    flushSync();
    assert.deepEqual([...el.classList].sort(), ['a', 'base', 'c']);
  });

  it('composes on SVG elements', () => {
    const variant = signal('x');
    const svg = host.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    setClass(svg, () => variant());
    setClassList(svg, { on: true });
    variant('y');
    flushSync();
    assert.equal(svg.getAttribute('class'), 'y on');
  });

  it('classList() is setClassList for hand-written code', () => {
    const active = signal(false);
    const [el, dispose] = owned(() => {
      const div = host.appendChild(document.createElement('div'));
      classList(div, { 'a b': () => active(), c: true });
      return div;
    });
    assert.equal(el.className, 'c');
    active(true);
    flushSync();
    assert.deepEqual([...el.classList].sort(), ['a', 'b', 'c']);
    dispose();
    assert.equal(__subsOf(active).length, 0);
  });
});
