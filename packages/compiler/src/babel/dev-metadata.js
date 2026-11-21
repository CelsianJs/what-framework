// Development names and source locations (option `devMetadata`, never in a
// production build).
//
// Every string has the form "name@path:line:column": the path is relative to
// `projectRoot` with forward slashes, the line and column are 1-based and point
// at the original source, because they are all read in the same Babel pass
// that lowers the JSX (positions from a second pass would be shifted by the
// first). The runtime reads the metadata in development.
//
//   components   _$createComponent(Row, props, children, "Row@src/App.jsx:12:5")
//                (also _$componentVNode and the server back end's _$ssrComponent)
//   signals      signal(0)            -> signal(0, "count@src/store.js:3:15")
//   effects      effect(fn)           -> effect(fn, { name: "save@src/store.js:9:1" })
//                effect(fn, { phase }) -> effect(fn, { phase, name: "…" })
//   bindings     _$effect(() => _$setAttr(el, "title", x()), { name: "li.title@src/App.jsx:14:9" })
//                _$insert(el, () => x(), marker, "li.children@src/App.jsx:15:11")
//
// Only calls that provably reach What's own primitives are named. Explicit
// names are preserved and their call-site locations still travel with them.

import { t } from './types.js';
import { importedFrom } from './common.js';

function devMetadataEnabled(state) {
  return state.opts?.devMetadata === true && state.opts?.production !== true;
}

function sourcePath(state) {
  if (state._devPath !== undefined) return state._devPath;
  const file = String(state.file?.opts?.filename || '<unknown>').replace(/\\/g, '/').replace(/[?#].*$/, '');
  const root = String(state.opts?.projectRoot || state.file?.opts?.cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  state._devPath = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
  return state._devPath;
}

/** "name@path:line:column" for `node`, or null when it has no source position. */
function describe(name, node, state) {
  const start = node && node.loc && node.loc.start;
  if (!start) return null;
  return `${name}@${sourcePath(state)}:${start.line}:${start.column + 1}`;
}

function jsxName(name) {
  if (t.isJSXMemberExpression(name)) return `${jsxName(name.object)}.${name.property.name}`;
  if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
  return name.name;
}

/** The component call's fourth argument, or null outside a development build. */
export function componentMetadata(node, state, name) {
  if (!devMetadataEnabled(state)) return null;
  const text = describe(name || jsxName(node.openingElement.name), node.openingElement, state);
  return text ? t.stringLiteral(text) : null;
}

/** "tag.what@loc" for a compiled binding, or null outside a development build. */
export function bindingMetadata(tag, what, node, state) {
  if (!devMetadataEnabled(state)) return null;
  const text = describe(`${tag}.${what}`, node, state);
  return text ? t.stringLiteral(text) : null;
}

const NAMED_PRIMITIVES = new Map([
  // name -> how the name is passed
  ['signal', 'argument'],
  ['effect', 'options'],
  ['computed', 'argument'],
  ['h', 'vnode'],
]);

function primitiveName(callPath) {
  const callee = callPath.node.callee;
  if (t.isIdentifier(callee)) {
    const binding = callPath.scope.getBinding(callee.name);
    for (const name of NAMED_PRIMITIVES.keys()) {
      if (importedFrom(binding, t.isImportSpecifier, name)) return name;
    }
    return null;
  }
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object) &&
      t.isIdentifier(callee.property) && NAMED_PRIMITIVES.has(callee.property.name)) {
    const binding = callPath.scope.getBinding(callee.object.name);
    if (importedFrom(binding, t.isImportNamespaceSpecifier, null)) return callee.property.name;
  }
  return null;
}

// What the value is called in the source: the variable, property or field it
// is assigned to, else the primitive's own name.
function boundName(callPath, fallback) {
  const parent = callPath.parent;
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
  if ((t.isObjectProperty(parent) || t.isClassProperty(parent)) && !parent.computed && t.isIdentifier(parent.key)) {
    return parent.key.name;
  }
  if (t.isAssignmentExpression(parent)) {
    if (t.isIdentifier(parent.left)) return parent.left.name;
    if (t.isMemberExpression(parent.left) && !parent.left.computed && t.isIdentifier(parent.left.property)) {
      return parent.left.property.name;
    }
  }
  return fallback;
}

const annotatedVNodes = new WeakSet();

export function annotatePrimitive(callPath, state) {
  if (!devMetadataEnabled(state)) return;
  const primitive = primitiveName(callPath);
  if (primitive === null) return;
  const args = callPath.node.arguments;
  if (args.length === 0 || args.some(arg => t.isSpreadElement(arg))) return;
  if (primitive === 'h') {
    if (annotatedVNodes.has(callPath.node) || !(t.isIdentifier(args[0]) || t.isMemberExpression(args[0]))) return;
    const name = t.isIdentifier(args[0]) ? args[0].name : t.isIdentifier(args[0].property) && !args[0].computed ? args[0].property.name : 'component';
    const meta = describe(name, callPath.node, state);
    if (meta) {
      annotatedVNodes.add(callPath.node);
      const vnode = callPath.scope.generateUidIdentifier('vnode');
      callPath.replaceWith(t.callExpression(t.arrowFunctionExpression([vnode], t.sequenceExpression([
        t.assignmentExpression('=', t.memberExpression(vnode, t.identifier('_loc')), t.stringLiteral(meta)),
        vnode,
      ])), [callPath.node]));
    }
    return;
  }
  const text = describe(boundName(callPath, primitive), callPath.node, state);
  if (!text) return;
  if (NAMED_PRIMITIVES.get(primitive) === 'argument') {
    if (args.length === 1) args.push(t.stringLiteral(text));
    else if (primitive === 'signal' && args.length === 2) args.push(t.stringLiteral(text));
    return;
  }
  const nameProperty = t.objectProperty(t.identifier('name'), t.stringLiteral(text));
  if (args.length === 1) {
    args.push(t.objectExpression([nameProperty]));
  } else if (args.length === 2 && t.isObjectExpression(args[1])) {
    const named = args[1].properties.some(p => t.isSpreadElement(p) || (t.isObjectProperty(p) || t.isObjectMethod(p)) && !p.computed &&
      (t.isIdentifier(p.key, { name: 'name' }) || t.isStringLiteral(p.key, { value: 'name' })));
    if (!named) args[1].properties.push(nameProperty);
    else args.push(t.stringLiteral(text));
  } else if (args.length === 2) {
    args.push(t.stringLiteral(text));
  }
}
