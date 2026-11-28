// What Framework - createSelector
//
// createSelector(source) returns isSelected(key), which is `key === source()`.
// A binding that reads isSelected(key) depends on that key rather than on
// `source`, so when the source moves from a to b only the bindings that asked
// about a or b re-run: one or two re-runs per change instead of one per reader.
// This is what keeps `class={selected() === row.id ? 'danger' : ''}` cheap in a
// long list, and the compiler rewrites exactly that shape into a selector inside
// keyed .map() rows (see the auto-selector in what-compiler).
//
// The engine keeps one small key node per key that a tracked read asked about
// (reactive.js, _createSelector) and drops it when its last reader goes, so
// nothing is kept for keys whose rows are gone. A write that reaches the source
// brings the selector up to date before it returns and notifies the old and
// the new key, so every read, including one through a computed, sees the new
// answer right after the write.
//
// API credit: Solid's createSelector (MIT, Ryan Carniato). Solid finds the
// readers to notify by scanning every key on each change; this looks up the two
// keys the change involves.

import { _createSelector, __DEV__ } from './reactive.js';

export function createSelector(source) {
  if (typeof source !== 'function') {
    throw new TypeError(__DEV__
      ? '[what] createSelector(source) needs a signal or accessor function, e.g. createSelector(selectedId).'
      : '[what] createSelector: source must be a function');
  }
  return _createSelector(source);
}
