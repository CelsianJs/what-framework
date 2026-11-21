/**
 * Rule: what/no-promise-in-usememo
 *
 * useMemo keeps what its function returns, as React's does, so a function
 * that returns a promise gives its readers the promise, not the value. An
 * async value is computed() (or useComputed()). The runtime reports the same
 * mistake as ERR_ASYNC_MEMO.
 *
 * Bad:  const user = useMemo(() => fetch('/api/user').then((r) => r.json()));
 * Good: const user = computed(({ signal }) => fetch('/api/user', { signal }).then((r) => r.json()));
 */

import { isFunction, returnsPromise } from '../utils/promises.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow a useMemo whose function returns a promise: use computed() for an async value',
      recommended: true,
      code: 'ERR_ASYNC_MEMO',
    },
    messages: {
      promiseInMemo:
        'useMemo keeps the promise this function returns as its value. For a value that loads, use computed() ' +
        '(or useComputed()): computed(({ signal }) => ...) is an async value whose readers wait for it to land.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'useMemo') return;
        const fn = node.arguments[0];
        if (isFunction(fn) && returnsPromise(fn)) context.report({ node: fn, messageId: 'promiseInMemo' });
      },
    };
  },
};
