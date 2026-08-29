// What Framework - Fine-grained rendering primitives
// Re-exports from what-core/render

export {
  template,
  // Compiler-internal alias: identical to template() but never dev-warns.
  // Compiled output imports this so scaffolded apps don't log the
  // "template() is a compiler internal" guard (SPRINT v0.11 C5).
  _$template,
  insert,
  mapArray,
  spread,
  setProp,
  // Specialized setters emitted by the compiler for statically-known
  // attribute names (SPRINT v0.11 C2).
  setClass,
  setStyle,
  setAttr,
  setValue,
  setChecked,
  // Equality-gated eager memo — emitted for branch memoization of
  // conditional JSX (SPRINT v0.11 C1).
  memo,
  delegateEvents,
  on,
  classList,
  effect,
  untrack,
  _$createComponent,
  // The unbuilt sibling of _$createComponent. Emitted for the JSX handed
  // straight to hydrate(), which needs a VNode rather than finished DOM.
  _$componentVNode,
} from 'what-core/render';
