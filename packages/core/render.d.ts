export { effect, untrack } from './index.js';
import type { VNodeChild, Signal, Component, VNode } from './index.js';

// Fine-grained rendering primitives: the runtime compiled JSX calls, for code
// written without JSX.
export function template(html: string): () => Element;
export function insert(parent: Node, child: any, marker?: Node | null): any;
/**
 * @internal insert() for a function written in the hole itself: the reactive
 * region insert() would hand it to. Emitted by the compiler.
 */
export function _$reactive(parent: Node, child: () => any, marker?: Node | null, devName?: string): void;
/** `source` is an accessor, or an array for a list that never changes. */
export function mapArray<T>(
  source: (() => readonly T[] | null | undefined) | readonly T[],
  mapFn: (item: T | Signal<T>, index: number, raw: T) => Node,
  /**
   * `raw`: the row gets the item itself. `follow`: the row gets the item's cell
   * (what-compiler's `.map()` lowering). `loc`: the list's source location,
   * named by the duplicate-key diagnostic. `slot`: the number what-compiler
   * gives a list it lowers, the same as the server's, for the place of its
   * keyed rows. `key` is handed the item and its index (a key of both is the
   * row's item and position).
   */
  options?: { key?: (item: T, index: number) => string | number; raw?: boolean; follow?: boolean; loc?: string; slot?: number },
): (parent: Node, marker?: Node | null) => Node;
export function spread(el: Element, props: Record<string, any>): void;
export function setProp(el: Element, key: string, value: any): void;
/** @internal spread() as compiled output calls it: a select or an option it is given has its code installed by its module (`_$selects`). */
export function _$spread(el: Element, props: Record<string, any>): void;
/** @internal setProp() as compiled output calls it (see `_$spread`). */
export function _$setProp(el: Element, key: string, value: any): void;
/** @internal setValue() as compiled output calls it (see `_$spread`). */
export function _$setValue(el: Element, value: any, bound?: 1): void;
/** @internal Compiler output, once at module scope in a module whose JSX writes a prop of a <select> or an <option>: installs the code that keeps their selection. */
export function _$selects(): void;
/**
 * One listener per event type on `root` (the document by default; a shadow root
 * or an element delegates for its own subtree) runs the `$$event` handlers on
 * the event's path.
 */
export function delegateEvents(eventNames: string[], root?: Document | ShadowRoot | Element): void;
/**
 * Add a DOM listener, removed when the current owner (the component, list row
 * or root being built) is disposed; returns the function that removes it
 * sooner. In components, write onClick={...} in JSX.
 */
export function on(el: Element, event: string, handler: (e: Event) => void, options?: boolean | AddEventListenerOptions): () => void;
/** @internal Compiler output: marks the element's delegated `$$event` handlers as the current owner's. */
export function _$own(el: Element): void;
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
// attribute names. Function values are treated as reactive
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
export function setValue(el: Element, value: any, bound?: 1): void;
export function setChecked(el: Element, value: any, bound?: 1): void;

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
  options: { key: (item: T, index: number) => unknown; raw?: boolean; follow?: boolean; loc?: string; slot?: number },
): (parent: Node, marker?: Node | null) => Comment;

// Equality-gated eager memo (the reactive memo, NOT the component-HOC `memo`
// exported from the package index). Emitted by the compiler for branch
// memoization of conditional JSX.
export function _$memo<T>(fn: () => T): (() => T) & { peek(): T };
// The lazy memo (a computed): the condition of a branch that may never be
// reached, evaluated on its first read. Emitted for inner arms of ternary
// chains, <Show> fallbacks and ternaries handed to a component as JSX.
export function _$lazyMemo<T>(fn: () => T): () => T;

export interface IslandProps {
  component: Component<any>;
  mode: 'load' | 'idle' | 'visible' | 'interaction' | 'media' | 'action' | 'static';
  mediaQuery?: string;
  name?: string;
  [key: string]: any;
}

/**
 * What `<Counter client:idle />` compiles to: an island that hydrates itself
 * when its trigger fires (`mode`). The public island component, which
 * hydrates through the island registry, is what-framework/server's Island.
 */
export function _$Island(props: IslandProps): VNode;

// --- Hydration ---
// hydrate() adopts server-rendered DOM instead of recreating it: the tree's
// components run once, and what they render claims the nodes the server wrote
// (h() vnodes, and compiled JSX built with what-compiler's `hydratable`
// option). Returns the unmount function, as mount() does; hydrating or
// mounting into the same container disposes the root it held.
export interface HydrationMismatch {
  /** tag, text, missing, extra-nodes, marker, key, shadow-root (an element hosting a shadow root the client would not make), prebuilt (JSX built before the walk reached its place took the server's nodes' place), or not-hydratable (DOM built before hydrate() could claim the server's, reported once) */
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
 * @internal `_$createComponent` for a module whose every component is a plain
 * function (never a class component, never a tag held in a binding): it does
 * not look for either.
 */
export function _$createLazyFn(component: unknown, props?: unknown, ...args: unknown[]): unknown;

/**
 * @internal `_$createComponent` for a module whose JSX hands no component
 * children and no JSX in a prop: the compiler imports it under that name, so
 * an app of such modules does not carry the lazy props.
 */
export function _$createLeaf(component: unknown, props?: unknown, ...args: unknown[]): unknown;

/**
 * @internal `_$createLeaf` for a module whose every component is a plain
 * function (never a class component, never a tag held in a binding): it does
 * not look for either.
 */
export function _$createFn(component: unknown, props?: unknown, ...args: unknown[]): unknown;

/**
 * @internal The unbuilt sibling of `_$createComponent`, emitted for the JSX
 * passed directly to `hydrate()` in a hydratable build: hydrate() runs it when
 * its walk reaches it.
 */
export function _$componentVNode(component: unknown, props?: unknown, ...args: unknown[]): VNodeChild;

// @internal The helpers what-compiler's `hydratable` output calls instead of
// cloning templates and walking them by path (render.js has the protocol).
/** @internal Compiler output: a keyed row's text that reads a plain field of its item, written by the row's item cell. */
export function _$field(parent: Node, cell: unknown, value: unknown, marker: Node | null | undefined, read: (item: any) => unknown): void;
/** @internal `_$field` for hydratable output (`flag` as `_$hole`'s). */
export function _$hfield(parent: Node, cell: unknown, value: unknown, flag: number, read: (item: any) => unknown): void;
/** @internal Compiler output: a child that is an expression with no call in it, read once before the runtime decides whether an effect is needed. */
export function _$plain(parent: Node, read: () => unknown, marker?: Node | null, devName?: string): void;
/** @internal `_$plain` for hydratable output (`flag` as `_$hole`'s). */
export function _$hplain(parent: Node, read: () => unknown, flag: number, devName?: string): void;
/** @internal Compiler output: `el`, a form field whose props a spread sets; a field a `value` or `checked` among them binds to state shows it again after each of its events. */
export function _$controlled<T extends Element>(el: T): T;
/** @internal Compiler output, as the value of an option of a keyed list whose rows can hold a plain child that is a field of the row: installs the code that binds one. Returns true. */
export function _$rowFields(): true;
export function _$htemplate(html: string, flag?: number): (() => Node) & { root(): Node };
export function _$claim(template: (() => Node) & { root(): Node }, flags?: number): any;
export function _$next(skip: number, flags?: number): any;
/** @internal _$next for a form control: what the user changed in it before hydration stays. */
export function _$control(skip: number, flags?: number): any;
/** @internal _$claim for a template whose root is a form control. */
export function _$claimControl(tmpl: any, flags?: number): any;
export function _$skip(count: number): void;
export function _$hole(parent: Node, value: unknown, flag: number, devName?: string): void;
export function _$exit(): void;
export function _$hcreateComponent(component: unknown, props?: unknown, ...args: unknown[]): unknown;
/** @internal `_$hcreateComponent` for a module whose every component is a plain function (`_$createLazyFn`). */
export function _$hcreateFn(component: unknown, props?: unknown, ...args: unknown[]): unknown;
export function _$outside<T>(build: () => T): T;
/** @internal A hydratable array whose members claim the server's nodes in document order as `build` creates them. `nested` 1: it follows another array's markers; 2: a component's children, with markers of their own only where their placement has them (`_$place`). */
export function _$members<T>(build: () => T, nested?: number): T;
/** @internal A `_$members` member that is not an element or a component, adopted where it stands while hydrating. */
export function _$member<T>(value: T, index: number): T;
/** @internal Compiled JSX: `props` carrying `slots`, the factories of the props its JSX passed as JSX or forwarded, which the component reads as lazy getters. */
export function _$slots<P extends object>(props: P, slots: Record<string, () => unknown>): P;
/** @internal Compiled JSX's spread props, merged in order into one props object with no prototype; getters of props objects What built stay getters (live props). */
export function _$merge(...sources: unknown[]): Record<string, unknown>;
/** @internal Compiled JSX's rest element of destructured props: `props` without `keys`, getters kept. */
export function _$omit(props: unknown, keys: readonly string[]): Record<string, unknown>;
/** @internal Compiled JSX: a component call placed in SVG (`ns` 1), MathML (2) or HTML inside one of them (0), so a tag held in a binding below it that SVG and HTML both name is created in that namespace. */
export function _$inNs<T>(ns: 0 | 1 | 2, build: () => T): T;
/** @internal A compiled read of `props[key]` where its value is placed: a lazy prop is built there. `inPlace` 1: where the server writes it with no markers of its own (an element's hole, a fragment's or an array's members). */
export function _$place(props: object, key: string, inPlace?: 1): unknown;
/** @internal The onHydrationError hook of the hydrate() walking now, or null (what-react's islands report to it after the walk). */
export function _hydrationErrorHook(): ((info: object) => void) | null;
/** @internal A hydration walk of the server's nodes between `open` and `close` (exclusive): what `fn` builds claims them (what-react: a native component inside a React island). */
export function _hydrateRange<T>(open: Comment, close: Comment, fn: () => T, onError?: ((info: object) => void) | null): T;
