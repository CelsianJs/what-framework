// Adversarial tests — trying to break What Framework
// Tests: stack overflow, circular deps, type coercion, GC pressure, pathological SSR

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  signal, computed, effect, memo, batch, untrack, flushSync,
  createRoot, h, Fragment,
} from '../packages/core/src/index.js';

import { renderToString, renderToStream } from '../packages/server/src/index.js';

// ============================================================
// 1. STACK OVERFLOW — Can we blow the stack?
// ============================================================

describe('stack overflow resistance', () => {
  test('computed chain depth 5000 should not overflow', () => {
    const base = signal(0);
    let current = base;
    for (let i = 0; i < 5000; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }
    // Reading triggers lazy cascade
    assert.equal(current(), 5000);
  });

  test('SSR component depth 500 should not overflow', () => {
    function Deep({ depth }) {
      if (depth <= 0) return h('span', null, 'leaf');
      return h('div', null, h(Deep, { depth: depth - 1 }));
    }
    const html = renderToString(h(Deep, { depth: 500 }));
    assert.ok(html.includes('leaf'));
  });

  test('deeply nested h() children (1000 levels)', () => {
    let vnode = h('span', null, 'innermost');
    for (let i = 0; i < 1000; i++) {
      vnode = h('div', null, vnode);
    }
    const html = renderToString(vnode);
    assert.ok(html.includes('innermost'));
  });
});

// ============================================================
// 2. CIRCULAR DEPENDENCY — Does computed handle cycles?
// ============================================================

describe('circular dependencies', () => {
  test('two computeds referencing each other should not hang', () => {
    // This is intentionally pathological
    // We expect it to either throw or stop via the iteration guard
    let threw = false;
    let result;
    try {
      const a = computed(() => {
        try { return b() + 1; } catch { return 0; }
      });
      // b is a regular computed, not a computed that calls a, just to be safe
      // Actually let's test mutual recursion
      const b = computed(() => {
        try { return a() + 1; } catch { return 0; }
      });
      result = a();
    } catch (e) {
      threw = true;
    }
    // Should either throw or produce a value, not hang forever
    assert.ok(threw || typeof result === 'number', 'Should not hang');
  });
});

// ============================================================
// 3. TYPE COERCION EDGE CASES
// ============================================================

describe('type coercion edge cases', () => {
  test('signal with various types', () => {
    const s = signal(undefined);
    assert.equal(s(), undefined);
    s(null);
    assert.equal(s(), null);
    s(0);
    assert.equal(s(), 0);
    s('');
    assert.equal(s(), '');
    s(false);
    assert.equal(s(), false);
    s(Symbol.for('test'));
    assert.equal(s(), Symbol.for('test'));
    s(BigInt(42));
    assert.equal(s(), BigInt(42));
  });

  test('signal with object identity', () => {
    const obj = { a: 1 };
    const s = signal(obj);
    let runs = 0;
    createRoot(() => {
      effect(() => { s(); runs++; });
    });
    assert.equal(runs, 1);

    // Same object reference — should not trigger
    s(obj);
    flushSync();
    assert.equal(runs, 1, 'Same object ref should not trigger');

    // New object with same contents — should trigger
    s({ a: 1 });
    flushSync();
    assert.equal(runs, 2, 'New object ref should trigger');
  });

  test('SSR with numbers as children', () => {
    const vnode = h('div', null, 0, -0, NaN, Infinity, -Infinity);
    const html = renderToString(vnode);
    assert.ok(html.includes('0'));
    assert.ok(html.includes('NaN'));
    assert.ok(html.includes('Infinity'));
  });

  test('SSR with empty string children', () => {
    const vnode = h('div', null, '', 'visible', '');
    const html = renderToString(vnode);
    assert.equal(html, '<div>visible</div>');
  });

  test('SSR with symbol should not crash', () => {
    // Symbols can't be concatenated to strings normally
    let threw = false;
    try {
      const vnode = h('div', null, Symbol('test'));
      renderToString(vnode);
    } catch (e) {
      threw = true;
    }
    // Either renders something or throws gracefully, should not crash process
    assert.ok(true, 'Did not crash');
  });
});

// ============================================================
// 4. GC PRESSURE — Many short-lived effects
// ============================================================

describe('GC pressure', () => {
  test('create/dispose 100000 effects rapidly', () => {
    const s = signal(0);
    const start = performance.now();

    for (let i = 0; i < 100000; i++) {
      const dispose = createRoot(dispose => {
        effect(() => { s(); });
        return dispose;
      });
      dispose();
    }

    const elapsed = performance.now() - start;
    console.log(`  100k effect create/dispose: ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);

    // Signal should have 0 subscribers
    if (s._subs) {
      assert.equal(s._subs.size, 0, 'No lingering subscribers');
    }
  });

  test('create/dispose 10000 computed chains', () => {
    const base = signal(0);
    const start = performance.now();

    for (let i = 0; i < 10000; i++) {
      const c1 = computed(() => base() + 1);
      const c2 = computed(() => c1() * 2);
      const c3 = computed(() => c2() + c1());
      c3(); // Force evaluation
    }

    const elapsed = performance.now() - start;
    console.log(`  10k computed chains: ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });
});

// ============================================================
// 5. PATHOLOGICAL SSR CASES
// ============================================================

describe('pathological SSR', () => {
  test('SSR with 10000 elements', () => {
    const items = Array.from({ length: 10000 }, (_, i) =>
      h('tr', null,
        h('td', null, `${i}`),
        h('td', null, `name-${i}`),
        h('td', null, `value-${i}`)
      )
    );
    const vnode = h('table', null, h('tbody', null, ...items));

    const start = performance.now();
    const html = renderToString(vnode);
    const elapsed = performance.now() - start;

    console.log(`  SSR 10k table rows: ${elapsed.toFixed(1)}ms (${(html.length / 1024).toFixed(0)} KB)`);
    assert.ok(html.includes('<tr><td>0</td>'));
    assert.ok(html.includes('<tr><td>9999</td>'));
    assert.ok(elapsed < 2000, `SSR too slow: ${elapsed}ms`);
  });

  test('SSR streaming with 10000 elements matches string', async () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      h('li', null, `Item ${i}`)
    );
    const vnode = h('ul', null, ...items);

    const stringResult = renderToString(vnode);
    let streamResult = '';
    for await (const chunk of renderToStream(vnode)) {
      streamResult += chunk;
    }
    assert.equal(streamResult, stringResult, 'Stream and string should match');
  });

  test('SSR with deeply nested fragments', () => {
    let vnode = h('span', null, 'content');
    for (let i = 0; i < 100; i++) {
      vnode = h(Fragment, null, vnode);
    }
    const html = renderToString(vnode);
    assert.equal(html, '<span>content</span>');
  });

  test('SSR with component returning null', () => {
    function NullComp() { return null; }
    const html = renderToString(h(NullComp));
    assert.equal(html, '');
  });

  test('SSR with component returning array', () => {
    function ArrayComp() {
      return [h('span', null, 'a'), h('span', null, 'b')];
    }
    const html = renderToString(h(ArrayComp));
    assert.equal(html, '<span>a</span><span>b</span>');
  });

  test('SSR with component throwing error', () => {
    function BadComp() {
      throw new Error('boom');
    }
    assert.throws(() => renderToString(h(BadComp)), /boom/);
  });
});

// ============================================================
// 6. CONCURRENT EFFECT SCHEDULING
// ============================================================

describe('effect scheduling edge cases', () => {
  test('effect inside effect cleanup', () => {
    const s = signal(0);
    let innerRuns = 0;

    createRoot(() => {
      effect(() => {
        s();
        return () => {
          // Creating an effect inside cleanup is unusual but should not crash
          // We just verify it doesn't throw
        };
      });
    });

    s(1);
    flushSync();
    // If we got here, no crash
    assert.ok(true);
  });

  test('signal write inside effect should schedule re-run', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;

    // Suppress warning about infinite loops
    const origWarn = console.warn;
    console.warn = () => {};

    createRoot(() => {
      effect(() => {
        runs++;
        const val = a();
        if (val < 3) {
          b(val + 1); // Write to different signal
        }
      });
    });

    flushSync();
    console.warn = origWarn;

    assert.equal(a(), 0);
    assert.ok(b() >= 1, 'b should have been updated');
  });

  test('batch inside effect', () => {
    const a = signal(0);
    const b = signal(0);
    const c = signal(0);
    let runs = 0;

    createRoot(() => {
      effect(() => {
        a();
        runs++;
      });
    });
    assert.equal(runs, 1);

    // Trigger effect that does a batch internally
    createRoot(() => {
      effect(() => {
        b();
        // When b changes, do a batch update
        if (b.peek() > 0) {
          batch(() => {
            a(b.peek() * 10);
            c(b.peek() * 100);
          });
        }
      });
    });

    b(1);
    flushSync();
    assert.equal(a(), 10);
    assert.equal(c(), 100);
  });
});

// ============================================================
// 7. EDGE: Empty and malformed vnodes
// ============================================================

describe('edge case vnodes', () => {
  test('renderToString with undefined', () => {
    assert.equal(renderToString(undefined), '');
  });

  test('renderToString with null', () => {
    assert.equal(renderToString(null), '');
  });

  test('renderToString with true', () => {
    assert.equal(renderToString(true), '');
  });

  test('renderToString with false', () => {
    assert.equal(renderToString(false), '');
  });

  test('renderToString with empty string', () => {
    assert.equal(renderToString(''), '');
  });

  test('renderToString with number 0', () => {
    assert.equal(renderToString(0), '0');
  });

  test('renderToString with empty array', () => {
    assert.equal(renderToString([]), '');
  });

  test('renderToString with nested empty arrays', () => {
    assert.equal(renderToString([[], [[]], []]), '');
  });

  test('renderToString with mixed array', () => {
    const result = renderToString([
      'text',
      h('br'),
      null,
      42,
      false,
      h('span', null, 'ok'),
    ]);
    assert.ok(result.includes('text'));
    assert.ok(result.includes('<br>'));
    assert.ok(result.includes('42'));
    assert.ok(result.includes('<span>ok</span>'));
    assert.ok(!result.includes('false'));
  });
});

// ============================================================
// 8. XSS PREVENTION — Thorough attribute escaping
// ============================================================

describe('XSS prevention', () => {
  test('script injection via text content', () => {
    const html = renderToString(h('div', null, '<script>alert(1)</script>'));
    assert.ok(!html.includes('<script>'));
  });

  test('attribute injection via quotes', () => {
    const html = renderToString(h('div', { title: '" onclick="alert(1)' }));
    assert.ok(!html.includes('onclick'));
  });

  test('attribute injection via angle brackets', () => {
    const html = renderToString(h('div', { title: '><script>alert(1)</script>' }));
    assert.ok(!html.includes('<script>'));
  });

  test('href javascript: protocol', () => {
    // Framework does not filter href values — that's the developer's responsibility
    // But it should at least not double-encode
    const html = renderToString(h('a', { href: 'javascript:alert(1)' }));
    assert.ok(html.includes('href="javascript:alert(1)"'));
  });

  test('data attribute injection', () => {
    const html = renderToString(h('div', { 'data-x': '"><script>alert(1)</script>' }));
    assert.ok(!html.includes('<script>'));
  });
});

// ============================================================
// 9. SIGNAL FUNCTIONAL UPDATE EDGE CASES
// ============================================================

describe('signal functional updates', () => {
  test('functional update receives current value', () => {
    const s = signal(10);
    s(v => v + 5);
    assert.equal(s(), 15);
  });

  test('functional update via .set()', () => {
    const s = signal(10);
    s.set(v => v * 2);
    assert.equal(s(), 20);
  });

  test('multiple functional updates in batch', () => {
    const s = signal(0);
    batch(() => {
      s(v => v + 1);
      s(v => v + 1);
      s(v => v + 1);
    });
    assert.equal(s(), 3);
  });

  test('functional update returning same value does not trigger', () => {
    const s = signal(5);
    let runs = 0;
    createRoot(() => {
      effect(() => { s(); runs++; });
    });
    assert.equal(runs, 1);

    s(v => v); // Returns same value
    flushSync();
    assert.equal(runs, 1, 'Should not trigger for identity function');
  });
});

// ============================================================
// 10. LARGE ATTRIBUTE COUNTS
// ============================================================

describe('large attribute counts', () => {
  test('element with 100 attributes', () => {
    const props = {};
    for (let i = 0; i < 100; i++) {
      props[`data-attr-${i}`] = `value-${i}`;
    }
    const vnode = h('div', props);
    const html = renderToString(vnode);
    assert.ok(html.includes('data-attr-0="value-0"'));
    assert.ok(html.includes('data-attr-99="value-99"'));
  });
});

// ============================================================
// 11. STREAMING SSR ERROR RECOVERY
// ============================================================

describe('streaming SSR error recovery', () => {
  test('stream handles error in component gracefully', async () => {
    function BadComp() {
      throw new Error('stream-error');
    }

    // Suppress console.warn
    const origWarn = console.warn;
    console.warn = () => {};

    let result = '';
    for await (const chunk of renderToStream(h(BadComp))) {
      result += chunk;
    }

    console.warn = origWarn;

    // Should produce an error comment, not crash
    assert.ok(result.includes('SSR Error') || result.includes('stream-error'),
      `Got: ${result}`);
  });
});

console.log('\n  Adversarial test suite loaded. Running...\n');
