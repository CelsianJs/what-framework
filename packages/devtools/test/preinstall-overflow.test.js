import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { signal, effect, h, mount, createRoot } = await import('what-framework');
const core = await import('what-core/internal');
const { getState, installDevTools } = await import('../src/index.js');

test('late installation exposes the cap and the number of missed creations', () => {
  core.__drainPreinstallBuffer();
  const signals = [];
  const root = document.createElement('div');
  function Row() { return h('p', {}, 'row'); }
  const disposeRows = mount(Array.from({ length: 2003 }, () => h(Row, {})), root);
  const disposeEffects = createRoot((dispose) => {
    for (let i = 0; i < 2003; i++) {
      signals.push(signal(i));
      effect(() => signals[i]());
    }
    return dispose;
  });
  try {
    installDevTools(core);
    const state = getState();
    assert.equal(state.signals.length, 2000);
    assert.equal(state.effects.length, 2000);
    assert.equal(state.components.length, 2000);
    assert.deepEqual(state.droppedBeforeInstall, { signals: 3, effects: 3, components: 3 });
  } finally {
    disposeRows();
    disposeEffects();
  }
});
