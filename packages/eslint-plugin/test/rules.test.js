/**
 * Tests for eslint-plugin-what rules
 *
 * Uses ESLint's RuleTester with flat config support.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Lightweight test helper that validates rule behavior without requiring ESLint as a dependency.
// ESLint's RuleTester requires eslint as a dep — we keep things minimal by testing AST matching logic directly.

function createFakeContext(reports = []) {
  return {
    options: [],
    sourceCode: {
      getText(node) {
        return node._text || '';
      },
    },
    getSourceCode() {
      return this.sourceCode;
    },
    report(descriptor) {
      reports.push(descriptor);
    },
  };
}

// Quick AST node factories
function id(name) {
  return { type: 'Identifier', name };
}

function callExpr(calleeName, args = []) {
  return {
    type: 'CallExpression',
    callee: id(calleeName),
    arguments: args,
    parent: { type: 'ExpressionStatement', parent: { type: 'Program' } },
  };
}

function varDecl(name, init) {
  return {
    type: 'VariableDeclarator',
    id: id(name),
    init,
  };
}

// --- Tests ---

describe('eslint-plugin-what', () => {
  describe('no-signal-write-in-render', async () => {
    const { Linter } = await import('eslint');
    const { default: plugin } = await import('../src/index.js');
    const lint = (code) => new Linter().verify(code, [{
      files: ['**/*.jsx'],
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { what: plugin },
      rules: { 'what/no-signal-write-in-render': 'warn' },
    }], { filename: 'component.jsx' });

    it('warns on signal writes in render body', () => {
      const reports = lint('function App() { const count = signal(0); count(5); return <p>{count()}</p>; }');
      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'signalWriteInRender');
    });

    it('allows signal reads (0 args)', () => {
      assert.strictEqual(lint('function App() { const count = signal(0); return <p>{count()}</p>; }').length, 0);
    });
  });

  describe('no-camelcase-events', async () => {
    const { default: rule } = await import('../src/rules/no-camelcase-events.js');

    it('warns on camelCase event handlers', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.JSXAttribute({
        type: 'JSXAttribute',
        name: { type: 'JSXIdentifier', name: 'onClick' },
      });

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].data.fix, 'onclick');
    });

    it('ignores lowercase events', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.JSXAttribute({
        type: 'JSXAttribute',
        name: { type: 'JSXIdentifier', name: 'onclick' },
      });

      assert.strictEqual(reports.length, 0);
    });

    it('skips when hasCompiler is true', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      ctx.options = [{ hasCompiler: true }];
      const visitors = rule.create(ctx);

      // Should return empty object
      assert.deepStrictEqual(visitors, {});
    });
  });

  describe('prefer-set', async () => {
    const { default: rule } = await import('../src/rules/prefer-set.js');

    it('suggests .set() for signal writes', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      const arg = { type: 'Literal', value: 5, _text: '5' };
      visitors.CallExpression({
        type: 'CallExpression',
        callee: id('count'),
        arguments: [arg],
      });

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'preferSet');
    });

    it('ignores signal reads (0 args)', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      visitors.CallExpression({
        type: 'CallExpression',
        callee: id('count'),
        arguments: [],
      });

      assert.strictEqual(reports.length, 0);
    });
  });

  describe('reactive-jsx-children', async () => {
    const { default: rule } = await import('../src/rules/reactive-jsx-children.js');

    it('warns on bare signal reads in JSX children', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      visitors.JSXExpressionContainer({
        type: 'JSXExpressionContainer',
        expression: {
          type: 'CallExpression',
          callee: id('count'),
          arguments: [],
        },
        parent: { type: 'JSXElement' },
      });

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'bareSignalRead');
    });

    it('allows wrapped signal reads', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      visitors.JSXExpressionContainer({
        type: 'JSXExpressionContainer',
        expression: {
          type: 'ArrowFunctionExpression',
          body: callExpr('count', []),
        },
        parent: { type: 'JSXElement' },
      });

      assert.strictEqual(reports.length, 0);
    });

    it('skips when hasCompiler is true', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      ctx.options = [{ hasCompiler: true }];
      const visitors = rule.create(ctx);

      assert.deepStrictEqual(visitors, {});
    });
  });

  describe('no-uncalled-signals', async () => {
    const { default: rule } = await import('../src/rules/no-uncalled-signals.js');

    it('allows a signal that is the whole JSX child: {count} is a live binding', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      const countId = id('count');
      countId.parent = { type: 'JSXExpressionContainer', expression: countId, parent: { type: 'JSXElement' } };
      visitors.Identifier(countId);

      assert.strictEqual(reports.length, 0);
    });

    it('warns on a signal coerced in a template literal', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      const countId = id('count');
      countId.parent = { type: 'TemplateLiteral', expressions: [countId] };
      visitors.Identifier(countId);

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'uncalledSignal');
      assert.strictEqual(reports[0].data.name, 'count');
    });

    it('allows signal calls (count())', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      // count() — being called, should NOT warn
      const countId = id('count');
      const call = { type: 'CallExpression', callee: countId, arguments: [] };
      countId.parent = call;
      visitors.Identifier(countId);

      assert.strictEqual(reports.length, 0);
    });

    it('allows signal.set() access', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      // count.set — accessing method, should NOT warn
      const countId = id('count');
      countId.parent = {
        type: 'MemberExpression',
        object: countId,
        property: id('set'),
        computed: false,
      };
      visitors.Identifier(countId);

      assert.strictEqual(reports.length, 0);
    });

    it('allows passing signal as argument', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      // someFunc(count) — passing signal reference, should NOT warn
      const countId = id('count');
      const call = { type: 'CallExpression', callee: id('someFunc'), arguments: [countId] };
      countId.parent = call;
      visitors.Identifier(countId);

      assert.strictEqual(reports.length, 0);
    });

    it('warns on bare signal in logical expression', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('isLoading', callExpr('useSignal', [{ type: 'Literal', value: false }])));

      // isLoading && <Spinner /> — should warn (always truthy)
      const loadingId = id('isLoading');
      loadingId.parent = { type: 'LogicalExpression', operator: '&&', left: loadingId };
      visitors.Identifier(loadingId);

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].data.name, 'isLoading');
    });

    it('warns on SWR object getter used without call', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      // const swr = useSWR(...)
      visitors.VariableDeclarator({
        type: 'VariableDeclarator',
        id: id('swr'),
        init: callExpr('useSWR', [{ type: 'Literal', value: 'key' }]),
      });

      // swr.data without () in a condition — should warn (always truthy)
      const swrId = id('swr');
      const dataId = id('data');
      const memberExpr = {
        type: 'MemberExpression',
        object: swrId,
        property: dataId,
        computed: false,
      };
      memberExpr.parent = { type: 'LogicalExpression', operator: '&&', left: memberExpr };
      swrId.parent = memberExpr;
      dataId.parent = memberExpr;

      visitors.MemberExpression(memberExpr);

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'uncalledSWRField');
      assert.strictEqual(reports[0].data.obj, 'swr');
      assert.strictEqual(reports[0].data.prop, 'data');
    });

    it('allows SWR getter called: swr.data()', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator({
        type: 'VariableDeclarator',
        id: id('swr'),
        init: callExpr('useSWR', [{ type: 'Literal', value: 'key' }]),
      });

      // swr.data() — being called, should NOT warn
      const swrId = id('swr');
      const dataId = id('data');
      const memberExpr = {
        type: 'MemberExpression',
        object: swrId,
        property: dataId,
        computed: false,
      };
      memberExpr.parent = { type: 'CallExpression', callee: memberExpr, arguments: [] };
      swrId.parent = memberExpr;
      dataId.parent = memberExpr;

      visitors.MemberExpression(memberExpr);

      assert.strictEqual(reports.length, 0);
    });

    it('warns on destructured SWR getter used without call', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      // const { data, isLoading } = useSWR(...)
      visitors.VariableDeclarator({
        type: 'VariableDeclarator',
        id: {
          type: 'ObjectPattern',
          properties: [
            { type: 'Property', key: id('data'), value: id('data'), computed: false },
            { type: 'Property', key: id('isLoading'), value: id('isLoading'), computed: false },
          ],
        },
        init: callExpr('useSWR', [{ type: 'Literal', value: 'key' }]),
      });

      // data used without () — should warn
      const dataId = id('data');
      dataId.parent = { type: 'JSXExpressionContainer', parent: { type: 'JSXElement' } };
      visitors.Identifier(dataId);

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'uncalledDestructuredGetter');
    });

    it('tracks useComputed and computed signals', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('doubled', callExpr('useComputed', [])));

      const doubledId = id('doubled');
      doubledId.parent = { type: 'LogicalExpression', operator: '&&', left: doubledId };
      visitors.Identifier(doubledId);

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].data.name, 'doubled');
    });

    it('skips declaration positions', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      // count in: const count = useSignal(0) — declaration, should NOT warn
      const countId = id('count');
      countId.parent = { type: 'VariableDeclarator', id: countId, init: {} };
      visitors.Identifier(countId);

      assert.strictEqual(reports.length, 0);
    });
  });
});

describe('no-uncalled-signals through the real Linter', async () => {
  const { Linter } = await import('eslint');
  const { default: plugin } = await import('../src/index.js');
  const lint = (code) => new Linter()
    .verify(code, [plugin.configs.compiler], { filename: 'app.jsx' })
    .filter((m) => m.ruleId === 'what/no-uncalled-signals');

  it('does not report a name where it is declared, destructured or exported', () => {
    const messages = lint([
      "import { useState, useReducer, signal, mount } from 'what-framework';",
      'const items = signal([]);',
      'function App() {',
      '  const [count, setCount] = useState(0);',
      '  const [state, dispatch] = useReducer((s) => s, { n: 0 });',
      '  return <button onClick={() => setCount((c) => c + 1)} title={count}>{count}{() => state().n}</button>;',
      '}',
      'export { App, items };',
      "mount(<App />, '#app');",
    ].join('\n'));
    assert.deepEqual(messages, []);
  });

  it('reports a hook accessor coerced to a value', () => {
    const messages = lint([
      "import { useState } from 'what-framework';",
      'function App() {',
      '  const [count] = useState(0);',
      '  return <p>{`Count: ${count}`}{count + 1}</p>;',
      '}',
    ].join('\n'));
    assert.deepEqual(messages.map((m) => m.message), [
      '"count" is a signal — call it to read the value: count()',
      '"count" is a signal — call it to read the value: count()',
    ]);
  });
});
