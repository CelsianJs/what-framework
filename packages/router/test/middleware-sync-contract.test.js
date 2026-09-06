// JavaScript callers can bypass the synchronous Middleware declaration. Never
// mistake an unresolved authorization result for permission to mount a page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { installDOM } from '../../../test-utils/dom.js';

installDOM(undefined, { url: 'http://localhost/private' });

const { h, mount, createRoot, getErrorDefinition } = await import('what-core');
const { Router, route, redirect } = await import('../src/index.js');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function assertBlocked(middleware, verifyError = error => {
  assert.equal(error.code, 'ERR_ASYNC_MIDDLEWARE');
  assert.match(error.message, /synchronous/i);
  assert.match(error.suggestion, /asyncGuard\(check\)\(Component\)/);
  assert.match(error.codeExample, /component: asyncGuard\(check\)\(Component\)/);
  assert.ok(getErrorDefinition(error.code), 'runtime error belongs to the catalogue');
}) {
  const container = document.getElementById('app');
  let mounts = 0;
  let laterMiddleware = 0;
  let captured;
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  const onBrowserUnhandled = event => unhandled.push(event.reason);
  process.on('unhandledRejection', onUnhandled);
  window.addEventListener('unhandledrejection', onBrowserUnhandled);
  let unmount;
  let dispose;
  try {
    createRoot(cleanup => {
      dispose = cleanup;
      try {
        unmount = mount(h(Router, { routes: [{
          path: '/private',
          component: () => { mounts++; return h('div', { id: 'private' }, 'Secret'); },
          middleware: [middleware, () => { laterMiddleware++; }],
        }] }), container);
      } catch (error) {
        captured = error;
      }
    });
    assert.ok(captured, 'the matching pass fails synchronously');
    await settle();
    assert.equal(mounts, 0, 'protected component never executes, even after settlement');
    assert.equal(laterMiddleware, 0, 'the rejected chain stops immediately');
    assert.equal(container.querySelector('#private'), null);
    verifyError(captured);
    assert.deepEqual(unhandled, [], 'observed middleware rejections cannot escape');
    assert.equal(route.path, '/private', 'an async result must not navigate');
  } finally {
    unmount?.();
    dispose?.();
    process.off('unhandledRejection', onUnhandled);
    window.removeEventListener('unhandledrejection', onBrowserUnhandled);
  }
}

describe('route middleware is synchronous and fails closed', () => {
  for (const value of [true, false, undefined, '/login']) {
    it(`blocks a promise resolving to ${String(value)}`, () =>
      assertBlocked(() => Promise.resolve(value)));
  }

  it('observes an already rejected promise', () =>
    assertBlocked(() => Promise.reject(new Error('auth unavailable'))));

  it('observes a later rejection', () =>
    assertBlocked(() => new Promise((_, reject) => {
      queueMicrotask(() => reject(new Error('auth unavailable later')));
    })));

  it('does not handle an async redirect as synchronous middleware navigation', () =>
    assertBlocked(async () => redirect('/login')));

  it('blocks a promise from another realm', () =>
    assertBlocked(() => runInNewContext('Promise.reject(new Error("foreign auth failure"))')));

  it('blocks a promise that remains pending', () =>
    assertBlocked(() => new Promise(() => {})));

  it('reads a thenable getter once and calls it once with its receiver', async () => {
    let reads = 0;
    let calls = 0;
    let receiver;
    const result = {
      get then() {
        assert.equal(++reads, 1, 'do not read then again while observing rejection');
        return function (_resolve, reject) {
          receiver = this;
          calls++;
          reject(new Error('thenable auth failure'));
        };
      },
    };
    await assertBlocked(() => result);
    assert.equal(reads, 1);
    assert.equal(calls, 1);
    assert.equal(receiver, result);
  });

  it('blocks callable thenables too', async () => {
    const result = () => {};
    result.then = (_resolve, reject) => reject(new Error('callable auth failure'));
    await assertBlocked(() => result);
  });

  it('observes a then method that throws', () =>
    assertBlocked(() => ({ then() { throw new Error('broken thenable'); } })));

  it('preserves an error thrown by a then getter without granting access', async () => {
    const failure = new Error('cannot inspect authorization result');
    let reads = 0;
    await assertBlocked(() => ({
      get then() { reads++; throw failure; },
    }), error => assert.equal(error, failure));
    assert.equal(reads, 1);
  });
});
