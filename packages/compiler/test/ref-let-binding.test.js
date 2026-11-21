// ref={el} with a `let`: the variable has to follow the element through every
// re-creation. Once it held the first element, that element is an object, and
// the old lowering handed it to applyRef as if it were a ref object: `.current`
// was written onto the detached element and the variable kept pointing at it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();
const { mount, flushSync } = await import('../../core/src/index.js');

const mod = await loadCompiled(`
  import { signal } from 'what-framework';
  export const editing = signal(true);
  export let read;
  export let calls = 0;
  function Editor() {
    let input;
    let byCallback = (el) => { calls++; };
    let box = { current: null };
    read = () => ({ input, box, byCallback });
    return <div>{editing() ? <input ref={input} /> : <span>view</span>}<p ref={box} /><b ref={byCallback} /></div>;
  }
  export const build = () => <Editor />;
`);

describe('ref={letVariable}', () => {
  it('follows the element through re-creation, and leaves callbacks and ref objects as they are', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(mod.build, host);
    flushSync();
    assert.equal(mod.read().input, host.querySelector('input'));
    mod.editing(false);
    flushSync();
    mod.editing(true);
    flushSync();
    const live = host.querySelector('input');
    assert.equal(mod.read().input, live, 'the variable holds the new <input>');
    assert.equal(mod.read().input.isConnected, true);
    assert.equal('current' in live, false, 'no .current written onto an element');
    assert.equal(mod.read().box.current, host.querySelector('p'), 'a ref object in a let gets .current');
    assert.equal(typeof mod.read().byCallback, 'function', 'a callback in a let stays a callback');
    assert.equal(mod.calls, 1);
    host.remove();
  });
});
