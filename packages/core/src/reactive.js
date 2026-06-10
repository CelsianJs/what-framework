// What Framework - Reactive Primitives
// Signals + Effects: fine-grained reactivity without virtual DOM overhead
//
// Upgrades:
// - Topological ordering: computed/effects sorted by _level to prevent diamond glitches
// - Iterative computed evaluation: no recursion, handles 10K+ depth chains
// - Ownership tree: createRoot children auto-dispose when parent disposes
// - Performance: cached levels, lazy sort, fast-path notify, minimal allocation

// Dev-mode flag — build tools can dead-code-eliminate when false
export const __DEV__ = typeof process !== 'undefined'
  ? process.env?.NODE_ENV !== 'production'
  : true;

// DevTools hooks — set by what-devtools when installed.
// These are no-ops in production (dead-code eliminated with __DEV__).
export let __devtools = null;

/** @internal Install devtools hooks. Called by what-devtools. */
export function __setDevToolsHooks(hooks) {
  if (__DEV__) __devtools = hooks;
}

let currentEffect = null;
let currentRoot = null;
let currentOwner = null;  // Ownership tree: tracks current owner context
let insideComputed = false; // Track whether we're inside a computed() callback (dev-mode warning)
let batchDepth = 0;
let pendingEffects = [];
let pendingNeedSort = false;  // Track whether pendingEffects actually needs sorting

// Instead of a WeakMap from subscriber Set → owning computed's inner effect,
// we store the owner directly on the Set as ._owner (20x faster than WeakMap.get).
// Signal subscriber Sets have ._owner = undefined (signals are level 0).

// --- Iterative Computed Evaluation State ---
// Uses a throw/catch trampoline to convert recursive computed evaluation
// to iterative. When a computed fn() reads another dirty computed, instead
// of recursing, we throw a sentinel that gets caught by the outer loop.
const NEEDS_UPSTREAM = Symbol('needs_upstream');
let iterativeEvalStack = null;  // array when inside evaluation loop, null otherwise

// --- Signal ---
// A reactive value. Reading inside an effect auto-tracks the dependency.
// Writing triggers only the effects that depend on this signal.
//
// Performance: signal read is the hottest path in any signal-based framework.
// Key optimizations:
// - No rest args (...args) — uses arguments.length for zero-alloc read path
// - Subscriber tracking uses lastTracked to skip redundant Set.add/Array.push
//   when the same signal is read multiple times in one effect (common pattern)
// - Write path uses === first (fast for primitives), falls back to Object.is
//   only for NaN detection
// - subs.size check avoids notify() call when no subscribers

export function signal(initial, debugName) {
  let value = initial;
  const subs = new Set();
  // Track the last effect that subscribed — skip redundant tracking when the
  // same effect reads this signal multiple times (common in template bindings).
  // lastTrackedEpoch tracks the effect's cleanup epoch to detect stale caches.
  let lastTracked = null;
  let lastTrackedEpoch = 0;

  // Shared write logic — inlined via _sigWrite closure to avoid per-call overhead
  // while keeping the sig() function body minimal for V8 optimization.
  function _sigWrite(next) {
    if (__DEV__ && insideComputed) {
      console.warn(
        '[what] Signal.set() called inside a computed function. ' +
        'This may cause infinite loops. Use effect() instead.' +
        (debugName ? ` (signal: ${debugName})` : '')
      );
    }
    const nextVal = typeof next === 'function' ? next(value) : next;
    // Fast equality: === handles all primitives except NaN.
    // Only fall through for the NaN !== NaN case.
    if (value === nextVal || (value !== value && nextVal !== nextVal)) return;
    value = nextVal;
    // Invalidate lastTracked since value changed — any effect that reads
    // this signal during re-run needs to re-track.
    lastTracked = null;
    if (__DEV__ && __devtools) __devtools.onSignalUpdate(sig);
    if (subs.size > 0) notify(subs);
  }

  // Unified getter/setter: sig() reads, sig(newVal) writes
  // Using arguments.length instead of rest args avoids array allocation on read
  function sig(newVal) {
    if (arguments.length === 0) {
      // Read — hot path, keep minimal
      const ce = currentEffect;
      if (ce !== null) {
        // Only track if this signal isn't already in the effect's deps.
        // lastTracked is a fast cache for the common case (single effect reading
        // this signal). It's reset to null on write and on cleanup epoch change.
        if (ce !== lastTracked || ce._epoch !== lastTrackedEpoch) {
          lastTracked = ce;
          lastTrackedEpoch = ce._epoch;
          subs.add(ce);
          ce.deps.push(subs);
        }
      }
      return value;
    }
    // Write via sig(newVal)
    _sigWrite(newVal);
  }

  sig.set = _sigWrite;

  sig.peek = () => value;

  sig.subscribe = (fn) => {
    return effect(() => fn(sig()));
  };

  sig._signal = true;
  if (__DEV__) {
    sig._subs = subs;
    if (debugName) sig._debugName = debugName;
  }

  // Notify devtools of signal creation
  if (__DEV__ && __devtools) __devtools.onSignalCreate(sig);

  return sig;
}

// --- Computed ---
// Derived signal. Lazy: only recomputes when a dependency changes AND it's read.
// Topological level: max(dependency levels) + 1, computed from source signals (level 0).

export function computed(fn) {
  let value, dirty = true;
  const subs = new Set();
  let lastTracked = null;
  let lastTrackedEpoch = 0;

  const inner = _createEffect(() => {
    const prevInsideComputed = insideComputed;
    if (__DEV__) insideComputed = true;
    try {
      value = fn();
      dirty = false;
    } finally {
      if (__DEV__) insideComputed = prevInsideComputed;
    }
  }, true);

  // Computed nodes start at level 1. Updated when graph structure changes.
  inner._level = 1;
  inner._computed = true;
  inner._computedSubs = subs;

  // Register this subscriber set as owned by this computed
  subs._owner = inner;

  // Store markDirty/isDirty closures on the inner effect for iterative eval
  inner._markDirty = () => { dirty = true; };
  inner._isDirty = () => dirty;

  function read() {
    const ce = currentEffect;
    if (ce !== null) {
      if (ce !== lastTracked || ce._epoch !== lastTrackedEpoch) {
        lastTracked = ce;
        lastTrackedEpoch = ce._epoch;
        subs.add(ce);
        ce.deps.push(subs);
      }
    }
    if (dirty) _evaluateComputed(inner);
    return value;
  }

  // When a dependency changes, mark dirty AND propagate to our subscribers.
  inner._onNotify = () => {
    dirty = true;
    lastTracked = null; // Invalidate tracking cache on value change
    if (subs.size > 0) notify(subs);
  };

  read._signal = true;
  read.peek = () => {
    if (dirty) _evaluateComputed(inner);
    return value;
  };

  return read;
}

// --- Iterative Computed Evaluation ---
//
// Problem: A chain of N dirty computeds causes O(N) recursive calls:
// C_N.read() → eval → fn() → C_{N-1}.read() → eval → fn() → ... → C_1.read() → eval → fn()
// This overflows the stack at ~3500 depth.
//
// Solution: Throw/catch trampoline. The outermost _evaluateComputed manages a
// stack (array). When a computed's fn() reads another dirty computed during
// evaluation, _evaluateComputed throws NEEDS_UPSTREAM. The outer loop catches
// this, adds the upstream to the stack, and processes from the bottom up.
// This converts O(N) call depth to O(1) per computed (just the outermost loop).

function _evaluateComputed(computedEffect) {
  if (iterativeEvalStack !== null) {
    // We're inside the outermost evaluation loop, and a computed's fn()
    // is reading another dirty computed. Push it onto the stack and throw
    // to abort the current fn() so the outer loop can process it first.
    iterativeEvalStack.push(computedEffect);
    throw NEEDS_UPSTREAM;
  }

  // Outermost call — enter the iterative evaluation loop.
  // The stack grows as we discover dirty upstream computeds.
  const stack = [computedEffect];
  iterativeEvalStack = stack;

  try {
    while (stack.length > 0) {
      const current = stack[stack.length - 1];

      if (!current._isDirty || !current._isDirty()) {
        // Already clean — pop and continue
        stack.pop();
        continue;
      }

      // Pre-scan known deps: if any are dirty computeds, push them onto
      // the stack first (bottom-up). This avoids the O(N^2) worst case
      // where throw/catch restarts from the top on each dirty upstream.
      let pushedUpstream = false;
      const deps = current.deps;
      for (let i = 0; i < deps.length; i++) {
        const depOwner = deps[i]._owner;
        if (depOwner && depOwner._computed && depOwner._isDirty && depOwner._isDirty()) {
          stack.push(depOwner);
          pushedUpstream = true;
        }
      }
      if (pushedUpstream) {
        // Process dirty upstreams first before re-evaluating current
        continue;
      }

      // All known deps are clean — evaluate. throw/catch is fallback
      // for newly-discovered deps only.
      try {
        const prevDepsLen = current.deps.length;
        _runEffect(current);
        // Only recompute level when graph structure changes
        if (current.deps.length !== prevDepsLen) {
          _updateLevel(current);
        }
        stack.pop(); // Successfully evaluated
      } catch (err) {
        if (err === NEEDS_UPSTREAM) {
          // A dirty upstream was discovered and pushed onto the stack.
          // Re-mark this computed dirty since its fn() was aborted mid-execution.
          current._markDirty();
          // The upstream is now at stack[stack.length-1]. Loop continues.
        } else {
          throw err; // Re-throw real errors
        }
      }
    }
  } finally {
    iterativeEvalStack = null;
  }
}

// Update the topological level of a computed/effect based on its current dependencies.
function _updateLevel(e) {
  let maxDepLevel = 0;
  const deps = e.deps;
  for (let i = 0; i < deps.length; i++) {
    const owner = deps[i]._owner;
    if (owner) {
      const depLevel = owner._level;
      if (depLevel > maxDepLevel) maxDepLevel = depLevel;
    }
  }
  e._level = maxDepLevel + 1;
}

// --- Effect ---
// Runs a function, auto-tracking signal reads. Re-runs when deps change.
// Returns a dispose function.

const _noopDispose = () => {};

export function effect(fn, opts) {
  const e = _createEffect(fn);
  e._level = 1;
  // First run: skip cleanup (deps is empty), just run and track
  const prev = currentEffect;
  currentEffect = e;
  try {
    const result = e.fn();
    if (typeof result === 'function') e._cleanup = result;
  } finally {
    currentEffect = prev;
  }
  // Compute level after first run based on actual dependencies (cached).
  _updateLevel(e);
  // Mark as stable after first run — subsequent re-runs skip cleanup/re-subscribe
  if (opts?.stable) e._stable = true;

  // Zero-dependency release (SPRINT v0.11 C4): an effect that tracked zero
  // signals on its first run can never be notified again — re-tracking only
  // happens during a re-run, and a re-run requires a notification from a
  // subscribed signal. The compiler conservatively wraps destructured props /
  // imported accessors in effects; when those turn out to be plain values the
  // effect is one-shot. If it also registered no cleanup, release it now:
  // no dispose closure, no owner registration, nothing retained.
  // - Effects that returned a cleanup keep full registration so the cleanup
  //   still runs on owner disposal.
  // - onCleanup() callbacks register with currentRoot directly (not with the
  //   effect), so they are unaffected by this release.
  // - untrack()/peek() reads inside the fn produce zero deps by design — the
  //   effect could never re-fire anyway, so releasing is safe.
  if (e.deps.length === 0 && e._cleanup === null) {
    e.disposed = true;
    if (__DEV__ && __devtools) __devtools.onEffectDispose(e);
    return _noopDispose;
  }

  const dispose = () => _disposeEffect(e);
  // Register with current root for automatic cleanup
  if (currentRoot) {
    currentRoot.disposals.push(dispose);
  }
  return dispose;
}

// --- Batch ---
// Group multiple signal writes; effects run once at the end.

export function batch(fn) {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

// --- Internals ---

function _createEffect(fn, lazy) {
  // Minimal object shape — computed() adds extra properties after creation.
  // IMPORTANT: V8 optimizes objects with a consistent "hidden class" (shape).
  // All properties must be declared upfront even if null — adding properties
  // later causes shape transitions which deoptimize property access globally.
  const e = {
    fn,
    deps: [],            // array of subscriber sets (cheaper than Set for typical 1-3 deps)
    lazy: lazy || false,
    _onNotify: null,
    disposed: false,
    _pending: false,
    _stable: false,      // stable effects skip cleanup/re-subscribe on re-run
    _level: 0,           // topological depth: signals=0, computed/effects=max(deps)+1
    _computed: false,     // true for computed inner effects
    _computedSubs: null,  // reference to the computed's subscriber set
    _isDirty: null,       // function to check if computed is dirty (set by computed())
    _markDirty: null,     // function to mark computed dirty (set by computed())
    _cleanup: null,       // cleanup function returned by effect fn (declared upfront for shape)
    _epoch: 0,           // incremented on cleanup — used by signal lastTracked cache
  };
  if (__DEV__ && __devtools) __devtools.onEffectCreate(e);
  return e;
}

function _runEffect(e) {
  if (e.disposed) return;

  // Stable effect fast path: deps don't change, skip cleanup/re-subscribe.
  // This is critical for performance: effects like `() => el.className = sig() ? 'a' : ''`
  // always read the same signal(s). After auto-promotion, re-runs skip the O(deps)
  // cleanup + re-subscribe cycle entirely.
  if (e._stable) {
    if (e._cleanup) {
      try { e._cleanup(); } catch (err) {
        if (__DEV__) console.warn('[what] Error in effect cleanup:', err);
      }
      e._cleanup = null;
    }
    const prev = currentEffect;
    currentEffect = null; // Don't re-track deps (already subscribed)
    try {
      const result = e.fn();
      if (typeof result === 'function') e._cleanup = result;
    } catch (err) {
      if (__devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
      if (__DEV__) console.warn('[what] Error in stable effect:', err);
    } finally {
      currentEffect = prev;
    }
    if (__DEV__ && __devtools?.onEffectRun) __devtools.onEffectRun(e);
    return;
  }

  // Save the single dep for auto-stable detection (safe: 1-dep effects
  // have deterministic dep sets — no conditional reads possible).
  const singleDep = e.deps.length === 1 ? e.deps[0] : null;

  cleanup(e);
  // Run effect cleanup from previous run
  if (e._cleanup) {
    try { e._cleanup(); } catch (err) {
      if (__DEV__ && __devtools?.onError) __devtools.onError(err, { type: 'effect-cleanup', effect: e });
      if (__DEV__) console.warn('[what] Error in effect cleanup:', err);
    }
    e._cleanup = null;
  }
  const prev = currentEffect;
  currentEffect = e;
  try {
    const result = e.fn();
    // Capture cleanup function if returned
    if (typeof result === 'function') {
      e._cleanup = result;
    }
  } catch (err) {
    if (err === NEEDS_UPSTREAM) throw err; // Iterative eval sentinel — not a real error
    if (__DEV__ && __devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
    throw err;
  } finally {
    currentEffect = prev;
  }

  // Auto-promote to stable: effects with exactly 1 dep that remains the same
  // after re-run have a fixed dependency graph. Skip cleanup/re-subscribe
  // on future re-runs. This is safe because a single-dep effect can't have
  // conditional signal reads that change which signal is tracked.
  // Guard: don't promote self-triggering effects (those that write to the signal
  // they read, causing re-queuing). Check e._pending to detect this.
  if (singleDep !== null && e.deps.length === 1 && e.deps[0] === singleDep
      && !e._cleanup && !e._pending) {
    e._stable = true;
  }

  if (__DEV__ && __devtools?.onEffectRun) __devtools.onEffectRun(e);
}

function _disposeEffect(e) {
  e.disposed = true;
  if (__DEV__ && __devtools) __devtools.onEffectDispose(e);
  cleanup(e);
  // Run cleanup on dispose
  if (e._cleanup) {
    try { e._cleanup(); } catch (err) {
      if (__DEV__) console.warn('[what] Error in effect cleanup on dispose:', err);
    }
    e._cleanup = null;
  }
}

function cleanup(e) {
  const deps = e.deps;
  for (let i = 0; i < deps.length; i++) deps[i].delete(e);
  deps.length = 0;
  // Increment epoch so signals' lastTracked cache is invalidated.
  // This ensures a signal will re-track this effect after cleanup.
  e._epoch++;
}

// --- Notification ---
// Iterative notification to prevent stack overflow on deep computed chains.
// Uses a reusable queue to avoid per-call array allocation.
// When notify() encounters _onNotify callbacks (from computeds), those may
// call notify() recursively. The queue drains iteratively in the outermost call.

let notifyDepth = 0;        // Tracks recursive notify depth
let notifyQueue = null;     // Reusable queue, allocated on first recursive call
let notifyQueueLen = 0;     // Length of the queue

// Process a single subscriber during notification.
// Extracted to avoid code duplication between outer and queue drain paths.
function _processSubscriber(e) {
  if (e.disposed) return;
  if (e._onNotify) {
    // Computed subscriber: mark dirty and propagate.
    // _onNotify may call notify() recursively — tracked by notifyDepth.
    e._onNotify();
  } else if (!e._pending) {
    if (batchDepth === 0 && e._stable) {
      // Inline execution for stable effects — no pending queue needed
      const prev = currentEffect;
      currentEffect = null;
      try {
        const result = e.fn();
        if (typeof result === 'function') {
          if (e._cleanup) try { e._cleanup(); } catch (err) { /* ignore */ }
          e._cleanup = result;
        }
      } catch (err) {
        if (__DEV__ && __devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
        if (__DEV__) console.warn('[what] Error in stable effect:', err);
      } finally {
        currentEffect = prev;
      }
    } else {
      e._pending = true;
      const level = e._level;
      const len = pendingEffects.length;
      if (len > 0 && pendingEffects[len - 1]._level > level) {
        pendingNeedSort = true;
      }
      pendingEffects.push(e);
    }
  }
}

function notify(subs) {
  // Fast path: no recursive notifications in progress — iterate directly.
  // This avoids array allocation for the common case (signal → effects).
  if (notifyDepth === 0) {
    notifyDepth = 1;
    try {
      for (const e of subs) {
        _processSubscriber(e);
      }
      // Drain any queued subscriber sets from recursive notify calls
      if (notifyQueueLen > 0) {
        let qi = 0;
        while (qi < notifyQueueLen) {
          const queuedSubs = notifyQueue[qi];
          notifyQueue[qi] = null; // Allow GC
          qi++;
          for (const e of queuedSubs) {
            _processSubscriber(e);
          }
        }
        notifyQueueLen = 0;
      }
    } finally {
      notifyDepth = 0;
    }
    if (batchDepth === 0 && pendingEffects.length > 0) scheduleMicrotask();
  } else {
    // Recursive call — queue the subscriber set for the outermost call to drain.
    if (notifyQueue === null) notifyQueue = [];
    if (notifyQueueLen >= notifyQueue.length) {
      notifyQueue.push(subs);
    } else {
      notifyQueue[notifyQueueLen] = subs;
    }
    notifyQueueLen++;
  }
}

let microtaskScheduled = false;
function scheduleMicrotask() {
  if (!microtaskScheduled) {
    microtaskScheduled = true;
    queueMicrotask(() => {
      microtaskScheduled = false;
      flush();
    });
  }
}

let isFlushing = false;

function flush() {
  // Re-entrancy guard: if flush() is called during an active flush (e.g., via
  // flushSync() inside a component render or effect), skip to prevent infinite
  // recursion. Pending effects will be picked up by the outer flush's while-loop.
  if (isFlushing) return;
  isFlushing = true;

  try {
    let iterations = 0;
    while (pendingEffects.length > 0 && iterations < 25) {
      const batch = pendingEffects;
      pendingEffects = [];

      // Topological sort: execute effects in level order (lowest first).
      // Fast paths:
      // 1. Single effect — no sort needed (most common case for microtask flush)
      // 2. Already sorted — skip sort (common when effects added in level order)
      // 3. Multiple effects at different levels — sort required
      if (batch.length > 1 && pendingNeedSort) {
        batch.sort((a, b) => a._level - b._level);
      }
      pendingNeedSort = false;

      for (let i = 0; i < batch.length; i++) {
        const e = batch[i];
        e._pending = false;
        if (!e.disposed && !e._onNotify) {
          const prevDepsLen = e.deps.length;
          // Isolate per-effect errors: one throwing effect must NOT abort the
          // rest of the batch (which would drop queued effects and leave the
          // graph half-updated). NEEDS_UPSTREAM is the iterative-eval sentinel
          // and must still propagate. (AUDIT-2026-06-06 H8)
          try {
            _runEffect(e);
          } catch (err) {
            if (err === NEEDS_UPSTREAM) throw err;
            if (__DEV__ && __devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
            // Surface in production too — an uncaught reactive-update error is a
            // real bug; staying silent (as the old throw-out-of-flush did once it
            // escaped) hides it. console.error never aborts the batch.
            try { console.error('[what] Uncaught error in effect during update:', err); } catch { /* no console */ }
            continue;
          }
          // Update level only if deps changed (graph structure change)
          if (!e._computed && e.deps.length !== prevDepsLen) {
            _updateLevel(e);
          }
        }
      }
      iterations++;
    }
    if (iterations >= 25) {
      if (__DEV__) {
        const remaining = pendingEffects.slice(0, 3);
        const effectNames = remaining.map(e => e.fn?.name || e.fn?.toString().slice(0, 60) || '(anonymous)');
        console.warn(
          `[what] Possible infinite effect loop detected (25 iterations). ` +
          `Likely cause: an effect writes to a signal it also reads, creating a cycle. ` +
          `Use untrack() to read signals without subscribing. ` +
          `Looping effects: ${effectNames.join(', ')}`
        );
      } else {
        console.warn('[what] Possible infinite effect loop detected');
      }
      // Clear pending effects AFTER capturing debug info
      for (let i = 0; i < pendingEffects.length; i++) pendingEffects[i]._pending = false;
      pendingEffects.length = 0;
    }
  } finally {
    isFlushing = false;
  }
}

// --- Memo ---
// Eager computed that only propagates when the value actually changes.
// Fix: Instead of calling notify(subs) inline (which bypasses topological sort
// and causes diamond-dependency glitches), push memo subscribers into
// pendingEffects and let them go through the sorted flush() path.
export function memo(fn) {
  let value;
  const subs = new Set();

  const e = _createEffect(() => {
    const next = fn();
    if (!Object.is(value, next)) {
      value = next;
      // Push subscribers into pendingEffects for topological flush
      // instead of inline notify() which can cause diamond glitches
      for (const sub of subs) {
        if (sub.disposed) continue;
        if (sub._onNotify) {
          // Computed subscriber: mark dirty and propagate
          sub._onNotify();
        } else if (!sub._pending) {
          sub._pending = true;
          const level = sub._level;
          const len = pendingEffects.length;
          if (len > 0 && pendingEffects[len - 1]._level > level) {
            pendingNeedSort = true;
          }
          pendingEffects.push(sub);
        }
      }
    }
  });

  e._level = 1;

  _runEffect(e);
  _updateLevel(e);

  // Register subscriber set owner for level tracking
  subs._owner = e;

  // Register with current root
  if (currentRoot) {
    currentRoot.disposals.push(() => _disposeEffect(e));
  }

  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.push(subs);
    }
    return value;
  }

  read._signal = true;
  read.peek = () => value;
  return read;
}

// --- flushSync ---
// Force all pending effects to run synchronously. Use sparingly.
// Calling during render or effect execution is a no-op (prevents infinite loops).
export function flushSync() {
  if (isFlushing) {
    // Re-entrant call — silently skip (Solid approach).
    // This prevents infinite loops when flushSync() is called during component
    // render or effect execution. Pending effects will be picked up by the
    // outer flush's while-loop.
    if (__DEV__) {
      console.warn(
        '[what] flushSync() called during an active flush (e.g., inside a component render or effect). ' +
        'This is a no-op to prevent infinite loops. Move flushSync() to an event handler or onMount callback.'
      );
    }
    return;
  }
  if (currentEffect) {
    // Called inside an effect/render — skip with warning
    if (__DEV__) {
      console.warn(
        '[what] flushSync() called during effect execution. ' +
        'This is a no-op to prevent infinite loops. Move flushSync() to an event handler or onMount callback.'
      );
    }
    return;
  }
  microtaskScheduled = false;
  flush();
}

// --- Untrack ---
// Read signals without subscribing
export function untrack(fn) {
  const prev = currentEffect;
  currentEffect = null;
  try {
    return fn();
  } finally {
    currentEffect = prev;
  }
}

// --- getOwner / runWithOwner ---
// Expose ownership context for advanced use cases (e.g., async operations
// that need to register disposals with the correct owner).

export function getOwner() {
  return currentOwner;
}

export function runWithOwner(owner, fn) {
  const prev = currentOwner;
  const prevRoot = currentRoot;
  currentOwner = owner;
  currentRoot = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
    currentRoot = prevRoot;
  }
}

// --- createRoot ---
// Isolated reactive scope with ownership tree.
// All effects created inside are tracked and disposed together.
// Child createRoot scopes register with parent owner — disposing parent
// automatically disposes all children (prevents orphaned subscriptions).
export function createRoot(fn) {
  const prevRoot = currentRoot;
  const prevOwner = currentOwner;
  const root = {
    disposals: [],
    owner: currentOwner,     // parent owner for ownership tree
    children: [],            // child roots (ownership tree)
    _disposed: false,
  };

  // Register this root as a child of the parent owner
  if (currentOwner) {
    currentOwner.children.push(root);
  }

  currentRoot = root;
  currentOwner = root;

  try {
    const dispose = () => {
      if (root._disposed) return;
      root._disposed = true;

      // Dispose children first (depth-first, reverse order)
      for (let i = root.children.length - 1; i >= 0; i--) {
        _disposeRoot(root.children[i]);
      }
      root.children.length = 0;

      // Dispose own effects (reverse order for LIFO cleanup)
      for (let i = root.disposals.length - 1; i >= 0; i--) {
        root.disposals[i]();
      }
      root.disposals.length = 0;

      // Remove from parent's children list
      if (root.owner) {
        const idx = root.owner.children.indexOf(root);
        if (idx >= 0) root.owner.children.splice(idx, 1);
      }
    };
    return fn(dispose);
  } finally {
    currentRoot = prevRoot;
    currentOwner = prevOwner;
  }
}

// Internal: dispose a root and all its children
function _disposeRoot(root) {
  if (root._disposed) return;
  root._disposed = true;

  // Dispose children first
  for (let i = root.children.length - 1; i >= 0; i--) {
    _disposeRoot(root.children[i]);
  }
  root.children.length = 0;

  // Dispose own effects
  for (let i = root.disposals.length - 1; i >= 0; i--) {
    root.disposals[i]();
  }
  root.disposals.length = 0;
}

// --- _createItemScope ---
// Lightweight reactive scope for list items. Unlike createRoot, this does NOT
// register with the parent ownership tree (saves ~40% allocation overhead).
// Used by mapArray where disposal is managed explicitly by the list reconciler.
export function _createItemScope(fn) {
  const prevRoot = currentRoot;
  const prevOwner = currentOwner;
  const scope = {
    disposals: [],
    owner: null,          // No parent registration
    children: [],         // Kept for compat with effects that create sub-roots
    _disposed: false,
  };

  currentRoot = scope;
  currentOwner = scope;

  try {
    const dispose = () => {
      if (scope._disposed) return;
      scope._disposed = true;
      // Dispose children
      for (let i = scope.children.length - 1; i >= 0; i--) {
        _disposeRoot(scope.children[i]);
      }
      scope.children.length = 0;
      // Dispose own effects
      for (let i = scope.disposals.length - 1; i >= 0; i--) {
        scope.disposals[i]();
      }
      scope.disposals.length = 0;
    };
    return fn(dispose);
  } finally {
    currentRoot = prevRoot;
    currentOwner = prevOwner;
  }
}

// --- onCleanup ---
// Register a cleanup function with the current owner/root.
// Runs when the owner is disposed.
export function onCleanup(fn) {
  if (currentRoot) {
    currentRoot.disposals.push(fn);
  }
}

// devtools: registry-iterator export for P1-9 —
// Late-install replay buffer. When installDevTools() runs AFTER signals or
// effects have already been created (the canonical example: a module-scope
// `export const todos = signal([], 'todos')` in store.js, imported before
// the devtools entry point), those signals were invisible to what_signals.
//
// We install a placeholder __devtools that ONLY buffers creations into weak
// refs. When the real devtools install via __setDevToolsHooks, they call
// __drainPreinstallBuffer() to register every buffered primitive.
//
// Cost in production: __DEV__ is false → __devtools stays null, no buffering.
// Cost in dev: one WeakRef per signal/effect created before install.
if (__DEV__ && typeof WeakRef !== 'undefined') {
  // Cap each buffer so an app that never installs devtools doesn't accumulate
  // refs unbounded. 2k is far more than any realistic component/signal count
  // needed before the devtools entry point runs; once devtools install, the
  // buffer is drained and subsequent creations flow through the real hooks.
  const PREINSTALL_CAP = 2000;
  const buffer = { signals: new Set(), effects: new Set(), components: [] };
  __devtools = {
    __isPreinstallBuffer: true,
    onSignalCreate(sig) {
      if (buffer.signals.size < PREINSTALL_CAP) buffer.signals.add(new WeakRef(sig));
    },
    onSignalUpdate() {},
    onEffectCreate(e) {
      if (buffer.effects.size < PREINSTALL_CAP) buffer.effects.add(new WeakRef(e));
    },
    onEffectDispose() {},
    onEffectRun() {},
    onError() {},
    onComponentMount(ctx) {
      if (buffer.components.length < PREINSTALL_CAP) buffer.components.push(ctx);
    },
    onComponentUnmount() {},
    __buffer: buffer,
  };
}

/**
 * Drain the pre-install buffer. Called by the real devtools hooks after
 * __setDevToolsHooks replaces the placeholder. Returns arrays of live refs.
 */
export function __drainPreinstallBuffer() {
  if (!__DEV__) return { signals: [], effects: [], components: [] };
  // If the current __devtools is the real one (no __isPreinstallBuffer), the
  // caller installed late and there is nothing to drain from this side.
  const out = { signals: [], effects: [], components: [] };
  const buf = (typeof __preinstallSnapshot !== 'undefined') ? __preinstallSnapshot : null;
  if (!buf) return out;
  for (const ref of buf.signals) { const v = ref.deref?.(); if (v) out.signals.push(v); }
  for (const ref of buf.effects) { const v = ref.deref?.(); if (v) out.effects.push(v); }
  for (const ctx of buf.components) out.components.push(ctx);
  return out;
}

// Capture the placeholder buffer at module load so __drainPreinstallBuffer
// can return it AFTER __setDevToolsHooks has replaced __devtools.
let __preinstallSnapshot = null;
if (__DEV__ && __devtools?.__isPreinstallBuffer) {
  __preinstallSnapshot = __devtools.__buffer;
}
