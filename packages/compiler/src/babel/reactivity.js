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
        signalNames.add(id.name);
      } else if (t.isArrayPattern(id)) {
        for (const el of id.elements) {
          if (t.isIdentifier(el)) signalNames.add(el.name);
        }
      } else if (t.isObjectPattern(id)) {
        for (const prop of id.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
            signalNames.add(prop.value.name);
          }
        }
      }
    }
  }

  function extractFromPattern(param) {
    if (!t.isObjectPattern(param)) return;
    for (const prop of param.properties) {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
        signalNames.add(prop.value.name);
        propNames.add(prop.value.name);
      } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
        signalNames.add(prop.argument.name);
        propNames.add(prop.argument.name);
      }
    }
  }

  // Walk up the scope chain using Babel's scope API.
  let scope = path.scope;
  while (scope) {
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
    scope = scope.parent;
  }

  return signalNames;
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

// Check if a call expression is a safe (non-reactive) global call
function isSafeGlobalCall(expr) {
  if (!t.isCallExpression(expr)) return false;
  const callee = expr.callee;

  // Math.max(), Number.parseInt(), etc.
  if (t.isMemberExpression(callee) && t.isIdentifier(callee.object)) {
    return SAFE_GLOBAL_CALLS.has(callee.object.name);
  }

  // parseInt(), isNaN(), etc.
  if (t.isIdentifier(callee)) {
    return SAFE_GLOBAL_CALLS.has(callee.name);
  }

  return false;
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
    if (isSafeGlobalCall(expr)) return false;
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
    if (isSafeGlobalCall(expr)) {
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
    return isPotentiallyReactive(expr.callee, signalNames, importedIds) ||
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

// Whether `fn`, a function handed to a call, returns something that reads
// reactively: its expression body, or what its block body returns (nested
// functions aside).
function readsInCallback(fn, signalNames, importedIds) {
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) return false;
  if (!t.isBlockStatement(fn.body)) return isPotentiallyReactive(fn.body, signalNames, importedIds);
  const returned = [];
  collectReturns(fn.body, returned);
  return returned.some(e => isPotentiallyReactive(e, signalNames, importedIds));
}

function collectReturns(stmt, out) {
  if (t.isReturnStatement(stmt)) {
    if (stmt.argument) out.push(stmt.argument);
  } else if (t.isBlockStatement(stmt)) {
    for (const s of stmt.body) collectReturns(s, out);
  } else if (t.isIfStatement(stmt)) {
    collectReturns(stmt.consequent, out);
    if (stmt.alternate) collectReturns(stmt.alternate, out);
  } else if (t.isTryStatement(stmt)) {
    collectReturns(stmt.block, out);
    if (stmt.handler) collectReturns(stmt.handler.body, out);
    if (stmt.finalizer) collectReturns(stmt.finalizer, out);
  } else if (t.isSwitchStatement(stmt)) {
    for (const c of stmt.cases) for (const s of c.consequent) collectReturns(s, out);
  } else if (t.isLabeledStatement(stmt) || t.isForStatement(stmt) || t.isForOfStatement(stmt) ||
             t.isForInStatement(stmt) || t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    collectReturns(stmt.body, out);
  }
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

