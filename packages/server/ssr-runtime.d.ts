// what-server/ssr-runtime — the helpers what-compiler's server target
// (`generate: "ssr"`) emits calls to (src/ssr-runtime.js). Compiled output
// imports them through what-framework/ssr-runtime. They are compiler
// internals: the names and shapes follow the compiler, not a public API.

import type { VNode } from 'what-core';

/**
 * Compiled markup: finished HTML, or HTML with the thunks, vnodes and reactive
 * attributes the renderer that places it renders in document order. Every
 * what-server renderer accepts it wherever it accepts a vnode. It is
 * recognised by a brand, never by its shape, and JSON leaves it out.
 */
declare const markupBrand: unique symbol;
export interface SSRMarkup {
  readonly [markupBrand]: true;
}

/** A template's static strings, with the attribute holes declared (ssrTemplate). */
export type SSRTemplate = readonly string[];

/** An attribute hole's kind: how renderAttrs writes a name of that kind. */
export type SSRAttributeKind = 'plain' | 'enum' | 'url' | 'class' | 'style' | 'refused';

/**
 * What a hole can hold: a string a helper returned, markup, a reactive thunk,
 * a vnode, or an attribute hole's value.
 */
export type SSRHole = unknown;

/**
 * Declares a template's attribute holes: null for a child, [kind, name] for an
 * attribute, and [kind, name, index] for a `.map()` row's reactive attribute,
 * whose function is its list's `index`-th (ssrList's `rowFns`) and whose hole
 * is the row's item. A template that declares one is filled with its list's
 * row functions before its holes: `ssrRow(template, rowFns, ...holes)`.
 */
export declare function ssrTemplate(
  strings: readonly string[],
  slots: ReadonlyArray<readonly [SSRAttributeKind, string] | readonly [SSRAttributeKind, string, number] | null>,
): SSRTemplate;
/** A template, filled with its holes. */
export declare function ssr(template: SSRTemplate, ...holes: SSRHole[]): SSRMarkup;
/** ssr() for a template holding SVG or MathML elements. */
export declare function ssrForeign(template: SSRTemplate, ...holes: SSRHole[]): SSRMarkup;
/** A `.map()` row written straight into the list ssrList is building; ssr() outside one. */
export declare function ssrRow(template: SSRTemplate, ...holes: SSRHole[]): unknown;

/** A child written as itself: what h() does with the same value as a child. */
export declare function ssrText(value: unknown): string | SSRMarkup | (() => unknown) | VNode<any>;
/**
 * The rows of a `.map()`, each escaped unless it is markup; `asArray` brackets
 * them as a list; `keyFn` keys its rows; `slot` is the number what-compiler
 * gave the list; `rowFns` are the reactive attributes of the row template,
 * each a function of the row's item, called where the row is placed. A list
 * given `rowFns` calls `fn` with them before the item, and the row hands them
 * to its template.
 */
export declare function ssrList<T>(
  list: readonly T[] | { map(fn: (item: T, index: number) => unknown): unknown[] },
  fn: (item: T, index: number, list: readonly T[]) => unknown,
  asArray: boolean,
  keyFn?: ((item: T, index: number) => unknown) | null,
  slot?: number,
): SSRMarkup;
export declare function ssrList<T>(
  list: readonly T[] | { map(fn: (item: T, index: number) => unknown): unknown[] },
  fn: (rowFns: ReadonlyArray<(item: T) => unknown>, item: T, index: number, list: readonly T[]) => unknown,
  asArray: boolean,
  keyFn: ((item: T, index: number) => unknown) | null,
  slot: number | undefined,
  rowFns: ReadonlyArray<(item: T) => unknown>,
): SSRMarkup;
/** `<For>`: the reactive child that renders its rows, or its fallback. */
export declare function ssrFor<T>(
  each: readonly T[] | (() => readonly T[] | null | undefined) | null | undefined,
  fn: (item: T | (() => T), index: number) => unknown,
  key: ((item: T, index: number) => unknown) | false,
  fallback: unknown,
  slot?: number,
): () => unknown;

/** `site`: where the JSX starts in its source, the number the DOM target's component call carries too (its place among the keyed rows). */
export declare function ssrComponent<P = any>(
  component: (props: P) => any,
  props: P | null,
  children: unknown[],
  site?: number,
  devLocation?: string,
): VNode<any>;
export declare function ssrFragment(children: unknown[]): VNode<any>;
export declare function ssrIsland(props: Record<string, unknown>, children: unknown[], devLocation?: string): VNode<any>;

/** An element with a spread, a classList or innerHTML: attributes rendered where it is placed. */
export declare function ssrElement(
  tag: string,
  props: Record<string, unknown>,
  children: SSRMarkup | null,
): SSRMarkup;
/** The text of a `<script>` or `<style>`: raw in HTML, escaped in SVG or MathML. */
export declare function ssrRawText(tag: 'script' | 'style', pieces: unknown[]): SSRMarkup;
