/**
 * Rule: what/no-set-in-computed
 *
 * Error when .set() is called inside a computed() callback.
 * Writing to signals inside computed() can cause infinite loops because
 * the write triggers re-evaluation of the computed which writes again.
 *
 * Bad:
 *   const doubled = computed(() => {
 *     otherSignal.set(count() * 2);  // writes inside computed
 *     return count() * 2;
 *   });
 *
 * Good:
 *   const doubled = computed(() => count() * 2);
 *   effect(() => otherSignal.set(doubled()));
 */

import { createSignalTracker } from '../utils/signal-tracking.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow signal writes (.set()) inside computed() callbacks',
      recommended: true,
    },
    messages: {
      setInComputed:
        'Signal.set() called inside a computed() callback. ' +
        'This may cause infinite loops. Move signal writes to effect() instead.',
      signalWriteInComputed:
        'Signal write to "{{name}}" inside a computed() callback. ' +
        'This may cause infinite loops. Move signal writes to effect() instead.',
    },
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();
    // Stack of computed scopes — tracks whether we're inside a computed callback
    let computedDepth = 0;

    function isInsideComputed() {
      return computedDepth > 0;
    }

    return {
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },

      CallExpression(node) {
        // Track entering computed() or useComputed() callbacks
        if (
          node.callee.type === 'Identifier' &&
          (node.callee.name === 'computed' || node.callee.name === 'useComputed') &&
          node.arguments.length > 0 &&
          (node.arguments[0].type === 'ArrowFunctionExpression' ||
           node.arguments[0].type === 'FunctionExpression')
        ) {
          // We'll check the body in the function visitor below
        }

        // Check for .set() calls inside computed
        if (isInsideComputed()) {
          // signal.set(value)
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'set'
          ) {
            const objName = node.callee.object.type === 'Identifier'
              ? node.callee.object.name
              : null;

            if (objName && tracker.isSignal(objName)) {
              context.report({
                node,
                messageId: 'signalWriteInComputed',
                data: { name: objName },
              });
            } else {
              // Could still be a signal — report generic warning
              context.report({
                node,
                messageId: 'setInComputed',
              });
            }
          }

          // signal(newValue) — direct call with argument (write via unified getter/setter)
          if (
            node.callee.type === 'Identifier' &&
            tracker.isSignal(node.callee.name) &&
            node.arguments.length > 0
          ) {
            context.report({
              node,
              messageId: 'signalWriteInComputed',
              data: { name: node.callee.name },
            });
          }
        }
      },

      // Track computed callback scope entry/exit
      'CallExpression > ArrowFunctionExpression'(node) {
        const parent = node.parent;
        if (
          parent.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' &&
          (parent.callee.name === 'computed' || parent.callee.name === 'useComputed') &&
          parent.arguments[0] === node
        ) {
          computedDepth++;
        }
      },
      'CallExpression > ArrowFunctionExpression:exit'(node) {
        const parent = node.parent;
        if (
          parent.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' &&
          (parent.callee.name === 'computed' || parent.callee.name === 'useComputed') &&
          parent.arguments[0] === node
        ) {
          computedDepth--;
        }
      },
      'CallExpression > FunctionExpression'(node) {
        const parent = node.parent;
        if (
          parent.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' &&
          (parent.callee.name === 'computed' || parent.callee.name === 'useComputed') &&
          parent.arguments[0] === node
        ) {
          computedDepth++;
        }
      },
      'CallExpression > FunctionExpression:exit'(node) {
        const parent = node.parent;
        if (
          parent.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' &&
          (parent.callee.name === 'computed' || parent.callee.name === 'useComputed') &&
          parent.arguments[0] === node
        ) {
          computedDepth--;
        }
      },
    };
  },
};
