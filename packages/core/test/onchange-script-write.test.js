// A text field a script writes while it keeps the focus (a chat box cleared
// on Enter) hears the user's next edit, even one that types what it held
// before the write, as React's does. What's own writes of a controlled field
// do not count as a script's.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

// What the user typing does: the browser's own setter, then `input`.
function type(el, value) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('onChange after a script wrote the field', () => {
  it('an uncontrolled field cleared by a script hears the same text typed again', () => {
    const { h, mount, flushSync } = W;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const heard = [];
    const stop = mount(h('input', { onChange: (e) => heard.push(e.target.value) }), host);
    flushSync();
    const field = host.querySelector('input');
    type(field, 'h');
    field.value = '';
    type(field, 'h');
    assert.deepEqual(heard, ['h', 'h']);
    stop();
    host.remove();
  });

  it('a textarea alike', () => {
    const { h, mount, flushSync } = W;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const heard = [];
    const stop = mount(h('textarea', { onChange: (e) => heard.push(e.target.value) }), host);
    flushSync();
    const field = host.querySelector('textarea');
    type(field, 'hi');
    field.value = '';
    type(field, 'hi');
    assert.deepEqual(heard, ['hi', 'hi']);
    stop();
    host.remove();
  });

  it('an input that changed nothing after the user\'s edit and a controlled write is still no edit', () => {
    const { h, mount, flushSync, signal } = W;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const text = signal('a');
    const heard = [];
    const stop = mount(h('input', { value: text, onChange: (e) => { heard.push(e.target.value); text(e.target.value.toUpperCase()); } }), host);
    flushSync();
    const field = host.querySelector('input');
    type(field, 'ab');
    flushSync();
    assert.equal(field.value, 'AB');
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.deepEqual(heard, ['ab'], 'the value What wrote is what onChange saw');
    stop();
    host.remove();
  });
});
