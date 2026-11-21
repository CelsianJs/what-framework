// Tie bundle evidence to the What runtime entry points that keep the code reachable.
const reasons = {
  mount: 'Direct app entry. Disposes the previous tree and dispatches the input through createDOM.',
  createDOM: 'Shared dispatcher for mount, compiled components and generic inserts. It handles DOM, VNodes, lists, accessors and fragments.',
  disposeTree: 'Called by mount and generic DOM replacement. Cleans up components, effects and owned nodes.',
  _liveRegionNodes: 'Called by reactive and generic replacement to walk live ranges between paired markers.',
  _isEventProp: 'General VNode prop dispatch distinguishes event handlers from accessors.',
  _isUnsafeAttr: 'The VNode prop path screens URLs and unsafe attributes.',
  _isAriaAttr: 'The general VNode prop path preserves ARIA boolean syntax.',
  _setSelectValue: 'The general VNode prop path handles single and multiple select values.',
  getCurrentComponent: 'Shared component stack lookup. dom.js:493 also registers it for error reporting.',
  getComponentStack: 'Compiled insert captures and restores the active component around an effect.',
  _installLazyChildren: 'General component instantiation can receive a deferred compiled child factory.',
  _handleNavigationSignal: 'General component error handling checks for router navigation before sending errors to a boundary.',
  _$componentVNode: 'Called by the compiler-emitted _$createComponent to normalize props and children.',
  _$createComponent: 'Compiler-emitted component entry. Calls the general createDOM dispatcher.',
  _$template: 'Compiler-emitted template used for the main element and its children.',
  svgTemplate: 'The same template implementation dispatches to SVG parsing based on the template string.',
  insert: 'Compiler-emitted reactive counter binding. Text shares this helper with list and general value insertion.',
  delegateEvents: 'Compiler-emitted click event registration executes at module load.',
  __DEV__: 'Runtime global override keeps the development condition live in framework modules.',
  __devtools: 'The module-load development buffer and reachable signal, effect and component hooks share this binding.',
  signal: 'App counter state. Also used within the reached DOM runtime.',
  effect: 'Compiler insertion and general DOM binders use tracked effects.',
  untrack: 'Used for component execution and reconciliation reads that must avoid capturing dependencies.',
  _injectGetCurrentComponent: 'dom.js:493 registers the stack lookup read by reportError.',
  reportError: 'General component and effect error handling can route errors through a context boundary.',
};

export const bundleMarkers = {
  'Runtime development override': ['__WHAT_DEV__', 'reactive.js:23'],
  'WeakRef devtools preinstall buffer': ['__isPreinstallBuffer', 'reactive.js:934'],
  'Signal update hook': ['onSignalUpdate', 'reactive.js:106'],
  'Effect run hook': ['onEffectRun', 'reactive.js:353'],
  'Component mount/unmount hooks': ['onComponentUnmount', 'dom.js:142'],
  'Invalid template nesting diagnostic': ['ERR_INVALID_HTML_NESTING', 'render.js:157'],
  'Invalid insertion parent warning': ['reconcileInsert called with invalid parent', 'render.js:495'],
  'Potential XSS warning for raw HTML': ['dangerouslySetInnerHTML contains potential XSS', 'dom.js:1127'],
  'Effect loop developer guidance': ['ERR_INFINITE_EFFECT', 'reactive.js:1346'],
  'Unsafe URL warning and block': ['Blocked unsafe URL', 'dom.js:1089'],
  'Uncaught reactive-update error reporting': ['Uncaught error in effect during update', 'reactive.js:610'],
  'Production effect-loop warning': ['Possible infinite effect loop detected', 'reactive.js:1083'],
  'Hydration diagnostic': ['hydrate() was given DOM', 'render.js:1955'],
};

const regions = [
  ['VNode class bridge, component context and lifecycle', 'dom.js', 616, 772],
  ['VNode error/suspense boundaries and portal', 'dom.js', 773, 976],
  ['Fallback element creation and generic prop handling', 'dom.js', 977, 1300],
  ['Generic VNode dispatcher', 'dom.js', 281, 456],
  ['Disposal and live range tracking', 'dom.js', 108, 263],
  ['Compiled templates and SVG/table fallback', 'render.js', 94, 219],
  ['Generic insertion, conversion and reconciliation', 'render.js', 235, 592],
  ['Keyed and unkeyed list reconciliation', 'render.js', 601, 1450],
  ['Hydration entry, walker and boundaries', 'render.js', 1770, 2927],
  ['Development-only preinstall buffer', 'reactive.js', 934, 960],
];

export function auditRegions(sources) {
  return regions.map(([name, file, first, last]) => {
    const source = 'packages/core/src/' + file;
    const minifiedBytes = (sources.get(source) ?? [])
      .filter(span => span.line >= first && span.line <= last)
      .reduce((sum, span) => sum + span.bytes, 0);
    return { name, source, first, last, minifiedBytes };
  }).sort((a, b) => b.minifiedBytes - a.minifiedBytes);
}

export function explainExport(row) {
  if (!row.rollupRendered && !row.minifiedBytes) return null;
  return reasons[row.name] ?? 'Retained in this build. No reviewed call path is recorded for this helper.';
}
