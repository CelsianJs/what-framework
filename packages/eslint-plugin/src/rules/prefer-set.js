/**
 * Rule: what/prefer-set
 *
 * Suggest using sig.set(value) instead of sig(value) for signal writes.
 * The unified getter/setter pattern sig(value) is valid but ambiguous —
 * sig.set(value) makes the write intent explicit and easier to grep/review.
 *
 * Bad:  count(5)           // is this a read or write?
 * Bad:  count(c => c + 1)  // updater pattern
 * Good: count.set(5)
 * Good: count.set(c => c + 1)
 *
 * This rule is off by default (style preference, not a bug).
 */

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer sig.set(value) over sig(value) for signal writes',
      recommended: false,
    },
    fixable: 'code',
    messages: {
      preferSet:
        'Prefer "{{name}}.set({{arg}})" over "{{name}}({{arg}})" for explicit signal writes.',
    },
    schema: [],
  },

  create(context) {
    const signalVars = new Set();

    return {
      VariableDeclarator(node) {
        if (!node.init) return;
        if (
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          ['signal', 'useSignal', 'computed', 'useComputed'].includes(node.init.callee.name) &&
          node.id.type === 'Identifier'
        ) {
          signalVars.add(node.id.name);
        }
      },

      CallExpression(node) {
        // Only match: signalVar(value) with exactly 1 argument
        if (
          node.callee.type !== 'Identifier' ||
          !signalVars.has(node.callee.name) ||
          node.arguments.length !== 1
        ) return;

        // Already using .set() — skip
        if (node.callee.type === 'MemberExpression') return;

        const name = node.callee.name;
        const sourceCode = context.sourceCode || context.getSourceCode();
        const argText = sourceCode.getText(node.arguments[0]);

        context.report({
          node,
          messageId: 'preferSet',
          data: { name, arg: argText },
          fix(fixer) {
            return fixer.replaceText(node, `${name}.set(${argText})`);
          },
        });
      },
    };
  },
};
