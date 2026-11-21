/**
 * Rule: what/no-effect-self-write
 *
 * An effect that reads a signal (subscribing to it) and writes the same signal
 * re-triggers itself on every run, until the engine stops the flush. Reads
 * inside untrack(), through peek(), or in an updater function do not subscribe.
 *
 * A write guarded by a test of the same signal, whose value does not depend on
 * that signal, settles: `if (open()) open(false)` re-runs the effect once,
 * finds the test false and stops. It is not reported.
 *
 * Bad:  effect(() => { count(count() + 1); });
 * Bad:  effect(() => { if (count() > 9) count(count() + 1); });
 * Good: effect(() => { count(untrack(count) + 1); });
 * Good: effect(() => { total(items().length); });
 * Good: effect(() => { if (count() > 9) count(0); });
 */

import { createSignalTracker } from '../utils/signal-tracking.js';
import { enclosingEffect, signalWriteName } from '../utils/scopes.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow effects that write a signal they also read',
      recommended: true,
      code: 'ERR_INFINITE_EFFECT',
    },
    messages: {
      selfWrite:
        'This effect reads and writes "{{name}}", so every write re-runs it: an infinite loop. ' +
        'Read it with untrack({{name}}) or {{name}}.peek(), or derive the value with computed().',
    },
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();

    const readsSignal = (node, name) => {
      let found = false;
      const visit = (n) => {
        if (found || !n || typeof n.type !== 'string') return;
        if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === name && n.arguments.length === 0) {
          found = true;
          return;
        }
        for (const key of Object.keys(n)) {
          if (key === 'parent') continue;
          const v = n[key];
          if (Array.isArray(v)) v.forEach(visit);
          else if (v && typeof v.type === 'string') visit(v);
        }
      };
      visit(node);
      return found;
    };

    // The write settles: a branch of a test that reads the signal guards it,
    // and the value written neither reads the signal nor is an updater.
    function settles(write, name, effectFn) {
      if (write.arguments.some((a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression' || readsSignal(a, name))) return false;
      for (let child = write, n = write.parent; n && n !== effectFn; child = n, n = n.parent) {
        if (n.type === 'IfStatement' && n.test !== child && readsSignal(n.test, name)) return true;
        if (n.type === 'ConditionalExpression' && n.test !== child && readsSignal(n.test, name)) return true;
        if (n.type === 'LogicalExpression' && n.right === child && readsSignal(n.left, name)) return true;
      }
      return false;
    }
    const effects = new Map(); // effect callback → { reads: Set, writes: Map<name, node> }

    return {
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },
      CallExpression(node) {
        const write = signalWriteName(node, tracker);
        const read = node.callee.type === 'Identifier' && node.arguments.length === 0 && tracker.isSignal(node.callee.name) ? node.callee.name : null;
        if (!write && !read) return;
        const scope = enclosingEffect(node);
        if (!scope) return;
        let entry = effects.get(scope.effect);
        if (!entry) effects.set(scope.effect, (entry = { reads: new Set(), writes: new Map() }));
        if (read && scope.tracked) entry.reads.add(read);
        if (write && !entry.writes.has(write) && !settles(node, write, scope.effect)) entry.writes.set(write, node);
      },
      'Program:exit'() {
        for (const { reads, writes } of effects.values()) {
          for (const [name, node] of writes) {
            if (reads.has(name)) context.report({ node, messageId: 'selfWrite', data: { name } });
          }
        }
      },
    };
  },
};
