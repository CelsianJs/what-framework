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
const { signal, effect, flushSync, createRoot } = await import('../src/reactive.js');
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
