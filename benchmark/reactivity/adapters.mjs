import * as what from "../../packages/core/src/reactive.js";
import * as solid1 from "solid-js/dist/solid.js";
import * as solid2 from "@solidjs/signals";
import * as alien from "alien-signals";
import * as preact from "@preact/signals-core";

function scoped(api, setup) {
  const disposers = [];
  return {
    ...api,
    withBuild(fn) {
      return setup(fn, disposers);
    },
    cleanup() {
      while (disposers.length) disposers.pop()();
    },
  };
}

function rooted(api, createRoot, build = (fn) => fn()) {
  return scoped(api, (fn, disposers) => build(() => createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  })));
}

// The harness effect contract returns void, even where a workload's arrow
// function incidentally returns a number. Alien treats returns as cleanups.
function voidEffect(createEffect) {
  return (fn) => createEffect(() => { fn(); });
}

function pair([read, write]) {
  return { read, write };
}

function callable(signal) {
  return { read: signal, write: signal };
}

// What's computed is lazy and effects run immediately when created. Use a root
// for graph ownership and batch for each transaction: its outer exit drains
// effects synchronously. Bare writes would wait for a microtask; flushSync
// would add a second drain here. Use normal effects for dynamic dependencies.
export const frameworks = {
  what: {
    testPullCounts: true,
    framework: rooted({
      name: "what",
      signal: (value) => callable(what.signal(value)),
      computed: (fn) => ({ read: what.computed(fn) }),
      effect: voidEffect(what.effect),
      withBatch: what.batch,
    }, what.createRoot),
  },
  solid1: {
    testPullCounts: false,
    framework: rooted({
      name: "solid1",
      signal: (value) => pair(solid1.createSignal(value)),
      computed: (fn) => ({ read: solid1.createMemo(fn) }),
      effect: voidEffect(solid1.createEffect),
      withBatch: solid1.batch,
    }, solid1.createRoot),
  },
  solid2: {
    testPullCounts: true,
    framework: rooted({
      name: "solid2",
      signal: (value) => pair(solid2.createSignal(value)),
      computed: (fn) => ({ read: solid2.createMemo(fn, { lazy: true }) }),
      // The harness gives us one tracked callback, including its JS counters.
      // No workload writes reactive state from that callback.
      effect: voidEffect((fn) => solid2.createEffect(fn, () => {})),
      withBatch: solid2.flush,
    }, solid2.createRoot, solid2.flush),
  },
  alien: {
    testPullCounts: true,
    framework: scoped({
      name: "alien",
      signal: (value) => callable(alien.signal(value)),
      computed: (fn) => ({ read: alien.computed(fn) }),
      effect: voidEffect(alien.effect),
      withBatch(fn) {
        alien.startBatch();
        try {
          return fn();
        } finally {
          alien.endBatch();
        }
      },
    }, (fn, disposers) => {
      let result;
      const dispose = alien.effectScope(() => { result = fn(); });
      disposers.push(dispose);
      return result;
    }),
  },
  preact: {
    testPullCounts: true,
    framework: scoped({
      name: "preact",
      signal(value) {
        const s = preact.signal(value);
        return { read: () => s.value, write: (next) => { s.value = next; } };
      },
      computed(fn) {
        const c = preact.computed(fn);
        return { read: () => c.value };
      },
      effect(fn) {
        preactDisposers.push(preact.effect(() => { fn(); }));
      },
      withBatch: preact.batch,
    }, (fn, disposers) => {
      const start = preactDisposers.length;
      disposers.push(() => {
        while (preactDisposers.length > start) preactDisposers.pop()();
      });
      return fn();
    }),
  },
};

const preactDisposers = [];
