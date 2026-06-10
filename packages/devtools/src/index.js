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

// what-core's installSignalReadGuardrail, captured when the core module is
// wired up in installDevTools(). Dev-only: warns when a signal is coerced
// to a string/number without being called (e.g. `Total: ${count}`).
let coreSignalReadGuardrail = null;

// Registries
const signals = new Map();    // id → { name, ref, createdAt, internal }
const effects = new Map();    // id → { name, createdAt, depSignalIds, runCount, lastRunAt }
const components = new Map(); // id → { name, element, mountedAt, parentId }

// Reverse lookup: subscriber Set → signal ID (O(1) dep resolution)
const subsToSignalId = new WeakMap();

// Set of known component function names (added on registerComponent, kept
// forever even after unmount so post-mortem signals still attribute).
// Used by attributeToComponent() to recognise component frames in stack traces.
const knownComponentNames = new Set();

// name -> Set<componentId>. When multiple components share a name we cannot
// disambiguate via stack; the heuristic falls back to the most-recently-mounted.
const componentsByName = new Map();

/**
 * Heuristic attribution: parse new Error().stack to find the most recently
 * called component frame. Returns a componentId or null.
 *
 * Why a stack heuristic instead of a hook:
 *   - We cannot add bracketing hooks to packages/core (compiler agent owns it).
 *   - `onComponentMount` fires before the component body runs; there's no
 *     `onComponentRendered` paired event.
 *   - Signal/effect creation happens DURING the component body, so its
 *     stack always contains a frame named after the component function.
 *
 * Limitations:
 *   - Anonymous components (no function name) cannot be matched.
 *   - Arrow components bound to a const get the const name in V8 stacks.
 *   - In production builds without source maps, function names may be mangled
 *     — but installDevTools should only run in dev anyway.
 */
function attributeToComponent() {
  if (knownComponentNames.size === 0) return null;
  let stack;
  try { throw new Error(); } catch (e) { stack = e.stack; }
  if (!stack) return null;
  // Walk stack from innermost to outermost. The FIRST component frame we
  // hit is the deepest (currently-running) component.
  const lines = stack.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) continue;
    // Extract function name token. Handles `at Foo`, `at Object.Foo`,
    // `at new Foo`, `at Foo.bar`, `at Foo (file:line:col)`.
    const m = line.match(/^at\s+(?:new\s+)?([\w$.]+)/);
    if (!m) continue;
    const tokens = m[1].split('.');
    for (const tok of tokens) {
      if (knownComponentNames.has(tok)) {
        const ids = componentsByName.get(tok);
        if (ids && ids.size > 0) {
          // Most-recently-mounted wins.
          let max = -1;
          for (const id of ids) if (id > max) max = id;
          return max;
        }
      }
    }
  }
  return null;
}

// --- Self-tracking suppression ---
// Devtools UI rendered INSIDE the inspected app (the DevPanel) must not
// register its own signals/effects: panel-internal registrations emit
// devtools events, the panel reacts by updating its snapshot signal, the
// resulting re-render creates more effects, which emit again — an unbounded
// feedback loop that wedges and crashes the page. Re-entrant (counter).
let suppressDepth = 0;

/**
 * Run fn with devtools registration suppressed (exception-safe).
 * Signals/effects/components created inside fn are invisible to devtools.
 * Does NOT affect what-core's reactive dependency tracking.
 * @internal Used by DevPanel; exported for devtools-adjacent UIs and tests.
 */
export function _suppressDevtools(fn) {
  suppressDepth++;
  try {
    return fn();
  } finally {
    suppressDepth--;
  }
}

// Error log (capped at 100)
const errors = [];
const MAX_ERRORS = 100;

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
  if (!installed || suppressDepth > 0) return;
  const id = ++signalId;
  const entry = {
    id,
    name: sig._debugName || name || `signal_${id}`,
    ref: sig,
    createdAt: Date.now(),
    internal: false,
    // P1-6: attribute to the component currently executing, so what_explain
    // can show component-local signals instead of always returning [].
    componentId: attributeToComponent(),
  };
  signals.set(id, entry);
  sig._devId = id;
  // Reverse lookup for O(1) effect dep resolution
  if (sig._subs) subsToSignalId.set(sig._subs, id);
  // Dev guardrail: warn when this signal is string/number-coerced without
  // being called (catches `Total: ${count}` — should be `${count()}`).
  if (coreSignalReadGuardrail) {
    try { coreSignalReadGuardrail(sig, entry.name); } catch {}
  }
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
  if (!installed || suppressDepth > 0) return;
  const id = ++effectId;
  const entry = {
    id,
    name: name || e.fn?.name || `effect_${id}`,
    createdAt: Date.now(),
    depSignalIds: [],
    runCount: 0,
    lastRunAt: null,
    // P1-6: attribute to the component currently executing.
    componentId: attributeToComponent(),
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
 *
 * TODO(P2-7) — stable component IDs across remounts.
 * Currently `componentId` is a monotonic counter, so a view switch (or any
 * conditional render) produces fresh IDs even when the same component
 * remounts in the same slot. Agents that cache IDs across calls get burned.
 *
 * A stable scheme would key by (parent stable id + position + name), but
 * that requires:
 *   - Tracking position within parent (currently only parentDevId is known).
 *   - Resolving collisions when two siblings have the same name.
 *   - Deciding how recursion (component-renders-itself) is handled.
 *   - Migrating every code path that assumes monotonic numeric IDs (devtools
 *     panel, registries, MCP bridge serialization, snapshot diffing).
 *
 * Verdict: the registry rewrite is invasive enough to warrant a dedicated
 * change. For now, the MCP tool descriptions document the ephemerality
 * (see what_components / what_explain) so agents re-query before using IDs.
 */
export function registerComponent(name, element, parentDevId) {
  if (!installed || suppressDepth > 0) return;
  const id = ++componentId;
  const entry = {
    id,
    name: name || 'Anonymous',
    element,
    parentId: parentDevId || null,
    mountedAt: Date.now(),
  };
  components.set(id, entry);
  // Index by name so attributeToComponent() can match stack frames.
  if (name) {
    knownComponentNames.add(name);
    let set = componentsByName.get(name);
    if (!set) { set = new Set(); componentsByName.set(name, set); }
    set.add(id);
  }
  emit('component:mounted', entry);
  return id;
}

/**
 * Unregister a component (unmount).
 */
export function unregisterComponent(id) {
  if (!installed) return;
  const entry = components.get(id);
  components.delete(id);
  if (entry?.name) {
    const set = componentsByName.get(entry.name);
    if (set) {
      set.delete(id);
      // Keep knownComponentNames populated even after unmount — a re-mount
      // of the same component should still attribute correctly, and
      // attribution costs nothing when no live components match.
    }
  }
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
      componentId: entry.componentId || null,
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
      componentId: entry.componentId || null,
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
    onEffectCreate: (e) => registerEffect(e),
    onEffectDispose: (e) => unregisterEffect(e),
    onEffectRun: (e) => trackEffectRun(e),
    onError: (err, context) => captureError(err, context),
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
  function installInto(mod) {
    if (!mod) return;
    // Capture the guardrail BEFORE hooks go live so the very first
    // registrations (and the pre-install drain below) get wrapped too.
    if (typeof mod.installSignalReadGuardrail === 'function') {
      coreSignalReadGuardrail = mod.installSignalReadGuardrail;
    }
    if (mod.__setDevToolsHooks) mod.__setDevToolsHooks(hooks);
    if (typeof window !== 'undefined') window.__WHAT_CORE__ = mod;

    // P1-9: drain anything created BEFORE installDevTools was called
    // (e.g. module-scope signals in store.js imported before app.js).
    // The placeholder hooks in reactive.js buffered creations; we now
    // register them with the live devtools so what_signals can see them.
    if (typeof mod.__drainPreinstallBuffer === 'function') {
      try {
        const drained = mod.__drainPreinstallBuffer();
        for (const sig of drained.signals || []) {
          // Avoid double-register if the placeholder somehow already passed
          // through to hooks (defensive — should be impossible given the
          // ordering in reactive.js).
          if (sig._devId == null) registerSignal(sig);
        }
        for (const e of drained.effects || []) {
          if (e._devId == null) {
            registerEffect(e);
            // The effect already ran once before install; populate its deps
            // now so what_dependency_graph shows the edges immediately,
            // instead of waiting for the next run to re-track.
            const entry = effects.get(e._devId);
            if (entry && Array.isArray(e.deps)) {
              const depSignalIds = [];
              for (const subSet of e.deps) {
                const sigId = subsToSignalId.get(subSet);
                if (sigId != null) depSignalIds.push(sigId);
              }
              entry.depSignalIds = depSignalIds;
              entry.runCount = 1;
              entry.lastRunAt = Date.now();
            }
          }
        }
        for (const ctx of drained.components || []) {
          if (ctx._devId == null) hooks.onComponentMount(ctx);
        }
      } catch (err) {
        // Non-fatal — pre-install drain is best-effort.
        if (typeof console !== 'undefined') {
          console.warn('[what-devtools] pre-install drain failed:', err);
        }
      }
    }
  }

  if (core && core.__setDevToolsHooks) {
    installInto(core);
  } else {
    try {
      import('what-core').then(installInto).catch(() => {});
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.__WHAT_DEVTOOLS__ = {
      get signals() { return getSnapshot().signals; },
      get effects() { return getSnapshot().effects; },
      get components() { return getSnapshot().components; },
      get errors() { return getErrors(); },
      getSnapshot,
      getErrors,
      subscribe,
      safeSerialize,
      _registries: { signals, effects, components, errors },
    };
  }
}

export { signals, effects, components, errors };
