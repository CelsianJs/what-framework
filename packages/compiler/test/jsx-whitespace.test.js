// Regression: JSX text adjacent to expressions must preserve a leading/trailing
// single-line space. Before the fix, `{n} items` compiled with the space
// trimmed, rendering `5items` in the DOM.

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

describe('JSX text whitespace', () => {
  it('preserves a leading space between expression and trailing text', () => {
    const code = compile(`
      function A() {
        return <p>{count()} items</p>;
      }
    `);
    // Pre-fix produced 'items' (no space). Now must contain ' items' or
    // emit a separate insert with the space preserved in the template.
    assert.ok(
      code.includes(' items') || code.includes('" items"'),
      `compiled code lost the leading space:\n${code}`
    );
  });

  it('preserves a trailing space between text and expression', () => {
    const code = compile(`
      function A() {
        return <p>Count: {n()}</p>;
      }
    `);
    assert.ok(
      code.includes('Count: ') || code.includes('"Count: "'),
      `compiled code lost the trailing space:\n${code}`
    );
  });

  it('collapses pure-whitespace lines but preserves inline single spaces', () => {
    const code = compile(`
      function A() {
        return (
          <div>
            <span>hi</span>
            {n()}
          </div>
        );
      }
    `);
    // Pure newline+indentation between siblings should NOT produce a literal
    // " " text node — that would create dead text nodes in the DOM. The
    // compiler should treat purely-blank inter-sibling whitespace as nothing.
    // We just assert the file compiled without "<span>hi</span> {" leaving
    // stray escaped space templates.
    assert.ok(!code.includes('"   "'), `unexpected whitespace literal:\n${code}`);
  });

  it('keeps the space between two expressions separated by one space', () => {
    const code = compile(`
      function A() {
        return <p>{a()} {b()}</p>;
      }
    `);
    // The compiler emits markers for expressions, and the literal space
    // between them lives inside the template HTML between the markers.
    assert.ok(
      /<!--\$-->\s+<!--\$-->/.test(code) || code.includes('" "') || code.includes(`' '`),
      `space between expressions was dropped:\n${code}`
    );
  });
});
