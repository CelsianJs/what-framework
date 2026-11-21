/**
 * Rule: what/effect-cleanup
 *
 * An effect that adds an event listener or starts an interval must undo it:
 * return a cleanup function (or call onCleanup()). Without one, every re-run
 * and every unmount leaves the previous listener or interval running.
 *
 * Bad:  effect(() => { window.addEventListener('resize', onResize); });
 * Good: effect(() => {
 *         window.addEventListener('resize', onResize);
 *         return () => window.removeEventListener('resize', onResize);
 *       });
 */

import { FUNCTION_TYPES, isEffectCallback, enclosingEffect, nearestFunction } from '../utils/scopes.js';

const RESOURCES = { addEventListener: 'event listener', setInterval: 'interval' };

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require a cleanup for listeners and intervals an effect starts',
      recommended: true,
      code: 'ERR_MISSING_CLEANUP',
    },
    messages: {
      missingCleanup: 'This effect starts an {{resource}} but returns no cleanup function: return () => {{undo}}.',
    },
    schema: [],
  },

  create(context) {
    const effects = new Map(); // effect callback → { resource, node, cleanup }

    function entryFor(fn) {
      let entry = effects.get(fn);
      if (!entry) effects.set(fn, (entry = { resource: null, node: null, cleanup: false }));
      return entry;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        const name = callee.type === 'Identifier' ? callee.name
          : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : null;
        if (!name) return;
        const scope = enclosingEffect(node);
        if (!scope) return;
        const entry = entryFor(scope.effect);
        if (name === 'onCleanup') entry.cleanup = true;
        else if (RESOURCES[name] && !entry.resource) {
          entry.resource = name;
          entry.node = node;
        }
      },
      ReturnStatement(node) {
        const fn = nearestFunction(node);
        if (fn && isEffectCallback(fn) && node.argument) entryFor(fn).cleanup = true;
      },
      ArrowFunctionExpression(fn) {
        // effect(() => () => cleanup()): the expression body is the cleanup.
        if (isEffectCallback(fn) && FUNCTION_TYPES.has(fn.body.type)) entryFor(fn).cleanup = true;
      },
      'Program:exit'() {
        for (const { resource, node, cleanup } of effects.values()) {
          if (!resource || cleanup) continue;
          context.report({
            node,
            messageId: 'missingCleanup',
            data: {
              resource: RESOURCES[resource],
              undo: resource === 'setInterval' ? 'clearInterval(id)' : 'removeEventListener(...)',
            },
          });
        }
      },
    };
  },
};
