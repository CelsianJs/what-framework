// Stress Test: React-compat hooks with run-once component model
import { describe, it, beforeEach } from 'node:test';
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
const { mount, createDOM } = await import('../packages/core/src/dom.js');
const {
  useState, useEffect, useRef, useMemo, useCallback,
  useReducer, useContext, createContext, onMount, onCleanup
} = await import('../packages/core/src/hooks.js');
const { signal, effect, flushSync } = await import('../packages/core/src/reactive.js');

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

  it('useState returns initial value on first call', () => {
    let capturedState;
    function TestComp() {
      const [count] = useState(42);
      capturedState = count;
      return h('div', null, String(count));
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(capturedState, 42);
  });

  it('useState with initializer function', () => {
    let initCalls = 0;
    let capturedState;
    function TestComp() {
      const [val] = useState(() => { initCalls++; return 'computed'; });
      capturedState = val;
      return h('div', null, val);
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(capturedState, 'computed');
    assert.equal(initCalls, 1, 'Initializer should be called once');
  });

  it('useState setter returns signal setter', () => {
    let setter;
    function TestComp() {
      const [val, setVal] = useState(0);
      setter = setVal;
      return h('div', null, String(val));
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(typeof setter, 'function');
  });
});

describe('STRESS: useEffect in run-once component', () => {

  it('useEffect fires after mount', async () => {
    let effectRan = false;
    function TestComp() {
      useEffect(() => {
        effectRan = true;
      }, []);
      return h('div', null, 'test');
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    await flush();
    assert.ok(effectRan, 'useEffect should fire after mount');
  });

  it('useEffect cleanup fires on unmount', async () => {
    let cleanupRan = false;
    function TestComp() {
      useEffect(() => {
        return () => { cleanupRan = true; };
      }, []);
      return h('div', null, 'test');
    }

    const container = getContainer();
    const unmount = mount(h(TestComp, null), container);
    await flush();
    assert.ok(!cleanupRan, 'Cleanup should not fire while mounted');
    unmount();
    assert.ok(cleanupRan, 'Cleanup should fire on unmount');
  });

  it('useEffect with empty deps runs only once (component runs once)', async () => {
    let runCount = 0;
    function TestComp() {
      useEffect(() => {
        runCount++;
      }, []);
      return h('div', null, 'test');
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    await flush();
    assert.equal(runCount, 1, 'useEffect([]) should run once');
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

  it('useRef.current is mutable', () => {
    let myRef;
    function TestComp() {
      myRef = useRef(0);
      myRef.current = 10;
      return h('div', null, String(myRef.current));
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(myRef.current, 10);

    // Mutate after mount
    myRef.current = 99;
    assert.equal(myRef.current, 99);
  });
});

describe('STRESS: useMemo in run-once component', () => {

  it('useMemo computes on first call', () => {
    let result;
    function TestComp() {
      result = useMemo(() => 2 + 3, []);
      return h('div', null, String(result));
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(result, 5);
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
      return h('div', null, String(state.count));
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(state.count, 0);
    assert.equal(typeof dispatch, 'function');
  });
});

describe('STRESS: useContext in run-once component', () => {

  it('createContext provides default value', () => {
    const ThemeCtx = createContext('light');
    let value;

    function TestComp() {
      value = useContext(ThemeCtx);
      return h('div', null, value);
    }

    const container = getContainer();
    mount(h(TestComp, null), container);
    assert.equal(value, 'light');
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

      const doubled = useMemo(() => count * 2, [count]);
      memoVal = doubled;

      useEffect(() => {
        effectRan = true;
      }, []);

      return h('div', null, String(count));
    }

    const container = getContainer();
    mount(h(MultiHookComp, null), container);
    await flush();

    assert.equal(stateVal, 10);
    assert.equal(refObj.current, 'hello');
    assert.equal(memoVal, 20);
    assert.ok(effectRan, 'Effect should have run');
  });

  it('component runs exactly once (no re-execution)', () => {
    let runCount = 0;

    function CountingComp() {
      runCount++;
      const [val] = useState(0);
      return h('div', null, String(val));
    }

    const container = getContainer();
    mount(h(CountingComp, null), container);
    assert.equal(runCount, 1, 'Component should run exactly once');
  });
});
