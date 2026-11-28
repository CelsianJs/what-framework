/**
 * Where code runs, for rules that care whether a call happens during a
 * component's render or an effect's run, or later.
 *
 * A function runs "in place" when it is called where it is written: an IIFE,
 * or a callback that untrack(), batch() or an array method invokes before
 * returning. Any other nested function (an event handler, a timer, a promise
 * callback) runs later.
 */

export const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const SYNC_CALLBACK_METHODS = new Set([
  'map', 'forEach', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find',
  'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'sort',
]);
const SYNC_CALLBACK_FUNCTIONS = new Set(['untrack', 'batch']);
const EFFECT_CALLEES = new Set(['effect', 'useEffect']);

function calledWith(fn) {
  const call = fn.parent;
  return call?.type === 'CallExpression' && call.arguments.includes(fn) ? call : null;
}

export function runsInPlace(fn) {
  if (fn.parent?.type === 'CallExpression' && fn.parent.callee === fn) return true;
  const call = calledWith(fn);
  if (!call) return false;
  const callee = call.callee;
  if (callee.type === 'Identifier') return SYNC_CALLBACK_FUNCTIONS.has(callee.name);
  return callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && SYNC_CALLBACK_METHODS.has(callee.property.name);
}

/** True for the callback of effect(fn) or useEffect(fn). */
export function isEffectCallback(fn) {
  const call = fn.parent;
  return call?.type === 'CallExpression' && call.arguments[0] === fn &&
    call.callee.type === 'Identifier' && EFFECT_CALLEES.has(call.callee.name);
}

function isUntrackCallback(fn) {
  const call = calledWith(fn);
  return call?.callee.type === 'Identifier' && call.callee.name === 'untrack';
}

/**
 * The effect callback whose run executes `node`, and whether a signal read at
 * `node` subscribes the effect (it does not inside untrack()). Null when the
 * code runs later or outside any effect.
 * @returns {{ effect: any, tracked: boolean } | null}
 */
export function enclosingEffect(node) {
  let tracked = true;
  for (let n = node.parent; n; n = n.parent) {
    if (!FUNCTION_TYPES.has(n.type)) continue;
    if (isEffectCallback(n)) return { effect: n, tracked };
    if (isUntrackCallback(n)) tracked = false;
    else if (!runsInPlace(n)) return null;
  }
  return null;
}

/** The nearest function around a node, or null at module scope. */
export function nearestFunction(node) {
  for (let n = node.parent; n; n = n.parent) if (FUNCTION_TYPES.has(n.type)) return n;
  return null;
}

/** The signal a call writes: `count(value)` or `count.set(value)`, else null. */
export function signalWriteName(node, tracker) {
  const callee = node.callee;
  if (callee.type === 'Identifier' && tracker.isSignal(callee.name) && node.arguments.length > 0) return callee.name;
  if (
    callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && tracker.isSignal(callee.object.name) &&
    callee.property.type === 'Identifier' && callee.property.name === 'set'
  ) return callee.object.name;
  return null;
}
