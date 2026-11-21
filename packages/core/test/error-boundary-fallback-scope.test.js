import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM, flushMicrotasks } from '../../../test-utils/dom.js';

installDOM();
const { mount, ErrorBoundary, useState } = await import('../src/index.js');
const { jsx } = await import('../src/jsx-runtime.js');
const { getCurrentComponent } = await import('../src/dom.js');

const originalError = console.error;
let errors;
beforeEach(() => {
  errors = [];
  console.error = (...args) => errors.push(args);
});
afterEach(() => {
  mount(null, '#app');
  console.error = originalError;
});

// The nearest component owner above a component's own owner.
function parentComponent(owner) {
  let o = owner.owner;
  while (o && o.Component === undefined) o = o.owner;
  return o || null;
}

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
      parent = parentComponent(getCurrentComponent());
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
    assert.equal(getCurrentComponent(), null);
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
    // The inner fallback throws while the inner boundary's effect builds it, so
    // that error goes to the boundary above, the outer one.
    assert.deepEqual(caught, ['inner:child failure', 'outer:nested fallback failure']);
    assert.equal(document.getElementById('app').textContent, 'outer');
    assert.equal(getCurrentComponent(), null);

    mount(jsx(ErrorBoundary, {
      onError: error => caught.push(`new:${error.message}`),
      fallback: () => jsx('p', { children: 'recovered' }),
      children: jsx(BrokenChild, {}),
    }), '#app');
    await flushMicrotasks();
    assert.deepEqual(caught, ['inner:child failure', 'outer:nested fallback failure', 'new:child failure']);
    assert.equal(document.getElementById('app').textContent, 'recovered');
    assert.equal(getCurrentComponent(), null);
  });
});
