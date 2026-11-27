// A React onChange on an element above a field hears React's change events,
// which React makes only for fields it rendered: a field native What code
// rendered inside a React <form> is none of React's (React's change plugin
// takes the nearest React node above the target, the form, and finds no field
// there). Measured on react-dom 19.3.1 in jsdom: a <form onChange> around
// an input, a textarea and a select it did not render fires 0 times for
// typing, a choice and a blur; around an input it rendered, once per
// keystroke and not on the blur.
// Run: node --test packages/react-compat/test/onchange-native-field.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

const { h, mount, flushSync } = await import('what-core');
const React = await import('../src/index.js');
const { ReactIsland, native } = await import('../src/mixed.js');
const { createElement: rce } = React;

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { flushSync(); await tick(); await tick(); };
function container() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// Typing as a browser reports it: an `input` per keystroke, then `change`
// when the field loses focus.
function typeAndBlur(field, text) {
  for (const ch of text) {
    field.value += ch;
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function NativeField(props) {
  return h(props.tag, { 'data-native': '' }, props.tag === 'select' ? [h('option', { value: 'a' }, 'a'), h('option', { value: 'b' }, 'b')] : null);
}

test('a React <form onChange> hears nothing from a text field native code rendered inside it', async () => {
  let fired = 0;
  const el = container();
  mount(h(ReactIsland, { view: () => rce('form', { onChange: () => { fired++; } }, rce(native(NativeField), { tag: 'input' })) }), el);
  await settle();
  typeAndBlur(el.querySelector('[data-native]'), 'abc');
  assert.equal(fired, 0);
});

test('a React <form onChange> hears nothing from a textarea or a select native code rendered inside it', async () => {
  let fired = 0;
  const el = container();
  mount(h(ReactIsland, {
    view: () => rce('form', { onChange: () => { fired++; } },
      rce(native(NativeField), { tag: 'textarea' }),
      rce(native(NativeField), { tag: 'select' })),
  }), el);
  await settle();
  typeAndBlur(el.querySelector('textarea'), 'xy');
  const select = el.querySelector('select');
  select.value = 'b';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(fired, 0);
});

test('the same form hears its own React fields once per edit, a blur adding nothing', async () => {
  const seen = [];
  const el = container();
  mount(h(ReactIsland, {
    view: () => rce('form', { onChange: (e) => seen.push(e.target.tagName) },
      rce('input', { 'data-react': '' }),
      rce('select', { defaultValue: 'a' }, rce('option', { value: 'a' }, 'a'), rce('option', { value: 'b' }, 'b')),
      rce(native(NativeField), { tag: 'input' })),
  }), el);
  await settle();
  typeAndBlur(el.querySelector('[data-react]'), 'abc');
  const select = el.querySelector('select');
  select.value = 'b';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  typeAndBlur(el.querySelector('[data-native]'), 'zz');
  assert.deepEqual(seen, ['INPUT', 'INPUT', 'INPUT', 'SELECT']);
});
