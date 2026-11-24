// What Framework - Fine-grained rendering primitives
// Re-exports from what-core/render

export {
  template,
  svgTemplate,
  // Compiler-internal alias: identical to template() but never dev-warns.
  // Compiled output imports this so scaffolded apps don't log the
  // "template() is a compiler internal" guard.
  _$template,
  insert,
  mapArray,
  // Keyed-only list entry, imported instead of mapArray by modules whose every
  // list is a keyed .map().
  _$mapKeyed,
  // A compiled keyed row's read of its item, and its plain fields' text.
  _$item,
  _$field,
  _$hfield,
  _$plain,
  _$hplain,
  // O(1) selection, emitted for `sel() === row.key` in keyed .map() rows.
  createSelector,
  spread,
  setProp,
  // Specialized setters emitted by the compiler for statically-known
  // attribute names.
  setClass,
  className,
  setClassList,
  setStyle,
  setAttr,
  setValue,
  setChecked,
  applyRef,
  // Equality-gated eager memo — emitted for branch memoization of
  // conditional JSX — and the lazy one, for a branch that may never be reached.
  _$memo,
  _$lazyMemo,
  // What `<C client:idle />` compiles to: an island that hydrates itself.
  _$Island,
  delegateEvents,
  // Compiled output: an element's delegated handlers belong to its owner.
  _$own,
  on,
  classList,
  isHydrating,
  effect,
  untrack,
  _$createComponent,
  // The unbuilt sibling of _$createComponent. Emitted for the JSX handed
  // straight to hydrate(), which needs a VNode rather than finished DOM.
  _$componentVNode,
  // What what-compiler's `hydratable` output calls: templates that claim the
  // server's nodes while hydrating and clone otherwise.
  _$htemplate,
  _$claim,
  _$next,
  // A hydratable template's claim of a form control, as a child and as its root.
  _$control,
  _$claimControl,
  _$skip,
  _$hole,
  _$exit,
  _$hcreateComponent,
  _$outside,
  // A hydratable array whose members claim the server's nodes in order.
  _$members,
  _$member,
  // JSX a component is handed in a prop, built where the component reads it,
  // and a compiled read of a prop where its value is placed.
  _$slots,
  // Spread props merged with their getters kept, and a rest element of
  // destructured props (live props: what-core dom.js _isLiveProp).
  _$merge,
  _$omit,
  _$place,
} from 'what-core/render';
