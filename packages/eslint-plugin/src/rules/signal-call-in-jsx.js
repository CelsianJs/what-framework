/**
 * Rule: what/signal-call-in-jsx
 *
 * Warn when a signal is used as a condition in JSX without being called. A
 * signal function is always truthy, so {isLoading && <Spinner />} always
 * renders the spinner and {open ? <Menu /> : null} always renders the menu.
 *
 * A signal that is the whole JSX child or attribute value ({count},
 * value={count}) is a live binding, with or without the compiler, and is not
 * reported.
 *
 * Bad:  <p>{isLoading && <Spinner />}</p>
 * Good: <p>{isLoading() && <Spinner />}</p>
 */

import { createSignalTracker, SIGNAL_METHODS } from '../utils/signal-tracking.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require calling a signal used as a condition in JSX — a signal function is always truthy',
      recommended: true,
      code: 'ERR_MISSING_SIGNAL_READ',
    },
    messages: {
      signalNotCalledInJsxLogical:
        '"{{name}}" is a signal used in a JSX conditional without calling it. ' +
        'A signal function is always truthy — call it: {{name}}().',
    },
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();

    function isInsideJSXExpression(node) {
      let current = node.parent;
      while (current) {
        if (current.type === 'JSXExpressionContainer') return true;
        // Stop at function boundaries
        if (
          current.type === 'ArrowFunctionExpression' ||
          current.type === 'FunctionExpression' ||
          current.type === 'FunctionDeclaration'
        ) {
          return false;
        }
        current = current.parent;
      }
      return false;
    }

    function isBeingCalled(node) {
      return node.parent?.type === 'CallExpression' && node.parent.callee === node;
    }

    function isMethodAccess(node) {
      return (
        node.parent?.type === 'MemberExpression' &&
        node.parent.object === node &&
        node.parent.property?.type === 'Identifier' &&
        SIGNAL_METHODS.has(node.parent.property.name)
      );
    }

    function isJSXAttributeValue(node) {
      const exprContainer = node.parent;
      if (exprContainer?.type === 'JSXExpressionContainer') {
        return exprContainer.parent?.type === 'JSXAttribute';
      }
      return false;
    }

    return {
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },

      Identifier(node) {
        const parent = node.parent;
        if (!parent) return;

        // Skip declaration positions
        if (parent.type === 'VariableDeclarator' && parent.id === node) return;
        if (parent.type === 'FunctionDeclaration' && parent.id === node) return;
        if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
        if (parent.type === 'ImportSpecifier') return;
        if (parent.type === 'ImportDefaultSpecifier') return;
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;

        // Skip if being called — correct usage
        if (isBeingCalled(node)) return;
        // Skip method access
        if (isMethodAccess(node)) return;
        // Skip JSX attribute values (event handlers)
        if (isJSXAttributeValue(node)) return;

        // Only check signals inside JSX expressions
        if (!tracker.isSignalLike(node.name)) return;
        if (!isInsideJSXExpression(node)) return;

        // A condition: {isLoading && …}, {open ? … : …}
        const isCondition =
          (parent.type === 'LogicalExpression' && parent.left === node) ||
          (parent.type === 'ConditionalExpression' && parent.test === node);
        if (!isCondition) return;

        context.report({
          node,
          messageId: 'signalNotCalledInJsxLogical',
          data: { name: node.name },
        });
      },
    };
  },
};
