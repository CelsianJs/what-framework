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
  // scope — not once per binding. The old per-binding rescan made this
  // O(params × bindings) per scope per JSXElement. (AUDIT-2026-06-06 H2)
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
  const scope = scopeOf(expr, fallbackScope);
  return !scope || !scope.getBinding(root.name);
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

  if (t.isCallExpression(expr)) {
    // If callee is a known signal identifier being called (signal read), it's reactive
    if (t.isIdentifier(expr.callee) && isSignalIdentifier(expr.callee.name, signalNames)) {
      return true;
    }
    // A selector lookup the auto-selector wrote (see lowerRowSelectors), or a
    // keyed row's read of its item (see readItemThroughAccessor).
    if (expr.callee._whatSelector || expr.callee._whatRowItem) return true;
    // Imported identifier called as a function — conservatively reactive.
    // Handles: import { count } from './store'; ... {count()} in JSX
    if (importedIds && t.isIdentifier(expr.callee) && importedIds.has(expr.callee.name)) {
      // Exclude known safe globals that happen to also be imported
      if (!SAFE_GLOBAL_CALLS.has(expr.callee.name)) {
        return true;
      }
    }
    // member.call() — e.g., data(), isLoading()
    if (t.isMemberExpression(expr.callee)) {
      // Check if the object is a signal
      if (t.isIdentifier(expr.callee.object) && isSignalIdentifier(expr.callee.object.name, signalNames)) {
        return true;
      }
    }
    // Safe global calls like Math.max — only reactive if their args are
    if (isSafeGlobalCall(expr, signalNames.scope)) {
      return expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds));
    }
    // A function argument the call may run at once reads for the call:
    // isPending(() => users()), a formatter handed a getter.
    if (expr.arguments.some(arg => readsInCallback(arg, signalNames, importedIds))) {
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
    if (callReadsInside(expr, signalNames, importedIds)) return true;

    // Unknown call — check if callee or args contain signal reads
    if (t.isIdentifier(expr.callee)) {
      // Could be a function that reads signals internally
      // Be conservative: if it's not a known safe call and not a signal, still check args
      return expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds));
    }
    // For any other call expression, check recursively
    return isPotentiallyReactive(expr.callee, signalNames, importedIds) ||
           expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds));
  }

  // Optional chaining reads like the plain chain: a()?.b and a()?.[k]
  // through their object, f?.() as a call.
  if (t.isOptionalCallExpression(expr)) {
    if (expr.arguments.length === 0) return true;
    return callReadsInside(expr, signalNames, importedIds) ||
           isPotentiallyReactive(expr.callee, signalNames, importedIds) ||
           expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds) ||
             readsInCallback(arg, signalNames, importedIds));
  }

  if (t.isIdentifier(expr)) {
    return isSignalIdentifier(expr.name, signalNames) ||
           (importedIds && importedIds.has(expr.name));
  }

  if (t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) {
    return isPotentiallyReactive(expr.object, signalNames, importedIds) ||
           (expr.computed && isPotentiallyReactive(expr.property, signalNames, importedIds));
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
           (t.isMemberExpression(expr.left) && expr.left.computed &&
             isPotentiallyReactive(expr.left.property, signalNames, importedIds));
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

// Whether `fn`, a function handed to a call, reads reactively when the call
// runs it: anything its body evaluates, nested functions aside (they run when
// something calls them). `() => { const text = label(); return text; }` reads
// as much as `() => label()`.
function readsInCallback(fn, signalNames, importedIds) {
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) return false;
  return bodyReads(fn, signalNames, importedIds);
}

function bodyReads(fn, signalNames, importedIds) {
  if (!t.isBlockStatement(fn.body)) return isPotentiallyReactive(fn.body, signalNames, importedIds);
  return statementReads(fn.body, signalNames, importedIds);
}

function statementReads(stmt, names, ids) {
  const reads = e => e != null && isPotentiallyReactive(e, names, ids);
  const runs = s => s != null && statementReads(s, names, ids);
  if (t.isBlockStatement(stmt)) return stmt.body.some(runs);
  if (t.isExpressionStatement(stmt)) return reads(stmt.expression);
  if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) return reads(stmt.argument);
  if (t.isVariableDeclaration(stmt)) return stmt.declarations.some(d => reads(d.init));
  if (t.isIfStatement(stmt)) return reads(stmt.test) || runs(stmt.consequent) || runs(stmt.alternate);
  if (t.isTryStatement(stmt)) return runs(stmt.block) || runs(stmt.handler && stmt.handler.body) || runs(stmt.finalizer);
  if (t.isSwitchStatement(stmt)) {
    return reads(stmt.discriminant) || stmt.cases.some(c => reads(c.test) || c.consequent.some(runs));
  }
  if (t.isForStatement(stmt)) {
    const init = t.isVariableDeclaration(stmt.init) ? runs(stmt.init) : reads(stmt.init);
    return init || reads(stmt.test) || reads(stmt.update) || runs(stmt.body);
  }
  if (t.isForOfStatement(stmt) || t.isForInStatement(stmt)) return reads(stmt.right) || runs(stmt.body);
  if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) return reads(stmt.test) || runs(stmt.body);
  if (t.isLabeledStatement(stmt)) return runs(stmt.body);
  return false;
}

// Whether `call` may read a signal that neither its callee expression nor its
// arguments show. A function this module declares, or a method of an object
// literal it declares, is read for it: `{format('x')}` is as reactive as
// format's body. A function the compiler cannot see (a parameter, a value
// some call returned, a method of an object it did not see built, a function
// that is reassigned) is assumed to read: only a body it has seen proves a
// call static, and a wrong guess the other way freezes the text silently.
// Built-in methods and globals are the environment's, not the app's.
//
// While a function's own body is being read (`signalNames.calls` set), a call
// of another local function is recorded as an edge of the call graph instead
// of being read through: see readsThrough.
function callReadsInside(call, signalNames, importedIds) {
  const scope = scopeOf(call, signalNames.scope);
  if (!scope) return false;
  const target = calleeTarget(call.callee, scope, importedIds);
  if (typeof target === 'boolean') return target;
  if (signalNames.calls) {
    signalNames.calls.push(target);
    return false;
  }
  return readsThrough(target, importedIds);
}

// The scope each call of the module was written in, recorded before any is
// read (see resolveCallees): a helper declared in a nested block resolves from
// that block, not from the function around it. A call node made later (by
// JSX lowering) resolves from the scope its reader names.
const callScopes = new WeakMap();

function scopeOf(call, fallbackScope) {
  return callScopes.get(call) || fallbackScope;
}

// What a call of `callee` runs: true or false when that is known at once, or
// the call-graph node of the local function it calls.
function calleeTarget(callee, scope, importedIds) {
  if (t.isIdentifier(callee)) {
    const binding = scope.getBinding(callee.name);
    if (!binding) return false;
    // An import is as reactive as its source: one from What or from the app
    // itself is decided by name (importedIds), a package's utility is not.
    if (binding.kind === 'module') return !!importedIds && importedIds.has(callee.name);
    return graphNode(binding, null);
  }
  if ((t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) && !callee.computed &&
      t.isIdentifier(callee.property)) {
    const method = callee.property.name;
    const builtin = PURE_BUILTIN_METHODS.has(method) || BUILTIN_METHODS.has(method);
    if (!t.isIdentifier(callee.object)) return !builtin;
    const binding = scope.getBinding(callee.object.name);
    // An object literal of the module that may define the method runs its
    // own, whatever the method is called.
    if (binding && mayDefine(binding, method)) return graphNode(binding, method);
    if (builtin || !binding) return false;
    if (binding.kind === 'module') return !!importedIds && importedIds.has(callee.object.name);
    return graphNode(binding, method);
  }
  return true;
}

// Whether the object literal `binding` is declared with may have a `method`
// of its own: a property of that name, or a spread or computed key.
function mayDefine(binding, method) {
  const path = binding.path;
  if (!path.isVariableDeclarator() || !t.isObjectExpression(path.node.init)) return false;
  return path.node.init.properties.some((prop) =>
    t.isSpreadElement(prop) || prop.computed ||
    t.isIdentifier(prop.key, { name: method }) || t.isStringLiteral(prop.key, { value: method }));
}

// Every call of the module, read before any JSX is lowered (see the plugin's
// Program visitor), so that a function's body is read as its author wrote it
// whether it comes before or after the JSX that calls it. Every call's scope
// is recorded first, so the bodies read see each of them.
export function resolveCallees(callPaths, importedIds) {
  for (const callPath of callPaths) callScopes.set(callPath.node, callPath.scope);
  scopeNamesCache = new WeakMap();
  try {
    for (const callPath of callPaths) callReadsInside(callPath.node, { scope: callPath.scope }, importedIds);
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

// The call graph: a node per local function the module calls (a binding
// called, or its `method`), kept per declaration. Its edges are the local
// functions its body calls; `direct` says whether its body reads by itself.
// A node reads when it reads directly or reaches one that does.
const graphNodes = new WeakMap();

function graphNode(binding, method) {
  let byMethod = graphNodes.get(binding.identifier);
  if (!byMethod) graphNodes.set(binding.identifier, byMethod = new Map());
  let node = byMethod.get(method);
  if (!node) byMethod.set(method, node = { binding, method, edges: null, direct: false, reads: undefined });
  return node;
}

// Read a node's own body once: whether it reads, and which local functions it
// calls.
function expand(node, importedIds) {
  const fn = boundFunction(node.binding, node.method);
  if (fn === null) {
    node.direct = true;
    node.edges = [];
    return;
  }
  const names = collectSignalNamesFromScope(fn);
  names.calls = [];
  node.direct = bodyReads(fn.node, names, importedIds);
  node.edges = names.calls;
}

// Whether `start` reads, by a depth-first walk of the graph on a stack of its
// own: a chain of thousands of helpers cannot overflow the JavaScript stack,
// and a cycle is decided only once all of it has been seen. Reaching a reader
// makes every node on the path to it a reader; exhausting the walk proves
// every node it saw static, since each reaches only what the start reaches.
function readsThrough(start, importedIds) {
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
    if (node.edges === null) expand(node, importedIds);
    if (node.direct) return found();
    if (nextEdge[top] === node.edges.length) {
      stack.pop();
      nextEdge.pop();
      continue;
    }
    const edge = node.edges[nextEdge[top]++];
    if (edge.reads === true) return found();
    if (edge.reads === false || seen.has(edge)) continue;
    seen.add(edge);
    stack.push(edge);
    nextEdge.push(0);
  }
  for (const node of seen) node.reads = false;
  return false;
}

// The path of the function a call of the binding (or of its `method`) runs,
// or null when the declaration does not show one that stays put.
function boundFunction(binding, method) {
  if (!binding.constant) return null;
  const path = binding.path;
  if (path.isFunctionDeclaration()) return method === null ? path : null;
  if (!path.isVariableDeclarator()) return null;
  const init = path.get('init');
  if (method === null) return init.isArrowFunctionExpression() || init.isFunctionExpression() ? init : null;
  if (!init.isObjectExpression() || !keepsItsMethods(binding)) return null;
  // The last property that may be `method` is the one the object has.
  /** @type {any} */
  let last = null;
  for (const prop of init.get('properties')) {
    if (prop.isSpreadElement() || prop.node.computed) last = null;
    else if (t.isIdentifier(prop.node.key, { name: method }) || t.isStringLiteral(prop.node.key, { value: method })) last = prop;
  }
  if (last === null) return null;
  if (last.isObjectMethod()) return last.node.kind === 'method' ? last : null;
  const value = last.get('value');
  if (value.isArrowFunctionExpression() || value.isFunctionExpression()) return value;
  if (!value.isIdentifier()) return null;
  const inner = last.scope.getBinding(value.node.name);
  return inner ? boundFunction(inner, null) : null;
}

// Whether the object `binding` names keeps the methods it was declared with:
// every use reads one of its properties by name, so none is replaced and the
// object reaches no code that could replace one.
function keepsItsMethods(binding) {
  return binding.referencePaths.every((ref) => {
    const parent = ref.parentPath;
    if (!parent || !parent.isMemberExpression({ object: ref.node }) || parent.node.computed) return false;
    const use = parent.parentPath;
    return !(use.isAssignmentExpression({ left: parent.node }) || use.isUpdateExpression() ||
      use.isUnaryExpression({ operator: 'delete' }));
  });
}

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

