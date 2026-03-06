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
  describe('no-signal-in-effect-deps', async () => {
    const { default: rule } = await import('../src/rules/no-signal-in-effect-deps.js');

    it('warns when signal is used in useEffect deps', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      // Register signal variable
      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      // Call useEffect with signal in deps
      const countId = id('count');
      visitors.CallExpression({
        type: 'CallExpression',
        callee: id('useEffect'),
        arguments: [
          { type: 'ArrowFunctionExpression' },
          {
            type: 'ArrayExpression',
            elements: [countId],
          },
        ],
      });

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'signalInDeps');
      assert.strictEqual(reports[0].data.name, 'count');
    });

    it('allows non-signal variables in deps', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.CallExpression({
        type: 'CallExpression',
        callee: id('useEffect'),
        arguments: [
          { type: 'ArrowFunctionExpression' },
          {
            type: 'ArrayExpression',
            elements: [id('someValue')],
          },
        ],
      });

      assert.strictEqual(reports.length, 0);
    });
  });

  describe('no-signal-write-in-render', async () => {
    const { default: rule } = await import('../src/rules/no-signal-write-in-render.js');

    it('warns on signal writes in render body', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('signal', [{ type: 'Literal', value: 0 }])));

      // Direct write in render: count(5)
      const writeCall = callExpr('count', [{ type: 'Literal', value: 5 }]);
      // Simulate render context (no safe parent)
      writeCall.parent = { type: 'ExpressionStatement', parent: { type: 'BlockStatement', parent: { type: 'FunctionDeclaration', parent: null } } };

      visitors.CallExpression(writeCall);

      assert.strictEqual(reports.length, 1);
      assert.strictEqual(reports[0].messageId, 'signalWriteInRender');
    });

    it('allows signal reads (0 args)', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      visitors.VariableDeclarator(varDecl('count', callExpr('signal', [{ type: 'Literal', value: 0 }])));

      // Read: count()
      const readCall = callExpr('count', []);
      visitors.CallExpression(readCall);

      assert.strictEqual(reports.length, 0);
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

    it('warns on bare signal reference in JSX expression', () => {
      const reports = [];
      const ctx = createFakeContext(reports);
      const visitors = rule.create(ctx);

      // Register signal
      visitors.VariableDeclarator(varDecl('count', callExpr('useSignal', [{ type: 'Literal', value: 0 }])));

      // Bare reference: {count} in JSX
      const countId = id('count');
      countId.parent = { type: 'JSXExpressionContainer', parent: { type: 'JSXElement' } };
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

      // swr.data without () — should warn
      const swrId = id('swr');
      const dataId = id('data');
      const memberExpr = {
        type: 'MemberExpression',
        object: swrId,
        property: dataId,
        computed: false,
        parent: { type: 'JSXExpressionContainer', parent: { type: 'JSXElement' } },
      };
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
