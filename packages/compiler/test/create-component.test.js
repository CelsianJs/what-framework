// Test: compiled component output uses _$createComponent, not h()

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import whatBabelPlugin from '../src/babel-plugin.js';

function compile(code) {
  const result = transformSync(code, {
    plugins: [whatBabelPlugin],
    parserOpts: { plugins: ['jsx'] },
    filename: 'test.jsx',
  });
  return result.code;
}

describe('Component compilation uses _$createComponent', () => {
  it('emits _$createComponent for user components', () => {
    const code = `
      function App() {
        return <MyComponent foo="bar" />;
      }
    `;
    const output = compile(code);

    assert.ok(
      output.includes('_$createComponent'),
      `Expected _$createComponent in output, got:\n${output}`
    );
    // h() should NOT appear as a component call — only _$createComponent
    // Note: h may still appear in import declarations for fallback cases,
    // but should NOT appear as h(MyComponent, ...)
    assert.ok(
      !output.includes('h(MyComponent'),
      `Expected no h(MyComponent) in output, got:\n${output}`
    );
  });

  it('emits _$createComponent with children array', () => {
    const code = `
      function App() {
        return <Layout><Child /><p>text</p></Layout>;
      }
    `;
    const output = compile(code);

    assert.ok(
      output.includes('_$createComponent'),
      `Expected _$createComponent in output, got:\n${output}`
    );
    assert.ok(
      !output.includes('h(Layout'),
      `Expected no h(Layout) in output, got:\n${output}`
    );
  });

  it('emits _$createComponent for Show component', () => {
    const code = `
      function App() {
        return <Show when={true}><p>visible</p></Show>;
      }
    `;
    const output = compile(code);

    assert.ok(
      output.includes('_$createComponent'),
      `Expected _$createComponent in output, got:\n${output}`
    );
    assert.ok(
      !output.includes('h(Show'),
      `Expected no h(Show) in output, got:\n${output}`
    );
  });

  it('imports _$createComponent from render module', () => {
    const code = `
      function App() {
        return <MyComponent />;
      }
    `;
    const output = compile(code);

    assert.ok(
      output.includes('_$createComponent'),
      `Expected _$createComponent import in output, got:\n${output}`
    );
    assert.ok(
      output.includes('what-framework/render'),
      `Expected what-framework/render import in output, got:\n${output}`
    );
  });

  it('does NOT import h from what-framework for regular components', () => {
    const code = `
      function App() {
        return <MyComponent foo="bar"><Child /></MyComponent>;
      }
    `;
    const output = compile(code);

    // The output should not have an h import from what-framework for component calls
    // h may be imported for fallback HTML element cases, but not for component instantiation
    assert.ok(
      !output.match(/import\s*\{[^}]*\bh\b[^}]*\}\s*from\s*['"]what-framework['"]/),
      `Expected no h import from what-framework for component-only code, got:\n${output}`
    );
  });

  it('still compiles HTML elements to templates (not _$createComponent)', () => {
    const code = `
      function App() {
        return <div class="hello"><span>world</span></div>;
      }
    `;
    const output = compile(code);

    // Static HTML elements should use template(), not _$createComponent
    assert.ok(
      !output.includes('_$createComponent'),
      `Expected no _$createComponent for plain HTML elements, got:\n${output}`
    );
    assert.ok(
      output.includes('_$template') || output.includes('template'),
      `Expected template usage for plain HTML elements, got:\n${output}`
    );
  });

  it('handles component with spread props', () => {
    const code = `
      function App() {
        const props = { a: 1, b: 2 };
        return <MyComponent {...props} extra="yes" />;
      }
    `;
    const output = compile(code);

    assert.ok(
      output.includes('_$createComponent'),
      `Expected _$createComponent in output, got:\n${output}`
    );
    assert.ok(
      !output.includes('h(MyComponent'),
      `Expected no h(MyComponent) in output, got:\n${output}`
    );
  });
});
