import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM, flushMicrotasks } from '../../../test-utils/dom.js';

installDOM();
const { mount, ErrorBoundary, useState } = await import('../src/index.js');
const { jsx } = await import('../src/jsx-runtime.js');
const { getCurrentComponent, getComponentStack } = await import('../src/dom.js');

const originalError = console.error;
let errors;
beforeEach(() => {
  errors = [];
  console.error = (...args) => errors.push(args);
});
afterEach(() => {
  mount(null, '#app');
  // Keep failed red runs independent: a broken boundary leaves this stack dirty.
  getComponentStack().length = 0;
  console.error = originalError;
});

function BrokenChild() { throw new Error('child failure'); }
function brokenBoundary() {
  return jsx(ErrorBoundary, {
    fallback: () => { throw new Error('fallback failure'); },
    children: jsx(BrokenChild, {}),
  });
}

describe('a throwing ErrorBoundary fallback restores render scope', () => {
  it('does not give an independent mount the failed boundary as its parent', async () => {
    mount(brokenBoundary(), '#app');
    await flushMicrotasks();
    let parent;
    function Independent() {
      parent = getCurrentComponent()._parentCtx;
      return jsx('p', { children: 'independent' });
    }
    mount(jsx(Independent, {}), '#app');
    assert.equal(parent, null);
    assert.equal(document.getElementById('app').textContent, 'independent');
    assert.throws(() => useState(0), /inside a component/);
    assert.ok(errors.some(args => args.some(value => value?.message === 'fallback failure')));
  });

  it('does not swallow a later unhandled component error', async () => {
    mount(brokenBoundary(), '#app');
    await flushMicrotasks();
    assert.throws(() => mount(jsx(BrokenChild, {}), '#app'), /child failure/);
    assert.equal(getCurrentComponent(), undefined);
  });

  it('unwinds nested boundaries without changing which boundary catches children', async () => {
    const caught = [];
    mount(jsx(ErrorBoundary, {
      onError: error => caught.push(`outer:${error.message}`),
      fallback: () => jsx('p', { children: 'outer' }),
      children: jsx(ErrorBoundary, {
        onError: error => caught.push(`inner:${error.message}`),
        fallback: () => { throw new Error('nested fallback failure'); },
        children: jsx(BrokenChild, {}),
      }),
    }), '#app');
    await flushMicrotasks();
    assert.deepEqual(caught, ['inner:child failure']);
    assert.equal(getCurrentComponent(), undefined);

    mount(jsx(ErrorBoundary, {
      onError: error => caught.push(`new:${error.message}`),
      fallback: () => jsx('p', { children: 'recovered' }),
      children: jsx(BrokenChild, {}),
    }), '#app');
    await flushMicrotasks();
    assert.deepEqual(caught, ['inner:child failure', 'new:child failure']);
    assert.equal(document.getElementById('app').textContent, 'recovered');
    assert.equal(getCurrentComponent(), undefined);
  });
});
