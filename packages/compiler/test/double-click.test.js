// React's `onDoubleClick` listens for the DOM's `dblclick` in every path that
// binds an event prop: compiled JSX, its capture-phase name, a spread and h().

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { h, mount, flushSync } = await import('../../core/src/index.js');

function shown(Component) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const stop = mount(h(Component, {}), el);
  flushSync();
  return { el, done() { stop(); el.remove(); } };
}

const doubleClick = (target) => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

describe('onDoubleClick', () => {
  it('fires on a dblclick in compiled JSX, as onDblClick does', async () => {
    const mod = await loadCompiled(`
      export const log = [];
      export function App() {
        return <p>
          <label onDoubleClick={() => log.push('onDoubleClick')}>edit</label>
          <span onDblClick={() => log.push('onDblClick')}>edit</span>
        </p>;
      }`);
    const { el, done } = shown(mod.App);
    doubleClick(el.querySelector('label'));
    doubleClick(el.querySelector('span'));
    assert.deepEqual(mod.log, ['onDoubleClick', 'onDblClick']);
    done();
  });

  it('runs onDoubleClickCapture before the bubble-phase handler below it', async () => {
    const mod = await loadCompiled(`
      export const log = [];
      export function App() {
        return <div onDoubleClickCapture={() => log.push('capture')}>
          <button onDoubleClick={() => log.push('button')}>go</button>
        </div>;
      }`);
    const { el, done } = shown(mod.App);
    doubleClick(el.querySelector('button'));
    assert.deepEqual(mod.log, ['capture', 'button']);
    done();
  });

  it('fires through a spread', async () => {
    const mod = await loadCompiled(`
      export const log = [];
      const handlers = { onDoubleClick: () => log.push('spread') };
      export function App() {
        return <li {...handlers}>row</li>;
      }`);
    const { el, done } = shown(mod.App);
    doubleClick(el.querySelector('li'));
    assert.deepEqual(mod.log, ['spread']);
    done();
  });

  it('fires on an h() element', () => {
    const log = [];
    const { el, done } = shown(() => h('td', { onDoubleClick: () => log.push('h') }, 'cell'));
    doubleClick(el.querySelector('td'));
    assert.deepEqual(log, ['h']);
    done();
  });
});
