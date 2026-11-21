/**
 * What Framework DevTools
 *
 * Runtime instrumentation for debugging signals, effects, and components.
 * In dev mode, exposes a `window.__WHAT_DEVTOOLS__` global for inspection.
 *
 * Usage:
 *   import { installDevTools } from 'what-devtools';
 *   installDevTools();  // Call once at app entry, before app code
 *
 * Then inspect in console:
 *   __WHAT_DEVTOOLS__.signals          // Map of all live signals
 *   __WHAT_DEVTOOLS__.components       // Map of mounted components
 *   __WHAT_DEVTOOLS__.effects          // Map of active effects
 *   __WHAT_DEVTOOLS__.getDiagnostics() // coded diagnostics, cursor read
 *
 * The reactive graph is read through what-core's development API
 * (__depsOf, __currentEffect) and the engine's hooks; nothing here reaches
 * into engine internals.
 */

let installed = false;
let signalId = 0;
let effectId = 0;
let componentId = 0;

// The what-core module installDevTools() was wired to: the development graph
// API and the diagnostics channel are read from it.
/** @type {Record<string, any> | null} */
let core = null;

const EMPTY_DIAGNOSTICS = { events: [], seq: 0, dropped: 0 };

/**
 * Coded diagnostics what-core reported, oldest first. Pass the returned `seq`
 * back as `since` to read only newer ones.
 * @param {{ since?: number }} [opts]
 */
export function getDiagnostics(opts) {
  return typeof core?.getDiagnostics === 'function' ? core.getDiagnostics(opts) : EMPTY_DIAGNOSTICS;
}

// Registries
const signals = new Map();    // id → { id, name, ref, rev, createdAt, internal, componentId }
const effects = new Map();    // id → { id, name, node, kind, depSignalIds, depComputedIds, runCount, lastRunAt, causes, componentId }
const components = new Map(); // id → { id, name, element, mountedAt, parentId }

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
 * Signal and effect creation happens during the component body, so its stack
 * contains a frame named after the component function. Anonymous components
 * cannot be matched, and an arrow component bound to a const gets the const's
 * name in V8 stacks. Component ownership from the engine will replace this.
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

// --- Previews ---------------------------------------------------------------

const MAX_PREVIEW_DEPTH = 6;

function describeNode(node) {
  // id/className live on Element, not Node; a text or comment node has neither.
  const el = /** @type {Element} */ (/** @type {unknown} */ (node));
  const tag = node.nodeName?.toLowerCase() || 'node';
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '';
  return `[DOM: <${tag}${id}${cls}>]`;
}

function walkPreview(value, depth, state) {
  if (value === null) { state.left -= 4; return null; }
  const type = typeof value;
  if (type === 'undefined') { state.left -= 9; return undefined; }
  if (type === 'boolean') { state.left -= 5; return value; }
  if (type === 'number') {
    state.left -= 8;
    return Number.isFinite(value) ? value : String(value);
  }
  if (type === 'string') {
    if (value.length + 2 <= state.left) { state.left -= value.length + 2; return value; }
    const keep = Math.max(0, state.left - 2);
    state.left = 0;
    return `${value.slice(0, keep)}…(+${value.length - keep} chars)`;
  }
  if (type === 'bigint') { state.left -= 12; return `${value}n`; }
  if (type === 'symbol') { state.left -= 12; return `[Symbol: ${value.description || ''}]`; }
  if (type === 'function') { state.left -= 16; return `[Function: ${value.name || 'anonymous'}]`; }

  if (typeof Node !== 'undefined' && value instanceof Node) { state.left -= 24; return describeNode(value); }
  if (state.seen.has(value)) { state.left -= 10; return '[Circular]'; }
  if (depth >= MAX_PREVIEW_DEPTH) { state.left -= 10; return '[max depth]'; }
  if (value instanceof Error) {
    state.left -= 30;
    return { __type: 'Error', name: value.name, message: walkPreview(String(value.message), depth + 1, state) };
  }
  if (value instanceof Date) { state.left -= 26; return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString(); }
  if (value instanceof RegExp) { state.left -= 10; return String(value); }
  if (typeof Promise !== 'undefined' && value instanceof Promise) { state.left -= 10; return '[Promise]'; }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    state.left -= 20;
    return `[${value.constructor?.name || 'Binary'}: ${value.byteLength} bytes]`;
  }

  state.seen.add(value);
  try {
    if (Array.isArray(value) || value instanceof Set) {
      const items = Array.isArray(value) ? value : [...value];
      const out = [];
      state.left -= 2;
      for (let i = 0; i < items.length; i++) {
        if (state.left <= 0) { out.push(`…(+${items.length - i} items)`); break; }
        out.push(walkPreview(items[i], depth + 1, state));
        state.left -= 1;
      }
      return value instanceof Set ? { __type: 'Set', size: value.size, values: out } : out;
    }
    if (value instanceof Map) {
      const entries = {};
      let i = 0;
      state.left -= 20;
      for (const [k, v] of value) {
        if (state.left <= 0) { entries['…'] = `+${value.size - i} entries`; break; }
        const key = typeof k === 'string' ? k : String(walkPreview(k, depth + 1, state));
        state.left -= key.length + 3;
        entries[key] = walkPreview(v, depth + 1, state);
        i++;
      }
      return { __type: 'Map', size: value.size, entries };
    }
    const keys = Object.keys(value);
    const out = {};
    state.left -= 2;
    for (let i = 0; i < keys.length; i++) {
      if (state.left <= 0) { out['…'] = `+${keys.length - i} keys`; break; }
      const key = keys[i];
      state.left -= key.length + 3;
      let item;
      try { item = value[key]; } catch (err) { item = `[getter threw: ${err?.message || err}]`; }
      out[key] = walkPreview(item, depth + 1, state);
    }
    return out;
  } finally {
    state.seen.delete(value);
  }
}

/**
 * A JSON-safe preview of any value, about `budget` characters of JSON at most.
 * Long strings, collections and objects are cut with an explicit marker
 * (`…(+12 chars)`, `…(+3 items)`, `"…": "+4 keys"`); circular references,
 * DOM nodes, functions and getters that throw become descriptive strings.
 * A preview is for reading; change detection uses the signal revision.
 * @param {unknown} value
 * @param {number} [budget]
 */
export function preview(value, budget = 300) {
  try {
    return walkPreview(value, 0, { left: budget, seen: new Set() });
  } catch (err) {
    return `[unserializable: ${err?.message || err}]`;
  }
}

/**
 * Convert a value to something JSON-safe and bounded, for sending over the
 * MCP bridge. A larger-budget preview().
 * @param {unknown} value
 * @param {number} [budget]
 */
export function safeSerialize(value, budget = 2000) {
  return preview(value, budget);
}

// --- Signals ----------------------------------------------------------------

function signalIdOf(sig) {
  const id = sig?._devId;
  return id != null && signals.has(id) ? id : null;
}

/**
 * Register a signal with the devtools.
 * Called from the engine's onSignalCreate hook.
 */
export function registerSignal(sig, name) {
  if (!installed || suppressDepth > 0) return;
  const id = ++signalId;
  const entry = {
    id,
    name: sig._debugName || name || `signal_${id}`,
    ref: sig,
    rev: 0,
    createdAt: Date.now(),
    internal: false,
    componentId: attributeToComponent(),
  };
  signals.set(id, entry);
  sig._devId = id;
  emit('signal:created', { id, name: entry.name, componentId: entry.componentId });
  return id;
}

/**
 * Notify devtools that a signal was written, with the new and previous value
 * from the engine hook. The writer is the effect running at write time
 * (null for a write from an event handler or other plain code).
 */
export function notifySignalUpdate(sig, next, prev) {
  if (!installed) return;
  const id = signalIdOf(sig);
  if (id == null) return;
  const entry = signals.get(id);
  entry.rev++;
  const writer = typeof core?.__currentEffect === 'function' ? core.__currentEffect() : null;
  const writerEffectId = writer?._devId != null && effects.has(writer._devId) ? writer._devId : null;
  emit('signal:updated', { id, name: entry.name, value: next, prev, rev: entry.rev, writerEffectId });
}

/**
 * Unregister a signal.
 */
export function unregisterSignal(sig) {
  if (!installed) return;
  const id = sig._devId;
  if (id == null) return;
  signals.delete(id);
  emit('signal:disposed', { id });
}

// --- Effects and computeds --------------------------------------------------

// The engine hands a computed out as its node, which has a subscriber list;
// an effect node has none.
function kindOf(node) {
  return node && 'subHead' in node ? 'computed' : 'effect';
}

/**
 * Register an effect (or a computed) with the devtools.
 */
export function registerEffect(e, name) {
  if (!installed || suppressDepth > 0) return;
  const id = ++effectId;
  const kind = kindOf(e);
  const entry = {
    id,
    name: name || e.fn?.name || `${kind}_${id}`,
    node: e,
    kind,
    createdAt: Date.now(),
    depSignalIds: [],
    depComputedIds: [],
    runCount: 0,
    lastRunAt: null,
    causes: null,
    componentId: attributeToComponent(),
  };
  effects.set(id, entry);
  e._devId = id;
  emit('effect:created', { id, name: entry.name, kind, componentId: entry.componentId });
  return id;
}

// Dependencies (signals by signal id, computeds by effect id) of a node, read
// through the engine's development API.
function splitHandles(handles) {
  const signalIds = [];
  const computedIds = [];
  for (const h of handles || []) {
    if (typeof h === 'function') {
      const id = signalIdOf(h);
      if (id != null) signalIds.push(id);
    } else if (h?._devId != null && effects.has(h._devId)) {
      computedIds.push(h._devId);
    }
  }
  return { signalIds, computedIds };
}

function readDeps(entry) {
  if (typeof core?.__depsOf !== 'function') return;
  const { signalIds, computedIds } = splitHandles(core.__depsOf(entry.node));
  entry.depSignalIds = signalIds;
  entry.depComputedIds = computedIds;
}

/**
 * Track dependencies, run count and the cause of a run. `info.causes` lists
 * the dependencies whose value changed since the node's previous run (absent
 * for a first run).
 */
function trackEffectRun(e, info) {
  const id = e._devId;
  if (id == null) return;
  const entry = effects.get(id);
  if (!entry) return;
  readDeps(entry);
  entry.runCount++;
  entry.lastRunAt = Date.now();
  const causes = info?.causes ? splitHandles(info.causes) : null;
  entry.causes = causes ? { signalIds: causes.signalIds, computedIds: causes.computedIds } : null;
  emit('effect:run', {
    id,
    runCount: entry.runCount,
    depSignalIds: entry.depSignalIds,
    ...(causes ? { causeSignalIds: causes.signalIds, causeComputedIds: causes.computedIds } : {}),
  });
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

// --- Errors -----------------------------------------------------------------

// The engine can hand the same thrown error to onError from two places (the
// effect's own catch and the flush loop), and an error an effect re-throws can
// also surface as uncaught. Record each thrown object once.
const capturedErrors = new WeakSet();

/**
 * Capture a runtime error, once per thrown object.
 */
function captureError(err, context) {
  if (err !== null && typeof err === 'object') {
    if (capturedErrors.has(err)) return;
    capturedErrors.add(err);
  }
  const entry = {
    message: err?.message || String(err),
    stack: err?.stack || null,
    type: context?.type || 'unknown',
    effectId: context?.effect?._devId || null,
    ...(typeof err?.code === 'string' ? { code: err.code } : {}),
    timestamp: Date.now(),
  };
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors.shift();
  emit('error:captured', entry);
}

// Errors that escape to the window: a coded hook error thrown in an event
// handler, or an effect error re-thrown by an error boundary, never pass
// through the engine's onError hook.
function captureUncaught() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('error', (event) => {
    captureError(event.error ?? event.message, { type: 'uncaught' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason, { type: 'unhandled-rejection' });
  });
}

// --- Components -------------------------------------------------------------

/**
 * Register a component mount. Ids are a monotonic counter, so a remount gets a
 * fresh id; the MCP tool descriptions tell agents to re-query.
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
  emit('component:mounted', { id, name: entry.name, parentId: entry.parentId });
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
    // knownComponentNames stays populated: a re-mount of the same component
    // still attributes, and attribution costs nothing when no live one matches.
    componentsByName.get(entry.name)?.delete(id);
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
 * Get a snapshot of all tracked state, with live values.
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
      rev: entry.rev,
      componentId: entry.componentId || null,
    });
  }

  const effectList = [];
  for (const [id, entry] of effects) {
    effectList.push({
      id,
      name: entry.name,
      kind: entry.kind,
      depSignalIds: entry.depSignalIds,
      depComputedIds: entry.depComputedIds,
      runCount: entry.runCount,
      lastRunAt: entry.lastRunAt,
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
 * The whole registry, JSON-safe, for the MCP bridge. Lists are never cut: ids,
 * names, revisions, run counts and dependencies are exact, and only each
 * signal's `value` is a bounded preview().
 * @param {{ budget?: number }} [opts]
 */
export function getState({ budget = 300 } = {}) {
  const signalList = [];
  for (const [id, entry] of signals) {
    if (entry.internal) continue;
    let value;
    try { value = preview(entry.ref.peek(), budget); } catch (err) { value = `[unreadable: ${err?.message || err}]`; }
    signalList.push({ id, name: entry.name, rev: entry.rev, value, componentId: entry.componentId || null });
  }
  const effectList = [];
  for (const [id, entry] of effects) {
    effectList.push({
      id,
      name: entry.name,
      kind: entry.kind,
      runCount: entry.runCount,
      depSignalIds: entry.depSignalIds,
      depComputedIds: entry.depComputedIds,
      ...(entry.causes ? { causeSignalIds: entry.causes.signalIds, causeComputedIds: entry.causes.computedIds } : {}),
      componentId: entry.componentId || null,
    });
  }
  const componentList = [];
  for (const [id, entry] of components) componentList.push({ id, name: entry.name, parentId: entry.parentId });
  return { signals: signalList, effects: effectList, components: componentList };
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
 * Install devtools. Call once at app startup, before app code: checks that
 * fire while modules load (an uncalled signal at module scope) are only seen
 * once the hooks are in. Wires into what-core's development hooks and exposes
 * `window.__WHAT_DEVTOOLS__`.
 *
 * @param {any} [coreModule] - Optional what-core module. If not provided, attempts dynamic import.
 */
export function installDevTools(coreModule) {
  if (installed) return;
  installed = true;

  const hooks = {
    onSignalCreate: (sig) => registerSignal(sig),
    onSignalUpdate: (sig, next, prev) => notifySignalUpdate(sig, next, prev),
    onEffectCreate: (e) => registerEffect(e),
    onEffectDispose: (e) => unregisterEffect(e),
    onEffectRun: (e, info) => trackEffectRun(e, info),
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

  function installInto(mod) {
    if (!mod) return;
    core = mod;
    if (typeof mod.subscribeDiagnostics === 'function') {
      mod.subscribeDiagnostics((ev) => emit('diagnostic', ev));
    }
    if (mod.__setDevToolsHooks) mod.__setDevToolsHooks(hooks);
    if (typeof window !== 'undefined') window.__WHAT_CORE__ = mod;

    // Register what was created before installDevTools ran (module-scope
    // signals in a store imported before the devtools entry): the engine's
    // placeholder hooks buffered those creations.
    if (typeof mod.__drainPreinstallBuffer === 'function') {
      try {
        const drained = mod.__drainPreinstallBuffer();
        for (const sig of drained.signals || []) {
          if (sig._devId == null) registerSignal(sig);
        }
        for (const e of drained.effects || []) {
          if (e._devId != null) continue;
          registerEffect(e);
          const entry = effects.get(e._devId);
          if (!entry) continue;
          // An effect ran once when it was created; a computed only if it was
          // read. Fill in what the missed runs would have recorded.
          readDeps(entry);
          if (entry.kind === 'effect' || entry.depSignalIds.length || entry.depComputedIds.length) {
            entry.runCount = 1;
            entry.lastRunAt = Date.now();
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

  captureUncaught();

  if (coreModule && coreModule.__setDevToolsHooks) {
    installInto(coreModule);
  } else {
    try {
      import('what-core/internal').then(installInto).catch(() => {});
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.__WHAT_DEVTOOLS__ = {
      get signals() { return getSnapshot().signals; },
      get effects() { return getSnapshot().effects; },
      get components() { return getSnapshot().components; },
      get errors() { return getErrors(); },
      getSnapshot,
      getState,
      getErrors,
      getDiagnostics,
      subscribe,
      preview,
      safeSerialize,
      _registries: { signals, effects, components, errors },
    };
  }
}

export { signals, effects, components, errors };
