/**
 * Rule: what/signal-debug-name
 *
 * A module-scope signal is shared state. Without a debug name (the second
 * argument) devtools, what_signals and diagnostics show it as `signal_12`.
 * Off in the recommended and compiler presets, a warning in strict.
 *
 * Bad:  export const todos = signal([]);
 * Good: export const todos = signal([], 'todos');
 */

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Give module-scope signals a debug name',
      recommended: false,
    },
    messages: {
      missingName: "Module-scope signal '{{name}}' has no debug name, so devtools show it as signal_N. Add one: signal(initial, '{{name}}').",
    },
    schema: [],
  },

  create(context) {
    return {
      VariableDeclarator(node) {
        const init = node.init;
        if (init?.type !== 'CallExpression' || init.callee.type !== 'Identifier' || init.callee.name !== 'signal') return;
        if (init.arguments.length >= 2 || node.id.type !== 'Identifier') return;
        const holder = node.parent?.parent;
        const atModuleScope = holder?.type === 'Program' || (holder?.type === 'ExportNamedDeclaration' && holder.parent?.type === 'Program');
        if (atModuleScope) context.report({ node, messageId: 'missingName', data: { name: node.id.name } });
      },
    };
  },
};
