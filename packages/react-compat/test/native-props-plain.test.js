// A native component inside React gets its props as a plain object, as
// React's are (what-core dom.js _markProps): `props.hasOwnProperty(k)`,
// `String(props)` and lodash's isPlainObject take them. They stay live: the
// next React render writes them, and a rest element or a spread of them
// keeps following it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

const { h, flushSync } = await import('what-core');
const { _$omit, _$spread, _$merge } = await import('what-core/render');
const React = await import('../src/index.js');
const { createRoot } = await import('../src/dom.js');
const { native } = await import('../src/mixed.js');
const { createElement: rce, useState, act } = React;

const settle = async () => { flushSync(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

test('a native component inside React: plain-object props that stay live', async () => {
  let seen = null;
  let rest = null;
  const Native = (props) => {
    seen = props;
    rest = _$omit(props, ['label']);
    const b = h('b', { class: 'n' }, () => props.label);
    return h('span', null, b, h('i', { ref: (el) => { if (el) _$spread(el, rest); } }));
  };
  let bump;
  function Parent() {
    const [c, setC] = useState(0);
    bump = () => setC(c + 1);
    return rce(native(Native), { label: `c${c}`, title: `t${c}` });
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(rce(Parent)));
  await settle();
  assert.equal(Object.getPrototypeOf(seen), Object.prototype);
  assert.equal(seen.hasOwnProperty('label'), true); // eslint-disable-line no-prototype-builtins
  assert.equal(seen.hasOwnProperty('nope'), false); // eslint-disable-line no-prototype-builtins
  assert.equal(String(seen), '[object Object]');
  assert.equal(seen.constructor, Object);
  assert.deepEqual(Object.keys(seen).sort(), ['label', 'title']);
  assert.equal(Object.getPrototypeOf(rest), Object.prototype);
  assert.equal(el.querySelector('.n').textContent, 'c0');
  assert.equal(el.querySelector('i').getAttribute('title'), 't0');
  act(() => bump());
  await settle();
  assert.equal(el.querySelector('.n').textContent, 'c1');
  assert.equal(rest.title, 't1', 'the rest element follows the next render');
  assert.equal(el.querySelector('i').getAttribute('title'), 't1', 'and so does its spread');
});

test('a native component\'s props are marked as what-core\'s, so a forward of them follows the next React render', async () => {
  const MARK = Symbol.for('what-core.props.v1');
  let seen = null;
  let inner = null;
  const Inner = (props) => {
    inner = props;
    return h('b', { class: 'fw' }, () => `${props.label}/${props.extra}`);
  };
  const Native = (props) => {
    seen = props;
    return h(Inner, _$merge(props, { extra: 'e' }));
  };
  let bump;
  function Parent() {
    const [c, setC] = useState(0);
    bump = () => setC(c + 1);
    return rce(native(Native), { label: `c${c}` });
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(rce(Parent)));
  await settle();
  assert.equal(Object.getOwnPropertySymbols(seen).includes(MARK), true);
  assert.equal(Object.getOwnPropertySymbols(inner).includes(MARK), true, 'the forward kept a getter');
  assert.equal(el.querySelector('.fw').textContent, 'c0/e');
  act(() => bump());
  await settle();
  assert.equal(el.querySelector('.fw').textContent, 'c1/e');
});
