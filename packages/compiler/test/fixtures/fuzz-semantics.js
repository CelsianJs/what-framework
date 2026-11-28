// What the server-semantics arm of the lowering-parity fuzz builds its trees
// from. Both arms import THIS module, so the only difference between the two
// modules a case compiles to is how the JSX was lowered. Written with h(), for
// the reason fuzz-components.js gives.
//
// Everything a hole can observe goes through `log`, so the arm compares not
// only what each renderer writes but in what order every expression ran.

import { h, createContext, createResource, useContext } from '../../../core/src/index.js';

export const L = [];

/** Records `tag` and returns it: a hole with a side effect. */
export function log(tag) {
  L.push(tag);
  return tag;
}

/** A hole that throws when it is evaluated. */
export function boom() {
  L.push('boom');
  throw new Error('boom');
}

/** The same, called with an argument, so the compiler reads it as a plain value. */
export function boomPlain(tag) {
  L.push(`boom:${tag}`);
  throw new Error(`boom:${tag}`);
}

// A registry a component writes while it renders and a later hole reads.
let registered = 0;

export function Register() {
  registered++;
  L.push('Register');
  return h('i', {}, 'r');
}

/** The registry as it stands, called with an argument so it reads as a plain value. */
export function readRegistry(tag) {
  L.push(`read:${tag}`);
  return `reg${registered}`;
}

export function resetSemantics() {
  L.length = 0;
  registered = 0;
}

export function Boom() {
  L.push('Boom');
  throw new Error('component threw');
}

// Reads a resource: the synchronous renderers show the enclosing <Suspense>'s
// fallback, the streaming and buffered ones wait for it.
export function Slow() {
  const [value] = createResource(() => new Promise((resolve) => setTimeout(() => resolve('slow'), 0)));
  L.push('Slow');
  return h('b', {}, () => value());
}

/** An accessor that suspends until its promise settles: a fresh one per build. */
export function makeSlow() {
  let done = false;
  let pending = null;
  return () => {
    L.push('slow()');
    if (done) return 'ready';
    pending ??= new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 0));
    throw pending;
  };
}

export const Ctx = createContext('ctx-default');

export function ReadCtx() {
  return h('em', {}, () => useContext(Ctx));
}

export async function AsyncBox() {
  L.push('AsyncBox');
  return h('span', {}, 'async');
}
