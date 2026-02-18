/**
 * Rule: what/reactive-jsx-children
 *
 * Warn when using bare signal calls as JSX children without the compiler.
 * Without the What compiler, esbuild/TS handles JSX → h() calls, and a bare
 * signal read like {count()} won't be reactive — it captures the value once.
 *
 * The rule checks if the project uses what-compiler (via config option or
 * vite.config presence). If no compiler is detected, it warns on bare signal
 * reads in JSX expression containers.
 *
 * Bad (without compiler):  <p>{count()}</p>
 * Good (without compiler): <p>{() => count()}</p>
 */

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

    // Track signal variables
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

      // JSX expression: {count()}
      JSXExpressionContainer(node) {
        const expr = node.expression;
        if (!expr || expr.type === 'JSXEmptyExpression') return;

        // Skip if parent is an attribute (e.g., className={count()}) — only check children
        if (node.parent.type !== 'JSXElement' && node.parent.type !== 'JSXFragment') return;

        // Already wrapped in arrow: {() => count()} — OK
        if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') return;

        // Direct signal call: {count()}
        if (
          expr.type === 'CallExpression' &&
          expr.callee.type === 'Identifier' &&
          signalVars.has(expr.callee.name) &&
          expr.arguments.length === 0
        ) {
          context.report({
            node: expr,
            messageId: 'bareSignalRead',
            data: { name: expr.callee.name },
          });
        }
      },
    };
  },
};
