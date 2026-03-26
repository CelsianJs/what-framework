// What Framework - Reactive Primitives
// Signals + Effects: fine-grained reactivity without virtual DOM overhead
//
// Upgrades:
// - Topological ordering: computed/effects sorted by _level to prevent diamond glitches
// - Iterative computed evaluation: no recursion, handles 10K+ depth chains
// - Ownership tree: createRoot children auto-dispose when parent disposes

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
let batchDepth = 0;
let pendingEffects = [];

// WeakMap: subscriber Set → owning computed's inner effect (null/absent for signals)
// Used for topological level computation.
const subSetOwner = new WeakMap();

// --- Iterative Computed Evaluation State ---
// Uses a throw/catch trampoline to convert recursive computed evaluation
// to iterative. When a computed fn() reads another dirty computed, instead
// of recursing, we throw a sentinel that gets caught by the outer loop.
const NEEDS_UPSTREAM = Symbol('needs_upstream');
let iterativeEvalStack = null;  // array when inside evaluation loop, null otherwise

// --- Signal ---
// A reactive value. Reading inside an effect auto-tracks the dependency.
// Writing triggers only the effects that depend on this signal.

export function signal(initial, debugName) {
  let value = initial;
  const subs = new Set();

  // Unified getter/setter: sig() reads, sig(newVal) writes
  function sig(...args) {
    if (args.length === 0) {
      // Read
      if (currentEffect) {
        subs.add(currentEffect);
        currentEffect.deps.push(subs);
      }
      return value;
    }
    // Write
    const nextVal = typeof args[0] === 'function' ? args[0](value) : args[0];
    if (Object.is(value, nextVal)) return;
    value = nextVal;
    if (__DEV__ && __devtools) __devtools.onSignalUpdate(sig);
    notify(subs);
  }

  sig.set = (next) => {
    const nextVal = typeof next === 'function' ? next(value) : next;
    if (Object.is(value, nextVal)) return;
    value = nextVal;
    if (__DEV__ && __devtools) __devtools.onSignalUpdate(sig);
    notify(subs);
  };

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

  const inner = _createEffect(() => {
    value = fn();
    dirty = false;
  }, true);

  // Computed nodes start at level 1. Updated after each evaluation.
  inner._level = 1;
  inner._computed = true;
  inner._computedSubs = subs;

  // Register this subscriber set as owned by this computed
  subSetOwner.set(subs, inner);

  // Store markDirty/isDirty closures on the inner effect for iterative eval
  inner._markDirty = () => { dirty = true; };
  inner._isDirty = () => dirty;

  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.push(subs);
    }
    if (dirty) _evaluateComputed(inner);
    return value;
  }

  // When a dependency changes, mark dirty AND propagate to our subscribers.
  inner._onNotify = () => {
    dirty = true;
    notify(subs);
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

      try {
        _runEffect(current);
        _updateLevel(current);
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

// Update the topological level of a computed based on its current dependencies.
function _updateLevel(e) {
  let maxDepLevel = 0;
  for (let i = 0; i < e.deps.length; i++) {
    const owner = subSetOwner.get(e.deps[i]);
    const depLevel = owner ? owner._level : 0;
    if (depLevel > maxDepLevel) maxDepLevel = depLevel;
  }
  e._level = maxDepLevel + 1;
}

// --- Effect ---
// Runs a function, auto-tracking signal reads. Re-runs when deps change.
// Returns a dispose function.

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
  // Update level based on actual dependencies after first run
  _updateEffectLevel(e);
  // Mark as stable after first run — subsequent re-runs skip cleanup/re-subscribe
  if (opts?.stable) e._stable = true;
  const dispose = () => _disposeEffect(e);
  // Register with current root for automatic cleanup
  if (currentRoot) {
    currentRoot.disposals.push(dispose);
  }
  return dispose;
}

// Update effect level from its deps
function _updateEffectLevel(e) {
  let maxDepLevel = 0;
  for (let i = 0; i < e.deps.length; i++) {
    const owner = subSetOwner.get(e.deps[i]);
    const depLevel = owner ? owner._level : 0;
    if (depLevel > maxDepLevel) maxDepLevel = depLevel;
  }
  e._level = maxDepLevel + 1;
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
  };
  if (__DEV__ && __devtools) __devtools.onEffectCreate(e);
  return e;
}

function _runEffect(e) {
  if (e.disposed) return;

  // Stable effect fast path: deps don't change, skip cleanup/re-subscribe.
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

  cleanup(e);
  // Run effect cleanup from previous run
  if (e._cleanup) {
    try { e._cleanup(); } catch (err) {
      if (__devtools?.onError) __devtools.onError(err, { type: 'effect-cleanup', effect: e });
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
    if (__devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
    throw err;
  } finally {
    currentEffect = prev;
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
}

// Iterative notification queue to prevent stack overflow on deep computed chains.
// When notify() encounters _onNotify callbacks (from computeds), instead of
// calling them inline (which would recurse through notify → _onNotify → notify),
// we collect all subscriber sets to process in a queue and drain iteratively.
let notifyQueue = null;  // null when not draining; array when draining

function notify(subs) {
  const isOutermost = notifyQueue === null;
  if (isOutermost) notifyQueue = [];

  // Queue this subscriber set for processing
  notifyQueue.push(subs);

  if (!isOutermost) return; // Inner call — the outer loop will process it

  // Drain the queue iteratively — use index-based approach to avoid O(n) shift
  let qi = 0;
  try {
    while (qi < notifyQueue.length) {
      const currentSubs = notifyQueue[qi++];
      for (const e of currentSubs) {
        if (e.disposed) continue;
        if (e._onNotify) {
          // This may push more subscriber sets onto notifyQueue (via computed's
          // _onNotify which marks dirty and calls notify(subs)). That's fine —
          // they'll be processed in subsequent iterations of the while loop.
          e._onNotify();
        } else if (batchDepth === 0 && e._stable) {
          // Inline execution for stable effects: skip queue + flush + _runEffect overhead.
          const prev = currentEffect;
          currentEffect = null;
          try {
            const result = e.fn();
            if (typeof result === 'function') {
              if (e._cleanup) try { e._cleanup(); } catch (err) {}
              e._cleanup = result;
            }
          } catch (err) {
            if (__devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
            if (__DEV__) console.warn('[what] Error in stable effect:', err);
          } finally {
            currentEffect = prev;
          }
        } else if (!e._pending) {
          e._pending = true;
          pendingEffects.push(e);
        }
      }
    }
  } finally {
    notifyQueue = null;
  }
  if (batchDepth === 0 && pendingEffects.length > 0) scheduleMicrotask();
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

function flush() {
  let iterations = 0;
  while (pendingEffects.length > 0 && iterations < 25) {
    const batch = pendingEffects;
    pendingEffects = [];

    // Topological sort: execute effects in level order (lowest first).
    // This ensures that effects depending on multiple computeds at different
    // levels always see consistent, fully-updated values — preventing
    // diamond dependency glitches.
    batch.sort((a, b) => a._level - b._level);

    for (let i = 0; i < batch.length; i++) {
      const e = batch[i];
      e._pending = false;
      if (!e.disposed && !e._onNotify) {
        _runEffect(e);
        // Update level after re-run in case deps changed
        if (!e._computed) _updateEffectLevel(e);
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
    for (let i = 0; i < pendingEffects.length; i++) pendingEffects[i]._pending = false;
    pendingEffects.length = 0;
  }
}

// --- Memo ---
// Eager computed that only propagates when the value actually changes.
export function memo(fn) {
  let value;
  const subs = new Set();

  const e = _createEffect(() => {
    const next = fn();
    if (!Object.is(value, next)) {
      value = next;
      notify(subs);
    }
  });

  e._level = 1;

  _runEffect(e);
  _updateEffectLevel(e);

  // Register subscriber set owner for level tracking
  subSetOwner.set(subs, e);

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
export function flushSync() {
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

// --- onCleanup ---
// Register a cleanup function with the current owner/root.
// Runs when the owner is disposed.
export function onCleanup(fn) {
  if (currentRoot) {
    currentRoot.disposals.push(fn);
  }
}
