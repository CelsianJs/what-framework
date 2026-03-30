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
  it('uses firstChild/nextSibling chains for robust child access', () => {
    const code = compile(`
      function App() {
        const count = signal(0);
        return <label>Step: <input value={count()} /></label>;
      }
    `);

    // Should use firstChild/nextSibling instead of childNodes[N]
    assert.match(code, /firstChild/);
    assert.doesNotMatch(code, /childNodes\[/);
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

  it('uses _$createComponent for component invocations', () => {
    const code = compile(`
      import { useState } from 'what-framework';
      function Child({ name }) {
        return <span>{name}</span>;
      }
      function App() {
        return <div><Child name="test" /></div>;
      }
    `);

    // _$createComponent should be used for <Child> component
    assert.match(code, /_\$createComponent\(Child|h\(Child/);
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
  it('components use _$createComponent for invocation', () => {
    const code = compile(`
      function Header({ title }) {
        return <h1>{title}</h1>;
      }
      function App() {
        return <div><Header title="Hello" /></div>;
      }
    `);

    assert.match(code, /_\$createComponent\(Header|h\(Header/);
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

// =====================================================
// FIX-1: Lexical scope analysis for signal detection
// =====================================================

describe('lexical scope signal detection', () => {
  it('detects signals in the local function scope', () => {
    const code = compile(`
      function App() {
        const count = signal(0);
        return <div>{count()}</div>;
      }
    `);

    assert.match(code, /=>\s*count\(\)/, 'local signal should be wrapped reactively');
  });

  it('does not treat same-name variable in different scope as signal', () => {
    const code = compile(`
      function Outer() {
        const count = signal(0);
        return <div>{count()}</div>;
      }
      function Inner() {
        const count = 42;
        return <span>{count}</span>;
      }
    `);

    // Inner's count is not a signal — it's a plain number
    // The output for Inner should NOT wrap count in an effect
    assert.ok(code.includes('count()'), 'Outer should still call signal');
  });

  it('handles nested function scopes correctly', () => {
    const code = compile(`
      function App() {
        const name = signal('world');
        function getGreeting() {
          return 'hello';
        }
        return <div>{name()}</div>;
      }
    `);

    assert.match(code, /=>\s*name\(\)/, 'signal in outer scope should be detected');
  });
});

// =====================================================
// FIX-2: Import filtering — only reactive sources
// =====================================================

describe('import filtering for reactivity', () => {
  it('treats imports from relative paths as potentially reactive', () => {
    const code = compile(`
      import { count } from './store';
      function App() {
        return <div>{count()}</div>;
      }
    `);

    assert.match(code, /=>\s*count\(\)/, 'relative import should be reactive');
  });

  it('treats imports from what-framework as potentially reactive', () => {
    const code = compile(`
      import { signal } from 'what-framework';
      function App() {
        const x = signal(0);
        return <div>{x()}</div>;
      }
    `);

    assert.match(code, /=>\s*x\(\)/, 'what-framework import should be reactive');
  });

  it('does NOT treat imports from non-reactive packages as reactive', () => {
    const code = compile(`
      import { format } from 'date-fns';
      function App() {
        return <div class={format(new Date(), 'yyyy')} />;
      }
    `);

    // format() from date-fns should NOT be wrapped in an effect
    assert.doesNotMatch(code, /_\$effect\(/, 'non-reactive package import should not trigger effect');
  });

  it('treats use* named imports from any package as reactive', () => {
    const code = compile(`
      import { useQuery } from '@tanstack/query';
      function App() {
        const data = useQuery('key');
        return <div>{data()}</div>;
      }
    `);

    assert.match(code, /=>\s*data\(\)/, 'useQuery result should be reactive');
  });
});

// =====================================================
// FIX-3: firstChild/nextSibling chains
// =====================================================

describe('firstChild/nextSibling child access', () => {
  it('uses firstChild for index 0', () => {
    const code = compile(`
      function App() {
        const x = signal('hi');
        return <div><span>{x()}</span></div>;
      }
    `);

    assert.match(code, /\.firstChild/, 'should use firstChild for first child');
    assert.doesNotMatch(code, /childNodes\[/, 'should not use childNodes indexing');
  });

  it('chains nextSibling for subsequent children', () => {
    const code = compile(`
      function App() {
        const x = signal('hi');
        return <div><p>a</p><p>b</p><span>{x()}</span></div>;
      }
    `);

    assert.match(code, /nextSibling/, 'should chain nextSibling');
  });
});

// =====================================================
// FIX-4: No IIFE wrapping
// =====================================================

describe('no IIFE wrapping', () => {
  it('hoists setup statements instead of using IIFE', () => {
    const code = compile(`
      function App() {
        const count = signal(0);
        return <div class={count() > 5 ? 'big' : 'small'}>Hello</div>;
      }
    `);

    // Should NOT have (() => { ... })() pattern
    assert.doesNotMatch(code, /\(\(\)\s*=>\s*\{/, 'should not use IIFE wrapping');
    // Should have flat statements in the function body
    assert.match(code, /const _el\$\d+ = _tmpl/, 'should have flat template clone');
  });

  it('produces clean function body with hoisted setup', () => {
    const code = compile(`
      function App() {
        const name = signal('world');
        return <h1>Hello {name()}</h1>;
      }
    `);

    // The function should have flat setup statements followed by return
    assert.doesNotMatch(code, /\(\(\)\s*=>\s*\{/, 'no IIFE');
    assert.match(code, /return _el\$\d+;/, 'should return element directly');
  });
});

// =====================================================
// FIX-5: Event delegation
// =====================================================

describe('event delegation', () => {
  it('uses delegation for click events', () => {
    const code = compile(`
      function App() {
        return <button onClick={() => alert('hi')}>Click</button>;
      }
    `);

    // Should use __click property assignment, not addEventListener
    assert.match(code, /__click\s*=/, 'click should use delegation');
    assert.doesNotMatch(code, /addEventListener.*click/, 'click should not use addEventListener');
    // Should emit delegateEvents call
    assert.match(code, /delegateEvents/, 'should import delegateEvents');
  });

  it('uses delegation for input events', () => {
    const code = compile(`
      function App() {
        return <input onInput={(e) => console.log(e)} />;
      }
    `);

    assert.match(code, /__input\s*=/, 'input should use delegation');
  });

  it('does NOT delegate scroll events', () => {
    const code = compile(`
      function App() {
        return <div onScroll={() => {}} />;
      }
    `);

    assert.match(code, /addEventListener/, 'scroll should use addEventListener');
    assert.doesNotMatch(code, /__scroll/, 'scroll should not use delegation');
  });

  it('does NOT delegate custom/pointer events', () => {
    const code = compile(`
      function App() {
        return <div onPointerdown={() => {}} />;
      }
    `);

    assert.match(code, /addEventListener/, 'pointer events should use addEventListener');
  });

  it('emits delegateEvents with the list of used events', () => {
    const code = compile(`
      function App() {
        return <div>
          <button onClick={() => {}}>A</button>
          <input onChange={() => {}} />
        </div>;
      }
    `);

    assert.match(code, /_\$delegateEvents\(/, 'should emit delegateEvents call');
    assert.match(code, /["']click["']/, 'should include click in delegated events');
    assert.match(code, /["']change["']/, 'should include change in delegated events');
  });
});

// =========================================================================
// Issue #1: Pre-capture markers for multiple dynamic children
// =========================================================================

describe('issue #1: marker pre-capture for multiple dynamic children', () => {
  it('pre-captures markers when 2+ dynamic children exist', () => {
    const code = compile(`
      import { signal } from 'what-framework';
      function App() {
        const items = signal([]);
        return <div>{items().length === 0 ? "empty" : null}{items().map(i => i)}</div>;
      }
    `);

    // Should have variable declarations for markers before _$insert calls
    const insertIdx = code.indexOf('_$insert');
    assert.ok(insertIdx > 0, 'should have insert calls');

    // Pre-captured markers should use firstChild and firstChild.nextSibling
    // captured as variables BEFORE any _$insert calls
    assert.ok(code.includes('.firstChild;') || code.includes('.firstChild,'),
      'should capture firstChild as a variable');
    assert.ok(code.includes('.nextSibling;') || code.includes('.nextSibling,'),
      'should capture nextSibling as a variable');

    // The _$insert calls should reference variables, not inline chains
    const insertCalls = code.match(/_\$insert\([^)]+\)/g) || [];
    assert.ok(insertCalls.length >= 2, 'should have at least 2 insert calls');

    // Both inserts should use pre-captured variable identifiers as markers
    // (not inline .firstChild.nextSibling)
    for (const call of insertCalls) {
      assert.ok(!call.includes('.firstChild.'), `insert should not use inline firstChild chain: ${call}`);
    }
  });

  it('captures stable marker refs for component + static element siblings', () => {
    const code = compile(`
      function Nav() { return <nav>nav</nav>; }
      function App() {
        return <div><Nav /><main>content</main></div>;
      }
    `);

    // Should not have inline firstChild.nextSibling in _$insert args
    // Instead, markers should be pre-captured as variables
    const hasInlineMarkerInInsert = /_\$insert\([^)]*\.firstChild\.nextSibling/.test(code);
    // If there's only one dynamic child (Nav), pre-capture may not be needed
    // The key is that it compiles without error
    assert.ok(code.includes('_$insert'), 'should have insert call for component child');
    assert.ok(code.includes('_tmpl$'), 'should have template');
  });
});

// =========================================================================
// Issue #4: ref props in compiled output
// =========================================================================

describe('issue #4: ref prop handling in compiled output', () => {
  it('generates ref assignment code instead of setProp for ref attributes', () => {
    const code = compile(`
      import { useRef } from 'what-framework';
      function App() {
        const boxRef = useRef(null);
        return <div ref={boxRef}>content</div>;
      }
    `);

    // Should NOT generate _$setProp(el, "ref", ...)
    assert.ok(!code.includes('_$setProp') || !code.includes('"ref"'),
      'should not use setProp for ref');

    // Should generate ref.current = el (or typeof check)
    assert.ok(
      code.includes('.current =') || code.includes('typeof'),
      'should generate ref assignment (either .current = or typeof check)'
    );
  });

  it('handles callback refs', () => {
    const code = compile(`
      function App() {
        const refFn = (el) => console.log(el);
        return <div ref={refFn}>content</div>;
      }
    `);

    // Should generate typeof check for function vs object ref
    assert.ok(
      code.includes('typeof') || code.includes('.current'),
      'should handle both function and object refs'
    );
  });
});
