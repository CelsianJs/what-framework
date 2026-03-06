/**
 * Rule: what/no-uncalled-signals
 *
 * Catch the #1 mistake for new What Framework developers: using a signal
 * reference as a value instead of calling it.
 *
 * Signals are functions — you must call them to read the value.
 * Using a signal without () gives you the function reference, which:
 * - Renders as "[Function]" in JSX
 * - Is always truthy in conditionals
 * - Produces wrong comparisons
 *
 * Bad:  <span>{count}</span>        → renders "[Function]"
 * Bad:  {isLoading && <Spinner />}  → always truthy
 * Bad:  {swr.data}                  → renders "[Function]"
 * Bad:  `Total: ${count}`           → "[Function]"
 *
 * Good: <span>{count()}</span>
 * Good: {isLoading() && <Spinner />}
 * Good: {swr.data()}
 * Good: `Total: ${count()}`
 *
 * Does NOT warn when:
 * - Signal is passed as a callback argument: fn(count)
 * - Signal method is accessed: count.set(5), count.peek()
 * - Signal is on left side of assignment or in typeof
 * - Signal is used in an event handler attribute value: onClick={handler}
 */

import { createSignalTracker, SIGNAL_METHODS } from '../utils/signal-tracking.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require calling signals to read their value — catch missing ()',
      recommended: true,
    },
    messages: {
      uncalledSignal:
        '"{{name}}" is a signal — call it to read the value: {{name}}()',
      uncalledSWRField:
        '"{{obj}}.{{prop}}" is a signal getter — call it to read the value: {{obj}}.{{prop}}()',
      uncalledDestructuredGetter:
        '"{{name}}" is a signal getter from a data hook — call it to read the value: {{name}}()',
    },
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();

    /**
     * Check if a node is in a "pass-through" position where the signal
     * reference itself is intentionally used (not read for its value).
     */
    function isPassThrough(node) {
      const parent = node.parent;
      if (!parent) return false;

      // Argument to a function call: someFunc(count) — passing the signal
      // EXCEPT: we still warn in JSX expression containers and template literals
      if (parent.type === 'CallExpression' && parent.arguments.includes(node)) {
        // Check if the call is a known signal method on this very signal
        // e.g., count.set(otherSignal) — otherSignal is an arg, that's fine
        return true;
      }

      // Property value in object: { handler: count } — passing reference
      if (parent.type === 'Property' && parent.value === node) {
        // Unless it's a JSX spread or data object where value is expected
        return true;
      }

      // Array element: [count, other] — building a collection of signals
      if (parent.type === 'ArrayExpression') return true;

      // Assignment: someVar = count — storing the signal
      if (parent.type === 'AssignmentExpression' && parent.right === node) return true;

      // Variable init: const x = count — aliasing the signal
      if (parent.type === 'VariableDeclarator' && parent.init === node) return true;

      // Return statement: return count — returning signal from function
      if (parent.type === 'ReturnStatement') return true;

      // typeof check
      if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') return true;

      // Conditional (ternary) test position is NOT pass-through — we want to warn
      // Logical expression operand is NOT pass-through — we want to warn

      return false;
    }

    /**
     * Check if a node is a member expression accessing a safe signal method.
     * e.g., count.set, count.peek, count.subscribe
     */
    function isMethodAccess(node) {
      const parent = node.parent;
      return (
        parent?.type === 'MemberExpression' &&
        parent.object === node &&
        parent.property?.type === 'Identifier' &&
        SIGNAL_METHODS.has(parent.property.name)
      );
    }

    /**
     * Check if node is the callee of a call expression (i.e., it IS being called).
     */
    function isBeingCalled(node) {
      return node.parent?.type === 'CallExpression' && node.parent.callee === node;
    }

    /**
     * Check if a MemberExpression is the callee of a call (being called).
     */
    function isMemberBeingCalled(node) {
      return node.parent?.type === 'CallExpression' && node.parent.callee === node;
    }

    /**
     * Check if node is a JSX attribute value (event handler).
     * e.g., onClick={handler} — not a value context.
     */
    function isJSXAttributeValue(node) {
      // Walk up: Identifier -> JSXExpressionContainer -> JSXAttribute
      const exprContainer = node.parent;
      if (exprContainer?.type === 'JSXExpressionContainer') {
        return exprContainer.parent?.type === 'JSXAttribute';
      }
      return false;
    }

    function checkIdentifier(node) {
      const name = node.name;

      // Skip if being called: count() — correct usage
      if (isBeingCalled(node)) return;

      // Skip method access: count.set(...), count.peek()
      if (isMethodAccess(node)) return;

      // Skip pass-through positions
      if (isPassThrough(node)) return;

      // Skip JSX attribute values (event handlers): onClick={handler}
      if (isJSXAttributeValue(node)) return;

      // Check: is this a direct signal variable?
      if (tracker.isSignalLike(name)) {
        context.report({
          node,
          messageId: tracker.isSignal(name) ? 'uncalledSignal' : 'uncalledDestructuredGetter',
          data: { name },
        });
      }
    }

    function checkMemberExpression(node) {
      // Only check: swr.data, swr.error, swr.isLoading, etc.
      if (
        node.object.type === 'Identifier' &&
        tracker.isSWRObject(node.object.name) &&
        node.property.type === 'Identifier' &&
        tracker.isSWRGetterField(node.property.name)
      ) {
        // Skip if being called: swr.data() — correct usage
        if (isMemberBeingCalled(node)) return;

        // Skip if further member access: swr.data.something (unusual but possible)
        if (node.parent?.type === 'MemberExpression' && node.parent.object === node) return;

        // Skip pass-through positions on the parent
        if (isPassThrough(node)) return;

        context.report({
          node,
          messageId: 'uncalledSWRField',
          data: {
            obj: node.object.name,
            prop: node.property.name,
          },
        });
      }
    }

    return {
      // Merge the signal tracker's visitors
      VariableDeclarator(node) {
        tracker.visitors.VariableDeclarator(node);
      },

      // Check bare identifiers
      Identifier(node) {
        // Skip declaration positions (variable names, function params, etc.)
        const parent = node.parent;
        if (!parent) return;

        // Skip: const count = ..., function count() {}, { count: ... } key
        if (parent.type === 'VariableDeclarator' && parent.id === node) return;
        if (parent.type === 'FunctionDeclaration' && parent.id === node) return;
        if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
        if (parent.type === 'ImportSpecifier') return;
        if (parent.type === 'ImportDefaultSpecifier') return;

        // Skip: member expression property (count.set — we handle this separately)
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;

        checkIdentifier(node);
      },

      // Check member expressions like swr.data
      MemberExpression(node) {
        checkMemberExpression(node);
      },
    };
  },
};
