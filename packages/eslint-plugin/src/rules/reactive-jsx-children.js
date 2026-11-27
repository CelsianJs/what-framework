/**
 * Rule: what/reactive-jsx-children
 *
 * Without the What compiler (the automatic JSX runtime, as create-what's
 * islands template uses, or h() calls), a JSX child or an element's attribute
 * is evaluated once, when the element is made. Any expression there that reads
 * a signal keeps its first value: a bare {count()}, and {count() * 2},
 * {items().map(...)}, {user().name} or class={on() ? 'a' : 'b'} alike. A
 * function, {() => ...}, is what stays live. A component's prop is left alone:
 * wrapping it would hand the component a function it does not expect.
 *
 * Bad (without compiler):  <p>{count()}</p>  <ul>{items().map(...)}</ul>
 * Good (without compiler): <p>{() => count()}</p>  <ul>{() => items().map(...)}</ul>
 */

import { createSignalTracker } from '../utils/signal-tracking.js';

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

// JSX made inside a function that is itself in JSX (`{() => on() ? <p>{n()}</p> : null}`,
// a `.map()` callback) is made again each time the function runs, so its
// expressions are read then, not once.
function insideJsxFunction(node) {
  let inFunction = false;
  for (let p = node.parent; p; p = p.parent) {
    if (FUNCTION_TYPES.has(p.type)) inFunction = true;
    else if (inFunction && p.type === 'JSXExpressionContainer') return true;
  }
  return false;
}

const isChild = (node) => node.parent?.type === 'JSXElement' || node.parent?.type === 'JSXFragment';

// An attribute of a DOM element (a lowercase tag) whose value is rendered: not
// a handler, a ref or a key, and not a component's prop.
function isElementAttribute(node) {
  const attr = node.parent;
  if (attr?.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') return false;
  const name = attr.name.name;
  if (/^on[A-Za-z]/.test(name) || name === 'ref' || name === 'key') return false;
  const tag = attr.parent?.name;
  return tag?.type === 'JSXIdentifier' && /^[a-z]/.test(tag.name);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require reactive function wrappers for signal reads in JSX when not using the compiler',
      recommended: true,
    },
    messages: {
      bareSignalRead:
        'Signal read "{{name}}()" in JSX won\'t be reactive without the What compiler. ' +
        'Wrap in a function: {() => {{name}}()}',
      signalReadInExpression:
        'This JSX expression reads "{{name}}()" once without the What compiler, so it keeps its first value. ' +
        'Wrap the expression in a function: {() => …}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          hasCompiler: {
            type: 'boolean',
            description: 'Set to true if the project uses what-compiler (auto-detected if not set)',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};

    // If the user explicitly says they have the compiler, skip all checks
    if (options.hasCompiler === true) return {};

    const tracker = createSignalTracker();

    const isSignalRead = (expr) =>
      expr.type === 'CallExpression' &&
      expr.callee.type === 'Identifier' &&
      tracker.isSignalLike(expr.callee.name) &&
      expr.arguments.length === 0;

    // The first signal read evaluated with the expression: not one inside a
    // function (it runs later), nor one in nested JSX, whose own expression
    // containers are checked where they are.
    function firstSignalRead(expr) {
      if (!expr || typeof expr.type !== 'string') return null;
      if (FUNCTION_TYPES.has(expr.type) || expr.type === 'JSXElement' || expr.type === 'JSXFragment') return null;
      if (isSignalRead(expr)) return expr;
      for (const key of Object.keys(expr)) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue;
        const value = expr[key];
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child && typeof child === 'object') {
            const found = firstSignalRead(child);
            if (found) return found;
          }
        }
      }
      return null;
    }

    return {
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },

      // JSX expression: {count()}, {count() * 2}, class={on() ? 'a' : 'b'}
      JSXExpressionContainer(node) {
        const expr = node.expression;
        if (!expr || expr.type === 'JSXEmptyExpression') return;
        if (!isChild(node) && !isElementAttribute(node)) return;
        if (insideJsxFunction(node)) return;

        // Already wrapped in a function: {() => count()} — OK
        if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') return;

        // Direct signal call: {count()}
        if (isSignalRead(expr)) {
          context.report({
            node: expr,
            messageId: 'bareSignalRead',
            data: { name: expr.callee.name },
          });
          return;
        }

        const read = firstSignalRead(expr);
        if (read) {
          context.report({
            node: read,
            messageId: 'signalReadInExpression',
            data: { name: read.callee.name },
          });
        }
      },
    };
  },
};
