/**
 * What made a name, resolved through the scope: state a What hook or
 * primitive returns, imported from what-framework or what-core. Rules that
 * report only What's own state use it, so a same-named variable elsewhere
 * and React's hooks in a what-react file are left alone.
 */

import { SIGNAL_CREATORS, ACCESSOR_PAIR_HOOKS } from './signal-tracking.js';

const WHAT_SOURCES = /^what-(framework|core)(\/|$)/;

/** The variable `node` (an identifier) resolves to, or null. */
export function resolve(sourceCode, node) {
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

