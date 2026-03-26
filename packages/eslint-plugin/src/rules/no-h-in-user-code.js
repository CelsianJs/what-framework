/**
 * Rule: what/no-h-in-user-code
 *
 * Warn when user code imports `h` from what-framework.
 * Users should use JSX syntax instead of calling h() directly.
 * The compiler handles JSX-to-h() transformation automatically.
 *
 * Bad:  import { h } from 'what-framework';
 *       h('div', { class: 'foo' }, 'Hello');
 *
 * Good: <div class="foo">Hello</div>
 */

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow importing h() from what-framework — use JSX instead',
      recommended: true,
    },
    messages: {
      noHImport:
        'Avoid importing "h" directly. Use JSX syntax instead — ' +
        'the What compiler transforms JSX to optimized template() + insert() calls automatically.',
      noHCall:
        'Avoid calling h() directly in user code. Use JSX syntax instead — ' +
        'the What compiler transforms JSX to optimized template() + insert() calls automatically.',
    },
    schema: [],
  },

  create(context) {
    let hImported = false;

    return {
      ImportDeclaration(node) {
        // Check for imports from what-framework or what-core
        const source = node.source.value;
        if (
          source === 'what-framework' ||
          source === 'what-core' ||
          source === 'what-framework/h' ||
          source === 'what-core/h'
        ) {
          for (const spec of node.specifiers) {
            if (
              spec.type === 'ImportSpecifier' &&
              spec.imported.type === 'Identifier' &&
              spec.imported.name === 'h'
            ) {
              hImported = true;
              context.report({
                node: spec,
                messageId: 'noHImport',
              });
            }
          }
        }
      },

      CallExpression(node) {
        // Only warn on h() calls if h was imported from the framework
        if (
          hImported &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'h'
        ) {
          context.report({
            node,
            messageId: 'noHCall',
          });
        }
      },
    };
  },
};
