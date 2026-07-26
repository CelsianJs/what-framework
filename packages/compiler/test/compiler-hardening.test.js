/**
 * Compiler Hardening Tests — SVG, Tables, Imported Signals
 *
 * Tests for Sprint 2 compiler fixes:
 * 1. SVG namespace support in template()
 * 2. Table element wrapping in template()
 * 3. Imported signal reactivity tracking in babel-plugin
 */

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
// SVG Template Tests (compiler output)
// =====================================================

describe('SVG namespace support', () => {
  it('generates template for static SVG element', () => {
    const code = compile(`
      function Icon() {
        return <svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z" /></svg>;
      }
    `);

    // Should produce a template with the SVG content
    assert.match(code, /_\$template\(/);
    assert.match(code, /<svg/);
    assert.match(code, /<path/);
  });

  it('generates template for SVG with dynamic attributes', () => {
    const code = compile(`
      function Icon() {
        const color = signal('#000');
        return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill={color()} /></svg>;
      }
    `);

    // Should have template + effect for dynamic fill
    assert.match(code, /_\$template\(/);
    assert.match(code, /_\$effect\(/);
    assert.match(code, /<svg/);
    assert.match(code, /<circle/);
  });

  it('handles nested SVG elements in template', () => {
    const code = compile(`
      function Icon() {
        return (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <g>
              <rect x="10" y="10" width="80" height="80" />
              <circle cx="50" cy="50" r="30" />
            </g>
          </svg>
        );
      }
    `);

    assert.match(code, /_\$template\(/);
    assert.match(code, /<g>/);
    assert.match(code, /<rect/);
    assert.match(code, /<circle/);
  });

  it('preserves camelCase SVG attributes like viewBox', () => {
    const code = compile(`
      function Icon() {
        return <svg viewBox="0 0 24 24"><path d="M0 0" /></svg>;
      }
    `);

    assert.match(code, /viewBox/);
  });
});

// =====================================================
// Table Element Tests (compiler output)
// =====================================================

describe('table element wrapping', () => {
  it('generates template for a complete table', () => {
    const code = compile(`
      function Table() {
        return (
          <table>
            <thead>
              <tr><th>Name</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr><td>A</td><td>1</td></tr>
            </tbody>
          </table>
        );
      }
    `);

    assert.match(code, /_\$template\(/);
    assert.match(code, /<table>/);
    assert.match(code, /<thead>/);
    assert.match(code, /<tbody>/);
    assert.match(code, /<tr>/);
    assert.match(code, /<td>/);
    assert.match(code, /<th>/);
  });

  it('generates template with dynamic table cell content', () => {
    const code = compile(`
      function Row() {
        const name = signal('test');
        return (
          <table>
            <tbody>
              <tr><td>{name()}</td></tr>
            </tbody>
          </table>
        );
      }
    `);

    assert.match(code, /_\$template\(/);
    assert.match(code, /_\$insert\(/);
    assert.match(code, /<table>/);
  });
});

// =====================================================
// Imported Signal Tracking Tests
// =====================================================

describe('imported signal tracking', () => {
  it('wraps imported function calls in JSX with effects', () => {
    const code = compile(`
      import { count } from './store';
      function App() {
        return <div>{count()}</div>;
      }
    `);

    // count() is imported — should be treated as potentially reactive
    // and wrapped in an arrow function for the insert call
    assert.match(code, /=>\s*count\(\)/, 'imported signal call should be wrapped in arrow function');
  });

  it('wraps imported signal in attribute effects', () => {
    const code = compile(`
      import { theme } from './store';
      function App() {
        return <div class={theme()}>Hello</div>;
      }
    `);

    // theme() is imported — should be wrapped in an effect
    assert.match(code, /_\$effect\(/, 'imported signal in attribute should trigger effect');
  });

  it('handles named imports from store modules', () => {
    const code = compile(`
      import { firstName, lastName } from './userStore';
      function Profile() {
        return <div><span>{firstName()}</span> <span>{lastName()}</span></div>;
      }
    `);

    // Both imported signals should be treated as reactive
    assert.match(code, /=>\s*firstName\(\)/, 'firstName should be wrapped reactively');
    assert.match(code, /=>\s*lastName\(\)/, 'lastName should be wrapped reactively');
  });

  it('handles default imports as potentially reactive', () => {
    const code = compile(`
      import getCount from './counter';
      function App() {
        return <div>{getCount()}</div>;
      }
    `);

    assert.match(code, /=>\s*getCount\(\)/, 'default imported call should be wrapped reactively');
  });

  it('does not double-wrap local signals that are also tracked', () => {
    const code = compile(`
      import { signal } from 'what-framework';
      function App() {
        const count = signal(0);
        return <div>{count()}</div>;
      }
    `);

    // count is a local signal — should still be wrapped (only once)
    assert.match(code, /=>\s*count\(\)/, 'local signal should be wrapped');
  });

  it('treats imported identifier in ternary expression as reactive', () => {
    const code = compile(`
      import { isLoggedIn } from './auth';
      function App() {
        return <div>{isLoggedIn() ? 'Yes' : 'No'}</div>;
      }
    `);

    assert.match(code, /_\$insert\(/, 'ternary with imported signal should use insert');
    assert.match(code, /=>/, 'expression should be wrapped in arrow function');
  });

  it('treats imported identifier in template literal as reactive', () => {
    const code = compile(`
      import { userName } from './store';
      function Greeting() {
        return <p>{\`Hello, \${userName()}\`}</p>;
      }
    `);

    assert.match(code, /=>/, 'template literal with imported signal should be wrapped');
  });
});

// =========================================================================
// The static-template builder must not bake handler-shaped attributes into
// the template string. innerHTML revives them as live handlers, which is the
// same case-sensitivity gap that was fixed on the runtime and SSR paths.
// =========================================================================

function templateStrings(code) {
  return [...code.matchAll(/_\$template\(("(?:[^"\\]|\\.)*")\)/g)].map(m => m[1]);
}

describe('static template handler stripping', () => {
  const variants = ['ONCLICK', 'OnClick', 'onCLICK', 'ONMOUSEOVER'];

  for (const name of variants) {
    it(`does not emit ${name} into the static template`, () => {
      const code = compile(`const a = <div ${name}="alert(1)">x</div>;`);
      const tmpls = templateStrings(code);
      assert.ok(tmpls.length > 0, `no template emitted: ${code}`);
      for (const t of tmpls) {
        assert.ok(!/alert\(1\)/.test(t), `${name} baked a live handler into the template: ${t}`);
        assert.ok(!/\bon[a-z]+\s*=/i.test(t), `${name} survived into the template: ${t}`);
      }
    });
  }

  it('keeps lowercase handlers out of the template too', () => {
    const code = compile('const a = <div onclick="alert(1)">x</div>;');
    for (const t of templateStrings(code)) {
      assert.ok(!/alert\(1\)/.test(t), `onclick reached the template: ${t}`);
    }
  });

  it('still keeps ordinary attributes in the template', () => {
    const code = compile('const a = <div id="keep" class="c">x</div>;');
    const tmpls = templateStrings(code);
    assert.equal(tmpls.length, 1, code);
    assert.ok(/id=\\"keep\\"/.test(tmpls[0]), tmpls[0]);
    assert.ok(/class=\\"c\\"/.test(tmpls[0]), tmpls[0]);
  });
});
