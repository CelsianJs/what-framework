// A file input holds only the files the user picked: a `value` prop is never
// written to it, since the platform throws for any value but '' (an
// InvalidStateError). A registered file input whose field already holds
// files (a wizard step visited again, a draft restored) mounted with that
// value and the write threw, so the component failed to render.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { signal, flushSync } = await import('../src/reactive.js');
const { useForm } = await import('../src/form.js');

function render(view) {
  const root = document.getElementById('app');
  root.textContent = '';
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  try {
    mount(h(view), root);
    flushSync();
  } finally {
    console.error = original;
  }
  return { input: root.querySelector('input[type=file]'), errors };
}

describe('the value of a file input', () => {
  it('a registered file input whose field holds files mounts', () => {
    const photo = new File(['abc'], 'license.png');
    const form = useForm({ defaultValues: { license: [photo] } });
    const { input, errors } = render(() => h('input', { type: 'file', ...form.register('license') }));
    assert.deepEqual(errors, []);
    assert.ok(input, 'the input rendered');
    assert.equal(input.value, '');
  });

  it('a file input given a path string mounts and shows no value', () => {
    const { input, errors } = render(() => h('input', { type: 'file', value: 'C:\\fakepath\\license.png' }));
    assert.deepEqual(errors, []);
    assert.ok(input, 'the input rendered');
  });

  it('a live value that becomes files writes nothing, and becoming empty clears the input', () => {
    const value = signal('');
    const { input, errors } = render(() => h('input', { type: 'file', value: () => value() }));
    assert.deepEqual(errors, []);
    // The user picks a file: the input reports its fake path until cleared.
    const writes = [];
    let picked = 'C:\\fakepath\\a.png';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return picked; },
      set(v) {
        writes.push(v);
        if (v !== '') throw new DOMException('only the empty string', 'InvalidStateError');
        picked = '';
      },
    });
    value([new File(['a'], 'a.png')]);
    flushSync();
    assert.deepEqual(writes, [], 'nothing written for files');
    value('');
    flushSync();
    assert.deepEqual(writes, [''], 'an empty value clears the input');
  });
});
