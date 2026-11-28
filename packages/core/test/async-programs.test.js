// The three programs of the async design (async list with refresh, optimistic
// toggle with a server action and rollback, dependent values without a
// waterfall), written the way an app writes them, compiled by what-compiler,
// and checked frame by frame under a virtual clock (fixtures/async-clock.js).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { asyncClock } from './fixtures/async-clock.js';

let env;
let host;
before(() => {
  env = installDOM();
  host = env.document.getElementById('app');
});
after(() => env.cleanup());

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

// --- P1: an async list with refresh -----------------------------------------

const P1 = `
import { computed, refresh, Suspense, mount } from 'what-framework';
export function Page(props) {
  const users = computed(props.fetchUsers);
  return (
    <>
      <button onClick={() => refresh(users)}>Refresh</button>
      <Suspense fallback={<p>Loading…</p>}>
        {users.pending() && <span>Refreshing…</span>}
        <ul>{users().map(u => <li key={u.id}><input value={u.name} />{u.name}</li>)}</ul>
      </Suspense>
    </>
  );
}
export { mount };
`;

describe('P1: an async list with refresh', () => {
  it('shows the fallback on first load only; a refresh keeps the rows, their DOM and their state', async (t) => {
    const { Page, mount } = await loadCompiled(P1);
    let version = 0;
    const clock = asyncClock(t, () => text(host));
    const api = clock.api({
      fetchUsers: [100, () => (++version === 1
        ? [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }]
        : [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }, { id: 3, name: 'Cy' }])],
    });
    const stop = mount(Page({ fetchUsers: api.fetchUsers }), host);
    try {
      await clock.start();
      await clock.to(100);
      const ada = host.querySelector('li');
      const input = ada.querySelector('input');
      input.value = 'typed by the user';
      await clock.to(150);
      await clock.act(() => host.querySelector('button').click());
      await clock.to(250);

      assert.deepEqual(clock.frames, [
        { at: 0, text: 'RefreshLoading…' },
        { at: 100, text: 'RefreshAdaBo' },
        { at: 150, text: 'RefreshRefreshing…AdaBo' },
        { at: 250, text: 'RefreshAdaBoCy' },
      ]);
      assert.deepEqual(clock.starts, [{ at: 0, name: 'fetchUsers' }, { at: 150, name: 'fetchUsers' }]);
      assert.equal(host.querySelector('li'), ada, 'the refresh kept the row');
      assert.equal(ada.querySelector('input'), input);
      assert.equal(input.value, 'typed by the user', 'and the state of its DOM');
    } finally {
      stop();
      clock.stop();
    }
  });
});

// --- P2: an optimistic toggle with a server action and rollback --------------

// Rows whose item changes under the same key update in place with <For>
// (signal-wrapped items); a keyed .map() row keeps what it rendered.
const P2 = `
import { computed, refresh, useOptimistic, useSignal, startTransition, For, mount } from 'what-framework';
export function TodoList(props) {
  const error = useSignal(null);
  const todos = computed(props.getTodos);
  const [shown, toggleOptimistic] = useOptimistic(todos,
    (list, id) => list.map(t => (t.id === id ? { ...t, done: !t.done } : t)));
  const toggle = id => startTransition(async () => {
    toggleOptimistic(id);
    await props.toggleTodo(id);
    await refresh(todos);
  }).catch(e => error(e));
  return (
    <ul>
      {error() && <li role="alert">{error().message}</li>}
      <For each={shown} key={t => t.id}>
        {todo => <li><input type="checkbox" checked={todo().done} onChange={() => toggle(todo().id)} />{todo().id}:{todo().done ? 'x' : '_'}</li>}
      </For>
    </ul>
  );
}
export function App(props) {
  return <TodoList getTodos={props.getTodos} toggleTodo={props.toggleTodo} />;
}
export { mount };
`;

describe('P2: an optimistic toggle with a server action and rollback', () => {
  async function setup(t) {
    const { App, mount } = await loadCompiled(P2);
    const db = [{ id: 1, done: false }, { id: 2, done: false }];
    const clock = asyncClock(t, () => text(host));
    const api = clock.api({
      getTodos: [40, () => db.map((todo) => ({ ...todo }))],
      toggleTodo: [60, (id) => {
        if (id === 2) throw new Error('toggle 2 failed');
        const todo = db.find((x) => x.id === id);
        todo.done = !todo.done;
      }],
    });
    const stop = mount(App(api), host);
    await clock.start();
    await clock.to(40);
    return { db, clock, stop };
  }

  it('shows the overlay at once and drops it with the real data in the same frame', async (t) => {
    const { db, clock, stop } = await setup(t);
    try {
      await clock.to(50);
      await clock.act(() => host.querySelectorAll('input')[0].dispatchEvent(new env.window.Event('change', { bubbles: true })));
      await clock.to(200);
      assert.deepEqual(clock.frames, [
        { at: 0, text: '' },
        { at: 40, text: '1:_2:_' },
        { at: 50, text: '1:x2:_' },
      ], 'confirmed without a flicker back to 1:_');
      assert.deepEqual(clock.flushes.map((f) => f.text), ['', '1:_2:_', '1:x2:_'], 'no flush showed anything else');
      assert.deepEqual(db, [{ id: 1, done: true }, { id: 2, done: false }]);
      assert.deepEqual(clock.starts.map((s) => `${s.at} ${s.name}`), ['0 getTodos', '50 toggleTodo', '110 getTodos']);
    } finally {
      stop();
      clock.stop();
    }
  });

  it('two concurrent toggles, one failing: only the failed one rolls back, with no flicker', async (t) => {
    const { db, clock, stop } = await setup(t);
    try {
      await clock.to(50);
      await clock.act(() => {
        const [one, two] = host.querySelectorAll('input');
        one.dispatchEvent(new env.window.Event('change', { bubbles: true }));
        two.dispatchEvent(new env.window.Event('change', { bubbles: true }));
      });
      await clock.to(200);
      assert.deepEqual(clock.frames, [
        { at: 0, text: '' },
        { at: 40, text: '1:_2:_' },
        { at: 50, text: '1:x2:x' },
        { at: 150, text: 'toggle 2 failed1:x2:_' },
      ]);
      assert.ok(!clock.flushes.some((f) => /1:_/.test(f.text) && f.at >= 50), 'the confirmed toggle never flickered back');
      assert.deepEqual(db, [{ id: 1, done: true }, { id: 2, done: false }]);
    } finally {
      stop();
      clock.stop();
    }
  });
});

// --- P3: dependent async values, no waterfall --------------------------------

const P3 = `
import { computed, signal, startTransition, Suspense, mount } from 'what-framework';
export const id = signal(1);
export function ProfilePage(props) {
  const user = computed(() => props.api.fetchUser(id()));
  const team = computed(() => props.api.fetchTeam(user().teamId));
  return (
    <Suspense fallback={<p>Spinner</p>}>
      <h1>{user().name} · {team().name}</h1>
      <Posts api={props.api} />
    </Suspense>
  );
}
function Posts(props) {
  const posts = computed(() => props.api.fetchPosts(id()));
  return <ul>{posts().map(p => <li key={p}>{p}</li>)}</ul>;
}
export { mount, startTransition };
`;

describe('P3: dependent async values without a waterfall', () => {
  async function setup(t) {
    const mod = await loadCompiled(P3);
    const clock = asyncClock(t, () => text(host));
    const api = clock.api({
      fetchUser: [100, (id) => ({ name: 'user' + id, teamId: 't' + id })],
      fetchTeam: [100, (teamId) => ({ name: 'team ' + teamId })],
      fetchPosts: [150, (id) => ['post' + id + 'a', 'post' + id + 'b']],
    });
    mod.id(1); // the compiled module, and its id signal, is shared by these tests
    const stop = mod.mount(mod.ProfilePage({ api }), host);
    await clock.start();
    return { mod, clock, stop };
  }

  it('fetches posts beside user, team once user lands, and reveals everything at once', async (t) => {
    const { clock, stop } = await setup(t);
    try {
      await clock.to(250);
      assert.deepEqual(clock.starts.map((s) => `${s.at} ${s.name}`), ['0 fetchUser', '0 fetchPosts', '100 fetchTeam']);
      assert.deepEqual(clock.frames, [
        { at: 0, text: 'Spinner' },
        { at: 200, text: 'user1 · team t1post1apost1b' },
      ], 'max(user + team, posts) = 200 ms, and no partial content');
    } finally {
      stop();
      clock.stop();
    }
  });

  it('inside a transition, a new id commits as one frame when user, team and posts have all landed', async (t) => {
    const { mod, clock, stop } = await setup(t);
    try {
      await clock.to(200);
      await clock.act(() => { void mod.startTransition(() => mod.id(2)); });
      assert.equal(mod.id(), 2, 'a read right after the write sees it');
      await clock.to(500);
      assert.deepEqual(clock.frames.filter((f) => f.at > 200), [
        { at: 400, text: 'user2 · team t2post2apost2b' },
      ], 'the old page stays until the whole new one commits');
      assert.deepEqual(clock.flushes.map((f) => f.text).filter((s) => /2/.test(s)), ['user2 · team t2post2apost2b'],
        'no flush showed a mix of the two ids');
    } finally {
      stop();
      clock.stop();
    }
  });

  // Behaviour this design does not give (docs/ASYNC.md, "Limits"): outside a
  // transition, separate bindings show their new values as each lands, so the
  // page shows user2 beside team t1 for a while. Solid holds every write that
  // causes async work; What holds only inside startTransition.
  it('without a transition, each binding shows its new value when it lands: atomicity is opt-in', async (t) => {
    const { mod, clock, stop } = await setup(t);
    try {
      await clock.to(200);
      await clock.act(() => mod.id(2));
      await clock.to(500);
      assert.deepEqual(clock.frames.filter((f) => f.at > 200), [
        { at: 300, text: 'user2 · team t1post1apost1b' },
        { at: 350, text: 'user2 · team t1post2apost2b' },
        { at: 400, text: 'user2 · team t2post2apost2b' },
      ]);
    } finally {
      stop();
      clock.stop();
    }
  });
});

// --- A compiled conditional over an async value ------------------------------

const CONDITIONAL = `
import { computed, refresh, mount } from 'what-framework';
export function Profile(props) {
  const user = computed(props.fetchUser);
  props.expose(user);
  return <div>{user() && <section><input /><span>{user().name}</span></section>}</div>;
}
export { mount, refresh };
`;

describe('a compiled conditional over an async value', () => {
  // While the value is fetched again the branch, and its DOM state, stay as
  // they are. (When the new value lands, a conditional on `user()` renders
  // its branch for the new object, as any change of that value would.)
  it('renders once the value lands, and keeps its subtree and that subtree\'s DOM while it is fetched again', async (t) => {
    const mod = await loadCompiled(CONDITIONAL);
    let n = 0;
    const clock = asyncClock(t, () => text(host));
    const api = clock.api({ fetchUser: [100, () => ({ name: 'user' + ++n })] });
    let user;
    const stop = mod.mount(mod.Profile({ fetchUser: api.fetchUser, expose: (c) => { user = c; } }), host);
    try {
      await clock.start();
      await clock.to(100);
      const section = host.querySelector('section');
      const input = host.querySelector('input');
      input.value = 'kept';
      await clock.act(() => { void mod.refresh(user); });
      await clock.to(199);
      assert.equal(host.querySelector('section'), section, 'the refresh did not rebuild the branch');
      assert.equal(host.querySelector('input'), input);
      assert.equal(input.value, 'kept');
      await clock.to(250);
      assert.deepEqual(clock.frames, [{ at: 0, text: '' }, { at: 100, text: 'user1' }, { at: 200, text: 'user2' }]);
    } finally {
      stop();
      clock.stop();
    }
  });
});
