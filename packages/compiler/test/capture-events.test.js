// React's capture-phase handler names in compiled JSX: `onClickCapture`
// listens for `click` in the capture phase, as h() and spreads already did
// (what-core dom.js). The compiler used to lower it to a listener for an
// event named `clickcapture`, which never fires. `onGotPointerCapture` and
// `onLostPointerCapture` are events of their own.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { h, mount, flushSync } = await import('../../core/src/index.js');

async function mounted(source) {
  const mod = await loadCompiled(source);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const stop = mount(h(mod.App, {}), el);
  flushSync();
  return { mod, el, stop };
}

describe('compiled capture-phase handlers', () => {
  it('runs onClickCapture before the bubble-phase handlers below it', async () => {
    const { mod, el, stop } = await mounted(`
      export const log = [];
      export function App() {
        return <div onClickCapture={() => log.push('outer capture')} onClick={() => log.push('outer bubble')}>
          <button onClick={() => log.push('button')} onClickCapture={() => log.push('button capture')}>go</button>
        </div>;
      }`);
    el.querySelector('button').click();
    assert.deepEqual(mod.log, ['outer capture', 'button capture', 'button', 'outer bubble']);
    stop();
    el.remove();
  });

  it('keeps a modifier and the capture phase together', async () => {
    const { mod, el, stop } = await mounted(`
      export const log = [];
      export function App() {
        return <div onClickCapture__once={() => log.push('outer')}><b onClick={() => log.push('b')}>x</b></div>;
      }`);
    const b = el.querySelector('b');
    b.click();
    b.click();
    assert.deepEqual(mod.log, ['outer', 'b', 'b']);
    stop();
    el.remove();
  });

  it('removes a capture listener with its owner', async () => {
    const { mod, el, stop } = await mounted(`
      export const log = [];
      export function App() { return <p onKeyDownCapture={(e) => log.push(e.key)}>x</p>; }`);
    const p = el.querySelector('p');
    p.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    stop();
    p.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    assert.deepEqual(mod.log, ['a']);
    el.remove();
  });

  it('listens for gotpointercapture and lostpointercapture by their own names', () => {
    const code = compileJSX(`export function App(f) { return <div onGotPointerCapture={f} onLostPointerCaptureCapture={f} />; }`);
    assert.match(code, /_\$on\(_el\$0, "gotpointercapture", f\);/);
    assert.match(code, /_\$on\(_el\$0, "lostpointercapture", f, true\);/);
    assert.doesNotMatch(code, /capturecapture|"gotpointer"/);
  });

  it('h() hears gotpointercapture through onGotPointerCapture', () => {
    const log = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const stop = mount(h('i', { onGotPointerCapture: (e) => log.push(e.type) }), el);
    flushSync();
    el.querySelector('i').dispatchEvent(new Event('gotpointercapture'));
    assert.deepEqual(log, ['gotpointercapture']);
    stop();
    el.remove();
  });
});
