/**
 * Rule: what/no-signal-read-in-effect-deps
 *
 * useEffect(fn, deps) re-runs when an accessor listed in deps changes. A signal
 * read there is the value at setup: a component runs once, so that value never
 * changes and the effect never re-runs for it. The runtime reports the same
 * mistake as ERR_EFFECT_DEP_NOT_FUNCTION.
 *
 * Bad:  useEffect(() => { ... }, [count()])
 * Good: useEffect(() => { ... }, [count])
 * Good: useEffect(() => { log(count()); })   // no deps: it tracks what it reads
 */

import { createSignalTracker } from '../utils/signal-tracking.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require accessors, not signal reads, in useEffect dependency arrays',
      recommended: true,
      code: 'ERR_EFFECT_DEP_NOT_FUNCTION',
    },
    fixable: 'code',
    messages: {
      readInDeps:
        'useEffect deps take accessors: write {{name}}, not {{name}}(). {{name}}() is the value read once at setup, ' +
        'so the effect never re-runs when it changes. Or drop the array: useEffect tracks the signals it reads.',
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
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'useEffect') return;

        const depsArg = node.arguments[1];
        if (!depsArg || depsArg.type !== 'ArrayExpression') return;

        for (const element of depsArg.elements) {
          if (
            element?.type === 'CallExpression' &&
            element.arguments.length === 0 &&
            element.callee.type === 'Identifier' &&
            tracker.isSignalLike(element.callee.name)
          ) {
            const name = element.callee.name;
            context.report({
              node: element,
              messageId: 'readInDeps',
              data: { name },
              fix: (fixer) => fixer.replaceText(element, source.getText(element.callee)),
            });
          }
        }
      },
    };
  },
};
