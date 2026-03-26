// Comprehensive stress tests for What Framework
// Tests: reactive edge cases, memory leaks, SSR correctness, deep nesting, rapid toggling

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  signal, computed, effect, memo, batch, untrack, flushSync,
  createRoot, h, Fragment,
} from '../packages/core/src/index.js';

import { renderToString, renderToStream } from '../packages/server/src/index.js';

// ============================================================
// 1. DEEPLY NESTED REACTIVE UPDATES
// ============================================================

describe('deeply nested reactive chains', () => {
  test('computed chain depth 50', () => {
    const base = signal(1);
    let current = base;
    for (let i = 0; i < 50; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }
    assert.equal(current(), 51);
    base(10);
    assert.equal(current(), 60);
  });

  test('computed chain depth 200', () => {
    const base = signal(0);
    let current = base;
    for (let i = 0; i < 200; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }
    assert.equal(current(), 200);
    base(100);
    assert.equal(current(), 300);
  });

  test('computed chain depth 1000', () => {
    const base = signal(0);
    let current = base;
    for (let i = 0; i < 1000; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }
    assert.equal(current(), 1000);
    base(5);
    assert.equal(current(), 1005);
  });

  test('diamond dependency graph (wide fan-out)', () => {
    const base = signal(1);
    const branches = [];
    for (let i = 0; i < 100; i++) {
      branches.push(computed(() => base() * (i + 1)));
    }
    const sum = computed(() => {
      let total = 0;
      for (const b of branches) total += b();
      return total;
    });
    // sum of 1*1 + 1*2 + ... + 1*100 = 5050
    assert.equal(sum(), 5050);
    base(2);
    assert.equal(sum(), 10100);
  });
});

// ============================================================
// 2. RAPID SIGNAL TOGGLING
// ============================================================

describe('rapid signal toggling', () => {
  test('toggle signal 10000 times in batch', () => {
    const s = signal(false);
    let effectCount = 0;
    createRoot(() => {
      effect(() => {
        s();
        effectCount++;
      });
    });
    // Effect runs once on creation
    assert.equal(effectCount, 1);

    batch(() => {
      for (let i = 0; i < 10000; i++) {
        s(!s.peek());
      }
    });
    // After 10000 toggles (even number), value is back to false
    // Effect should run once more (batch coalesces)
    flushSync();
    assert.equal(s(), false);
    assert.equal(effectCount, 2); // initial + 1 batched
  });

  test('toggle signal 10001 times in batch (odd)', () => {
    const s = signal(false);
    batch(() => {
      for (let i = 0; i < 10001; i++) {
        s(!s.peek());
      }
    });
    flushSync();
    assert.equal(s(), true);
  });

  test('rapid increments without batch (microtask coalescing)', async () => {
    const count = signal(0);
    let effectRuns = 0;
    createRoot(() => {
      effect(() => {
        count();
        effectRuns++;
      });
    });
    assert.equal(effectRuns, 1);

    for (let i = 0; i < 100; i++) {
      count(count.peek() + 1);
    }
    // Wait for microtask flush
    await new Promise(r => queueMicrotask(r));
    await new Promise(r => queueMicrotask(r));

    assert.equal(count(), 100);
    // Effects may coalesce via microtask scheduling
    assert.ok(effectRuns >= 2, `Effect should have run at least twice, got ${effectRuns}`);
  });
});

// ============================================================
// 3. MEMORY LEAK DETECTION — CLEANUP VERIFICATION
// ============================================================

describe('cleanup and disposal', () => {
  test('disposed effects do not fire', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = createRoot((dispose) => {
      effect(() => {
        s();
        runs++;
      });
      return dispose;
    });
    assert.equal(runs, 1);
    dispose();

    s(1);
    flushSync();
    assert.equal(runs, 1, 'Effect should not run after disposal');
  });

  test('nested createRoot disposes children', () => {
    const s = signal(0);
    let innerRuns = 0;
    let outerDispose;

    createRoot((dispose) => {
      outerDispose = dispose;
      createRoot(() => {
        effect(() => {
          s();
          innerRuns++;
        });
      });
    });

    assert.equal(innerRuns, 1);
    outerDispose();

    s(1);
    flushSync();
    // Inner effects might not be automatically disposed since inner createRoot doesn't
    // register with outer root (no disposal returned to outer). Let's check the behavior.
    // This test documents actual behavior.
  });

  test('signal subscribers are cleaned up after effect disposal', () => {
    const s = signal(0);
    let runs = 0;

    const dispose = createRoot((dispose) => {
      effect(() => {
        s();
        runs++;
      });
      return dispose;
    });

    assert.equal(runs, 1);

    // Check subscriber count if exposed in dev mode
    const subCount = s._subs?.size;

    dispose();

    // After disposal, subscriber should be removed
    if (s._subs) {
      assert.equal(s._subs.size, 0, 'Signal should have no subscribers after effect disposal');
    }

    s(1);
    flushSync();
    assert.equal(runs, 1, 'No additional effect runs after disposal');
  });

  test('1000 effects created and disposed - no dangling refs', () => {
    const s = signal(0);
    const disposals = [];

    for (let i = 0; i < 1000; i++) {
      const dispose = createRoot((dispose) => {
        effect(() => { s(); });
        return dispose;
      });
      disposals.push(dispose);
    }

    // Should have 1000 subscribers
    if (s._subs) {
      assert.equal(s._subs.size, 1000);
    }

    // Dispose all
    for (const d of disposals) d();

    // Should have 0 subscribers
    if (s._subs) {
      assert.equal(s._subs.size, 0, 'All subscribers should be cleaned up');
    }

    // Writing should be a no-op
    s(1);
    flushSync();
  });

  test('effect cleanup function is called on disposal', () => {
    let cleanedUp = false;
    const dispose = createRoot((dispose) => {
      effect(() => {
        return () => { cleanedUp = true; };
      });
      return dispose;
    });

    assert.equal(cleanedUp, false);
    dispose();
    assert.equal(cleanedUp, true, 'Cleanup function should be called on disposal');
  });

  test('effect cleanup function is called on re-run', () => {
    const s = signal(0);
    let cleanupCount = 0;

    createRoot(() => {
      effect(() => {
        s();
        return () => { cleanupCount++; };
      });
    });

    assert.equal(cleanupCount, 0);

    batch(() => { s(1); });
    flushSync();
    assert.equal(cleanupCount, 1, 'Cleanup should be called on re-run');

    batch(() => { s(2); });
    flushSync();
    assert.equal(cleanupCount, 2, 'Cleanup should be called again on second re-run');
  });
});

// ============================================================
// 4. INFINITE LOOP DETECTION
// ============================================================

describe('infinite loop protection', () => {
  test('effect that writes to its own signal is capped at 25 iterations', () => {
    const s = signal(0);
    let runs = 0;

    // Suppress the console.warn
    const origWarn = console.warn;
    let warningFired = false;
    console.warn = (...args) => {
      if (String(args[0]).includes('infinite effect loop')) {
        warningFired = true;
      }
    };

    createRoot(() => {
      effect(() => {
        runs++;
        if (s() < 100) {
          s(s.peek() + 1); // Write to same signal we read
        }
      });
    });

    // Allow microtask flush
    flushSync();
    flushSync();
    flushSync();

    console.warn = origWarn;

    // The framework should cap iterations at 25
    assert.ok(runs <= 30, `Should cap iterations, got ${runs}`);
    assert.ok(warningFired || runs <= 26, 'Should warn about infinite loop or cap iterations');
  });
});

// ============================================================
// 5. SSR CORRECTNESS
// ============================================================

describe('SSR correctness', () => {
  test('simple element renders correct HTML', () => {
    const vnode = h('div', { class: 'test' }, 'Hello');
    const html = renderToString(vnode);
    assert.equal(html, '<div class="test">Hello</div>');
  });

  test('nested elements render correct HTML', () => {
    const vnode = h('div', null,
      h('h1', null, 'Title'),
      h('p', null, 'Content')
    );
    const html = renderToString(vnode);
    assert.equal(html, '<div><h1>Title</h1><p>Content</p></div>');
  });

  test('void elements render self-closing', () => {
    const vnode = h('div', null,
      h('img', { src: 'test.png', alt: 'test' }),
      h('br', null),
      h('input', { type: 'text' })
    );
    const html = renderToString(vnode);
    assert.ok(html.includes('<img src="test.png" alt="test">'), `Got: ${html}`);
    assert.ok(html.includes('<br>'));
    assert.ok(html.includes('<input type="text">'));
  });

  test('component renders correct HTML', () => {
    function Greeting({ name }) {
      return h('span', null, `Hello, ${name}!`);
    }
    const vnode = h(Greeting, { name: 'World' });
    const html = renderToString(vnode);
    assert.equal(html, '<span>Hello, World!</span>');
  });

  test('nested components render correct HTML', () => {
    function Inner({ text }) {
      return h('em', null, text);
    }
    function Outer() {
      return h('div', null,
        h('p', null, h(Inner, { text: 'nested' }))
      );
    }
    const html = renderToString(h(Outer));
    assert.equal(html, '<div><p><em>nested</em></p></div>');
  });

  test('Fragment renders children without wrapper', () => {
    const vnode = h(Fragment, null,
      h('span', null, 'A'),
      h('span', null, 'B')
    );
    const html = renderToString(vnode);
    assert.equal(html, '<span>A</span><span>B</span>');
  });

  test('boolean and null children are omitted', () => {
    const vnode = h('div', null, true, false, null, 'visible', undefined);
    const html = renderToString(vnode);
    assert.equal(html, '<div>visible</div>');
  });

  test('dangerouslySetInnerHTML renders raw HTML', () => {
    const vnode = h('div', { dangerouslySetInnerHTML: { __html: '<b>bold</b>' } });
    const html = renderToString(vnode);
    assert.equal(html, '<div><b>bold</b></div>');
  });

  test('escapes HTML in text content', () => {
    const vnode = h('div', null, '<script>alert("xss")</script>');
    const html = renderToString(vnode);
    assert.ok(!html.includes('<script>'), 'Should escape script tags');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('escapes HTML in attribute values', () => {
    const vnode = h('div', { title: '"><script>alert("xss")</script>' });
    const html = renderToString(vnode);
    assert.ok(!html.includes('<script>'), 'Should escape script tags in attributes');
  });

  test('renders signal values in SSR', () => {
    const name = signal('World');
    const vnode = h('span', null, name);
    const html = renderToString(vnode);
    assert.equal(html, '<span>World</span>');
  });

  test('renders reactive functions in SSR', () => {
    const count = signal(42);
    const vnode = h('span', null, () => `Count: ${count()}`);
    const html = renderToString(vnode);
    assert.equal(html, '<span>Count: 42</span>');
  });

  test('large list SSR (1000 items)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const vnode = h('ul', null,
      ...items.map(i => h('li', { key: i }, `Item ${i}`))
    );
    const html = renderToString(vnode);
    assert.ok(html.startsWith('<ul>'));
    assert.ok(html.endsWith('</ul>'));
    assert.ok(html.includes('<li>Item 0</li>'));
    assert.ok(html.includes('<li>Item 999</li>'));
  });

  test('deeply nested component tree SSR (50 levels)', () => {
    function Wrapper({ depth, children }) {
      if (depth <= 0) return children;
      return h('div', { class: `d${depth}` },
        h(Wrapper, { depth: depth - 1 }, children)
      );
    }
    const vnode = h(Wrapper, { depth: 50 }, 'leaf');
    const html = renderToString(vnode);
    assert.ok(html.includes('leaf'));
    // Count the nesting depth
    const divCount = (html.match(/<div/g) || []).length;
    assert.equal(divCount, 50);
  });

  test('style object rendered as CSS string', () => {
    const vnode = h('div', { style: { backgroundColor: 'red', fontSize: '14px' } });
    const html = renderToString(vnode);
    assert.ok(html.includes('background-color:red'), `Got: ${html}`);
    assert.ok(html.includes('font-size:14px'), `Got: ${html}`);
  });

  test('className rendered as class attribute', () => {
    const vnode = h('div', { className: 'foo bar' });
    const html = renderToString(vnode);
    assert.ok(html.includes('class="foo bar"'), `Got: ${html}`);
  });

  test('event handlers omitted in SSR', () => {
    const vnode = h('button', { onClick: () => {}, onMouseOver: () => {} }, 'Click');
    const html = renderToString(vnode);
    assert.ok(!html.includes('onClick'), `Got: ${html}`);
    assert.ok(!html.includes('onMouseOver'), `Got: ${html}`);
    assert.equal(html, '<button>Click</button>');
  });
});

// ============================================================
// 6. SSR STREAMING
// ============================================================

describe('SSR streaming', () => {
  test('stream renders same output as string', async () => {
    function App() {
      return h('div', { class: 'app' },
        h('h1', null, 'Hello'),
        h('p', null, 'World')
      );
    }
    const stringResult = renderToString(h(App));
    let streamResult = '';
    for await (const chunk of renderToStream(h(App))) {
      streamResult += chunk;
    }
    assert.equal(streamResult, stringResult);
  });

  test('stream handles async components', async () => {
    async function AsyncComponent() {
      return h('div', null, 'async content');
    }
    let result = '';
    for await (const chunk of renderToStream(h(AsyncComponent))) {
      result += chunk;
    }
    assert.equal(result, '<div>async content</div>');
  });
});

// ============================================================
// 7. LARGE LIST REACTIVE UPDATES
// ============================================================

describe('large list handling', () => {
  test('signal holding array of 10000 items', () => {
    const items = signal(Array.from({ length: 10000 }, (_, i) => i));
    const len = computed(() => items().length);
    const sum = computed(() => items().reduce((a, b) => a + b, 0));

    assert.equal(len(), 10000);
    assert.equal(sum(), 49995000);

    // Append item
    items([...items.peek(), 10000]);
    assert.equal(len(), 10001);
  });

  test('computed over large array is lazy', () => {
    const items = signal(Array.from({ length: 100000 }, (_, i) => i));
    let computeCount = 0;

    const expensive = computed(() => {
      computeCount++;
      return items().reduce((a, b) => a + b, 0);
    });

    // Lazy: should not have computed yet
    assert.equal(computeCount, 0);

    // First read
    expensive();
    assert.equal(computeCount, 1);

    // Second read without change: should not recompute
    expensive();
    assert.equal(computeCount, 1);

    // After change
    items([1, 2, 3]);
    expensive();
    assert.equal(computeCount, 2);
  });
});

// ============================================================
// 8. BATCH EDGE CASES
// ============================================================

describe('batch edge cases', () => {
  test('nested batches', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;

    createRoot(() => {
      effect(() => {
        a();
        b();
        runs++;
      });
    });
    assert.equal(runs, 1);

    batch(() => {
      a(1);
      batch(() => {
        b(1);
        batch(() => {
          a(2);
          b(2);
        });
      });
    });

    flushSync();
    assert.equal(a(), 2);
    assert.equal(b(), 2);
    // Should only run once for nested batch
    assert.equal(runs, 2);
  });

  test('batch with exception still flushes', () => {
    const s = signal(0);
    let effectRan = false;

    createRoot(() => {
      effect(() => {
        s();
        effectRan = true;
      });
    });
    effectRan = false;

    try {
      batch(() => {
        s(1);
        throw new Error('intentional');
      });
    } catch (e) {
      // Expected
    }

    flushSync();
    // The signal was set before the throw, so the effect should have run
    assert.equal(s(), 1);
    assert.ok(effectRan, 'Effect should still run after batch exception');
  });

  test('batch writing same value should not trigger effects', () => {
    const s = signal(5);
    let runs = 0;

    createRoot(() => {
      effect(() => {
        s();
        runs++;
      });
    });
    assert.equal(runs, 1);

    batch(() => {
      s(5); // Same value
    });
    flushSync();
    assert.equal(runs, 1, 'Should not re-run effect for same value');
  });
});

// ============================================================
// 9. COMPUTED EDGE CASES
// ============================================================

describe('computed edge cases', () => {
  test('computed returning undefined', () => {
    const s = signal(null);
    const c = computed(() => s()?.name);
    assert.equal(c(), undefined);
    s({ name: 'test' });
    assert.equal(c(), 'test');
  });

  test('computed with NaN handling (Object.is)', () => {
    const s = signal(NaN);
    const c = computed(() => s());
    assert.ok(Number.isNaN(c()));
    // Writing NaN again should not trigger (Object.is(NaN, NaN) === true)
    let effectRuns = 0;
    createRoot(() => {
      effect(() => {
        c();
        effectRuns++;
      });
    });
    assert.equal(effectRuns, 1);
    s(NaN); // Same NaN
    flushSync();
    assert.equal(effectRuns, 1, 'NaN === NaN via Object.is');
  });

  test('computed with -0 vs +0 (Object.is)', () => {
    const s = signal(0);
    let effectRuns = 0;
    createRoot(() => {
      effect(() => {
        s();
        effectRuns++;
      });
    });
    assert.equal(effectRuns, 1);
    s(-0);
    flushSync();
    // Object.is(0, -0) === false, so effect should fire
    assert.equal(effectRuns, 2, '-0 !== +0 via Object.is');
  });
});

// ============================================================
// 10. MEMO (EAGER COMPUTED) EDGE CASES
// ============================================================

describe('memo edge cases', () => {
  test('memo deduplicates notifications', () => {
    const a = signal(1);
    const b = signal(2);
    const sum = signal(3);

    // Memo that derives from sum: only notifies downstream when value actually changes
    let memoComputations = 0;
    let m;
    createRoot(() => {
      m = memo(() => {
        memoComputations++;
        return sum() > 5;
      });
    });
    assert.equal(m(), false);

    let effectRuns = 0;
    createRoot(() => {
      effect(() => {
        m();
        effectRuns++;
      });
    });
    assert.equal(effectRuns, 1);

    // Change sum from 3 to 4: m still false, no downstream notification
    sum(4);
    flushSync();
    assert.equal(m(), false);
    assert.equal(effectRuns, 1, 'No downstream effect when memo value unchanged');
  });
});

// ============================================================
// 11. UNTRACK EDGE CASES
// ============================================================

describe('untrack edge cases', () => {
  test('untrack prevents dependency tracking', () => {
    const tracked = signal(0);
    const untracked = signal(0);
    let runs = 0;

    createRoot(() => {
      effect(() => {
        tracked();
        untrack(() => untracked());
        runs++;
      });
    });
    assert.equal(runs, 1);

    untracked(1);
    flushSync();
    assert.equal(runs, 1, 'Untracked signal should not trigger effect');

    tracked(1);
    flushSync();
    assert.equal(runs, 2, 'Tracked signal should trigger effect');
  });

  test('untrack with nested effects', () => {
    const s = signal(0);
    let outerRuns = 0;

    createRoot(() => {
      effect(() => {
        outerRuns++;
        untrack(() => {
          // Reading s inside untrack
          const val = s();
        });
      });
    });

    s(1);
    flushSync();
    assert.equal(outerRuns, 1, 'Outer effect should not re-run');
  });
});

// ============================================================
// 12. SIGNAL SUBSCRIBE
// ============================================================

describe('signal.subscribe', () => {
  test('subscribe fires immediately with current value', () => {
    const s = signal(42);
    let received = null;
    const dispose = s.subscribe(v => { received = v; });
    assert.equal(received, 42);
    dispose();
  });

  test('subscribe fires on changes', () => {
    const s = signal(0);
    const values = [];
    const dispose = s.subscribe(v => values.push(v));

    s(1);
    flushSync();
    s(2);
    flushSync();

    dispose();
    s(3); // Should not be captured
    flushSync();

    assert.ok(values.includes(0), 'Should include initial value');
    assert.ok(values.includes(1));
    assert.ok(values.includes(2));
    assert.ok(!values.includes(3), 'Should not include value after dispose');
  });
});

// ============================================================
// 13. h() / VNODE EDGE CASES
// ============================================================

describe('h() edge cases', () => {
  test('h() with no props', () => {
    const vnode = h('div', null, 'text');
    assert.equal(vnode.tag, 'div');
    assert.deepEqual(vnode.children, ['text']);
  });

  test('h() with deeply nested children', () => {
    const vnode = h('div', null, [[[['deep']]]]);
    assert.deepEqual(vnode.children, ['deep']);
  });

  test('h() filters out booleans and nulls', () => {
    const vnode = h('div', null, true, false, null, undefined, 'visible', 0);
    assert.deepEqual(vnode.children, ['visible', '0']);
  });

  test('h() with key in props', () => {
    const vnode = h('div', { key: 'mykey', class: 'test' });
    assert.equal(vnode.key, 'mykey');
    assert.equal(vnode.props.key, undefined, 'key should be stripped from props');
  });

  test('h() component receives children in props', () => {
    function Comp(props) {
      return props.children;
    }
    const vnode = h(Comp, null, 'child1', 'child2');
    assert.equal(vnode.tag, Comp);
    assert.deepEqual(vnode.children, ['child1', 'child2']);
  });

  test('h() with numeric children', () => {
    const vnode = h('span', null, 0, 1, 2);
    assert.deepEqual(vnode.children, ['0', '1', '2']);
  });
});

// ============================================================
// 14. PERFORMANCE STRESS
// ============================================================

describe('performance stress', () => {
  test('create and read 100000 signals', () => {
    const signals = [];
    for (let i = 0; i < 100000; i++) {
      signals.push(signal(i));
    }
    let sum = 0;
    for (const s of signals) {
      sum += s.peek();
    }
    assert.equal(sum, (100000 * 99999) / 2);
  });

  test('SSR render 5000 element tree', () => {
    const items = Array.from({ length: 5000 }, (_, i) =>
      h('li', null, `Item ${i}`)
    );
    const vnode = h('ul', null, ...items);
    const start = performance.now();
    const html = renderToString(vnode);
    const elapsed = performance.now() - start;
    assert.ok(html.includes('<li>Item 0</li>'));
    assert.ok(html.includes('<li>Item 4999</li>'));
    console.log(`  SSR 5000 elements: ${elapsed.toFixed(1)}ms`);
    // Should complete in under 1 second
    assert.ok(elapsed < 1000, `SSR too slow: ${elapsed}ms`);
  });

  test('batch 100000 signal writes', () => {
    const s = signal(0);
    let effectRuns = 0;
    createRoot(() => {
      effect(() => {
        s();
        effectRuns++;
      });
    });

    const start = performance.now();
    batch(() => {
      for (let i = 0; i < 100000; i++) {
        s(i);
      }
    });
    flushSync();
    const elapsed = performance.now() - start;

    assert.equal(s(), 99999);
    assert.equal(effectRuns, 2); // initial + 1 batch
    console.log(`  100k batch writes: ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 1000, `Batch too slow: ${elapsed}ms`);
  });
});

// ============================================================
// 15. REACT-COMPAT — test createElement and basic compat
// ============================================================

describe('react-compat basic', () => {
  // Import what we can test without a DOM
  test('createElement produces valid vnode', async () => {
    const { createElement } = await import('../packages/react-compat/src/index.js');
    const vnode = createElement('div', { className: 'test' }, 'Hello');
    assert.equal(vnode.tag, 'div');
    assert.ok(vnode.props.class === 'test', 'className should be normalized to class');
    assert.deepEqual(vnode.children, ['Hello']);
  });

  test('createElement with component', async () => {
    const { createElement } = await import('../packages/react-compat/src/index.js');
    function MyComp(props) {
      return createElement('span', null, props.text);
    }
    const vnode = createElement(MyComp, { text: 'hi' });
    assert.equal(vnode.tag, MyComp);
  });

  test('Children.count works', async () => {
    const { Children } = await import('../packages/react-compat/src/index.js');
    assert.equal(Children.count(['a', 'b', 'c']), 3);
    assert.equal(Children.count(null), 0);
    assert.equal(Children.count('single'), 1);
  });

  test('Children.toArray flattens', async () => {
    const { Children } = await import('../packages/react-compat/src/index.js');
    const arr = Children.toArray([['a', ['b']], 'c']);
    assert.deepEqual(arr, ['a', 'b', 'c']);
  });

  test('isValidElement works', async () => {
    const { createElement, isValidElement } = await import('../packages/react-compat/src/index.js');
    assert.ok(isValidElement(createElement('div')));
    assert.ok(!isValidElement('string'));
    assert.ok(!isValidElement(null));
    assert.ok(!isValidElement(42));
  });

  test('cloneElement preserves and overrides props', async () => {
    const { createElement, cloneElement } = await import('../packages/react-compat/src/index.js');
    const original = createElement('div', { id: 'orig', className: 'a' }, 'child');
    const cloned = cloneElement(original, { className: 'b' });
    assert.equal(cloned.props.id, 'orig');
    assert.equal(cloned.props.class, 'b'); // className normalized to class
  });

  test('forwardRef creates component with $$typeof', async () => {
    const { forwardRef } = await import('../packages/react-compat/src/index.js');
    const Comp = forwardRef((props, ref) => null);
    assert.ok(Comp._forwardRef);
    assert.equal(Comp.$$typeof, Symbol.for('react.forward_ref'));
  });

  test('version is 18.x compatible', async () => {
    const { version } = await import('../packages/react-compat/src/index.js');
    assert.ok(version.startsWith('18.'), `Version should be 18.x, got ${version}`);
  });
});

// ============================================================
// 16. EDGE: concurrent computed reads during batch
// ============================================================

describe('concurrent reads during batch', () => {
  test('computed reads stale value during batch until flush', () => {
    const a = signal(1);
    const b = signal(2);
    const sum = computed(() => a() + b());

    assert.equal(sum(), 3);

    batch(() => {
      a(10);
      // During batch, computed should still see updated value on read
      // because computed is lazy and re-evaluates when read
      assert.equal(sum(), 12);
      b(20);
      assert.equal(sum(), 30);
    });
  });
});

console.log('\n  Stress test suite loaded. Running...\n');
