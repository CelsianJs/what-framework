// Tests for What Framework - Dev-mode warnings and error messages
// Validates that hooks throw clear errors outside components,
// signal.set inside computed warns, and useEffect dep validation works.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

// Now import framework
const { signal, computed, effect, batch, flushSync } = await import('../src/reactive.js');
const { h, Fragment } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');

const {
  useState,
  useSignal,
  useComputed,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useReducer,
  onMount,
  onCleanup,
} = await import('../src/hooks.js');

// Helper: flush microtask queue (multiple rounds for nested scheduling)
async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => queueMicrotask(r));
  }
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// =========================================================================
// Task 1: Hooks outside components throw clear errors
// =========================================================================

describe('hooks outside component context', () => {
  it('useSignal throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useSignal(0),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useSignal()'));
        assert(err.message.includes('can only be called inside a component function'));
        assert(err.message.includes('Did you call it outside of a component or in an async callback'));
        return true;
      }
    );
  });

  it('useState throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useState(0),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useState()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('useComputed throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useComputed(() => 42),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useComputed()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('useEffect throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useEffect(() => {}),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useEffect()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('useRef throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useRef(null),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useRef()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('useCallback throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useCallback(() => {}),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useCallback()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('useMemo throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useMemo(() => 42),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useMemo()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('useReducer throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => useReducer((s, a) => s, 0),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('useReducer()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('onMount throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => onMount(() => {}),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('onMount()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('onCleanup throws with clear error mentioning the hook name', () => {
    assert.throws(
      () => onCleanup(() => {}),
      (err) => {
        assert(err instanceof Error);
        assert(err.message.includes('onCleanup()'));
        assert(err.message.includes('can only be called inside a component function'));
        return true;
      }
    );
  });

  it('hooks inside a component do NOT throw', () => {
    const container = getContainer();
    let captured;

    function TestComponent() {
      // All of these should work without throwing
      const sig = useSignal(0);
      const [state, setState] = useState(1);
      const comp = useComputed(() => sig() * 2);
      const ref = useRef(null);
      const cb = useCallback(() => {}, []);
      const memo = useMemo(() => 42, []);
      captured = { sig, state, comp, ref, cb, memo };
      return h('div', null, 'ok');
    }

    assert.doesNotThrow(() => mount(h(TestComponent), container));
    assert.equal(typeof captured.sig, 'function');
    assert.equal(captured.sig(), 0);
  });
});

// =========================================================================
// Task 2: signal.set() inside computed() warns
// =========================================================================

describe('signal.set inside computed warns', () => {
  it('should warn when signal.set() is called inside computed()', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const count = signal(0);
      const other = signal(0);

      // This computed calls other.set() which should trigger a warning
      const bad = computed(() => {
        other.set(count() * 2);
        return count();
      });

      // Trigger the computed to evaluate
      bad();

      assert(warnings.length > 0, 'Expected at least one warning');
      const warningText = warnings.join(' ');
      assert(
        warningText.includes('Signal.set() called inside a computed function'),
        `Expected warning about signal.set in computed, got: ${warningText}`
      );
      assert(
        warningText.includes('infinite loops'),
        `Expected warning to mention infinite loops, got: ${warningText}`
      );
      assert(
        warningText.includes('effect()'),
        `Expected warning to suggest effect(), got: ${warningText}`
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should warn when signal is written via unified getter/setter inside computed()', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const count = signal(0);
      const other = signal(0);

      // Using the sig(value) write syntax inside computed
      const bad = computed(() => {
        other(count() * 2);
        return count();
      });

      bad();

      assert(warnings.length > 0, 'Expected at least one warning');
      const warningText = warnings.join(' ');
      assert(
        warningText.includes('Signal.set() called inside a computed function'),
        `Expected warning about signal write in computed, got: ${warningText}`
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should NOT warn when signal.set() is called inside effect()', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const count = signal(0);
      const other = signal(0);

      const dispose = effect(() => {
        other.set(count() * 2);
      });

      // Filter for only the specific signal.set warning
      const setInComputedWarnings = warnings.filter(w =>
        w.includes('Signal.set() called inside a computed function')
      );

      assert.equal(
        setInComputedWarnings.length,
        0,
        `Expected no signal.set-in-computed warnings in effect, got: ${setInComputedWarnings.join('; ')}`
      );

      dispose();
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should NOT warn when signal.set() is called outside reactive context', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const count = signal(0);
      count.set(42);

      const setInComputedWarnings = warnings.filter(w =>
        w.includes('Signal.set() called inside a computed function')
      );

      assert.equal(
        setInComputedWarnings.length,
        0,
        'Expected no warnings for signal.set outside computed'
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});

// =========================================================================
// Task 3: useEffect with non-function deps warns
// =========================================================================

describe('useEffect dep validation', () => {
  it('should warn when deps contain non-function values', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const container = getContainer();

      function TestComponent() {
        const count = useSignal(0);
        // Pass count() (a number) instead of count (a signal function)
        // This is the common mistake — calling the signal in deps instead of passing the signal
        useEffect(() => {}, [count(), 'static', 42]);
        return h('div', null, 'test');
      }

      mount(h(TestComponent), container);

      // Check for warnings about non-function deps
      const depWarnings = warnings.filter(w =>
        w.includes('useEffect dep at index')
      );

      // Should warn about index 0 (number 0), index 1 (string), index 2 (number 42)
      assert(depWarnings.length >= 3, `Expected at least 3 dep warnings, got ${depWarnings.length}: ${depWarnings.join('; ')}`);

      // Check that warnings include the index
      assert(depWarnings.some(w => w.includes('index 0')), 'Expected warning about index 0');
      assert(depWarnings.some(w => w.includes('index 1')), 'Expected warning about index 1');
      assert(depWarnings.some(w => w.includes('index 2')), 'Expected warning about index 2');

      // Check the suggestion
      assert(depWarnings.some(w => w.includes('Did you mean to pass a signal')),
        'Expected warning to suggest using a signal');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should NOT warn when deps are signal functions', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const container = getContainer();

      function TestComponent() {
        const count = useSignal(0);
        const name = useSignal('test');
        // Passing signal functions directly — correct usage
        useEffect(() => {}, [count, name]);
        return h('div', null, 'test');
      }

      mount(h(TestComponent), container);

      const depWarnings = warnings.filter(w =>
        w.includes('useEffect dep at index')
      );

      assert.equal(depWarnings.length, 0, `Expected no dep warnings, got: ${depWarnings.join('; ')}`);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should NOT warn when deps is empty array', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const container = getContainer();

      function TestComponent() {
        useEffect(() => {}, []);
        return h('div', null, 'test');
      }

      mount(h(TestComponent), container);

      const depWarnings = warnings.filter(w =>
        w.includes('useEffect dep at index')
      );

      assert.equal(depWarnings.length, 0, 'Expected no dep warnings for empty deps');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should NOT warn when deps is undefined (auto-tracking mode)', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const container = getContainer();

      function TestComponent() {
        useEffect(() => {});
        return h('div', null, 'test');
      }

      mount(h(TestComponent), container);

      const depWarnings = warnings.filter(w =>
        w.includes('useEffect dep at index')
      );

      assert.equal(depWarnings.length, 0, 'Expected no dep warnings for undefined deps');
    } finally {
      console.warn = originalWarn;
    }
  });
});
