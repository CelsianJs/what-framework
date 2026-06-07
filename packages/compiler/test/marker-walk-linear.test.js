// Regression: marker access for elements with many dynamic children must use a
// shared forward cursor walk (each marker chains from the previous), NOT
// `el.firstChild.nextSibling…`-from-root per child. The latter is O(n²) in both
// compile time and emitted bundle size. (AUDIT-2026-06-06 H2)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import babelPlugin from '../src/babel-plugin.js';

function compile(source) {
  return transformSync(source, {
    filename: 'test.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  })?.code || '';
}

function longestNextSiblingChain(code) {
  const chains = code.match(/(?:\.nextSibling)+/g) || [];
  return chains.reduce((m, s) => Math.max(m, (s.match(/nextSibling/g) || []).length), 0);
}

function gen(n) {
  let s = 'function C(){\n  const a = signal(0);\n  return <div>';
  for (let i = 0; i < n; i++) s += `<span>{a()}</span>`;
  s += '</div>;\n}';
  return s;
}

describe('compiler: linear marker walk (AUDIT H2)', () => {
  it('emits no long nextSibling chains regardless of child count', () => {
    const chain50 = longestNextSiblingChain(compile(gen(50)));
    const chain200 = longestNextSiblingChain(compile(gen(200)));
    // With cursor chaining the longest single chain is a small constant
    // (consecutive children => 1). A from-root walk would make this grow with n.
    assert.ok(chain50 <= 2, `50-child element produced a nextSibling chain of ${chain50} (expected <= 2)`);
    assert.ok(chain200 <= 2, `200-child element produced a nextSibling chain of ${chain200} (expected <= 2)`);
  });

  it('emitted size grows linearly, not quadratically, with child count', () => {
    const a = compile(gen(100)).length;
    const b = compile(gen(400)).length; // 4x the children
    // Linear => ~4x. Quadratic => ~16x. Assert well under quadratic.
    assert.ok(b < a * 7, `size grew ${(b / a).toFixed(1)}x for 4x children — looks superlinear`);
  });
});
