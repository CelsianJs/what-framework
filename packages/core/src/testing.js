// What Framework - Testing Utilities
// Helpers for testing components, similar to @testing-library/react
// Works with Node.js test runner or any test framework

import { signal, effect, flushSync, createRoot, __DEV__, __devtools, __setDevToolsHooks, __depsOf, __subsOf, __ownerPath } from './reactive.js';
import { mount } from './dom.js';
import { h } from './h.js';
import { capture } from './diagnostics.js';
import { settled } from './async.js';

// Resolves once nothing is queued, fetching or in a transition (async.js): act,
// then `await settled()`, then read the DOM.
export { settled };

// Minimal DOM implementation for Node.js
/** @type {HTMLDivElement | null} */
let container = null;

// Every tree render()/renderTest() mounted, so cleanup() can dispose it.
//
// mount() returns the only disposer a tree has, and render() dropped it on the
// floor. cleanup() then cleared innerHTML and detached the container, which
// removes NODES and touches not one effect: every page a suite mounted stayed
// live for the rest of the process, still answering signal writes and still
// running the intervals its onCleanup was supposed to clear. In a real suite
// that showed up as a file that never finished and a worker pinned at 140% CPU,
// which no per-test timeout can interrupt, and as tests that passed alone and
// timed out together. No app could fix it from outside, because the disposer
// render() threw away was the only handle that ever existed.
const mountedTrees = new Set();

// Idempotent and re-entrant: renderTest's own unmount() calls cleanup() at the
// end, so a disposer that is still in the set when cleanup() runs must not fire
// twice. Effect creations are watched from before the mount until after the
// disposal, so a capture can tell which component each effect belongs to.
function trackMount(mountTree) {
  const stopWatching = watchCreations();
  let dispose;
  try {
    dispose = mountTree();
  } catch (err) {
    stopWatching();
    throw err;
  }
  const unmount = () => {
    if (!mountedTrees.has(unmount)) return;
    mountedTrees.delete(unmount);
    try { dispose(); } finally { stopWatching(); }
  };
  mountedTrees.add(unmount);
  return unmount;
}

// --- Setup and Cleanup ---

export function setupDOM() {
  if (typeof document !== 'undefined') {
    // Browser environment
    container = document.createElement('div');
    container.id = 'test-root';
    document.body.appendChild(container);
  }
  return container;
}

export function cleanup() {
  for (const unmount of [...mountedTrees]) {
    try { unmount(); } catch { /* already unmounted */ }
  }
  if (container) {
    container.innerHTML = '';
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  }
}

// --- Render ---

export function render(vnode, options = {}) {
  const { container: customContainer } = options;
  const target = customContainer || setupDOM();

  if (!target) {
    throw new Error('No DOM container available. Are you running in Node.js without jsdom?');
  }

  const unmount = trackMount(() => mount(vnode, target));

  return {
    container: target,
    unmount,
    // Query helpers
    getByText: (text) => queryByText(target, text),
    getByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    getByRole: (role) => target.querySelector(`[role="${role}"]`),
    getAllByText: (text) => queryAllByText(target, text),
    queryByText: (text) => queryByText(target, text),
    queryByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    // Debug
    debug: () => console.log(target.innerHTML),
    // Async utilities
    findByText: (text, timeout) => waitFor(() => queryByText(target, text), { timeout }),
    findByTestId: (id, timeout) => waitFor(() => target.querySelector(`[data-testid="${id}"]`), { timeout }),
  };
}

// --- renderTest ---
// Simplified test renderer: mount a component with props and return
// a test harness with container, signals proxy, update, and unmount.

export function renderTest(Component, props) {
  const target = setupDOM();
  if (!target) {
    throw new Error('No DOM container available. Are you running in Node.js without jsdom?');
  }

  // Track signals created during component render
  const signalRegistry = {};
  /** @type {(() => void) | null} */
  let rootDispose = null;

  // Create a reactive root so we can flush synchronously
  let unmountFn;
  createRoot((dispose) => {
    rootDispose = dispose;
    const vnode = h(Component, props || {});
    unmountFn = trackMount(() => mount(vnode, target));
  });

  return {
    container: target,
    // Proxy to access component signals by name
    signals: new Proxy(signalRegistry, {
      get(obj, prop) {
        if (prop in obj) return obj[prop];
        return undefined;
      },
      set(obj, prop, value) {
        obj[prop] = value;
        return true;
      },
    }),
    // Synchronous flush: run all pending effects immediately
    update() {
      flushSync();
    },
    unmount() {
      if (unmountFn) unmountFn();
      if (rootDispose) rootDispose();
      cleanup();
    },
    // Query helpers
    getByText: (text) => queryByText(target, text),
    getByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    queryByText: (text) => queryByText(target, text),
    debug: () => console.log(target.innerHTML),
  };
}

// --- flushEffects ---
// Synchronous effect flush for testing. Ensures all pending effects
// and microtasks are processed before continuing.

export function flushEffects() {
  flushSync();
}

// --- Development hook listeners ---
//
// trackSignals(), captureDiagnostics() and the effect owner record below listen
// to the engine's development hooks, and several can be open at once
// (overlapping async captures, a capture while a tree is mounted). So
// each adds its own listener to one shared wrapper instead of swapping the
// global hooks: a capture that ends removes only its own listener, and the
// wrapper forwards to whatever hooks were installed underneath it, so installed
// devtools keep working. The wrapper comes out when the last listener leaves.
const hookListeners = {
  onSignalUpdate: new Set(),
  onEffectRun: new Set(),
  onEffectCreate: new Set(),
  onEffectDispose: new Set(),
};
/** @type {WhatDevToolsHooks | null} */
let hookBase = null;
/** @type {WhatDevToolsHooks | null} */
let hookWrapper = null;

// Installs the wrapper for the first listener, and again when other hooks were
// installed over it (devtools, a test): the listeners have heard nothing since,
// so it wraps those instead (the creations made meanwhile went unseen). Only
// development reaches it; the guard lets the per-module production dist drop
// its body.
function ensureWrapper() {
  if (!__DEV__) return;
  if (hookWrapper !== null && __devtools === hookWrapper) return;
  const base = __devtools;
  /** @type {WhatDevToolsHooks} */
  const wrapper = { ...(base || {}) };
  for (const hook of Object.keys(hookListeners)) {
    wrapper[hook] = (...args) => {
      for (const listener of hookListeners[hook]) listener(...args);
      base?.[hook]?.(...args);
    };
  }
  hookBase = base;
  hookWrapper = wrapper;
  __setDevToolsHooks(wrapper);
}

function listenToHook(name, fn) {
  // Only its development-only callers reach this; production builds drop it.
  if (!__DEV__) return () => {};
  hookListeners[name].add(fn);
  ensureWrapper();
  return () => {
    hookListeners[name].delete(fn);
    if (Object.values(hookListeners).some((set) => set.size > 0)) return;
    if (__devtools === hookWrapper) __setDevToolsHooks(hookBase);
    hookWrapper = null;
    hookBase = null;
  };
}

// --- Effect owners ---
//
// Every effect and computed sits in the owner tree: under the component whose
// body, output or region created it, under the effect whose run created it,
// or under a root. Its owner is the components on its __ownerPath(), root
// first, read from the tree when the capture ends (an owner stays readable
// after it is disposed), so it is right however the node was created: in a
// region or a row long after the body ran, in a useEffect or onMount callback,
// or by an effect re-run. It is null when no component holds the node: module
// scope, or a createRoot outside any component.
//
// Which effects exist is another matter: the engine keeps no list. The helpers
// note each creation while they watch (while a tree render() or renderTest()
// mounted is alive, and while a capture is open), so a capture can list the
// effects that did not run. An effect created while nothing watched appears
// only if it runs.

/** The effects and computeds created while something watched. @type {Set<any>} */
const created = new Set();
let watchers = 0;
let unwatch = () => {};

function recordCreation(node) {
  created.add(node);
}

function forgetCreation(node) {
  created.delete(node);
}

// One watch per mounted tree and per open capture. The record is dropped with
// the last watch: disposals after that go unseen, so it would turn stale.
function watchCreations() {
  if (!__DEV__) return () => {};
  if (watchers++ === 0) {
    const stopCreate = listenToHook('onEffectCreate', recordCreation);
    const stopDispose = listenToHook('onEffectDispose', forgetCreation);
    unwatch = () => {
      stopCreate();
      stopDispose();
      created.clear();
    };
  } else {
    ensureWrapper();
  }
  let watching = true;
  return () => {
    if (!watching) return;
    watching = false;
    if (--watchers === 0) unwatch();
  };
}

// The owner path diagnostics print: component names, root first, or null.
function componentPath(node) {
  const path = __ownerPath(node).filter((scope) => scope[0] === '<');
  return path.length ? path : null;
}

// --- trackSignals ---
//
// Reports which named signals a callback reads and writes.
//
// Reads are transitive: reading a computed reports the signals that computed
// depends on, not the computed itself. That is what "which signals does this
// depend on" means in a reactive graph, and it is the question worth asking of
// a callback under test.
//
// A signal created without a debug name has nothing to report, so it appears
// as the single entry UNNAMED rather than vanishing. A caller who sees it
// knows the answer is incomplete and which signal to name; silently returning
// a short list would let an assertion pass for the wrong reason.
const UNNAMED = '(unnamed)';

export function trackSignals(fn) {
  if (!__DEV__) {
    throw new Error(
      '[what] trackSignals() requires a development build. Signal debug names ' +
      'and the dependency graph API are stripped in production, so there is ' +
      'nothing to report. Run your tests with NODE_ENV !== "production".'
    );
  }

  const accessed = [];
  const written = [];
  const addOnce = (list, name) => { if (!list.includes(name)) list.push(name); };

  // Writes: every signal write calls the onSignalUpdate hook in development,
  // so this sees writes to signals that existed long before this call.
  const stopWrites = listenToHook('onSignalUpdate', (sig) => addOnce(written, sig?._debugName || UNNAMED));

  // Reads: fn runs inside an effect, reached through a probe signal the effect
  // also reads (effect() returns a disposer, not the node): after the run the
  // probe's only subscriber is that effect, and __depsOf lists what it read.
  // A dependency is a signal (its function) or a computed (its node), whose
  // own dependencies are the sources to follow.
  const probe = signal(0, '__trackSignals_probe__');
  // Held in a box rather than a `let`: the assignment happens inside
  // createRoot's callback, and the finally below has to run it whether the
  // tracked fn returned or threw.
  /** @type {{ current: (() => void) | null }} */
  const root = { current: null };
  let thrown = null;

  const collectReads = (node, seen) => {
    for (const dep of __depsOf(node)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (typeof dep === 'function') {
        addOnce(accessed, dep._debugName || UNNAMED);
      } else {
        collectReads(dep, seen);
      }
    }
  };

  try {
    createRoot((disposeRoot) => {
      root.current = disposeRoot;
      effect(() => {
        probe();
        fn();
      });
    });

    // The probe itself is not one of fn's reads.
    const seen = new Set([probe]);
    for (const reader of __subsOf(probe)) collectReads(reader, seen);
  } catch (err) {
    thrown = err;
  } finally {
    // Dependencies are read before this: disposal clears them.
    root.current?.();
    stopWrites();
  }

  if (thrown) throw thrown;
  return { accessed, written };
}

// --- captureDiagnostics ---
//
// Runs a callback and returns the diagnostics it reported plus how many times
// each effect ran, so a test can fail on a new diagnostic code or on reactive
// work it did not expect without scraping the console. Effects and computeds
// are named by their function's name, '(anonymous)' otherwise; `effects` lists
// each one with its owner, including the known ones that did not run, so an
// assertion can tell an idle effect from a misspelled name.
//
// Reports are kept off the console while the capture is open; the events carry
// the same message and fix the console would have printed.
// Effect runs are counted through the shared hook listener above, so captures
// that overlap (two async tests at once) each see every run made while they are
// open, installed devtools keep working, and the hooks are restored even when
// fn throws.

function effectName(node) {
  return (node.fn?.inner ?? node.fn)?.name || '(anonymous)';
}

export function captureDiagnostics(fn) {
  if (!__DEV__) {
    throw new Error(
      '[what] captureDiagnostics() requires a development build: production builds ' +
      'report no diagnostics, so an empty result would look like a pass. Run your ' +
      'tests with NODE_ENV !== "production".'
    );
  }

  const cap = capture({ quiet: true });
  const stopWatching = watchCreations();
  // node -> runs: what existed when the capture opened, then each node as it
  // is created or runs, kept when a disposal drops it from the watch.
  const seen = new Map();
  for (const node of created) seen.set(node, 0);
  const stopRuns = listenToHook('onEffectRun', (node) => {
    seen.set(node, (seen.get(node) ?? 0) + 1);
  });

  const finish = () => {
    stopRuns();
    for (const node of created) if (!seen.has(node)) seen.set(node, 0);
    stopWatching();
    const runs = {};
    const effects = [];
    for (const [node, ran] of seen) {
      const name = effectName(node);
      if (ran > 0) runs[name] = (runs[name] || 0) + ran;
      effects.push({
        name,
        kind: 'subHead' in node ? 'computed' : 'effect',
        owner: componentPath(node),
        runs: ran,
      });
    }
    return { events: cap.stop(), runs, effects };
  };

  let result;
  try {
    result = fn();
  } catch (err) {
    finish();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      (value) => ({ ...finish(), result: value }),
      (err) => { finish(); throw err; },
    );
  }
  return { ...finish(), result };
}

function describeEvents(events) {
  return events.map((e) => {
    const lines = [`  ${e.code}${e.count > 1 ? ` ×${e.count}` : ''} ${e.message}`];
    if (e.owner?.length) lines.push(`    in ${e.owner.join(' › ')}`);
    if (e.loc) lines.push(`    at ${e.loc}`);
    lines.push(`    fix: ${e.fix}`);
    return lines.join('\n');
  }).join('\n');
}

/**
 * Fail unless the capture holds no diagnostics, other than codes in `allow`.
 * @param {{ events: any[] }} captured result of captureDiagnostics()
 * @param {{ allow?: string[] }} [options]
 */
export function expectNoDiagnostics(captured, { allow = [] } = {}) {
  const unexpected = captured.events.filter((e) => !allow.includes(e.code));
  if (unexpected.length) {
    throw new Error(`Expected no diagnostics, got ${unexpected.length}:\n${describeEvents(unexpected)}`);
  }
}

// expectDiagnostic() and expectRuns() take the same count options: `exact`, or
// `min` and/or `max`. With none of them the count is "at least once".
const COUNT_OPTIONS = ['exact', 'min', 'max'];

function readCount(helper, options, names) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(`[what] ${helper}() takes an options object: { ${names.join(', ')} }.`);
  }
  for (const key of Object.keys(options)) {
    if (!names.includes(key)) {
      throw new TypeError(`[what] ${helper}(): unknown option "${key}". The options are ${names.join(', ')}.`);
    }
  }
  for (const key of COUNT_OPTIONS) {
    const n = options[key];
    if (n !== undefined && !(Number.isInteger(n) && n >= 0)) {
      throw new TypeError(`[what] ${helper}(): ${key} must be a whole number of 0 or more, got ${String(n)}.`);
    }
  }
  const { exact, min, max } = options;
  if (exact !== undefined && (min !== undefined || max !== undefined)) {
    throw new TypeError(`[what] ${helper}(): exact cannot be combined with min or max.`);
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new TypeError(`[what] ${helper}(): min (${min}) is greater than max (${max}).`);
  }
  const lo = exact ?? min ?? (max === undefined ? 1 : 0);
  const hi = exact ?? max ?? Infinity;
  let text = `between ${lo} and ${hi} times`;
  if (lo === hi) text = `exactly ${lo} time(s)`;
  else if (hi === Infinity) text = `at least ${lo} time(s)`;
  else if (lo === 0) text = `at most ${hi} time(s)`;
  return { lo, hi, text };
}

function readName(helper, key, value) {
  if (value !== undefined && (typeof value !== 'string' || value === '')) {
    throw new TypeError(`[what] ${helper}(): ${key} must be a non-empty string, got ${String(value)}.`);
  }
  return value;
}

/**
 * Fail unless the capture holds `code` and no other code, reported the given
 * number of times (at least once by default). A repeat on the same subject
 * folds into one event's `count`, so the occurrences are the counts added up.
 * @param {{ events: any[] }} captured result of captureDiagnostics()
 * @param {{ code: string, exact?: number, min?: number, max?: number }} options
 */
export function expectDiagnostic(captured, options) {
  const count = readCount('expectDiagnostic', options, ['code', ...COUNT_OPTIONS]);
  const code = readName('expectDiagnostic', 'code', options.code);
  if (code === undefined) throw new TypeError('[what] expectDiagnostic(): code, the ERR_* code to expect, is required.');
  if (captured.events.some((e) => e.code !== code)) {
    throw new Error(`Expected exactly ${code}, got:\n${describeEvents(captured.events)}`);
  }
  const reported = captured.events.reduce((sum, e) => sum + e.count, 0);
  if (reported < count.lo || reported > count.hi) {
    const got = reported ? `${reported}:\n${describeEvents(captured.events)}` : 'none.';
    throw new Error(`Expected ${code} ${count.text}, got ${got}`);
  }
}

function describeRuns(effects) {
  const lines = new Map();
  for (const e of effects) {
    if (e.runs === 0) continue;
    const where = e.owner === null ? ' · outside any component' : ` in ${e.owner.join(' › ')}`;
    const label = `${e.name}${e.kind === 'computed' ? ' (computed)' : ''}`;
    const key = `${label}\n${where}`;
    const line = lines.get(key);
    if (line) line.runs += e.runs;
    else lines.set(key, { label, where, runs: e.runs });
  }
  if (lines.size === 0) return 'No effect ran during the capture.';
  const sorted = [...lines.values()].sort((a, b) => b.runs - a.runs);
  return `All runs:\n${sorted.map((l) => `  ${l.label}: ${l.runs}${l.where}`).join('\n')}`;
}

/**
 * Fail unless the selected effects ran the given number of times during the
 * capture (at least once by default). `effect` selects by function name,
 * `component` by the component that created them, components inside it
 * included; with neither, every effect and computed run of the capture counts.
 * A name or component that matches no effect that ran or was known to exist
 * throws, listing what did run. An effect outside any component (`owner`
 * null) is in no component's count.
 * @param {{ effects: Array<{ name: string, kind: string, owner: string[] | null, runs: number }> }} captured result of captureDiagnostics()
 * @param {{ effect?: string, component?: string, exact?: number, min?: number, max?: number }} [options]
 */
export function expectRuns(captured, options = {}) {
  const count = readCount('expectRuns', options, ['effect', 'component', ...COUNT_OPTIONS]);
  const name = readName('expectRuns', 'effect', options.effect);
  const component = readName('expectRuns', 'component', options.component);
  const tag = component === undefined ? null : `<${component}>`;

  let matched = name === undefined && tag === null;
  let ran = 0;
  for (const e of captured.effects) {
    if (name !== undefined && e.name !== name) continue;
    if (tag !== null && !e.owner?.includes(tag)) continue;
    matched = true;
    ran += e.runs;
  }

  const subject = name === undefined
    ? (tag === null ? 'all effects together' : `effects in ${tag}`)
    : `effect "${name}"${tag === null ? '' : ` in ${tag}`}`;
  const they = name === undefined ? 'they' : 'it';
  const runs = describeRuns(captured.effects);
  if (!matched) {
    const which = `${name === undefined ? '' : ` named "${name}"`}${tag === null ? '' : ` created in ${tag}`}`;
    throw new Error(
      `Expected ${subject} to run ${count.text}, but no effect${which} ran or was known to exist during ` +
      'the capture. An effect that did not run is known only when it was created inside a ' +
      `render()/renderTest() tree or the capture.\n${runs}`
    );
  }

  if (ran >= count.lo && ran <= count.hi) return;
  throw new Error(`Expected ${subject} to run ${count.text}, ${they} ran ${ran}.\n${runs}`);
}

// --- mockSignal ---
// Signal with full history tracking for testing.

export function mockSignal(name, initialValue) {
  const history = [initialValue];
  let setCount = 0;

  const s = signal(initialValue, name);
  const origSet = s.set;

  // Override set to track history
  s.set = function(next) {
    const nextVal = typeof next === 'function' ? next(s.peek()) : next;
    if (!Object.is(s.peek(), nextVal)) {
      setCount++;
      history.push(nextVal);
    }
    return origSet(nextVal);
  };

  // Also override the unified call syntax for writes
  const origFn = s;
  const mock = function(...args) {
    if (args.length === 0) {
      return origFn();
    }
    // Write path
    const nextVal = typeof args[0] === 'function' ? args[0](origFn.peek()) : args[0];
    if (!Object.is(origFn.peek(), nextVal)) {
      setCount++;
      history.push(nextVal);
    }
    return origFn(nextVal);
  };

  // Copy signal properties
  mock._signal = true;
  mock.peek = s.peek;
  mock.set = s.set;
  mock.subscribe = s.subscribe;
  if (s._debugName) mock._debugName = s._debugName;

  // Testing-specific properties
  Object.defineProperty(mock, 'history', {
    get() { return history; },
  });
  Object.defineProperty(mock, 'setCount', {
    get() { return setCount; },
  });
  mock.reset = function(value) {
    const resetVal = value !== undefined ? value : initialValue;
    history.length = 0;
    history.push(resetVal);
    setCount = 0;
    origFn(resetVal);
  };

  return mock;
}

// --- Query Helpers ---

function queryByText(container, text) {
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const content = node.textContent || '';
    const matches = regex ? regex.test(content) : content.includes(text);
    if (matches) {
      return node.parentElement;
    }
  }
  return null;
}

function queryAllByText(container, text) {
  const results = [];
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const content = node.textContent || '';
    const matches = regex ? regex.test(content) : content.includes(text);
    if (matches) {
      results.push(node.parentElement);
    }
  }
  return results;
}

// --- Fire Events ---

export const fireEvent = {
  click(element) {
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: typeof window !== 'undefined' ? window : undefined,
    });
    element.dispatchEvent(event);
    return event;
  },

  change(element, value) {
    element.value = value;
    const event = new Event('input', { bubbles: true });
    element.dispatchEvent(event);
    const changeEvent = new Event('change', { bubbles: true });
    element.dispatchEvent(changeEvent);
    return changeEvent;
  },

  input(element, value) {
    element.value = value;
    const event = new Event('input', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  submit(element) {
    const event = new Event('submit', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  },

  focus(element) {
    element.focus();
    const event = new FocusEvent('focus', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  blur(element) {
    element.blur();
    const event = new FocusEvent('blur', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  keyDown(element, key, options = {}) {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    });
    element.dispatchEvent(event);
    return event;
  },

  keyUp(element, key, options = {}) {
    const event = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    });
    element.dispatchEvent(event);
    return event;
  },

  mouseEnter(element) {
    const event = new MouseEvent('mouseenter', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  mouseLeave(element) {
    const event = new MouseEvent('mouseleave', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
};

// --- Wait Utilities ---

export async function waitFor(callback, options = {}) {
  const { timeout = 1000, interval = 50 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = callback();
      if (result) return result;
    } catch {
      // Keep waiting
    }
    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

export async function waitForElementToBeRemoved(callback, options = {}) {
  const { timeout = 1000, interval = 50 } = options;
  const startTime = Date.now();

  // First, element should exist
  let element = callback();
  if (!element) {
    throw new Error('Element not found');
  }

  // Then wait for it to be removed
  while (Date.now() - startTime < timeout) {
    element = callback();
    if (!element) return;
    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error(`Element still present after ${timeout}ms`);
}

// --- Act ---
// Run `callback`, then wait until what it started has landed and committed:
// queued effects, async values it made fetch, transitions it opened.

export async function act(callback) {
  const result = await callback();
  flushSync();
  await /** @type {Promise<void>} */ (new Promise(r => queueMicrotask(() => r())));
  await /** @type {Promise<void>} */ (new Promise(r => setTimeout(() => r(), 0)));
  await settled();
  return result;
}

// --- Signal Testing Helpers ---

export function createTestSignal(initial) {
  const s = signal(initial);
  const history = [initial];

  // Track all changes
  effect(() => {
    history.push(s());
  });

  return {
    signal: s,
    get value() { return s(); },
    set value(v) { s.set(v); },
    history,
    reset() {
      history.length = 0;
      history.push(s());
    },
  };
}

// --- Mocking ---

export function mockComponent(name = 'MockComponent') {
  const calls = [];

  function Mock(props) {
    calls.push({ props, timestamp: Date.now() });
    return h('div', { 'data-testid': `mock-${name}` },
      JSON.stringify(props, null, 2)
    );
  }

  Mock.displayName = name;
  Mock.calls = calls;
  Mock.lastCall = () => calls[calls.length - 1];
  Mock.reset = () => { calls.length = 0; };

  return Mock;
}

// --- Assertions ---

export const expect = {
  toBeInTheDocument(element) {
    if (!element || !element.parentNode) {
      throw new Error('Expected element to be in the document');
    }
  },

  toHaveTextContent(element, text) {
    if (!element) {
      throw new Error('Element not found');
    }
    const content = element.textContent;
    const matches = text instanceof RegExp ? text.test(content) : content.includes(text);
    if (!matches) {
      throw new Error(`Expected "${content}" to contain "${text}"`);
    }
  },

  toHaveAttribute(element, attr, value) {
    if (!element) {
      throw new Error('Element not found');
    }
    const attrValue = element.getAttribute(attr);
    if (value !== undefined && attrValue !== value) {
      throw new Error(`Expected attribute "${attr}" to be "${value}", got "${attrValue}"`);
    }
    if (value === undefined && attrValue === null) {
      throw new Error(`Expected element to have attribute "${attr}"`);
    }
  },

  toHaveClass(element, className) {
    if (!element) {
      throw new Error('Element not found');
    }
    if (!element.classList.contains(className)) {
      throw new Error(`Expected element to have class "${className}"`);
    }
  },

  toBeVisible(element) {
    if (!element) {
      throw new Error('Element not found');
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      throw new Error('Expected element to be visible');
    }
  },

  toBeDisabled(element) {
    if (!element) {
      throw new Error('Element not found');
    }
    if (!element.disabled) {
      throw new Error('Expected element to be disabled');
    }
  },

  toHaveValue(element, value) {
    if (!element) {
      throw new Error('Element not found');
    }
    if (element.value !== value) {
      throw new Error(`Expected value to be "${value}", got "${element.value}"`);
    }
  },
};

// --- Screen ---
// Global query object for convenience

export const screen = {
  getByText: (text) => queryByText(document.body, text),
  getByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  getByRole: (role) => document.querySelector(`[role="${role}"]`),
  getAllByText: (text) => queryAllByText(document.body, text),
  queryByText: (text) => queryByText(document.body, text),
  queryByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  debug: () => console.log(document.body.innerHTML),
};
