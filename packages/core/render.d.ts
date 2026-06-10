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
} from './index';

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
