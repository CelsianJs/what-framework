// onChange across what-react and native What in one tree (jsdom): each side
// calls its own handlers once per edit. A native field's onChange inside a
// React tree, and a native form's onChange over a React field, hear a text
// field's `input` and say nothing at the `change` the field sends when it
// loses focus (dom.js _onChange). The browser covers real keys
// (compiler/test/onchange-real-input.test.js); here the events are a
// script's, as a user's edit dispatches them: `input`, then `change` on blur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

const { h, mount, flushSync } = await import('what-core');
const React = await import('../../react-compat/src/index.js');
const { ReactIsland, native } = await import('../../react-compat/src/mixed.js');
const { createElement: rce, useState } = React;

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { flushSync(); await tick(); await tick(); };
function container() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// The events of typing `text` at the end of `field`, then of leaving it.
async function type(field, text) {
  for (const ch of text) {
    // The prototype's setter: what the browser does, past what-react's tracker.
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, field.value + ch);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
  }
}
async function blur(field) {
  field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await settle();
}

test('a native field\'s onChange inside a React tree: once per edit', async () => {
  const seen = [];
  const Field = () => h('input', { id: 'nativeField', onChange: (e) => seen.push('native ' + e.target.value) });
  function Page() {
    return rce('div', null, rce(native(Field)));
  }
  const el = container();
  mount(h(ReactIsland, { view: () => rce(Page) }), el);
  await settle();
  const field = el.querySelector('#nativeField');
  await type(field, 'ab');
  await blur(field);
  assert.deepEqual(seen, ['native a', 'native ab']);
});

test('a native form\'s onChange over a React field: once per edit, beside the field\'s own', async () => {
  const seen = [];
  function Field() {
    const [value, setValue] = useState('');
    return rce('input', { id: 'reactField', value, onChange: (e) => { seen.push('react ' + e.target.value); setValue(e.target.value); } });
  }
  const el = container();
  mount(h('form', { onChange: (e) => seen.push('form ' + e.target.value) }, h(ReactIsland, { view: () => rce(Field) })), el);
  await settle();
  const field = el.querySelector('#reactField');
  await type(field, 'ab');
  await blur(field);
  assert.deepEqual(seen, ['react a', 'form a', 'react ab', 'form ab']);
  assert.equal(field.value, 'ab');
});
