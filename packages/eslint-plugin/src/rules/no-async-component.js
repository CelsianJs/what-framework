/**
 * Rule: what/no-async-component
 *
 * A component is an `async function` (React Server Components' habit). What's
 * components run once and synchronously: an async one returns a promise, and
 * what renders is the promise's text, even under <Suspense>. The runtime
 * reports the same mistake as ERR_ASYNC_COMPONENT.
 *
 * Bad:  async function Profile(props) { const user = await fetchUser(props.id); return <h1>{user.name}</h1>; }
 * Good: function Profile(props) {
 *         const user = computed(({ signal }) => fetchUser(props.id, { signal }));
 *         return <h1>{user().name}</h1>;
 *       }
 */

const COMPONENT_NAME = /^[A-Z]/;

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow async components: make the data an async computed and read it in JSX',
      recommended: true,
      code: 'ERR_ASYNC_COMPONENT',
    },
    messages: {
      asyncComponent:
        'Component "{{name}}" is an async function: components run once and synchronously, so it renders a promise. ' +
        'Make the data an async value, computed(({ signal }) => fetch(..., { signal })), and read it in JSX under <Suspense>.',
    },
    schema: [],
  },

  create(context) {
    function check(fn, name) {
      if (fn.async && !fn.generator && name && COMPONENT_NAME.test(name)) {
        context.report({ node: fn, messageId: 'asyncComponent', data: { name } });
      }
    }
    return {
      FunctionDeclaration(node) {
        check(node, node.id?.name);
      },
      VariableDeclarator(node) {
        const init = node.init;
        if (node.id.type === 'Identifier' && (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')) {
          check(init, node.id.name);
        }
      },
    };
  },
};
