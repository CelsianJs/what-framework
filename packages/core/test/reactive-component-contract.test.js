import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { h, mount, signal, flushSync } = await import('../src/index.js');

test('component returns support reactive thunks, arrays, primitives and absent children', () => {
  const container = document.createElement('div');
  const label = signal('first');
  const visible = signal(true);
  let runs = 0;
  function Gate() {
    runs++;
    return () => visible() ? [h('span', null, label()), ' text ', 42, false, undefined] : null;
  }
  const unmount = mount(h(Gate), container);
  try {
    assert.equal(container.textContent, 'first text 42');
    label('second');
    flushSync();
    assert.equal(container.textContent, 'second text 42');
    visible(false);
    flushSync();
    assert.equal(container.textContent, '');
    visible(true);
    flushSync();
    assert.equal(container.textContent, 'second text 42');
    assert.equal(runs, 1, 'reactive returns must not rerun the component body');
  } finally {
    unmount();
  }
});
