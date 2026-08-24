// Regression: marker access for elements with many dynamic children must use a
// shared forward cursor walk (each marker chains from the previous), NOT
// `el.firstChild.nextSibling…`-from-root per child. The latter is O(n²) in both
// compile time and emitted bundle size. (AUDIT-2026-06-06 H2)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

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
    const chain50 = longestNextSiblingChain(compileJSX(gen(50, { filename: 'test.jsx' })));
    const chain200 = longestNextSiblingChain(compileJSX(gen(200, { filename: 'test.jsx' })));
    // With cursor chaining the longest single chain is a small constant
    // (consecutive children => 1). A from-root walk would make this grow with n.
    assert.ok(chain50 <= 2, `50-child element produced a nextSibling chain of ${chain50} (expected <= 2)`);
    assert.ok(chain200 <= 2, `200-child element produced a nextSibling chain of ${chain200} (expected <= 2)`);
  });

  it('emitted size grows linearly, not quadratically, with child count', () => {
    const a = compileJSX(gen(100, { filename: 'test.jsx' })).length;
    const b = compileJSX(gen(400, { filename: 'test.jsx' })).length; // 4x the children
    // Linear => ~4x. Quadratic => ~16x. Assert well under quadratic.
    assert.ok(b < a * 7, `size grew ${(b / a).toFixed(1)}x for 4x children — looks superlinear`);
  });
});
