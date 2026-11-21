/**
 * Rule: what/prefer-computed
 *
 * An effect whose only job is to write one signal from others is a derived
 * value: computed() expresses it directly, evaluates lazily and cannot loop.
 * Off in the recommended and compiler presets, a warning in strict.
 *
 * Bad:  effect(() => { total(items().length); });
 * Good: const total = computed(() => items().length);
 */

import { createSignalTracker } from '../utils/signal-tracking.js';
import { FUNCTION_TYPES, isEffectCallback } from '../utils/scopes.js';

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer computed() over an effect that only writes one signal',
      recommended: false,
    },
    messages: {
      preferComputed: 'This effect only writes "{{name}}". Derive it instead: const {{name}} = computed(() => ...).',
    },
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();

    function onlyStatement(fn) {
      const body = fn.body;
      if (body.type !== 'BlockStatement') return body;
      return body.body.length === 1 && body.body[0].type === 'ExpressionStatement' ? body.body[0].expression : null;
    }

    function check(fn) {
      if (!isEffectCallback(fn)) return;
      const call = onlyStatement(fn);
      if (call?.type !== 'CallExpression' || call.callee.type !== 'Identifier' || !tracker.isSignal(call.callee.name)) return;
      if (call.arguments.length !== 1 || FUNCTION_TYPES.has(call.arguments[0].type)) return;
      context.report({ node: call, messageId: 'preferComputed', data: { name: call.callee.name } });
    }

    return {
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },
      ArrowFunctionExpression: check,
      FunctionExpression: check,
    };
  },
};
