// Tests for What Framework - Testing Utilities
// Validates renderTest, flushEffects, mockSignal, and trackSignals
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.NodeFilter = dom.window.NodeFilter;
global.MouseEvent = dom.window.MouseEvent;
global.Event = dom.window.Event;
global.FocusEvent = dom.window.FocusEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

// Now import framework
const { signal, computed, effect, flushSync, createRoot, __setDevToolsHooks } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const {
  mockSignal,
  flushEffects,
  renderTest,
  fireEvent,
  render,
  cleanup,
  mockComponent,
  createTestSignal,
  trackSignals,
} = await import('../src/testing.js');

// Helper: flush microtask queue
async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => queueMicrotask(r));
  }
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// =========================================================================
// mockSignal
// =========================================================================

describe('mockSignal', () => {
  it('should create a signal with initial value', () => {
    const count = mockSignal('count', 0);
    assert.equal(count(), 0);
    assert.equal(count.peek(), 0);
  });

  it('should track history of value changes via .set()', () => {
    const count = mockSignal('count', 0);
    count.set(5);
    count.set(10);
    assert.deepEqual(count.history, [0, 5, 10]);
  });

  it('should track history of value changes via unified call syntax', () => {
    const count = mockSignal('count', 0);
    count(5);
    count(10);
    assert.deepEqual(count.history, [0, 5, 10]);
  });

  it('should track setCount', () => {
    const count = mockSignal('count', 0);
    assert.equal(count.setCount, 0);
    count.set(5);
    assert.equal(count.setCount, 1);
    count.set(10);
    assert.equal(count.setCount, 2);
  });

  it('should not count no-op writes', () => {
    const count = mockSignal('count', 5);
    count.set(5); // same value, no-op
    assert.equal(count.setCount, 0);
    assert.deepEqual(count.history, [5]);
  });

  it('should support function updater in .set()', () => {
    const count = mockSignal('count', 5);
    count.set((v) => v + 1);
    assert.equal(count(), 6);
    assert.deepEqual(count.history, [5, 6]);
  });

  it('should support function updater in unified call', () => {
    const count = mockSignal('count', 5);
    count((v) => v + 1);
    assert.equal(count(), 6);
    assert.deepEqual(count.history, [5, 6]);
  });

  it('should reset history and value', () => {
    const count = mockSignal('count', 0);
    count.set(5);
    count.set(10);
    count.reset();
    assert.equal(count(), 0);
    assert.deepEqual(count.history, [0]);
    assert.equal(count.setCount, 0);
  });

  it('should reset to custom value', () => {
    const count = mockSignal('count', 0);
    count.set(5);
    count.reset(42);
    assert.equal(count(), 42);
    assert.deepEqual(count.history, [42]);
  });

  it('should have _signal flag for signal detection', () => {
    const count = mockSignal('count', 0);
    assert.equal(count._signal, true);
  });
});

// =========================================================================
// flushEffects
// =========================================================================

describe('flushEffects', () => {
  it('should synchronously flush pending effects', () => {
    const results = [];
    const count = signal(0);

    createRoot(() => {
      effect(() => {
        results.push(count());
      });
    });

    // First run is synchronous
    assert.deepEqual(results, [0]);

    // Write signal - effect is queued
    count.set(1);

    // Before flush
    // (effect may or may not have run due to microtask scheduling)

    // After flush, effect must have run
    flushEffects();

    // Give microtasks a chance to complete
    assert(results.includes(1), 'Expected effect to have run with value 1');
  });
});

// =========================================================================
// render (basic)
// =========================================================================

describe('render', () => {
  afterEach(() => {
    cleanup();
  });

  it('should mount a simple element', () => {
    const result = render(h('div', null, 'Hello'));
    assert(result.container);
    assert(result.container.textContent.includes('Hello'));
  });

  it('should provide query helpers', () => {
    const result = render(
      h('div', null, h('span', { 'data-testid': 'greeting' }, 'Hello World'))
    );
    const el = result.getByTestId('greeting');
    assert(el);
    assert.equal(el.textContent, 'Hello World');
  });

  it('should provide unmount', () => {
    const result = render(h('div', null, 'Hello'));
    assert(result.container.textContent.includes('Hello'));
    result.unmount();
    assert.equal(result.container.textContent, '');
  });
});

// =========================================================================
// fireEvent
// =========================================================================

describe('fireEvent', () => {
  afterEach(() => {
    cleanup();
  });

  it('should fire click events', () => {
    let clicked = false;
    const container = getContainer();
    const btn = document.createElement('button');
    btn.addEventListener('click', () => { clicked = true; });
    container.appendChild(btn);

    fireEvent.click(btn);
    assert.equal(clicked, true);
  });

  it('should fire input events', () => {
    let inputVal = '';
    const container = getContainer();
    const input = document.createElement('input');
    input.addEventListener('input', (e) => { inputVal = e.target.value; });
    container.appendChild(input);

    fireEvent.input(input, 'hello');
    assert.equal(inputVal, 'hello');
  });

  it('should fire keyDown events', () => {
    let key = '';
    const container = getContainer();
    const div = document.createElement('div');
    div.addEventListener('keydown', (e) => { key = e.key; });
    container.appendChild(div);

    fireEvent.keyDown(div, 'Enter');
    assert.equal(key, 'Enter');
  });
});

// =========================================================================
// createTestSignal
// =========================================================================

describe('createTestSignal', () => {
  it('should create a signal with history tracking', () => {
    let ts;
    createRoot(() => {
      ts = createTestSignal(0);
    });

    assert.equal(ts.value, 0);
    // history starts with [initial, first_effect_read]
    assert(ts.history.length >= 1);
  });

  it('should track value changes', async () => {
    let ts;
    createRoot(() => {
      ts = createTestSignal(0);
    });

    ts.value = 5;
    flushEffects();
    await flush();

    assert(ts.history.includes(5));
  });
});

// =========================================================================
// mockComponent
// =========================================================================

describe('mockComponent', () => {
  it('should create a mock component that tracks calls', () => {
    const Mock = mockComponent('TestComponent');
    assert.equal(Mock.displayName, 'TestComponent');
    assert.equal(Mock.calls.length, 0);
  });

  it('should record props when called', () => {
    const container = getContainer();
    const Mock = mockComponent('TestComponent');
    mount(h(Mock, { foo: 'bar' }), container);

    assert.equal(Mock.calls.length, 1);
    assert.equal(Mock.calls[0].props.foo, 'bar');
  });

  it('should support lastCall and reset', () => {
    const container = getContainer();
    const Mock = mockComponent('TestComponent');
    mount(h(Mock, { a: 1 }), container);

    assert.equal(Mock.lastCall().props.a, 1);
    Mock.reset();
    assert.equal(Mock.calls.length, 0);
  });
});


// This file's header has claimed to validate trackSignals since it was
// written, and did not. The function returned two empty arrays for every
// input: it declared a tracking Map and read/write helpers and then called
// none of them. An assertion of the form `assert(!written.includes('x'))`
// passed against it while proving nothing, which is the worse of the two
// failure modes.
describe('trackSignals', () => {
  it('reports a signal that was read', () => {
    const count = signal(0, 'count');
    const { accessed, written } = trackSignals(() => { count(); });
    assert.deepEqual(accessed, ['count']);
    assert.deepEqual(written, []);
  });

  it('reports a signal that was written, via .set() and via call', () => {
    const viaSet = signal(0, 'viaSet');
    const viaCall = signal(0, 'viaCall');
    assert.deepEqual(trackSignals(() => { viaSet.set(1); }).written, ['viaSet']);
    assert.deepEqual(trackSignals(() => { viaCall(1); }).written, ['viaCall']);
  });

  it('separates reads from writes', () => {
    const a = signal(1, 'a');
    const b = signal(2, 'b');
    const { accessed, written } = trackSignals(() => { a(); b.set(9); });
    assert.deepEqual(accessed, ['a']);
    assert.deepEqual(written, ['b']);
  });

  it('reports nothing for a callback that touches nothing', () => {
    const { accessed, written } = trackSignals(() => {});
    assert.deepEqual(accessed, []);
    assert.deepEqual(written, []);
  });

  it('does not count peek() as a read', () => {
    const a = signal(1, 'a');
    assert.deepEqual(trackSignals(() => { a.peek(); }).accessed, []);
  });

  it('does not count a write of an equal value', () => {
    const a = signal(1, 'a');
    assert.deepEqual(trackSignals(() => { a.set(1); }).written, []);
  });

  it('deduplicates repeated reads and writes', () => {
    const a = signal(0, 'a');
    const { accessed, written } = trackSignals(() => { a(); a(); a.set(1); a.set(2); });
    assert.deepEqual(accessed, ['a']);
    assert.deepEqual(written, ['a']);
  });

  it('follows reads through a computed to its source signals', () => {
    const a = signal(1, 'a');
    const b = signal(2, 'b');
    const sum = computed(() => a() + b());
    const { accessed } = trackSignals(() => { sum(); });
    assert.deepEqual(accessed.sort(), ['a', 'b']);
  });

  it('follows reads through nested computeds', () => {
    const a = signal(1, 'a');
    const b = signal(2, 'b');
    const c = signal(3, 'c');
    const inner = computed(() => a() + b());
    const outer = computed(() => inner() + c());
    const { accessed } = trackSignals(() => { outer(); });
    assert.deepEqual(accessed.sort(), ['a', 'b', 'c']);
  });

  it('reports an unnamed signal as (unnamed) rather than dropping it', () => {
    const anon = signal(0);
    const { accessed, written } = trackSignals(() => { anon(); anon.set(1); });
    assert.deepEqual(accessed, ['(unnamed)']);
    assert.deepEqual(written, ['(unnamed)']);
  });

  it('never reports its own internal probe signal', () => {
    const a = signal(0, 'a');
    const { accessed } = trackSignals(() => { a(); });
    assert.ok(!accessed.some((n) => n.includes('probe')), accessed.join(','));
  });

  it('propagates a throw from the callback and stays usable afterwards', () => {
    const a = signal(0, 'a');
    assert.throws(() => trackSignals(() => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(trackSignals(() => { a(); }).accessed, ['a']);
  });

  it('chains installed devtools hooks instead of replacing them, and restores them', () => {
    const seen = [];
    const hooks = {
      onSignalCreate() {}, onSignalUpdate(sig) { seen.push(sig._debugName); },
      onEffectCreate() {}, onEffectDispose() {}, onEffectRun() {}, onError() {},
      onComponentMount() {}, onComponentUnmount() {},
    };
    __setDevToolsHooks(hooks);
    try {
      const a = signal(0, 'chained');
      assert.deepEqual(trackSignals(() => { a.set(1); }).written, ['chained']);
      assert.deepEqual(seen, ['chained'], 'devtools must still observe writes during tracking');
      a.set(2);
      assert.deepEqual(seen, ['chained', 'chained'], 'devtools must still be installed afterwards');
    } finally {
      __setDevToolsHooks(null);
    }
  });
});
