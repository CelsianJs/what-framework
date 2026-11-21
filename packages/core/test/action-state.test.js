// useActionState and useFormStatus: React 19's shapes on the engine's
// transitions (docs/DATA.md).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { h, mount: mountApp, useActionState, useFormStatus, useOptimistic, signal, settled, ErrorBoundary, Suspense } = await import('../src/index.js');
const { query, invalidateQueries, clearCache } = await import('../src/entries/data.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted = [];
function mount(vnode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  mounted.push(mountApp(vnode, el));
  return el;
}
afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  clearCache();
});

describe('useActionState', () => {
  it('returns [state, dispatch, isPending]; the new state commits when the action has finished', async () => {
    let dispatch;
    let pending;
    const gate = Promise.withResolvers();
    const el = mount(h(() => {
      const [count, run, isPending] = useActionState(async (prev, by) => { await gate.promise; return prev + by; }, 0);
      dispatch = run;
      pending = isPending;
      return h('p', null, () => `${count()}${isPending() ? '…' : ''}`);
    }));
    assert.equal(el.textContent, '0');
    dispatch(2);
    await tick();
    assert.equal(pending(), true);
    assert.equal(el.textContent, '0…', 'isPending shows at once; the state waits for the action');
    gate.resolve();
    await settled();
    assert.equal(el.textContent, '2');
    assert.equal(pending(), false);
  });

  it('queues dispatches: each action receives the state the previous one returned', async () => {
    const seen = [];
    let dispatch;
    const el = mount(h(() => {
      const [list, run] = useActionState(async (prev, item) => {
        seen.push([...prev]);
        await tick();
        return [...prev, item];
      }, []);
      dispatch = run;
      return h('p', null, () => list().join(','));
    }));
    dispatch('a');
    dispatch('b');
    dispatch('c');
    await settled();
    assert.equal(el.textContent, 'a,b,c');
    assert.deepEqual(seen, [[], ['a'], ['a', 'b']]);
  });

  it('commits its state in the same flush as the data its action revalidated', async () => {
    const requests = [];
    let dispatch;
    const el = mount(h(Suspense, { fallback: 'loading' }, h(() => {
      const todos = query(['todos'], () => {
        const r = Promise.withResolvers();
        requests.push(r);
        return r.promise;
      });
      const [message, run] = useActionState(async (_, title) => {
        await invalidateQueries(['todos']);
        return `added ${title}`;
      }, '');
      dispatch = run;
      return h('p', null, h('span', null, () => todos().join(',')), h('span', null, () => ` ${message()}`));
    })));
    requests[0].resolve(['a']);
    await settled();
    assert.equal(el.textContent, 'a ');
    dispatch('b');
    await tick();
    requests[1].resolve(['a', 'b']);
    await tick();
    // Both the refetched list and the action's state, or neither.
    assert.ok(el.textContent === 'a ' || el.textContent === 'a,b added b', el.textContent);
    await settled();
    assert.equal(el.textContent, 'a,b added b');
  });

  it('drops an optimistic overlay added in the action in the same commit as its state', async () => {
    const el = mount(h(() => {
      let addOptimistic;
      // React 19's pattern: the overlay is added in the action, before its first await.
      const [likes, run] = useActionState(async (prev) => { addOptimistic(); await tick(); return prev + 1; }, 0);
      const [shown, add] = useOptimistic(likes, (n) => n + 1);
      addOptimistic = add;
      return h('p', null, h('button', { onclick: () => run() }, 'like'), () => String(shown()));
    }));
    el.querySelector('button').click();
    await tick();
    assert.match(el.textContent, /1$/, 'the overlay shows at once');
    await settled();
    assert.match(el.textContent, /1$/, 'the real state replaced it, with no frame of 2 or 0');
  });

  it('a throwing action reaches the nearest <ErrorBoundary>, and the queued ones are dropped', async () => {
    let dispatch;
    const ran = [];
    const el = mount(h(ErrorBoundary, { fallback: ({ error }) => h('em', null, error.message) }, h(() => {
      const [, run] = useActionState(async (prev, step) => {
        ran.push(step);
        if (step === 'bad') throw new Error('save failed');
        return prev;
      }, null);
      dispatch = run;
      return h('p', null, 'form');
    })));
    dispatch('bad');
    dispatch('after');
    await settled();
    assert.equal(el.textContent, 'save failed');
    assert.deepEqual(ran, ['bad'], 'the dispatch queued behind the failure did not run');
  });

  it('keeps permalink on the dispatch for <Form>', () => {
    let dispatch;
    mount(h(() => {
      [, dispatch] = useActionState(async (s) => s, 0, '/cart');
      return null;
    }));
    assert.equal(dispatch.permalink, '/cart');
  });
});

describe('useFormStatus', () => {
  it('outside a <Form>: not pending, no data', () => {
    let status;
    mount(h(() => {
      status = useFormStatus();
      return null;
    }));
    assert.equal(status.pending(), false);
    assert.equal(status.data(), null);
    assert.equal(status.method, null);
    assert.equal(status.action, null);
  });

  it('reads the submission of the form status around it', async () => {
    const { _formStatusContext, _formStatus } = await import('../src/entries/internal.js');
    const FormStatus = _formStatusContext();
    const status = _formStatus('post', 'save');
    let inner;
    const label = signal('');
    const el = mount(h(FormStatus, { value: status }, h(() => {
      inner = useFormStatus();
      return h('button', null, () => (inner.pending() ? `saving ${inner.data().get('title')}` : `save${label()}`));
    })));
    assert.equal(el.textContent, 'save');
    assert.equal(inner.method, 'post');
    const gate = Promise.withResolvers();
    const data = new FormData();
    data.set('title', 'draft');
    const resets = [];
    const done = status.submit(data, () => gate.promise, () => resets.push(inner.pending()));
    await tick();
    assert.equal(el.textContent, 'saving draft');
    assert.deepEqual(resets, []);
    gate.resolve();
    await done;
    await tick();
    assert.equal(el.textContent, 'save');
    assert.equal(inner.data(), null);
    assert.equal(resets.length, 1, 'reset once, at the commit');
    assert.equal(inner.action, null, 'an action id is not a function');
    const failed = status.submit(data, () => Promise.reject(new Error('nope')), () => resets.push('again'));
    await failed.catch(() => {});
    assert.equal(resets.length, 1, 'a failed submission does not reset');
  });
});
