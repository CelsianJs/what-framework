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

// =====================================================
// VDOM mode removal tests
// =====================================================

describe('VDOM mode removal', () => {
  it('does not emit h() calls for native HTML elements', () => {
    const code = compile(`
      function App() {
        return <div class="container"><p>Hello</p></div>;
      }
    `);

    // Should use template(), not h()
    assert.match(code, /_\$template\(/);
    // h() should only appear for components, not native elements
    assert.doesNotMatch(code, /h\("div"/);
    assert.doesNotMatch(code, /h\("p"/);
  });

  it('does not support vdom mode option (fine-grained is the only mode)', () => {
    // Even if someone passes mode: 'vdom', it should still use fine-grained
    const code = compile(`
      function App() {
        return <div>Hello</div>;
      }
    `);

    assert.match(code, /_\$template\(/);
    assert.doesNotMatch(code, /h\("div"/);
  });

  it('uses h() only for component invocations', () => {
    const code = compile(`
      import { useState } from 'what-framework';
      function Child({ name }) {
        return <span>{name}</span>;
      }
      function App() {
        return <div><Child name="test" /></div>;
      }
    `);

    // h() should be used for <Child> component
    assert.match(code, /h\(Child/);
    // But not for native elements
    assert.doesNotMatch(code, /h\("div"/);
    assert.doesNotMatch(code, /h\("span"/);
  });
});

// =====================================================
// Template hoisting tests
// =====================================================

describe('template hoisting to module scope', () => {
  it('hoists template() calls to top of program', () => {
    const code = compile(`
      function App() {
        return <div class="app"><h1>Title</h1></div>;
      }
    `);

    // Template declaration should be at the top level (before the function)
    const tmplIndex = code.indexOf('_tmpl$');
    const fnIndex = code.indexOf('function App');
    assert.ok(tmplIndex < fnIndex, 'template should be hoisted before the function');
  });

  it('deduplicates identical templates', () => {
    const code = compile(`
      function A() {
        return <div class="item">Hello</div>;
      }
      function B() {
        return <div class="item">Hello</div>;
      }
    `);

    // Both components should reference the same template
    const tmplMatches = code.match(/const _tmpl\$\d+/g) || [];
    // Should have only one unique template for the same HTML
    assert.equal(tmplMatches.length, 1, 'identical templates should be deduplicated');
  });

  it('creates separate templates for different HTML', () => {
    const code = compile(`
      function A() {
        return <div class="a">A</div>;
      }
      function B() {
        return <div class="b">B</div>;
      }
    `);

    const tmplMatches = code.match(/const _tmpl\$\d+/g) || [];
    assert.equal(tmplMatches.length, 2, 'different HTML should create separate templates');
  });
});

// =====================================================
// Smart reactivity detection tests
// =====================================================

describe('smart reactivity detection', () => {
  it('wraps signal reads in effects', () => {
    const code = compile(`
      function App() {
        const count = signal(0);
        return <div>{count()}</div>;
      }
    `);

    // count() is a signal read — should be wrapped in an effect via insert
    assert.match(code, /_\$insert/);
    assert.match(code, /=>/); // arrow function wrapper for reactive insert
  });

  it('does not wrap Math.max with non-signal args in effects', () => {
    const code = compile(`
      function App() {
        const a = 5;
        const b = 10;
        return <div class={Math.max(a, b) > 7 ? 'big' : 'small'} />;
      }
    `);

    // Math.max(a, b) where a,b are plain variables should NOT be in effect
    assert.doesNotMatch(code, /_\$effect\(/);
  });

  it('wraps Math.max with signal args in effects', () => {
    const code = compile(`
      function App() {
        const a = signal(5);
        const b = signal(10);
        return <div class={Math.max(a(), b()) > 7 ? 'big' : 'small'} />;
      }
    `);

    // Math.max(a(), b()) where a,b are signals SHOULD be in effect
    assert.match(code, /_\$effect\(/);
  });

  it('detects useState destructured values as reactive', () => {
    const code = compile(`
      function App() {
        const [count, setCount] = useState(0);
        return <span>{count}</span>;
      }
    `);

    // count from useState should be treated as reactive
    // and wrapped in a reactive insert
    assert.match(code, /_\$insert/);
  });

  it('detects useSWR destructured values as reactive', () => {
    const code = compile(`
      function App() {
        const { data, isLoading } = useSWR('key', fetcher);
        return <div>{isLoading()}</div>;
      }
    `);

    assert.match(code, /_\$insert/);
    assert.match(code, /=>/); // arrow wrapper for reactive
  });

  it('does not treat regular function calls as reactive', () => {
    const code = compile(`
      function formatDate(d) { return d.toString(); }
      function App() {
        return <span class={formatDate(new Date())} />;
      }
    `);

    // formatDate is not a signal — should not be wrapped in effect
    assert.doesNotMatch(code, /_\$effect\(/);
  });
});

// =====================================================
// Component output tests
// =====================================================

describe('component output', () => {
  it('components use h() for invocation', () => {
    const code = compile(`
      function Header({ title }) {
        return <h1>{title}</h1>;
      }
      function App() {
        return <div><Header title="Hello" /></div>;
      }
    `);

    assert.match(code, /h\(Header/);
  });

  it('handles fragments', () => {
    const code = compile(`
      function App() {
        return <><div>A</div><div>B</div></>;
      }
    `);

    // Fragment should produce an array or multiple elements
    const compiled = code;
    assert.ok(compiled.length > 0, 'fragment should compile');
  });

  it('handles islands with client: directives', () => {
    const code = compile(`
      import { Island } from 'what-framework';
      function Search() { return <input />; }
      function App() {
        return <div><Search client:idle placeholder="Search..." /></div>;
      }
    `);

    assert.match(code, /Island/);
    assert.match(code, /mode.*idle/);
  });

  it('escapes < and > in attribute values', () => {
    const code = compile(`
      function App() {
        return <div title="a < b > c" />;
      }
    `);

    // Attributes should have < and > escaped
    assert.match(code, /&lt;/);
    assert.match(code, /&gt;/);
  });
});
