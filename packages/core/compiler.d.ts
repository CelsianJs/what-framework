import type { Component, VNodeChild } from './index';

/** @internal Compiler target for component instantiation. */
export function _$createComponent(
  Component: Component<any>,
  props: Record<string, any>,
  children?: VNodeChild[],
): any;

/** @internal Compiler target for pre-parsed HTML templates. */
export function _$template(html: string): () => Element;

/** @internal Legacy compiler template alias. */
export function _template(html: string): () => Element;

/** @internal Compiler template helper. Prefer JSX in application code. */
export function template(html: string): () => Element;
export function insert(parent: Node, child: any, marker?: Node | null): any;
export function mapArray<T>(
  source: () => T[],
  mapFn: (item: T | ((next?: T) => T), index: number) => Node,
  options?: { key?: (item: T) => string | number; raw?: boolean },
): (parent: Node, marker?: Node | null) => Node;
export function spread(el: Element, props: Record<string, any>): void;
export function setProp(el: Element, key: string, value: any): void;
export function delegateEvents(eventNames: string[]): void;
export function on(el: Element, event: string, handler: (e: Event) => void): () => void;
export function classList(el: Element, classes: Record<string, boolean | (() => boolean)>): void;
export function effect(fn: () => void | (() => void)): () => void;
export function untrack<T>(fn: () => T): T;
