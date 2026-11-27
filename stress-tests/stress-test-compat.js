// Stress Test: React-compat hooks with run-once component model
//
// NOTE ON THE CONTRACT: What's hooks return signal ACCESSORS, not values.
// useState -> [signal, signal.set], useMemo -> computed, useReducer ->
// [signal, dispatch]. Read them by calling them. Several assertions here
// compared the accessor to the value and had been failing unnoticed, because
// only adversarial-test.js was ever run.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));
if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { h } = await import('../packages/core/src/h.js');
const { mount } = await import('../packages/core/src/dom.js');
const { useState, useEffect, useRef, useMemo, useReducer } = await import('../packages/core/src/hooks.js');
await import('../packages/core/src/reactive.js'); // imported for module-init order; no binding is used here

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

describe('STRESS: useState in run-once component', () => {
  it('useState with initializer function', () => {
    let initCalls = 0;
    let capturedState;
    function TestComp() {
      const [val] = useState(() => { initCalls++; return 'computed'; });
      capturedState = val;
      return h('div', null, val());
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(capturedState(), 'computed');
    assert.equal(initCalls, 1, 'Initializer should be called once');
  });
});

describe('STRESS: useRef in run-once component', () => {

  it('useRef returns stable ref object', () => {
    let ref1, ref2;
    function TestComp() {
      ref1 = useRef(null);
      ref2 = useRef(42);
      return h('div', null, 'test');
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(ref1.current, null);
    assert.equal(ref2.current, 42);
  });
});

describe('STRESS: useReducer in run-once component', () => {

  it('useReducer with initial state', () => {
    let state, dispatch;
    function reducer(state, action) {
      switch (action.type) {
        case 'increment': return { count: state.count + 1 };
        case 'decrement': return { count: state.count - 1 };
        default: return state;
      }
    }

    function TestComp() {
      [state, dispatch] = useReducer(reducer, { count: 0 });
      return h('div', null, String(state().count));
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(state().count, 0);
    assert.equal(typeof dispatch, 'function');
    dispatch({ type: 'increment' });
    assert.equal(state().count, 1, 'dispatch must apply the reducer');
  });
});

describe('STRESS: Multiple hooks in sequence (run-once invariant)', () => {

  it('useState + useEffect + useRef + useMemo all work in one component', async () => {
    let stateVal, refObj, memoVal, effectRan = false;

    function MultiHookComp() {
      const [count] = useState(10);
      stateVal = count;

      const myRef = useRef('hello');
      refObj = myRef;

      const doubled = useMemo(() => count() * 2, [count]);
      memoVal = doubled;

      useEffect(() => {
        effectRan = true;
      }, []);

      return h('div', null, String(count()));
    }

    const container = getContainer();
    mount(h(MultiHookComp, null), container);
    await flush();

    assert.equal(stateVal(), 10);
    assert.equal(refObj.current, 'hello');
    assert.equal(memoVal(), 20);
    assert.ok(effectRan, 'Effect should have run');
  });

  it('component runs exactly once (no re-execution)', () => {
    let runCount = 0;

    function CountingComp() {
      runCount++;
      const [val] = useState(0);
      return h('div', null, String(val()));
    }

    const container = getContainer();
    mount(h(CountingComp, null), container);
    assert.equal(runCount, 1, 'Component should run exactly once');
  });
});
