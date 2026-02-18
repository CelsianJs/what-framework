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
const signals = new Map();    // id → { name, value, subs, createdAt }
const effects = new Map();    // id → { name, deps, createdAt }
const components = new Map(); // id → { name, mountedAt, signals: [], effects: [] }

// Event listeners for the DevPanel
const listeners = new Set();

function emit(event, data) {
  for (const fn of listeners) {
    try { fn(event, data); } catch {}
  }
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
    name: name || `signal_${id}`,
    ref: sig,
    createdAt: Date.now(),
  };
  signals.set(id, entry);
  sig._devId = id;
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
  };
  effects.set(id, entry);
  e._devId = id;
  emit('effect:created', entry);
  return id;
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
 * Register a component mount.
 */
export function registerComponent(name, element) {
  if (!installed) return;
  const id = ++componentId;
  const entry = {
    id,
    name: name || 'Anonymous',
    element,
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
 */
export function getSnapshot() {
  const signalList = [];
  for (const [id, entry] of signals) {
    signalList.push({
      id,
      name: entry.name,
      value: entry.ref.peek(),
    });
  }

  const effectList = [];
  for (const [id, entry] of effects) {
    effectList.push({ id, name: entry.name });
  }

  const componentList = [];
  for (const [id, entry] of components) {
    componentList.push({ id, name: entry.name });
  }

  return { signals: signalList, effects: effectList, components: componentList };
}

/**
 * Install devtools. Call once at app startup.
 * Wires into what-core's __DEV__ hooks and exposes `window.__WHAT_DEVTOOLS__`.
 */
export function installDevTools() {
  if (installed) return;
  installed = true;

  // Wire into what-core's reactive system
  try {
    import('what-core').then(core => {
      if (core.__setDevToolsHooks) {
        core.__setDevToolsHooks({
          onSignalCreate: (sig) => registerSignal(sig),
          onSignalUpdate: (sig) => notifySignalUpdate(sig),
          onEffectCreate: (e) => registerEffect(e),
          onEffectDispose: (e) => unregisterEffect(e),
        });
      }
    }).catch(() => {
      // what-core not available — devtools still work via manual registration
    });
  } catch {}

  if (typeof window !== 'undefined') {
    window.__WHAT_DEVTOOLS__ = {
      get signals() { return getSnapshot().signals; },
      get effects() { return getSnapshot().effects; },
      get components() { return getSnapshot().components; },
      getSnapshot,
      subscribe,
      _registries: { signals, effects, components },
    };
  }
}

export { signals, effects, components };
