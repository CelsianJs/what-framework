// What both back ends establish before they lower a JSX root: the signal names
// visible from its scope, the namespace of every element in its tree, and the
// HTML nesting rules its markup has to satisfy.

import { annotateNamespaces } from './common.js';
import { collectSignalNamesFromScope } from './reactivity.js';
import { validateNesting } from './nesting.js';

export function enterJsxRoot(path, state) {
  // Memoized per Babel scope: every JSX root in the same scope yields the
  // same signal-name set, so without this the full scope-chain walk ran
  // once per element — O(n²) compile time for a large single component.
  const scope = path.scope;
  let cache = state._signalNamesCache;
  if (!cache) cache = state._signalNamesCache = new WeakMap();
  let names = cache.get(scope);
  if (!names) {
    names = collectSignalNamesFromScope(path);
    cache.set(scope, names);
  }
  state.signalNames = names;
  state._jsxScope = scope;
  // A root whose JSX was annotated as part of an enclosing tree keeps that
  // namespace; a true root is annotated here.
  if (path.node._whatNs === undefined) annotateNamespaces(path.node);
  validateNesting(path.node, state);
}
