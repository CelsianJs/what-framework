// The DOM back end's auto-selector: `sel() === row.id` in a keyed list row
// becomes an O(1) createSelector lookup.

import { t } from './types.js';
import { collectPatternNames, namesInvisibleToKeyFn } from './lists.js';
import { getAttrName, helper, isComponentElement, isEventAttrName, uniqueName } from './common.js';

const _selectorInfoWarned = new Set();

// --- Auto-selector ---
//
// Inside a keyed .map() row, `sel() === row.id` (or `!==`, either operand
// order) in a render binding re-runs for every row whenever `sel` changes:
// selecting one row of 10,000 re-runs 10,000 bindings. The rewrite turns it
// into `_sel$N(row.id)`, where `const _sel$N = _$createSelector(sel)` is
// declared once at the start of the JSX root that holds the list, so a change
// re-runs only the bindings of the rows whose key it leaves or enters. The
// comparison's value is the same; createSelector compares against the
// source's current value.
//
// The declaration runs whenever the root is built, which is earlier and more
// often than the comparison itself: the list may be empty, or the comparison
// may sit behind a guard (`selected && selected() === row.id`) precisely
// because `selected` can be missing. So the declaration must never throw and
// must never call the source. It is safe by construction:
//   - a source the compiler watched being created as an accessor (a local
//     signal, computed, useSignal, ...) is handed to createSelector directly;
//   - any other source (a destructured prop, an import) is checked first:
//       const _sel$0 = typeof sel === 'function'
//         ? _$createSelector(sel)
//         : (_k$0) => sel() === _k$0;
//     A non-function source therefore costs nothing until a row evaluates the
//     comparison, and then evaluates exactly what was written, including the
//     TypeError the original code would have raised.
// One selector serves every comparison against the same source in one JSX
// root (several lists in one component share it), because every list of the
// root is built inside the root's own setup.
//
// It fires only when ALL of these hold:
//   - the .map() is lowered to a keyed list (it has a usable key prop);
//   - the comparison is `===` or `!==` and sits in a render binding of the
//     row's JSX: an attribute value of an intrinsic element (not ref, key,
//     an event handler, bind:*, or a component prop) or a child expression,
//     including a zero-argument render thunk `{() => ...}`, but never inside
//     any other function (handlers keep plain reads);
//   - one operand is `X()`: a zero-argument call of an identifier the
//     compiler treats as an accessor (a signal/computed declared in scope, a
//     destructured prop, or an import from What or a relative module),
//     declared outside the row and never reassigned;
//   - the other operand reads a name the row binds (its parameters or
//     locals) and is side-effect free: identifiers, member access, literals,
//     template literals, unary and arithmetic operators. No calls.
//
// Opt out per comparison or per list with a `/* @what-no-selector */`
// comment before the comparison or before the .map() call, or for a whole
// build with the plugin option `autoSelector: false`. In development each
// file that gets a rewrite logs it once, and every rewrite is listed in
// `file.metadata.whatAutoSelectors` for tools.
const NO_SELECTOR_PRAGMA = /@what-no-selector\b/;

export function hasNoSelectorPragma(node) {
  if (!node || typeof node !== 'object') return false;
  const comments = [node.leadingComments, node.innerComments];
  return comments.some(list => list && list.some(c => NO_SELECTOR_PRAGMA.test(c.value)));
}

export function lowerRowSelectors(rowJsx, mapFn, state) {
  const inside = namesInvisibleToKeyFn(mapFn);
  for (const param of mapFn.params) collectPatternNames(param, inside);

  const sourceOf = (node) => {
    if (!t.isCallExpression(node) || node.arguments.length !== 0 || !t.isIdentifier(node.callee)) return null;
    const name = node.callee.name;
    if (inside.has(name)) return null;
    const accessor = (state.signalNames && state.signalNames.has(name)) ||
      (state.importedIdentifiers && state.importedIdentifiers.has(name));
    if (!accessor) return null;
    const binding = state._jsxScope && state._jsxScope.getBinding(name);
    return binding && binding.constant ? name : null;
  };

  const isRowKey = (node) => {
    let readsRow = false;
    const pure = (n) => {
      if (t.isIdentifier(n)) {
        if (inside.has(n.name)) readsRow = true;
        return true;
      }
      if (t.isMemberExpression(n) || t.isOptionalMemberExpression(n)) {
        return pure(n.object) && (!n.computed || pure(n.property));
      }
      if (t.isStringLiteral(n) || t.isNumericLiteral(n) || t.isBooleanLiteral(n) ||
          t.isNullLiteral(n) || t.isBigIntLiteral(n)) return true;
      if (t.isTemplateLiteral(n)) return n.expressions.every(pure);
      if (t.isUnaryExpression(n)) return n.operator !== 'delete' && pure(n.argument);
      if (t.isBinaryExpression(n)) return /^(?:[-+*/%]|\*\*)$/.test(n.operator) && pure(n.left) && pure(n.right);
      return false;
    };
    return pure(node) && readsRow;
  };

  const fromProps = state.signalNames && state.signalNames.fromDestructuredProps;
  const provenAccessor = (name) => state.signalNames.has(name) && !(fromProps && fromProps.has(name)) &&
    !(state.importedIdentifiers && state.importedIdentifiers.has(name));

  const selectorFor = (name) => {
    let id = state._selectorIds.get(name);
    if (id === undefined) {
      id = uniqueName(state, '_sel$');
      state._selectorIds.set(name, id);
      const create = t.callExpression(helper(state, '_$createSelector'), [t.identifier(name)]);
      let init = create;
      if (!provenAccessor(name)) {
        const key = t.identifier(uniqueName(state, '_k$'));
        init = t.conditionalExpression(
          t.binaryExpression('===', t.unaryExpression('typeof', t.identifier(name)), t.stringLiteral('function')),
          create,
          t.arrowFunctionExpression([key], t.binaryExpression('===',
            t.callExpression(t.identifier(name), []), t.cloneNode(key))),
        );
      }
      state._selectorDecls.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(id), init)]));
    }
    return id;
  };

  const report = (node, name) => {
    const loc = node.loc ? node.loc.start : null;
    const code = state.file && typeof state.file.code === 'string' && node.end != null
      ? state.file.code.slice(node.start, node.end)
      : `${name}() === …`;
    const record = { source: name, comparison: code, line: loc ? loc.line : null, column: loc ? loc.column : null };
    if (state.file && state.file.metadata) {
      (state.file.metadata.whatAutoSelectors ||= []).push(record);
    }
    if (process.env.NODE_ENV === 'production' || state.opts?.production) return;
    const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
    if (_selectorInfoWarned.has(fileName)) return;
    _selectorInfoWarned.add(fileName);
    console.info(
      `[what-compiler] auto-selector: \`${code}\` in a keyed .map() row at ${fileName}` +
      `${loc ? `:${loc.line}:${loc.column}` : ''} is compiled to createSelector(${name}), so a change ` +
      `to \`${name}\` re-runs only the rows whose key it leaves or enters, not every row. ` +
      'Same value, same reactivity. Opt out with /* @what-no-selector */ before the comparison ' +
      'or the .map() call. (Logged once per file.)'
    );
  };

  const isRenderThunk = (e) => t.isArrowFunctionExpression(e) && e.params.length === 0 && t.isExpression(e.body);

  const rewrite = (n) => {
    if (!n || typeof n !== 'object' || hasNoSelectorPragma(n) || t.isFunction(n)) return n;
    if (t.isJSXElement(n) || t.isJSXFragment(n)) {
      visitJsx(n);
      return n;
    }
    if (t.isBinaryExpression(n) && (n.operator === '===' || n.operator === '!==')) {
      let source = sourceOf(n.left);
      let key = n.right;
      if (!source || !isRowKey(key)) {
        source = sourceOf(n.right);
        key = n.left;
        if (source && !isRowKey(key)) source = null;
      }
      if (source) {
        report(n, source);
        const callee = t.identifier(selectorFor(source));
        callee._whatSelector = true;
        const call = t.callExpression(callee, [key]);
        return n.operator === '===' ? call : t.unaryExpression('!', call);
      }
    }
    for (const field of t.VISITOR_KEYS[n.type] || []) {
      const value = n[field];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = rewrite(value[i]);
      } else if (value && typeof value === 'object') {
        n[field] = rewrite(value);
      }
    }
    return n;
  };

  const rewriteBinding = (expr) => {
    if (isRenderThunk(expr) && !hasNoSelectorPragma(expr)) {
      expr.body = rewrite(expr.body);
      return expr;
    }
    return rewrite(expr);
  };

  const visitChildren = (children) => {
    for (const child of children) {
      if (t.isJSXElement(child) || t.isJSXFragment(child)) visitJsx(child);
      else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
        child.expression = rewriteBinding(child.expression);
      }
    }
  };

  function visitJsx(node) {
    if (t.isJSXElement(node) && !isComponentElement(node)) {
      for (const attr of node.openingElement.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXExpressionContainer(attr.value)) continue;
        const name = getAttrName(attr);
        if (name === 'key' || name === 'ref' || isEventAttrName(name) || name.includes(':') || name.includes('|')) continue;
        attr.value.expression = rewriteBinding(attr.value.expression);
      }
    }
    visitChildren(node.children);
  }

  visitJsx(rowJsx);
}

