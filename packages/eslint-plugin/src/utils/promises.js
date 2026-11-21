/**
 * Whether a function's result is a promise, as far as its source shows: an
 * async function, or one whose returned expression is `fetch(...)`,
 * `x.then(...)` / `.catch(...)` / `.finally(...)`, `new Promise(...)` or
 * `Promise.all(...)` and its siblings. A call to any other function may or may
 * not return one, so it is not counted: the rules that use this stay silent
 * where they cannot tell.
 */

const PROMISE_METHODS = new Set(['then', 'catch', 'finally']);

export function isPromiseExpression(node) {
  if (!node) return false;
  if (node.type === 'AwaitExpression') return false;
  if (node.type === 'NewExpression') return node.callee.type === 'Identifier' && node.callee.name === 'Promise';
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name === 'fetch';
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    if (PROMISE_METHODS.has(callee.property.name)) return true;
    return callee.object.type === 'Identifier' && callee.object.name === 'Promise';
  }
  return false;
}

/** The expressions a function returns: its expression body, or its return statements' (nested functions aside). */
export function returnedExpressions(fn) {
  if (fn.body.type !== 'BlockStatement') return [fn.body];
  const out = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ReturnStatement') {
      if (node.argument) out.push(node.argument);
      return;
    }
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return;
    for (const key of ['body', 'consequent', 'alternate', 'block', 'handler', 'finalizer', 'cases']) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(fn.body);
  return out;
}

/** True when `fn` returns a promise, by its source (see isPromiseExpression). */
export function returnsPromise(fn) {
  return fn.async === true || returnedExpressions(fn).some(isPromiseExpression);
}

export function isFunction(node) {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
}
