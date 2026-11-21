// Async computeds (docs/ASYNC.md): a computed whose function returns a
// promise or an async iterable is a value in the graph.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));

// A fetch whose answers the test hands out by name.
function server() {
  const flights = [];
  const fetch = (name, signal) => {
    const flight = Promise.withResolvers();
    flights.push({ name, signal, ...flight });
    return flight.promise;
  };
  const answer = (name, value = name) => flights.find((f) => f.name === name).resolve(value);
  const fail = (name, error = new Error('failed ' + name)) => flights.find((f) => f.name === name).reject(error);
  return { flights, fetch, answer, fail, names: () => flights.map((f) => f.name) };
}

describe('starting', () => {
  it('an async function, or one that takes { signal }, starts when created: no waterfall', () => {
    const { computed, createRoot } = W;
    const api = server();
    createRoot((dispose) => {
      computed(async () => api.fetch('user'));
      computed(({ signal }) => api.fetch('posts', signal));
      assert.deepEqual(api.names(), ['user', 'posts'], 'both started before anything read them');
      dispose();
    });
  });

  it('a plain function that returns a promise starts when first read, like any computed', () => {
    const { computed, effect, createRoot } = W;
    const api = server();
    createRoot((dispose) => {
      const user = computed(() => api.fetch('user'));
      assert.deepEqual(api.names(), []);
      effect(() => { user(); });
      assert.deepEqual(api.names(), ['user']);
      dispose();
    });
  });
});

describe('reading', () => {
  it('holds a binding until the value lands, then shows it; nothing is logged without a boundary', async () => {
    const { computed, h, mount } = W;
    const api = server();
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const user = computed(() => api.fetch('ada'));
      const host = document.createElement('div');
      const stop = mount(h('p', null, () => 'Hello ' + user()), host);
      assert.equal(host.textContent, '', 'a binding with nothing to show yet shows nothing');
      api.answer('ada', 'Ada');
      await drain();
      assert.equal(host.textContent, 'Hello Ada');
      stop();
    } finally {
      console.error = consoleError;
    }
    assert.deepEqual(errors, []);
  });

  it('keeps the last value while a newer run is in flight; reads stay fresh and pending() is true at once', async () => {
    const { signal, computed, effect, createRoot } = W;
    const api = server();
    const id = signal(1);
    const shown = [];
    let user;
    const dispose = createRoot((d) => {
      user = computed(() => api.fetch('user' + id()));
      effect(() => { shown.push(id() + ':' + user()); });
      return d;
    });
    assert.equal(user.pending(), false, 'not pending on first load: nothing to refresh');
    api.answer('user1');
    await drain();
    id(2);
    assert.equal(id(), 2, 'a read right after a write returns the new value');
    assert.equal(user.pending(), true, 'pending right after the write that caused the refetch');
    assert.equal(user(), 'user1', 'an untracked read gives the last value that landed');
    assert.equal(user.peek(), 'user1');
    await drain();
    assert.deepEqual(shown, ['1:user1'], 'the effect is held: it does not show id 2 with user1');
    api.answer('user2');
    await drain();
    assert.deepEqual(shown, ['1:user1', '2:user2']);
    assert.equal(user.pending(), false);
    dispose();
  });

  it('an effect that reads two async values runs once, when both have landed', async () => {
    const { computed, effect, createRoot } = W;
    const api = server();
    const runs = [];
    const dispose = createRoot((d) => {
      const user = computed(() => api.fetch('user'));
      const posts = computed(() => api.fetch('posts'));
      effect(() => { runs.push(user() + '+' + posts()); });
      return d;
    });
    api.answer('user');
    await drain();
    assert.deepEqual(runs, []);
    api.answer('posts');
    await drain();
    assert.deepEqual(runs, ['user+posts']);
    dispose();
  });

  it('a computed over an async value keeps its last value while the input is fetched again', async () => {
    const { signal, computed, effect, createRoot } = W;
    const api = server();
    const id = signal(1);
    let label;
    const runs = [];
    const dispose = createRoot((d) => {
      const user = computed(() => api.fetch('user' + id()));
      label = computed(() => id() + ':' + user());
      effect(() => { runs.push(label()); });
      return d;
    });
    api.answer('user1');
    await drain();
    id(2);
    assert.equal(label(), '1:user1', 'its last value: the old frame, never a mix of id 2 and user1');
    assert.equal(label.pending(), true, 'pending through the async value it reads');
    await drain();
    assert.deepEqual(runs, ['1:user1']);
    api.answer('user2');
    await drain();
    assert.deepEqual(runs, ['1:user1', '2:user2']);
    assert.equal(label.pending(), false);
    dispose();
  });

  it('isPending(fn) answers for what fn reads, through computeds, and is tracked', async () => {
    const { signal, computed, effect, isPending, createRoot } = W;
    const api = server();
    const id = signal(1);
    const seen = [];
    let name;
    const dispose = createRoot((d) => {
      const user = computed(() => api.fetch('user' + id()));
      name = computed(() => user().name);
      effect(() => {
        const now = isPending(() => name());
        if (seen[seen.length - 1] !== now) seen.push(now);
      });
      return d;
    });
    api.answer('user1', { name: 'Ada' });
    await drain();
    id(2);
    assert.equal(isPending(() => name()), true);
    await drain();
    api.answer('user2', { name: 'Bo' });
    await drain();
    assert.deepEqual(seen, [false, true, false]);
    dispose();
  });
});

describe('runs', () => {
  it('fetches again when an input changes, with no reader', async () => {
    const { signal, computed, createRoot } = W;
    const api = server();
    const id = signal(1);
    let user;
    const dispose = createRoot((d) => {
      user = computed(({ signal: abort }) => api.fetch('user' + id(), abort));
      return d;
    });
    api.answer('user1');
    await drain();
    id(2);
    await drain();
    assert.deepEqual(api.names(), ['user1', 'user2'], 'the new id was fetched though nothing reads user');
    api.answer('user2');
    await drain();
    assert.equal(user.peek(), 'user2');
    dispose();
  });

  it('supersedes and aborts an older run; its result never shows', async () => {
    const { signal, computed, effect, createRoot } = W;
    const api = server();
    const id = signal(1);
    const shown = [];
    const dispose = createRoot((d) => {
      const user = computed(({ signal: abort }) => api.fetch('user' + id(), abort));
      effect(() => { shown.push(user()); });
      return d;
    });
    id(2);
    await drain();
    assert.equal(api.flights[0].signal.aborted, true, 'the superseded run was aborted');
    assert.equal(api.flights[1].signal.aborted, false);
    api.answer('user2');
    await drain();
    api.answer('user1');
    await drain();
    assert.deepEqual(shown, ['user2'], 'the late result of the superseded run was dropped');
    dispose();
  });

  it('refresh() runs it again, shows as pending, and resolves with the value', async () => {
    const { computed, refresh, effect, createRoot } = W;
    const api = server();
    let users;
    const pending = [];
    const dispose = createRoot((d) => {
      users = computed(() => api.fetch('users#' + api.flights.length));
      effect(() => {
        const now = users.pending();
        if (pending[pending.length - 1] !== now) pending.push(now);
      });
      return d;
    });
    api.answer('users#0', 'first');
    await drain();
    const refreshed = refresh(users);
    assert.equal(users.pending(), true);
    assert.equal(users(), 'first');
    api.answer('users#1', 'second');
    assert.equal(await refreshed, 'second');
    await drain();
    assert.deepEqual(pending, [false, true, false]);

    const failed = refresh(users);
    api.fail('users#2');
    await assert.rejects(failed, /failed users#2/);
    dispose();
  });

  it('an async iterable: each value it yields lands; it is closed when superseded', async () => {
    const { signal, computed, effect, createRoot } = W;
    const id = signal(1);
    const closed = [];
    const gates = [];
    async function* ticks(n) {
      try {
        for (let i = 0; ; i++) {
          await new Promise((resolve) => gates.push(resolve));
          yield n + '.' + i;
        }
      } finally {
        closed.push(n);
      }
    }
    const shown = [];
    const dispose = createRoot((d) => {
      const feed = computed(() => ticks(id()));
      effect(() => { shown.push(feed()); });
      return d;
    });
    await drain();
    gates.shift()();
    await drain();
    gates.shift()();
    await drain();
    assert.deepEqual(shown, ['1.0', '1.1']);
    id(2);
    await drain();
    gates.forEach((g) => g());
    gates.length = 0;
    await drain();
    assert.deepEqual(closed, [1]);
    assert.deepEqual(shown, ['1.0', '1.1', '2.0'], 'what the superseded run yielded after it was dropped');
    gates.shift()();
    await drain();
    assert.deepEqual(shown, ['1.0', '1.1', '2.0', '2.1']);
    dispose();
    gates.forEach((g) => g());
    await drain();
    assert.deepEqual(closed, [1, 2]);
  });

  it('disposal aborts the run in flight, drops its result and resolves refresh()', async () => {
    const { computed, refresh, effect, createRoot } = W;
    const api = server();
    const shown = [];
    let users;
    const dispose = createRoot((d) => {
      users = computed(({ signal: abort }) => api.fetch('users', abort));
      effect(() => { shown.push(users()); });
      return d;
    });
    const refreshed = refresh(users);
    dispose();
    assert.equal(api.flights[1].signal.aborted, true);
    await refreshed;
    api.flights.forEach((f) => f.resolve('late'));
    await drain();
    assert.deepEqual(shown, []);
    assert.equal(users.peek(), undefined);
  });
});

describe('errors', () => {
  it('a rejection reaches the nearest ErrorBoundary; reset() fetches again', async () => {
    const { computed, h, mount, ErrorBoundary } = W;
    const api = server();
    const users = computed(() => api.fetch('users#' + api.flights.length));
    const host = document.createElement('div');
    let reset;
    const stop = mount(h(ErrorBoundary, {
      fallback: ({ error, reset: r }) => { reset = r; return h('em', null, error.message); },
    }, h('p', null, () => 'users: ' + users())), host);
    api.fail('users#0');
    await drain();
    assert.equal(host.textContent, 'failed users#0');
    reset();
    await drain();
    assert.deepEqual(api.names(), ['users#0', 'users#1'], 'reset retried the failed computed');
    api.answer('users#1', 'ok');
    await drain();
    assert.equal(host.textContent, 'users: ok');
    stop();
  });

  it('a synchronous throw from an async computed is its error, like a rejection', async () => {
    const { signal, computed, createRoot } = W;
    const api = server();
    const fail = signal(false);
    let users;
    const dispose = createRoot((d) => {
      users = computed(() => {
        if (fail()) throw new Error('bad input');
        return api.fetch('users');
      });
      return d;
    });
    assert.throws(() => users(), (e) => !(e instanceof Error), 'nothing has landed: an untracked read suspends');
    api.answer('users', 'ok');
    await drain();
    fail(true);
    assert.throws(() => users(), /bad input/);
    assert.equal(users.peek(), 'ok', 'peek() keeps the last value that landed');
    dispose();
  });
});

describe('settled()', () => {
  it('resolves once nothing is queued, fetching or open', async () => {
    const { computed, effect, startTransition, signal, settled, createRoot } = W;
    const api = server();
    const id = signal(1);
    const dispose = createRoot((d) => {
      const user = computed(() => api.fetch('user' + id()));
      effect(() => { user(); });
      return d;
    });
    let done = false;
    const quiet = settled().then(() => { done = true; });
    await drain();
    assert.equal(done, false, 'a run is in flight');
    api.answer('user1');
    await quiet;
    void startTransition(() => id(2));
    let afterTransition = false;
    const again = settled().then(() => { afterTransition = true; });
    await drain();
    assert.equal(afterTransition, false, 'the transition is open');
    api.answer('user2');
    await again;
    dispose();
  });
});

describe('use()', () => {
  it('reads a context, a settled promise, and suspends on a pending one', async () => {
    const { use, createContext, h, mount, Suspense } = W;
    const Theme = createContext('light');
    const gate = Promise.withResolvers();
    const data = gate.promise;
    let renders = 0;
    function Card() {
      renders++;
      const theme = use(Theme);
      const value = use(data);
      return h('p', null, theme + ':' + value);
    }
    const host = document.createElement('div');
    const stop = mount(h(Theme, { value: 'dark' }, h(Suspense, { fallback: h('i', null, 'wait') }, h(Card))), host);
    assert.equal(host.textContent, 'wait');
    gate.resolve('ready');
    await drain();
    assert.equal(host.textContent, 'dark:ready');
    assert.equal(renders, 2);
    stop();
  });

  it('a rejected promise throws to the ErrorBoundary', async () => {
    const { use, h, mount, Suspense, ErrorBoundary } = W;
    const gate = Promise.withResolvers();
    function Card() { return h('p', null, use(gate.promise)); }
    const host = document.createElement('div');
    const stop = mount(h(ErrorBoundary, { fallback: ({ error }) => h('em', null, error.message) },
      h(Suspense, { fallback: 'wait' }, h(Card))), host);
    gate.reject(new Error('nope'));
    await drain();
    assert.equal(host.textContent, 'nope');
    stop();
  });
});
