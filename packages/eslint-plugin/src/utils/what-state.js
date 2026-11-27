/**
 * What made a name, resolved through the scope: state a What hook or
 * primitive returns, imported from what-framework or what-core. Rules that
 * report only What's own state use it, so a same-named variable elsewhere
 * and React's hooks in a what-react file are left alone.
 */

import { SIGNAL_CREATORS, ACCESSOR_PAIR_HOOKS, SWR_LIKE_HOOKS } from './signal-tracking.js';

const WHAT_SOURCES = /^what-(framework|core)(\/|$)/;

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
export function whatImport(sourceCode, callee) {
  if (callee?.type !== 'Identifier') return null;
  const def = resolve(sourceCode, callee)?.defs[0];
  if (def?.type !== 'ImportBinding' || def.node.type !== 'ImportSpecifier') return null;
  if (!WHAT_SOURCES.test(String(def.parent?.source?.value))) return null;
  return def.node.imported.name ?? def.node.imported.value;
}

const REACT_SOURCES = /^(react|react-dom|preact|what-react)(\/|$)/;

/** Whether `callee` is imported from React, Preact or what-react, whose hooks return values. */
function reactImport(sourceCode, callee) {
  const def = resolve(sourceCode, callee)?.defs[0];
  return def?.type === 'ImportBinding' && REACT_SOURCES.test(String(def.parent?.source?.value));
}

/**
 * What the identifier `node` is, when What made it: 'accessor' for the state a
 * What hook or primitive returns (`const x = signal()`, the first element of
 * `const [x, setX] = useState()`), 'setter' for the second element of such a
 * pair, else null.
 */
export function whatState(sourceCode, node) {
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


/**
 * Whether the identifier `node` reads the variable a signal tracker recorded
 * under its name (createSignalTracker, which goes by name): the declaration
 * it resolves to is a call of a signal creator, an accessor-pair hook or a
 * data hook. A same-named variable of another scope (a parameter, a local
 * `const idx = current()`) is not, nor is state a React, Preact or what-react
 * hook returns. Without scope information (a test's fake context) the name
 * decides.
 */
export function declaredAsSignal(sourceCode, node) {
  if (!sourceCode?.getScope) return true;
  const def = resolve(sourceCode, node)?.defs[0];
  if (def?.type !== 'Variable' || def.node.init?.type !== 'CallExpression' || def.node.init.callee.type !== 'Identifier') return false;
  if (reactImport(sourceCode, def.node.init.callee)) return false;
  const hook = def.node.init.callee.name;
  const id = def.node.id;
  if (id.type === 'Identifier') return id === def.name && SIGNAL_CREATORS.includes(hook);
  if (id.type === 'ArrayPattern') return id.elements[0] === def.name && ACCESSOR_PAIR_HOOKS.includes(hook);
  return id.type === 'ObjectPattern' && SWR_LIKE_HOOKS.includes(hook);
}
