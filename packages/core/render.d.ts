export {
  template,
  insert,
  mapArray,
  spread,
  setProp,
  delegateEvents,
  on,
  classList,
  effect,
  untrack,
} from './index.js';
import type { VNodeChild } from './index.js';

// Compiler-internal template alias — identical to template() but never
// dev-warns. Compiled output imports this (SPRINT v0.11 C5).
export function _$template(html: string): () => Element;

// Specialized attribute setters emitted by the compiler for statically-known
// attribute names (SPRINT v0.11 C2). Function values are treated as reactive
// accessors (wrapped in an effect), mirroring setProp.
export function setClass(el: Element, value: string | null | undefined | (() => any)): void;
export function setStyle(el: Element, value: string | object | null | undefined | (() => any)): void;
export function setAttr(el: Element, name: string, value: any): void;
export function setValue(el: Element, value: any): void;
export function setChecked(el: Element, value: any): void;

// Equality-gated eager memo (the reactive memo, NOT the component-HOC `memo`
// exported from the package index). Emitted by the compiler for branch
// memoization of conditional JSX (SPRINT v0.11 C1).
export function memo<T>(fn: () => T): (() => T) & { peek(): T };

// --- Hydration ---
// hydrate() adopts server-rendered DOM instead of recreating it: it walks the
// existing nodes, attaches event handlers and reactive bindings in place, and
// restarts the useId sequence so client ids reproduce the server's.
export function hydrate(vnode: VNodeChild, container: Element): Node | Node[] | null;

/** True while a hydration pass is walking existing DOM. */
export function isHydrating(): boolean;

// SVG counterpart to template(): elements are created in the SVG namespace, which
// a plain innerHTML template cannot do.
export function svgTemplate(html: string): () => Element;

/**
 * @internal The component-call helper the compiler emits for `<Component />`.
 * Re-exported by what-framework/render so compiled output can import it from
 * the package a scaffolded app actually depends on.
 */
export function _$createComponent(component: unknown, props?: unknown, ...args: unknown[]): unknown;

/**
 * @internal The unbuilt sibling of `_$createComponent`, emitted for the JSX
 * passed directly to `hydrate()`. Returns the VNode instead of its DOM, because
 * hydration can only adopt server markup with a tree that has not been built.
 */
export function _$componentVNode(component: unknown, props?: unknown, ...args: unknown[]): VNodeChild;
