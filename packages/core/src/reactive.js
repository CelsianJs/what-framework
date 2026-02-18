// What Framework - Reactive Primitives
// Signals + Effects: fine-grained reactivity without virtual DOM overhead

// Dev-mode flag — build tools can dead-code-eliminate when false
export const __DEV__ = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production' || true;

// DevTools hooks — set by what-devtools when installed.
// These are no-ops in production (dead-code eliminated with __DEV__).
export let __devtools = null;

/** @internal Install devtools hooks. Called by what-devtools. */
export function __setDevToolsHooks(hooks) {
  if (__DEV__) __devtools = hooks;
}

let currentEffect = null;
let currentRoot = null;
let batchDepth = 0;
let pendingEffects = [];

// --- Signal ---
// A reactive value. Reading inside an effect auto-tracks the dependency.
// Writing triggers only the effects that depend on this signal.

export function signal(initial) {
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

  // Notify devtools of signal creation
  if (__DEV__ && __devtools) __devtools.onSignalCreate(sig);

  return sig;
}

// --- Computed ---
// Derived signal. Lazy: only recomputes when a dependency changes AND it's read.

export function computed(fn) {
  let value, dirty = true;
  const subs = new Set();

  const inner = _createEffect(() => {
    value = fn();
    dirty = false;
  }, true);

  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.push(subs);
    }
    if (dirty) _runEffect(inner);
    return value;
  }

  // When a dependency changes, mark dirty AND propagate to our subscribers.
  // This is how effects that read this computed know to re-run:
  // signal changes → computed._onNotify → computed's subs get notified.
  inner._onNotify = () => {
    dirty = true;
    notify(subs);
  };

  read._signal = true;
  read.peek = () => {
    if (dirty) _runEffect(inner);
    return value;
  };

  return read;
}

// --- Effect ---
// Runs a function, auto-tracking signal reads. Re-runs when deps change.
// Returns a dispose function.

export function effect(fn, opts) {
  const e = _createEffect(fn);
  // First run: skip cleanup (deps is empty), just run and track
  const prev = currentEffect;
  currentEffect = e;
  try {
    const result = e.fn();
    if (typeof result === 'function') e._cleanup = result;
  } finally {
    currentEffect = prev;
  }
  // Mark as stable after first run — subsequent re-runs skip cleanup/re-subscribe
  if (opts?.stable) e._stable = true;
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
  const e = {
    fn,
    deps: [],            // array of subscriber sets (cheaper than Set for typical 1-3 deps)
    lazy: lazy || false,
    _onNotify: null,
    disposed: false,
    _pending: false,
    _stable: false,      // stable effects skip cleanup/re-subscribe on re-run
  };
  if (__DEV__ && __devtools) __devtools.onEffectCreate(e);
  return e;
}

function _runEffect(e) {
  if (e.disposed) return;

  // Stable effect fast path: deps don't change, skip cleanup/re-subscribe.
  // Effect stays subscribed to its signals from the first run.
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
    } finally {
      currentEffect = prev;
    }
    return;
  }

  cleanup(e);
  // Run effect cleanup from previous run
  if (e._cleanup) {
    try { e._cleanup(); } catch (err) {
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
  } finally {
    currentEffect = prev;
  }
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

function notify(subs) {
  for (const e of subs) {
    if (e.disposed) continue;
    if (e._onNotify) {
      e._onNotify();
    } else if (batchDepth === 0 && e._stable) {
      // Inline execution for stable effects: skip queue + flush + _runEffect overhead.
      // Safe because stable effects have fixed deps (no re-subscribe needed).
      const prev = currentEffect;
      currentEffect = null;
      try {
        const result = e.fn();
        if (typeof result === 'function') {
          if (e._cleanup) try { e._cleanup(); } catch (err) {}
          e._cleanup = result;
        }
      } catch (err) {
        if (__DEV__) console.warn('[what] Error in stable effect:', err);
      } finally {
        currentEffect = prev;
      }
    } else if (!e._pending) {
      e._pending = true;
      pendingEffects.push(e);
    }
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
  while (pendingEffects.length > 0 && iterations < 100) {
    const batch = pendingEffects;
    pendingEffects = [];
    for (let i = 0; i < batch.length; i++) {
      const e = batch[i];
      e._pending = false;
      if (!e.disposed && !e._onNotify) _runEffect(e);
    }
    iterations++;
  }
  if (iterations >= 100) {
    if (__DEV__) {
      const remaining = pendingEffects.slice(0, 3);
      const effectNames = remaining.map(e => e.fn?.name || e.fn?.toString().slice(0, 60) || '(anonymous)');
      console.warn(
        `[what] Possible infinite effect loop detected (100 iterations). ` +
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
// Reads deps eagerly (unlike lazy computed), but skips notifying subscribers
// when the recomputed value is the same. Critical for patterns like:
//   memo(() => selected() === item().id)  — 1000 memos, only 2 change
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

  _runEffect(e);

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

// --- createRoot ---
// Isolated reactive scope. All effects created inside are tracked and disposed together.
// Essential for per-item cleanup in reactive lists.
export function createRoot(fn) {
  const prevRoot = currentRoot;
  const root = { disposals: [], owner: currentRoot };
  currentRoot = root;
  try {
    const dispose = () => {
      for (let i = root.disposals.length - 1; i >= 0; i--) {
        root.disposals[i]();
      }
      root.disposals.length = 0;
    };
    return fn(dispose);
  } finally {
    currentRoot = prevRoot;
  }
}
