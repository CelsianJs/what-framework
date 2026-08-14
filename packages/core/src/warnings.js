// What Framework - Dev-mode Warning System
// Helpful, not noisy: each unique warning fires only once.
// All warnings are dev-only and tree-shaken in production builds.
//
// STATUS: warn() and the fire-once bookkeeping work. NONE of the five
// warnXxx() helpers below has a caller anywhere in the framework, and this
// module is not re-exported from index.js, so nothing outside its own unit
// test has ever imported it. Verified 2026-08 by grepping every package for
// each helper name: the only hits are the definitions here and
// packages/core/test/warnings.test.js, which calls them directly.
//
// That matters because docs-site/llms-full.txt advertises several of these as
// conditions "the runtime detects and reports in dev mode". It does not. What
// each one would actually need, written down so the next reader does not have
// to re-derive it (same reasoning as the removed-guardrail note in
// guardrails.js):
//
//   warnMissingSignalRead      Redundant. The condition IS reported, by
//                              installSignalReadGuardrail() in guardrails.js,
//                              which raises ERR_MISSING_SIGNAL_READ off the
//                              signal's toString/valueOf. Prefer that path.
//
//   warnSignalWriteDuringRender  Needs two hooks in files this module cannot
//                              reach: a render-phase flag set around the
//                              `Component(reactiveProps)` call in dom.js
//                              createComponent(), and a read of that flag in
//                              _sigWrite() in reactive.js. Both are required:
//                              the write site alone cannot tell a render from
//                              a handler, and the render site alone never sees
//                              the write. A signal function cannot be patched
//                              from outside to catch this either — sig(v)
//                              calls the _sigWrite closure directly, not the
//                              replaceable sig.set property. NOTE the false
//                              positive to avoid when wiring it: components
//                              run ONCE, so a handler merely DEFINED in a
//                              component body is not a write during render.
//                              Only a write that executes synchronously
//                              inside the body counts, which is exactly what
//                              a render-phase flag measures.
//
//   warnEffectWithoutCleanup   Would have to observe addEventListener calls
//                              made during an effect's run and correlate them
//                              with the effect's return value. Nothing tracks
//                              that today.
//
//   warnLargeListWithoutKeys   The condition is already reported, at BUILD
//                              time, by the babel plugin (search
//                              ERR_MISSING_KEY in
//                              packages/compiler/src/babel-plugin.js).
//                              Key-ness is settled by the source, so the
//                              compiler sees it and the runtime does not need
//                              to.
//
//   warnUnusedSignal           Needs a read-count on every signal plus a
//                              disposal hook to check it at. reactive.js
//                              tracks neither.
//
// ERR_ORPHAN_EFFECT, also advertised in llms-full.txt, has no helper here on
// purpose: it is not detectable. See the note at the bottom of this file.

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

// --- Why there is no warnOrphanEffect() ---
//
// ERROR_CODES.ORPHAN_EFFECT ("created outside a reactive root — it will never
// be cleaned up") has no detectable condition in What, so no helper for it is
// added here. The only signal available at effect() creation time is whether
// there is a current owner, and getOwner() returns null in every ordinary
// place an effect is written. Measured against this build:
//
//   module scope ........ null      onMount() callback ... null
//   component body ...... null      event handler ....... null
//   inside createRoot() .. owner
//
// So the check would fire on effects created in a component body, which is
// the very thing the error's own suggestion text tells the user to do
// instead. Firing on the recommended fix is the worst possible outcome for a
// warning, and there is no second signal to narrow it with: What has no
// component-level owner for an effect to attach to. Detecting this would mean
// giving components an owner scope first, which is a reactivity change, not a
// warning.
//
// (Related, and separately worth someone's attention: because a component
// body has no owner, a bare effect() created in one is not registered for
// disposal at all. Unmounting the component leaves it subscribed and re-running
// — reproducible by mounting a component that calls effect(), unmounting it,
// then writing the signal it reads and watching the run count climb. Fixing
// that lives in dom.js/reactive.js, not here.)
