// Regression: when .map() is lowered inside a ternary/logical, the surrounding
// condition must remain reactive. Before AUDIT-2026-06-06 H1 the compiler
// emitted `_$insert(el, cond ? _$mapArray(...) : fallback, m)` with NO arrow
// wrapper, so `cond` was read once and toggling it never switched list<->fallback.

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

describe('compiler: .map() in ternary/logical stays reactive (AUDIT H1)', () => {
  it('wraps a ternary containing a lowered map in () =>', () => {
    const out = compile(`
      function L({ show, items }) {
        return <ul>{show() ? items().map(i => <li key={i.id}>{i.t}</li>) : <li>empty</li>}</ul>;
      }
    `);
    assert.match(out, /_\$mapArray/, 'map should be lowered to _$mapArray');
    // The insert argument must be an arrow wrapping the ternary, not a bare ternary.
    assert.match(out, /_\$insert\([^,]+,\s*\(\)\s*=>/,
      `ternary insert must be wrapped in () =>:\n${out}`);
  });

  it('wraps a logical && containing a lowered map in () =>', () => {
    const out = compile(`
      function L({ show, items }) {
        return <ul>{show() && items().map(i => <li key={i.id}>{i.t}</li>)}</ul>;
      }
    `);
    assert.match(out, /_\$mapArray/);
    assert.match(out, /_\$insert\([^,]+,\s*\(\)\s*=>/,
      `logical insert must be wrapped in () =>:\n${out}`);
  });

  it('does NOT wrap a bare .map() (self-managing _$mapArray inserter)', () => {
    const out = compile(`
      function L({ items }) {
        return <ul>{items().map(i => <li key={i.id}>{i.t}</li>)}</ul>;
      }
    `);
    assert.match(out, /_\$mapArray/);
    // Bare map must be passed directly: _$insert(el, _$mapArray(...), m) with no () =>
    assert.match(out, /_\$insert\([^,]+,\s*_\$mapArray\(/,
      `bare map must be passed raw, not arrow-wrapped:\n${out}`);
  });
});
