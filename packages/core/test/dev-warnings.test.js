// Tests for What Framework - Dev-mode warnings and error messages
// Validates that hooks throw clear errors outside components,
// a signal write inside computed() is reported, and useEffect dep validation works.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

// Set up DOM globals before importing framework modules
installDOM();

// Now import framework
const { signal, computed, effect } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
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
const { capture } = await import('../src/diagnostics.js');

function depReports(run) {
  const cap = capture({ quiet: true });
  try { run(); } finally { cap.stop(); }
  return cap.events.filter((e) => e.code === 'ERR_EFFECT_DEP_NOT_FUNCTION');
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
        assert.equal(err.code, 'ERR_HOOK_OUTSIDE_COMPONENT');
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
      () => useReducer((s, _a) => s, 0),
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

  it('onCleanup with nothing to attach to reports ERR_CLEANUP_WITHOUT_OWNER instead of throwing', () => {
    const cap = capture({ quiet: true });
    try {
      assert.doesNotThrow(() => onCleanup(() => {}));
    } finally { cap.stop(); }
    assert.deepEqual(cap.events.map((e) => e.code), ['ERR_CLEANUP_WITHOUT_OWNER']);
  });

  it('hooks inside a component do NOT throw', () => {
    const container = getContainer();
    let captured;

    function TestComponent() {
      // All of these should work without throwing
      const sig = useSignal(0);
      const [state] = useState(1);
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
// Task 2: a signal write inside computed() is reported
// =========================================================================

function writeReports(run) {
  const cap = capture({ quiet: true });
  try { run(); } finally { cap.stop(); }
  return cap.events.filter((e) => e.code === 'ERR_SIGNAL_WRITE_IN_COMPUTED');
}

describe('a signal write inside computed() is reported', () => {
  it('reports other.set() inside computed() as ERR_SIGNAL_WRITE_IN_COMPUTED, naming both', () => {
    const reports = writeReports(() => {
      const count = signal(0);
      const other = signal(0, 'other');
      const bad = computed(function doubled() {
        other.set(count() * 2);
        return count();
      });
      bad();
    });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].severity, 'warning');
    assert.deepEqual(reports[0].data, { computedName: 'doubled', signalName: 'other' });
    assert.match(reports[0].message, /Computed "doubled" wrote signal "other"/);
    assert.match(reports[0].message, /can loop/);
    assert.match(reports[0].fix, /effect/);
    assert.equal(reports[0].subject.kind, 'computed');
  });

  it('reports a write through the unified getter/setter the same way', () => {
    const reports = writeReports(() => {
      const count = signal(0);
      const other = signal(0, 'other');
      const bad = computed(function doubled() {
        other(count() * 2);
        return count();
      });
      bad();
    });
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0].data, { computedName: 'doubled', signalName: 'other' });
  });

  it('reports sig.mutate() inside computed() the same way', () => {
    const reports = writeReports(() => {
      const count = signal(0);
      const list = signal([], 'list');
      const bad = computed(function tracked() {
        list.mutate((items) => { items.push(count()); });
        return count();
      });
      bad();
    });
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0].data, { computedName: 'tracked', signalName: 'list' });
  });

  it('folds repeats of the same computed into one event with a count', () => {
    const reports = writeReports(() => {
      const count = signal(0);
      const other = signal(0, 'other');
      const bad = computed(function doubled() {
        other(count() * 2);
        return count();
      });
      bad();
      count(1);
      bad();
    });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].count, 2);
  });

  it('does not report signal.set() inside effect()', () => {
    const reports = writeReports(() => {
      const count = signal(0);
      const other = signal(0);
      const dispose = effect(() => {
        other.set(count() * 2);
      });
      dispose();
    });
    assert.deepEqual(reports, []);
  });

  it('does not report signal.set() outside a reactive context', () => {
    const reports = writeReports(() => {
      const count = signal(0);
      count.set(42);
    });
    assert.deepEqual(reports, []);
  });
});

// =========================================================================
// Task 3: useEffect with non-function deps warns
// =========================================================================

describe('useEffect dep validation', () => {
  it('reports ERR_EFFECT_DEP_NOT_FUNCTION for each plain-value dep, with its index', () => {
    const reports = depReports(() => {
      function TestComponent() {
        const count = useSignal(0);
        // Pass count() (a number) instead of count (a signal function).
        // This is the common mistake — calling the signal in deps instead of passing the signal.
        useEffect(() => {}, [count(), 'static', 42]);
        return h('div', null, 'test');
      }
      mount(h(TestComponent), getContainer());
    });

    assert.deepEqual(reports.map((e) => e.data.index).sort(), [0, 1, 2]);
    assert.equal(reports[0].severity, 'warning');
    assert.ok(reports[0].message.includes('index 0'), reports[0].message);
    assert.ok(reports[0].fix.includes('Pass the signal'), reports[0].fix);
  });

  it('does not report when deps are signal functions', () => {
    const reports = depReports(() => {
      function TestComponent() {
        const count = useSignal(0);
        const name = useSignal('test');
        useEffect(() => {}, [count, name]);
        return h('div', null, 'test');
      }
      mount(h(TestComponent), getContainer());
    });
    assert.equal(reports.length, 0);
  });

  it('does not report when deps is an empty array', () => {
    const reports = depReports(() => {
      function TestComponent() {
        useEffect(() => {}, []);
        return h('div', null, 'test');
      }
      mount(h(TestComponent), getContainer());
    });
    assert.equal(reports.length, 0);
  });

  it('does not report when deps is undefined (auto-tracking mode)', () => {
    const reports = depReports(() => {
      function TestComponent() {
        useEffect(() => {});
        return h('div', null, 'test');
      }
      mount(h(TestComponent), getContainer());
    });
    assert.equal(reports.length, 0);
  });
});
