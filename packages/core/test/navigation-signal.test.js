// Tests for thrown navigation signals: a value carrying its own handler under
// Symbol.for('what.navigation.signal'). what-router's redirect() throws one, so
// a redirect from a component body runs the navigation instead of reaching an
// ErrorBoundary, which would render error UI for a value that is not an error.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { hydrate } = await import('../src/render.js');
const { ErrorBoundary, Suspense } = await import('../src/components.js');

const NAV_SIGNAL = Symbol.for('what.navigation.signal');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

// A navigation signal: an Error carrying a handler the runtime invokes instead
// of treating the throw as a render failure.
function navSignal(onHandled) {
  const sig = new Error('navigation signal');
  sig.name = 'TestNavigationSignal';
  sig[NAV_SIGNAL] = () => onHandled();
  return sig;
}

describe('thrown navigation signals', () => {
  it('a signal thrown from a component body is handled, not reported', () => {
    let handled = 0;
    const Redirecting = () => { throw navSignal(() => { handled++; }); };

    const container = getContainer();
    mount(h('div', { id: 'shell' }, h(Redirecting, {})), container);

    assert.equal(handled, 1, 'the signal handler should have run');
    assert.ok(container.querySelector('#shell'), 'the surrounding tree still renders');
  });

  it('a signal passes through an ErrorBoundary instead of rendering its fallback', async () => {
    let handled = 0;
    const Redirecting = () => { throw navSignal(() => { handled++; }); };

    const container = getContainer();
    mount(
      h(ErrorBoundary, { fallback: () => h('div', { id: 'eb' }, 'Something went wrong') },
        h(Redirecting, {})),
      container,
    );

    await flush();

    assert.equal(handled, 1);
    assert.ok(!container.querySelector('#eb'), 'the boundary must not render error UI');
  });

  it('a signal passes through nested ErrorBoundaries', async () => {
    let handled = 0;
    const Redirecting = () => { throw navSignal(() => { handled++; }); };

    const container = getContainer();
    mount(
      h(ErrorBoundary, { fallback: () => h('div', { id: 'outer-eb' }, 'outer') },
        h(ErrorBoundary, { fallback: () => h('div', { id: 'inner-eb' }, 'inner') },
          h(Redirecting, {}))),
      container,
    );

    await flush();

    assert.equal(handled, 1);
    assert.ok(!container.querySelector('#inner-eb'), 'the inner boundary must not render error UI');
    assert.ok(!container.querySelector('#outer-eb'), 'the outer boundary must not render error UI');
  });

  it('a plain error still reaches the ErrorBoundary', async () => {
    let captured = null;
    const Boom = () => { throw new Error('component exploded'); };

    const container = getContainer();
    mount(
      h(ErrorBoundary, { fallback: ({ error }) => { captured = error; return h('div', { id: 'eb' }, 'caught'); } },
        h(Boom, {})),
      container,
    );

    await flush();

    assert.ok(captured, 'the boundary should still see a plain error');
    assert.equal(captured.message, 'component exploded');
    assert.ok(container.querySelector('#eb'), 'the boundary should still render its fallback');
  });

  it('a signal thrown inside a Suspense subtree navigates rather than suspending', async () => {
    let handled = 0;
    const Redirecting = () => { throw navSignal(() => { handled++; }); };

    const container = getContainer();
    mount(
      h(Suspense, { fallback: h('div', { id: 'loading' }, 'Loading') }, h(Redirecting, {})),
      container,
    );
    await flush();

    assert.equal(handled, 1);
    assert.ok(!container.querySelector('#loading'), 'a signal is not a suspension');
  });

  it('a thrown thenable still suspends', async () => {
    let resolveIt;
    const promise = new Promise((r) => { resolveIt = r; });
    let thrown = false;
    const Suspending = () => {
      if (!thrown) { thrown = true; throw promise; }
      return h('div', { id: 'ready' }, 'Ready');
    };

    const container = getContainer();
    mount(
      h(Suspense, { fallback: h('div', { id: 'loading' }, 'Loading') }, h(Suspending, {})),
      container,
    );
    await flush();

    assert.ok(container.querySelector('#loading'), 'a thenable must still reach the Suspense fallback');
    resolveIt();
    await flush();
  });

  it('a signal thrown during hydration is handled, not logged as a failure', () => {
    let handled = 0;
    const Redirecting = () => { throw navSignal(() => { handled++; }); };

    const container = getContainer();
    container.innerHTML = '<div id="shell"></div>';

    const errors = [];
    const real = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
      hydrate(h('div', { id: 'shell' }, h(Redirecting, {})), container);
    } finally {
      console.error = real;
    }

    assert.equal(handled, 1, 'the hydration path shares the same signal handling');
    assert.deepEqual(errors, [], 'a signal is not a hydration failure');
  });
});
