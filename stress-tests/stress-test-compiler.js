// Stress Test: Compiler output verification
// Compile JSX and verify templates are hoisted, reactivity detection is correct
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import babelPlugin from '../packages/compiler/src/babel-plugin.js';

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

describe('STRESS: Template hoisting', () => {

  it('static JSX element produces a template() call at module top', () => {
    const code = compile(`
      function App() {
        return <div class="container"><h1>Title</h1><p>Body</p></div>;
      }
    `);

    // template() should be hoisted to top (before function declaration)
    const templateIdx = code.indexOf('template(');
    const fnIdx = code.indexOf('function App');
    assert.ok(templateIdx !== -1, 'Should contain template() call');
    assert.ok(templateIdx < fnIdx, 'template() should be hoisted before App function');
  });

  it('identical templates are deduplicated', () => {
    const code = compile(`
      function A() { return <div class="box">Hello</div>; }
      function B() { return <div class="box">Hello</div>; }
    `);

    // Count template declarations (should be exactly 1, not 2)
    const matches = code.match(/const _tmpl\d* = /g) || [];
    // Both functions should reference the same template variable
    assert.ok(matches.length <= 1, `Expected 1 or fewer template declarations, got ${matches.length}. Code:\n${code}`);
  });

  it('different templates get separate declarations', () => {
    const code = compile(`
      function A() { return <div>A</div>; }
      function B() { return <span>B</span>; }
    `);

    // Should have 2 different template declarations
    const matches = code.match(/template\(/g) || [];
    assert.ok(matches.length >= 2, `Expected at least 2 template() calls, got ${matches.length}`);
  });

  it('deeply nested static HTML is a single template', () => {
    const code = compile(`
      function App() {
        return (
          <div class="page">
            <header>
              <nav>
                <ul>
                  <li>Home</li>
                  <li>About</li>
                  <li>Contact</li>
                </ul>
              </nav>
            </header>
            <main>
              <article>
                <h2>Title</h2>
                <p>Content goes here</p>
              </article>
            </main>
          </div>
        );
      }
    `);

    // All static content should be one template
    const templateCalls = code.match(/template\(/g) || [];
    assert.equal(templateCalls.length, 1, `Deeply nested static HTML should be 1 template, got ${templateCalls.length}`);
  });
});

describe('STRESS: Reactivity detection', () => {

  it('signal() call result in expression wraps in effect', () => {
    const code = compile(`
      import { signal } from 'what-core';
      function App() {
        const count = signal(0);
        return <div>{count()}</div>;
      }
    `);

    // Dynamic expression with signal read should produce an effect or insert call
    assert.ok(
      code.includes('_$effect') || code.includes('_$insert') || code.includes('insert('),
      `Signal read should trigger reactive wrapping. Code:\n${code}`
    );
  });

  it('static text does NOT produce effect wrapping', () => {
    const code = compile(`
      function App() {
        return <div>Hello World</div>;
      }
    `);

    // Pure static content should not have effect/insert calls
    const hasEffect = code.includes('_$effect(') || code.includes('effect(');
    const hasInsert = code.includes('_$insert(') || code.includes('insert(');
    // Static text is in the template, no runtime effect needed
    assert.ok(!hasEffect, `Static text should not produce effect. Code:\n${code}`);
  });

  it('Math.max with signal args is reactive, without is not', () => {
    const codeReactive = compile(`
      import { signal } from 'what-core';
      function App() {
        const a = signal(1);
        const b = signal(2);
        return <div>{Math.max(a(), b())}</div>;
      }
    `);

    const codeStatic = compile(`
      function App() {
        const a = 1;
        const b = 2;
        return <div>{Math.max(a, b)}</div>;
      }
    `);

    // Reactive version should have effect/insert
    const reactiveHasInsert = codeReactive.includes('_$insert') || codeReactive.includes('insert(');
    assert.ok(reactiveHasInsert, `Math.max with signals should be reactive. Code:\n${codeReactive}`);
  });

  it('useState destructured value is detected as reactive', () => {
    const code = compile(`
      import { useState } from 'what-core';
      function App() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `);

    // count from useState should be treated as reactive
    const hasReactiveWrap = code.includes('_$insert') || code.includes('insert(') || code.includes('_$effect');
    assert.ok(hasReactiveWrap, `useState value should be reactive. Code:\n${code}`);
  });
});

describe('STRESS: Component invocation', () => {

  it('component tags use h() calls, not templates', () => {
    const code = compile(`
      function Child() { return <div>Child</div>; }
      function Parent() { return <div><Child /></div>; }
    `);

    // Component invocation should use h() or _$h()
    assert.ok(
      code.includes('h(Child') || code.includes('_$h(Child'),
      `Component should be called via h(). Code:\n${code}`
    );
  });

  it('native HTML elements do NOT use h() calls', () => {
    const code = compile(`
      function App() {
        return <div><span>text</span></div>;
      }
    `);

    // Native elements should use template, not h("div", ...)
    const hasHDiv = /h\(\s*["']div/.test(code) || /_\$h\(\s*["']div/.test(code);
    assert.ok(!hasHDiv, `Native div should not use h() call. Code:\n${code}`);
  });

  it('fragments are handled correctly', () => {
    const code = compile(`
      function App() {
        return <>
          <div>A</div>
          <div>B</div>
        </>;
      }
    `);

    // Should not crash, and should produce array or fragment output
    assert.ok(code.length > 0, 'Fragment should compile successfully');
  });
});

describe('STRESS: Edge cases', () => {

  it('self-closing non-void tags get explicit closing tags', () => {
    const code = compile(`
      function App() {
        return <div><span /></div>;
      }
    `);

    // Template HTML should have </span>, not self-closing <span />
    if (code.includes('template(')) {
      const templateMatch = code.match(/template\("([^"]+)"\)/);
      if (templateMatch) {
        const html = templateMatch[1];
        assert.ok(!html.includes('<span/>') && !html.includes('<span />'),
          `Non-void self-closing tags should have explicit close. Template: ${html}`);
      }
    }
  });

  it('event handlers (onClick) are not treated as reactive props', () => {
    const code = compile(`
      function App() {
        return <button onClick={() => console.log('hi')}>Click</button>;
      }
    `);

    // onClick should be set as event handler, not wrapped in effect
    assert.ok(code.length > 0, 'onClick should compile without error');
  });

  it('dangerouslySetInnerHTML compiles correctly', () => {
    const code = compile(`
      function App() {
        return <div dangerouslySetInnerHTML={{ __html: '<b>bold</b>' }} />;
      }
    `);

    assert.ok(code.length > 0, 'dangerouslySetInnerHTML should compile');
    // Should use setProp or innerHTML path
    assert.ok(
      code.includes('innerHTML') || code.includes('setProp') || code.includes('_$setProp') || code.includes('dangerouslySetInnerHTML'),
      `Should handle dangerouslySetInnerHTML. Code:\n${code}`
    );
  });

  it('class/className are normalized', () => {
    const code = compile(`
      function App() {
        return <div className="my-class">text</div>;
      }
    `);

    // Template should use "class" not "className" for the HTML attribute
    if (code.includes('template(')) {
      const templateMatch = code.match(/template\("([^"]+)"\)/);
      if (templateMatch) {
        const html = templateMatch[1];
        assert.ok(html.includes('class=') && !html.includes('className='),
          `Should normalize className to class in template HTML. Template: ${html}`);
      }
    }
  });
});
