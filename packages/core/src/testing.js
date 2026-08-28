// What Framework - Testing Utilities
// Helpers for testing components, similar to @testing-library/react
// Works with Node.js test runner or any test framework

import { signal, effect, flushSync, createRoot, __DEV__, __devtools, __setDevToolsHooks } from './reactive.js';
import { mount } from './dom.js';
import { h } from './h.js';

// Minimal DOM implementation for Node.js
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
// twice.
function trackMount(dispose) {
  const unmount = () => {
    if (!mountedTrees.has(unmount)) return;
    mountedTrees.delete(unmount);
    dispose();
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

  const unmount = trackMount(mount(vnode, target));

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
  let rootDispose = null;

  // Create a reactive root so we can flush synchronously
  let unmountFn;
  createRoot((dispose) => {
    rootDispose = dispose;
    const vnode = h(Component, props || {});
    unmountFn = trackMount(mount(vnode, target));
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

// --- trackSignals ---
// Track signal reads and writes within a callback.
// Returns { accessed: string[], written: string[] }

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
      'and subscriber back-references are stripped in production, so there is ' +
      'nothing to report. Run your tests with NODE_ENV !== "production".'
    );
  }

  const accessed = [];
  const written = [];
  const addOnce = (list, name) => { if (!list.includes(name)) list.push(name); };

  // --- Writes ---
  //
  // Every signal write calls __devtools.onSignalUpdate(sig) in dev, and
  // __devtools is consulted at write time rather than at creation time, so
  // this catches writes to signals that existed long before this call.
  // Chain the previous hooks rather than replacing them: otherwise running a
  // test would silently disable installed devtools for the duration.
  const previousHooks = __devtools;
  const trackingHooks = {
    ...(previousHooks || {}),
    onSignalUpdate(sig) {
      addOnce(written, sig?._debugName || UNNAMED);
      previousHooks?.onSignalUpdate?.(sig);
    },
  };
  // A chained hook must not claim to be the pre-install buffer, or the real
  // devtools would later try to drain it a second time.
  delete trackingHooks.__isPreinstallBuffer;

  // --- Reads ---
  //
  // Reading a signal inside an effect adds that effect to the signal's
  // subscriber Set and pushes the Set onto effect.deps. effect() returns a
  // dispose function rather than the effect, so the effect is reached through
  // a probe signal: after the run, the probe's subscriber Set holds exactly
  // the effect that read it.
  const probe = signal(0, '__trackSignals_probe__');
  // Held in a box rather than a `let`: the assignment happens inside
  // createRoot's callback, and the finally below has to run it whether the
  // tracked fn returned or threw.
  /** @type {{ current: (() => void) | null }} */
  const root = { current: null };
  let thrown = null;

  const collectReads = (depSets, seen) => {
    for (const depSet of depSets || []) {
      if (seen.has(depSet)) continue;
      seen.add(depSet);
      const sig = depSet._signalOwner;
      if (sig) {
        if (sig !== probe) addOnce(accessed, sig._debugName || UNNAMED);
        continue;
      }
      // Not a signal's Set, so it belongs to a computed. `_owner` is that
      // computed's inner effect; its own deps are the sources to follow.
      const owner = depSet._owner;
      if (owner?.deps) collectReads(owner.deps, seen);
    }
  };

  __setDevToolsHooks(trackingHooks);
  try {
    createRoot((disposeRoot) => {
      root.current = disposeRoot;
      effect(() => {
        probe();
        fn();
      });
    });

    const seen = new Set();
    for (const tracked of probe._subs) collectReads(tracked.deps, seen);
  } catch (err) {
    thrown = err;
  } finally {
    // Deps are read before this: disposal clears them.
    root.current?.();
    __setDevToolsHooks(previousHooks);
  }

  if (thrown) throw thrown;
  return { accessed, written };
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
  if (s._subs) mock._subs = s._subs;

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
// Ensure all effects and updates are flushed

export async function act(callback) {
  const result = await callback();
  // Synchronously flush all pending effects
  flushSync();
  // Wait for microtasks to flush
  await /** @type {Promise<void>} */ (new Promise(r => queueMicrotask(() => r())));
  // Wait for any scheduled effects
  await /** @type {Promise<void>} */ (new Promise(r => setTimeout(() => r(), 0)));
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
