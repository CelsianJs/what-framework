/**
 * Rule: what/no-signal-in-effect-deps
 *
 * Warn when passing signal getter functions to useEffect dependency arrays.
 * Signal getters create new function references, so deps always appear "changed",
 * causing the effect to re-run on every render cycle.
 *
 * Bad:  useEffect(() => { ... }, [count])     // count is a signal getter fn
 * Good: useEffect(() => { ... }, [count()])   // use the value instead
 * Good: useEffect(() => { count(); }, [])     // or rely on auto-tracking
 */

import { createSignalTracker } from '../utils/signal-tracking.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow signal getters in useEffect dependency arrays',
      recommended: true,
    },
    messages: {
      signalInDeps:
        'Signal getter "{{name}}" in useEffect deps will cause infinite re-runs. ' +
        'Use {{name}}() for the value, or remove deps to rely on auto-tracking.',
    },
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();

    return {
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },

      CallExpression(node) {
        // Match useEffect(fn, [deps])
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'useEffect'
        ) return;

        const depsArg = node.arguments[1];
        if (!depsArg || depsArg.type !== 'ArrayExpression') return;

        for (const element of depsArg.elements) {
          if (!element) continue;

          // Direct signal reference: useEffect(fn, [count])
          if (
            element.type === 'Identifier' &&
            tracker.isSignalLike(element.name)
          ) {
            context.report({
              node: element,
              messageId: 'signalInDeps',
              data: { name: element.name },
            });
          }
        }
      },
    };
  },
};
