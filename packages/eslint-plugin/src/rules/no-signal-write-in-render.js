/**
 * Rule: what/no-signal-write-in-render
 *
 * Warn when a component writes a signal while it renders: in its run-once
 * body, or in a callback that runs right there (an IIFE, untrack(), batch(),
 * an array method like map/forEach). A write inside any other nested function
 * (an event handler, inline or named, an effect, onMount, a timer) runs later
 * and is fine, and so is a write in a function that is not a component, such
 * as a store action.
 *
 * Bad:  function App() { count(count() + 1); return ... }
 * Bad:  function App() { return <div>{() => { tab(0); return ... }}</div> }
 * Good: function App() { return <button onclick={() => count(c => c + 1)} /> }
 * Good: function App() { function add() { count(1); } return <button onclick={add} /> }
 * Good: effect(() => { count(0); })
 */

import { createSignalTracker } from '../utils/signal-tracking.js';
import { FUNCTION_TYPES, runsInPlace, signalWriteName } from '../utils/scopes.js';

function functionName(fn) {
  if (fn.id?.name) return fn.id.name;
  const parent = fn.parent;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  return null;
}

function isComponent(fn) {
  const name = functionName(fn);
  if (name) return /^[A-Z]/.test(name);
  return fn.parent?.type === 'ExportDefaultDeclaration';
}

// A function What runs as part of rendering: a JSX function child (a
// region, `{() => ...}`), or the value of a host element's attribute that is
// not an event handler or a ref (`class={() => ...}`). It runs when the
// component renders and again whenever what it reads changes, so a write in it
// is a write during render (and often a loop).
function isRenderRegion(fn) {
  const container = fn.parent;
  if (container?.type !== 'JSXExpressionContainer') return false;
  const owner = container.parent;
  if (owner?.type === 'JSXElement' || owner?.type === 'JSXFragment') return true;
  if (owner?.type !== 'JSXAttribute' || owner.name.type !== 'JSXIdentifier') return false;
  const tag = owner.parent?.name;
  const host = tag?.type === 'JSXIdentifier' && /^[a-z]/.test(tag.name);
  return host && !/^on/i.test(owner.name.name) && owner.name.name !== 'ref';
}

/** The component whose render executes `node`, or null. */
function renderingComponent(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (!FUNCTION_TYPES.has(n.type)) continue;
    if (isComponent(n)) return n;
    if (!runsInPlace(n) && !isRenderRegion(n)) return null;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow signal writes while a component renders',
      recommended: true,
      code: 'ERR_SIGNAL_WRITE_IN_RENDER',
    },
    messages: {
      signalWriteInRender:
        'Signal write to "{{name}}" while {{component}} renders. ' +
        'Move it into an event handler, an effect or onMount().',
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
        const signalName = signalWriteName(node, tracker);
        if (!signalName) return;
        const component = renderingComponent(node);
        if (component) {
          context.report({
            node,
            messageId: 'signalWriteInRender',
            data: { name: signalName, component: functionName(component) || 'the component' },
          });
        }
      },
    };
  },
};
