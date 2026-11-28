// mount() and hydrate() given no container element throw a coded error. A
// client that copied a hydration example written for a page with its own
// <div id="app"> into the full-page document what-server renders (the route
// directly under <body>) handed hydrate() null, and got "Invalid value used as
// weak map key" from deep inside the root bookkeeping.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const env = installDOM();
const { h, mount, hydrate } = await import('../src/index.js');
const { ERROR_CODES } = await import('../src/errors.js');
const ReactDOM = await import('../../react-compat/src/dom.js');

const missing = (fn) => (error) => error.code === 'ERR_MOUNT_TARGET_MISSING' && error.message.includes(`${fn}()`) && !/weak ?map/i.test(error.message);

describe('a missing container', () => {
  for (const [fn, call] of [['mount', mount], ['hydrate', hydrate]]) {
    it(`${fn}(tree, null) throws ERR_MOUNT_TARGET_MISSING`, () => {
      assert.throws(() => call(h('main', null, 'x'), null), missing(fn));
    });

    it(`${fn}(tree, a selector that matches nothing) throws ERR_MOUNT_TARGET_MISSING, naming the selector`, () => {
      assert.throws(() => call(h('main', null, 'x'), '#nope'), (error) => missing(fn)(error) && error.message.includes('#nope'));
    });
  }

  it('a selector that matches still mounts', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const stop = mount(h('main', null, 'x'), '#app');
    assert.equal(document.querySelector('#app').innerHTML, '<main>x</main>');
    stop();
  });

  it('react-compat roots throw the same error, naming the function called', () => {
    assert.throws(() => ReactDOM.createRoot(null), missing('createRoot'));
    assert.throws(() => ReactDOM.hydrateRoot(undefined, null), (error) => missing('hydrateRoot')(error) && !error.message.includes('createRoot'));
    assert.throws(() => ReactDOM.render(null, null), missing('render'));
  });

  it('words it as mount() and hydrate() do in development', () => {
    const message = (call) => { try { call(); } catch (error) { return error.message; } };
    for (const value of [null, undefined]) {
      assert.equal(message(() => ReactDOM.createRoot(value)), message(() => mount(h('p'), value)).replace('mount()', 'createRoot()'));
      assert.equal(message(() => ReactDOM.hydrateRoot(value)), message(() => hydrate(h('p'), value)).replace('hydrate()', 'hydrateRoot()'));
    }
  });

  it('is catalogued with a fix and an example', () => {
    const entry = Object.values(ERROR_CODES).find((e) => e.code === 'ERR_MOUNT_TARGET_MISSING');
    assert.ok(entry && entry.suggestion.includes('document.body') && entry.codeExample.includes('hydrate(<App />, document.body)'));
  });
});

process.on('exit', () => env.cleanup());
