// What Framework - Dev-mode Warning System
// Helpful, not noisy: each unique warning fires only once.
// All warnings are dev-only and tree-shaken in production builds.

import { __DEV__ } from './reactive.js';

// Track which warnings have already been emitted (fire-once per unique key)
const _emitted = new Set();

/**
 * Emit a dev-mode warning. Fires only once per unique key.
 * @param {string} key - Unique identifier for de-duplication
 * @param {string} message - Warning message
 */
export function warn(key, message) {
  if (!__DEV__) return;
  if (_emitted.has(key)) return;
  _emitted.add(key);
  console.warn(message);
}

/**
 * Reset all emitted warnings (for testing).
 */
export function _resetWarnings() {
  _emitted.clear();
}

/**
 * Check if a warning has been emitted (for testing).
 * @param {string} key
 * @returns {boolean}
 */
export function _wasWarned(key) {
  return _emitted.has(key);
}

// --- Warning functions ---

/**
 * Warn when a signal is used in JSX without being called.
 * Detects: {count} instead of {count()} where count is a signal function.
 * @param {string} signalName - The signal's debug name
 * @param {string} [componentName] - The component where it occurred
 */
export function warnMissingSignalRead(signalName, componentName) {
  if (!__DEV__) return;
  const ctx = componentName ? ` in <${componentName}>` : '';
  warn(
    `missing-read:${signalName}:${componentName || ''}`,
    `[what] Warning: Signal '${signalName}' used without being called${ctx}. Did you mean {${signalName}()}?`
  );
}

/**
 * Warn when a signal is written during render (component function execution).
 * Writes should happen in effects or event handlers, not during render.
 * @param {string} signalName - The signal's debug name
 * @param {string} [componentName] - The component where it occurred
 */
export function warnSignalWriteDuringRender(signalName, componentName) {
  if (!__DEV__) return;
  const ctx = componentName ? ` of <${componentName}>` : '';
  warn(
    `write-during-render:${signalName}:${componentName || ''}`,
    `[what] Warning: Signal '${signalName}' written during render${ctx}. Move to effect or event handler.`
  );
}

/**
 * Warn when an effect adds an event listener but has no cleanup return.
 * @param {string} [componentName] - The component where it occurred
 */
export function warnEffectWithoutCleanup(componentName) {
  if (!__DEV__) return;
  const ctx = componentName ? ` in <${componentName}>` : '';
  warn(
    `effect-no-cleanup:${componentName || 'unknown'}`,
    `[what] Warning: Effect${ctx} adds event listener but has no cleanup. Return a cleanup function from the effect to avoid memory leaks.`
  );
}

/**
 * Warn when rendering a large list without keys.
 * @param {number} count - Number of items in the list
 * @param {string} [componentName] - The component where it occurred
 */
export function warnLargeListWithoutKeys(count, componentName) {
  if (!__DEV__) return;
  const ctx = componentName ? ` in <${componentName}>` : '';
  warn(
    `no-keys:${componentName || 'unknown'}`,
    `[what] Warning: Rendering ${count} items without keys${ctx}. Add key props for efficient DOM updates.`
  );
}

/**
 * Warn when a signal is created but never read.
 * Called lazily (e.g., on component unmount or root dispose).
 * @param {string} signalName - The signal's debug name
 * @param {string} [componentName] - The component where it occurred
 */
export function warnUnusedSignal(signalName, componentName) {
  if (!__DEV__) return;
  const ctx = componentName ? ` in <${componentName}>` : '';
  warn(
    `unused-signal:${signalName}:${componentName || ''}`,
    `[what] Warning: Signal '${signalName}' created${ctx} but never read.`
  );
}
