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

function compileAst(source) {
  const result = transformSync(source, {
    filename: 'test.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    ast: true,
    code: true,
    compact: false,
  });

  return result?.ast;
}

function collectInsertArgCounts(ast) {
  const counts = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (
      node.type === 'CallExpression'
      && node.callee
      && node.callee.type === 'Identifier'
      && node.callee.name === '_$insert'
    ) {
      counts.push(node.arguments.length);
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      walk(node[key]);
    }
  }

  walk(ast);
  return counts;
}

describe('what babel plugin fine-grained output', () => {
  it('uses childNodes indexing so text nodes do not break dynamic element access', () => {
    const code = compile(`
      function App() {
        const count = signal(0);
        return <label>Step: <input value={count()} /></label>;
      }
    `);

    assert.match(code, /childNodes\[/);
    assert.doesNotMatch(code, /\.children\[/);
  });

  it('uses setProp helper for dynamic prop writes (checked/value/innerHTML)', () => {
    const code = compile(`
      function App() {
        const checked = signal(false);
        const html = signal('<b>x</b>');
        return (
          <div>
            <input checked={checked()} value={checked() ? 'y' : 'n'} />
            <section innerHTML={html()} />
            <section dangerouslySetInnerHTML={{ __html: html() }} />
          </div>
        );
      }
    `);

    assert.match(code, /_\$setProp\(/);
    assert.doesNotMatch(code, /setAttribute\("checked"/);
    assert.doesNotMatch(code, /setAttribute\("innerHTML"/);
    assert.doesNotMatch(code, /setAttribute\("dangerouslySetInnerHTML"/);
  });

  it('wraps dangerouslySetInnerHTML with reactive object values in effect', () => {
    const code = compile(`
      function App() {
        const html = signal('<b>x</b>');
        return <div dangerouslySetInnerHTML={{ __html: html() }} />;
      }
    `);

    assert.match(code, /_\$effect\(/);
    assert.match(code, /dangerouslySetInnerHTML/);
  });

  it('serializes non-void self-closing JSX tags with explicit closing tags', () => {
    const code = compile(`
      function App() {
        return <main><section /><input /></main>;
      }
    `);

    assert.doesNotMatch(code, /<section\/>/);
    assert.match(code, /<section><\/section>/);
    assert.match(code, /<input>/);
  });

  it('injects expression markers and emits insert(parent, value, marker) calls', () => {
    const source = `
      function App() {
        const content = signal('x');
        return <main><p>before</p>{content()}<p>after</p></main>;
      }
    `;

    const code = compile(source);
    assert.match(code, /<!--\$-->/);

    const ast = compileAst(source);
    const insertArgCounts = collectInsertArgCounts(ast);

    assert.ok(insertArgCounts.length > 0, 'expected at least one _$insert call');
    assert.ok(
      insertArgCounts.includes(3),
      `expected an _$insert call with marker arg; got ${insertArgCounts.join(', ')}`
    );
  });
});
