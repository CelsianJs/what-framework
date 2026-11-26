/**
 * Rule: what/no-uncalled-signals
 *
 * Catch the #1 mistake for new What Framework developers: using a signal
 * reference as a value instead of calling it.
 *
 * Signals are functions — you must call them to read the value.
 * Using a signal without () gives you the function reference, which:
 * - Is always truthy in conditionals
 * - Produces wrong comparisons
 * - Coerces to the function source in template literals
 *
 * Bad:  {isLoading && <Spinner />}  → always truthy
 * Bad:  `Total: ${count}`           → function source, not the value
 *
 * Good: {isLoading() && <Spinner />}
 * Good: `Total: ${count()}`
 * Good: <span>{count}</span>, <input value={count} />, {swr.data}: a signal
 *       that is the whole JSX child or attribute value is a live binding, with
 *       or without the compiler
 *
 * Also warns when What state is stored or passed as data where its value is
 * what is used (accessorAsData): a property or element of an object or array
 * literal handed to a state setter (`setSubmitted({ name, age })`), an
 * argument of a function that reads values (`JSON.stringify(submitted)`,
 * `String(name)`, `console.log(name)`), anything nested in such an argument
 * (`fetch(url, { body: JSON.stringify({ name }) })`), and an array literal
 * read as text (`[a, b].join()`). Only state made by a What hook or primitive
 * imported from what-framework or what-core, resolved through the scope, is
 * reported there: React's useState in a what-react file returns a value.
 *
 * Does NOT warn when:
 * - Signal is passed as a callback argument: fn(count)
 * - Signal method is accessed: count.set(5), count.peek()
 * - Signal is on left side of assignment or in typeof
 * - Signal is the whole expression of a JSX child or attribute
 * - The name is being declared or exported: const [count] = useState(0), export { count }
 */

import { createSignalTracker, SIGNAL_METHODS, SIGNAL_CREATORS, ACCESSOR_PAIR_HOOKS } from '../utils/signal-tracking.js';

const WHAT_SOURCES = /^what-(framework|core)(\/|$)/;

// Functions that read the values of their arguments: an accessor handed to one
// is turned into its source text, `undefined` or `{}`.
const VALUE_FUNCTIONS = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'encodeURIComponent', 'encodeURI', 'structuredClone', 'alert']);
const VALUE_METHODS = {
  JSON: new Set(['stringify']),
  console: new Set(['log', 'info', 'warn', 'error', 'debug', 'table']),
  Math: null,
  localStorage: new Set(['setItem']),
  sessionStorage: new Set(['setItem']),
};
// Methods of an array literal that read its elements as values.
const ARRAY_VALUE_METHODS = new Set(['join', 'toString', 'toLocaleString']);

/** The variable `node` (an identifier) resolves to, or null. */
function resolve(sourceCode, node) {
  if (!sourceCode?.getScope) return null;
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const v = scope.set.get(node.name);
    if (v) return v;
  }
  return null;
}

/** The name `callee` imports from what-framework or what-core, or null. */
function whatImport(sourceCode, callee) {
  if (callee?.type !== 'Identifier') return null;
  const def = resolve(sourceCode, callee)?.defs[0];
  if (def?.type !== 'ImportBinding' || def.node.type !== 'ImportSpecifier') return null;
  if (!WHAT_SOURCES.test(String(def.parent?.source?.value))) return null;
  return def.node.imported.name ?? def.node.imported.value;
}

/**
 * What the identifier `node` is, when What made it: 'accessor' for the state a
 * What hook or primitive returns (`const x = signal()`, the first element of
 * `const [x, setX] = useState()`), 'setter' for the second element of such a
 * pair, else null.
 */
function whatState(sourceCode, node) {
  const def = resolve(sourceCode, node)?.defs[0];
  if (def?.type !== 'Variable' || def.node.init?.type !== 'CallExpression') return null;
  const hook = whatImport(sourceCode, def.node.init.callee);
  if (hook === null) return null;
  const id = def.node.id;
  if (id.type === 'Identifier' && id === def.name) return SIGNAL_CREATORS.includes(hook) ? 'accessor' : null;
  if (id.type === 'ArrayPattern' && ACCESSOR_PAIR_HOOKS.includes(hook)) {
    if (id.elements[0] === def.name) return 'accessor';
    if (id.elements[1] === def.name && hook !== 'useTransition' && hook !== 'createResource') return 'setter';
  }
  return null;
}

/** Whether the call `call` reads the values of its arguments. */
function readsValues(call) {
  const callee = call.callee;
  if (callee.type === 'Identifier') return VALUE_FUNCTIONS.has(callee.name);
  if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier' || callee.property.type !== 'Identifier') return false;
  if (!Object.hasOwn(VALUE_METHODS, callee.object.name)) return false;
  const methods = VALUE_METHODS[callee.object.name];
  return methods === null || methods.has(callee.property.name);
}

/** Whether the call `call` writes What state with its argument: `setX(v)`, `x.set(v)`, `x(v)`. */
function writesState(sourceCode, call) {
  if (call.arguments.length === 0) return false;
  const callee = call.callee;
  if (callee.type === 'Identifier') {
    const kind = whatState(sourceCode, callee);
    return kind === 'setter' || kind === 'accessor';
  }
  return callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' &&
    callee.property.name === 'set' && callee.object.type === 'Identifier' && whatState(sourceCode, callee.object) === 'accessor';
}

/**
 * Where the identifier `node` is used as data whose value is read, described
 * for the message, or null. `node` sits in a call argument, an object
 * property's value or an array element.
 */
function valueSink(sourceCode, node) {
  let n = node;
  let nested = false;
  for (;;) {
    const parent = n.parent;
    if (!parent) return null;
    if (parent.type === 'Property' && parent.value === n && parent.parent?.type === 'ObjectExpression') {
      n = parent.parent;
      nested = true;
      continue;
    }
    if (parent.type === 'ArrayExpression' || (parent.type === 'SpreadElement' && parent.parent?.type === 'ArrayExpression' && nested)) {
      n = parent.type === 'SpreadElement' ? parent.parent : parent;
      nested = true;
      continue;
    }
    if (parent.type === 'CallExpression' && parent.arguments.includes(n)) {
      if (readsValues(parent)) return `${sourceCode.getText(parent.callee)}() is given the function, not its value`;
      // An accessor in a literal written to state: the state holds the function.
      if (nested && writesState(sourceCode, parent)) return `the ${n.type === 'ArrayExpression' ? 'array' : 'object'} written to ${sourceCode.getText(parent.callee)}() holds the function, not its value`;
      return null;
    }
    if (parent.type === 'MemberExpression' && parent.object === n && n.type === 'ArrayExpression' &&
        !parent.computed && parent.property.type === 'Identifier' && ARRAY_VALUE_METHODS.has(parent.property.name)) {
      return `.${parent.property.name}() reads the function, not its value`;
    }
    return null;
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require calling signals to read their value — catch missing ()',
      recommended: true,
      code: 'ERR_MISSING_SIGNAL_READ',
    },
    messages: {
      uncalledSignal:
        '"{{name}}" is a signal — call it to read the value: {{name}}()',
      uncalledSWRField:
        '"{{obj}}.{{prop}}" is a signal getter — call it to read the value: {{obj}}.{{prop}}()',
      uncalledDestructuredGetter:
        '"{{name}}" is a signal getter from a data hook — call it to read the value: {{name}}()',
      accessorAsData:
        '"{{name}}" is What state, a function: {{sink}}. Call it to use the value: {{name}}()',
      callIt: 'Call it: {{name}}()',
    },
    hasSuggestions: true,
    schema: [],
  },

  create(context) {
    const tracker = createSignalTracker();
    const sourceCode = context.sourceCode ?? context.getSourceCode?.();

    /** The suggestion that calls the identifier `node`: `{ name }` becomes `{ name: name() }`. */
    function callSuggestion(node) {
      const name = node.name;
      return [{
        messageId: 'callIt',
        data: { name },
        fix: (fixer) => (node.parent.type === 'Property' && node.parent.shorthand
          ? fixer.replaceText(node.parent, `${name}: ${name}()`)
          : fixer.insertTextAfter(node, '()')),
      }];
    }

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
     * Check if node is the whole expression of a JSX child or attribute value:
     * {count}, value={count}, onClick={handler}. A function there is a live
     * binding (or a handler), not a value read once.
     */
    function isWholeJSXExpression(node) {
      return node.parent?.type === 'JSXExpressionContainer' && node.parent.expression === node;
    }

    /**
     * Check if node names a binding rather than reading one: a destructuring
     * target (const [count] = useState(0)), a parameter, or an export.
     */
    function isBindingName(node) {
      const parent = node.parent;
      switch (parent.type) {
        case 'ArrayPattern':
        case 'RestElement':
        case 'ExportSpecifier':
          return true;
        case 'AssignmentPattern':
          return parent.left === node;
        case 'Property':
          return parent.value === node && parent.parent?.type === 'ObjectPattern';
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          return parent.params.includes(node);
        default:
          return false;
      }
    }

    function checkIdentifier(node) {
      const name = node.name;

      // Skip if being called: count() — correct usage
      if (isBeingCalled(node)) return;

      // Skip method access: count.set(...), count.peek()
      if (isMethodAccess(node)) return;

      // A pass-through position, unless the data it is in is read as a value
      if (isPassThrough(node)) {
        if (node.parent.type === 'ReturnStatement' || node.parent.type === 'AssignmentExpression' || node.parent.type === 'VariableDeclarator' || node.parent.type === 'UnaryExpression') return;
        const sink = valueSink(sourceCode, node);
        if (sink !== null && whatState(sourceCode, node) === 'accessor') {
          context.report({ node, messageId: 'accessorAsData', data: { name, sink }, suggest: callSuggestion(node) });
        }
        return;
      }

      // Skip a live binding or a handler: {count}, value={count}, onClick={handler}
      if (isWholeJSXExpression(node)) return;

      // Check: is this a direct signal variable?
      if (tracker.isSignalLike(name)) {
        context.report({
          node,
          messageId: tracker.isSignal(name) ? 'uncalledSignal' : 'uncalledDestructuredGetter',
          data: { name },
          suggest: callSuggestion(node),
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

        // Skip a live binding: {swr.data}
        if (isWholeJSXExpression(node)) return;

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
        if (isBindingName(node)) return;

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
