/**
 * Rule: what/prefer-async-computed
 *
 * computed(fn) starts an async value when it is created if `fn` is an async
 * function or takes `{ signal }`; a plain function that returns a promise
 * shows that it is async only when it runs, so it starts on first read. Two
 * of those read in turn by one reader load one after the other: a waterfall
 * (docs/ASYNC.md, "Starting and running"). Make the function async, or take
 * the run's AbortSignal (and pass it to fetch).
 *
 * Bad:  const user = computed(() => fetch('/api/user').then((r) => r.json()));
 * Good: const user = computed(async () => (await fetch('/api/user')).json());
 * Good: const user = computed(({ signal }) => fetch('/api/user', { signal }).then((r) => r.json()));
 */

import { isFunction, returnedExpressions, isPromiseExpression } from '../utils/promises.js';

const CREATORS = new Set(['computed', 'useComputed']);

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Make a computed that returns a promise async, so it starts when created',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      lazyStart:
        'This computed returns a promise from a plain function, so it starts only when first read: two read in turn load ' +
        'one after the other. Write async () => ..., or ({ signal }) => ... and pass the signal to fetch, so it starts when created.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !CREATORS.has(node.callee.name)) return;
        const fn = node.arguments[0];
        if (!isFunction(fn) || fn.async || fn.generator || fn.params.length > 0) return;
        if (!returnedExpressions(fn).some(isPromiseExpression)) return;
        context.report({
          node: fn,
          messageId: 'lazyStart',
          fix: fn.type === 'ArrowFunctionExpression' ? (fixer) => fixer.insertTextBefore(fn, 'async ') : null,
        });
      },
    };
  },
};
