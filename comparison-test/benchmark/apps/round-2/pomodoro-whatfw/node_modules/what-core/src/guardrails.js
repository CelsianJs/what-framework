// What Framework - Agent Guardrails
// Dev-mode runtime checks that catch common mistakes BEFORE they become bugs.
// Designed for AI agents: structured warnings with fix suggestions.

import { __DEV__ } from './reactive.js';
import { createWhatError, collectError } from './errors.js';

// --- Guardrail Registry ---
// Each guardrail can be enabled/disabled independently.

const guardrails = {
  signalReadDetection: true,
  effectCycleDetection: true,
  componentNaming: true,
  importValidation: true,
};

export function configureGuardrails(overrides) {
  Object.assign(guardrails, overrides);
}

export function getGuardrailConfig() {
  return { ...guardrails };
}

// --- Guardrail 1: Signal Read Detection ---
// Detect when a signal function reference is used where its value was intended.
// This catches the pattern: <span>{count}</span> (should be count())
//
// At runtime, we can detect this when a signal is coerced to string (via toString/valueOf)
// and warn that it should be called.

export function installSignalReadGuardrail(signalFn, debugName) {
  if (!__DEV__ || !guardrails.signalReadDetection) return signalFn;

  // Override toString to catch template literal coercion
  const originalToString = signalFn.toString;
  signalFn.toString = function () {
    const err = createWhatError('MISSING_SIGNAL_READ', {
      signalName: debugName || '(unnamed)',
    });
    console.warn(`[what] ${err.message}\n  Suggestion: ${err.suggestion}`);
    collectError(err);
    // Still return the value so the app doesn't crash
    return String(signalFn());
  };

  // Override valueOf for numeric coercion contexts
  signalFn.valueOf = function () {
    const err = createWhatError('MISSING_SIGNAL_READ', {
      signalName: debugName || '(unnamed)',
    });
    console.warn(`[what] ${err.message}\n  Suggestion: ${err.suggestion}`);
    collectError(err);
    return signalFn();
  };

  return signalFn;
}

// --- Guardrail 2: Enhanced Effect Cycle Detection ---
// Track which signals an effect reads AND writes.
// If an effect writes to a signal it reads, warn about the specific cycle.

const effectWriteTracking = new WeakMap(); // effect -> Set of signal debug names

export function trackEffectSignalWrite(effectRef, signalDebugName) {
  if (!__DEV__ || !guardrails.effectCycleDetection) return;

  if (!effectWriteTracking.has(effectRef)) {
    effectWriteTracking.set(effectRef, new Set());
  }
  effectWriteTracking.get(effectRef).add(signalDebugName);
}

export function checkEffectCycle(effectRef, readSignals) {
  if (!__DEV__ || !guardrails.effectCycleDetection) return null;

  const writes = effectWriteTracking.get(effectRef);
  if (!writes || writes.size === 0) return null;

  const overlapping = [];
  for (const sigName of readSignals) {
    if (writes.has(sigName)) {
      overlapping.push(sigName);
    }
  }

  if (overlapping.length > 0) {
    const err = createWhatError('INFINITE_EFFECT', {
      effectName: effectRef.fn?.name || '(anonymous)',
      signalName: overlapping.join(', '),
    });
    collectError(err);
    return err;
  }

  return null;
}

// --- Guardrail 3: Component Naming ---
// Warn if a component function is not PascalCase.

export function checkComponentName(name) {
  if (!__DEV__ || !guardrails.componentNaming) return null;
  if (!name) return null;

  // PascalCase: starts with uppercase letter
  if (/^[A-Z]/.test(name)) return null;

  const suggestion = `Component "${name}" should use PascalCase (e.g., "${capitalize(name)}"). ` +
    'PascalCase distinguishes components from HTML elements in JSX and is required by the What Framework compiler.';

  console.warn(`[what] ${suggestion}`);
  return { code: 'WARN_COMPONENT_NAMING', name, suggestion };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// --- Guardrail 4: Import Validation ---
// Verify that all named imports from 'what-framework' are valid exports.

const VALID_EXPORTS = new Set([
  // Reactive primitives
  'signal', 'computed', 'effect', 'signalMemo', 'batch', 'untrack', 'flushSync',
  'createRoot', 'getOwner', 'runWithOwner', 'onRootCleanup', '__setDevToolsHooks',
  // Rendering
  'template', '_template', 'svgTemplate', 'insert', 'mapArray', 'spread',
  'setProp', 'delegateEvents', 'on', 'classList', 'hydrate', 'isHydrating',
  '_$createComponent',
  // JSX
  'h', 'Fragment', 'html',
  // DOM
  'mount',
  // Hooks
  'useState', 'useSignal', 'useComputed', 'useEffect', 'useMemo', 'useCallback',
  'useRef', 'useContext', 'useReducer', 'createContext', 'onMount', 'onCleanup',
  'createResource',
  // Components
  'memo', 'lazy', 'Suspense', 'ErrorBoundary', 'Show', 'For', 'Switch', 'Match', 'Island',
  // Store
  'createStore', 'derived', 'storeComputed', 'atom',
  // Head
  'Head', 'clearHead',
  // Utilities
  'each', 'cls', 'style', 'debounce', 'throttle', 'useMediaQuery',
  'useLocalStorage', 'useClickOutside', 'Portal', 'transition',
  // Scheduler
  'scheduleRead', 'scheduleWrite', 'flushScheduler', 'measure', 'mutate',
  'useScheduledEffect', 'nextFrame', 'raf', 'onResize', 'onIntersect', 'smoothScrollTo',
  // Animation
  'spring', 'tween', 'easings', 'useTransition', 'useGesture', 'useAnimatedValue',
  'createTransitionClasses', 'cssTransition',
  // Accessibility
  'useFocus', 'useFocusRestore', 'useFocusTrap', 'FocusTrap', 'announce',
  'announceAssertive', 'SkipLink', 'useAriaExpanded', 'useAriaSelected',
  'useAriaChecked', 'useRovingTabIndex', 'VisuallyHidden', 'LiveRegion',
  'useId', 'useIds', 'useDescribedBy', 'useLabelledBy', 'Keys', 'onKey', 'onKeys',
  // Skeleton
  'Skeleton', 'SkeletonText', 'SkeletonAvatar', 'SkeletonCard', 'SkeletonTable',
  'IslandSkeleton', 'useSkeleton', 'Placeholder', 'LoadingDots', 'Spinner',
  // Data fetching
  'useFetch', 'useSWR', 'useQuery', 'useInfiniteQuery', 'invalidateQueries',
  'prefetchQuery', 'setQueryData', 'getQueryData', 'clearCache', '__getCacheSnapshot',
  // Form
  'useForm', 'useField', 'rules', 'simpleResolver', 'zodResolver', 'yupResolver',
  'Input', 'Textarea', 'Select', 'Checkbox', 'Radio', 'ErrorMessage',
]);

export function validateImports(importNames) {
  if (!__DEV__ || !guardrails.importValidation) return [];

  const invalid = [];
  for (const name of importNames) {
    if (!VALID_EXPORTS.has(name)) {
      invalid.push({
        name,
        message: `"${name}" is not a valid export from what-framework.`,
        suggestion: `Check the API reference. Did you mean: ${findClosest(name)}?`,
      });
    }
  }
  return invalid;
}

// Simple Levenshtein-based closest match
function findClosest(input) {
  const lower = input.toLowerCase();
  let best = null;
  let bestDist = Infinity;

  for (const name of VALID_EXPORTS) {
    const dist = levenshtein(lower, name.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }

  return bestDist <= 3 ? best : '(no close match found)';
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}
