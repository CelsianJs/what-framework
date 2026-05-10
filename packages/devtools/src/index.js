/**
 * What Framework DevTools
 *
 * Runtime instrumentation for debugging signals, effects, and components.
 * In dev mode, exposes a `window.__WHAT_DEVTOOLS__` global for inspection.
 *
 * Usage:
 *   import { installDevTools } from 'what-devtools';
 *   installDevTools();  // Call once at app entry
 *
 * Then inspect in console:
 *   __WHAT_DEVTOOLS__.signals      // Map of all live signals
 *   __WHAT_DEVTOOLS__.components   // Map of mounted components
 *   __WHAT_DEVTOOLS__.effects      // Map of active effects
 */

let installed = false;
let signalId = 0;
let effectId = 0;
let componentId = 0;

// Registries
const signals = new Map();    // id → { name, ref, createdAt, internal }
const effects = new Map();    // id → { name, createdAt, depSignalIds, runCount, lastRunAt }
const components = new Map(); // id → { name, element, mountedAt, parentId }

// Reverse lookup: subscriber Set → signal ID (O(1) dep resolution)
const subsToSignalId = new WeakMap();

// Error log (capped at 100)
const errors = [];
const MAX_ERRORS = 100;

// Hydration mismatch log (capped at 50)
const hydrationMismatches = [];
const MAX_HYDRATION_MISMATCHES = 50;

// Event listeners for the DevPanel
const listeners = new Set();

function emit(event, data) {
  for (const fn of listeners) {
    try { fn(event, data); } catch {}
  }
}

/**
 * Safely serialize a value for transport (WS, JSON).
 * Handles DOM nodes, functions, circular refs, Maps, Sets, large collections.
 */
export function safeSerialize(value, depth = 0, seen) {
  if (depth > 6) return '[max depth]';
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (type === 'symbol') return `[Symbol: ${value.description || ''}]`;
  if (type === 'bigint') return value.toString() + 'n';

  // DOM nodes
  if (typeof Node !== 'undefined' && value instanceof Node) {
    const tag = value.nodeName?.toLowerCase() || 'node';
    const id = value.id ? `#${value.id}` : '';
    const cls = value.className ? `.${String(value.className).split(' ')[0]}` : '';
    return `[DOM: <${tag}${id}${cls}>]`;
  }

  if (!seen) seen = new Set();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  // Map
  if (value instanceof Map) {
    if (value.size > 50) return `[Map: ${value.size} entries]`;
    const obj = {};
    for (const [k, v] of value) {
      obj[String(k)] = safeSerialize(v, depth + 1, seen);
    }
    return { __type: 'Map', entries: obj };
  }

  // Set
  if (value instanceof Set) {
    if (value.size > 50) return `[Set: ${value.size} items]`;
    return { __type: 'Set', values: [...value].map(v => safeSerialize(v, depth + 1, seen)) };
  }

  // Array
  if (Array.isArray(value)) {
    if (value.length > 100) {
      return [...value.slice(0, 100).map(v => safeSerialize(v, depth + 1, seen)), `... (${value.length} total)`];
    }
    return value.map(v => safeSerialize(v, depth + 1, seen));
  }

  // Error
  if (value instanceof Error) {
    return { __type: 'Error', name: value.name, message: value.message, stack: value.stack };
  }

  // Date
  if (value instanceof Date) return { __type: 'Date', iso: value.toISOString() };

  // RegExp
  if (value instanceof RegExp) return value.toString();

  // Plain object
  if (type === 'object') {
    const keys = Object.keys(value);
    if (keys.length > 100) {
      const obj = {};
      for (const k of keys.slice(0, 100)) {
        obj[k] = safeSerialize(value[k], depth + 1, seen);
      }
      obj['...'] = `(${keys.length} total keys)`;
      return obj;
    }
    const obj = {};
    for (const k of keys) {
      obj[k] = safeSerialize(value[k], depth + 1, seen);
    }
    return obj;
  }

  return String(value);
}

/**
 * Register a signal with the devtools.
 * Called from reactive.js __DEV__ hooks.
 */
export function registerSignal(sig, name) {
  if (!installed) return;
  const id = ++signalId;
  const entry = {
    id,
    name: sig._debugName || name || `signal_${id}`,
    ref: sig,
    createdAt: Date.now(),
    internal: false,
  };
  signals.set(id, entry);
  sig._devId = id;
  // Reverse lookup for O(1) effect dep resolution
  if (sig._subs) subsToSignalId.set(sig._subs, id);
  emit('signal:created', entry);
  return id;
}

/**
 * Notify devtools that a signal value changed.
 */
export function notifySignalUpdate(sig) {
  if (!installed) return;
  const id = sig._devId;
  if (id == null) return;
  const entry = signals.get(id);
  if (entry) {
    emit('signal:updated', { id, name: entry.name, value: sig.peek() });
  }
}

/**
 * Unregister a signal (when disposed via createRoot cleanup).
 */
export function unregisterSignal(sig) {
  if (!installed) return;
  const id = sig._devId;
  if (id == null) return;
  signals.delete(id);
  emit('signal:disposed', { id });
}

/**
 * Register an effect with the devtools.
 */
export function registerEffect(e, name) {
  if (!installed) return;
  const id = ++effectId;
  const entry = {
    id,
    name: name || e.fn?.name || `effect_${id}`,
    createdAt: Date.now(),
    depSignalIds: [],
    runCount: 0,
    lastRunAt: null,
  };
  effects.set(id, entry);
  e._devId = id;
  emit('effect:created', entry);
  return id;
}

/**
 * Track effect dependencies and run count after an effect runs.
 */
function trackEffectRun(e) {
  const id = e._devId;
  if (id == null) return;
  const entry = effects.get(id);
  if (!entry) return;

  // Resolve deps via WeakMap reverse lookup — O(m) where m = number of deps
  const depSignalIds = [];
  if (e.deps) {
    for (const subSet of e.deps) {
      const sigId = subsToSignalId.get(subSet);
      if (sigId != null) depSignalIds.push(sigId);
    }
  }

  entry.depSignalIds = depSignalIds;
  entry.runCount = (entry.runCount || 0) + 1;
  entry.lastRunAt = Date.now();
  emit('effect:run', { id, depSignalIds: entry.depSignalIds, runCount: entry.runCount });
}

/**
 * Unregister an effect.
 */
export function unregisterEffect(e) {
  if (!installed) return;
  const id = e._devId;
  if (id == null) return;
  effects.delete(id);
  emit('effect:disposed', { id });
}

/**
 * Capture a runtime error.
 */
function captureError(err, context) {
  const entry = {
    message: err?.message || String(err),
    stack: err?.stack || null,
    type: context?.type || 'unknown',
    effectId: context?.effect?._devId || null,
    timestamp: Date.now(),
  };
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors.shift();
  emit('error:captured', entry);
}

/**
 * Register a component mount.
 */
export function registerComponent(name, element, parentDevId) {
  if (!installed) return;
  const id = ++componentId;
  const entry = {
    id,
    name: name || 'Anonymous',
    element,
    parentId: parentDevId || null,
    mountedAt: Date.now(),
  };
  components.set(id, entry);
  emit('component:mounted', entry);
  return id;
}

/**
 * Unregister a component (unmount).
 */
export function unregisterComponent(id) {
  if (!installed) return;
  components.delete(id);
  emit('component:unmounted', { id });
}

/**
 * Subscribe to devtools events.
 * Returns an unsubscribe function.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Get a snapshot of all tracked state.
 * @param {object} [opts] - Options
 * @param {boolean} [opts.includeInternal=false] - Include framework-internal signals
 */
export function getSnapshot(opts = {}) {
  const { includeInternal = false } = opts;

  const signalList = [];
  for (const [id, entry] of signals) {
    if (!includeInternal && entry.internal) continue;
    signalList.push({
      id,
      name: entry.name,
      value: entry.ref.peek(),
    });
  }

  const effectList = [];
  for (const [id, entry] of effects) {
    effectList.push({
      id,
      name: entry.name,
      depSignalIds: entry.depSignalIds || [],
      runCount: entry.runCount || 0,
      lastRunAt: entry.lastRunAt || null,
    });
  }

  const componentList = [];
  for (const [id, entry] of components) {
    componentList.push({ id, name: entry.name, parentId: entry.parentId });
  }

  return {
    signals: signalList,
    effects: effectList,
    components: componentList,
    errors: errors.slice(),
    hydrationMismatches: hydrationMismatches.slice(),
  };
}

/**
 * Get captured errors.
 * @param {object} [opts]
 * @param {number} [opts.since] - Only errors after this timestamp
 */
export function getErrors(opts = {}) {
  const { since } = opts;
  if (since) return errors.filter(e => e.timestamp > since);
  return errors.slice();
}

/**
 * Install devtools. Call once at app startup.
 * Wires into what-core's __DEV__ hooks and exposes `window.__WHAT_DEVTOOLS__`.
 *
 * @param {object} [core] - Optional what-core module. If not provided, attempts dynamic import.
 */
export function installDevTools(core) {
  if (installed) return;
  installed = true;

  const hooks = {
    onSignalCreate: (sig) => registerSignal(sig),
    onSignalUpdate: (sig) => notifySignalUpdate(sig),
    onSignalDispose: (sig) => unregisterSignal(sig),
    onEffectCreate: (e) => registerEffect(e),
    onEffectDispose: (e) => unregisterEffect(e),
    onEffectRun: (e) => trackEffectRun(e),
    onError: (err, context) => captureError(err, context),
    onHydrationMismatch: (info) => {
      const entry = {
        type: 'hydration_mismatch',
        component: info.component,
        expected: info.expected,
        actual: info.actual,
        mismatchCount: info.mismatchCount,
        timestamp: Date.now(),
      };
      hydrationMismatches.push(entry);
      if (hydrationMismatches.length > MAX_HYDRATION_MISMATCHES) hydrationMismatches.shift();
      emit('hydration:mismatch', entry);
    },
    onComponentMount: (ctx) => {
      const name = ctx.Component?.displayName || ctx.Component?.name || 'Anonymous';
      const parentDevId = ctx._parentCtx?._devId || null;
      const id = registerComponent(name, ctx._wrapper, parentDevId);
      ctx._devId = id;
    },
    onComponentUnmount: (ctx) => {
      if (ctx._devId != null) unregisterComponent(ctx._devId);
    },
  };

  // Wire into what-core's reactive system
  if (core && core.__setDevToolsHooks) {
    core.__setDevToolsHooks(hooks);
    if (typeof window !== 'undefined') window.__WHAT_CORE__ = core;
  } else {
    try {
      import('what-core').then(mod => {
        if (mod.__setDevToolsHooks) mod.__setDevToolsHooks(hooks);
        if (typeof window !== 'undefined') window.__WHAT_CORE__ = mod;
      }).catch(() => {});
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.__WHAT_DEVTOOLS__ = {
      get signals() { return getSnapshot().signals; },
      get effects() { return getSnapshot().effects; },
      get components() { return getSnapshot().components; },
      get errors() { return getErrors(); },
      get hydrationMismatches() { return hydrationMismatches.slice(); },
      getSnapshot,
      getErrors,
      subscribe,
      safeSerialize,
      _registries: { signals, effects, components, errors, hydrationMismatches },
    };
  }
}

export { signals, effects, components, errors, hydrationMismatches };
