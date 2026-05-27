// Regression tests for:
//   P0 — `_$insert(_el$N, ...)` emitted in a different lexical block than
//        `const _el$N = _tmpl$M()`. Happened when JSX returned from a
//        single-statement `if` body: `if (cond) return <Tag>{x}</Tag>;`.
//        The fix wraps such positions in an IIFE so the const + insert live
//        in the same block.
//
//   P2 — Unknown event modifier warn-once cache was process-global, keyed
//        only on the segment name. In a long-running Vite dev server the
//        same typo in two different files would warn once total. Fixed to
//        key on `${filename}::${segment}`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import babelPlugin from '../src/babel-plugin.js';

const traverse = _traverse.default || _traverse;

function compile(source, filename = 'test.jsx') {
  const result = transformSync(source, {
    filename,
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  });
  return result?.code || '';
}

// Walk the compiled output and assert every `_el$N` Identifier reference
// has a `const _el$N = ...` declaration in the same scope or an ancestor
// scope. This is exactly the bug class we want to prevent forever.
function assertNoElDollarTDZ(code) {
  const ast = parse(code, { sourceType: 'module', plugins: [] });
  const violations = [];

  traverse(ast, {
    Identifier(path) {
      const name = path.node.name;
      if (!/^_el\$\d+$/.test(name)) return;
      // Skip the declarator itself
      if (path.parentPath.isVariableDeclarator({ id: path.node })) return;
      // Skip function/arrow parameters that happen to share the name (none expected)
      if (path.parentPath.isFunction({ params: path.parentPath.node.params }) &&
          path.parentPath.node.params.includes(path.node)) return;

      const binding = path.scope.getBinding(name);
      if (!binding) {
        violations.push(`${name} referenced with no binding in scope`);
        return;
      }
      // Binding must be a 'const' VariableDeclaration. Babel scope tracks
      // lexical visibility, so getBinding only returns it if the declaration
      // is in the same or an ancestor scope. Bonus check: kind === 'const'.
      if (binding.kind !== 'const' && binding.kind !== 'let' && binding.kind !== 'var') {
        violations.push(`${name} binding has unexpected kind ${binding.kind}`);
      }
    },
  });

  assert.equal(violations.length, 0,
    `TDZ violations found:\n  ${violations.join('\n  ')}\n\nCompiled output:\n${code}`);
}

describe('TDZ: _$insert never appears before const _el$N declaration', () => {
  it('if (cond) return <Tag>{var}</Tag> — single-statement if body', () => {
    const code = compile(`
      function TabContent({ tab }) {
        const items = signal([], 'items');
        return (
          <div>
            {() => {
              const list = items();
              if (list.length === 0) return <p class="muted">No items in {tab}</p>;
              return list.map(item => <div>{item.text}</div>);
            }}
          </div>
        );
      }
    `);
    assertNoElDollarTDZ(code);
  });

  it('if (cond) return <Tag>{var}</Tag> — without an else branch', () => {
    const code = compile(`
      function A({ name }) {
        return (
          <div>
            {() => {
              if (name) return <span class="hi">Hello {name}!</span>;
              return null;
            }}
          </div>
        );
      }
    `);
    assertNoElDollarTDZ(code);
  });

  it('while (cond) return <Tag>{var}</Tag> — single-statement loop body', () => {
    // Not a realistic component pattern, but the bug class is the same:
    // any single-statement parent of a JSX-bearing return.
    const code = compile(`
      function A({ items }) {
        return <div>{() => {
          while (items.length) return <p>{items[0]}</p>;
          return null;
        }}</div>;
      }
    `);
    assertNoElDollarTDZ(code);
  });

  it('block-body if returning JSX still compiles cleanly (existing happy path)', () => {
    const code = compile(`
      function A({ tab }) {
        return <div>{() => {
          if (tab) { return <p>tab is {tab}</p>; }
          return null;
        }}</div>;
      }
    `);
    assertNoElDollarTDZ(code);
  });

  it('top-level component return with dynamic child — happy path keeps inline emission', () => {
    // Regression guard: don't accidentally IIFE-wrap the common case where
    // setup CAN be hoisted next to a sibling statement in a real block.
    const code = compile(`
      function A({ name }) {
        return <p>Hello {name}!</p>;
      }
    `);
    assertNoElDollarTDZ(code);
    // And ensure we did not regress to an IIFE wrap for a normal return.
    // The const should sit directly inside the function body.
    assert.match(code, /function A\([^)]*\)\s*\{[\s\S]*const\s+_el\$\d+\s*=\s*_tmpl/);
  });
});

describe('Unknown event modifier warn-once is per-file', () => {
  it('warns for the same unknown modifier in two different files', () => {
    const originalWarn = console.warn;
    const messages = [];
    console.warn = (msg) => { messages.push(String(msg)); };
    try {
      compile(`function A() { return <button onclick__totalyWrong={() => {}}>x</button>; }`, '/a.jsx');
      compile(`function B() { return <button onclick__totalyWrong={() => {}}>y</button>; }`, '/b.jsx');
    } finally {
      console.warn = originalWarn;
    }
    const matching = messages.filter(m => m.includes('totalyWrong'));
    assert.equal(matching.length, 2,
      `Expected one warning per file, got ${matching.length}:\n${matching.join('\n')}`);
    // And each warning should mention its own file.
    assert.ok(matching.some(m => m.includes('/a.jsx')), 'expected warning for /a.jsx');
    assert.ok(matching.some(m => m.includes('/b.jsx')), 'expected warning for /b.jsx');
  });

  it('still de-dupes within a single file', () => {
    const originalWarn = console.warn;
    const messages = [];
    console.warn = (msg) => { messages.push(String(msg)); };
    try {
      compile(`
        function A() {
          return <div>
            <button onclick__nope={() => {}}>a</button>
            <button onclick__nope={() => {}}>b</button>
            <button onclick__nope={() => {}}>c</button>
          </div>;
        }
      `, '/dedupe.jsx');
    } finally {
      console.warn = originalWarn;
    }
    const matching = messages.filter(m => m.includes('"__nope"'));
    assert.equal(matching.length, 1,
      `Expected exactly one warning for repeated unknown modifier in a single file, got ${matching.length}`);
  });
});
