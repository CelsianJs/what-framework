/**
 * Rule: what/signal-call-in-jsx
 *
 * Warn when a signal is used in JSX without calling it.
 * Signals are functions — using them without () in JSX renders "[Function]"
 * instead of the signal's value.
 *
 * This rule specifically targets JSX expression containers, complementing
 * the broader no-uncalled-signals rule with JSX-specific messaging.
 *
 * Bad:  <span>{count}</span>          — renders "[Function]"
 * Bad:  <p>{isLoading && <Spinner />}</p> — always truthy
 *
 * Good: <span>{count()}</span>
 * Good: <p>{isLoading() && <Spinner />}</p>
 */

import { createSignalTracker, SIGNAL_METHODS } from '../utils/signal-tracking.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require calling signals in JSX expressions — catch missing ()',
      recommended: true,
    },
    messages: {
      signalNotCalledInJsx:
        '"{{name}}" is a signal used in JSX without calling it. ' +
        'Use {{{name}}()} to read the value, or the JSX will render "[Function]".',
      signalNotCalledInJsxLogical:
        '"{{name}}" is a signal used in a JSX conditional without calling it. ' +
        'Signals are always truthy — use {{{name}}() && ...} instead.',
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

        // Check if inside a logical expression (&&, ||) — likely a conditional render
        if (
          parent.type === 'LogicalExpression' &&
          parent.left === node
        ) {
          context.report({
            node,
            messageId: 'signalNotCalledInJsxLogical',
            data: { name: node.name },
          });
          return;
        }

        context.report({
          node,
          messageId: 'signalNotCalledInJsx',
          data: { name: node.name },
        });
      },
    };
  },
};
