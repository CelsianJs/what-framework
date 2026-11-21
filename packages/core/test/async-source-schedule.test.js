import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { installDOM, flushMicrotasks } from '../../../test-utils/dom.js';
import { asyncComputedOracle, asyncSourceOracle, schedules } from './fixtures/async-source-schedule.js';

let core;
let data;
let env;
before(async () => {
  env = installDOM();
  core = await import('what-framework');
  data = await import('what-framework/data');
});
after(() => env.cleanup());

const adapters = {
  // createResource's data is an async computed: read in a binding before it
  // lands, it holds the binding (docs/ASYNC.md). This observer shows the last
  // value that landed, with peek(), and re-runs on loading() and error().
  createResource(fetch) {
    const [value, controls] = core.createResource(fetch);
    return { value: value.peek, error: controls.error, pending: controls.loading, supersede: controls.refetch };
  },
  useQuery(fetch, key, delivered) {
    const query = data.useQuery({
      queryKey: key, queryFn: fetch, retry: 0, refetchOnWindowFocus: false,
      onSuccess: value => delivered.push(value), onError: error => delivered.push(error.message),
    });
    return { value: query.data, error: query.error, pending: query.isFetching, supersede: query.refetch };
  },
  useSWR(fetch, key, delivered) {
    const swr = data.useSWR(key, fetch, {
      revalidateOnFocus: false, revalidateOnReconnect: false,
      onSuccess: value => delivered.push(value), onError: error => delivered.push(error.message),
    });
    return {
      value: swr.data, error: swr.error, pending: swr.isValidating,
      supersede: () => data.invalidateQueries(key),
    };
  },
};

for (const [source, adapt] of Object.entries(adapters)) {
  describe(source + ' virtual completion order', () => {
    for (const [index, schedule] of schedules().entries()) {
      it(schedule.map(step => step.join(' ')).join(' → '), async (t) => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
        const model = asyncSourceOracle();
        const flights = new Map();
        const delivered = [];
        const expectedDelivered = [];
        const failures = [];
        let active;
        let stop;
        let request;
        let starts = 0;
        const fetch = () => {
          const flight = Promise.withResolvers();
          starts++;
          flights.set(request, flight);
          return flight.promise;
        };
        const key = 'schedule/' + source + '/' + index;
        function Observer() {
          active = adapt(fetch, key, delivered);
          return core.h('output', null, () => JSON.stringify({
            data: active.value() ?? null,
            error: active.error()?.message ?? null,
            pending: active.pending(),
          }));
        }

        try {
          const host = env.document.getElementById('app');
          for (const step of schedule) {
            const [action, name] = step;
            const expected = model.step(step);
            t.mock.timers.tick(1);
            request = name;
            if (action === 'mount') stop = core.mount(core.h(Observer), host);
            else if (action === 'supersede') void Promise.resolve(active.supersede()).catch(() => {});
            else if (action === 'dispose') { stop(); stop = null; }
            else if (action === 'resolve') flights.get(name)?.resolve(name);
            else flights.get(name)?.reject(new Error('failed ' + name));

            // Settle Promise continuations and their batched DOM effects.
            await flushMicrotasks();
            core.flushSync();
            const view = host.querySelector('output');
            const actual = { starts, view: view ? JSON.parse(view.textContent) : null };
            if (source !== 'createResource' && expected.view && !expected.view.pending) {
              if (action === 'resolve' && expected.view.data === name) expectedDelivered.push(name);
              if (action === 'reject' && expected.view.error === 'failed ' + name) expectedDelivered.push('failed ' + name);
            }
            if (JSON.stringify(actual) !== JSON.stringify(expected) ||
                JSON.stringify(delivered) !== JSON.stringify(expectedDelivered)) {
              failures.push({ step: step.join(' '), expected, actual, expectedDelivered: [...expectedDelivered], delivered: [...delivered] });
            }
          }
          assert.deepEqual(failures, []);
        } finally {
          stop?.();
          for (const pending of flights.values()) pending.resolve('cleanup');
          await flushMicrotasks();
          data.clearCache();
        }
      });
    }
  });
}

it('SWR late settlement cannot make another reader refetch an active replacement', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const key = 'schedule/shared replacement';
  const requests = [];
  const delivered = [];
  const fetch = () => {
    const flight = Promise.withResolvers();
    requests.push(flight);
    return flight.promise;
  };
  const options = {
    revalidateOnFocus: false, revalidateOnReconnect: false,
    onSuccess: value => delivered.push(value),
  };
  function Reader() {
    const result = data.useSWR(key, fetch, options);
    return core.h('output', null, () => result.data() ?? (result.isValidating() ? 'pending' : 'idle'));
  }
  const first = env.document.createElement('div');
  const second = env.document.createElement('div');
  const stop = core.mount(core.h(Reader), first);
  let stopSecond;
  try {
    data.invalidateQueries(key);
    assert.equal(requests.length, 2);
    requests[0].resolve('obsolete');
    await flushMicrotasks();
    stopSecond = core.mount(core.h(Reader), second);
    const startsBeforeReplacementSettles = requests.length;
    requests[1].resolve('replacement');
    await flushMicrotasks();
    core.flushSync();
    assert.deepEqual({
      startsBeforeReplacementSettles, delivered, views: [first.textContent, second.textContent],
    }, {
      startsBeforeReplacementSettles: 2, delivered: ['replacement'], views: ['replacement', 'replacement'],
    });
  } finally {
    stopSecond?.();
    stop();
    for (const request of requests) request.resolve('cleanup');
    await flushMicrotasks();
    data.clearCache();
  }
});

// Settle every promise continuation: the timer mocks leave setImmediate real.
const drain = () => new Promise((resolve) => setImmediate(resolve));

for (const mode of ['default', 'suspense', 'transition', 'optimistic']) {
  describe('async computed (' + mode + ') virtual completion order', () => {
    for (const schedule of schedules()) {
      it(schedule.map(step => step.join(' ')).join(' → '), async (t) => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
        const { h, signal, computed, useOptimistic, startTransition, onMount, Suspense, mount, settled, flushSync } = core;
        const model = asyncComputedOracle(mode);
        const flights = new Map();
        const failures = [];
        let starts = 0;
        let mounts = 0;
        let live = null;
        let stop = null;
        let current = null;
        const fetchFor = (name, abort) => {
          const flight = Promise.withResolvers();
          starts++;
          flights.set(name, { ...flight, abort });
          return flight.promise;
        };
        function Content(props) {
          onMount(() => { mounts++; });
          return props.body;
        }
        function Observer(props) {
          const source = signal(props.name);
          const value = computed(({ signal: abort }) => fetchFor(source(), abort));
          let shown = value;
          let add = null;
          if (mode === 'optimistic') [shown, add] = useOptimistic(value, (_, overlay) => overlay);
          live = { source, value, add };
          const body = h('output', null,
            h('span', { class: 'shown' }, () => {
              try {
                return 'v:' + shown();
              } catch (error) {
                if (error instanceof Error) return 'e:' + error.message;
                throw error;
              }
            }),
            h('span', { class: 'pending' }, () => String(value.pending())),
            h('span', { class: 'label' }, () => source()));
          return mode === 'suspense'
            ? h(Suspense, { fallback: h('i', { class: 'fallback' }, 'fb') }, h(Content, { body }))
            : body;
        }

        const host = env.document.getElementById('app');
        const consoleError = console.error;
        console.error = () => {};
        try {
          for (const step of schedule) {
            const [action, name] = step;
            const expected = model.step(step);
            const before = live?.value.peek();
            const superseded = current;
            if (action === 'mount') {
              stop = mount(h(Observer, { name }), host);
              current = name;
            } else if (action === 'supersede') {
              current = name;
              if (mode === 'default' || mode === 'suspense') live.source(name);
              else if (mode === 'transition') void startTransition(() => live.source(name));
              else void startTransition(() => { live.add('opt:' + name); live.source(name); });
            } else if (action === 'dispose') {
              stop();
              stop = null;
              current = null;
            } else if (action === 'resolve') {
              flights.get(name)?.resolve(name);
            } else {
              flights.get(name)?.reject(new Error('failed ' + name));
            }
            if (action === 'resolve' || action === 'reject') {
              if (name === current) current = null;
            }
            await drain();
            flushSync();
            await drain();
            const out = host.querySelector('output');
            const text = (cls) => (out ? out.querySelector('.' + cls).textContent : null);
            const view = stop === null ? null : {
              shown: text('shown'),
              pending: out ? text('pending') === 'true' : null,
              label: text('label'),
            };
            if (view !== null && mode === 'suspense') Object.assign(view, { fallback: host.querySelector('.fallback') !== null, mounts });
            const actual = { starts, view };
            if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ step: step.join(' '), expected, actual });
            // A superseded run, or the run of a disposed computed, is aborted.
            if ((action === 'supersede' || action === 'dispose') && superseded !== null && !flights.get(superseded).abort.aborted) {
              failures.push({ step: step.join(' '), notAborted: superseded });
            }
            // Nothing lands in a disposed computed.
            if (stop === null && action !== 'dispose' && live !== null && live.value.peek() !== before) {
              failures.push({ step: step.join(' '), deliveredAfterDispose: live.value.peek() });
            }
          }
          for (const flight of flights.values()) flight.resolve('cleanup');
          stop?.();
          stop = null;
          await drain();
          const quiet = await Promise.race([settled().then(() => 'settled'), drain().then(drain).then(() => 'busy')]);
          if (quiet !== 'settled') failures.push({ settled: quiet });
          assert.deepEqual(failures, []);
        } finally {
          console.error = consoleError;
          stop?.();
          for (const flight of flights.values()) flight.resolve('cleanup');
          await drain();
        }
      });
    }
  });
}
