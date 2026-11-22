// startTransition / useTransition and useOptimistic (docs/ASYNC.md).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));

function deferreds() {
  const map = new Map();
  const get = (name) => {
    if (!map.has(name)) map.set(name, withResolvers());
    return map.get(name);
  };
  return {
    fetch: (name) => get(name).promise,
    answer: (name, value = name) => get(name).resolve(value),
    fail: (name) => get(name).reject(new Error('failed ' + name)),
    started: () => [...map.keys()],
  };
}

// id, other, user (async over id) and four readers, as in the design's demo.
function demo() {
  const { signal, computed, effect, createRoot } = W;
  const api = deferreds();
  const log = [];
  const id = signal(1);
  const other = signal('a');
  let user;
  const dispose = createRoot((d) => {
    user = computed(() => api.fetch('user' + id()));
    effect(() => { log.push('R1 ' + id()); });
    effect(() => { log.push('R2 ' + id() + ' ' + user()); });
    effect(() => { log.push('R5 ' + other()); });
    return d;
  });
  return { api, log, id, other, user: () => user, dispose };
}

describe('startTransition', () => {
  it('holds everything its writes reach until the async work they caused lands; a write outside commits at once', async () => {
    const { startTransition } = W;
    const { api, log, id, other, dispose } = demo();
    api.answer('user1');
    await drain();
    log.length = 0;
    const committed = startTransition(() => id(2));
    other('b');
    assert.equal(id(), 2, 'a read right after the write sees it');
    await drain();
    assert.deepEqual(log, ['R5 b'], 'only the write outside the transition shows');
    api.answer('user2');
    await committed;
    assert.deepEqual(log, ['R5 b', 'R1 2', 'R2 2 user2'], 'R1 and R2 committed together');
    dispose();
  });

  it('a newer transition for the same state supersedes the older: its state never shows', async () => {
    const { startTransition } = W;
    const { api, log, id, dispose } = demo();
    api.answer('user1');
    await drain();
    log.length = 0;
    void startTransition(() => id(2));
    await drain();
    const last = startTransition(() => id(3));
    await drain();
    api.answer('user2');
    await drain();
    assert.deepEqual(log, [], 'the superseded run landed, and nothing showed');
    api.answer('user3');
    await last;
    assert.deepEqual(log, ['R1 3', 'R2 3 user3']);
    dispose();
  });

  it('an effect it holds that an outside write also reaches commits with it', async () => {
    const { signal, computed, effect, startTransition, createRoot } = W;
    const api = deferreds();
    const id = signal(1);
    const other = signal('a');
    const log = [];
    const dispose = createRoot((d) => {
      const user = computed(() => api.fetch('user' + id()));
      effect(() => { log.push(id() + other() + ' ' + user()); });
      return d;
    });
    api.answer('user1');
    await drain();
    log.length = 0;
    const done = startTransition(() => id(2));
    other('b');
    await drain();
    assert.deepEqual(log, []);
    api.answer('user2');
    await done;
    assert.deepEqual(log, ['2b user2']);
    dispose();
  });

  it('commits a dependent async value with the rest: team waits for user, and joins the transition', async () => {
    const { signal, computed, effect, startTransition, createRoot } = W;
    const api = deferreds();
    const id = signal(1);
    const log = [];
    const dispose = createRoot((d) => {
      const user = computed(() => api.fetch('user' + id()));
      const team = computed(() => api.fetch('team of ' + user()));
      effect(() => { log.push('name ' + user()); });
      effect(() => { log.push('team ' + team()); });
      return d;
    });
    api.answer('user1');
    await drain();
    api.answer('team of user1');
    await drain();
    log.length = 0;
    const done = startTransition(() => id(2));
    await drain();
    api.answer('user2');
    await drain();
    assert.deepEqual(log, [], 'user2 landed inside the transition and stays held');
    assert.ok(api.started().includes('team of user2'), 'the dependent fetch started inside the transition');
    api.answer('team of user2');
    await done;
    assert.deepEqual(log.sort(), ['name user2', 'team team of user2']);
    dispose();
  });

  it('resolves when it commits, rejects with an async function\'s error, rethrows a synchronous one', async () => {
    const { startTransition } = W;
    await startTransition(() => {});
    await assert.rejects(startTransition(async () => { throw new Error('action failed'); }), /action failed/);
    assert.throws(() => startTransition(() => { throw new Error('sync'); }), /sync/);
  });

  it('never holds a pending indicator: pending() shows at once while the rest waits', async () => {
    const { effect, createRoot, startTransition } = W;
    const { api, log, id, user, dispose } = demo();
    api.answer('user1');
    await drain();
    log.length = 0;
    const pending = [];
    const stop = createRoot((d) => {
      effect(() => { pending.push(user().pending()); });
      return d;
    });
    const committed = startTransition(() => id(2));
    await drain();
    assert.deepEqual(pending, [false, true], 'the indicator showed the fetch at once');
    assert.deepEqual(log, [], 'what the write reached is held');
    api.answer('user2');
    await committed;
    await drain();
    assert.deepEqual(pending, [false, true, false]);
    assert.deepEqual(log, ['R1 2', 'R2 2 user2']);
    stop();
    dispose();
  });

  it('holds selector readers like any reader', async () => {
    const { signal, computed, effect, createSelector, startTransition, createRoot } = W;
    const api = deferreds();
    const selected = signal(1);
    const log = [];
    const dispose = createRoot((d) => {
      const isSelected = createSelector(selected);
      const detail = computed(() => api.fetch('detail' + selected()));
      effect(() => { log.push('row1 ' + isSelected(1)); });
      effect(() => { log.push('row2 ' + isSelected(2)); });
      effect(() => { log.push('detail ' + detail()); });
      return d;
    });
    api.answer('detail1');
    await drain();
    log.length = 0;
    const done = startTransition(() => selected(2));
    await drain();
    assert.deepEqual(log, []);
    api.answer('detail2');
    await done;
    assert.deepEqual(log.sort(), ['detail detail2', 'row1 false', 'row2 true']);
    dispose();
  });
});

describe('useTransition', () => {
  it('[isPending, startTransition]: isPending() is true from the call until the commit, in the same flush', async () => {
    const { signal, computed, h, mount, useTransition } = W;
    const api = deferreds();
    const tab = signal('a');
    let start;
    function Tabs() {
      const [isPending, startTransition] = useTransition();
      start = startTransition;
      const content = computed(() => api.fetch('tab ' + tab()));
      return h('div', null, () => (isPending() ? '(loading) ' : ''), () => content());
    }
    const host = document.createElement('div');
    const stop = mount(h(Tabs), host);
    api.answer('tab a');
    await drain();
    assert.equal(host.textContent, 'tab a');
    const done = start(() => tab('b'));
    await drain();
    assert.equal(host.textContent, '(loading) tab a');
    api.answer('tab b');
    await done;
    assert.equal(host.textContent, 'tab b');
    stop();
  });

  it('a component that unmounts stops waiting for its transition\'s async part', async () => {
    const { h, mount, useTransition, settled } = W;
    let start;
    function Saver() {
      [, start] = useTransition();
      return h('p', null, 'saver');
    }
    const host = document.createElement('div');
    const stop = mount(h(Saver), host);
    const never = new Promise(() => {});
    const done = start(() => never);
    stop();
    await done;
    await settled();
  });
});

describe('useOptimistic', () => {
  it('shows an overlay at once and drops it when its transition commits, with the real value, in one frame', async () => {
    const { computed, refresh, effect, useOptimistic, startTransition, createRoot } = W;
    let version = 0;
    const answers = [];
    const shown = [];
    let count;
    let addOptimistic;
    const dispose = createRoot((d) => {
      count = computed(() => new Promise((resolve) => answers.push(resolve)).then(() => version));
      const [optimistic, add] = useOptimistic(count, (n, by) => n + by);
      addOptimistic = add;
      effect(() => { shown.push(optimistic()); });
      return d;
    });
    answers.shift()();
    await drain();
    const done = startTransition(async () => {
      addOptimistic(1);
      await Promise.resolve();
      version = 1;
      const landed = refresh(count);
      answers.shift()();
      await landed;
    });
    await drain();
    assert.deepEqual(shown, [0, 1], 'the overlay showed at once');
    await done;
    await drain();
    assert.deepEqual(shown, [0, 1], 'the real 1 replaced the overlaid 1 with no frame between');
    dispose();
  });

  it('rolls back only the overlay of a failed action', async () => {
    const { signal, effect, useOptimistic, startTransition, createRoot } = W;
    const base = signal(['a']);
    const shown = [];
    let add;
    const dispose = createRoot((d) => {
      const [list, addItem] = useOptimistic(base, (items, item) => [...items, item]);
      add = addItem;
      effect(() => { shown.push(list().join(',')); });
      return d;
    });
    const ok = startTransition(async () => { add('b'); await Promise.resolve(); base(['a', 'b']); });
    const failed = startTransition(async () => { add('c'); await Promise.resolve(); throw new Error('no'); });
    await ok;
    await assert.rejects(failed, /no/);
    await drain();
    assert.equal(shown[shown.length - 1], 'a,b');
    assert.ok(shown.includes('a,b,c'), 'both overlays showed');
    dispose();
  });

  it('outside a transition the overlay drops at once, and development says why', async () => {
    const { signal, useOptimistic, getDiagnostics, clearDiagnostics } = W;
    clearDiagnostics();
    const [value, add] = useOptimistic(signal(1), (n, by) => n + by);
    add(5);
    assert.equal(value(), 6);
    await drain();
    assert.equal(value(), 1);
    assert.ok(getDiagnostics().events.some((e) => e.code === 'ERR_OPTIMISTIC_OUTSIDE_TRANSITION'));
  });
});
