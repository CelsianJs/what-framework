/**
 * Rule: what/no-signal-write-in-render
 *
 * Warn when writing to a signal outside of event handlers, effects, or callbacks.
 * Signal writes during render (the component function body) can cause infinite
 * re-render loops because the write triggers effects that re-run the component.
 *
 * Bad:  function App() { count(count() + 1); return ... }
 * Good: function App() { return <button onclick={() => count(c => c + 1)} /> }
 * Good: useEffect(() => { count(0); })
 */

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow signal writes in the render phase (component function body)',
      recommended: true,
    },
    messages: {
      signalWriteInRender:
        'Signal write to "{{name}}" during render may cause infinite loops. ' +
        'Move signal writes into event handlers, effects, or callbacks.',
    },
    schema: [],
  },

  create(context) {
    const signalVars = new Set();

    // Track whether we're inside a "safe" write context
    function isInsideSafeContext(node) {
      let current = node.parent;
      while (current) {
        // Inside event handler (arrow fn or function expression assigned to on* prop or as callback arg)
        if (
          current.type === 'ArrowFunctionExpression' ||
          current.type === 'FunctionExpression'
        ) {
          // Check if it's an event handler prop: onclick={() => ...}
          if (
            current.parent?.type === 'JSXExpressionContainer' &&
            current.parent?.parent?.type === 'JSXAttribute'
          ) {
            return true;
          }
          // Check if it's an event handler prop (object property): { onclick: () => ... }
          if (
            current.parent?.type === 'Property' &&
            current.parent?.key?.type === 'Identifier' &&
            /^on[a-z]/.test(current.parent.key.name)
          ) {
            return true;
          }
          // Callback passed to useEffect, effect, setTimeout, etc.
          if (current.parent?.type === 'CallExpression') {
            const callee = current.parent.callee;
            if (
              callee.type === 'Identifier' &&
              ['useEffect', 'effect', 'setTimeout', 'setInterval', 'requestAnimationFrame',
               'queueMicrotask', 'batch', 'onMount', 'onCleanup', 'addEventListener'].includes(callee.name)
            ) {
              return true;
            }
          }
          // Generic arrow/function inside another arrow/function — assume nested callback is safe
          if (
            current.parent?.type === 'ArrowFunctionExpression' ||
            current.parent?.type === 'FunctionExpression'
          ) {
            return true;
          }
        }
        current = current.parent;
      }
      return false;
    }

    return {
      VariableDeclarator(node) {
        if (!node.init) return;
        if (
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          ['signal', 'useSignal', 'computed', 'useComputed'].includes(node.init.callee.name) &&
          node.id.type === 'Identifier'
        ) {
          signalVars.add(node.id.name);
        }
      },

      CallExpression(node) {
        // Check for signal writes: count(value), count.set(value)
        let signalName = null;

        // Direct call: count(value) — with at least one argument (0-arg is a read)
        if (
          node.callee.type === 'Identifier' &&
          signalVars.has(node.callee.name) &&
          node.arguments.length > 0
        ) {
          signalName = node.callee.name;
        }

        // Method call: count.set(value)
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          signalVars.has(node.callee.object.name) &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'set'
        ) {
          signalName = node.callee.object.name;
        }

        if (signalName && !isInsideSafeContext(node)) {
          context.report({
            node,
            messageId: 'signalWriteInRender',
            data: { name: signalName },
          });
        }
      },
    };
  },
};
