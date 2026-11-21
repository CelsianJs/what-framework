// List detection shared by both back ends: which `.map()` calls return JSX,
// whether they carry a usable key, and the scope analysis the key function and
// the auto-selector both need.

import { t } from './types.js';
import { getAttrName, getAttributeValue } from './common.js';

// Names bound by a parameter pattern. Destructuring counts, so
// `({ id }, i) => <li key={id}>` binds `id` and a key of `id` resolves fine.
export function collectPatternNames(node, out) {
  if (!node || typeof node !== 'object') return out;
  switch (node.type) {
    case 'Identifier': out.add(node.name); break;
    case 'AssignmentPattern': collectPatternNames(node.left, out); break;
    case 'RestElement': collectPatternNames(node.argument, out); break;
    case 'ArrayPattern':
      for (const el of node.elements) collectPatternNames(el, out);
      break;
    case 'ObjectPattern':
      for (const p of node.properties) {
        collectPatternNames(p.type === 'RestElement' ? p.argument : p.value, out);
      }
      break;
    default: break;
  }
  return out;
}

// The key function is extracted OUT of the map callback and rebuilt as
// `(item) => keyExpr`, taking only the first parameter. So any name the key
// expression gets from somewhere else inside the callback becomes a free
// variable in the emitted code. This collects exactly those names: the
// parameters after the first, and everything declared in the callback body
// that is in scope at the return.
//
// Nested function bodies are deliberately not descended into. Their bindings
// cannot reach the return expression, so counting them would reject keys that
// are perfectly fine. A nested function's own name is hoisted, so that one
// is collected.
export function namesInvisibleToKeyFn(mapFn) {
  const out = new Set();
  for (let i = 1; i < mapFn.params.length; i++) collectPatternNames(mapFn.params[i], out);

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    switch (node.type) {
      case 'VariableDeclaration':
        for (const d of node.declarations) collectPatternNames(d.id, out);
        return;
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        if (node.id) out.add(node.id.name);
        return; // body is its own scope
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassExpression':
        return; // own scope
      case 'CatchClause':
        collectPatternNames(node.param, out);
        visit(node.body);
        return;
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
        visit(node.init); visit(node.left); visit(node.body);
        return;
      default: break;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'type' ||
          k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
      const v = node[k];
      if (v && typeof v === 'object') visit(v);
    }
  };

  if (t.isBlockStatement(mapFn.body)) visit(mapFn.body.body);

  // The first parameter IS passed to the key function, so anything it binds
  // stays visible even if a nested scope happens to reuse the name.
  for (const name of collectPatternNames(mapFn.params[0], new Set())) out.delete(name);
  return out;
}

// Does `node` reference any of `names` as a value? Property positions are
// skipped so `item.i` does not look like a use of `i`, but the check is
// otherwise deliberately generous: a false positive costs keyed
// reconciliation, a false negative ships a ReferenceError.
function referencesAny(node, names) {
  if (names.size === 0) return null;
  let found = null;
  const visit = (n) => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (n.type === 'Identifier') {
      if (names.has(n.name)) found = n.name;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'type' ||
          k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
      if (n.type === 'MemberExpression' && k === 'property' && !n.computed) continue;
      if ((n.type === 'ObjectProperty' || n.type === 'ObjectMethod') && k === 'key' && !n.computed) continue;
      const v = n[k];
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(node);
  return found;
}

// `source.map((item) => <Row key={...} />)`: the callback, the JSX it returns
// and its key. Returns null for anything else. With `requireKey` (the DOM back
// end, which lowers only keyed lists) a missing or unusable key returns null
// with a development warning; without it (the server back end, which renders
// every JSX-returning callback the same way) the key is optional and nothing is
// reported, because the client build of the same file already warned.
export function findMappedJsx(mapCall, state, requireKey) {
  // Check: something.map(fn)
  if (!t.isCallExpression(mapCall)) return null;
  if (!t.isMemberExpression(mapCall.callee)) return null;
  if (!t.isIdentifier(mapCall.callee.property, { name: 'map' })) return null;
  if (mapCall.arguments.length < 1) return null;

  const mapFn = mapCall.arguments[0];
  if (!t.isArrowFunctionExpression(mapFn) && !t.isFunctionExpression(mapFn)) return null;

  // Get the map callback's return expression
  /** @type {any} */
  let returnExpr = null;
  if (t.isArrowFunctionExpression(mapFn)) {
    if (t.isExpression(mapFn.body)) {
      returnExpr = mapFn.body;
    } else if (t.isBlockStatement(mapFn.body)) {
      const ret = mapFn.body.body.find(s => t.isReturnStatement(s));
      if (ret) returnExpr = ret.argument;
    }
  } else if (t.isFunctionExpression(mapFn)) {
    const ret = mapFn.body.body.find(s => t.isReturnStatement(s));
    if (ret) returnExpr = ret.argument;
  }

  if (!returnExpr) return null;

  // Check if the return is JSX with a `key` prop
  if (!t.isJSXElement(returnExpr)) return null;
  const attrs = returnExpr.openingElement.attributes;
  /** @type {any} */
  let keyAttr = null;
  for (const attr of attrs) {
    if (t.isJSXAttribute(attr) && getAttrName(attr) === 'key') {
      keyAttr = attr;
      break;
    }
  }
  if (!requireKey) return { mapFn, returnExpr, keyAttr, keyValue: keyAttr ? getAttributeValue(keyAttr.value) : null };
  if (!keyAttr) {
    // JSX returned without a key — bail out, but warn at compile time so
    // users notice they're missing keyed reconciliation. Only warn in dev
    // (production builds are noiseless).
    //
    // The message names ERR_MISSING_KEY because that is the code the docs and
    // the MCP `what_fix` tool already publish for this exact mistake. Without
    // the code in the text there was nothing anywhere in the toolchain that
    // ever emitted it, so an agent reading the warning had no way to reach
    // the diagnosis and the worked example filed under that name. This is a
    // BUILD-time report, not a runtime one: whether a list has keys is
    // settled by the source, and the compiler is the only place that sees it.
    if (process.env.NODE_ENV !== 'production') {
      const loc = returnExpr.loc;
      const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
      const lineInfo = loc ? `:${loc.start.line}:${loc.start.column}` : '';
      console.warn(
        `[what-compiler] ERR_MISSING_KEY: .map() returning JSX without a \`key\` prop at ${fileName}${lineInfo}. ` +
        `Without a key, the list cannot use keyed reconciliation — items are re-created on every update. ` +
        `Add key={...} to enable efficient updates. ` +
        `Run what_fix({ error: 'ERR_MISSING_KEY' }) for the worked example.`
      );
    }
    return null;
  }

  // Extract the key expression
  const keyValue = getAttributeValue(keyAttr.value);
  if (!keyValue) return null;

  // The key function is rebuilt as `(item) => keyExpr` and hoisted out of the
  // callback, so it only sees the first parameter. A key built from the index
  // (`key={i}`, the pattern the tutorial itself taught) compiled to
  // `key: t => i` with `i` free, and the failure was about as bad as it gets:
  // the list rendered correctly the first time, then the reconciler threw
  // `ReferenceError: i is not defined` inside its effect, the effect error
  // handler swallowed it to a single console.error, and the list stayed
  // frozen on its first render forever. Nothing visibly crashed. A key built
  // from a variable declared in the callback body failed the same way.
  //
  // Falling back is also the semantically right answer, not just the safe
  // one. A key derived from the index IS the position, so it carries no
  // identity across an update: an item that moves gets a different key and
  // reads as a different item. That is precisely what the unkeyed path
  // already does, correctly and more cheaply, so hand it that.
  const invisible = namesInvisibleToKeyFn(mapFn);
  const unreachable = referencesAny(keyValue, invisible);
  if (unreachable) {
    // A BARE index key (`key={i}`, exactly the second parameter and nothing
    // else) is deliberate and now behaves correctly, so it gets no warning.
    // The author wrote "position is identity", positional reconciliation is
    // precisely that, and there is no edit that would improve the output. The
    // framework's own tutorial keys a fixed nine-square board this way, where
    // it is not merely acceptable but the right answer, and a build-time
    // warning on step two of a beginner tutorial reads as something being
    // broken when nothing is.
    //
    // Everything else still warns, because everything else looks stable and is
    // not: `key={`${t.type}-${i}`}` reads like a composite identity but changes
    // the moment a row moves, and a key built from a variable declared in the
    // callback body would have been a ReferenceError before this fallback
    // existed. Those are worth interrupting someone over. A bare index is not.
    const isBareIndex = t.isIdentifier(keyValue)
      && mapFn.params[1]
      && t.isIdentifier(mapFn.params[1], { name: keyValue.name });

    if (!isBareIndex && process.env.NODE_ENV !== 'production') {
      const loc = returnExpr.loc;
      const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
      const lineInfo = loc ? `:${loc.start.line}:${loc.start.column}` : '';
      const usesIndex = mapFn.params[1] && t.isIdentifier(mapFn.params[1], { name: unreachable });
      console.warn(
        `[what-compiler] key={...} at ${fileName}${lineInfo} reads \`${unreachable}\`, which is not available ` +
        `to the key function (it only receives the item). ` +
        (usesIndex
          ? `A key built from the index is the item's position, not its identity, so it cannot survive a reorder. `
          : `\`${unreachable}\` is declared inside the map callback. `) +
        `Falling back to positional reconciliation. Key by something stable on the item (key={item.id}) ` +
        `to get keyed reconciliation.`
      );
    }
    return null;
  }
  return { mapFn, returnExpr, keyAttr, keyValue };
}

// A keyed `.map()` row reads its item through the runtime's item cell, so that
// a row whose key persists while its item is replaced by another object (an
// immutable update, a refetch) shows the new item and keeps its DOM: the
// callback `(item, i) => …` becomes `(cell, i, item) => …`, every read of
// `item` but the key expression becomes `read(cell)` (`read` is the runtime's
// _$item), which the row's bindings track, and the key expression keeps
// reading the item the row was built from, as a row's key cannot change while
// it lives. Returns false and changes nothing when the row reads the item only
// for its key, when the first parameter is not a plain name, or when that name
// is assigned or bound again inside the callback; the row then gets the raw
// item, as before.
export function readItemThroughAccessor(mapFn, keyValue, read, cellName, indexName) {
  const reads = rowItemReads(mapFn, keyValue);
  if (reads === null) return false;
  const itemName = mapFn.params[0].name;
  for (const [holder, slot] of reads) {
    const callee = read();
    callee._whatRowItem = true;
    const call = t.callExpression(callee, [t.identifier(cellName)]);
    // The item the row was built from, for the bindings of its plain fields.
    call._whatRowItemName = itemName;
    holder[slot] = call;
  }
  mapFn.params = [t.identifier(cellName), mapFn.params[1] || t.identifier(indexName), mapFn.params[0]];
  return true;
}

// A plain field of a keyed row's item, read where the row renders text:
// `row.label`, `row.a.b`, `row?.label`, `row['x']` or the item itself, and
// nothing else (no call, no computed key that is not a literal). Returns the
// read of the item at its root (the DOM target's `_$item(cell)` call, the
// server target's marked name; see readItemThroughAccessor and
// markRowItemReads), or null. Such a field is a text binding the row's item
// cell writes (what-core render.js _$field), and the server writes it as plain
// text, with no markers.
export function rowField(expr) {
  let node = expr;
  while (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    if (node.computed && !t.isStringLiteral(node.property) && !t.isNumericLiteral(node.property)) return null;
    node = node.object;
  }
  if (t.isCallExpression(node) && node.callee._whatRowItem === true) return node;
  if (t.isIdentifier(node) && node._whatRowItem === true) return node;
  return null;
}

// `expr` with its item read (`root`, from rowField) replaced by `replacement`.
export function withItem(expr, root, replacement) {
  if (expr === root) return replacement;
  const copy = t.cloneNode(expr, false);
  copy.object = withItem(expr.object, root, replacement);
  return copy;
}

// The server target's half: the holes that read a keyed row's item are the
// reactive children the DOM target makes them, so the server brackets them
// with the markers the client's bindings claim. Marks each read (_whatRowItem).
export function markRowItemReads(mapFn, keyValue) {
  const reads = rowItemReads(mapFn, keyValue);
  if (reads !== null) for (const [holder, slot] of reads) holder[slot]._whatRowItem = true;
}

// Whether `found` (findMappedJsx) is a row the DOM target lowers to a keyed
// list: it has a key, and the key reads only the item.
export function isKeyedRow(found) {
  return !!found.keyValue && !referencesAny(found.keyValue, namesInvisibleToKeyFn(found.mapFn));
}

// The reads of a keyed row's item other than its key expression, as
// [holder, field] pairs, or null when there is none or the row cannot read
// its item through a cell (see readItemThroughAccessor).
function rowItemReads(mapFn, keyValue) {
  const param = mapFn.params[0];
  if (!t.isIdentifier(param)) return null;
  const name = param.name;
  const reads = [];
  let unsafe = false;

  const binds = (pattern) => collectPatternNames(pattern, new Set()).has(name);
  const visit = (node, holder, slot) => {
    if (unsafe || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) visit(node[i], node, i);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === keyValue.type && t.isNodesEquivalent(node, keyValue)) return;
    switch (node.type) {
      case 'Identifier':
        if (node.name === name) reads.push([holder, slot]);
        return;
      case 'JSXIdentifier':
        if (node.name === name) unsafe = true;
        return;
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        visit(node.object, node, 'object');
        if (node.computed) visit(node.property, node, 'property');
        return;
      case 'ObjectProperty':
        if (node.computed) visit(node.key, node, 'key');
        if (node.shorthand && t.isIdentifier(node.value, { name })) {
          node.shorthand = false;
          node.value = t.cloneNode(node.value);
        }
        visit(node.value, node, 'value');
        return;
      case 'ObjectMethod':
      case 'ClassMethod':
      case 'ClassPrivateMethod':
        if (node.params.some(binds)) { unsafe = true; return; }
        if (node.computed) visit(node.key, node, 'key');
        visit(node.body, node, 'body');
        return;
      case 'ClassProperty':
      case 'ClassPrivateProperty':
        if (node.computed) visit(node.key, node, 'key');
        visit(node.value, node, 'value');
        return;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'FunctionDeclaration':
        if ((node.id && node.id.name === name) || node.params.some(binds)) { unsafe = true; return; }
        visit(node.params, node, 'params');
        visit(node.body, node, 'body');
        return;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id && node.id.name === name) { unsafe = true; return; }
        visit(node.superClass, node, 'superClass');
        visit(node.body, node, 'body');
        return;
      case 'VariableDeclarator':
        if (binds(node.id)) { unsafe = true; return; }
        visit(node.init, node, 'init');
        return;
      case 'CatchClause':
        if (node.param && binds(node.param)) { unsafe = true; return; }
        visit(node.body, node, 'body');
        return;
      case 'AssignmentExpression':
        if (binds(node.left)) { unsafe = true; return; }
        break;
      case 'UpdateExpression':
        if (t.isIdentifier(node.argument, { name })) { unsafe = true; return; }
        break;
      case 'LabeledStatement':
        visit(node.body, node, 'body');
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return;
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
        visit(node.expression, node, 'expression');
        return;
      default:
        if (node.type.startsWith('TS')) return;
        break;
    }
    for (const field of Object.keys(node)) {
      if (field === 'loc' || field === 'start' || field === 'end' || field === 'type' || field === 'extra'
          || field === 'typeAnnotation' || field === 'returnType' || field === 'typeParameters'
          || field === 'leadingComments' || field === 'trailingComments' || field === 'innerComments') continue;
      const value = node[field];
      if (value && typeof value === 'object') visit(value, node, field);
    }
  };

  for (let i = 1; i < mapFn.params.length; i++) {
    if (binds(mapFn.params[i])) return null;
  }
  visit(mapFn.body, mapFn, 'body');
  return unsafe || reads.length === 0 ? null : reads;
}
