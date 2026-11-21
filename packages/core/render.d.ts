export { effect, untrack } from './index.js';
import type { VNodeChild, Signal } from './index.js';

// Fine-grained rendering primitives: the runtime compiled JSX calls, for code
// written without JSX.
export function template(html: string): () => Element;
export function insert(parent: Node, child: any, marker?: Node | null): any;
export function mapArray<T>(
  source: () => T[],
  mapFn: (item: T | Signal<T>, index: number, raw: T) => Node,
  /**
   * `raw`: the row gets the item itself. `follow`: the row gets the item's cell
   * (what-compiler's `.map()` lowering). `loc`: the list's source location,
   * named by the duplicate-key diagnostic.
   */
  options?: { key?: (item: T) => string | number; raw?: boolean; follow?: boolean; loc?: string },
): (parent: Node, marker?: Node | null) => Node;
export function spread(el: Element, props: Record<string, any>): void;
export function setProp(el: Element, key: string, value: any): void;
/**
 * One listener per event type on `root` (the document by default; a shadow root
 * or an element delegates for its own subtree) runs the `$$event` handlers on
 * the event's path.
 */
export function delegateEvents(eventNames: string[], root?: Document | ShadowRoot | Element): void;
/** Add a DOM listener; returns the function that removes it. In components, write onClick={...} in JSX. */
export function on(el: Element, event: string, handler: (e: Event) => void): () => void;
export function classList(
  el: Element,
  classes: Record<string, unknown> | null | undefined | (() => Record<string, unknown> | null | undefined),
): void;

/** @internal Used by what-text. Lets the text engine intercept text-node insertion. */
export function _setTextInsertHook(hook: unknown): void;

// Compiler-internal template: parsed on first use. `flag` 2 marks markup the
// compiler wrapped in <svg>/<math> so its root parses in that namespace.
export function _$template(html: string, flag?: number): () => Element;

// Specialized attribute setters emitted by the compiler for statically-known
// attribute names (SPRINT v0.11 C2). Function values are treated as reactive
// accessors (wrapped in an effect), mirroring setProp.
export function setClass(el: Element, value: string | null | undefined | (() => any)): void;
/** class on an element the compiler knows is HTML or MathML: writes `className`. */
export function className(el: Element, value: string | null | undefined | (() => any)): void;
/**
 * classList={{ name: boolean }}: toggles each key by the truthiness of its value
 * over the class attribute. A function classList, or a function value, is a
 * reactive accessor. A key a previous object had falls back to the class
 * attribute. Composes with `class` in prop order, as the server folds them.
 */
export function setClassList(
  el: Element,
  value: Record<string, unknown> | null | undefined | (() => Record<string, unknown> | null | undefined),
): void;
/**
 * ref={...}: calls a callback with the element or sets `.current` on a ref object.
 * Returns the element when `ref` is neither, including when it is a DOM node (a
 * `let` ref still holding an earlier element); the compiler assigns the result
 * back to a `let` ref.
 */
export function applyRef<T>(ref: T, el: Element): T | Element;
export function setStyle(el: Element, value: string | object | null | undefined | (() => any)): void;
export function setAttr(el: Element, name: string, value: any): void;
export function setValue(el: Element, value: any): void;
export function setChecked(el: Element, value: any): void;

/** O(1) keyed selection; see createSelector in the package index. */
export function createSelector<T>(source: () => T): (key: T) => boolean;

/** @internal A keyed list row's item cell (mapArray's `follow` mode); read it with `_$item`. */
export interface RowItem<T> {
  readonly value: T;
}
/** @internal Read a compiled `.map()` row's item from its cell; bindings that read it track it. */
export function _$item<T>(cell: RowItem<T>): T;

/**
 * @internal The keyed-only list the compiler imports (as `_$mapArray`) in modules
 * whose every list is a keyed `.map()`: raw items, or with `follow` the item's
 * cell (see mapArray).
 */
export function _$mapKeyed<T>(
  source: () => T[] | null | undefined,
  mapFn: (item: any, index: number, raw: T) => Node,
  options: { key: (item: T) => unknown; raw?: boolean; follow?: boolean; loc?: string },
): (parent: Node, marker?: Node | null) => Comment;

// Equality-gated eager memo (the reactive memo, NOT the component-HOC `memo`
// exported from the package index). Emitted by the compiler for branch
// memoization of conditional JSX (SPRINT v0.11 C1).
export function memo<T>(fn: () => T): (() => T) & { peek(): T };

// --- Hydration ---
// hydrate() adopts server-rendered DOM instead of recreating it: the tree's
// components run once, and what they render claims the nodes the server wrote
// (h() vnodes, and compiled JSX built with what-compiler's `hydratable`
// option). Returns the unmount function, as mount() does; hydrating or
// mounting into the same container disposes the root it held.
export interface HydrationMismatch {
  /** tag, text, missing, extra-nodes, marker, key, or not-hydratable (DOM built before hydrate() could claim the server's, reported once) */
  kind: string;
  /** The component whose output mismatched, or 'root'. */
  component: string;
  /** Its owner path (the server's data-hk), or null. */
  ownerPath: string | null;
  /** The DOM path under the container, e.g. `main>ul>li[1]`. */
  path: string;
  expected: string;
  found: string;
  /** 'client-render', or 'none' for a key mismatch. */
  recovery: string;
}
export interface HydrateOptions {
  /** Called for every mismatch, in production too (where nothing is logged). */
  onHydrationError?: (mismatch: HydrationMismatch) => void;
}
export function hydrate(vnode: VNodeChild, container: string | Element, options?: HydrateOptions): () => void;

/** True while a hydration pass is claiming server-rendered DOM. */
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
 * passed directly to `hydrate()` in a hydratable build: hydrate() runs it when
 * its walk reaches it.
 */
export function _$componentVNode(component: unknown, props?: unknown, ...args: unknown[]): VNodeChild;

// @internal The helpers what-compiler's `hydratable` output calls instead of
// cloning templates and walking them by path (render.js has the protocol).
export function _$htemplate(html: string, flag?: number): (() => Node) & { root(): Node };
export function _$claim(template: (() => Node) & { root(): Node }, flags?: number): any;
export function _$next(skip: number, flags?: number): any;
export function _$skip(count: number): void;
export function _$hole(parent: Node, value: unknown, flag: number, devName?: string): void;
export function _$exit(): void;
export function _$hcreateComponent(component: unknown, props?: unknown, ...args: unknown[]): unknown;
export function _$outside<T>(build: () => T): T;
