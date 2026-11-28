/**
 * Rule: what/no-optimistic-snapshot
 *
 * useOptimistic(state, update) takes the state as an accessor: a component
 * runs once, so `useOptimistic(likes())` is the value at setup, and the
 * optimistic view never sees the real value change. Pass the accessor itself.
 *
 * Bad:  const [shown, addLike] = useOptimistic(likes(), (n, d) => n + d);
 * Good: const [shown, addLike] = useOptimistic(likes, (n, d) => n + d);
 */

import { createSignalTracker } from '../utils/signal-tracking.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require useOptimistic to take its state as an accessor, not a value read once',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      snapshot:
        'useOptimistic({{name}}()) reads {{name}} once, when the component runs: the optimistic value never sees it change. ' +
        'Pass the accessor: useOptimistic({{name}}, ...).',
    },
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();
    const source = context.sourceCode ?? context.getSourceCode();
    return {
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'useOptimistic') return;
        const state = node.arguments[0];
        if (state?.type !== 'CallExpression' || state.arguments.length !== 0 || state.callee.type !== 'Identifier') return;
        if (!tracker.isSignalLike(state.callee.name)) return;
        const name = state.callee.name;
        context.report({
          node: state,
          messageId: 'snapshot',
          data: { name },
          fix: (fixer) => fixer.replaceText(state, source.getText(state.callee)),
        });
      },
    };
  },
};
