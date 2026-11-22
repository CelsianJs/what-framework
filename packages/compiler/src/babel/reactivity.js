import { t } from './types.js';

// Known non-reactive call expressions — these should NOT be wrapped in effects
// unless their arguments contain signal reads.
const SAFE_GLOBAL_CALLS = new Set([
  'Math', 'Number', 'String', 'Boolean', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'JSON', 'Date', 'Array', 'Object',
  'console', 'RegExp',
]);

// Built-in prototype methods that convert or copy a value. A zero-argument call
// is otherwise assumed to be a signal read (see isPotentiallyReactive); these
// names are the ones JavaScript itself defines, so they never are, and they are
// common enough in JSX that wrapping them would be pure cost.
const PURE_BUILTIN_METHODS = new Set([
  'toString', 'toLocaleString', 'valueOf', 'toJSON',
  'toUpperCase', 'toLowerCase', 'toLocaleUpperCase', 'toLocaleLowerCase',
  'trim', 'trimStart', 'trimEnd',
  'toFixed', 'toPrecision', 'toExponential',
  'toISOString', 'toUTCString', 'toDateString', 'toTimeString',
  'toLocaleDateString', 'toLocaleTimeString',
  'slice', 'reverse', 'sort', 'flat', 'concat', 'join',
]);

// Built-in methods that read only their receiver and their arguments, a
// callback argument included (see readsInCallback). Any other method of a value
// the compiler did not see built may read a signal inside (see callReadsInside).
const BUILTIN_METHODS = new Set([
  'at', 'charAt', 'charCodeAt', 'codePointAt', 'includes', 'indexOf', 'lastIndexOf',
  'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'replace', 'replaceAll',
  'split', 'substring', 'localeCompare', 'normalize', 'match', 'matchAll', 'search',
  'map', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every',
  'reduce', 'reduceRight', 'flatMap', 'forEach', 'toSorted', 'toReversed', 'toSpliced', 'with',
]);

// Known signal-creating functions
const SIGNAL_CREATORS = new Set([
  'useSignal', 'signal', 'computed', 'useComputed', 'useState', 'useReducer',
  'createResource', 'useSWR', 'useQuery', 'useInfiniteQuery',
]);

// =====================================================
// Reactivity Detection — Signal-Aware
// =====================================================

// Check if an identifier is known to be a signal (from useSignal/signal/computed/useState)
export function isSignalIdentifier(name, signalNames) {
  return signalNames.has(name);
}

// Collect signal identifiers using Babel's scope analysis.
// Walks the scope chain from the given path upward, collecting signals
// defined in each lexical scope (function/block).
export function collectSignalNamesFromScope(path) {
  /** @type {Set<string> & { fromDestructuredProps?: Set<string>, scope?: any, calls?: any[] }} */
  const signalNames = new Set();
  // Names that came from a DESTRUCTURED PROP rather than a signal() call.
  //
  // They belong in signalNames because they might hold an accessor and so
  // must still be wrapped in an effect. They must NOT be auto-invoked: a prop
  // is whatever the parent passed, and `_$createComponent` passes plain
  // values, so `<span data-label={label}>` inside `({ label })` compiled to
  // `setAttr(el, 'data-label', label())` and threw "label is not a function"
  // on any ordinary string prop, blanking the whole component subtree.
  //
  // The same identifier as a CHILD compiled to `() => label`, uncalled, so
  // the two positions disagreed inside a single element. The runtime setters
  // (setAttr, setClass, setValue, ...) already resolve a function value
  // reactively, so passing the identifier through uncalled is correct for
  // both a plain value and an accessor.
  const propNames = new Set();
  signalNames.fromDestructuredProps = propNames;
  // Where the names were collected: a call is resolved from here to the
  // function it calls (see callReadsInside).
  signalNames.scope = path.scope;

  // Walk up the scope chain using Babel's scope API.
  let scope = path.scope;
  while (scope) {
    const own = scopeNamesCache !== null ? scopeNamesCache.get(scope) : undefined;
    const { signals, props } = own || ownSignalNames(scope);
    if (scopeNamesCache !== null && own === undefined) scopeNamesCache.set(scope, { signals, props });
    for (const name of signals) signalNames.add(name);
    for (const name of props) propNames.add(name);
    scope = scope.parent;
  }

  return signalNames;
}

// The names one scope declares that may hold an accessor: its signal-creating
// declarations (`signals`), and its function's destructured props (`props`,
// also in `signals`).
function ownSignalNames(scope) {
  const signals = [];
  const props = [];

  // Helper: extract signal names from a VariableDeclarator node
  function extractFromDeclarator(decl) {
    const init = decl.init;
    if (!init || !t.isCallExpression(init)) return;

    const callee = init.callee;
    let calleeName = '';
    if (t.isIdentifier(callee)) {
      calleeName = callee.name;
    } else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
      calleeName = callee.property.name;
    }

    if (SIGNAL_CREATORS.has(calleeName)) {
      const id = decl.id;
      if (t.isIdentifier(id)) {
        signals.push(id.name);
      } else if (t.isArrayPattern(id)) {
        for (const el of id.elements) {
          if (t.isIdentifier(el)) signals.push(el.name);
        }
      } else if (t.isObjectPattern(id)) {
        for (const prop of id.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
            signals.push(prop.value.name);
          }
        }
      }
    }
  }

  function extractFromPattern(param) {
    if (!t.isObjectPattern(param)) return;
    for (const prop of param.properties) {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
        signals.push(prop.value.name);
        props.push(prop.value.name);
      } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
        signals.push(prop.argument.name);
        props.push(prop.argument.name);
      }
    }
  }

  // Check all variable bindings in this scope.
  for (const binding of Object.values(scope.bindings)) {
    if (binding.path.isVariableDeclarator()) {
      extractFromDeclarator(binding.path.node);
    }
  }
  // Scan this scope's own function params (destructured props) ONCE per
  // scope — not once per binding, which would make this O(params × bindings)
  // per scope per JSXElement.
  const fnNode = scope.path && scope.path.node;
  if (fnNode) {
    if (fnNode.params) {
      for (const param of fnNode.params) extractFromPattern(param);
    }
    // deferForwardedChildren moved this pattern out of the parameter list;
    // it is still the same props destructuring and classifies the same way.
    if (fnNode._whatMovedProps) extractFromPattern(fnNode._whatMovedProps);
  }
  return { signals, props };
}

// A `collectSignalNames` wrapper lived here, commented "legacy wrapper for
// backward compat (used in collectSignalNames calls)". Nothing called it;
// every call site uses collectSignalNamesFromScope directly.

// `x.toUpperCase()` and friends, listed in PURE_BUILTIN_METHODS. Only the method
// name is checked: whether the RECEIVER is reactive is decided separately, so
// `user().name.trim()` stays reactive through its object.
function isPureBuiltinMethodCall(expr) {
  return t.isMemberExpression(expr.callee)
    && !expr.callee.computed
    && t.isIdentifier(expr.callee.property)
    && PURE_BUILTIN_METHODS.has(expr.callee.property.name);
}

// Check if a call expression is a safe (non-reactive) global call: the name
// must be the global itself, not a binding of the module that shadows it.
function isSafeGlobalCall(expr, fallbackScope) {
  if (!t.isCallExpression(expr)) return false;
  const callee = expr.callee;
  // Math.max(), Number.parseInt(), etc., or parseInt(), isNaN(), etc.
  const root = t.isMemberExpression(callee) ? callee.object : callee;
  if (!t.isIdentifier(root) || !SAFE_GLOBAL_CALLS.has(root.name)) return false;
  return !bindingOf(root, fallbackScope);
}

// Check if an expression's reactivity is uncertain — e.g., a non-signal function call
// whose arguments happen to contain signal reads. The function itself may not produce
// a reactive result, so the compiler wraps it conservatively.
export function isUncertainReactive(expr, signalNames, importedIds) {
  if (!signalNames) return false;
  if (t.isCallExpression(expr)) {
    // Callee is a known signal — definitely reactive, not uncertain
    if (t.isIdentifier(expr.callee) && isSignalIdentifier(expr.callee.name, signalNames)) {
      return false;
    }
    // Imported identifier called as function — definitely reactive (not uncertain)
    if (importedIds && t.isIdentifier(expr.callee) && importedIds.has(expr.callee.name) &&
        !SAFE_GLOBAL_CALLS.has(expr.callee.name)) {
      return false;
    }
    // Callee is a member of a known signal — definitely reactive
    if (t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.object) &&
        isSignalIdentifier(expr.callee.object.name, signalNames)) {
      return false;
    }
    // Safe global call (Math.max, etc.) with reactive args — still deterministic, not uncertain
    if (isSafeGlobalCall(expr, signalNames.scope)) return false;
    // Unknown function call — if args are reactive, the wrapping is uncertain
    if (expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds))) {
      return true;
    }
  }
  return false;
}

// Check if an expression is potentially reactive (reads a signal)
// importedIds: Set of identifiers imported from other modules — any imported
// function call is conservatively treated as potentially reactive since the
// imported binding could be a signal from another file.
export function isPotentiallyReactive(expr, signalNames, importedIds) {
  if (!signalNames) signalNames = new Set();

  if (t.isCallExpression(expr) || t.isOptionalCallExpression(expr)) {
    // If callee is a known signal identifier being called (signal read), it's reactive
    if (t.isIdentifier(expr.callee) && isSignalIdentifier(expr.callee.name, signalNames)) {
      return true;
    }
    // A selector lookup the auto-selector wrote (see lowerRowSelectors), or a
    // keyed row's read of its item (see readItemThroughAccessor).
    if (expr.callee._whatSelector || expr.callee._whatRowItem) return true;
    // Imported identifier called as a function — conservatively reactive.
    // Handles: import { count } from './store'; ... {count()} in JSX
    if (importedIds && t.isIdentifier(expr.callee) && importedIds.has(expr.callee.name) &&
        !SAFE_GLOBAL_CALLS.has(expr.callee.name)) {
      return true;
    }
    // member.call() — e.g., data(), isLoading()
    if ((t.isMemberExpression(expr.callee) || t.isOptionalMemberExpression(expr.callee)) &&
        t.isIdentifier(expr.callee.object) && isSignalIdentifier(expr.callee.object.name, signalNames)) {
      return true;
    }
    // Any other zero-argument call has the shape of an accessor read, so it
    // is assumed to be one. `props.count()`, a plain parameter `count()` and
    // `s()` from `const s = useThing()` are all opaque to the compiler: it
    // knows only the names it watched being created. Assuming the narrow way
    // round meant those three froze silently while the docs promised
    // `{count()}` was reactive. Assuming this way round costs, when the call
    // turns out to be constant, one effect that runs once and never again.
    if (expr.arguments.length === 0 && !isPureBuiltinMethodCall(expr)) {
      return true;
    }
    if (isPotentiallyReactive(expr.callee, signalNames, importedIds) ||
        expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds))) {
      return true;
    }
    // Everything else the call reaches (see callReads).
    return callReads(expr, signalNames, importedIds);
  }

  if (t.isIdentifier(expr)) {
    return isSignalIdentifier(expr.name, signalNames) ||
           (importedIds && importedIds.has(expr.name));
  }

  // A property read: reactive through its object or its key, and where the
  // module declares the object (an object literal, an instance of a class it
  // declares) and the read may run an accessor of it. A read of a value the
  // compiler did not see built (a prop, a parameter) is a plain read.
  if (t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) {
    return isPotentiallyReactive(expr.object, signalNames, importedIds) ||
           (expr.computed && isPotentiallyReactive(expr.property, signalNames, importedIds)) ||
           mayRunAccessor(expr, signalNames.scope);
  }

  if (t.isConditionalExpression(expr)) {
    return isPotentiallyReactive(expr.test, signalNames, importedIds) ||
           isPotentiallyReactive(expr.consequent, signalNames, importedIds) ||
           isPotentiallyReactive(expr.alternate, signalNames, importedIds);
  }

  if (t.isBinaryExpression(expr) || t.isLogicalExpression(expr)) {
    return isPotentiallyReactive(expr.left, signalNames, importedIds) ||
           isPotentiallyReactive(expr.right, signalNames, importedIds);
  }

  if (t.isUnaryExpression(expr)) {
    return isPotentiallyReactive(expr.argument, signalNames, importedIds);
  }

  if (t.isAssignmentExpression(expr)) {
    return isPotentiallyReactive(expr.right, signalNames, importedIds) ||
           (t.isMemberExpression(expr.left) && (mayRunAccessor(expr.left, signalNames.scope) || (expr.left.computed &&
             isPotentiallyReactive(expr.left.property, signalNames, importedIds))));
  }

  if (t.isSequenceExpression(expr)) {
    return expr.expressions.some(e => isPotentiallyReactive(e, signalNames, importedIds));
  }

  if (t.isTemplateLiteral(expr)) {
    return expr.expressions.some(e => isPotentiallyReactive(e, signalNames, importedIds));
  }

  if (t.isObjectExpression(expr)) {
    return expr.properties.some(prop =>
      t.isObjectProperty(prop) && isPotentiallyReactive(prop.value, signalNames, importedIds)
    );
  }

  if (t.isArrayExpression(expr)) {
    return expr.elements.some(el => el && isPotentiallyReactive(el, signalNames, importedIds));
  }

  if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
    // Function expressions are not reactive themselves — they're callbacks
    return false;
  }

  return false;
}

// --- What a call can read ---
//
// A call is static only when everything its evaluation can reach is proven
// static; anything the compiler cannot prove is assumed to read a signal,
// because a wrong guess that way costs one effect that runs once, and a wrong
// guess the other way freezes the text in silence. The proof is an abstract
// evaluation of the call, its arguments and the bodies of the functions it
// reaches, over what kind of value each expression is:
//
//   P  a primitive: reading it, converting it and its built-in methods run
//      no app code
//   A  an array the code being read built from primitives
//   B  a built-in object it built (new Date(), new Intl.NumberFormat(), a
//      RegExp literal): its methods are the platform's
//   D  an object literal it built of primitives, with no accessor, method or
//      spread: plain data
//   { f }  a function the module declares (its path), proven by reading it
//   { o }  an object literal the module declares and keeps (every use reads
//      a property by name, so none is replaced), whose members it can read
//   { g }  a built-in global the module does not shadow (Math, JSON, String)
//   U  anything else: a parameter's value nobody proved, what an unknown
//      call returned, a class instance, `this` outside a method of a kept
//      object literal
//
// Evaluating reads (marks the evaluation as reading) at every step that may
// run code the compiler did not see: a property read or write on U (a getter
// or setter), converting U to a primitive (valueOf, toString), iterating or
// spreading U, calling U or a method of U, constructing anything but a
// built-in, a global the platform does not define, `await`, `yield`, and
// every syntax form not listed below. A call of a function the module
// declares is an edge of the call graph, to that function read with its
// arguments' kinds (and `this`); an async function or a generator reads, since
// part of its body runs where the caller cannot see. A function's default
// parameters and destructured parameters are read with its body.

/** @typedef {'p' | 'a' | 'b' | 'd' | 'u' | { f: any } | { o: any } | { g: string }} Kind */
const P = 'p';
const A = 'a';
const B = 'b';
const D = 'd';
const U = 'u';

// Constructors of built-in objects whose methods take and give primitives.
const BUILTIN_OBJECTS = new Set(['Date', 'RegExp', 'Intl']);
// Other built-in constructors: they run no app code beyond what they are
// handed (an error's message, a promise's executor).
const BUILTIN_CONSTRUCTORS = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'URL', 'URLSearchParams',
]);

// Methods of a primitive (String.prototype, Number.prototype) beyond the
// two lists above, all the platform's.
const PRIMITIVE_METHODS = new Set([
  ...PURE_BUILTIN_METHODS, ...BUILTIN_METHODS,
  'concat', 'isWellFormed', 'toWellFormed',
]);

// Methods of an array the code built: [primitive, ...].
const ARRAY_METHODS = new Set([
  ...PURE_BUILTIN_METHODS, ...BUILTIN_METHODS,
  'keys', 'values', 'entries', 'fill', 'copyWithin', 'push', 'pop', 'shift', 'unshift', 'splice',
]);
// The array methods that change the array.
const MUTATING = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'fill', 'copyWithin', 'sort', 'reverse']);
// The array methods whose result is an array of the same elements.
const SAME_ELEMENTS = new Set(['slice', 'reverse', 'sort', 'flat', 'concat', 'filter', 'toSorted', 'toReversed', 'toSpliced', 'with', 'fill', 'copyWithin', 'splice']);

// Object.prototype's methods: what an object literal has without declaring.
const OBJECT_METHODS = new Set(['hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf']);

// The bindings, functions and declarators of the module, recorded before any
// JSX is lowered (see resolveCallees): what an identifier names, and where a
// function or a declaration stands.
/** @type {WeakMap<object, any>} */
let references = new WeakMap();
/** @type {WeakMap<object, any>} */
let functionPaths = new WeakMap();
/** @type {WeakMap<object, any>} */
let declaratorPaths = new WeakMap();
// What each call of the module reads, decided before any JSX is lowered.
/** @type {WeakMap<object, boolean>} */
let decided = new WeakMap();

// Whether `call`, at the top of a JSX expression, may read a signal that its
// callee and arguments do not show by their names.
function callReads(call, signalNames, importedIds) {
  const known = decided.get(call);
  if (known !== undefined) return known;
  const ev = evaluation(null, null, U, signalNames.scope, importedIds);
  evalExpr(call, ev);
  return finish(ev);
}

/** Whether an evaluation, or a function it reached, reads. */
function finish(ev) {
  if (ev.reads) return true;
  for (const node of ev.edges) if (readsThrough(node)) return true;
  return false;
}

function evaluation(fn, outer, thisKind, scope, importedIds) {
  return { fn, outer, thisKind, scope, importedIds, env: new Map(), params: new Map(), written: new Map(), reads: false, edges: [] };
}

// Whether the property read `expr` may run an accessor the module declares:
// its object may be an object literal the module declares with a getter or
// setter of that name (or a key it cannot see), or an instance of a class it
// declares, held directly or through other names (see builtValues).
function mayRunAccessor(expr, scope) {
  let root = expr.object;
  while (t.isMemberExpression(root) || t.isOptionalMemberExpression(root)) root = root.object;
  if (!t.isIdentifier(root)) return false;
  const built = builtValues(root, scope);
  if (built.instance) return true;
  if (!built.literal) return false;
  const ev = evaluation(null, null, U, scope, null);
  evalExpr(expr, ev);
  return finish(ev);
}

// What the module built that the name `id` may hold: an object literal
// (`literal`), an instance of a class it declares (`instance`). A value is
// followed through the names it passes through, each a variable's
// initializer and every value assigned to it, and through `a || b`,
// `c ? a : b`, `(x, a)` and `b = a`, on a list of its own (a chain of
// thousands of aliases nests nothing). What a call returns, a parameter and
// a property of another value are values it did not see built.
function builtValues(id, scope) {
  const built = { literal: false, instance: false };
  const pending = [{ node: id, scope }];
  const seen = new Set();
  while (pending.length > 0) {
    const { node, scope: at } = /** @type {{ node: any, scope: any }} */ (pending.pop());
    if (t.isObjectExpression(node)) built.literal = true;
    else if (t.isNewExpression(node)) built.instance = built.instance || !builtinConstructor(node.callee, at);
    else if (t.isLogicalExpression(node)) pending.push({ node: node.left, scope: at }, { node: node.right, scope: at });
    else if (t.isConditionalExpression(node)) pending.push({ node: node.consequent, scope: at }, { node: node.alternate, scope: at });
    else if (t.isSequenceExpression(node)) pending.push({ node: node.expressions[node.expressions.length - 1], scope: at });
    else if (t.isAssignmentExpression(node)) pending.push({ node: node.right, scope: at });
    else if (t.isParenthesizedExpression(node) || t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node)) {
      pending.push({ node: node.expression, scope: at });
    } else if (t.isIdentifier(node)) {
      const binding = bindingOf(node, at);
      if (!binding || seen.has(binding) || !binding.path.isVariableDeclarator() || !t.isIdentifier(binding.path.node.id)) continue;
      seen.add(binding);
      if (binding.path.node.init) pending.push({ node: binding.path.node.init, scope: binding.path.scope });
      for (const write of binding.constantViolations) {
        if (write.isAssignmentExpression() && t.isIdentifier(write.node.left)) pending.push({ node: write.node.right, scope: write.scope });
      }
    }
  }
  return built;
}

function bindingOf(id, scope) {
  const known = references.get(id);
  if (known !== undefined) return known;
  return scope ? scope.getBinding(id.name) || null : null;
}

function keyName(prop) {
  if (t.isIdentifier(prop.key)) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  if (t.isNumericLiteral(prop.key)) return String(prop.key.value);
  return null;
}

function propertyName(member) {
  if (!member.computed) return t.isIdentifier(member.property) ? member.property.name : null;
  if (t.isStringLiteral(member.property)) return member.property.value;
  if (t.isNumericLiteral(member.property)) return String(member.property.value);
  return null;
}

// --- Kinds ---

function same(a, b) {
  return a === b || (typeof a === 'object' && typeof b === 'object' &&
    ((a.f !== undefined && a.f === b.f) || (a.o !== undefined && a.o === b.o) || (a.g !== undefined && a.g === b.g)));
}

function join(a, b) {
  return same(a, b) ? a : U;
}

const ids = new WeakMap();
let nextId = 0;
function idOf(object) {
  let id = ids.get(object);
  if (id === undefined) ids.set(object, id = ++nextId);
  return id;
}

function kindKey(kind) {
  if (typeof kind === 'string') return kind;
  if (kind.f !== undefined) return 'f' + idOf(kind.f.node);
  if (kind.o !== undefined) return 'o' + idOf(kind.o.identifier);
  return 'g' + kind.g;
}

// A value a built-in may convert, read or call without running app code.
function inert(kind) {
  return kind === P || kind === A || kind === B || kind === D || (typeof kind === 'object' && kind.g !== undefined);
}

// --- The kind of what a binding names, from its declaration ---
//
// A declaration's kind depends on the kinds of the bindings its initializer
// names (`const b = a`), so working it out by recursion nests as deep as a
// chain of aliases, and a generated module of thousands overflows the stack.
// Each binding's kind is worked out once instead, on a stack of its own: a
// declaration that names a binding not worked out yet waits under it, and one
// that names a binding already waiting (a cycle, possible only through a
// temporal dead zone) takes U for it.

/** @type {WeakMap<object, Kind>} */
let declaredKinds = new WeakMap();
const waitingKinds = new Set();

/** @returns {Kind} */
function declaredKind(binding) {
  const known = declaredKinds.get(binding);
  if (known !== undefined) return known;
  if (waitingKinds.has(binding)) return U;
  const stack = [binding];
  waitingKinds.add(binding);
  try {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      let next = null;
      const kind = declarationKind(top, (other) => {
        const otherKind = declaredKinds.get(other);
        if (otherKind !== undefined) return otherKind;
        if (next === null && !waitingKinds.has(other)) next = other;
        return U;
      });
      if (next !== null) {
        stack.push(next);
        waitingKinds.add(next);
      } else {
        declaredKinds.set(top, kind);
        stack.pop();
        waitingKinds.delete(top);
      }
    }
  } finally {
    for (const waiting of stack) waitingKinds.delete(waiting);
  }
  return /** @type {Kind} */ (declaredKinds.get(binding));
}

// The kind of `binding` given `lookup`, the kind of each binding its
// declaration names.
/** @returns {Kind} */
function declarationKind(binding, lookup) {
  if (binding.kind === 'module' || binding.kind === 'param') return U;
  const path = binding.path;
  if (!binding.constant) return countedKind(binding, lookup);
  if (path.isFunctionDeclaration()) return { f: path };
  if (!path.isVariableDeclarator() || !t.isIdentifier(path.node.id)) return U;
  const init = path.get('init');
  if (!init.node) return P;
  if (init.isArrowFunctionExpression() || init.isFunctionExpression()) return { f: init };
  if (init.isObjectExpression()) return keepsItself(binding) ? { o: binding } : U;
  const kind = constKind(init.node, init.scope, lookup);
  return kind === A && !keepsElements(binding) ? U : kind;
}

// A variable that is written again (a loop counter, a total) is a primitive
// when it starts as one and every write gives it one by the rules of
// constKind: `i++`, `i = 0`, `n += 2`.
function countedKind(binding, lookup) {
  const path = binding.path;
  if (!path.isVariableDeclarator() || !t.isIdentifier(path.node.id)) return U;
  if (path.node.init && constKind(path.node.init, path.scope, lookup) !== P) return U;
  return binding.constantViolations.every((write) => write.isUpdateExpression() ||
    (write.isAssignmentExpression() && t.isIdentifier(write.node.left) && constKind(write.node.right, write.scope, lookup) === P)) ? P : U;
}

// Whether the array `binding` names keeps the primitives it was declared
// with: every use reads it, iterates it or spreads it, and none changes it.
function keepsElements(binding) {
  return binding.referencePaths.every((ref) => {
    const parent = ref.parentPath;
    if (parent.isForOfStatement({ right: ref.node }) || parent.isSpreadElement()) return true;
    if (!parent.isMemberExpression({ object: ref.node }) || isWritten(parent)) return false;
    const use = parent.parentPath;
    return !(use.isCallExpression({ callee: parent.node }) && MUTATING.has(propertyName(parent.node)));
  });
}

// Whether the member expression at `member` is written, not read: assigned
// (`o.x = v`, `o.x += v`), the target of a destructuring however deep
// (`[o.x] = list`, `({ a: o.x } = v)`, `[...o.x] = list`, `[o.x = 1] = list`),
// the variable of a for-in or for-of loop, updated or deleted.
function isWritten(member) {
  let at = member;
  for (;;) {
    const parent = at.parentPath;
    if (!parent) return false;
    if (parent.isAssignmentExpression() || parent.isForInStatement() || parent.isForOfStatement()) return parent.node.left === at.node;
    if (parent.isUpdateExpression()) return true;
    if (parent.isUnaryExpression({ operator: 'delete' })) return true;
    if (parent.isArrayPattern() || parent.isRestElement() || (parent.isAssignmentPattern() && parent.node.left === at.node)) {
      at = parent;
      continue;
    }
    if (parent.isObjectProperty() && parent.node.value === at.node && parent.parentPath.isObjectPattern()) {
      at = parent.parentPath;
      continue;
    }
    return false;
  }
}

// The kind of a constant's initializer, where it is built of literals,
// operators, built-in objects and other such constants, given `lookup`, the
// kind of each binding it names.
function constKind(node, scope, lookup) {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node) || t.isBigIntLiteral(node)) return P;
  if (t.isTemplateLiteral(node)) return node.expressions.every((e) => constKind(e, scope, lookup) === P) ? P : U;
  if (t.isUnaryExpression(node)) return constKind(node.argument, scope, lookup) === P ? P : U;
  if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
    return constKind(node.left, scope, lookup) === P && constKind(node.right, scope, lookup) === P ? P : U;
  }
  if (t.isConditionalExpression(node)) {
    return [node.test, node.consequent, node.alternate].every((e) => constKind(e, scope, lookup) === P) ? P : U;
  }
  if (t.isArrayExpression(node)) return node.elements.every((e) => e !== null && !t.isSpreadElement(e) && constKind(e, scope, lookup) === P) ? A : U;
  if (t.isRegExpLiteral(node)) return B;
  if (t.isNewExpression(node) && builtinConstructor(node.callee, scope) && node.arguments.every((e) => !t.isSpreadElement(e) && constKind(e, scope, lookup) === P)) return B;
  if (t.isCallExpression(node)) return builtArrayKind(node, scope, lookup);
  if (t.isIdentifier(node)) {
    if (node.name === 'undefined' || node.name === 'NaN' || node.name === 'Infinity') return bindingOf(node, scope) ? U : P;
    const binding = bindingOf(node, scope);
    return binding ? lookup(binding) : U;
  }
  return U;
}

// `Array.of(...)` of primitives, and `Array.from(x)` of a primitive array, a
// string or `{ length }`, mapped by nothing or by a function expression whose
// returned expression is a primitive built of its parameters by constKind's
// rules (`(_, i) => i * 2`): an array of primitives.
function builtArrayKind(node, scope, lookup) {
  const callee = node.callee;
  if (!t.isMemberExpression(callee) || callee.computed || !t.isIdentifier(callee.object, { name: 'Array' }) ||
      bindingOf(callee.object, scope) || node.arguments.some((e) => t.isSpreadElement(e))) return U;
  const method = callee.property.name;
  if (method === 'of') return node.arguments.every((e) => constKind(e, scope, lookup) === P) ? A : U;
  if (method !== 'from' || node.arguments.length === 0 || node.arguments.length > 2) return U;
  const [source, mapper] = node.arguments;
  const sized = t.isObjectExpression(source) && source.properties.length === 1 && t.isObjectProperty(source.properties[0]) &&
    !source.properties[0].computed && keyName(source.properties[0]) === 'length' && constKind(source.properties[0].value, scope, lookup) === P;
  if (!sized) {
    const kind = constKind(source, scope, lookup);
    if (kind !== A && kind !== P) return U;
  }
  if (mapper === undefined) return A;
  if (!t.isArrowFunctionExpression(mapper) || mapper.async || t.isBlockStatement(mapper.body) || !mapper.params.every((p) => t.isIdentifier(p))) return U;
  const path = functionPaths.get(mapper);
  if (!path) return U;
  const own = (binding) => (binding.kind === 'param' && binding.scope === path.scope ? P : lookup(binding));
  return constKind(mapper.body, path.scope, own) === P ? A : U;
}

function builtinConstructor(callee, scope) {
  let root = callee;
  if (t.isMemberExpression(root) && !root.computed) root = root.object;
  return t.isIdentifier(root) && BUILTIN_OBJECTS.has(root.name) && !bindingOf(root, scope);
}

// Whether the object literal `binding` is declared with keeps the members it
// was declared with: every use reads one of its properties by name (none is
// replaced, deleted, or handed to code that could), and each of its methods
// uses `this` only to read or call a property by name.
const kept = new WeakMap();
function keepsItself(binding) {
  let answer = kept.get(binding);
  if (answer !== undefined) return answer;
  answer = binding.referencePaths.every((ref) => {
    const parent = ref.parentPath;
    return parent && parent.isMemberExpression({ object: ref.node }) && !parent.node.computed && !isWritten(parent);
  }) && binding.path.get('init.properties').every((prop) => {
    const fn = prop.isObjectMethod() ? prop : prop.isObjectProperty() && prop.get('value').isFunctionExpression() ? prop.get('value') : null;
    return fn === null || thisStaysPut(fn);
  });
  kept.set(binding, answer);
  return answer;
}

function thisStaysPut(fn) {
  let ok = true;
  fn.traverse({
    ThisExpression(path) {
      const parent = path.parentPath;
      if (!parent.isMemberExpression({ object: path.node }) || parent.node.computed || isWritten(parent)) ok = false;
    },
    Function(path) {
      if (!path.isArrowFunctionExpression()) path.skip();
    },
  });
  return ok;
}

// What reading member `name` of the kept object literal `binding` finds:
// { value } for a property or a method (the path of its value), { get } or
// { set } for an accessor, null when a spread or a computed key may give it
// another, and { inherited } when the literal declares no such member.
function memberOf(binding, name, write) {
  /** @type {any} */
  let found = { inherited: true };
  for (const prop of binding.path.get('init.properties')) {
    if (prop.isSpreadElement() || prop.node.computed) {
      found = null;
      continue;
    }
    if (keyName(prop.node) !== name) continue;
    if (prop.isObjectMethod()) {
      if (prop.node.kind === 'method') found = { value: prop };
      else if ((prop.node.kind === 'set') === write) found = prop.node.kind === 'set' ? { set: prop } : { get: prop };
    } else {
      found = { value: prop.get('value') };
    }
  }
  return found;
}

// --- Evaluation ---

/** @returns {Kind} */
function evalExpr(e, ev) {
  if (e == null) return P;
  switch (e.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': case 'NullLiteral': case 'BigIntLiteral':
      return P;
    case 'RegExpLiteral':
      return B;
    case 'TemplateLiteral':
      for (const x of e.expressions) convert(evalExpr(x, ev), ev);
      return P;
    case 'Identifier':
      return identKind(e, ev);
    case 'ThisExpression':
      return ev.thisKind;
    case 'ParenthesizedExpression': case 'TSAsExpression': case 'TSSatisfiesExpression': case 'TSNonNullExpression': case 'TypeCastExpression': case 'TSTypeAssertion':
      return evalExpr(e.expression, ev);
    case 'SequenceExpression': {
      /** @type {Kind} */
      let kind = P;
      for (const x of e.expressions) kind = evalExpr(x, ev);
      return kind;
    }
    case 'ArrayExpression': {
      let primitives = true;
      for (const x of e.elements) {
        if (x === null) continue;
        if (t.isSpreadElement(x)) {
          iterate(evalExpr(x.argument, ev), ev);
          primitives = false;
        } else if (evalExpr(x, ev) !== P) {
          primitives = false;
        }
      }
      return primitives ? A : U;
    }
    case 'ObjectExpression': {
      let data = true;
      for (const prop of e.properties) {
        if (t.isSpreadElement(prop)) {
          spread(evalExpr(prop.argument, ev), ev);
          data = false;
        } else {
          if (prop.computed) convert(evalExpr(prop.key, ev), ev);
          if (!t.isObjectProperty(prop) || evalExpr(prop.value, ev) !== P) data = false;
        }
      }
      return data ? D : U;
    }
    case 'ArrowFunctionExpression': case 'FunctionExpression': {
      const path = functionPaths.get(e);
      return path ? { f: path } : U;
    }
    case 'UnaryExpression': {
      const kind = evalExpr(e.argument, ev);
      if (e.operator === '-' || e.operator === '+' || e.operator === '~') convert(kind, ev);
      return P;
    }
    case 'BinaryExpression': {
      const left = t.isPrivateName(e.left) ? P : evalExpr(e.left, ev);
      const right = evalExpr(e.right, ev);
      if (e.operator === '===' || e.operator === '!==') return P;
      if (e.operator === 'in') {
        if (right === U) ev.reads = true;
      } else if (e.operator === 'instanceof') {
        if (typeof right !== 'object' || /** @type {any} */ (right).g === undefined) ev.reads = true;
      } else {
        convert(left, ev);
        convert(right, ev);
      }
      return P;
    }
    case 'LogicalExpression':
      return join(evalExpr(e.left, ev), evalExpr(e.right, ev));
    case 'ConditionalExpression':
      evalExpr(e.test, ev);
      return join(evalExpr(e.consequent, ev), evalExpr(e.alternate, ev));
    case 'AssignmentExpression':
      return assign(e, ev);
    case 'UpdateExpression':
      if (t.isIdentifier(e.argument)) convert(evalExpr(e.argument, ev), ev);
      else if (t.isMemberExpression(e.argument)) {
        convert(memberRead(e.argument, ev), ev);
        write(memberObject(e.argument, ev), ev);
      } else ev.reads = true;
      return P;
    case 'MemberExpression': case 'OptionalMemberExpression':
      return memberRead(e, ev);
    case 'CallExpression': case 'OptionalCallExpression':
      return call(e, ev);
    case 'NewExpression':
      return construct(e, ev);
    case 'TaggedTemplateExpression': {
      const args = [A, ...e.quasi.expressions.map((x) => evalExpr(x, ev))];
      if (t.isMemberExpression(e.tag)) return methodCall(evalExpr(e.tag.object, ev), propertyName(e.tag), args, ev);
      return callValue(evalExpr(e.tag, ev), args, U, ev);
    }
    // JSX the body builds tracks its own holes once it is lowered.
    case 'JSXElement': case 'JSXFragment':
      return U;
    default:
      ev.reads = true;
      return U;
  }
}

/** @returns {Kind} */
function identKind(id, ev) {
  const binding = bindingOf(id, ev.scope);
  if (binding === null) {
    if (id.name === 'undefined' || id.name === 'NaN' || id.name === 'Infinity') return P;
    if (SAFE_GLOBAL_CALLS.has(id.name) || BUILTIN_OBJECTS.has(id.name)) return { g: id.name };
    // A global the platform does not define may be a getter of globalThis.
    ev.reads = true;
    return U;
  }
  for (let at = ev; at !== null; at = at.outer) {
    const kind = at.env.get(binding);
    if (kind !== undefined) return kind;
  }
  if (!binding.constant) {
    const around = binding.scope.getFunctionParent();
    for (let at = ev; at !== null; at = at.outer) {
      if (around !== null && at.fn !== null && at.fn.node === around.block) return writtenKind(binding, at);
    }
  }
  return declaredKind(binding);
}

// The kind of a variable of the function `ev` reads that is written again:
// what it starts with (its initializer, or the value of its parameter) joined
// with every value written to it, each of a kind that may depend on the
// variable's own (taken to be what it starts with while it is worked out: a
// variable only ever given primitives is a primitive). A write the join
// cannot see (a destructuring, a loop's left side) makes it U. A variable
// written from one that is itself written again nests the work, so past
// WRITTEN_DEPTH such variables the rest are U and the evaluation reads:
// handwritten code nests a few, a generated chain of thousands would
// overflow the stack.
const WRITTEN_DEPTH = 200;
let writtenDepth = 0;
function writtenKind(binding, ev) {
  if (ev.written.has(binding)) return ev.written.get(binding);
  if (writtenDepth >= WRITTEN_DEPTH) {
    ev.reads = true;
    return U;
  }
  writtenDepth++;
  try {
    return writtenKindOf(binding, ev);
  } finally {
    writtenDepth--;
  }
}

function writtenKindOf(binding, ev) {
  const path = binding.path;
  /** @type {Kind} */
  let kind = U;
  if (binding.kind === 'param') kind = ev.params.get(binding) ?? U;
  else if (path.isVariableDeclarator() && t.isIdentifier(path.node.id)) kind = path.node.init ? kindOf(path.node.init, ev) : P;
  ev.written.set(binding, kind);
  for (const write of binding.constantViolations) {
    if (write.isUpdateExpression()) continue;
    if (!write.isAssignmentExpression() || !t.isIdentifier(write.node.left)) {
      kind = U;
      break;
    }
    const op = write.node.operator;
    kind = join(kind, op === '=' || op === '||=' || op === '&&=' || op === '??=' ? kindOf(write.node.right, ev) : P);
    ev.written.set(binding, kind);
  }
  ev.written.set(binding, kind);
  return kind;
}

// The kind of `expr`, without what evaluating it reads: the evaluation reads
// it where it stands.
function kindOf(expr, ev) {
  return evalExpr(expr, { ...ev, reads: false, edges: [] });
}

// Converting a value to a primitive runs its valueOf or toString.
function convert(kind, ev) {
  if (kind === U) ev.reads = true;
  else if (typeof kind === 'object' && kind.o !== undefined) {
    for (const name of ['valueOf', 'toString']) {
      const member = memberOf(kind.o, name, false);
      if (member === null || member.inherited !== true) ev.reads = true;
    }
  }
}

function iterate(kind, ev) {
  if (kind !== P && kind !== A && kind !== D) ev.reads = true;
}

// Spreading an object runs its getters.
function spread(kind, ev) {
  if (kind === U) ev.reads = true;
  else if (typeof kind === 'object' && kind.o !== undefined) {
    if (kind.o.path.node.init.properties.some((prop) => t.isSpreadElement(prop) || prop.computed || (t.isObjectMethod(prop) && prop.kind !== 'method'))) ev.reads = true;
  }
}

// Writing a property of a value of `kind` runs its setter.
function write(kind, ev) {
  if (kind === U || (typeof kind === 'object' && kind.o !== undefined)) ev.reads = true;
}

function memberObject(member, ev) {
  if (t.isSuper(member.object)) {
    ev.reads = true;
    return U;
  }
  const kind = evalExpr(member.object, ev);
  if (member.computed) convert(evalExpr(member.property, ev), ev);
  return kind;
}

/** @returns {Kind} */
function memberRead(member, ev) {
  const object = memberObject(member, ev);
  return readMember(object, propertyName(member), ev);
}

/** @returns {Kind} */
function readMember(object, name, ev) {
  if (object === P || object === A || object === B || object === D) return P;
  if (typeof object === 'object') {
    if (object.g !== undefined || object.f !== undefined) return P;
    const member = name === null ? null : memberOf(object.o, name, false);
    if (member === null) {
      ev.reads = true;
      return U;
    }
    if (member.inherited === true) return P;
    if (member.get !== undefined) {
      edge(member.get, [], object, ev);
      return U;
    }
    const value = member.value;
    if (value.isObjectMethod() || value.isFunctionExpression() || value.isArrowFunctionExpression()) return { f: value };
    if (value.isIdentifier()) {
      const binding = bindingOf(value.node, value.scope);
      return binding ? declaredKind(binding) : U;
    }
    return constKind(value.node, value.scope, declaredKind);
  }
  ev.reads = true;
  return U;
}

function assign(e, ev) {
  const value = evalExpr(e.right, ev);
  const target = e.left;
  if (t.isIdentifier(target)) {
    if (e.operator !== '=') {
      const current = evalExpr(target, ev);
      if (e.operator !== '||=' && e.operator !== '&&=' && e.operator !== '??=') {
        convert(current, ev);
        convert(value, ev);
      }
    }
    return value;
  }
  if (t.isMemberExpression(target)) {
    if (e.operator !== '=') {
      const current = memberRead(target, ev);
      if (e.operator !== '||=' && e.operator !== '&&=' && e.operator !== '??=') {
        convert(current, ev);
        convert(value, ev);
      }
    }
    write(memberObject(target, ev), ev);
    return value;
  }
  destructure(target, value, ev);
  return value;
}

// A destructuring target (a declaration, a parameter, an assignment) given a
// value of `kind`: its defaults are evaluated, and taking its parts reads
// properties of the value or iterates it.
function destructure(pattern, kind, ev) {
  if (t.isIdentifier(pattern)) {
    const binding = bindingOf(pattern, ev.scope) || (ev.fn ? ev.fn.scope.getBinding(pattern.name) : null);
    if (binding && binding.constant) ev.env.set(binding, kind);
    else if (binding && binding.kind === 'param') ev.params.set(binding, kind);
    return;
  }
  if (t.isAssignmentPattern(pattern)) {
    destructure(pattern.left, join(kind, evalExpr(pattern.right, ev)), ev);
    return;
  }
  if (t.isArrayPattern(pattern)) {
    iterate(kind, ev);
    for (const element of pattern.elements) if (element) destructure(element, kind === A || kind === P ? P : U, ev);
    return;
  }
  if (t.isObjectPattern(pattern)) {
    for (const prop of pattern.properties) {
      if (t.isRestElement(prop)) {
        spread(kind, ev);
        destructure(prop.argument, U, ev);
      } else {
        if (prop.computed) convert(evalExpr(prop.key, ev), ev);
        destructure(prop.value, readMember(kind, prop.computed ? null : keyName(prop), ev), ev);
      }
    }
    return;
  }
  if (t.isRestElement(pattern)) {
    destructure(pattern.argument, U, ev);
    return;
  }
  if (t.isMemberExpression(pattern)) {
    write(memberObject(pattern, ev), ev);
    return;
  }
  ev.reads = true;
}

function args(call, ev) {
  const kinds = [];
  for (const arg of call.arguments) {
    if (t.isSpreadElement(arg)) {
      iterate(evalExpr(arg.argument, ev), ev);
      kinds.push(U);
    } else {
      kinds.push(evalExpr(arg, ev));
    }
  }
  return kinds;
}

/** @returns {Kind} */
function call(e, ev) {
  const callee = e.callee;
  if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) {
    const receiver = memberObject(callee, ev);
    return methodCall(receiver, propertyName(callee), args(e, ev), ev);
  }
  if (t.isIdentifier(callee)) {
    const binding = bindingOf(callee, ev.scope);
    if (binding && binding.kind === 'module') {
      const argKinds = args(e, ev);
      // An import from What or from the app itself is as reactive as its
      // source; a package's utility reads nothing of the app's, except
      // through what it is handed: a function it may call, or a value whose
      // conversion or getters are the app's.
      if (ev.importedIds && ev.importedIds.has(callee.name)) ev.reads = true;
      else handOver(argKinds, ev);
      return U;
    }
  }
  const fn = evalExpr(callee, ev);
  return callValue(fn, args(e, ev), U, ev);
}

// Values handed to code that may convert, read or call them: a function it
// may call with anything.
function handOver(argKinds, ev) {
  for (const kind of argKinds) {
    if (typeof kind === 'object' && kind.f !== undefined) edge(kind.f, kind.f.node.params.map(() => U), U, ev);
    else if (!inert(kind)) ev.reads = true;
  }
}

/** @returns {Kind} */
function callValue(fn, argKinds, thisKind, ev) {
  if (typeof fn === 'object' && fn.f !== undefined) {
    edge(fn.f, argKinds, thisKind, ev);
    return U;
  }
  if (typeof fn === 'object' && fn.g !== undefined && SAFE_GLOBAL_CALLS.has(fn.g)) {
    handOver(argKinds, ev);
    return P;
  }
  ev.reads = true;
  return U;
}

/** @returns {Kind} */
function methodCall(receiver, name, argKinds, ev) {
  if (receiver === P) {
    if (name === null || !PRIMITIVE_METHODS.has(name)) ev.reads = true;
    handOver(argKinds, ev);
    return name === 'split' || name === 'match' ? A : P;
  }
  if (receiver === A) {
    if (name === null || !ARRAY_METHODS.has(name)) ev.reads = true;
    // A callback is given the array's elements (primitives), their indexes
    // and the array (reduce: what the last call returned, first).
    for (const kind of argKinds) {
      if (typeof kind === 'object' && kind.f !== undefined) edge(kind.f, name === 'reduce' || name === 'reduceRight' ? [U, P, P, A] : [P, P, A], U, ev);
      else if (!inert(kind)) ev.reads = true;
    }
    if (name === 'join' || name === 'toString' || name === 'indexOf' || name === 'lastIndexOf' || name === 'includes' ||
        name === 'some' || name === 'every' || name === 'find' || name === 'findLast' || name === 'at' || name === 'findIndex' || name === 'findLastIndex') return P;
    return name !== null && SAME_ELEMENTS.has(name) ? A : U;
  }
  if (receiver === B) {
    handOver(argKinds, ev);
    return P;
  }
  if (receiver === D) {
    if (name === null || !OBJECT_METHODS.has(name)) ev.reads = true;
    handOver(argKinds, ev);
    return P;
  }
  if (typeof receiver === 'object') {
    if (receiver.g !== undefined) {
      // Math.max(), JSON.stringify(row), Number.parseFloat(), console.log().
      handOver(argKinds, ev);
      return receiver.g === 'Math' || receiver.g === 'Number' || receiver.g === 'String' || receiver.g === 'JSON' || receiver.g === 'Date' ? P : U;
    }
    if (receiver.f !== undefined) {
      if (name === 'call') return callValue(receiver, argKinds.slice(1), argKinds[0] ?? P, ev);
      if (name === 'apply') return callValue(receiver, argKinds[1] === A || argKinds[1] === undefined ? [P, P, P] : [U, U, U], argKinds[0] ?? P, ev);
      if (name !== 'bind') ev.reads = true;
      handOver(argKinds, ev);
      return U;
    }
    const member = name === null ? null : memberOf(receiver.o, name, false);
    if (member === null) {
      ev.reads = true;
      return U;
    }
    if (member.inherited === true) {
      if (!OBJECT_METHODS.has(/** @type {string} */ (name))) ev.reads = true;
      handOver(argKinds, ev);
      return P;
    }
    if (member.get !== undefined) {
      edge(member.get, [], receiver, ev);
      ev.reads = true;
      return U;
    }
    const value = member.value;
    // A method has the object as `this`; an arrow function its module's.
    const fn = readMember(receiver, name, ev);
    return callValue(fn, argKinds, value.isArrowFunctionExpression() ? U : receiver, ev);
  }
  ev.reads = true;
  return U;
}

/** @returns {Kind} */
function construct(e, ev) {
  const argKinds = args(e, ev);
  if (builtinConstructor(e.callee, ev.scope)) {
    handOver(argKinds, ev);
    return B;
  }
  if (t.isIdentifier(e.callee) && !bindingOf(e.callee, ev.scope) && (SAFE_GLOBAL_CALLS.has(e.callee.name) || BUILTIN_CONSTRUCTORS.has(e.callee.name))) {
    handOver(argKinds, ev);
    return U;
  }
  // A constructor the app declares runs its own code: a class instance is
  // never proven static.
  ev.reads = true;
  return U;
}

// A call of the function at `path` with arguments of `argKinds` and `this`
// of `thisKind`: an edge of the call graph from the evaluation. A function
// written inside the one being read sees that one's bindings.
function edge(path, argKinds, thisKind, ev) {
  const node = path.node;
  if (node.async || node.generator) {
    ev.reads = true;
    return;
  }
  const around = path.parentPath && path.parentPath.getFunctionParent();
  let outer = null;
  for (let at = ev; at !== null; at = at.outer) {
    if (around && at.fn !== null && at.fn.node === around.node) {
      outer = at;
      break;
    }
  }
  ev.edges.push(graphNode(path, argKinds, thisKind, outer, ev.importedIds));
}

// --- The call graph ---
//
// A node per function, per kinds of its arguments and `this`, and per
// evaluation it is a closure of. Its edges are the calls of declared
// functions its body makes; `direct` says whether its body reads by itself.
// A node reads when it reads directly or reaches one that does.
const graphNodes = new WeakMap();

function graphNode(path, argKinds, thisKind, outer, importedIds) {
  let byKey = graphNodes.get(path.node);
  if (!byKey) graphNodes.set(path.node, byKey = new Map());
  const key = argKinds.map(kindKey).join() + '|' + kindKey(thisKind) + '|' + (outer === null ? '' : idOf(outer));
  let node = byKey.get(key);
  if (!node) byKey.set(key, node = { path, argKinds, thisKind, outer, importedIds, edges: null, direct: false, reads: undefined });
  return node;
}

// Read a node's function once: whether it reads, and which declared
// functions it calls.
function expand(node) {
  const path = node.path;
  const ev = evaluation(path, node.outer, node.thisKind, path.scope, node.importedIds);
  // The values a parameter was not given are undefined.
  path.node.params.forEach((param, i) => destructure(param, node.argKinds[i] ?? P, ev));
  if (path.node._whatMovedProps) destructure(path.node._whatMovedProps, node.argKinds[0] ?? P, ev);
  const body = path.node.body;
  if (t.isBlockStatement(body)) evalStmt(body, ev);
  else evalExpr(body, ev);
  node.direct = ev.reads;
  node.edges = ev.edges;
}

function evalStmt(s, ev) {
  switch (s.type) {
    case 'BlockStatement':
      for (const x of s.body) evalStmt(x, ev);
      return;
    case 'ExpressionStatement':
      evalExpr(s.expression, ev);
      return;
    case 'ReturnStatement': case 'ThrowStatement':
      evalExpr(s.argument, ev);
      return;
    case 'VariableDeclaration':
      for (const d of s.declarations) {
        const kind = evalExpr(d.init, ev);
        // The declared names resolve from the declaration's own block.
        const scope = ev.scope;
        ev.scope = declaratorPaths.get(d)?.scope ?? scope;
        destructure(d.id, d.init == null ? P : kind, ev);
        ev.scope = scope;
      }
      return;
    case 'IfStatement':
      evalExpr(s.test, ev);
      evalStmt(s.consequent, ev);
      if (s.alternate) evalStmt(s.alternate, ev);
      return;
    case 'ForStatement':
      if (s.init) {
        if (t.isVariableDeclaration(s.init)) evalStmt(s.init, ev);
        else evalExpr(s.init, ev);
      }
      evalExpr(s.test, ev);
      evalExpr(s.update, ev);
      evalStmt(s.body, ev);
      return;
    case 'ForOfStatement': {
      const kind = evalExpr(s.right, ev);
      iterate(kind, ev);
      if (s.await) ev.reads = true;
      const target = t.isVariableDeclaration(s.left) ? s.left.declarations[0].id : s.left;
      destructure(target, kind === A || kind === P ? P : U, ev);
      evalStmt(s.body, ev);
      return;
    }
    case 'ForInStatement': {
      if (evalExpr(s.right, ev) === U) ev.reads = true;
      const target = t.isVariableDeclaration(s.left) ? s.left.declarations[0].id : s.left;
      destructure(target, P, ev);
      evalStmt(s.body, ev);
      return;
    }
    case 'WhileStatement': case 'DoWhileStatement':
      evalExpr(s.test, ev);
      evalStmt(s.body, ev);
      return;
    case 'SwitchStatement':
      evalExpr(s.discriminant, ev);
      for (const c of s.cases) {
        if (c.test) evalExpr(c.test, ev);
        for (const x of c.consequent) evalStmt(x, ev);
      }
      return;
    case 'TryStatement':
      evalStmt(s.block, ev);
      if (s.handler) {
        if (s.handler.param) destructure(s.handler.param, U, ev);
        evalStmt(s.handler.body, ev);
      }
      if (s.finalizer) evalStmt(s.finalizer, ev);
      return;
    case 'LabeledStatement':
      evalStmt(s.body, ev);
      return;
    case 'FunctionDeclaration': case 'EmptyStatement': case 'BreakStatement': case 'ContinueStatement': case 'DebuggerStatement':
      return;
    default:
      ev.reads = true;
  }
}

// Whether `start` reads, by a depth-first walk of the graph on a stack of its
// own: a chain of thousands of helpers cannot overflow the JavaScript stack,
// and a cycle is decided only once all of it has been seen. Reaching a reader
// makes every node on the path to it a reader; exhausting the walk proves
// every node it saw static, since each reaches only what the start reaches.
function readsThrough(start) {
  if (start.reads !== undefined) return start.reads;
  const stack = [start];
  const nextEdge = [0];
  const seen = new Set(stack);
  const found = () => {
    for (const node of stack) node.reads = true;
    return true;
  };
  while (stack.length > 0) {
    const top = stack.length - 1;
    const node = stack[top];
    if (node.edges === null) expand(node);
    if (node.direct) return found();
    if (nextEdge[top] === node.edges.length) {
      stack.pop();
      nextEdge.pop();
      continue;
    }
    const edgeNode = node.edges[nextEdge[top]++];
    if (edgeNode.reads === true) return found();
    if (edgeNode.reads === false || seen.has(edgeNode)) continue;
    seen.add(edgeNode);
    stack.push(edgeNode);
    nextEdge.push(0);
  }
  for (const node of seen) node.reads = false;
  return false;
}

// Every call of the module, read before any JSX is lowered (see the plugin's
// Program visitor), so that a function's body is read as its author wrote it
// whether it comes before or after the JSX that calls it. What every
// identifier names, and where each function and declaration stands, is
// recorded first, so the bodies read see each of them.
export function resolveCallees(program, callPaths, importedIds) {
  references = new WeakMap();
  functionPaths = new WeakMap();
  declaratorPaths = new WeakMap();
  decided = new WeakMap();
  declaredKinds = new WeakMap();
  program.traverse({
    ReferencedIdentifier(path) {
      if (path.isIdentifier()) references.set(path.node, path.scope.getBinding(path.node.name) || null);
    },
    Function(path) {
      functionPaths.set(path.node, path);
    },
    VariableDeclarator(path) {
      declaratorPaths.set(path.node, path);
    },
  });
  scopeNamesCache = new WeakMap();
  try {
    for (const callPath of callPaths) {
      const ev = evaluation(null, null, U, callPath.scope, importedIds);
      evalExpr(callPath.node, ev);
      decided.set(callPath.node, finish(ev));
    }
  } finally {
    scopeNamesCache = null;
  }
}

// Each scope's own signal names, kept while resolveCallees reads the module,
// before any JSX is lowered (lowering rewrites a row callback's parameters):
// a module of thousands of functions reads its top-level bindings once, not
// once per function.
/** @type {WeakMap<object, { signals: string[], props: string[] }> | null} */
let scopeNamesCache = null;

// A `when` prop's shape determines how the condition is formed:
//   - call expression          → use as-is              when={cond()}
//   - arrow w/ expression body → use the body           when={() => x > 5}
//   - a proven local signal    → invoke it: isOpen()    when={isOpen}
//   - an import or a destructured prop, bare or as the root of a plain
//     member chain                                      when={FLAG}, when={ns.open}
//                              → resolve it at runtime, exactly as the Show
//                                and Match components do for h():
//                                typeof X === 'function' ? X() : X
//                                Either one can hold a boolean or an accessor
//                                and only the runtime knows which. Calling it
//                                unconditionally threw on a boolean.
//   - anything else (member, literal, logical, etc.)    when={user.isAdmin}
//                              → use the raw expression. Do NOT invoke it:
//                                non-functions would throw at runtime.
export function buildWhenCondition(whenExpr, state) {
  if (t.isCallExpression(whenExpr)) return whenExpr;
  if (t.isArrowFunctionExpression(whenExpr) && t.isExpression(whenExpr.body)) return whenExpr.body;
  const fromProps = state.signalNames && state.signalNames.fromDestructuredProps;
  const isUnprovenBinding = name =>
    (fromProps && fromProps.has(name)) ||
    (state.importedIdentifiers && state.importedIdentifiers.has(name));
  if (t.isIdentifier(whenExpr)) {
    if (isUnprovenBinding(whenExpr.name)) return resolveAccessorAtRuntime(whenExpr);
    if (state.signalNames && isSignalIdentifier(whenExpr.name, state.signalNames)) {
      return t.callExpression(whenExpr, []);
    }
    return whenExpr;
  }
  const root = plainMemberChainRoot(whenExpr);
  if (root && isUnprovenBinding(root.name)) return resolveAccessorAtRuntime(whenExpr);
  return whenExpr;
}

// A reactive `each` becomes the list's accessor (see the <For> lowering), and
// the value it evaluates to may be an accessor itself, as a plain `each` name
// may: each={archived() ? done : open} picks one of two signals. Each name or
// plain member chain the value can come from is read the way mapArray reads a
// plain `each`; a proven local signal is called.
export function buildEachValue(expr, state) {
  if (t.isConditionalExpression(expr)) {
    return t.conditionalExpression(expr.test, buildEachValue(expr.consequent, state), buildEachValue(expr.alternate, state));
  }
  if (t.isLogicalExpression(expr)) {
    return t.logicalExpression(expr.operator, buildEachValue(expr.left, state), buildEachValue(expr.right, state));
  }
  if (t.isIdentifier(expr)) {
    if (expr.name === 'undefined') return expr;
    const fromProps = state.signalNames && state.signalNames.fromDestructuredProps;
    const proven = state.signalNames && isSignalIdentifier(expr.name, state.signalNames) &&
      !(fromProps && fromProps.has(expr.name)) &&
      !(state.importedIdentifiers && state.importedIdentifiers.has(expr.name));
    return proven ? t.callExpression(expr, []) : resolveAccessorAtRuntime(expr);
  }
  return plainMemberChainRoot(expr) ? resolveAccessorAtRuntime(expr) : expr;
}

// The root identifier of `a.b.c` with no computed keys, else null. Reading
// such a chain twice is a pure lookup, so the runtime check below may
// evaluate it more than once.
function plainMemberChainRoot(expr) {
  if (!t.isMemberExpression(expr)) return null;
  let node = expr;
  while (t.isMemberExpression(node)) {
    if (node.computed || !t.isIdentifier(node.property)) return null;
    node = node.object;
  }
  return t.isIdentifier(node) ? node : null;
}

function resolveAccessorAtRuntime(ref) {
  return t.conditionalExpression(
    t.binaryExpression('===', t.unaryExpression('typeof', ref), t.stringLiteral('function')),
    t.callExpression(t.cloneNode(ref), []),
    t.cloneNode(ref)
  );
}

