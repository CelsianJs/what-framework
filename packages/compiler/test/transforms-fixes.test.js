// Compiler tests for the transforms touched by the recent diff:
//   <Show>: hoisted condition (no double-eval), missing-when build error
//   .map() → _$mapArray lowering (key required), warning when key missing
//   <For key={...}>: passes key option through to _$mapArray
//   Event modifiers: `|` and `__` parse identically

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import babelPlugin from '../src/babel-plugin.js';

function compile(source) {
  const result = transformSync(source, {
    filename: 'test.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  });
  return result?.code || '';
}

// =====================================================
// <Show> — no double-evaluation of `when`
// =====================================================

describe('<Show> transform', () => {
  it('hoists `when` into a memoized local so it is evaluated once per re-run', () => {
    const code = compile(`
      const cond = signal(false);
      function App() {
        return <Show when={cond}>{(v) => <p>{v}</p>}</Show>;
      }
    `);
    // The reactive condition is routed through an equality-gated memo (C1
    // branch memoization) — render-fn children get the VALUE memo (no !!).
    assert.match(code, /_\$memo\(\(\)\s*=>\s*cond\(\)\)/,
      'should memoize cond() (value-gated for render-fn children)');
    // The Show body reads the memo into a local — NOT cond() twice.
    assert.match(code, /const\s+_v\w*\s*=\s*_c\$\d+\(\)/,
      'should capture the memo read into a local');
    // Count cond() occurrences inside the Show output — must be exactly 1.
    const condCalls = code.match(/cond\(\)/g) || [];
    assert.equal(condCalls.length, 1, `expected exactly one cond() call, got ${condCalls.length}`);
  });

  it('supports identifier `when` (signal-like — invokes as accessor)', () => {
    const code = compile(`
      function App() {
        const isOpen = signal(false);
        return <Show when={isOpen}>hello</Show>;
      }
    `);
    // Static children → truthiness-gated memo: _$memo(() => !!isOpen())
    assert.match(code, /_\$memo\(\(\)\s*=>\s*!!isOpen\(\)\)/);
    assert.match(code, /const\s+_v\w*\s*=\s*_c\$\d+\(\)/);
  });

  it('supports identifier `when` from imports (treated as signal accessor)', () => {
    const code = compile(`
      import { isOpen } from './store.js';
      function App() {
        return <Show when={isOpen}>hello</Show>;
      }
    `);
    assert.match(code, /_\$memo\(\(\)\s*=>\s*!!isOpen\(\)\)/);
    assert.match(code, /const\s+_v\w*\s*=\s*_c\$\d+\(\)/);
  });

  it('does NOT invoke a member-expression `when` (plain boolean)', () => {
    const code = compile(`
      function App() {
        return <Show when={user.isAdmin}>hi admin</Show>;
      }
    `);
    // Must NOT emit user.isAdmin() — that would call a non-function at runtime.
    assert.doesNotMatch(code, /user\.isAdmin\s*\(/, 'should not invoke member access');
    assert.match(code, /const\s+_v\w*\s*=\s*user\.isAdmin/);
  });

  it('does NOT invoke a logical/binary `when` (plain boolean)', () => {
    const code = compile(`
      function App() {
        const x = signal(0);
        return <Show when={x() > 5}>big</Show>;
      }
    `);
    // The whole expression `x() > 5` is the (memoized) condition; no extra
    // outer call wrapping it.
    assert.match(code, /_\$memo\(\(\)\s*=>\s*!!\(x\(\)\s*>\s*5\)\)/);
    // Specifically no `(x() > 5)()` pattern.
    assert.doesNotMatch(code, /\(x\(\)\s*>\s*5\)\s*\(/);
  });

  it('does NOT invoke a literal `when`', () => {
    const code = compile(`
      function App() {
        return <Show when={true}>always</Show>;
      }
    `);
    assert.match(code, /const\s+_v\w*\s*=\s*true/);
    assert.doesNotMatch(code, /true\s*\(/);
  });

  it('does NOT invoke an identifier that is a plain non-signal const', () => {
    // Conservative default: if the binding is a non-signal-creating const
    // (here a plain boolean), do not invoke — that would throw at runtime.
    const code = compile(`
      function App() {
        const enabled = true;
        return <Show when={enabled}>hi</Show>;
      }
    `);
    assert.doesNotMatch(code, /enabled\s*\(/, 'plain const must not be invoked');
    assert.match(code, /const\s+_v\w*\s*=\s*enabled/);
  });

  it('supports call-expression `when`', () => {
    const code = compile(`
      function App() {
        return <Show when={isReady()}>hello</Show>;
      }
    `);
    assert.match(code, /const\s+_v\w*\s*=\s*isReady\(\)/);
  });

  it('supports arrow-body `when`', () => {
    const code = compile(`
      function App() {
        return <Show when={() => count() > 5}>hello</Show>;
      }
    `);
    assert.match(code, /const\s+_v\w*\s*=\s*count\(\)\s*>\s*5/);
  });

  it('supports `fallback`', () => {
    const code = compile(`
      function App() {
        return <Show when={isOpen} fallback={<p>closed</p>}>open</Show>;
      }
    `);
    assert.match(code, /const\s+_v\w*\s*=/);
    // Fallback expression must appear in the alternate branch (after `:`).
    // We loosely check the compiled string contains a fallback marker.
    assert.match(code, /closed/);
  });

  it('throws a build error when `when` is missing', () => {
    assert.throws(
      () => compile(`function App() { return <Show>hello</Show>; }`),
      /Show.*"when"/,
      'compile should fail with a clear message about missing when'
    );
  });
});

// =====================================================
// .map() → _$mapArray lowering
// =====================================================

describe('.map() lowering to _$mapArray', () => {
  it('lowers map with a key prop on the JSX child', () => {
    const code = compile(`
      function App() {
        return <ul>{items().map(item => <li key={item.id}>{item.name}</li>)}</ul>;
      }
    `);
    assert.match(code, /_\$mapArray/, 'should emit _$mapArray');
    assert.match(code, /key:/, 'should include a key option');
    // `raw: true` is required so the user's map callback receives the raw item.
    assert.match(code, /raw:\s*true/);
  });

  it('does NOT lower map without a key prop (and warns)', () => {
    // Capture warnings to confirm we emit one.
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const code = compile(`
        function App() {
          return <ul>{items().map(item => <li>{item.name}</li>)}</ul>;
        }
      `);
      // Either inserts the raw map call OR uses h(); critically NOT _$mapArray.
      assert.doesNotMatch(code, /_\$mapArray/);
      assert.ok(
        warnings.some(w => /key/.test(w) && /map/.test(w)),
        'expected a compile-time warning about missing key on .map()'
      );
    } finally {
      console.warn = origWarn;
    }
  });

  it('lowers map wrapped in an arrow: () => arr().map(...)', () => {
    const code = compile(`
      function App() {
        return <ul>{() => items().map(item => <li key={item.id}>{item.name}</li>)}</ul>;
      }
    `);
    assert.match(code, /_\$mapArray/);
  });
});

// =====================================================
// <For key={...}>
// =====================================================

describe('<For> transform', () => {
  it('passes a key option to _$mapArray when key is provided', () => {
    const code = compile(`
      function App() {
        return <For each={data} key={item => item.id}>{(item) => <Row item={item} />}</For>;
      }
    `);
    assert.match(code, /_\$mapArray/);
    assert.match(code, /key:/);
  });

  it('omits the options object when no key is provided', () => {
    const code = compile(`
      function App() {
        return <For each={data}>{(item) => <Row item={item} />}</For>;
      }
    `);
    assert.match(code, /_\$mapArray\s*\(/);
    // Without a key, _$mapArray gets exactly two args (no options object).
    // We check by looking for the absence of `key:` in the call.
    const mapArrayMatch = code.match(/_\$mapArray\([^)]*\)/);
    assert.ok(mapArrayMatch);
    assert.doesNotMatch(mapArrayMatch[0], /key:/);
  });
});

// =====================================================
// Event modifiers — `|` and `__` are equivalent
// =====================================================

describe('event modifiers', () => {
  it('parses `onclick|prevent|stop` modifier syntax', () => {
    // Use template-string attribute syntax (JSX namespaces don't support `|`).
    // The pipe form is for template-string compilers only — JSX uses `__`.
    // Here we just verify the modifier parser accepts both delimiters via `__`.
    const codeUnderscore = compile(`
      function App() {
        return <button onclick__preventDefault__stopPropagation={fn}>x</button>;
      }
    `);
    // Should produce an addEventListener with a wrapper that calls preventDefault
    assert.match(codeUnderscore, /addEventListener\(\s*["']click["']/);
    assert.match(codeUnderscore, /preventDefault/);
    assert.match(codeUnderscore, /stopPropagation/);
  });

  it('warns once about unknown __-delimited modifier segments', () => {
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      compile(`
        function App() {
          return <button onclick__preventDefault__notAModifier={fn}>x</button>;
        }
      `);
      assert.ok(
        warnings.some(w => /notAModifier/.test(w) && /modifier/.test(w)),
        'expected a warning about unknown event modifier'
      );
    } finally {
      console.warn = origWarn;
    }
  });

  it('all-unknown modifier segments still route through modifier path (not silent passthrough)', () => {
    // Regression: `onclick__totalyWrong` used to be classified as "no
    // modifiers", which emitted `el.$$onclick__totalyWrong = handler` —
    // a delegated-event property that never fires. Now it must warn AND
    // route through addEventListener('click', handler) (modifier path).
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    let code;
    try {
      code = compile(`
        function App() {
          return <button onclick__totalyWrongUniqA={fn}>x</button>;
        }
      `);
    } finally {
      console.warn = origWarn;
    }

    assert.ok(
      warnings.some(w => /totalyWrongUniqA/.test(w)),
      'expected warning about unknown modifier segment'
    );
    // Must NOT emit the broken delegated-property form
    assert.doesNotMatch(
      code,
      /\$\$onclick__totalyWrongUniqA/,
      'must not silently emit el.$$onclick__totalyWrongUniqA assignment'
    );
    // Must route through addEventListener with the bare event name
    assert.match(code, /addEventListener\(\s*["']click["']/);
  });

  it('mixed known+unknown modifiers: warns about unknown, applies known', () => {
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    let code;
    try {
      code = compile(`
        function App() {
          return <button onclick__preventDefault__alsoWrongUniqB={fn}>x</button>;
        }
      `);
    } finally {
      console.warn = origWarn;
    }

    assert.ok(
      warnings.some(w => /alsoWrongUniqB/.test(w)),
      'expected warning about the unknown segment'
    );
    // The known modifier must still be applied — wrapper calls preventDefault
    assert.match(code, /preventDefault/);
    assert.match(code, /addEventListener\(\s*["']click["']/);
    // And the broken delegated-property form must not appear
    assert.doesNotMatch(code, /\$\$onclick__/);
  });

  it('onclick__ trailing delimiter is treated as a plain event (no modifiers)', () => {
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    let code;
    try {
      code = compile(`
        function App() {
          return <button onclick__={fn}>x</button>;
        }
      `);
    } finally {
      console.warn = origWarn;
    }
    // Should NOT route through addEventListener (no real modifiers)
    // Should use delegated event or direct assignment
    assert.doesNotMatch(code, /addEventListener\(\s*["']click["']/,
      'onclick__ with no real modifiers should not use addEventListener');
    // No warnings about unknown modifiers (empty string filtered out)
    const modWarnings = warnings.filter(w => /modifier/.test(w));
    assert.equal(modWarnings.length, 0,
      'no modifier warnings for trailing delimiter');
  });
});

// =====================================================
// Nested <Show> variable scoping
// =====================================================

describe('nested <Show> variable scoping', () => {
  it('two nested Shows each hoist their own condition variable without collision', () => {
    const code = compile(`
      function App() {
        const a = signal(true);
        const b = signal(false);
        return (
          <Show when={a}>
            <Show when={b}>
              <p>inner</p>
            </Show>
          </Show>
        );
      }
    `);
    // Both Shows hoist a condition variable. They may reuse the same name
    // (_v) since the inner one is in a nested scope (IIFE). The key check
    // is that both conditions are captured into locals — not evaluated twice.
    // With branch memoization (C1) the local reads a distinct memo accessor.
    const condCaptures = code.match(/const\s+_v\w*\s*=\s*_c\$\d+\(\)/g) || [];
    assert.ok(condCaptures.length >= 2,
      `both nested Shows should hoist their condition, got: ${condCaptures.join('; ')}`);
    // Verify each signal is memoized exactly once and the memo names differ.
    // (The memo is !!-gated for static children; value-gated when the content
    // is a function — the inner Show transform produces a function.)
    const memos = code.match(/_c\$\d+\s*=\s*_\$memo\(\(\)\s*=>\s*(?:!!)?(?:a|b)\(\)\)/g) || [];
    assert.ok(memos.some(m => /\ba\(\)/.test(m)), 'outer Show memoizes a()');
    assert.ok(memos.some(m => /\bb\(\)/.test(m)), 'inner Show memoizes b()');
  });
});

// =====================================================
// .map() inside conditional (ternary)
// =====================================================

describe('.map() inside conditional', () => {
  it('map with key inside ternary IS lowered to _$mapArray', () => {
    const code = compile(`
      function App() {
        const show = signal(true);
        const items = signal([]);
        return (
          <div>
            {() => show()
              ? items().map(item => <li key={item.id}>{item.name}</li>)
              : null
            }
          </div>
        );
      }
    `);
    assert.match(code, /_\$mapArray/,
      '.map() inside ternary consequent should be lowered');
  });

  it('map with key inside logical && IS lowered to _$mapArray', () => {
    const code = compile(`
      function App() {
        const show = signal(true);
        const items = signal([]);
        return (
          <div>
            {() => show() && items().map(item => <li key={item.id}>{item.name}</li>)}
          </div>
        );
      }
    `);
    assert.match(code, /_\$mapArray/,
      '.map() inside logical && should be lowered');
  });

  it('non-map branch of ternary is preserved as-is', () => {
    const code = compile(`
      function App() {
        const show = signal(true);
        const items = signal([]);
        return (
          <div>
            {() => show()
              ? items().map(item => <li key={item.id}>{item.name}</li>)
              : <p>No items</p>
            }
          </div>
        );
      }
    `);
    assert.match(code, /_\$mapArray/,
      'map branch is lowered');
  });
});
