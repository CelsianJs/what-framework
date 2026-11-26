// What Framework - Reactive Core
//
// Signals, computeds and effects with glitch-free push-pull propagation.
//
//   write  push: the written signal's direct subscribers become DIRTY,
//          everything further downstream PENDING, and every effect reached is
//          queued. A node that is already marked stops the walk, so a write
//          visits each node at most once.
//   read   pull: a PENDING computed or effect asks its computed dependencies,
//          depth-first and iteratively, whether any of them really changed,
//          and re-runs only if one did. A computed that recomputes to the same
//          value (Object.is) does not dirty its subscribers.
//
// Reads are always fresh: a write is visible immediately, and reading a stale
// computed recomputes it on the spot. Effects re-run on a microtask, at the end
// of the outermost batch(), or in flushSync(), and a flush never starts while
// an effect or a computed is running, so neither is ever re-entered. In a
// flush, render-phase effects run first, user-phase effects once no render
// effect is queued, and an effect before the effects created during its run.
//
// Ownership: roots, list rows and components are owner records, and every
// effect and computed owns what its run creates (effects, computeds, roots,
// cleanups). A run's work goes into an owner record made the first time the
// run creates something, which is disposed before the next run and with the
// node, so a node that creates nothing pays for none of it.
//
// Dependency edges are Link records that sit in two doubly linked lists at
// once (the subscriber's dependencies and the dependency's subscribers), so a
// node that re-runs with the same dependencies reuses its links. User code can
// remove links while the engine walks them (a computed's run can dispose the
// effect reading it); a removed link is stamped, and every walk that runs user
// code checks the stamp before it moves on.
//
// A computed that nothing observes keeps its dependencies only until the
// current task ends: at the next microtask it lets go of them, so a long-lived
// signal does not retain it, and its next read recomputes it.
//
// link(), propagate() / markPending() / shallowPropagate(), checkDirty(), the
// release of unwatched computeds and the parent-first enqueue adapt algorithms
// from alien-signals (https://github.com/stackblitz/alien-signals):
//
//   MIT License
//
//   Copyright (c) 2024-present Johnson Chu
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.

import { __DEV__ } from '#env';
import { report, _setOwnerSource, nextBinding, clearNextBinding } from './diagnostics.js';

export { __DEV__ } from '#env';

// DevTools hooks — set by what-devtools when installed. Development only.
/** @type {WhatDevToolsHooks | null} */
export let __devtools = null;

// The hooks, kept once for every development tier of what-core the page
// loaded (dist/*.js and the source each hold a copy of this module): hooks
// installed through one reach the engine of each. Keyed by Symbol.for, so one
// realm has one.
const devtoolsSlot = __DEV__ ? /** @type {any} */ (globalThis)[Symbol.for('what.devtools.v1')] ??= { hooks: null, tiers: new Set() } : null;
if (__DEV__) {
  devtoolsSlot.tiers.add((hooks) => { __devtools = hooks; });
  __devtools = devtoolsSlot.hooks;
}

/** @internal Install devtools hooks. Called by what-devtools. */
export function __setDevToolsHooks(hooks) {
  if (__DEV__) {
    devtoolsSlot.hooks = hooks;
    for (const install of devtoolsSlot.tiers) install(hooks);
  }
}

// ---------------------------------------------------------------------------
// Flags (node.flags stays a small integer)
// ---------------------------------------------------------------------------
const COMPUTED = 1;    // node kind: computed (has deps and subs)
const EFFECT = 2;      // node kind: effect (has deps, is queued)
const DIRTY = 4;       // a direct dependency changed: must re-run
const PENDING = 8;     // an upstream computed may have changed: verify first
const RUNNING = 16;    // fn is on the stack; a computed also while it waits in `deferred`
const QUEUED = 32;     // effect is in a flush queue
const DISPOSED = 64;
const ERRORED = 128;   // computed: value holds the thrown error
const STABLE = 256;    // effect: re-runs keep the first run's dependencies
const USER = 512;      // effect: user phase (runs after render-phase effects)
const SELECTOR = 1024; // computed behind createSelector: a change notifies two keys
const KEYED = 2048;    // one key of a selector: a dependency, like a signal
const RELEASE = 4096;  // computed: queued to drop its dependencies if still unobserved
// Async values (see "Async computeds" below). Only nodes made by computed() from
// the root entry, and the effects that read them, ever carry these.
const ASYNC = 8192;        // computed: its function returned a promise or an async iterable
const WAITING = 16384;     // async computed: a run is in flight
const NOT_READY = 32768;   // computed: its last run read a value that was not ready; keeps its last value
const NO_VALUE = 65536;    // computed: no run has given it a value yet
const CAPABLE = 131072;    // computed: made by computed(); what its function returns may start a run
const ASKS = 262144;       // capable computed: its function takes `{ signal }`
const HELD = 524288;       // effect: a <Suspense> counts it as waiting until a run of it completes
const STAGED = 1048576;    // async computed: landed inside a transition that has not committed
// An owner record's own flag: it, or an owner linked below it, holds a
// useEffect or onMount (_userEffect), whose cleanups an unmount runs first.
const OWNS_USER = 2097152;

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
/** Node whose reads are being tracked (computed or effect), or null. @type {any} */
let activeSub = null;
/**
 * The owner record set explicitly (a root, a component, runWithOwner) that
 * receives new effects, computeds, roots and cleanups, unless a run started
 * inside it: see ownerNow(). @type {any}
 */
let currentOwner = null;
/** The run (effect or computed) that was innermost when currentOwner was set. @type {any} */
let ownerRun = null;
/** Effect whose fn is executing; untrack() does not clear it. Parent of new effects. @type {WhatEffectNode | null} */
let runningEffect = null;
let batchDepth = 0;
/** Bumped at the start of every tracked run; stamps links for de-duplication. */
let cycle = 0;

// Effect queues. Render-phase effects run first; user-phase effects run only
// when no render effect is queued, so they observe settled bindings. Within a
// queue, an effect's parent (the effect that was running when it was created)
// is always queued before it: a region re-runs, and disposes its children,
// before those children could run against data the region guards. An effect
// created while a user-phase effect runs is user-phase too, so the same holds
// across phases.
/** @type {WhatEffectNode[]} */
let queue = [];
let queueLen = 0;
/** @type {WhatEffectNode[]} */
let userQueue = [];
let userQueueLen = 0;
let flushing = false;
let flushScheduled = false;
const MAX_FLUSH_ROUNDS = 100;
// Development only, for the report of a loop: the effect of each run in the
// running flush, and the effects that wrote a signal in it. Both are reused
// from flush to flush, so a flush allocates no record of its own.
/** @type {(WhatEffectNode | null)[]} */
const devRan = [];
let devRanLen = 0;
/** @type {(WhatEffectNode | null)[]} */
const devWrote = [];
let devWroteLen = 0;

// Bounded stack for first evaluation. Computeds evaluating computeds recurse on
// the JS stack; updates never do (checkDirty is iterative), so only the first
// evaluation of a long chain can run deep. Past MAX_EVAL_DEPTH nested
// evaluations, a read is deferred: the node goes on `deferred`, every frame
// above it is abandoned (its run is void, it stays DIRTY), and the outermost
// read evaluates the deferred nodes deepest-first. A frame knows it is void
// because `deferred` grew during its run, so a try/catch around a read cannot
// change any value or error a reader sees. It can still see the deferral: its
// catch block runs once, in a run that is then discarded and repeated. That
// takes more than MAX_EVAL_DEPTH computeds evaluating one inside another, which
// only the first read of a chain that long does; effects never see it.
// A computed waiting on `deferred` is marked RUNNING, so a cycle that the
// deferral would otherwise hide still reads a running node and is reported.
const MAX_EVAL_DEPTH = 1000;
let evalDepth = 0;
/** @type {any[]} */
const deferred = [];
const DEFER = /* @__PURE__ */ Object.freeze({ toString: () => '[what] deferred evaluation' });

/** Reusable stack for the push phase (no user code runs during propagation). @type {any[]} */
const pushStack = [];

/** Selectors a write reached, settled before the write returns. @type {WhatSelectorNode[]} */
const selectorQueue = [];
let settlingSelectors = false;
// The rest of the selector code is reached only through these operations,
// which the first createSelector installs: an app that never creates a
// selector does not ship it.
/** @type {{ notify: typeof notifyKeys, settle: typeof settleSelectors, release: typeof releaseKey } | null} */
let selectorOps = null;

/** Computeds left without observers, released at the next microtask. @type {any[]} */
const releaseQueue = [];

// Signals and effects reach the pull phase (markPending, checkDirty,
// updateComputed and the deferral of deep chains) and the release of
// unobserved computeds only through these operations, which the first computed
// or selector installs: an app of signals and effects alone does not ship
// them.
/** @type {{ mark: typeof markPending, check: typeof checkEffect, unwatched: typeof unwatched, dispose: typeof disposeComputed, settle: typeof settleInputs, refresh: typeof refreshUntracked } | null} */
let pullOps = null;

function installPull() {
  if (pullOps === null) pullOps = { mark: markPending, check: checkEffect, unwatched, dispose: disposeComputed, settle: settleInputs, refresh: refreshUntracked };
}

// The async machinery is reached only through these operations, which the
// first async-capable computed() installs, so an app that never makes one does
// not ship it; the transition machinery likewise through `txOps`, installed by
// the first startTransition().
/** @type {any} */
let asyncOps = null;
/** @type {any} */
let txOps = null;
/** The transition whose function is running, or null. @type {any} */
let currentTx = null;
/** What a write with readers tells the transitions (installed with them). @type {((node: any) => void) | null} */
let onWrite = null;
/**
 * The node whose direct reads of an async value return its last value instead
 * of holding (useOptimistic's view, isPending's probe), or null. @type {any}
 */
let latestSub = null;

// Development-only change sequence behind cause attribution (devCauses).
let devSeq = 0;

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Record that `sub` read `dep` in the current run. */
function link(dep, sub) {
  const prevDep = sub.depTail;
  if (prevDep !== null && prevDep.dep === dep) return;          // repeated read
  const nextDep = prevDep !== null ? prevDep.nextDep : sub.depHead;
  if (nextDep !== null && nextDep.dep === dep) {                 // same order as last run
    nextDep.version = cycle;
    sub.depTail = nextDep;
    return;
  }
  const prevSub = dep.subTail;
  if (prevSub !== null && prevSub.version === cycle && prevSub.sub === sub) return;
  /** @type {WhatLink} */
  const l = { dep, sub, version: cycle, prevDep, nextDep, prevSub, nextSub: null };
  sub.depTail = l;
  dep.subTail = l;
  if (nextDep !== null) nextDep.prevDep = l;
  if (prevDep !== null) prevDep.nextDep = l; else sub.depHead = l;
  if (prevSub !== null) prevSub.nextSub = l; else dep.subHead = l;
}

/**
 * Remove a link from both lists and stamp it detached (version -1), so a walk
 * that still holds it can tell. Returns the next dependency link.
 */
function unlink(l) {
  const { dep, sub, prevDep, nextDep, prevSub, nextSub } = l;
  l.version = -1;
  if (nextDep !== null) nextDep.prevDep = prevDep; else sub.depTail = prevDep;
  if (prevDep !== null) prevDep.nextDep = nextDep; else sub.depHead = nextDep;
  if (nextSub !== null) nextSub.prevSub = prevSub; else dep.subTail = prevSub;
  if (prevSub !== null) prevSub.nextSub = nextSub;
  else if ((dep.subHead = nextSub) === null && (dep.flags & (COMPUTED | KEYED))) {
    if (dep.flags & KEYED) /** @type {any} */ (selectorOps).release(dep); else /** @type {any} */ (pullOps).unwatched(dep);
  }
  return nextDep;
}

// A computed that lost its last subscriber stops listening to its own
// dependencies, so long-lived signals do not retain it, and becomes DIRTY: the
// next read recomputes it. Iterative, so releasing a long chain uses no stack.
// One whose own run dropped its last reader is released once that run is over.
/** @type {WhatComputedNode[]} */
const unwatchedQueue = [];
let unwatching = false;
function unwatched(c) {
  if (c.depHead === null) return;
  unwatchedQueue.push(c);
  if (unwatching) return;
  unwatching = true;
  try {
    while (unwatchedQueue.length > 0) {
      const node = /** @type {WhatComputedNode} */ (unwatchedQueue.pop());
      if (node.subHead !== null) continue;
      if (node.flags & RUNNING) {
        if ((node.flags & RELEASE) === 0) scheduleRelease(node);
        continue;
      }
      node.flags = (node.flags & ~PENDING) | DIRTY;
      let d = node.depHead;
      while (d !== null) d = unlink(d);
    }
  } finally {
    unwatching = false;
  }
}

function scheduleRelease(c) {
  c.flags |= RELEASE;
  if (releaseQueue.push(c) === 1) queueMicrotask(releaseUnobserved);
}

// The release checkpoint. A computed still without subscribers (a selector:
// without keys) drops its dependencies. A disposed computed never changes
// again, so the edges its readers still hold to it are dropped too. It waits
// for a pending flush, whose effects may be about to read what was read before
// it.
function releaseUnobserved() {
  if (flushScheduled) {
    queueMicrotask(releaseUnobserved);
    return;
  }
  for (let i = 0; i < releaseQueue.length; i++) {
    const c = releaseQueue[i];
    const f = c.flags &= ~RELEASE;
    if (f & DISPOSED) {
      for (let l = c.subHead; l !== null;) {
        const next = l.nextSub;
        unlink(l);
        l = next;
      }
    } else if (c.subHead === null && (f & RUNNING) === 0 && ((f & SELECTOR) === 0 || c.keys.size === 0)) {
      unwatched(c);
    }
  }
  releaseQueue.length = 0;
}

/** Drop the dependencies a run did not read again (everything after depTail). */
function purgeDeps(sub) {
  const tail = sub.depTail;
  let l = tail !== null ? tail.nextDep : sub.depHead;
  while (l !== null) l = unlink(l);
}

function unlinkAllDeps(sub) {
  let l = sub.depHead;
  while (l !== null) l = unlink(l);
}

// ---------------------------------------------------------------------------
// Push phase
// ---------------------------------------------------------------------------

/** Subscribers of a changed signal: direct subs become DIRTY, the rest PENDING. */
function propagate(l) {
  do {
    const sub = l.sub;
    const f = sub.flags;
    if ((f & (DIRTY | DISPOSED)) === 0) {
      sub.flags = f | DIRTY;
      if ((f & PENDING) === 0) {                 // first time reached in this batch
        if (f & EFFECT) enqueue(sub);
        else if (sub.subHead !== null) /** @type {any} */ (pullOps).mark(sub.subHead);
        else if (f & SELECTOR) selectorQueue.push(sub);
      }
    }
  } while ((l = l.nextSub) !== null);
}

/** Iterative DFS marking PENDING; stops at nodes that are already marked. */
function markPending(l) {
  let sp = 0;
  for (;;) {
    const sub = l.sub;
    const f = sub.flags;
    if ((f & (DIRTY | PENDING | DISPOSED)) === 0) {
      sub.flags = f | PENDING;
      if (f & EFFECT) enqueue(sub);
      else if (sub.subHead !== null) {
        if (l.nextSub !== null) pushStack[sp++] = l.nextSub;
        l = sub.subHead;
        continue;
      } else if (f & SELECTOR) {
        selectorQueue.push(sub);
      }
    }
    if ((l = l.nextSub) !== null) continue;
    if (sp === 0) return;
    l = pushStack[--sp];
    pushStack[sp] = undefined;
  }
}

/** A computed's value changed: subscribers already PENDING are now DIRTY. */
function shallowPropagate(l) {
  do {
    const sub = l.sub;
    const f = sub.flags;
    if ((f & (PENDING | DIRTY)) === PENDING) sub.flags = f | DIRTY;
  } while ((l = l.nextSub) !== null);
}

// ---------------------------------------------------------------------------
// Pull phase
// ---------------------------------------------------------------------------

/**
 * `sub` is PENDING. Walk its dependencies depth-first: recompute upstream
 * computeds that are DIRTY, descend into those that are PENDING. Returns true
 * when one of sub's direct dependencies changed value. Iterative.
 *
 * A changed computed marks its other PENDING subscribers DIRTY; when the
 * walker is its only subscriber, the local `dirty` carries the change.
 *
 * Recomputing runs user code, which may detach the link the walk stands on (by
 * disposing `sub` or a node on the stack, or releasing one). The walk then
 * stops and answers true: a change it has seen goes to every remaining
 * subscriber and to the walker as DIRTY, and the caller re-runs the root,
 * which re-reads (and so re-validates) what it still depends on, or skips it
 * if it was disposed. A running computed is never recomputed (only a cycle
 * reaches one) and a disposed one never runs again.
 */
function checkDirty(l, sub) {
  /** @type {any[] | null} */
  let stack = null;
  let sp = 0;
  let dirty = false;
  top: for (;;) {
    const dep = l.dep;
    const df = dep.flags;
    if (sub.flags & DIRTY) {
      dirty = true;
    } else if ((df & (COMPUTED | DIRTY | RUNNING)) === (COMPUTED | DIRTY)) {
      if (updateComputed(dep)) {
        if (l.version === -1) return stopWalk(dep, sub);
        if (dep.subHead.nextSub !== null) shallowPropagate(dep.subHead);
        dirty = true;
      } else if (l.version === -1) {
        return true;
      }
    } else if ((df & (COMPUTED | PENDING)) === (COMPUTED | PENDING)) {
      if (stack === null) stack = [];
      stack[sp++] = l;
      l = dep.depHead;
      sub = dep;
      continue;
    }
    if (!dirty && l.nextDep !== null) {
      l = l.nextDep;
      continue;
    }
    // This level is decided. Unwind to the node that descended into `sub`.
    while (sp > 0) {
      l = /** @type {any[]} */ (stack)[--sp];
      if (dirty) {
        if ((sub.flags & (RUNNING | DISPOSED)) === 0 && updateComputed(sub)) {
          if (l.version === -1) return stopWalk(sub, l.sub);
          if (sub.subHead.nextSub !== null) shallowPropagate(sub.subHead);
          sub = l.sub;
          continue;                               // the parent's input changed too
        }
        if (l.version === -1) return true;
        dirty = false;
      } else {
        if (l.version === -1) return true;
        sub.flags &= ~PENDING;
      }
      sub = l.sub;
      if (l.nextDep !== null) {
        l = l.nextDep;
        continue top;
      }
    }
    return dirty;
  }
}

/** The walk lost its footing after `changed` changed: record that for `walker` and the others. */
function stopWalk(changed, walker) {
  if (changed.subHead !== null) shallowPropagate(changed.subHead);
  walker.flags |= DIRTY;
  return true;
}

/** Re-run a computed. Returns true when its value (or error) changed. */
function updateComputed(c) {
  const causes = __DEV__ && devTracksCauses() ? devCauses(c) : null;
  const seen = __DEV__ ? c.devSeen : undefined;
  if (__DEV__) c.devSeen = devSeq;
  if (c.owned !== null) disposeRun(c);
  const prevSub = activeSub;
  const mark = deferred.length;
  const oldFlags = c.flags;
  activeSub = c;
  ++cycle;
  const depth = evalDepth++;
  c.depTail = null;
  c.flags = (oldFlags & ~(DIRTY | PENDING | ERRORED | NOT_READY)) | RUNNING;
  let value;
  let threw = false;
  try {
    value = (oldFlags & CAPABLE) === 0 ? c.fn() : asyncOps.run(c, oldFlags);
  } catch (err) {
    value = err;
    threw = true;
  }
  activeSub = prevSub;
  evalDepth = depth;
  if (c.flags & DISPOSED) {                       // its own run disposed it
    unlinkAllDeps(c);
    if (c.owned !== null) disposeRun(c);
    return false;
  }
  purgeDeps(c);
  if (deferred.length !== mark) {
    // A deeper computed could not be evaluated on this stack, even if user code
    // caught DEFER: this run is void. Keep the old value and retry later.
    c.flags = (c.flags & ~RUNNING) | DIRTY | (oldFlags & ERRORED);
    if (__DEV__) c.devSeen = seen;
    throw DEFER;
  }
  if (__DEV__ && __devtools) devHook('onEffectRun', c, { causes });
  const old = c.value;
  if (threw) {
    // A value that is not ready yet, or what an async computed throws, is the
    // async machinery's (asyncOps.caught). Any other error is cached as the
    // value: every reader rethrows the same object until an input changes.
    if (asyncOps !== null) {
      const changed = asyncOps.caught(c, value, oldFlags);
      if (changed !== undefined) return changed;
    }
    c.flags = (c.flags & ~RUNNING) | ERRORED;
    if ((oldFlags & ERRORED) && old === value) return false;
  } else {
    c.flags &= ~(RUNNING | NO_VALUE);
    // A value after an error, or after an input that was not ready, is news
    // even when it equals the last one: readers whose runs were held must run.
    if ((oldFlags & (ERRORED | NOT_READY)) === 0 &&
        (old === value ? (old !== 0 || 1 / old === 1 / value) : (old !== old && value !== value))) {
      if (__DEV__ && __devtools?.trace) devHook('onComputedEqual', c);
      return false;
    }
  }
  c.value = value;
  if (__DEV__) {
    c.devSeq = ++devSeq;
    if (__devtools?.trace) devHook('onComputedChange', c);
  }
  if (c.flags & SELECTOR) /** @type {any} */ (selectorOps).notify(c, old, oldFlags);
  return true;
}

/**
 * Bring a DIRTY or PENDING computed up to date. Brought up to date for no
 * reader (outside any effect or computed, or untracked), it is observed by
 * nothing, so it lets go of its dependencies at the next checkpoint.
 */
function refresh(c) {
  if (evalDepth === 0) {
    deferred.push(c);
    settleDeferred();
  } else if (evalDepth >= MAX_EVAL_DEPTH) {
    c.flags |= RUNNING;
    deferred.push(c);
    throw DEFER;
  } else {
    refreshOne(c);
  }
  if (activeSub === null && c.subHead === null && (c.flags & (RELEASE | SELECTOR)) === 0 && c.depHead !== null) {
    scheduleRelease(c);
  }
}

function refreshOne(c) {
  const f = c.flags;
  if ((f & DIRTY) || ((f & PENDING) && checkDirty(c.depHead, c) && (c.flags & DISPOSED) === 0)) {
    if (updateComputed(c) && c.subHead !== null) shallowPropagate(c.subHead);
  } else {
    c.flags &= ~PENDING;
  }
}

/** Outermost evaluation: resolve deferred nodes, deepest first. */
function settleDeferred() {
  while (deferred.length > 0) {
    const n = deferred.length;
    const node = deferred[n - 1];
    const isEffect = (node.flags & EFFECT) !== 0;
    if (!isEffect) node.flags &= ~RUNNING;
    try {
      if (isEffect) {
        if ((node.flags & PENDING) && checkDirty(node.depHead, node)) node.flags |= DIRTY;
      } else if ((node.flags & (DIRTY | PENDING)) && !(node.flags & DISPOSED)) {
        refreshOne(node);
      }
    } catch (err) {
      if (err !== DEFER) {
        for (const waiting of deferred) if (!(waiting.flags & EFFECT)) waiting.flags &= ~RUNNING;
        deferred.length = 0;
        throw err;
      }
      if (!isEffect) node.flags |= RUNNING;      // waits for the deeper node
      continue;
    }
    deferred.length = n - 1;
  }
}

/** Whether an input of a PENDING effect really changed. */
function checkEffect(e) {
  try {
    return checkDirty(e.depHead, e);
  } catch (err) {
    if (err !== DEFER) throw err;
    // A dependency's re-run reached a never-evaluated deep chain. The effect
    // goes below the deferred nodes: it is checked again once they settle.
    deferred.unshift(e);
    settleDeferred();
    return (e.flags & DIRTY) !== 0 || ((e.flags & PENDING) !== 0 && checkDirty(e.depHead, e));
  }
}

/** A read of a stale computed; a running one is reading itself. */
function refreshRead(c) {
  if (c.flags & RUNNING) throw cycleError(c);
  refresh(c);
}

/** A computed read itself, directly or through other computeds. */
function cycleError(node) {
  return Object.assign(new Error(__DEV__
    ? `Computed "${devName(node)}" reads its own value, directly or through computeds that read it.`
    : '[what] Cycle detected: a computed reads its own value'), { code: 'ERR_COMPUTED_CYCLE' });
}

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

// Signal and computed functions share a prototype that supplies `_signal` and
// creates `set` / `peek` / `subscribe` / `mutate` on first access (detachable,
// and overridable, as own properties). A signal that is only called as s() /
// s(v) costs one function, its context and one node. Each prototype is made
// by the first signal or computed, so an app that never creates a computed
// does not carry the computed one.
const NODE = Symbol('what.node');
function lazyMethod(name, make) {
  return {
    configurable: true,
    /** @this {any} */
    get() {
      const f = make(this);
      Object.defineProperty(this, name, { value: f, writable: true, configurable: true });
      return f;
    },
    /** @this {any} */
    set(v) {
      Object.defineProperty(this, name, { value: v, writable: true, configurable: true });
    },
  };
}
/** @type {object | null} */
let signalProto = null;
/** @type {object | null} */
let computedProto = null;

function signalPrototype() {
  if (signalProto === null) {
    signalProto = Object.create(Function.prototype, {
      _signal: { value: true, writable: true, configurable: true },
      set: lazyMethod('set', (s) => (next) => s(next)),
      peek: lazyMethod('peek', (s) => { const node = s[NODE]; return () => node.value; }),
      subscribe: lazyMethod('subscribe', (s) => (fn) => effect(() => fn(s()))),
      mutate: lazyMethod('mutate', (s) => { const node = s[NODE]; return (fn) => mutateSignal(s, node, fn); }),
    });
  }
  return signalProto;
}

function computedPrototype() {
  if (computedProto === null) {
    computedProto = Object.create(Function.prototype, {
      _signal: { value: true, writable: true, configurable: true },
      peek: lazyMethod('peek', (read) => () => untrack(read)),
    });
  }
  return computedProto;
}

function writeSignal(sig, node, next) {
  if (__DEV__ && activeSub !== null && (activeSub.flags & COMPUTED)) devWriteInComputed(sig, activeSub);
  const prev = node.value;
  if (typeof next === 'function') next = next(prev);
  if (prev === next ? prev !== 0 || 1 / prev === 1 / next : prev !== prev && next !== next) return;
  node.value = next;
  notify(sig, node, prev);
}

// sig.mutate(fn): change the value in place, then notify as a write does,
// without the equality check a same-reference value would fail.
function mutateSignal(sig, node, fn) {
  if (__DEV__ && activeSub !== null && (activeSub.flags & COMPUTED)) devWriteInComputed(sig, activeSub);
  fn(node.value);
  notify(sig, node, node.value);
}

function notify(sig, node, prev) {
  if (__DEV__) {
    node.devSeq = ++devSeq;
    if (flushing && runningEffect !== null && devWrote[devWroteLen - 1] !== runningEffect) devWrote[devWroteLen++] = runningEffect;
    if (txOps !== null) devWriteAfterAwait(sig, node);
    if (__devtools) devHook('onSignalUpdate', sig, node.value, prev);
  }
  if (node.subHead !== null) {
    // A transition remembers what it wrote: an effect another open transition
    // holds that also reads it makes the two commit together.
    if (onWrite !== null) onWrite(node);
    propagate(node.subHead);
    if (selectorQueue.length !== 0) /** @type {any} */ (selectorOps).settle();
    if (batchDepth === 0 && !flushing) scheduleFlush();
  }
}

/** @returns {WhatSignalFunction} */
export function signal(initial, debugName) {
  /** @type {WhatSignalNode} */
  const node = { value: initial, subHead: null, subTail: null, flags: 0 };

  function sig(next) {
    if (arguments.length === 0) {
      if (activeSub !== null) link(node, activeSub);
      return node.value;
    }
    writeSignal(sig, node, next);
  }

  sig[NODE] = node;
  Object.setPrototypeOf(sig, signalPrototype());
  if (__DEV__) devSignal(sig, node, devNamed(debugName, arguments[2]));
  return /** @type {WhatSignalFunction} */ (/** @type {unknown} */ (sig));
}

/**
 * @internal A keyed list row's item (render.js): a signal node its row reads
 * with _readRowItem, replaced by the list with _setRowItem when the row's key
 * persists with another item. While the row is built (`building`), a read by
 * the code building it rather than by a binding of the row (a component's
 * prop, a statement in the row's body) subscribes nothing and records that the
 * row took the item as a value (`taken`): replacing its item cannot reach what
 * it built. A read of one field (`key`: the compiler's `row.name`, a live()
 * view's property) records that field only (`keys`): a replacement that
 * leaves every recorded field as it was keeps the row. `building` is true
 * from the cell's creation, the row's scope once that exists
 * (_createItemScope), and false when the row is built.
 * @param {any} item
 */
export function _rowItem(item) {
  return { value: item, subHead: null, subTail: null, flags: 0, builder: activeSub, building: true, taken: false, keys: null, fields: null };
}

// The field a read of a row's item is for, while a live() view reads one
// (_readKey); null while it only asks whether the item has a field (a peek,
// which records nothing); undefined otherwise.
/** @type {string | null | undefined} */
let readingKey;

/** @internal Read a list row's item (see _rowItem), for its field `key` when given. */
export function _readRowItem(node, key) {
  if (node.building && (activeSub === null || activeSub === node.builder)) {
    const field = key !== undefined ? key : readingKey;
    if (node.taken || field === null) { /* the whole item already, or a peek */ }
    else if (field === undefined) node.taken = true;
    else if (node.keys === null) node.keys = [field];
    else if (!node.keys.includes(field)) node.keys.push(field);
  } else if (activeSub !== null) link(node, activeSub);
  return node.value;
}

/**
 * @internal `read()` for the field `key` of what it returns (live.js): a row
 * item it reads while its row is built records that field, not the item.
 * `key` null: a peek, which records nothing (whether the value has a field).
 */
export function _readKey(key, read) {
  const outer = readingKey;
  readingKey = key;
  try {
    return read();
  } finally {
    readingKey = outer;
  }
}

// Whether a row whose building code read `keys` of its item reads the same
// values from `next`.
function sameKeys(keys, prev, next) {
  if (prev == null || next == null) return false;
  for (let i = 0; i < keys.length; i++) {
    if (!Object.is(prev[keys[i]], next[keys[i]])) return false;
  }
  return true;
}

/**
 * @internal Hand a list row its new item (see _rowItem). With `rebuildTaken`,
 * returns true instead when the row took its item as a value, or a field of it
 * the new item holds another value in, and has to be built again. `fields` holds the row's plain-field bindings (render.js
 * _$field, _$plain), four entries each (node, read, write, owner):
 * `write(fields, i, item, node)` shows the new item's value in the field at
 * `i` here, directly; a write that cannot show it (it returns false) also has
 * the row built again.
 */
export function _setRowItem(node, item, rebuildTaken) {
  const prev = node.value;
  if (prev === item) return false;
  if (rebuildTaken && (node.taken || (node.keys !== null && !sameKeys(node.keys, prev, item)))) return true;
  node.value = item;
  const fields = node.fields;
  if (fields !== null) {
    for (let i = 0; i < fields.length; i += 4) {
      if (!fields[i + 2](fields, i, item, node) && rebuildTaken) return true;
    }
  }
  notify(node, node, prev);
  return false;
}

/**
 * @internal Whether what is created under `owner` (what ownerNow gives, as
 * _effectWhenNeeded hands it on) lives exactly as long as the row that `cell`
 * holds the item of: the row is being built, and `owner` is its scope, or a
 * component with only components between it and that scope. A component is
 * disposed by its owner alone, unless it suspends while it is built (render.js
 * dropFailedFields lets go of what one bound), so nothing created there goes
 * before the row does; anything else between them (the run of an effect, a
 * boundary's arm, another list's row) can.
 */
export function _livesWithRow(cell, owner) {
  const scope = cell.building;
  for (let o = owner; o !== scope; o = o.owner) {
    if (o == null || o.Component === undefined) return false;
  }
  return true;
}

// What _readAlone tracks a read with: one node for every read, and disposed,
// so nothing is created under it and no write reaches it.
/** @type {any} */
const probe = { flags: DISPOSED, depHead: null, depTail: null };

/**
 * @internal `read()`, for a field of the row whose item `cell` holds
 * (render.js writePlain), creating nothing: its value when it read nothing
 * reactive but that item, else `_readAlone` itself, the value dropped. The
 * item is read as the code building a row reads it, recording nothing; what
 * else it read is let go of before this returns. A read that throws throws
 * here.
 */
export function _readAlone(read, cell) {
  const prevSub = activeSub;
  const { builder, building, taken } = cell;
  cell.builder = activeSub = probe;
  cell.building = cell.taken = true;
  ++cycle;
  try {
    const value = read();
    return probe.depHead === null ? value : _readAlone;
  } finally {
    activeSub = prevSub;
    cell.builder = builder;
    cell.building = building;
    cell.taken = taken;
    unlinkAllDeps(probe);
  }
}

// ---------------------------------------------------------------------------
// Computed / memo
// ---------------------------------------------------------------------------

function createComputedNode(fn) {
  installPull();
  /** @type {WhatComputedNode} */
  const node = {
    value: undefined,
    subHead: null, subTail: null,
    depHead: null, depTail: null,
    flags: COMPUTED | DIRTY | NO_VALUE,
    fn,
    owner: null,
    owned: null,
  };
  return node;
}

// A computed or selector belongs to the current owner, which disposes it. An
// owner that is already disposed never disposes again, so it does not take
// one: the node lives unowned, holding its dependencies only while observed.
// It still points at that owner, so what its runs create finds the handlers
// and context above it.
function own(node) {
  const now = ownerNow();
  if (now === null) return;
  const o = scopeOf(now);
  node.owner = o;
  if ((o.flags & DISPOSED) === 0) o.disposals.push(node);
}

/** @returns {WhatComputedFunction} */
function computedReader(node) {
  function read() {
    const f = node.flags;
    if (f & (DIRTY | PENDING | DISPOSED | RUNNING)) {
      // A disposed computed keeps its last value (or error) and never
      // subscribes again.
      if (f & DISPOSED) {
        if (f & ERRORED) throw node.value;
        return node.value;
      }
      refreshRead(node);
    }
    if (activeSub !== null) link(node, activeSub);
    if (node.flags & (ERRORED | NOT_READY)) return readFailed(node);
    return node.value;
  }
  Object.setPrototypeOf(read, computedPrototype());
  if (__DEV__) devComputed(read, node);
  return /** @type {WhatComputedFunction} */ (/** @type {unknown} */ (read));
}

// A computed whose last run threw, or read a value that was not ready. Only
// the async machinery marks the latter, so once installed it answers for both.
function readFailed(node) {
  if (asyncOps !== null) return asyncOps.read(node);
  throw node.value;
}

export function computed(fn) {
  const node = createComputedNode(fn);
  if (__DEV__ && arguments[1]) node.devName = arguments[1];
  own(node);
  return computedReader(node);
}

// memo(): a computed evaluated at creation. Subscribers re-run only when its
// value changes, and a read right after a write is fresh.
export function memo(fn) {
  const node = createComputedNode(fn);
  const read = computedReader(node);
  refresh(node);
  if (node.flags & ERRORED) {
    disposeComputed(node);                      // roll back the partial graph
    throw node.value;
  }
  own(node);
  if ((node.flags & RELEASE) === 0 && node.depHead !== null) scheduleRelease(node);
  return read;
}

function disposeComputed(c) {
  if (c.flags & DISPOSED) return;
  if (__DEV__ && __devtools) devHook('onEffectDispose', c);
  c.flags = DISPOSED | (c.flags & (ERRORED | RELEASE));
  unlinkAllDeps(c);
  if (c.owned !== null) disposeRun(c);
  if (c.subHead !== null && (c.flags & RELEASE) === 0) scheduleRelease(c);
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------
// The engine side of createSelector (selector.js). `source` is evaluated like a
// computed; a reader of isSelected(key) depends on a small key node instead of
// on the source. When a write reaches the source, the selector is brought up
// to date before the write returns, and only the key nodes for the old and the
// new value notify their readers: O(1) per change, and every read, including
// one through a computed, is fresh right after the write. A key node is
// dropped when its last reader goes; a selector with no keys left releases the
// source like an unobserved computed.

/** @returns {(key: any) => boolean} */
export function _createSelector(source) {
  if (selectorOps === null) selectorOps = { notify: notifyKeys, settle: settleSelectors, release: releaseKey };
  installPull();
  /** @type {WhatSelectorNode} */
  const s = {
    value: undefined,
    subHead: null, subTail: null,
    depHead: null, depTail: null,
    flags: COMPUTED | SELECTOR | DIRTY,
    fn: source,
    owner: null,
    owned: null,
    keys: new Map(),
  };
  own(s);
  return function isSelected(key) {
    const f = s.flags;
    if (f & (DIRTY | PENDING | DISPOSED | RUNNING)) {
      if ((f & DISPOSED) === 0) refreshRead(s);
    }
    if (activeSub !== null) {
      if ((s.flags & DISPOSED) === 0) {
        let k = s.keys.get(key);
        if (k === undefined) {
          /** @type {WhatKeyNode} */
          const node = { value: key, subHead: null, subTail: null, flags: KEYED, sel: s };
          s.keys.set(key, k = node);
        }
        link(k, activeSub);
      }
    } else if (s.keys.size === 0 && (s.flags & (RELEASE | DISPOSED)) === 0 && s.depHead !== null) {
      scheduleRelease(s);
    }
    if (s.flags & ERRORED) throw s.value;
    return key === s.value;
  };
}

/** The selector's value changed: the readers of the keys it left and entered re-run. */
function notifyKeys(s, old, oldFlags) {
  const keys = s.keys;
  if (keys.size === 0) return;
  if ((oldFlags | s.flags) & ERRORED) {
    // Every answer becomes, or stops being, the error.
    for (const k of keys.values()) if (k.subHead !== null) propagate(k.subHead);
  } else {
    let k = keys.get(old);
    if (k !== undefined && k.subHead !== null) propagate(k.subHead);
    k = keys.get(s.value);
    if (k !== undefined && k.subHead !== null) propagate(k.subHead);
  }
  if (selectorQueue.length !== 0) settleSelectors();
  if (batchDepth === 0 && !flushing) scheduleFlush();
}

function settleSelectors() {
  if (settlingSelectors) return;                // the outer loop takes new ones
  settlingSelectors = true;
  try {
    for (let i = 0; i < selectorQueue.length; i++) {
      const s = selectorQueue[i];
      if ((s.flags & (DIRTY | PENDING)) !== 0 && (s.flags & (RUNNING | DISPOSED)) === 0) {
        // A DEFER here comes from a write made at the stack bound: the
        // selector is on `deferred` and the outermost read settles it.
        try { refresh(s); } catch (err) { if (err !== DEFER) throw err; }
      }
    }
  } finally {
    selectorQueue.length = 0;
    settlingSelectors = false;
  }
}

function releaseKey(k) {
  const s = k.sel;
  if (s.keys.get(k.value) === k) s.keys.delete(k.value);
  if (s.keys.size === 0 && (s.flags & (RELEASE | DISPOSED)) === 0 && s.depHead !== null) scheduleRelease(s);
}

// ---------------------------------------------------------------------------
// Async computeds
// ---------------------------------------------------------------------------
// A computed made by the root entry's computed() (_asyncComputed) becomes
// async the first time its function returns a promise or an async iterable.
// It is CAPABLE: updateComputed runs it through asyncOps.run (capableRun),
// which starts a run for async work and throws STARTED, and its async state
// lives in `a`. Each evaluation is a run: it supersedes the run before it
// (whose result is dropped and whose AbortSignal is aborted) and is in flight
// (WAITING) until it lands. The node keeps its last value meanwhile, so a run
// that starts changes nothing for the engine: the readers a write marked find
// nothing new when they check, and keep what they show. A small effect of its
// own (its companion) reads it, so it fetches again when an input changes
// even when nothing else reads it.
//
// A run ends one way: its promise settles, its iterable yields or ends, or an
// answer already known replaces it (the function returned a plain value or
// threw, mutate() set one). Each way settles what waits for the outcome
// (settleOutcome): refresh() promises, and the NotReady a reader or a
// suspended component holds. The promise callbacks of a run hold only its
// flight record, which lets go of the computed when the run ends, so a
// promise nobody waits for any more retains nothing of it.
//
// Reading one:
//   tracked (an effect, a binding, a computed): a value that has not settled,
//     or is being fetched again, is not ready: the read throws a NotReady.
//     An effect or binding that catches it is held: it keeps what it
//     showed, stays subscribed, and runs again when the value lands. A
//     computed that catches it is NOT_READY: it keeps its last value (or,
//     with none yet, stays NO_VALUE), and its readers keep theirs.
//   untracked (an event handler, a component body, peek()): the last value
//     that landed; a NotReady only when none has.
// Plain signals and settled values are never held: reads stay fresh.
//
// A NotReady is a thenable that resolves when its value settles, so the
// renderers treat it like any thrown promise: the server waits for it, and a
// component body that throws one is retried in place.

/**
 * What a read of a value that is not ready throws. Thenable: it resolves (never
 * rejects) when the async computed it waits for settles or is disposed.
 */
class NotReady {
  /** @param {any} node */
  constructor(node) {
    this.node = node;
    this.done = false;
    /** @type {Promise<void> | null} */
    this.promise = null;
    /** @type {(() => void) | null} */
    this.resolve = null;
  }

  get name() { return 'NotReady'; }

  get message() { return '[what] An async value was read before it settled.'; }

  /** @param {any} [onFulfilled] @param {any} [onRejected] */
  then(onFulfilled, onRejected) {
    if (this.promise === null) {
      this.promise = new Promise((resolve) => {
        if (this.done) resolve();
        else this.resolve = resolve;
      });
    }
    return this.promise.then(onFulfilled, onRejected);
  }
}

function settleWait(w) {
  w.done = true;
  if (w.resolve !== null) w.resolve();
}

/** @internal True for what a read of a value that is not ready throws. */
export function _isNotReady(value) {
  return value instanceof NotReady;
}

// Bookkeeping, reached only through asyncOps.
/** Async computeds with a run in flight (settled() waits for none). */
let inFlight = 0;
/** Async iterables still being pulled: settled() waits until each has ended. */
let streams = 0;
/** Other work settled() waits for: what a <Suspense> waits on, and its reveal. */
let tracked = 0;
/** What an engine computed that is NOT_READY waits for. @type {WeakMap<any, NotReady> | null} */
let waitsOf = null;
/** The async computed behind each companion effect. @type {WeakMap<any, any> | null} */
let companionOf = null;
/** Effects that read pending(): a transition never holds them, so a pending indicator shows at once. @type {WeakSet<any> | null} */
let pendingReaders = null;
/** The pending-state node of an engine computed (one with no `a`), for isPending()'s readers. @type {WeakMap<any, any> | null} */
let pendsOf = null;
/** Where the async error an engine computed caches came from ({ node, run }). @type {WeakMap<any, any> | null} */
let sourcesOf = null;
// The error a read of a failed value threw last, and the async computed run
// that failed with it, so the error boundary that catches it knows what to
// fetch again (_errorSource). An error travels from the read to its handler
// synchronously, so the pair still describes it when the handler asks.
/** @type {any} */
let thrownError;
/** @type {{ node: any, run: number } | null} */
let thrownFrom = null;
// Once the error has reached its handler, the pair must not keep the failed
// run (and what its function holds) alive.
function forgetThrown() {
  thrownError = undefined;
  thrownFrom = null;
}
/** Called when the graph may have gone quiet: after a landing, a commit, a disposal. @type {Set<() => void> | null} */
let quietHooks = null;
let quietQueued = false;
/** What an async-capable computed's function throws once it has started a run. */
const STARTED = /* @__PURE__ */ Object.freeze({});

function installAsync() {
  if (asyncOps !== null) return;
  waitsOf = new WeakMap();
  companionOf = new WeakMap();
  pendingReaders = new WeakSet();
  pendsOf = new WeakMap();
  sourcesOf = new WeakMap();
  quietHooks = new Set();
  asyncOps = {
    run: capableRun,
    caught: asyncCaught,
    read: readAsync,
    held: holdEffect,
  };
}

function newRecord() {
  return {
    run: 0,
    /** @type {AbortController | null} */ ac: null,
    /** @type {{ c: any, iter: any } | null} */ flight: null,
    /** @type {NotReady | null} */ wait: null,
    /** @type {NotReady | null} */ upstream: null,
    /** @type {any} */ error: undefined,
    /** @type {{ node: any, run: number } | null} */ failure: null,
    /** @type {any} */ pend: null,
    /** @type {any} */ tx: null,
    /** @type {any} */ before: undefined,
    viewed: false,
    /** @type {Array<[(v: any) => void, (e: any) => void]> | null} */ waiters: null,
    tracking: false,
    /** @type {Map<any, any> | null} */ store: null,
    /** @type {any} */ key: null,
    owner: '',
    /** @type {(() => void) | null} */ stored: null,
    /** @type {any} */ companion: null,
  };
}

function recordOf(c) {
  return c.a !== null ? c.a : (c.a = newRecord());
}

// A capable computed's run, in updateComputed's place of its function: the
// user's function, with `{ signal }` when it takes one. A promise or an async
// iterable starts a run and throws STARTED (asyncCaught keeps the last
// value); a plain value is the value, and answers what waits for the
// computed's outcome. A run made void by a deferred evaluation (see
// MAX_EVAL_DEPTH) answers nothing: it is repeated. This frame sits between
// updateComputed's and the function's, so it counts as a level of its own
// toward MAX_EVAL_DEPTH (updateComputed restores the depth when it throws).
function capableRun(c, oldFlags) {
  const mark = deferred.length;
  ++evalDepth;
  const value = oldFlags & ASKS ? c.fn(runArg(c)) : c.fn();
  --evalDepth;
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    const thenable = typeof value.then === 'function';
    const make = thenable ? undefined : value[Symbol.asyncIterator];
    if (thenable || typeof make === 'function') {
      startRun(c, value, thenable ? null : make.call(value));
      throw STARTED;
    }
  }
  if ((oldFlags & (WAITING | NOT_READY | NO_VALUE)) !== 0 && deferred.length === mark) answeredNow(c, value);
  return value;
}

// A capable computed answered with a plain value while it waited (for a run,
// an input, or a first value). A run in flight gives way to it: it never
// lands, and the readers held on it run even if the value equals the last
// one. What waits for its outcome (refresh(), a component that suspended on
// it, a transition) has it now.
function answeredNow(c, value) {
  const a = c.a;
  if (a === null) return;
  if (c.flags & WAITING) {
    endFlight(a);
    inFlight--;
    c.flags &= ~WAITING;
    statusChanged(c);
    reach(c.subHead);
  }
  if (__DEV__) devAsyncState(c, 'ready');
  // A server render keeps it for the client like a value that landed, when
  // the function is one that fetches (it takes `{ signal }`, as every
  // resource's does); a plain derivation is computed again on the client.
  if (a.store !== null && (c.flags & ASKS) !== 0) seedOps.settled(a, value, false);
  settleOutcome(a, value, false);
  if (a.tx !== null) txOps.answered(c);
}

// A computed that has become async: it gets its companion, an effect owned
// like the computed that only reads it, so that it fetches again when an
// input changes even with no other reader. Disposing the owner disposes both
// and stops the run in flight.
function makeAsync(c) {
  const a = recordOf(c);
  c.flags |= ASYNC;
  if (a.companion !== null) return;
  const o = c.owner;
  if (o !== null && (o.flags & DISPOSED)) return;
  /** @type {WhatEffectNode} */
  const e = { fn: noop, depHead: null, depTail: null, flags: EFFECT | ASYNC, cleanup: null, owner: o, parent: null, owned: null };
  e.fn = () => { link(c, e); };
  a.companion = e;
  /** @type {WeakMap<any, any>} */ (companionOf).set(e, c);
  link(c, e);
  if (o !== null) o.disposals.push(() => { disposeEffect(e); asyncDisposed(c); });
}

// The argument a function that asks for one gets: the run's AbortSignal,
// aborted when a newer run supersedes this one or the computed is disposed.
// A tracking run (hydration) gets one that is aborted already.
function runArg(c) {
  const a = recordOf(c);
  if (a.ac !== null) a.ac.abort();
  const ac = a.ac = new AbortController();
  if (a.tracking) ac.abort();
  return { signal: ac.signal };
}

// A run starts: `promise`, or the iterator `iter` of an async iterable. Its
// callbacks hold the flight record `f`, which endFlight empties.
function startRun(c, promise, iter) {
  const a = recordOf(c);
  endFlight(a);
  a.run++;
  if ((c.flags & WAITING) === 0) inFlight++;
  makeAsync(c);
  c.flags |= WAITING;
  if (__DEV__) devAsyncState(c, c.flags & NO_VALUE ? 'unresolved' : 'pending', a.run);
  if (txOps !== null) txOps.attribute(c, a);
  if (a.store !== null) seedOps.pending(a);
  const f = a.flight = { c, iter };
  if (iter !== null) {
    streams++;
    pump(f, iter);
  } else {
    Promise.resolve(promise).then((v) => land(f, v, false, false), (e) => land(f, e, true, false));
  }
}

// Each value an async iterable yields lands; its end or failure ends the run.
// A next() that throws instead of returning is a failure like a rejection.
function pump(f, iter) {
  let step;
  try {
    step = iter.next();
  } catch (err) {
    step = Promise.reject(err);
  }
  Promise.resolve(step).then((s) => {
    const c = f.c;
    if (c === null) return;
    if (s.done) {
      // An iterable that ends before it yields lands undefined.
      if (c.flags & WAITING) land(f, undefined, false, false);
      else {
        endFlight(c.a);
        quietSoon();
      }
      return;
    }
    land(f, s.value, false, true);
    if (f.c !== null) pump(f, iter);
  }, (err) => land(f, err, true, false));
}

// The run in flight stops: it delivers nothing more. Its callbacks let go of
// the computed, and an async iterable is closed.
function endFlight(a) {
  const f = a.flight;
  if (f === null) return;
  a.flight = null;
  f.c = null;
  if (f.iter !== null) {
    const iter = f.iter;
    f.iter = null;
    streams--;
    closeIterator(iter);
  }
}

function closeIterator(iter) {
  try {
    if (typeof iter.return === 'function') Promise.resolve(iter.return()).catch(noop);
  } catch { /* closing a finished iterator */ }
}

function noop() {}

// updateComputed's answer for what a run threw: STARTED, a run started (the
// computed keeps its value: nothing changed); a NotReady makes the computed
// NOT_READY (it keeps its value, and readers holding nothing new are not
// disturbed); any other error of an async computed is its error, like a
// rejection. Undefined lets the engine cache an ordinary error.
function asyncCaught(c, err, oldFlags) {
  if (err === STARTED) {
    c.flags &= ~RUNNING;
    if ((oldFlags & (WAITING | NOT_READY)) === 0) statusChanged(c);
    return false;
  }
  if (err instanceof NotReady) {
    if (oldFlags & WAITING) {
      endFlight(c.a);
      inFlight--;
      if (__DEV__) c.devFlight = null;
    }
    c.flags = (c.flags & ~(RUNNING | WAITING)) | NOT_READY;
    // An engine computed (no `a`: useMemo, a store's derived value) keeps what
    // it waits for on the side.
    if (c.a !== undefined) recordOf(c).upstream = err;
    else /** @type {WeakMap<any, any>} */ (waitsOf).set(c, err);
    if ((oldFlags & (WAITING | NOT_READY)) === 0) statusChanged(c);
    return (oldFlags & ERRORED) !== 0;
  }
  if ((c.flags & ASYNC) === 0) {
    // An engine computed caching an async value's error keeps where it came
    // from, for the boundary that catches it from there.
    if (err === thrownError && thrownFrom !== null) /** @type {WeakMap<any, any>} */ (sourcesOf).set(c, thrownFrom);
    return undefined;
  }
  if (oldFlags & WAITING) {
    endFlight(c.a);
    inFlight--;
  }
  c.flags = (c.flags & ~(RUNNING | WAITING)) | ERRORED;
  failed(c, err);
  if (oldFlags & WAITING) {
    statusChanged(c);
    reach(c.subHead);
  }
  if (c.a.store !== null) seedOps.settled(c.a, err, true);
  settleOutcome(c.a, err, true);
  if (c.a.tx !== null) txOps.answered(c);
  return true;
}

function failed(c, err) {
  const a = c.a;
  a.error = err;
  a.failure = { node: c, run: a.run };
  if (__DEV__) {
    devAsyncState(c, 'errored', undefined, err);
    if (__devtools) _devError(err, { type: 'async', effect: c });
  }
}

// The outcome of a run is known: refresh() promises settle with it, and what
// waits for a value (a held reader, a suspended component) is released.
function settleOutcome(a, result, isError) {
  const waiters = a.waiters;
  if (waiters !== null) {
    a.waiters = null;
    for (const [resolve, reject] of waiters) (isError ? reject : resolve)(result);
  }
  if (a.wait !== null) {
    settleWait(a.wait);
    a.wait = null;
  }
}

// A run's result arrived (`more`: an iterable that goes on). A superseded or
// ended run, or one of a disposed computed, has an empty flight and is
// dropped. One that belongs to a transition lands through it (txLand).
// refresh() promises settle either way, so awaiting one inside the transition
// cannot wait for its own commit.
function land(f, result, isError, more) {
  const c = f.c;
  if (c === null) return;
  const a = c.a;
  if (!more) endFlight(a);
  settleOutcome(a, result, isError);
  if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'async:land', c, { run: a.run, errored: isError });
  if (a.tx !== null) txOps.land(c, result, isError);
  else apply(c, result, isError);
}

// A result becomes the computed's value (or error), and its readers run, as
// after a write.
function apply(c, result, isError) {
  const a = c.a;
  const f = c.flags;
  if (f & WAITING) inFlight--;
  if (isError) {
    c.flags = (f & ~(WAITING | NOT_READY)) | ERRORED;
    failed(c, result);
  } else {
    c.flags = f & ~(WAITING | NOT_READY | NO_VALUE | ERRORED);
    c.value = result;
    if (__DEV__) devAsyncState(c, 'ready');
  }
  if (__DEV__) {
    c.devSeq = ++devSeq;
    if (__devtools?.trace) devHook('onAsyncLanding', c);
  }
  if (a.store !== null) seedOps.settled(a, result, isError);
  reach(c.subHead);
  reach(a.pend !== null ? a.pend.subHead : null);
  quietSoon();
}

// The status a pending() or isPending() reader sees changed: a run started or
// stopped without landing, or a computed began to wait for an input.
function statusChanged(c) {
  const p = c.a != null ? c.a.pend : /** @type {WeakMap<any, any>} */ (pendsOf).get(c);
  if (p != null) reach(p.subHead);
}

// A change a run brought reaches its readers as a write does. It can happen
// while a reader is being brought up to date (a run that starts during its
// check): propagate marks that reader DIRTY without queueing it, as it is
// already in the flush, and the check that is running does not look again, so
// it is queued here.
function reach(head) {
  if (head === null) return;
  propagate(head);
  for (let l = head; l !== null; l = l.nextSub) {
    const s = l.sub;
    if ((s.flags & (EFFECT | DIRTY | QUEUED | RUNNING | DISPOSED)) === (EFFECT | DIRTY)) enqueue(s);
  }
  if (batchDepth === 0 && !flushing) scheduleFlush();
}

/** @param {any} node */
function readAsync(node) {
  const f = node.flags;
  if (f & (WAITING | NOT_READY)) {
    if (f & NO_VALUE) throw notReady(node, f);
    if (activeSub !== null && activeSub !== latestSub) throw waitOf(node, f);
  } else if (f & ERRORED) {
    if (f & ASYNC) {
      thrownError = node.a.error;
      thrownFrom = node.a.failure;
    } else {
      thrownError = node.value;
      thrownFrom = /** @type {WeakMap<any, any>} */ (sourcesOf).get(node) || null;
    }
    if (thrownFrom !== null) queueMicrotask(forgetThrown);
    throw thrownError;
  } else if (f & NO_VALUE) {
    throw notReady(node, f);
  }
  // useOptimistic's view shows what is committed: a value that landed inside
  // a transition still open is not, yet.
  if ((f & STAGED) && activeSub !== null && activeSub === latestSub) {
    node.a.viewed = true;
    return node.a.before;
  }
  return node.value;
}

// What a read of a value that has never landed throws. Read untracked in the
// body of the component that made the value it waits for, it is an error:
// suspending would run the component again, which would make the value again
// and fetch again, forever. (A server render finds the value in its store the
// second time.) A derived value waits for the value it reads, so the check is
// on the value that is fetching.
function notReady(node, f) {
  const w = waitOf(node, f);
  const src = w.node;
  if (activeSub === null && src.owner !== null && src.owner === ownerNow() &&
      src.owner.Component !== undefined && (src.a == null || src.a.store === null)) {
    const c = src.owner.Component;
    const component = c.displayName || c.name || 'Anonymous';
    if (__DEV__) report('ERR_ASYNC_READ_IN_BODY', { data: { component } });
    throw Object.assign(new Error(__DEV__
      ? `[what] Component "${component}" read an async value it made in its own body before the value landed. Read it in JSX, or make it outside the component.`
      : '[what] async value read in the body that made it'), { code: 'ERR_ASYNC_READ_IN_BODY' });
  }
  return w;
}

function waitOf(node, f) {
  if (f & NOT_READY) return node.a === undefined ? /** @type {WeakMap<any, any>} */ (waitsOf).get(node) : node.a.upstream;
  const a = recordOf(node);
  return a.wait !== null ? a.wait : (a.wait = new NotReady(node));
}

// An effect's run threw. A NotReady holds it: it keeps what it showed and its
// subscriptions, and runs again when what it read lands. The nearest Suspense
// is told; while it counts the effect as waiting (until it has shown its
// content once), it is told again when a run of it completes or fails, or
// when it is disposed. Any other error releases a counted effect.
function holdEffect(e, err) {
  if (!(err instanceof NotReady)) return false;
  if ((e.flags & HELD) === 0) {
    for (let o = e.owner; o != null; o = o.owner) {
      if ((o.flags & DISPOSED) === 0 && typeof o._onPending === 'function') {
        const release = o._onPending(e);
        if (typeof release === 'function') countHeld(e, release);
        break;
      }
    }
  }
  return true;
}

// A boundary counts `e` as waiting: its next run that does not end on a value
// that is not ready (or its disposal) tells the boundary, once. The function
// runs through a wrapper until then, so an effect no boundary counts pays
// nothing for it.
function countHeld(e, release) {
  e.flags |= HELD;
  const fn = e.fn;
  const done = () => {
    if ((e.flags & HELD) === 0) return;
    e.flags &= ~HELD;
    e.fn = fn;
    release(e);
  };
  const held = () => {
    let out;
    try {
      out = fn();
    } catch (err) {
      if (!(err instanceof NotReady)) done();
      throw err;
    }
    done();
    return out;
  };
  if (__DEV__) held.inner = fn;
  held.release = done;
  e.fn = held;
  if (e.owner !== null) scopeOf(e.owner).disposals.push(done);
}

function asyncDisposed(c) {
  const a = c.a;
  if (c.flags & WAITING) {
    c.flags &= ~WAITING;
    inFlight--;
  }
  if (a.ac !== null) {
    a.ac.abort();
    a.ac = null;
  }
  endFlight(a);
  // A pending refresh() resolves with the last value; what waits for a value
  // stops waiting.
  settleOutcome(a, c.value, false);
  if (a.tx !== null) txOps.drop(c);
  quietSoon();
}

// Look again once the flush this event scheduled (queued before) has run.
function quietSoon() {
  const hooks = /** @type {Set<() => void>} */ (quietHooks);
  if (quietQueued || hooks.size === 0) return;
  quietQueued = true;
  queueMicrotask(() => {
    quietQueued = false;
    for (const hook of [...hooks]) hook();
  });
}

// Server rendering: a run's state in the render's resource store, under the
// key the client looks it up by (what-core hydration-data.js), so a retried
// render finds the run instead of starting another, and the settled value is
// serialized for the client.
function storePending(a) {
  /** @type {Map<any, any>} */ (a.store).set(a.key, {
    status: 'pending',
    owner: a.owner,
    promise: new Promise((resolve) => { a.stored = resolve; }),
  });
}

function storeSettled(a, result, isError) {
  /** @type {Map<any, any>} */ (a.store).set(a.key, isError
    ? { status: 'error', error: result, owner: a.owner }
    : { status: 'ready', value: result, owner: a.owner });
  if (a.stored !== null) {
    const done = a.stored;
    a.stored = null;
    done();
  }
}

// The node behind a computed's pending state: only its subscriber list is
// used. An async-capable computed keeps it in `a`; an engine computed, which
// a pending reader can reach through, on the side.
function pendOf(c) {
  if (c.a === undefined) {
    const map = /** @type {WeakMap<any, any>} */ (pendsOf);
    let p = map.get(c);
    if (p === undefined) map.set(c, p = { value: false, subHead: null, subTail: null, flags: 0 });
    return p;
  }
  const a = recordOf(c);
  return a.pend !== null ? a.pend : (a.pend = { value: false, subHead: null, subTail: null, flags: 0 });
}

function refreshUntracked(c) {
  const sub = activeSub;
  activeSub = null;
  try {
    refresh(c);
  } finally {
    activeSub = sub;
  }
}

// Whether an async computed among `start` and what they read, through
// computeds, has a value and is fetching a new one (or waits for an input
// that is). The reader, if any, is subscribed to the pending state of every
// computed on the way, so it runs again when one starts or stops waiting
// (a computed that switches onto a value being fetched included).
function anyRefreshing(start, sub) {
  let found = false;
  const seen = new Set();
  const stack = start.slice();
  while (stack.length > 0) {
    const n = stack.pop();
    if ((n.flags & COMPUTED) === 0 || seen.has(n)) continue;
    seen.add(n);
    if (sub !== null) link(pendOf(n), sub);
    if (n.flags & ASYNC) {
      if ((n.flags & (DIRTY | PENDING)) && (n.flags & (RUNNING | DISPOSED)) === 0) refreshUntracked(n);
      if ((n.flags & (WAITING | NOT_READY)) !== 0 && (n.flags & NO_VALUE) === 0) found = true;
    }
    for (let l = n.depHead; l !== null; l = l.nextDep) stack.push(l.dep);
  }
  return found;
}

// A reader of pending state: an effect among them is never held by a
// transition.
function readsPending() {
  if (activeSub !== null && (activeSub.flags & EFFECT)) /** @type {WeakSet<any>} */ (pendingReaders).add(activeSub);
}

function pendingOf(node) {
  if (__DEV__ && activeSub === null) devUntrackedPending('pending()');
  readsPending();
  if ((node.flags & (DIRTY | PENDING)) && (node.flags & (RUNNING | DISPOSED)) === 0) {
    try { refreshUntracked(node); } catch (err) { if (err === DEFER) throw err; }
  }
  if (activeSub !== null) link(node, activeSub);
  return anyRefreshing([node], activeSub);
}

/**
 * @internal isPending(fn): whether an async computed that `fn` reads, directly
 * or through computeds, has a value and is fetching a new one. A reader is
 * subscribed to what `fn` reads and to their pending state.
 */
export function _isPending(fn) {
  if (__DEV__ && activeSub === null) devUntrackedPending('isPending()');
  readsPending();
  const sub = activeSub;
  const probe = createComputedNode(fn);
  const prevLatest = latestSub;
  latestSub = probe;
  try {
    refreshUntracked(probe);
  } finally {
    latestSub = prevLatest;
  }
  const start = [];
  for (let l = probe.depHead; l !== null; l = l.nextDep) {
    start.push(l.dep);
    if (sub !== null) link(l.dep, sub);
  }
  disposeComputed(probe);
  return anyRefreshing(start, sub);
}

// An async-capable computed: the node of the root entry's computed(), with
// its async state in `a`, made on first use.
function asyncCapableNode(fn) {
  installPull();
  return {
    value: undefined,
    subHead: null, subTail: null,
    depHead: null, depTail: null,
    flags: COMPUTED | DIRTY | NO_VALUE | CAPABLE | (fn.length > 0 ? ASKS : 0),
    fn,
    owner: null,
    owned: null,
    /** @type {any} */ a: null,
  };
}

/** @type {object | null} */
let asyncProto = null;

function asyncPrototype() {
  if (asyncProto === null) {
    asyncProto = Object.create(Function.prototype, {
      _signal: { value: true, writable: true, configurable: true },
      peek: lazyMethod('peek', (read) => { const node = read[NODE]; return () => peekAsync(node); }),
      pending: lazyMethod('pending', (read) => { const node = read[NODE]; return () => pendingOf(node); }),
    });
  }
  return asyncProto;
}

// peek(): the value without subscribing. An async computed's is the last value
// that landed (undefined before the first), whatever is in flight: it never
// throws or suspends.
function peekAsync(node) {
  if ((node.flags & (DIRTY | PENDING)) && (node.flags & (RUNNING | DISPOSED)) === 0) {
    try { refreshUntracked(node); } catch (err) { if (err === DEFER) throw err; }
  }
  const f = node.flags;
  if ((f & (ASYNC | NOT_READY)) === 0 && (f & ERRORED)) throw node.value;
  return node.value;
}

function asyncReader(node) {
  function read() {
    const f = node.flags;
    if (f & (DIRTY | PENDING | DISPOSED | RUNNING)) {
      // A disposed computed keeps its last value; an error stays its error
      // unless the computed was async (its value is then the last to land).
      if (f & DISPOSED) {
        if ((f & ERRORED) && node.a === null) throw node.value;
        return node.value;
      }
      refreshRead(node);
    }
    if (activeSub !== null) link(node, activeSub);
    if (node.flags & (ERRORED | NOT_READY | WAITING | NO_VALUE | STAGED)) return readAsync(node);
    return node.value;
  }
  read[NODE] = node;
  Object.setPrototypeOf(read, asyncPrototype());
  if (__DEV__) devComputed(read, node);
  return /** @type {WhatComputedFunction} */ (/** @type {unknown} */ (read));
}

// Is `fn` declared to be async: an async function or async generator, or one
// that asks for its run's AbortSignal? Those start when they are created.
const ASYNC_FN = /^Async(?:Generator)?Function$/;

/**
 * @internal The root entry's computed(), and createResource. `seed` is where
 * a server render or a hydrating client says it starts from:
 *   { value } / { error }  adopted from the server, with no fetch; unless
 *                          `track` is false, the function runs once with an
 *                          aborted signal to learn what it reads
 *   { store, key, owner }  a server render's resource store and this node's key
 */
export function _asyncComputed(fn, seed) {
  installAsync();
  const node = asyncCapableNode(fn);
  if (__DEV__ && arguments[2]) node.devName = arguments[2];
  own(node);
  const read = asyncReader(node);
  if ((seed == null || !seedOps.seed(node, seed, fn)) && (fn.length > 0 || ASYNC_FN.test(fn.constructor.name))) {
    refreshUntracked(node);
  }
  return read;
}

// Starting from a seed is reached only through these operations: a seed comes
// only from a server render or a hydration (hydration-data.js installs them
// when either starts), or from a query or createResource, which install them
// too. Only a server render's seed names its resource store, which the run
// keeps up to date (`store`, `pending`, `settled`), and only a server render
// installs those (_installStoreSeedOps), so a browser bundle does not carry
// them.
/** @type {any} */
let seedOps = null;

/** @internal Let async values start from a seed (see _asyncComputed). */
export function _installSeedOps() {
  if (seedOps === null) seedOps = { seed: seedFrom, store: null, pending: null, settled: null };
}

/** @internal A server render: async values also start from its resource store, and keep it up to date. */
export function _installStoreSeedOps() {
  _installSeedOps();
  seedOps.store = seedFromStore;
  seedOps.pending = storePending;
  seedOps.settled = storeSettled;
}

// Whether the seed gave `c` its state (else it starts like any other).
function seedFrom(c, seed, fn) {
  if (seed.store !== undefined) return seedOps.store(c, seed);
  adopt(c, seed, fn);
  return true;
}

function adopt(c, seed, fn) {
  const a = recordOf(c);
  c.flags &= ~DIRTY;
  makeAsync(c);
  if ('error' in seed) {
    c.flags |= ERRORED;
    a.error = seed.error;
    a.failure = { node: c, run: a.run };
    if (__DEV__) devAsyncState(c, 'errored', undefined, seed.error);
  } else {
    c.flags &= ~NO_VALUE;
    c.value = seed.value;
    if (__DEV__) devAsyncState(c, 'ready');
  }
  if (seed.track !== false) trackRun(c, fn);
}

// Learn what an adopted computed reads without fetching: run its function
// with an aborted signal and discard what it returns. An async generator's
// body runs only when it is pulled, so it is pulled once (the reads before
// its first await are tracked) and closed.
function trackRun(c, fn) {
  const a = recordOf(c);
  a.tracking = true;
  const prevSub = activeSub;
  activeSub = c;
  ++cycle;
  c.depTail = null;
  c.flags |= RUNNING;
  try {
    const value = fn.length > 0 ? fn(runArg(c)) : fn();
    if (value !== null && typeof value === 'object') {
      if (typeof value.then === 'function') {
        Promise.resolve(value).catch(noop);
      } else if (typeof value[Symbol.asyncIterator] === 'function') {
        const iter = value[Symbol.asyncIterator]();
        Promise.resolve(iter.next()).then(() => closeIterator(iter), noop);
      }
    }
  } catch { /* an input not ready, or an error: what it read so far is tracked */ }
  activeSub = prevSub;
  c.flags &= ~RUNNING;
  a.tracking = false;
  purgeDeps(c);
}

function seedFromStore(c, { store, key, owner }) {
  const a = recordOf(c);
  a.store = store;
  a.key = key;
  a.owner = owner;
  const entry = store.get(key);
  if (entry === undefined) return false;
  c.flags &= ~DIRTY;
  makeAsync(c);
  if (entry.status === 'pending') {
    // A run an earlier attempt of this render started: wait for it.
    a.run++;
    c.flags |= WAITING;
    inFlight++;
    const f = a.flight = { c, iter: null };
    entry.promise.then(() => {
      const done = store.get(key);
      land(f, done.status === 'ready' ? done.value : done.error, done.status !== 'ready', false);
    });
    return true;
  }
  if (entry.status === 'ready') {
    c.flags &= ~NO_VALUE;
    c.value = entry.value;
  } else {
    c.flags |= ERRORED;
    a.error = entry.error;
    a.failure = { node: c, run: a.run };
  }
  return true;
}

/**
 * @internal refresh(computed): run it again now, superseding a run in flight.
 * Its readers see it as pending (once it has a value) until the new value
 * lands (inside an open transition too, before it commits), and they are
 * reached as by a write of an input: inside a transition they are held, and
 * an answer it gives at once (a value, an error) reaches them. Resolves with
 * the value of the run, or rejects with its error.
 */
export function _refresh(read) {
  const node = typeof read === 'function' ? read[NODE] : undefined;
  if (node === undefined || (node.flags & COMPUTED) === 0) {
    throw new TypeError(__DEV__
      ? '[what] refresh(x) needs a computed made by computed() from what-framework, e.g. refresh(users).'
      : '[what] refresh: not a computed');
  }
  if (node.flags & (DISPOSED | RUNNING)) return Promise.resolve(node.value);
  node.flags |= DIRTY;
  if (node.subHead !== null) {
    markPending(node.subHead);
    if (batchDepth === 0 && !flushing) scheduleFlush();
  }
  refreshUntracked(node);
  const f = node.flags;
  if ((f & (WAITING | NOT_READY)) === 0 || node.a === undefined) {
    if (f & ERRORED) return Promise.reject(f & ASYNC ? node.a.error : node.value);
    return Promise.resolve(node.value);
  }
  const a = recordOf(node);
  return new Promise((resolve, reject) => {
    (a.waiters || (a.waiters = [])).push([resolve, reject]);
  });
}

/**
 * @internal The status of an async computed, read reactively: 'unresolved',
 * 'pending', 'ready' or 'errored', with its error. createResource's loading()
 * and error() are built on it.
 */
export function _asyncStatus(read) {
  const node = read[NODE];
  if ((node.flags & (DIRTY | PENDING)) && (node.flags & (RUNNING | DISPOSED)) === 0) {
    try { refreshUntracked(node); } catch (err) { if (err === DEFER) throw err; }
  }
  if (activeSub !== null) link(pendOf(node), activeSub);
  const f = node.flags;
  if (f & (WAITING | NOT_READY)) return f & NO_VALUE ? 'unresolved' : 'pending';
  if (f & ERRORED) return 'errored';
  return f & NO_VALUE ? 'unresolved' : 'ready';
}

/** @internal createResource's error(): the error of the last run, or null. */
export function _asyncError(read) {
  const node = read[NODE];
  return node.flags & ERRORED ? (node.flags & ASYNC ? node.a.error : node.value) : null;
}

/**
 * @internal createResource's mutate(): make `value` the computed's value now,
 * as a landing would. A run in flight is superseded (its request aborted), and
 * what waits for it has the value: refresh() promises, and a transition the
 * run belonged to, which stops waiting for it.
 */
export function _setAsyncValue(read, value) {
  const node = read[NODE];
  if (node.flags & DISPOSED) return;
  makeAsync(node);
  const a = node.a;
  if (node.flags & WAITING) {
    if (a.ac !== null) a.ac.abort();
    endFlight(a);
  }
  settleOutcome(a, value, false);
  if (a.tx !== null) txOps.drop(node);
  apply(node, value, false);
}

/**
 * @internal Where the error a read just threw came from, for the boundary
 * that catches it: the async computed run that failed with it, or null.
 */
export function _errorSource(err) {
  return err === thrownError ? thrownFrom : null;
}

/**
 * @internal An error boundary's reset: fetch again the async computed runs
 * whose errors it caught (see _errorSource), unless one has run again since.
 */
export function _retryErrors(sources) {
  // A caught error has a source only once a computed exists, which installed
  // the pull phase: a boundary in an app without one does not carry it.
  if (pullOps === null) return;
  for (const s of sources) {
    const node = s.node;
    if ((node.flags & (ERRORED | DISPOSED)) === ERRORED && node.a.run === s.run) {
      node.flags |= DIRTY;
      pullOps.refresh(node);
    }
  }
}

/**
 * @internal Count work settled() waits for until the returned function is
 * called (once; later calls do nothing).
 */
export function _beginWork() {
  installAsync();
  tracked++;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    tracked--;
    quietSoon();
  };
}

/**
 * @internal Count `promise` as work settled() waits for until it settles (a
 * thenable a <Suspense> waits on).
 */
export function _trackWork(promise) {
  const done = _beginWork();
  promise.then(done, done);
}

/** @internal Run `hook` whenever the graph may have gone quiet. Returns the remover. */
export function _onQuiet(hook) {
  installAsync();
  const hooks = /** @type {Set<() => void>} */ (quietHooks);
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

/**
 * @internal 0 when nothing is queued, flushing, in flight or open; 1 when only
 * effects are queued to run (a flush is on its way: one is scheduled here if
 * the code that queued them did not); 2 while an async computed is fetching,
 * an async iterable is being pulled, a transition is open or a <Suspense>
 * waits.
 */
export function _busy() {
  if (inFlight !== 0 || streams !== 0 || tracked !== 0 || opened.size !== 0) return 2;
  if (queueLen === 0 && userQueueLen === 0 && !flushScheduled && !flushing) return 0;
  if (batchDepth === 0 && !flushing) scheduleFlush();
  return 1;
}

/**
 * @internal A computed (useOptimistic's view) whose function's direct reads of
 * async values return their last value while a new one is fetched, and their
 * committed value while one that landed inside a transition waits for its
 * commit, so what it adds on top shows at once.
 */
export function _latestComputed(fn) {
  const node = createComputedNode(fn);
  node.fn = () => {
    const prev = latestSub;
    latestSub = node;
    try {
      return fn();
    } finally {
      latestSub = prev;
    }
  };
  own(node);
  const read = computedReader(node);
  read[NODE] = node;
  return read;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
// startTransition(fn): every effect a write inside `fn` reaches waits until
// the async work those writes caused has landed; then all of it commits
// together, in one flush. A result that lands while the transition is open
// lands inside it: the effects it reaches wait too, and the async values it
// makes fetch again join it. Optimistic overlays drop in the same commit. A
// write outside `fn` in the same tick commits as usual, unless it reaches an
// effect the transition already holds, which then commits with it.
//
// Holding is taking out of the flush queue (capture): the effects a write
// inside the transition queued are moved to the transition, still marked
// QUEUED, so neither a write outside it nor the enqueue of a child effect
// queues them again before the commit. So that the effects `fn`'s writes
// reach are queued by those writes, what earlier writes queued is flushed
// first, when a flush may start there; inside a flush, a batch() or an effect,
// an effect an earlier write queued already is not held. An async computed's
// companion is never held: it starts the fetch.
//
// Attribution: a run started by a write inside `fn`, by a refresh inside it,
// or while its async function is still running (after an `await`) belongs to
// the transition. Before it commits, the computeds its held effects read that
// its writes made dirty are brought up to date inside it, so a run they start
// then (a computed that answered synchronously until now) belongs to it too.
// Two transitions that share a run in flight are merged and commit together,
// so a newer one supersedes an older one for the same state: the older state
// never shows. So are two that reach one effect: one holds it, and the other
// wrote something it reads (entangled). Without an async context, a run
// started during the async part of one is attributed to every transition
// whose async function is running then.

/** Transitions not committed yet (one merged into another is not counted). @type {Set<any>} */
const opened = /* @__PURE__ */ new Set();
/** Effects an urgent write queued inside a capture: they are not held. @type {Set<any>} */
const urgent = /* @__PURE__ */ new Set();
/** Transitions whose async function is still running. @type {Set<any>} */
const actionTxs = /* @__PURE__ */ new Set();
/** The transition that holds each held effect (merged ones resolve through txRoot). @type {WeakMap<any, any> | null} */
let heldIn = null;
/** Development: a transition's commit is running its held effects. */
let devCommitting = 0;

// What the async machinery calls on a computed that a transition waits for
// (`a.tx`) or on a run that is starting. A transition exists only once
// startTransition() has installed these.
function installTx() {
  if (txOps !== null) return;
  installAsync();
  heldIn = new WeakMap();
  onWrite = wrote;
  txOps = { attribute, land: txLand, drop: txDrop, answered };
}

function newTx() {
  const t = {
    /** @type {Set<any>} */ pending: new Set(),
    /** @type {Set<any>} */ held: new Set(),
    /** @type {Set<any>} */ staged: new Set(),
    /** @type {Set<any>} */ writes: new Set(),
    /** @type {Array<() => void>} */ onCommit: [],
    /** @type {any[]} */ calls: [],
    open: 0,
    actions: 0,
    /** @type {any} */ into: null,
    done: false,
    committing: false,
  };
  opened.add(t);
  return t;
}

function txRoot(t) {
  while (t.into !== null) t = t.into;
  return t;
}

function merge(a, b) {
  a = txRoot(a);
  b = txRoot(b);
  if (a === b) return a;
  for (const c of b.pending) a.pending.add(c);
  for (const e of b.held) a.held.add(e);
  for (const c of b.staged) a.staged.add(c);
  for (const n of b.writes) a.writes.add(n);
  a.onCommit.push(...b.onCommit);
  a.calls.push(...b.calls);
  a.open += b.open;
  a.actions += b.actions;
  if (actionTxs.delete(b) && a.actions > 0) actionTxs.add(a);
  b.into = a;
  opened.delete(b);
  if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'transition:merged', b, { into: a });
  return a;
}

// A signal written: the transition whose function is running records it.
function wrote(node) {
  if (currentTx !== null) txRoot(currentTx).writes.add(node);
}

// The transition a run now starting belongs to, if any (see Attribution).
function attribute(c, a) {
  let t = a.tx !== null ? txRoot(a.tx) : null;
  if (t !== null && t.done) t = null;
  if (currentTx !== null) t = t === null ? txRoot(currentTx) : merge(t, currentTx);
  for (const w of actionTxs) t = t === null ? w : merge(t, w);
  if (t !== null) t = txRoot(t);
  a.tx = t;
  if (t !== null) {
    t.pending.add(c);
    if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'transition:held', t, t);
  }
}

// A run of `c` that transition `a.tx` waits for landed. If the transition is
// still open it lands inside it: what it reaches on screen is held with the
// rest of the transition, and the async values it makes fetch again (a team
// that depends on a user) join it, so the transition commits once those have
// landed too. Until the commit, useOptimistic's view reads the value it had
// before (STAGED), so an overlay shows on top of what is committed.
function txLand(c, result, isError) {
  const a = c.a;
  const t = txRoot(a.tx);
  a.tx = null;
  if (t.done) {
    apply(c, result, isError);
    return;
  }
  if (!isError && (c.flags & (NO_VALUE | STAGED)) === 0) {
    a.before = c.value;
    c.flags |= STAGED;
    t.staged.add(c);
  }
  capture(t, () => apply(c, result, isError));
  t.pending.delete(c);
  if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'transition:held', t, t);
  maybeCommit(t);
}

// The transition `c` belongs to stops waiting for it: it was disposed, or
// answered without a run in flight.
function txDrop(c) {
  const a = c.a;
  const t = txRoot(a.tx);
  a.tx = null;
  t.pending.delete(c);
  if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'transition:held', t, t);
  maybeCommit(t);
}

// An async computed that a transition waited for answered without a run in
// flight (a plain value, an error, nothing to fetch): the transition stops
// waiting for it, unless it waits for an input that is not ready.
function answered(c) {
  if ((c.flags & (WAITING | NOT_READY)) === 0) txDrop(c);
}

// Run `fn` (writes, or a landing) for transition `t` with no flush starting
// inside it, then move the effects it queued to `t`. An async computed's
// companion stays queued, and the run it starts belongs to `t`.
function capture(t, fn) {
  const fromRender = queueLen;
  const fromUser = userQueueLen;
  const prev = currentTx;
  currentTx = t;
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    currentTx = prev;
    t = txRoot(t);
    queueLen = keep(t, queue, fromRender, queueLen);
    userQueueLen = keep(t, userQueue, fromUser, userQueueLen);
    if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'transition:held', t, t);
    if (batchDepth === 0) urgent.clear();
    if (batchDepth === 0 && !flushing) scheduleFlush();
  }
}

// Of list[from..to), keep the companions in place and hand the rest to `t`.
// Returns the new length.
function keep(t, list, from, to) {
  let n = from;
  for (let i = from; i < to; i++) {
    const e = list[i];
    if (urgent.has(e) || /** @type {WeakSet<any>} */ (pendingReaders).has(e)) {
      list[n++] = e;
    } else if (e.flags & ASYNC) {
      const node = /** @type {WeakMap<any, any>} */ (companionOf).get(e);
      const a = node.a;
      a.tx = a.tx === null || txRoot(a.tx).done ? t : merge(a.tx, t);
      list[n++] = e;
    } else {
      t.held.add(e);
      /** @type {WeakMap<any, any>} */ (heldIn).set(e, t);
    }
  }
  for (let i = n; i < to; i++) list[i] = undefined;
  return n;
}

// A transition with nothing left to wait for commits on the next microtask:
// after the flush that starts whatever its last landing made fetch again
// (which then joins it), and never in the middle of an evaluation or a flush.
function maybeCommit(t) {
  if (t.done || t.committing || t.pending.size > 0) return;
  if (t.open > 0) {
    if (t.open === t.actions) settleJoined(t);
    return;
  }
  t.committing = true;
  queueMicrotask(() => {
    t.committing = false;
    commit(t);
  });
}

// Only async actions keep `t` open, and nothing else it waits for is left:
// the calls that joined it (a transition started inside an action, or one
// entangled with it) resolve now, and commit with the actions. An action that
// awaits one, as `await navigate()` does, would otherwise wait for its own
// commit.
function settleJoined(t) {
  let n = 0;
  for (const call of t.calls) {
    if (call.acting || call.failed) t.calls[n++] = call;
    else call.settle();
  }
  t.calls.length = n;
}

function commit(t) {
  if (t.done || t.into !== null || t.open > 0 || t.pending.size > 0) return;
  discover(t);
  if (t.open > 0 || t.pending.size > 0) return;
  if (opened.size > 1) {
    const other = entangled(t);
    if (other !== null) {
      maybeCommit(merge(t, other));
      return;
    }
  }
  t.done = true;
  opened.delete(t);
  if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'transition:commit', t, t);
  if (__DEV__) devCommitting++;
  try {
    // One commit: overlays drop, staged values become what the optimistic
    // view reads, and held effects run, with what landed inside. Every held
    // effect is unmarked before any is queued, so each is queued after the
    // held effects above it, as a flush queue orders them.
    batch(() => {
      for (const fn of t.onCommit) fn();
      for (const c of t.staged) unstage(c);
      for (const e of t.held) e.flags &= ~QUEUED;
      for (const e of t.held) {
        if ((e.flags & (DISPOSED | QUEUED)) === 0 && (e.flags & (DIRTY | PENDING))) enqueue(e);
      }
    });
  } finally {
    if (__DEV__) devCommitting--;
  }
  for (const call of t.calls) call.settle();
  quietSoon();
}

// Before `t` commits: bring the computeds its held effects read, that its
// writes made dirty, up to date inside it, so a run one starts now belongs to
// `t`. A held effect that reads, directly or through computeds, a value with
// a run in flight would only be held again after the commit, so `t` waits for
// that run too: a run no open transition has (one a pending indicator
// started), or one another transition has, which then commits with `t`.
function discover(t) {
  capture(t, () => {
    for (const e of t.held) {
      if (e.flags & DISPOSED) continue;
      for (let l = e.depHead; l !== null; l = l.nextDep) {
        const d = l.dep;
        if ((d.flags & COMPUTED) !== 0 && (d.flags & (DIRTY | PENDING)) !== 0 && (d.flags & (RUNNING | DISPOSED)) === 0) {
          try { refresh(d); } catch (err) { if (err !== DEFER) throw err; }
        }
      }
    }
  });
  const seen = new Set();
  for (const e of txRoot(t).held) {
    if (e.flags & DISPOSED) continue;
    const stack = [e];
    while (stack.length > 0) {
      const n = stack.pop();
      for (let l = n.depHead; l !== null; l = l.nextDep) {
        const d = l.dep;
        if ((d.flags & COMPUTED) === 0 || seen.has(d)) continue;
        seen.add(d);
        if (d.flags & WAITING) {
          const a = d.a;
          const u = a.tx !== null ? txRoot(a.tx) : null;
          const r = txRoot(t);
          if (u === null || u.done) {
            a.tx = r;
            r.pending.add(d);
          } else if (u !== r) {
            merge(r, u);
          }
        }
        stack.push(d);
      }
    }
  }
}

// Another open transition that reaches an effect along with `t`: it wrote
// something an effect `t` holds reads, or holds an effect that reads
// something `t` wrote. Or null.
function entangled(t) {
  for (const u of opened) {
    if (u === t) continue;
    if (u.writes.size > 0 && holdsReader(t, u.writes)) return u;
    if (t.writes.size > 0 && holdsReader(u, t.writes)) return u;
  }
  return null;
}

// Whether an effect `t` holds reads, directly or through computeds, one of `nodes`.
function holdsReader(t, nodes) {
  const seen = new Set();
  for (const e of t.held) {
    if (e.flags & DISPOSED) continue;
    const stack = [e];
    while (stack.length > 0) {
      const n = stack.pop();
      for (let l = n.depHead; l !== null; l = l.nextDep) {
        const d = l.dep;
        if (nodes.has(d)) return true;
        if ((d.flags & COMPUTED) !== 0 && !seen.has(d)) {
          seen.add(d);
          stack.push(d);
        }
      }
    }
  }
  return false;
}

// A value that landed inside a transition is committed: the optimistic views
// that read the value from before see the new one.
function unstage(c) {
  const a = c.a;
  c.flags &= ~STAGED;
  a.before = undefined;
  if (a.viewed) {
    a.viewed = false;
    reach(c.subHead);
  }
}

/**
 * @internal startTransition(fn, onStart?). `onStart(t, call)` runs before
 * `fn`, outside the transition: what it writes shows at once (useTransition's
 * isPending, an optimistic overlay), `call.abandon()` stops waiting for an
 * async `fn` (also before it has returned), and `call.owner`, if it sets one,
 * is where a rejection goes (the nearest error boundary above it). Returns a
 * promise that resolves when the transition commits, and rejects with what an
 * async `fn` rejected with (after the commit). A synchronous throw from `fn`
 * is rethrown.
 */
export function _startTransition(fn, onStart) {
  installTx();
  const outer = currentTx;
  if (outer === null && !flushing && batchDepth === 0 && runningEffect === null && evalDepth === 0) flush();
  const t = outer !== null ? txRoot(outer) : newTx();
  if (__DEV__ && outer === null && __devtools?.onRecord) devHook('onRecord', 'transition:open', t, ownerNow());
  t.open++;
  const call = { error: undefined, failed: false, acting: false, gone: false, owner: null, settle: noop, abandon: noop };
  const done = new Promise((resolve, reject) => {
    call.settle = () => {
      if (!call.failed) {
        resolve(undefined);
        return;
      }
      // As in React 19, the error boundary above the component whose
      // transition it was shows the error. The promise still rejects, but is
      // not reported as unhandled once a boundary took the error.
      if (call.owner !== null && _handleError(call.owner, call.error) === HANDLED) done.catch(noop);
      reject(call.error);
    };
  });
  // What an async fn's promise reports to, until the call is over: a promise
  // that never settles must not keep the call (its owner) or the transition alive.
  /** @type {{ call: typeof call | null }} */
  const link = { call };
  call.abandon = () => {
    link.call = null;
    call.gone = true;
    if (!call.acting) return;
    call.acting = false;
    endAction(t);
  };
  t.calls.push(call);
  if (onStart !== undefined) _urgent(() => onStart(t, call));
  /** @type {any} */
  let result;
  try {
    capture(t, () => { result = fn(); });
  } catch (err) {
    queueMicrotask(() => closeTx(t));
    throw err;
  }
  let thenable;
  try {
    thenable = result != null && typeof result.then === 'function';
  } catch (err) {
    // A `then` getter that throws makes a rejected result, as Promise.resolve()
    // reads it.
    result = Promise.reject(err);
    thenable = true;
  }
  if (thenable) {
    settleWith(result, link);
    // An async fn keeps the transition open until it settles, unless what
    // started it left first (in fn's synchronous part included).
    if (!call.gone) {
      const r = txRoot(t);
      r.open++;
      r.actions++;
      actionTxs.add(r);
      call.acting = true;
    }
  }
  // The sync part ends after the flush its writes scheduled, which starts the
  // async work they caused.
  queueMicrotask(() => closeTx(t));
  return done;
}

// Its own scope, so the callbacks hold `link` and nothing else.
function settleWith(result, link) {
  Promise.resolve(result).then(() => {
    if (link.call !== null) link.call.abandon();
  }, (err) => {
    const call = link.call;
    if (call === null) return;
    call.failed = true;
    call.error = err;
    call.abandon();
  });
}

function closeTx(t) {
  const r = txRoot(t);
  r.open--;
  maybeCommit(r);
}

function endAction(t) {
  const r = txRoot(t);
  r.open--;
  if (--r.actions === 0) actionTxs.delete(r);
  maybeCommit(r);
}

/** @internal The transition whose function is running, or null. */
export function _currentTransition() {
  return currentTx;
}

/** @internal Run `fn` when transition `t` commits, inside the commit. */
export function _onCommit(t, fn) {
  txRoot(t).onCommit.push(fn);
}

/** @internal Run `fn` outside the running transition: its writes show at once. */
export function _urgent(fn) {
  const prev = currentTx;
  const fromRender = queueLen;
  const fromUser = userQueueLen;
  currentTx = null;
  try {
    return fn();
  } finally {
    currentTx = prev;
    if (prev !== null) {
      for (let i = fromRender; i < queueLen; i++) urgent.add(queue[i]);
      for (let i = fromUser; i < userQueueLen; i++) urgent.add(userQueue[i]);
    }
  }
}

/**
 * @internal useOptimistic: an overlay shows at once, also where an open
 * transition holds a reader of the view (a value landed inside it). Those
 * readers, of `read` directly or through computeds, run in the next flush
 * instead of at its commit. Call it inside _urgent.
 */
export function _runHeldReaders(read) {
  if (heldIn === null) return;
  const held = heldIn;
  const seen = new Set();
  const stack = [read[NODE]];
  while (stack.length > 0) {
    const n = stack.pop();
    for (let l = n.subHead; l !== null; l = l.nextSub) {
      const s = l.sub;
      if (s.flags & EFFECT) {
        const t = held.get(s);
        if (t === undefined) continue;
        const r = txRoot(t);
        held.delete(s);
        if (r.done || !r.held.delete(s)) continue;
        if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'transition:held', r, r);
        s.flags &= ~QUEUED;
        if ((s.flags & DISPOSED) === 0) enqueue(s);
      } else if ((s.flags & COMPUTED) !== 0 && !seen.has(s)) {
        seen.add(s);
        stack.push(s);
      }
    }
  }
  if (batchDepth === 0 && !flushing) scheduleFlush();
}

/** @internal Development: whether a transition's commit is running the effects it held. */
export function _committingTransition() {
  return __DEV__ && devCommitting > 0;
}

// ---------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------

const noopDispose = () => {};

export function effect(fn, opts) {
  const parent = runningEffect;
  const createdUnder = ownerNow();
  /** @type {WhatEffectNode} */
  const e = {
    fn,
    depHead: null, depTail: null,
    flags: EFFECT | RUNNING,
    cleanup: null,
    owner: createdUnder,
    parent,
    owned: null,
  };
  if ((opts != null && opts.phase === 'user') || (parent !== null && (parent.flags & USER))) e.flags |= USER;
  if (__DEV__) {
    if (nextBinding !== null) {
      e.devName = nextBinding.name;
      e.devBinding = nextBinding.binding;
      clearNextBinding();
    }
    if (opts != null) {
      if (opts.name) e.devName = opts.name;
      if (opts.binding) e.devBinding = opts.binding;
    }
    if (arguments[2]) e.devName = devNamed(e.devName, arguments[2]);
    devCreated('effects', e);
    if (__devtools?.trace) devHook('onEffectBegin', e, null, parent);
    // Stamped before the run, so a write the run makes to its own dependency
    // is the cause of the re-run it triggers.
    e.devSeen = devSeq;
  }

  // The first run is synchronous and tracked, and owns what it creates.
  const prevSub = activeSub;
  activeSub = e;
  runningEffect = e;
  ++cycle;
  try {
    const result = fn();
    if (typeof result === 'function') e.cleanup = result;
    else if (__DEV__) devAsyncEffect(e, result);
  } catch (err) {
    // A first run that read a value that is not ready is held, not failed: the
    // effect stays, subscribed to what it read, and runs again when it lands
    // (only the async machinery makes such a value, so it decides).
    if (asyncOps === null || !asyncOps.held(e, err)) {
      activeSub = prevSub;
      runningEffect = parent;
      e.flags &= ~RUNNING;
      if (__DEV__ && __devtools) _devError(err, { type: 'effect', effect: e });
      // No disposer is returned when setup throws: undo the partial graph now,
      // including an update queued during the failed run.
      disposeEffect(e);
      throw err;
    }
  }
  activeSub = prevSub;
  runningEffect = parent;
  e.flags &= ~RUNNING;
  if (opts != null && opts.stable) e.flags |= STABLE;
  if (__DEV__ && __devtools) devHook('onEffectRun', e);

  // Zero-dependency release: an effect that tracked nothing on its first run
  // can never be notified again. With no cleanup to run later and nothing
  // owned, retain nothing: no owner registration, no dispose closure.
  if (e.depHead === null && e.cleanup === null && e.owned === null) {
    e.flags |= DISPOSED;
    if (__DEV__ && __devtools) devHook('onEffectDispose', e);
    return noopDispose;
  }
  if (createdUnder !== null) {
    const o = scopeOf(createdUnder);
    e.owner = o;
    // An owner disposed before or during this run never disposes again.
    if (o.flags & DISPOSED) {
      disposeEffect(e);
      return noopDispose;
    }
    o.disposals.push(e);
  } else if (__DEV__) {
    devOrphan(e);
  }
  return () => dropEffect(e);
}

/**
 * @internal effect(), for a binding that may turn out to need none. `read` is
 * run as an effect's first run is (tracked, owning what it creates), then
 * `bind(value, source, read, a, b, owner)` is called inside that run with its
 * value and what the value came from: null when the read tracked nothing, the
 * cell of a list row's item (_rowItem) when that is all it read, else the
 * effect itself. It returns the function the effect runs from then on (the
 * run under way is its first: it shows `value` itself), or null when it has
 * shown the value in a way that needs no effect, and none is kept. `owner` is
 * what the effect is created under, as _ownerRecord takes it. A read that
 * throws fails or is held as any effect's first run is, and a held one is
 * read again, and bound, when what it waits for lands.
 */
export function _effectWhenNeeded(read, bind, a, b, opts) {
  const owner = ownerNow();
  /** @type {(() => any) | null} */
  let run = null;
  effect(() => {
    if (run !== null) return run();
    const e = /** @type {WhatEffectNode} */ (activeSub);
    const value = read();
    const l = e.depHead;
    run = bind(value, l === null ? null : l === e.depTail && /** @type {any} */ (l.dep).builder !== undefined ? l.dep : e, read, a, b, owner);
    // No effect: what it read (a row's item) reaches the binding another way,
    // and with nothing read the effect is released.
    if (run === null) unlinkAllDeps(e);
  }, opts);
}

/**
 * A user-phase effect whose first run waits for the flush: on the microtask
 * after the code that creates it, at the end of the outermost batch(), or in
 * the user round of the flush that is running, after the render-phase effects
 * of that flush. useEffect and onMount are built on it, and run in React's
 * order: children first on mount and on update, a parent's cleanups first on
 * unmount (see _holdUser, orderUserRound, userCleanups).
 * @param {() => any} fn
 */
export function _userEffect(fn) {
  const now = ownerNow();
  const o = now === null ? null : scopeOf(now);
  if (o !== null && (o.flags & DISPOSED)) return;
  userOps = USER_OPS;
  // The owners above it learn they hold one, up to the first that knew.
  for (let a = o; a != null && (a.flags & OWNS_USER) === 0; a = a.owner) {
    if ((a.flags & (EFFECT | COMPUTED)) === 0) a.flags |= OWNS_USER;
  }
  /** @type {WhatEffectNode} */
  const e = {
    fn,
    depHead: null, depTail: null,
    flags: EFFECT | USER | DIRTY,
    cleanup: null,
    owner: o,
    parent: runningEffect,
    owned: null,
  };
  if (__DEV__) {
    if (arguments[1]) e.devName = arguments[1];
    devCreated('effects', e);
  }
  if (o !== null) o.disposals.push(e);
  if (building > 0) held.push(e);
  else queueUser(e);
}

function queueUser(e) {
  if (e.flags & DISPOSED) return;
  firstQueued.set(e, ++queuedCount);
  // Under a <Suspense> that has not shown its content yet, the first run waits
  // until it does (see components.js).
  if (userEffectGate !== null && userEffectGate(e)) return;
  enqueue(e);
  if (batchDepth === 0 && !flushing) scheduleFlush();
}

// React runs a parent's effects after its children's on mount. A component's
// output is built inside its build (its body, then the JSX it returns), so
// the first runs made while a component is built are held, and queued once
// its build is over: a child's before its parent's, siblings in the order
// they were built.
let building = 0;
/** @type {WhatEffectNode[]} */
const held = [];

/** @internal A component's build starts (render.js): hold the first runs of user-phase effects made in it until _releaseUser. */
export function _holdUser() {
  building++;
  return held.length;
}

/** @internal The component's build that _holdUser returned `mark` for is over: queue the first runs made in it. */
export function _releaseUser(mark) {
  building--;
  if (held.length > mark) /** @type {any} */ (userOps).release(mark);
}

function releaseHeld(mark) {
  for (let i = mark; i < held.length; i++) queueUser(held[i]);
  held.length = mark;
}

// React's order costs only an app that makes a useEffect or an onMount: the
// first one installs it (_userEffect), and nothing else reaches it.
/** @type {{ order: (round: WhatEffectNode[], len: number) => void, release: (mark: number) => void, clean: (o: any) => void } | null} */
let userOps = null;
// When each useEffect and onMount was first queued: children first, siblings
// in order (_holdUser), which is the order React's tree gives its effects.
/** @type {WeakMap<WhatEffectNode, number>} */
const firstQueued = new WeakMap();
let queuedCount = 0;

// A round of useEffect and onMount runs, in React's order for a commit's
// passive effects: every cleanup, then every run, children first. A round of
// first runs only is in that order already (_holdUser). With re-runs
// (effects that have run, and read what changed) the round is sorted by when
// each effect was first queued, a re-run moved after the round's effects
// below its component (a child that mounts in this flush, or runs again),
// the deeper first. Then the effects that will run have their cleanups run,
// in that order, and the flush runs them. A round holding another user-phase
// effect (one a useEffect's callback made) keeps the queue's order, which
// runs an effect's parent first.
function orderUserRound(round, len) {
  // The owner of each re-run: the latest first-queued number below it.
  /** @type {Map<any, number>} */
  const last = new Map();
  for (let i = 0; i < len; i++) {
    const e = round[i];
    if (!firstQueued.has(e)) return;
    if (e.depHead !== null) last.set(e.owner, 0);
  }
  if (last.size === 0) return;
  /** @type {[WhatEffectNode, number, number][]} */
  const rows = [];
  for (let i = 0; i < len; i++) {
    const e = round[i];
    const at = /** @type {number} */ (firstQueued.get(e));
    let depth = 0;
    for (let a = e.owner; a != null; a = a.owner) if (++depth > 1 && /** @type {number} */ (last.get(a)) < at) last.set(a, at);
    rows.push([e, at, depth]);
  }
  /** @param {[WhatEffectNode, number, number]} row */
  const key = ([e, at]) => (e.depHead !== null ? Math.max(at, /** @type {number} */ (last.get(e.owner))) : at);
  rows.sort((p, q) => key(p) - key(q) || q[2] - p[2] || p[1] - q[1]);
  for (let i = 0; i < len; i++) {
    const e = round[i] = rows[i][0];
    let f = e.flags;
    if ((f & (DIRTY | DISPOSED)) === 0 && (f & PENDING) && /** @type {any} */ (pullOps).check(e)) e.flags = f = e.flags | DIRTY;
    if ((f & (DIRTY | DISPOSED)) !== DIRTY) continue;
    if (e.owned !== null) disposeRun(e);
    if (e.cleanup !== null && (e.flags & DISPOSED) === 0) runCleanup(e);
  }
}

// React's order for useEffect cleanups on unmount: a parent's before its
// children's, a component's in the order its effects were made, sibling
// components first to last. An unmount runs them before it disposes the rest
// of the owner (children newest first, then its registrations in reverse):
// those of the owner, then of the owners linked below it. An owner below a
// render-phase effect (a region, a list row) is reached when its own disposal
// comes, which is still after its parent's. The owners on the way are marked
// disposed meanwhile, so a cleanup's error goes past them, as it would during
// the rest of the unmount.
function userCleanups(o) {
  o.flags &= ~OWNS_USER;
  // A cleanup function has no flags, and no computed is user-phase.
  for (const d of o.disposals) if (d.flags & USER) disposeEffect(d);
  for (let c = o.firstChild; c !== null; c = c.nextSibling) {
    if (c.flags & OWNS_USER) {
      c.flags |= DISPOSED;
      userCleanups(c);
      c.flags &= ~DISPOSED;
    }
  }
}

const USER_OPS = { order: orderUserRound, release: releaseHeld, clean: userCleanups };

/** @type {((e: WhatEffectNode) => boolean) | null} */
let userEffectGate = null;

/** @internal Suspense: decide where the first run of a user-phase effect goes. */
export function _setUserEffectGate(gate) {
  userEffectGate = gate;
}

/** @internal Suspense: run a user-phase effect whose first run waited for its content to show. */
export function _releaseUserEffect(e) {
  if (e.flags & (DISPOSED | QUEUED)) return;
  enqueue(e);
  if (batchDepth === 0 && !flushing) scheduleFlush();
}

function enqueue(e) {
  let p = e.parent;
  if (p !== null && (p.flags & (QUEUED | RUNNING | DISPOSED)) === 0) {
    // Queue not-yet-queued ancestors first, outermost first. A clean ancestor
    // costs one flag test when its turn comes.
    const chain = [];
    do { chain.push(p); p = p.parent; } while (p !== null && (p.flags & (QUEUED | RUNNING | DISPOSED)) === 0);
    for (let i = chain.length - 1; i >= 0; i--) push(chain[i]);
  }
  push(e);
}

function push(e) {
  e.flags |= QUEUED;
  if (e.flags & USER) userQueue[userQueueLen++] = e;
  else queue[queueLen++] = e;
}

function runEffect(e) {
  const f = e.flags;
  if (f & DISPOSED) return;
  let dirty = (f & DIRTY) !== 0;
  if (!dirty && (f & PENDING)) {
    dirty = /** @type {any} */ (pullOps).check(e);
    if (e.flags & DISPOSED) return;               // checking ran code that disposed it
  }
  if (dirty) executeEffect(e);
  else {
    if (__DEV__ && (f & PENDING) && __devtools?.trace) devHook('onEffectSkip', e);
    e.flags &= ~PENDING;
  }
}

function executeEffect(e) {
  const causes = __DEV__ && devTracksCauses() ? devCauses(e) : null;
  // The components the last run built that held state: a run that builds one
  // of them again lost that state (ERR_REBUILT_COMPONENT).
  const held = __DEV__ && e.owned !== null ? devStatefulComponents(e.owned) : null;
  if (e.owned !== null) {
    disposeRun(e);
    if (e.flags & DISPOSED) return;               // a cleanup it owned disposed it
  }
  if (e.cleanup !== null) {
    runCleanup(e);
    if (e.flags & DISPOSED) return;               // its cleanup disposed it
  }
  const prevSub = activeSub;
  const prevRunning = runningEffect;
  runningEffect = e;
  e.flags = (e.flags & ~(DIRTY | PENDING)) | RUNNING;
  if (e.flags & STABLE) {
    activeSub = null;
  } else {
    e.depTail = null;
    activeSub = e;
    ++cycle;
  }
  if (__DEV__) {
    e.devSeen = devSeq;
    if (__devtools?.trace) devHook('onEffectBegin', e, causes);
    if (flushing) devRan[devRanLen++] = e;
  }
  try {
    const result = e.fn();
    if (typeof result === 'function') e.cleanup = result;
    else if (__DEV__) devAsyncEffect(e, result);
  } catch (err) {
    handleEffectError(e, err, false);
  }
  activeSub = prevSub;
  runningEffect = prevRunning;
  e.flags &= ~RUNNING;
  if (e.flags & DISPOSED) {                       // disposed itself mid-run
    unlinkAllDeps(e);
    if (e.owned !== null) disposeRun(e);
    if (e.cleanup !== null) runCleanup(e);        // the cleanup this run returned
  } else if ((e.flags & STABLE) === 0) {
    purgeDeps(e);
  }
  if (__DEV__ && held !== null && (e.flags & DISPOSED) === 0) devRebuilt(e, held);
  if (__DEV__ && __devtools) devHook('onEffectRun', e, { causes });
}

// A cleanup runs untracked: what it reads belongs to no one. An error it
// throws is reported like an error of the effect's run.
function runCleanup(e) {
  const fn = /** @type {() => void} */ (e.cleanup);
  e.cleanup = null;
  const prevSub = activeSub;
  activeSub = null;
  try { fn(); } catch (err) {
    handleEffectError(e, err, true);
  }
  activeSub = prevSub;
}

function disposeEffect(e) {
  if (e.flags & DISPOSED) return;
  e.flags = (e.flags & ~(DIRTY | PENDING)) | DISPOSED;
  e.parent = null;
  if (__DEV__ && __devtools) devHook('onEffectDispose', e);
  unlinkAllDeps(e);
  if (e.owned !== null) disposeRun(e);
  if (e.cleanup !== null) runCleanup(e);
}

// The disposer effect() returns. The owner's entry is left in place and swept
// once disposed entries make up half of the list, so a long-lived owner whose
// effects come and go stays bounded at O(1) amortized per disposal. An effect
// a boundary counts as waiting tells it now, not when its owner goes.
function dropEffect(e) {
  if (e.flags & DISPOSED) return;
  if (e.flags & HELD) e.fn.release();
  disposeEffect(e);
  const o = e.owner;
  if (o !== null && (o.flags & DISPOSED) === 0 && ++o.dropped > 16 && o.dropped * 2 > o.disposals.length) {
    const list = o.disposals;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (typeof d === 'function' || (d.flags & DISPOSED) === 0) list[n++] = d;
    }
    list.length = n;
    o.dropped = 0;
  }
}

// An error thrown by an effect re-run or by an effect cleanup goes to the
// nearest live owner with an `_onError` handler (an error boundary installs
// one on its root), else to console.error. A handler that throws passes its
// error further up. It never aborts the flush: sibling effects still run. A
// run that read a value that is not ready is held instead (see effect()).
// `ofComputed`: the cleanup that threw belongs to a computed's run, not an
// effect's (cleanupFailed), which only the wording and the devtools record
// tell apart.
function handleEffectError(e, err, inCleanup, ofComputed) {
  if (!inCleanup && asyncOps !== null && asyncOps.held(e, err)) return;
  if (__DEV__ && __devtools) _devError(err, ofComputed ? { type: 'cleanup' } : { type: inCleanup ? 'effect-cleanup' : 'effect', effect: e });
  const left = _handleError(e.owner, err);
  if (left === HANDLED) return;
  // Reporting must not interrupt sibling updates, even with a throwing console.
  try {
    console.error(`[what] Uncaught error in ${ofComputed ? 'cleanup' : inCleanup ? 'effect cleanup' : 'effect during update'}:`, left);
  } catch { /* no console */ }
}

/** What _handleError returns when a handler took the error. */
export const HANDLED = /* @__PURE__ */ Object.freeze({});

/**
 * Hand `err` to the nearest live owner above `owner` (itself included) that
 * has an `_onError` handler, as an error boundary installs on the root of its
 * children. A handler that throws passes its error further up. Returns
 * HANDLED when a handler took it, else the error left over: `err`, or the
 * error the last handler threw.
 */
export function _handleError(owner, err) {
  for (let o = owner; o != null; o = o.owner) {
    if ((o.flags & DISPOSED) === 0 && typeof o._onError === 'function') {
      try { o._onError(err); return HANDLED; } catch (next) { err = next; }
    }
  }
  return err;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function scheduleFlush() {
  if (!flushScheduled && (queueLen > 0 || userQueueLen > 0)) {
    flushScheduled = true;
    queueMicrotask(microtaskFlush);
  }
}

function microtaskFlush() {
  flushScheduled = false;
  flush();
}

// Run queued effects until none is left. Callers start it only when no effect,
// computed or flush is running. Re-runs happen under no owner, whatever owner
// the caller of batch() or flushSync() has.
function flush() {
  flushing = true;
  const prevOwner = currentOwner;
  const prevRun = ownerRun;
  currentOwner = null;
  ownerRun = null;
  let rounds = 0;
  /** @type {WhatEffectNode[] | null} */
  let round = null;
  let i = 0;
  let len = 0;
  try {
    while (queueLen > 0 || userQueueLen > 0) {
      if (++rounds > MAX_FLUSH_ROUNDS) {
        stopLoop();
        break;
      }
      if (queueLen > 0) {
        round = queue; len = queueLen;
        queue = []; queueLen = 0;
      } else {
        round = userQueue; len = userQueueLen;
        userQueue = []; userQueueLen = 0;
        if (userOps !== null) userOps.order(round, len);
      }
      for (i = 0; i < len; i++) {
        const e = round[i];
        e.flags &= ~QUEUED;
        runEffect(e);
      }
      round = null;
    }
  } finally {
    flushing = false;
    if (__DEV__) {
      devRan.fill(null, 0, devRanLen);
      devWrote.fill(null, 0, devWroteLen);
      devRanLen = devWroteLen = 0;
    }
    currentOwner = prevOwner;
    ownerRun = prevRun;
    if (round !== null) {
      // Something escaped an effect: drop that one, keep the rest of its round.
      round[i].flags &= ~(DIRTY | PENDING);
      for (let j = i + 1; j < len; j++) push(round[j]);
    }
    if (queueLen > 0 || userQueueLen > 0) scheduleFlush();
  }
}

// The loop cap. The queued effects are dropped, not run, but the computeds
// they read are brought up to date first: a DIRTY or PENDING computed would
// stop every later write from reaching them again. Bringing a computed up to
// date runs user code, which may queue more effects; those are dropped the
// same way, a bounded number of times.
function stopLoop() {
  if (__DEV__) devReportLoop();
  else {
    try { console.warn('[what] Possible infinite effect loop detected'); } catch { /* no console */ }
  }
  for (let pass = 0; queueLen > 0 || userQueueLen > 0; pass++) {
    const dropped = queue.slice(0, queueLen).concat(userQueue.slice(0, userQueueLen));
    queue = []; queueLen = 0;
    userQueue = []; userQueueLen = 0;
    for (const e of dropped) {
      e.flags &= ~QUEUED;
      if (pass < MAX_FLUSH_ROUNDS && pullOps !== null) pullOps.settle(e);
      e.flags &= ~(DIRTY | PENDING);
    }
  }
}

function settleInputs(e) {
  for (let l = e.depHead; l !== null; l = l.nextDep) {
    const dep = l.dep;
    if ((dep.flags & COMPUTED) && (dep.flags & (DIRTY | PENDING))) {
      refresh(dep);
      if (l.version === -1) return;
    }
  }
}

// Group writes: effects run once, when the outermost batch ends. Returns fn's
// value. A batch that ends inside an effect's run or a computed's evaluation
// leaves its effects to the running flush, or to the microtask.
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0 && !flushing) {
      if (runningEffect === null && evalDepth === 0) flush();
      else scheduleFlush();
    }
  }
}

// Run queued effects now. Inside a flush, an effect or a computed it is a
// no-op, which prevents infinite loops and re-entry; the running flush (or the
// microtask) picks the effects up.
export function flushSync() {
  if (flushing || runningEffect !== null || evalDepth !== 0) {
    if (__DEV__) devNestedFlush();
    return;
  }
  flush();
}

// Read signals without subscribing. What fn creates still belongs to the run
// it is called in (a computed's evaluation included).
export function untrack(fn) {
  const prev = activeSub;
  if (prev === null) return fn();
  const prevOwner = currentOwner;
  const prevRun = ownerRun;
  if (prev !== ownerRun) currentOwner = prev;
  activeSub = null;
  ownerRun = runningEffect;
  try {
    return fn();
  } finally {
    activeSub = prev;
    currentOwner = prevOwner;
    ownerRun = prevRun;
  }
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------
// Owner records (roots, item scopes, components, and the record of an effect's
// or computed's run) hold the effects, computeds and cleanups created under
// them, and the owner records created under them as an intrusive sibling list,
// so a child leaves its parent in O(1). Whatever is created under an owner that
// is already disposed is disposed at once (an effect after its first run, a
// cleanup by running it, a root once its function returns), because that owner
// will never dispose it.
//
// `owner` links a record to the one it was created under; the record of a run
// links to its effect or computed, which links on to its own owner, so a walk
// up `owner` passes through every scope that holds it. A walk tests DISPOSED
// in `flags`, which every kind of owner carries.

/**
 * The owner record that what is created under `o` goes into: `o` itself, or
 * for an effect or computed whose run is executing, the record of that run,
 * made on first use.
 */
function scopeOf(o) {
  if ((o.flags & (EFFECT | COMPUTED)) === 0) return o;
  return o.owned !== null ? o.owned : (o.owned = createOwner(o, o.flags & DISPOSED));
}

// Where work created now belongs when no owner is current: the root of the
// server render that is active (server-context.js installs the lookup, on
// first use of the render store). For the copy of this module that rendered
// it that is the render's own root (current anyway in the render's
// synchronous slices; this covers code after an `await` with an async
// context provider), and for another copy (a component bundled with its own
// framework, another export tier) a root of that copy's own, which the
// render's release disposes too (what-server's createRenderContext, rootFor).
// Null on the client and outside every render. _detached() turns it off.
/** @type {(() => any) | null} */
let ownerFallback = null;
// Whether a fallback was ever set: _detached() turns the fallback off for a
// while, which is not a copy that never had one.
let fallbackSet = false;

/** @internal server-context.js: the owner for work created with no current owner. */
export function _setOwnerFallback(fn) {
  ownerFallback = fn;
  fallbackSet = true;
}

/** @internal what-server: this copy of the engine, as a render's rootFor() takes it: a root owned by nothing, and its disposal. */
export const _engine = { root: () => createOwner(null, 0), dispose: (root) => disposeOwner(root) };

// The innermost run executing: the node tracking reads, or under untrack()
// the effect whose function is executing.
function runNow() {
  return activeSub !== null ? activeSub : runningEffect;
}

// What receives work created now: the run executing, if it started inside the
// owner set last (a run owns what it creates, with no store per run), else
// that owner, else the fallback. An owner set during a run is current until
// the run it was set in ends or another run starts inside it.
function ownerNow() {
  const run = activeSub !== null ? activeSub : runningEffect;
  if (run !== null && run !== ownerRun) return run;
  if (currentOwner !== null) return currentOwner;
  // A copy of this module that never touched the server store (a library
  // bundled with its own engine, rendered by another copy's server) takes
  // the lookup the store hands out (server-context.js `adopt`).
  if (!fallbackSet) /** @type {any} */ (globalThis)[_serverStoreKey]?.adopt?.(_setOwnerFallback, _engine);
  return ownerFallback === null ? null : ownerFallback();
}

/** @internal The key of the server render store every copy of what-core shares (server-context.js). */
export const _serverStoreKey = Symbol.for('what.serverContext.v1');

/** @internal Run `fn` with no owner current, and none supplied by the fallback. */
export function _detached(fn) {
  const prevOwner = currentOwner;
  const prevRun = ownerRun;
  const prevFallback = ownerFallback;
  currentOwner = null;
  ownerRun = runNow();
  ownerFallback = null;
  try {
    return fn();
  } finally {
    currentOwner = prevOwner;
    ownerRun = prevRun;
    ownerFallback = prevFallback;
  }
}

// Dispose what the previous run of an effect or computed created. Every
// cleanup that throws is reported like a cleanup of the node itself.
function disposeRun(node) {
  const o = node.owned;
  node.owned = null;
  disposeOwner(o, node);
}

function cleanupFailed(node, err) {
  handleEffectError(node, err, true, (node.flags & EFFECT) === 0);
}

/**
 * Hand what waits to the nearest live owner above `owner` (itself included)
 * that has an `_onPending` handler, as a Suspense boundary installs on the
 * root of its children: a pending thenable, or an effect or binding whose run
 * was held on a value that is not ready. Returns false when none did.
 */
export function _handlePending(owner, waiting) {
  for (let o = owner; o != null; o = o.owner) {
    if ((o.flags & DISPOSED) === 0 && typeof o._onPending === 'function') {
      o._onPending(waiting);
      return true;
    }
  }
  return false;
}

export function getOwner() {
  const now = ownerNow();
  return now === null ? null : scopeOf(now);
}

/**
 * @internal The owner record of what is created under `o` (what
 * _effectWhenNeeded hands its `bind`): `o`, or the record of the run of an
 * effect or computed, which is disposed when that run is over. Null for null.
 */
export function _ownerRecord(o) {
  return o === null ? null : scopeOf(o);
}

export function runWithOwner(owner, fn) {
  const prev = currentOwner;
  const prevRun = ownerRun;
  currentOwner = owner;
  ownerRun = runNow();
  try {
    return fn();
  } finally {
    currentOwner = prev;
    ownerRun = prevRun;
  }
}

function createOwner(parent, flags) {
  /** @type {WhatOwner} */
  const owner = {
    flags,
    owner: parent,
    disposals: [],
    firstChild: null, lastChild: null,
    prevSibling: null, nextSibling: null,
    dropped: 0,
  };
  return owner;
}

function linkChild(parent, child) {
  const last = parent.lastChild;
  child.prevSibling = last;
  if (last !== null) last.nextSibling = child; else parent.firstChild = child;
  parent.lastChild = child;
}

// Isolated reactive scope. A root created under another owner (an effect's run
// included) is disposed with it. A root whose function throws is disposed
// before the error propagates: the caller never received its disposer.
export function createRoot(fn) {
  const now = ownerNow();
  const parent = now === null ? null : scopeOf(now);
  const root = createOwner(parent, 0);
  if (parent !== null && (parent.flags & DISPOSED) === 0) linkChild(parent, root);
  return runOwned(root, parent, fn);
}

// Lightweight scope for list items: not registered with the parent owner (the
// list reconciler disposes it explicitly, and a row outlives the run of the
// list's effect that built it) and it does not untrack. It still points at its
// parent, so errors from a row's effects reach the parent's handlers. `cell`
// is the row's item (_rowItem), when it has one.
export function _createItemScope(fn, cell) {
  const parent = ownerNow();
  const scope = __DEV__ ? devRow(createOwner(parent, 0)) : createOwner(parent, 0);
  // What the row builds can tell that it lives as long as the row does
  // (_livesWithRow).
  if (cell !== undefined) cell.building = scope;
  return runOwned(scope, parent, fn);
}

function devRow(row) {
  row.devScope = 'row';
  return row;
}

function runOwned(scope, parent, fn) {
  const prev = currentOwner;
  const prevRun = ownerRun;
  currentOwner = scope;
  ownerRun = runNow();
  let result;
  try {
    result = fn(() => disposeOwner(scope));
  } catch (err) {
    currentOwner = prev;
    ownerRun = prevRun;
    try { disposeOwner(scope); } catch { /* the setup error is the one to report */ }
    throw err;
  }
  currentOwner = prev;
  ownerRun = prevRun;
  if (parent !== null && (parent.flags & DISPOSED)) disposeOwner(scope);
  return result;
}

/**
 * The owner of a component (render.js), created under the current owner like
 * a root: the component's hooks, context values and dev metadata live on it,
 * and disposing it disposes everything the component's body and bindings
 * created. Pair with _runOwned to run code under it. `props` identifies the
 * instance across the attempts of a component that suspends and is rendered
 * again in place with the same props (use() counts its suspensions by it).
 * @param {any} Component
 * @param {any} [props]
 */
export function _componentOwner(Component, props) {
  const now = ownerNow();
  const parent = now === null ? null : scopeOf(now);
  /** @type {WhatOwner} */
  const owner = {
    flags: parent !== null ? parent.flags & DISPOSED : 0,
    owner: parent,
    disposals: [],
    firstChild: null, lastChild: null,
    prevSibling: null, nextSibling: null,
    dropped: 0,
    Component,
    props,
    hooks: null,
    hookIndex: 0,
    context: null,
  };
  if (parent !== null && (parent.flags & DISPOSED) === 0) linkChild(parent, owner);
  return owner;
}

/**
 * Run `fn(a, b, c)` under `owner`, untracked: what it creates belongs to
 * `owner` and what it reads subscribes nothing. Returns what `fn` returns.
 */
export function _runOwned(owner, fn, a, b, c) {
  const prevOwner = currentOwner;
  const prevRun = ownerRun;
  const prevSub = activeSub;
  activeSub = null;
  currentOwner = owner;
  ownerRun = runningEffect;
  try {
    return fn(a, b, c);
  } finally {
    currentOwner = prevOwner;
    ownerRun = prevRun;
    activeSub = prevSub;
  }
}

/**
 * Give an owner created with no owner above it (a component built before the
 * root that will hold it, as `mount(<App />, el)` does) to the current owner,
 * which disposes it from then on.
 */
export function _adoptOwner(o) {
  const now = ownerNow();
  if (now === null || o.owner !== null || (o.flags & DISPOSED)) return;
  const parent = scopeOf(now);
  o.owner = parent;
  if (parent.flags & DISPOSED) disposeOwner(o);
  else linkChild(parent, o);
}

/** Dispose an owner record and everything it holds. */
export function _disposeOwner(owner) {
  disposeOwner(owner);
}

/**
 * Make `owner` current, for code that cannot wrap its work in one call (a
 * server renderer's component frames). Returns what _exitOwner restores.
 */
export function _enterOwner(owner) {
  const saved = { owner: currentOwner, run: ownerRun };
  currentOwner = owner;
  ownerRun = runNow();
  return saved;
}

/** Restore what _enterOwner replaced. */
export function _exitOwner(saved) {
  currentOwner = saved.owner;
  ownerRun = saved.run;
}

/**
 * @internal Whether the run that tracks reads now has read anything: what it
 * writes then follows state (dom.js _controlFields).
 */
export function _tracking() {
  return activeSub !== null && activeSub.depHead !== null;
}

/** True once `owner` (an owner record, effect or computed) is disposed. */
export function _isDisposed(owner) {
  return (owner.flags & DISPOSED) !== 0;
}

/**
 * The context map (`context` on a component owner) of the nearest owner above
 * the current one that provides `key`, or null.
 */
export function _contextOf(key) {
  for (let o = ownerNow(); o != null; o = o.owner) {
    const map = o.context;
    if (map != null && map.has(key)) return map;
  }
  return null;
}

/**
 * @internal Provide `value` under `key` on the current owner, for what it owns
 * to find with _contextOf(key): a context with no provider component. Does
 * nothing with no owner current.
 */
export function _provide(key, value) {
  const o = ownerNow();
  if (o !== null) (o.context ??= new Map()).set(key, value);
}

/** The nearest component owner above the current owner (itself included), or null. */
export function _currentComponent() {
  for (let o = ownerNow(); o != null; o = o.owner) {
    if (o.Component !== undefined) return o;
  }
  return null;
}

export function onCleanup(fn) {
  const now = ownerNow();
  if (now === null) return;
  const o = scopeOf(now);
  if (o.flags & DISPOSED) untrack(fn);
  else o.disposals.push(fn);
}

function unlinkChild(parent, child) {
  const prev = child.prevSibling;
  const next = child.nextSibling;
  if (prev !== null) prev.nextSibling = next; else parent.firstChild = next;
  if (next !== null) next.prevSibling = prev; else parent.lastChild = prev;
  child.prevSibling = null;
  child.nextSibling = null;
}

// Dispose an owner record. A failing cleanup must not strand the others: for
// the record of a run (`runNode` is its effect or computed), each error is
// reported like a cleanup of that node; otherwise (a root's disposer) the
// first is rethrown once every cleanup has run.
function disposeOwner(root, runNode) {
  if (root.flags & DISPOSED) return;
  root.flags |= DISPOSED;
  if (root.flags & OWNS_USER) /** @type {any} */ (userOps).clean(root);
  let failed = false;
  let firstError;
  // Cleanups run untracked, whoever's run is disposing the owner.
  const prevSub = activeSub;
  activeSub = null;
  // Children first (newest first), then own disposals in reverse registration
  // order. Each child is unlinked before its cleanups run, so a cleanup that
  // disposes a sibling cannot disturb the walk.
  for (let child = root.lastChild; child !== null; child = root.lastChild) {
    unlinkChild(root, child);
    try { disposeOwner(child, runNode); } catch (err) {
      if (!failed) { failed = true; firstError = err; }
    }
  }
  const disposals = root.disposals;
  for (let i = disposals.length - 1; i >= 0; i--) {
    const d = disposals[i];
    try {
      if (typeof d === 'function') d();
      else if (d.flags & EFFECT) disposeEffect(d);
      else /** @type {any} */ (pullOps).dispose(d);
    } catch (err) {
      if (runNode !== undefined) {
        cleanupFailed(runNode, err);
      } else {
        if (__DEV__ && __devtools) _devError(err, { type: 'cleanup' });
        if (!failed) { failed = true; firstError = err; }
      }
    }
  }
  disposals.length = 0;
  activeSub = prevSub;
  const parent = root.owner;
  if (root.prevSibling !== null || (parent !== null && parent.firstChild === root)) unlinkChild(parent, root);
  if (failed) throw firstError;
}

// ---------------------------------------------------------------------------
// Development-only instrumentation. Reached only behind __DEV__; production
// builds remove it.
// ---------------------------------------------------------------------------

// Late-install replay buffer. Devtools that install after signals, effects or
// components already exist (a module-scope store imported before the devtools
// entry) register them from here: __drainPreinstallBuffer() hands them over.
// Only creations are recorded, and only while no hooks are installed, so a
// write or a run costs nothing extra. Signals and effects are held as weak
// refs, components until they unmount. Capped, so an app that never installs
// devtools does not accumulate entries; `dropped` counts what the cap missed.
const PREINSTALL_CAP = 2000;
/** @type {{ signals: Set<WeakRef<any>>, effects: Set<WeakRef<any>>, components: Set<any>, dropped: { signals: number, effects: number, components: number } } | null} */
const preinstall = __DEV__ && typeof WeakRef !== 'undefined'
  ? { signals: new Set(), effects: new Set(), components: new Set(), dropped: { signals: 0, effects: 0, components: 0 } }
  : null;

/** Development: whether a creation of `kind` reaches a tool, now or on install. */
function devWatched(kind) {
  return __devtools !== null || (preinstall !== null && preinstall[kind].size < PREINSTALL_CAP);
}

/** Development: a signal, or an effect or computed (`effects`), was created. */
function devCreated(kind, x) {
  if (__devtools !== null) devHook(kind === 'signals' ? 'onSignalCreate' : 'onEffectCreate', x);
  else if (preinstall !== null) {
    if (preinstall[kind].size < PREINSTALL_CAP) preinstall[kind].add(new WeakRef(x));
    else preinstall.dropped[kind]++;
  }
}

/** @internal Development: a component mounted (render.js). Devtools hear of it, and of its unmount. */
export function _devMounted(owner) {
  if (!__DEV__) return;
  if (__devtools !== null) devHook('onComponentMount', owner);
  else if (preinstall !== null) {
    if (preinstall.components.size < PREINSTALL_CAP) preinstall.components.add(owner);
    else preinstall.dropped.components++;
  }
  owner.disposals.push(() => {
    if (__devtools !== null) devHook('onComponentUnmount', owner);
    preinstall?.components.delete(owner);
  });
}

// Every hook call goes through here: a hook that throws is reported and
// ignored, so devtools can never leave the graph or the scheduler half-updated.
function devHook(name, a, b, c) {
  const hooks = __devtools;
  const fn = hooks !== null ? hooks[name] : undefined;
  if (typeof fn !== 'function') return;
  try {
    fn.call(hooks, a, b, c);
  } catch (err) {
    try { console.error(`[what] devtools hook ${name} threw:`, err); } catch { /* no console */ }
  }
}

// Development: errors already handed to the devtools onError hook, so an
// error seen at more than one site (an effect's first run, then the component
// it threw out of) is reported once.
const devReported = /* @__PURE__ */ new WeakSet();

/** @internal Development: hand a thrown error to the devtools onError hook, once. */
export function _devError(err, context) {
  if (!__DEV__) return;
  if (err !== null && (typeof err === 'object' || typeof err === 'function')) {
    if (devReported.has(err)) return;
    devReported.add(err);
  }
  devHook('onError', err, context);
}

function devSignal(sig, node, debugName) {
  node.sig = sig;
  const where = ownerNow();
  devMarkState(where);
  if (where !== null && typeof WeakRef !== 'undefined') node.devOwnerRef = new WeakRef(where);
  if (debugName) sig._debugName = debugName;
  if (devSplit(debugName)[1] === null) sig._devLoc = devSplit(_devCallSite('', signal, 'signals'))[1];
  devCreated('signals', sig);
}

function devComputed(read, node) {
  read[NODE] = node;
  node.sig = read;
  if (node.owner === null) node.devOwner = ownerNow();
  devCreated('effects', node);
}

// How a diagnostic names an effect or computed: the compiler's name for it,
// else its function's name, else the start of its source.
function devName(node) {
  return devLabel(node) || String(devFn(node)).slice(0, 60);
}

function devAsyncState(c, status, run, error) {
  c.devAsync = status;
  if (run !== undefined) {
    c.devFlight = { run, startedAt: Date.now() };
  } else {
    c.devFlight = null;
  }
  if (status === 'errored') {
    try { c.devLastError = String(error?.message ?? error).slice(0, 300); }
    catch { c.devLastError = 'Error could not be displayed'; }
  }
  if (__devtools?.onRecord) devHook('onRecord', `async:${run !== undefined ? 'start' : status}`, c);
}

// The compiler's name for a node, unless that is only the primitive's name
// ("effect", given to an effect assigned to nothing) and its function has a
// name of its own; else its function's name; else ''.
function devLabel(node) {
  const meta = node.devName ? devSplit(node.devName)[0] : '';
  const name = devFn(node).name;
  return meta && !(meta === (node.flags & EFFECT ? 'effect' : 'computed') && name) ? meta : name;
}

// The user's function of a node, through a development or held wrapper
// around it (`inner`).
function devFn(node) {
  const fn = node.fn;
  return fn.inner !== undefined ? fn.inner : fn;
}

/** @internal Publish a browser action completion to devtools. */
export function _devAction(data) {
  if (__DEV__ && __devtools?.onRecord) devHook('onRecord', 'action', null, data);
}

/**
 * @internal Add the caller's location when the compiler supplied none, for a
 * creation of `kind` that a tool will see (devWatched). A stack trace costs
 * some thirty times the primitive it locates, so a page without devtools pays
 * for at most the pre-install buffer's worth, not for every signal, computed
 * and useEffect it makes.
 */
export function _devCallSite(name, primitive, kind = 'effects') {
  if (!__DEV__ || !devWatched(kind) || typeof window === 'undefined' || devSplit(name)[1] !== null) return name;
  const error = new Error();
  const capture = /** @type {{ captureStackTrace?: (error: Error, skip: Function) => void }} */ (Error).captureStackTrace;
  if (capture) capture(error, primitive);
  // A stack formatter of the app's (Error.prepareStackTrace) may return
  // something else than a string, or throw.
  let stack;
  try {
    stack = error.stack;
  } catch {
    return name;
  }
  if (typeof stack !== 'string') return name;
  const frames = stack.split('\n');
  const caller = capture ? frames[1] : frames[frames.findIndex((line) => line.startsWith(primitive.name + '@')) + 1];
  const loc = caller?.trim().match(/(?:^at (?:.*? \()?|@)((?:https?:|file:|\/).+?:\d+:\d+)\)?$/)?.[1];
  if (!loc || /\/(?:node_modules|packages\/(?:core|router|server)\/src)\//.test(loc)) return name;
  return `${name || ''}@${loc}`;
}

// A runtime name given the compiler's location, unless it carries its own.
function devNamed(name, meta) {
  if (!meta || !name || devSplit(name)[1] !== null) return name || meta;
  return `${name}@${devSplit(meta)[1]}`;
}

// "name@path:line:column" (what-compiler's development metadata) as
// [name, location]. The name never holds an "@"; the path may.
/** @returns {[string, string | null]} */
function devSplit(meta) {
  if (typeof meta !== 'string') return ['', null];
  const at = /@(?=[^\n]+:\d+:\d+$)/.exec(meta)?.index ?? -1;
  return at === -1 ? [meta, null] : [meta.slice(0, at), meta.slice(at + 1)];
}

// A signal or computed coerced to a string or a number (`Total: ${count}`,
// count + 1, count > 5, obj[count]) stands where its value was meant. Every
// such coercion ends in toString(), because a function's valueOf() returns the
// function itself, so one override per prototype reports them all. It returns
// what production renders, the function's source text: a development page that
// showed the value would hide the bug from whoever checks the page.
if (__DEV__) {
  const readGuard = (kind) => ({
    configurable: true,
    writable: true,
    /** @this {any} */
    value: function toString() {
      const text = Function.prototype.toString.call(this);
      const node = this[NODE];
      const rawName = this._debugName;
      const name = rawName ? devSplit(rawName)[0] : kind === 'computed' && node ? devName(node) : '(unnamed)';
      const where = __ownerPath(this);
      report('ERR_MISSING_SIGNAL_READ', {
        data: { signalName: name },
        subject: { kind, id: (kind === 'computed' ? node : this)?._devId, name },
        owner: where,
        loc: where.loc,
      });
      return text;
    },
  });
  Object.defineProperty(signalPrototype(), 'toString', readGuard('signal'));
  Object.defineProperty(computedPrototype(), 'toString', readGuard('computed'));
  Object.defineProperty(asyncPrototype(), 'toString', readGuard('computed'));
}

function devWriteInComputed(sig, c) {
  const computedName = devName(c);
  report('ERR_SIGNAL_WRITE_IN_COMPUTED', {
    data: { computedName, signalName: sig._debugName ? devSplit(sig._debugName)[0] : '(unnamed)' },
    subject: { kind: 'computed', id: c._devId, name: computedName },
  });
}

// The loop cap stops the phase that kept re-queueing itself. The effects still
// queued in it that wrote a signal during this flush are the loop; the others
// only read what it writes. Each is reported with the number of times it
// re-ran in this flush.
function devReportLoop() {
  const stuck = queueLen > 0 ? queue.slice(0, queueLen) : userQueue.slice(0, userQueueLen);
  const writers = stuck.filter((e) => devWrote.includes(e));
  for (const e of writers.length > 0 ? writers : stuck) {
    const effectName = devName(e);
    const where = __ownerPath(e);
    report('ERR_INFINITE_EFFECT', {
      data: { effectName, rounds: devRunsOf(e) },
      subject: { kind: 'effect', id: e._devId, name: effectName },
      owner: where,
      loc: where.loc,
    });
  }
}

function devRunsOf(e) {
  let runs = 0;
  for (let i = 0; i < devRanLen; i++) if (devRan[i] === e) runs++;
  return runs;
}

// Development: pending() or isPending() read in a component body, untracked.
// The body runs once, so the answer never changes on screen. A server runs
// every binding once, untracked, in its component's frame once the
// component's function has returned (`_inBody` false, server-context.js): the
// same read on the client is a tracked binding, so it is not reported.
function devUntrackedPending(call) {
  const now = ownerNow();
  if (now !== null && now.Component !== undefined && now._inBody !== false) report('ERR_PENDING_READ_UNTRACKED', { data: { call } });
}

// Development: an effect whose function is async. Only the reads before its
// first await are tracked, the promise it returns is not a cleanup, and an
// older run can finish after a newer one. The test lives here, not at the call,
// so that a production build drops all of it (a minifier keeps a `.then` read).
function devAsyncEffect(e, result) {
  if (result == null || typeof result.then !== 'function') return;
  const effectName = devName(e);
  report('ERR_ASYNC_EFFECT', {
    data: { effectName },
    subject: { kind: 'effect', id: e._devId, name: effectName },
  });
}

// Development: a write made outside every transition, from neither an effect
// nor an event handler, while a transition that wrote the same signal still
// waits for its async function. A heuristic: without an async context the
// engine cannot tell which code made the write, and almost always it is that
// function writing again after an await, which no longer counts as part of
// the transition (a timer of its own looks the same). A write inside a
// transition is recorded with what it wrote, read or not.
function devWriteAfterAwait(sig, node) {
  if (currentTx !== null) {
    txRoot(currentTx).writes.add(node);
    return;
  }
  if (actionTxs.size === 0 || runningEffect !== null) return;
  const view = typeof window !== 'undefined' ? /** @type {any} */ (window) : null;
  if (view !== null && view.event !== undefined) return;
  for (const t of actionTxs) {
    if (t.writes.has(node)) {
      report('ERR_WRITE_AFTER_AWAIT', { data: { signalName: sig._debugName || '(unnamed)' } });
      return;
    }
  }
}

function devNestedFlush() {
  const context = activeSub !== null && (activeSub.flags & COMPUTED) ? `computed "${devName(activeSub)}"`
    : evalDepth !== 0 ? 'a computed'
    : runningEffect !== null ? `effect "${devName(runningEffect)}"`
    : 'an effect flush';
  report('ERR_NESTED_FLUSH_SYNC', { data: { context } });
}

// A node as the devtools hooks hand it out: a signal as its function
// (onSignalCreate), a computed, an effect or a selector key as its node.
function devHandle(node) {
  return node.flags & (COMPUTED | EFFECT | KEYED) ? node : node.sig;
}

function devTracksCauses() {
  return __devtools !== null && __devtools.trace !== false;
}

// "Why did this run": the dependencies whose value changed since the node's
// previous run (none for a first run). O(deps).
function devCauses(sub) {
  const out = [];
  const seen = sub.devSeen;
  if (seen === undefined) return out;
  for (let l = sub.depHead; l !== null; l = l.nextDep) {
    if ((l.dep.devSeq ?? 0) > seen) out.push(devHandle(l.dep));
  }
  return out;
}

function devNodeOf(x) {
  return typeof x === 'function' ? x[NODE] : x;
}

/**
 * Dev API: the dependencies `x` read in its latest run. `x` is a computed or
 * signal function, or a computed or effect node. A signal has none.
 * Development tier only; production returns [].
 */
export function __depsOf(x) {
  const out = [];
  if (!__DEV__) return out;
  const node = devNodeOf(x);
  if (node == null || !(node.flags & (COMPUTED | EFFECT))) return out;
  for (let l = node.depHead; l !== null; l = l.nextDep) {
    const h = devHandle(l.dep);
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * Dev API: the computed and effect nodes subscribed to `x` (a signal or
 * computed function, or a computed node). Development tier only; production
 * returns [].
 */
export function __subsOf(x) {
  const out = [];
  if (!__DEV__) return out;
  const node = devNodeOf(x);
  if (node == null || node.subHead === undefined) return out;
  for (let l = node.subHead; l !== null; l = l.nextSub) {
    if (!out.includes(l.sub)) out.push(l.sub);
  }
  return out;
}

/**
 * Dev API: the effect whose function is executing (untrack() does not hide
 * it), or null. Called from onSignalUpdate, it names the writer.
 * Development tier only; production returns null.
 */
export function __currentEffect() {
  return __DEV__ ? runningEffect : null;
}

/**
 * Dev API: the owner of `x`. `x` is an effect or computed node (or a computed
 * function), an owner record, or a DOM node, whose owner is the component
 * whose output holds it. Development tier only; production returns null.
 */
export function __ownerOf(x) {
  if (!__DEV__ || x == null) return null;
  if (typeof x === 'object' && typeof x.nodeType === 'number') return devDomOwner(x);
  const node = devNodeOf(x);
  return node?.owner ?? node?.devOwner ?? node?.devOwnerRef?.deref() ?? null;
}

/**
 * Dev API: where `x` (an effect, computed or owner, or a DOM node) sits, as
 * the scopes holding it, root first: components as '<Name>', and effects and
 * computeds that the compiler or their function's name named as
 * 'effect "name"'; unnamed ones (the runtime's own bindings) are left out.
 * `loc` on the array is the source location of the innermost scope that has
 * one ("src/App.jsx:12:5"), else null. Development tier only; production
 * returns an empty path.
 * @returns {string[] & { loc: string | null }}
 */
export function __ownerPath(x) {
  const path = /** @type {string[] & { loc: string | null }} */ (Object.assign([], { loc: null }));
  if (!__DEV__ || x == null) return path;
  let o = typeof x === 'object' && typeof x.nodeType === 'number' ? devDomOwner(x) : devNodeOf(x);
  for (; o != null; o = o.owner ?? o.devOwner ?? o.devOwnerRef?.deref()) {
    /** @type {[string, string | null] | null} */
    let meta = null;
    if (o.Component !== undefined) {
      meta = o.devLoc ? devSplit(o.devLoc) : null;
      path.push(`<${(meta && meta[0]) || o.Component.displayName || o.Component.name || 'Anonymous'}>`);
    } else if (o.flags & (EFFECT | COMPUTED)) {
      meta = o.devName ? devSplit(o.devName) : null;
      const kind = o.devBinding ? 'binding' : o.flags & EFFECT ? 'effect' : 'computed';
      const name = devLabel(o);
      if (name) path.push(name !== kind ? `${kind} "${name}"` : kind);
    } else if (o.sig?._debugName) {
      meta = devSplit(o.sig._debugName);
    } else if (o.devScope) {
      path.push(o.devScope);
    }
    if (path.loc === null && meta && meta[1]) path.loc = meta[1];
  }
  path.reverse();
  return path;
}

// Development: the node that opens each component's output (its start comment,
// the element that is all of its output, or, hydrated, the first node it
// adopted), for __ownerOf on a DOM node.
const devAnchors = /* @__PURE__ */ new WeakMap();

/**
 * @internal Development: record the DOM node that opens a component's output.
 * With `inner`, a node that already opens the output of a live component
 * stays that component's.
 */
export function _devAnchor(node, owner, inner) {
  if (!__DEV__ || !node) return;
  if (inner) {
    const held = devAnchors.get(node);
    if (held !== undefined && (held.flags & DISPOSED) === 0) return;
  }
  devAnchors.set(node, owner);
}

// The component whose output holds `node`: the nearest component range that
// opens before it, at its own level or an ancestor's, and has not closed
// before it; or, for a component with no range markers (one whose output is
// one element, a hydrated one), the node that opens its output when that is
// `node` or an ancestor of it.
function devDomOwner(node) {
  let skip = 0;
  let enclosing = true;
  for (let n = node; n != null;) {
    const owner = devAnchors.get(n);
    if (n.nodeType === 8) {
      if (n.data === 'c:end' && n !== node) skip++;
      else if (owner !== undefined) {
        if (skip > 0) skip--;
        else if ((owner.flags & DISPOSED) === 0) return owner;
      }
    } else if (owner !== undefined && enclosing && (owner.flags & DISPOSED) === 0) {
      return owner;
    }
    if (n.previousSibling != null) {
      n = n.previousSibling;
      enclosing = false;
    } else {
      n = n.parentNode;
      enclosing = true;
      skip = 0;
    }
  }
  return null;
}

// Development: the owners of async onMount / useEffect callbacks still
// running, so an effect their code creates after an `await`, when no owner is
// current, is reported with the owner it was obviously meant for.
/** @type {Map<any, number> | null} */
let devAsyncOwners = null;

/** @internal Development: `promise` is async work started by a callback under `owner`. */
export function _devAsyncWork(owner, promise) {
  if (!__DEV__ || owner == null) return;
  if (devAsyncOwners === null) devAsyncOwners = new Map();
  const pending = devAsyncOwners;
  pending.set(owner, (pending.get(owner) || 0) + 1);
  const done = () => {
    const n = (pending.get(owner) || 1) - 1;
    if (n === 0) pending.delete(owner); else pending.set(owner, n);
  };
  // The rejection is passed on, so a failed callback is unhandled exactly as
  // it is in production.
  promise.then(done, (err) => { done(); throw err; });
}

// --- Rebuilt components (development) ---
//
// A component holds state when its body (or an effect it owns) creates a
// signal, or when it says so (_devHoldsState: what-react's islands, whose
// state lives in React). A reactive region that runs again builds what it
// returns anew, and a component of the same function it built last time
// starts over: the state is gone, which React's reconciler would have kept.
// The compiler keeps a component across runs for <Show> and for a JSX
// ternary (it memoizes the condition and passes live props), so the report
// names that rewrite.

function devMarkState(where) {
  for (let o = where; o != null; o = o.owner) {
    if (o.Component !== undefined) {
      o.devState = true;
      return;
    }
  }
}

/** @internal Development: the component running now holds state outside What's signals (what-react's islands). */
export function _devHoldsState() {
  if (__DEV__) devMarkState(ownerNow());
}

function devHeldState(o) {
  if (o.devState === true) return true;
  for (let c = o.firstChild; c !== null; c = c.nextSibling) if (devHeldState(c)) return true;
  return false;
}

function devStatefulComponents(record) {
  /** @type {Function[] | null} */
  let list = null;
  for (let o = record.firstChild; o !== null; o = o.nextSibling) {
    if (o.Component !== undefined && devHeldState(o)) (list ??= []).push(o.Component);
  }
  return list;
}

function devRebuilt(e, held) {
  const record = e.owned;
  if (record === null) return;
  for (let o = record.firstChild; o !== null; o = o.nextSibling) {
    if (o.Component === undefined || !held.includes(o.Component)) continue;
    const component = o.Component.displayName || o.Component.name || 'Component';
    const region = devName(e);
    const where = __ownerPath(o);
    report('ERR_REBUILT_COMPONENT', {
      data: { component, region },
      subject: { kind: 'effect', name: region },
      owner: where,
      loc: e.devName ? devSplit(e.devName)[1] : where.loc,
    });
    return;
  }
}

function devOrphan(e) {
  if (devAsyncOwners === null || devAsyncOwners.size === 0) return;
  let meant = null;
  for (const owner of devAsyncOwners.keys()) meant = owner;
  const effectName = devName(e);
  const where = __ownerPath(meant);
  report('ERR_ORPHAN_EFFECT', {
    data: { effectName },
    subject: { kind: 'effect', name: effectName },
    owner: where,
    loc: e.devName ? devSplit(e.devName)[1] : where.loc,
  });
}

// Diagnostics reported in development name the scope they happened in.
if (__DEV__) _setOwnerSource(() => __ownerPath(ownerNow()));

/**
 * Drain the pre-install buffer (see devCreated). Called by devtools right after
 * __setDevToolsHooks. Returns the live entries (disposed effects and unmounted
 * components are left out), with `dropped` counting the creations the cap
 * turned away, and empties the buffer.
 */
export function __drainPreinstallBuffer() {
  /** @type {{ signals: any[], effects: any[], components: any[], dropped?: Record<string, number> }} */
  const out = { signals: [], effects: [], components: [] };
  if (!__DEV__ || preinstall === null) return out;
  for (const ref of preinstall.signals) { const v = ref.deref(); if (v) out.signals.push(v); }
  for (const ref of preinstall.effects) {
    const v = ref.deref();
    if (v && !(v.flags & DISPOSED)) out.effects.push(v);
  }
  for (const ctx of preinstall.components) out.components.push(ctx);
  const { dropped } = preinstall;
  if (dropped.signals + dropped.effects + dropped.components > 0) {
    out.dropped = { ...dropped };
    dropped.signals = dropped.effects = dropped.components = 0;
  }
  preinstall.signals.clear();
  preinstall.effects.clear();
  preinstall.components.clear();
  return out;
}
