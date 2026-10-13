/**
 * Native What components run once. Destructuring their props during setup
 * snapshots values before the compiler's JSX effects can track property reads.
 * React compatibility components rerender and must not inherit this restriction.
 */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Keep native component props reactive instead of destructuring at setup', recommended: true },
    schema: [{ type: 'object', properties: { assumeNative: { type: 'boolean' } }, additionalProperties: false }],
    messages: {
      snapshot: 'Destructuring native component props captures their initial values. Read props.property inside a reactive callback instead.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    let native = context.options[0]?.assumeNative === true;
    let react = /(?:^|[/\\])react-compat(?:[/\\]|$)/.test(context.filename);
    const hNames = new Set();
    const functions = [];

    function enter(node) {
      const name = node.id?.name || (node.parent?.type === 'VariableDeclarator' ? node.parent.id.name : '');
      const parameter = node.params[0]?.type === 'AssignmentPattern' ? node.params[0].left : node.params[0];
      const component = /^[A-Z]/.test(name || '') || !name && node.parent?.type === 'ExportDefaultDeclaration';
      functions.push({ node, parameter, component, returnedTree: false, snapshots: [] });
    }

    function exit() {
      const fn = functions.pop();
      if (!native || react || !fn.component || !fn.returnedTree) return;
      if (fn.parameter?.type === 'ObjectPattern' && fn.parameter.properties.length > 0) {
        context.report({ node: fn.parameter, messageId: 'snapshot' });
      }
      for (const node of fn.snapshots) context.report({ node, messageId: 'snapshot' });
    }

    // Resolve the binding, not just its spelling: a block-scoped domain object
    // or a callback parameter named `props` is not the component's parameter.
    function isPropsRead(node, parameter) {
      if (node.type !== 'Identifier' || parameter?.type !== 'Identifier' || node.name !== parameter.name) return false;
      let scope = sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) return variable.defs.some(def => def.type === 'Parameter' && def.name === parameter);
        scope = scope.upper;
      }
      return false;
    }

    function returnedTree(node) {
      const fn = functions[functions.length - 1];
      if (!fn?.component) return;
      let parent = node;
      while (parent && parent !== fn.node) {
        if (parent.type === 'ReturnStatement' || parent === fn.node.body && fn.node.type === 'ArrowFunctionExpression') {
          fn.returnedTree = true;
          return;
        }
        parent = parent.parent;
      }
    }

    return {
      Program(node) {
        // Imports may legally follow declarations. Determine the runtime
        // before visiting any component, including React compatibility files.
        for (const entry of node.body) {
          if (entry.type !== 'ImportDeclaration') continue;
          const from = entry.source.value;
          if (/^(?:react|what-react)(?:\/|$)/.test(from)) react = true;
          if (/^(?:what-framework|what-core)(?:\/|$)/.test(from)) {
            native = true;
            for (const spec of entry.specifiers) {
              if (spec.type === 'ImportSpecifier' && spec.imported.name === 'h') hNames.add(spec.local.name);
            }
          }
        }
      },
      FunctionDeclaration: enter,
      FunctionExpression: enter,
      ArrowFunctionExpression: enter,
      'FunctionDeclaration:exit': exit,
      'FunctionExpression:exit': exit,
      'ArrowFunctionExpression:exit': exit,
      JSXElement: returnedTree,
      JSXFragment: returnedTree,
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && hNames.has(node.callee.name)) returnedTree(node);
      },
      VariableDeclarator(node) {
        const fn = functions[functions.length - 1];
        if (fn?.component && node.id.type === 'ObjectPattern' && node.id.properties.length > 0 && node.init && isPropsRead(node.init, fn.parameter)) {
          fn.snapshots.push(node.id);
        }
      },
    };
  },
};
