// What Framework - Agent Context
// Exposes a structured global for AI coding agents to discover and inspect the app.
// Agents can read window.__WHAT_AGENT__ to understand the framework, its state, and health.

import { __DEV__ } from './reactive.js';
import { getCollectedErrors } from './errors.js';

// --- Version ---
// Read from package.json at build time; fallback to runtime constant.
const VERSION = '0.5.6';

// --- Component Registry ---
// Tracks mounted components for agent inspection.
let mountedComponents = [];

export function registerComponent(component) {
  if (!__DEV__) return;
  mountedComponents.push(component);
}

export function unregisterComponent(component) {
  if (!__DEV__) return;
  const idx = mountedComponents.indexOf(component);
  if (idx >= 0) mountedComponents.splice(idx, 1);
}

export function getMountedComponents() {
  return mountedComponents.slice();
}

// --- Signal Registry ---
// Tracks active signals for agent inspection.
let activeSignals = [];

export function registerSignal(sig) {
  if (!__DEV__) return;
  activeSignals.push(sig);
}

export function unregisterSignal(sig) {
  if (!__DEV__) return;
  const idx = activeSignals.indexOf(sig);
  if (idx >= 0) activeSignals.splice(idx, 1);
}

export function getActiveSignals() {
  return activeSignals.slice();
}

// --- Health Check ---
// Quick health assessment for agents.

export function getHealth() {
  const errors = getCollectedErrors();
  const recentErrors = errors.filter(e => Date.now() - e.timestamp < 60000);

  // Check for effect cycles
  const cycleErrors = errors.filter(e => e.code === 'ERR_INFINITE_EFFECT');
  const effectCycleRisk = cycleErrors.length > 0;

  // Check for orphan effects (effects outside roots)
  const orphanErrors = errors.filter(e => e.code === 'ERR_ORPHAN_EFFECT');

  // Check for signal leaks (signals without subscribers that keep accumulating)
  const signalLeaks = activeSignals.filter(s => {
    if (s._subs && s._subs.size === 0) return true;
    return false;
  }).length;

  // Memory pressure heuristic
  const totalSignals = activeSignals.length;
  const memoryPressure = totalSignals > 10000 ? 'high'
    : totalSignals > 1000 ? 'medium'
    : 'low';

  return {
    effectCycleRisk,
    orphanEffects: orphanErrors.length,
    signalLeaks,
    memoryPressure,
    recentErrorCount: recentErrors.length,
    totalSignals,
    totalComponents: mountedComponents.length,
  };
}

// --- Install Agent Context ---
// Call this during app initialization (dev mode only) to expose the global.

export function installAgentContext() {
  if (!__DEV__) return;
  if (typeof globalThis === 'undefined') return;

  globalThis.__WHAT_AGENT__ = {
    framework: 'what-framework',
    version: VERSION,
    mode: 'development',
    features: ['signals', 'effects', 'computed', 'ssr', 'islands', 'router', 'stores', 'forms', 'animations', 'a11y'],

    // Live accessors — always return current state
    components: () => getMountedComponents().map(c => ({
      id: c.id,
      name: c.name || c.displayName || c.constructor?.name,
    })),

    signals: () => getActiveSignals().map((s, i) => ({
      id: i,
      name: s._debugName || `signal_${i}`,
      value: typeof s === 'function' ? s.peek?.() : undefined,
      subscriberCount: s._subs ? s._subs.size : 0,
    })),

    errors: () => getCollectedErrors(),

    health: () => getHealth(),

    // Metadata for agents
    api: {
      reactive: ['signal', 'computed', 'effect', 'batch', 'untrack', 'flushSync', 'createRoot', 'memo'],
      hooks: ['useState', 'useSignal', 'useComputed', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext', 'onMount', 'onCleanup'],
      components: ['Show', 'For', 'Switch', 'Match', 'Suspense', 'ErrorBoundary', 'lazy', 'Island'],
      data: ['useSWR', 'useQuery', 'useFetch', 'useInfiniteQuery'],
      store: ['createStore', 'derived', 'atom'],
    },
  };
}
