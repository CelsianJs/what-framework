// useSkeleton (what-framework/ui: "Async + skeleton helper"), useFocus
// (what-framework/a11y: "Current focus helpers") and onRevalidate
// (what-framework/data: callbacks invalidatePath runs for its path).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const skeleton = await import('../src/skeleton.js');
const { useSkeleton } = skeleton;
const { useFocus } = await import('../src/a11y.js');
const { onRevalidate, invalidatePath } = await import('../src/data.js');
const { signal, createRoot, flushSync } = await import('../src/index.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the skeleton components', () => {
  it('each renders with no props, as ui.d.ts allows', () => {
    for (const name of ['Skeleton', 'SkeletonText', 'SkeletonAvatar', 'SkeletonCard', 'SkeletonTable', 'IslandSkeleton', 'Placeholder', 'LoadingDots', 'Spinner']) {
      assert.ok(skeleton[name](), name);
    }
  });
});

describe('useSkeleton', () => {
  it('is loading until the value arrives, then shows it and no skeleton', async () => {
    let resolve;
    let sk;
    createRoot(() => { sk = useSkeleton(() => new Promise((r) => { resolve = r; })); });
    flushSync();
    assert.equal(sk.isLoading(), true);
    assert.ok(sk.Skeleton(), 'the skeleton while loading');
    resolve({ name: 'x' });
    await tick();
    assert.equal(sk.isLoading(), false);
    assert.deepEqual(sk.data(), { name: 'x' });
    assert.equal(sk.Skeleton(), null);
  });

  it('keeps a function the call resolves to as the data', async () => {
    const fn = () => 'inner';
    let sk;
    createRoot(() => { sk = useSkeleton(() => fn); });
    flushSync();
    await tick();
    assert.equal(sk.data(), fn);
  });

  it('reports a rejection as the error', async () => {
    let sk;
    createRoot(() => { sk = useSkeleton(() => Promise.reject(new Error('down'))); });
    flushSync();
    await tick();
    assert.equal(sk.isLoading(), false);
    assert.equal(sk.error().message, 'down');
  });

  it('runs again when a signal it read changes, and shows the latest run, whichever settles last', async () => {
    const q = signal('a');
    const pending = {};
    let sk;
    createRoot(() => { sk = useSkeleton(() => { const k = q(); return new Promise((r) => { pending[k] = r; }); }); });
    flushSync();
    q('b');
    flushSync();
    assert.equal(sk.isLoading(), true);
    pending.b('B');
    await tick();
    pending.a('A');
    await tick();
    assert.equal(sk.data(), 'B');
    assert.equal(sk.isLoading(), false);
  });
});

describe('useFocus', () => {
  it('tracks the focused element, focuses and blurs', () => {
    const a = document.createElement('input');
    const b = document.createElement('button');
    document.body.append(a, b);
    const focus = useFocus();
    focus.focus(a);
    assert.equal(focus.current(), a);
    focus.focus(b);
    assert.equal(focus.current(), b);
    focus.blur();
    assert.equal(document.activeElement, document.body);
    assert.equal(focus.current(), null, 'focus that left for nothing is no element');
    assert.doesNotThrow(() => focus.focus(null));
    a.remove();
    b.remove();
  });
});

describe('onRevalidate', () => {
  it('runs its callbacks for its path when invalidatePath runs, until unsubscribed', async () => {
    const calls = [];
    const off = onRevalidate('/posts', () => calls.push('posts'));
    onRevalidate('/other', () => calls.push('other'));
    const failing = onRevalidate('/posts', () => { throw new Error('cb failed'); });
    const original = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args[0]);
    try {
      await invalidatePath('/posts');
    } finally {
      console.error = original;
    }
    assert.deepEqual(calls, ['posts']);
    assert.equal(errors.length, 1, 'a failing callback is reported and the others still run');
    off();
    failing();
    await invalidatePath('/posts');
    assert.deepEqual(calls, ['posts']);
  });
});
