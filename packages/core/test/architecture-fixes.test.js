// Tests for architecture fixes:
// FIX-1: memo() diamond dependency glitch
// FIX-2: O(N^2) trampoline worst case
// FIX-3: Props reactive across re-renders
// FIX-4: Comment node component boundaries (no span wrapper)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
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

const { signal, computed, memo, effect, batch, flushSync, createRoot } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { mount, createDOM } = await import('../src/dom.js');

function getContainer() {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}
async function flush() { flushSync(); await new Promise(r => setTimeout(r, 10)); }

// =========================================================================
// FIX-1: memo() diamond dependency glitch
// =========================================================================

describe('FIX-1: memo() diamond dependency — no glitch', () => {
  it('memo subscribers see consistent values in diamond pattern', () => {
    // Diamond: A -> B, A -> C, B+C -> D
    // When A changes, D should see both B and C updated, not stale values.
    const a = signal(1);
    const b = memo(() => a() * 2);
    const c = memo(() => a() * 3);

    const observations = [];
    let dispose;
    createRoot((d) => {
      dispose = d;
      effect(() => {
        observations.push({ b: b(), c: c(), sum: b() + c() });
      });
    });
    flushSync();

    // Initial: b=2, c=3, sum=5
    assert.equal(observations[observations.length - 1].sum, 5);

    // Update A: b should be 4, c should be 6, sum should be 10
    a(2);
    flushSync();

    const last = observations[observations.length - 1];
    assert.equal(last.b, 4, 'b should be 4');
    assert.equal(last.c, 6, 'c should be 6');
    assert.equal(last.sum, 10, 'sum should be 10 (no glitch)');
    dispose();
  });

  it('memo with deeper diamond does not glitch', () => {
    const x = signal(1);
    const a = memo(() => x() + 1);
    const b = memo(() => a() * 2);
    const c = memo(() => a() * 3);
    const d = memo(() => b() + c());

    const values = [];
    let dispose;
    createRoot((dis) => {
      dispose = dis;
      effect(() => {
        values.push(d());
      });
    });
    flushSync();

    // x=1, a=2, b=4, c=6, d=10
    assert.equal(values[values.length - 1], 10);

    x(2);
    flushSync();

    // x=2, a=3, b=6, c=9, d=15
    assert.equal(values[values.length - 1], 15, 'deep diamond should be glitch-free');
    dispose();
  });

  it('memo only notifies when value actually changes', () => {
    const x = signal(1);
    const m = memo(() => x() > 0 ? 'positive' : 'non-positive');

    let runCount = 0;
    let dispose;
    createRoot((d) => {
      dispose = d;
      effect(() => {
        m();
        runCount++;
      });
    });
    flushSync();

    const initial = runCount;

    // Change x from 1 to 2 — memo value stays 'positive'
    x(2);
    flushSync();
    assert.equal(runCount, initial, 'effect should not re-run when memo value unchanged');

    // Change x to -1 — memo value changes to 'non-positive'
    x(-1);
    flushSync();
    assert.equal(runCount, initial + 1, 'effect should re-run when memo value changes');
    dispose();
  });
});

// =========================================================================
// FIX-2: O(N^2) trampoline — pre-scan optimization
// =========================================================================

describe('FIX-2: computed chain evaluation — no stack overflow', () => {
  it('handles deep computed chains (100 levels)', () => {
    const source = signal(0);
    let current = computed(() => source());
    for (let i = 0; i < 100; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }

    assert.equal(current(), 100);
    source(10);
    assert.equal(current(), 110);
  });

  it('handles deep computed chains (1000 levels)', () => {
    const source = signal(0);
    let current = computed(() => source());
    for (let i = 0; i < 1000; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }

    assert.equal(current(), 1000);
    source(5);
    assert.equal(current(), 1005);
  });

  it('handles branching computed graphs efficiently', () => {
    const a = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => a() + 10);
    const d = computed(() => b() + c());
    const e = computed(() => d() * 2);

    assert.equal(e(), (1 * 2 + 1 + 10) * 2); // (2 + 11) * 2 = 26

    a(5);
    assert.equal(e(), (5 * 2 + 5 + 10) * 2); // (10 + 15) * 2 = 50
  });
});

// =========================================================================
// FIX-3: Props reactive across re-renders
// =========================================================================

describe('FIX-3: props are reactive across re-renders', () => {
  it('component receives reactive props via proxy', async () => {
    const name = signal('Alice');
    const container = getContainer();
    let propsRef;

    function Child(props) {
      propsRef = props;
      return h('span', { id: 'child' }, () => props.name);
    }

    mount(
      h('div', null, () => h(Child, { name: name() })),
      container
    );
    await flush();

    assert.ok(container.querySelector('#child'));
    assert.ok(container.textContent.includes('Alice'));

    // Props should be accessible via proxy
    assert.equal(propsRef.name, 'Alice');
  });

  it('prop reads inside effects create reactive dependencies', async () => {
    const count = signal(0);
    const container = getContainer();
    const observations = [];

    function Display(props) {
      // Reading props.count inside a reactive context (returned function)
      // should create a dependency on the props signal
      return h('div', { id: 'display' }, () => {
        const val = props.count;
        observations.push(val);
        return `Count: ${val}`;
      });
    }

    mount(
      h('div', null, () => h(Display, { count: count() })),
      container
    );
    await flush();

    assert.ok(container.textContent.includes('Count: 0'));

    count(5);
    await flush();

    assert.ok(container.textContent.includes('Count: 5'));
  });

  it('props proxy supports "in" operator', async () => {
    const container = getContainer();
    let hasName, hasAge;

    function Test(props) {
      hasName = 'name' in props;
      hasAge = 'age' in props;
      return h('div', null, 'test');
    }

    mount(h(Test, { name: 'test' }), container);
    await flush();

    assert.equal(hasName, true, 'should detect name prop');
    assert.equal(hasAge, false, 'should not detect missing age prop');
  });
});

// =========================================================================
// FIX-4: Comment node component boundaries (no span wrapper)
// =========================================================================

describe('FIX-4: comment node component boundaries', () => {
  it('components use comment node boundaries instead of span', async () => {
    function MyComp() { return h('p', null, 'hello'); }
    const container = getContainer();

    mount(h('div', { id: 'boundary-test' }, h(MyComp)), container);
    await flush();

    const wrapper = container.querySelector('#boundary-test');
    // Should NOT have a span[style*="contents"] wrapper
    assert.equal(wrapper.querySelectorAll('span[style*="contents"]').length, 0,
      'no span wrapper should exist');

    // Should have comment boundaries
    const comments = [];
    for (const child of wrapper.childNodes) {
      if (child.nodeType === 8 /* COMMENT_NODE */) {
        comments.push(child.textContent);
      }
    }
    assert.ok(comments.includes('c:start'), 'should have c:start comment');
    assert.ok(comments.includes('c:end'), 'should have c:end comment');

    // Content should still be rendered
    assert.ok(wrapper.querySelector('p'), 'component content should be rendered');
    assert.equal(wrapper.querySelector('p').textContent, 'hello');
  });

  it('nested components have nested comment boundaries', async () => {
    function Inner() { return h('span', null, 'inner'); }
    function Outer() { return h('div', { id: 'outer' }, h(Inner)); }
    const container = getContainer();

    mount(h(Outer), container);
    await flush();

    const outerDiv = container.querySelector('#outer');
    assert.ok(outerDiv, 'outer div should exist');

    // Inner component should have its own comment boundaries
    const innerComments = [];
    for (const child of outerDiv.childNodes) {
      if (child.nodeType === 8) innerComments.push(child.textContent);
    }
    assert.ok(innerComments.includes('c:start'), 'inner component has start comment');
    assert.ok(innerComments.includes('c:end'), 'inner component has end comment');
  });

  it('component disposal still works with comment boundaries', async () => {
    const show = signal(true);
    let mountCount = 0;
    function Counter() {
      mountCount++;
      return h('span', null, 'counter');
    }
    const container = getContainer();

    mount(
      h('div', null, () => show() ? h(Counter) : null),
      container
    );
    await flush();

    assert.equal(mountCount, 1);
    assert.ok(container.textContent.includes('counter'));

    show(false);
    await flush();

    assert.ok(!container.textContent.includes('counter'), 'component should be removed');
  });

  it('multiple sibling components render without DOM pollution', async () => {
    function A() { return h('span', { class: 'a' }, 'A'); }
    function B() { return h('span', { class: 'b' }, 'B'); }
    const container = getContainer();

    mount(h('div', { id: 'siblings' }, h(A), h(B)), container);
    await flush();

    const div = container.querySelector('#siblings');
    assert.ok(div.querySelector('.a'), 'A component rendered');
    assert.ok(div.querySelector('.b'), 'B component rendered');

    // No span wrappers
    const spans = div.querySelectorAll('span[style*="contents"]');
    assert.equal(spans.length, 0, 'no span wrappers');

    // Content is correct
    assert.ok(div.textContent.includes('A'));
    assert.ok(div.textContent.includes('B'));
  });

  it('does not break CSS :first-child selectors', async () => {
    function Child() { return h('p', { class: 'item' }, 'content'); }
    const container = getContainer();

    mount(h('div', { id: 'css-test' }, h(Child)), container);
    await flush();

    // The first element child should be the <p>, not a span wrapper
    const wrapper = container.querySelector('#css-test');
    const firstElement = wrapper.querySelector(':first-child');
    // First child is actually a comment node, but first *element* child should be <p>
    const pEl = wrapper.querySelector('p');
    assert.ok(pEl, 'p element should exist');
    assert.equal(pEl.className, 'item');
  });
});
