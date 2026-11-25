// What Framework — JSX runtime type definitions.
//
// Enables type-checked JSX authoring with:
//   "jsx": "react-jsx", "jsxImportSource": "what-framework"  (or "what-core")
//
// What is DOM-native and lenient at runtime: attributes pass through as-is,
// both `class`/`className` and camelCase/lowercase event handlers are accepted
// (events are bound via `key.slice(2).toLowerCase()`), and any attribute value
// may be reactive — a plain value OR a `() => value` thunk. These types mirror
// that behavior: common attributes are explicitly typed for autocomplete and
// documentation, while an index signature keeps arbitrary/custom attributes and
// web-component tags valid (never false-flagging code the runtime accepts).

import type { VNode, VNodeChild } from './index.js';

export { Fragment } from './index.js';

/** Static or reactive attribute value; nullish values remove the attribute. */
export type Reactive<T> = T | null | undefined | (() => T | null | undefined);

export function jsx(type: any, props: any, key?: any): VNode;
export function jsxs(type: any, props: any, key?: any): VNode;

/**
 * A handler of DOM event `E` on an element of type `T`. `currentTarget` is the
 * element the handler is on (an `<input>`'s handler reads
 * `e.currentTarget.value` with no cast), as React types it; `target` is
 * whatever element the event started at, which may be a descendant. Declared
 * as a method so a handler for a narrower element still fits a wider one (a
 * custom element's attributes, the index signature below).
 */
type EventHandler<E extends Event = Event, T extends EventTarget = Element> = {
  bivarianceHack(event: E & { currentTarget: EventTarget & T; target: Element }): void;
}['bivarianceHack'];

interface WhatEventHandlers<T extends EventTarget = Element> {
  // What lowercases the event name, so both spellings resolve to the same DOM event.
  onClick?: EventHandler<MouseEvent, T>;
  onclick?: EventHandler<MouseEvent, T>;
  onDblClick?: EventHandler<MouseEvent, T>;
  ondblclick?: EventHandler<MouseEvent, T>;
  onMouseDown?: EventHandler<MouseEvent, T>;
  onmousedown?: EventHandler<MouseEvent, T>;
  onMouseUp?: EventHandler<MouseEvent, T>;
  onmouseup?: EventHandler<MouseEvent, T>;
  onMouseEnter?: EventHandler<MouseEvent, T>;
  onmouseenter?: EventHandler<MouseEvent, T>;
  onMouseLeave?: EventHandler<MouseEvent, T>;
  onmouseleave?: EventHandler<MouseEvent, T>;
  onMouseMove?: EventHandler<MouseEvent, T>;
  onmousemove?: EventHandler<MouseEvent, T>;
  onInput?: EventHandler<InputEvent, T>;
  oninput?: EventHandler<InputEvent, T>;
  onChange?: EventHandler<Event, T>;
  onchange?: EventHandler<Event, T>;
  onSubmit?: EventHandler<SubmitEvent, T>;
  onsubmit?: EventHandler<SubmitEvent, T>;
  onReset?: EventHandler<Event, T>;
  onreset?: EventHandler<Event, T>;
  onKeyDown?: EventHandler<KeyboardEvent, T>;
  onkeydown?: EventHandler<KeyboardEvent, T>;
  onKeyUp?: EventHandler<KeyboardEvent, T>;
  onkeyup?: EventHandler<KeyboardEvent, T>;
  onKeyPress?: EventHandler<KeyboardEvent, T>;
  onkeypress?: EventHandler<KeyboardEvent, T>;
  onFocus?: EventHandler<FocusEvent, T>;
  onfocus?: EventHandler<FocusEvent, T>;
  onBlur?: EventHandler<FocusEvent, T>;
  onblur?: EventHandler<FocusEvent, T>;
  onScroll?: EventHandler<Event, T>;
  onscroll?: EventHandler<Event, T>;
}

interface WhatHTMLAttributes<T extends EventTarget = Element> extends WhatEventHandlers<T> {
  children?: VNodeChild;
  /** Component-list reconciliation key. */
  key?: string | number;
  ref?: ((el: any) => void) | { current: any };

  class?: Reactive<string>;
  className?: Reactive<string>;
  id?: Reactive<string>;
  style?: Reactive<string | Record<string, string | number>>;
  title?: Reactive<string>;
  role?: Reactive<string>;
  slot?: Reactive<string>;
  lang?: Reactive<string>;
  dir?: Reactive<string>;
  hidden?: Reactive<boolean>;
  draggable?: Reactive<boolean>;
  contentEditable?: Reactive<boolean | string>;
  tabindex?: Reactive<number | string>;
  tabIndex?: Reactive<number | string>;

  // Common data-/aria- attributes remain typed; arbitrary ones fall through below.
  [dataAttr: `data-${string}`]: any;
  [ariaAttr: `aria-${string}`]: any;
  /** What passes unknown attributes straight to the DOM; keep them valid. */
  [attr: string]: any;
}

interface WhatInputAttributes extends WhatHTMLAttributes<HTMLInputElement> {
  type?: Reactive<string>;
  value?: Reactive<string | number>;
  checked?: Reactive<boolean>;
  placeholder?: Reactive<string>;
  disabled?: Reactive<boolean>;
  readonly?: Reactive<boolean>;
  readOnly?: Reactive<boolean>;
  required?: Reactive<boolean>;
  name?: Reactive<string>;
  min?: Reactive<string | number>;
  max?: Reactive<string | number>;
  step?: Reactive<string | number>;
  pattern?: Reactive<string>;
  autocomplete?: Reactive<string>;
  autofocus?: Reactive<boolean>;
}

interface WhatAnchorAttributes extends WhatHTMLAttributes<HTMLAnchorElement> {
  href?: Reactive<string>;
  target?: Reactive<string>;
  rel?: Reactive<string>;
  download?: Reactive<string | boolean>;
}

interface WhatImgAttributes extends WhatHTMLAttributes<HTMLImageElement> {
  src?: Reactive<string>;
  srcset?: Reactive<string>;
  alt?: Reactive<string>;
  width?: Reactive<string | number>;
  height?: Reactive<string | number>;
  loading?: Reactive<'eager' | 'lazy'>;
  decoding?: Reactive<'async' | 'auto' | 'sync'>;
}

interface WhatButtonAttributes extends WhatHTMLAttributes<HTMLButtonElement> {
  type?: Reactive<'button' | 'submit' | 'reset'>;
  disabled?: Reactive<boolean>;
  name?: Reactive<string>;
  value?: Reactive<string | number>;
  form?: Reactive<string>;
}

interface WhatFormAttributes extends WhatHTMLAttributes<HTMLFormElement> {
  action?: Reactive<string>;
  method?: Reactive<string>;
  enctype?: Reactive<string>;
  novalidate?: Reactive<boolean>;
  target?: Reactive<string>;
}

interface WhatLabelAttributes extends WhatHTMLAttributes<HTMLLabelElement> {
  for?: Reactive<string>;
  htmlFor?: Reactive<string>;
}

interface WhatOptionAttributes extends WhatHTMLAttributes<HTMLOptionElement> {
  value?: Reactive<string | number>;
  selected?: Reactive<boolean>;
  disabled?: Reactive<boolean>;
}

interface WhatSelectAttributes extends WhatHTMLAttributes<HTMLSelectElement> {
  value?: Reactive<string | number>;
  name?: Reactive<string>;
  disabled?: Reactive<boolean>;
  required?: Reactive<boolean>;
  multiple?: Reactive<boolean>;
}

interface WhatTextareaAttributes extends WhatHTMLAttributes<HTMLTextAreaElement> {
  value?: Reactive<string>;
  placeholder?: Reactive<string>;
  rows?: Reactive<string | number>;
  cols?: Reactive<string | number>;
  disabled?: Reactive<boolean>;
  readonly?: Reactive<boolean>;
  required?: Reactive<boolean>;
  name?: Reactive<string>;
}

interface WhatMediaAttributes<T extends HTMLElement = HTMLMediaElement> extends WhatHTMLAttributes<T> {
  src?: Reactive<string>;
  controls?: Reactive<boolean>;
  autoplay?: Reactive<boolean>;
  loop?: Reactive<boolean>;
  muted?: Reactive<boolean>;
  poster?: Reactive<string>;
  preload?: Reactive<string>;
}

// SVG (recharts and other chart libraries render through this).
interface WhatSVGAttributes<T extends SVGElement = SVGElement> extends WhatHTMLAttributes<T> {
  width?: Reactive<string | number>;
  height?: Reactive<string | number>;
  viewBox?: Reactive<string>;
  fill?: Reactive<string>;
  stroke?: Reactive<string>;
  x?: Reactive<string | number>;
  y?: Reactive<string | number>;
  cx?: Reactive<string | number>;
  cy?: Reactive<string | number>;
  r?: Reactive<string | number>;
  d?: Reactive<string>;
  points?: Reactive<string>;
  transform?: Reactive<string>;
}

export namespace JSX {
  /**
   * Empty in a native app. An app that mixes native and React files
   * (what-react's MIXED.md) references `what-react/mixed`, which adds React's
   * element shape here: JSX inside a React component's tag is a React
   * element, and fits a React component's `children: ReactNode`.
   */
  interface ForeignElement {}
  /** Empty in a native app. `what-react/mixed` adds React components (functions returning ReactNode, forwardRef and memo objects, classes). */
  interface ForeignComponents {}
  type Element = VNode & ForeignElement;
  // TS 5.1+ checks component returns separately from the JSX expression type.
  // `never` accepts each component's own props without erasing JSX prop checks.
  type ElementType = string | ((props: never) => VNodeChild) | ForeignComponents[keyof ForeignComponents];
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    /** A row's key; <For key={(item) => item.id}> takes the function that gives it. */
    key?: string | number | ((item: never) => unknown);
  }

  interface IntrinsicElements {
    // Element-specific typing (autocomplete for the props that matter most).
    // Each element's event handlers see it as `e.currentTarget`.
    a: WhatAnchorAttributes;
    img: WhatImgAttributes;
    input: WhatInputAttributes;
    button: WhatButtonAttributes;
    form: WhatFormAttributes;
    label: WhatLabelAttributes;
    option: WhatOptionAttributes;
    select: WhatSelectAttributes;
    textarea: WhatTextareaAttributes;
    video: WhatMediaAttributes<HTMLVideoElement>;
    audio: WhatMediaAttributes<HTMLAudioElement>;
    source: WhatMediaAttributes<HTMLSourceElement>;

    // Structural / text / sectioning elements.
    div: WhatHTMLAttributes<HTMLElementTagNameMap['div']>;
    span: WhatHTMLAttributes<HTMLElementTagNameMap['span']>;
    p: WhatHTMLAttributes<HTMLElementTagNameMap['p']>;
    section: WhatHTMLAttributes<HTMLElementTagNameMap['section']>;
    article: WhatHTMLAttributes<HTMLElementTagNameMap['article']>;
    header: WhatHTMLAttributes<HTMLElementTagNameMap['header']>;
    footer: WhatHTMLAttributes<HTMLElementTagNameMap['footer']>;
    main: WhatHTMLAttributes<HTMLElementTagNameMap['main']>;
    aside: WhatHTMLAttributes<HTMLElementTagNameMap['aside']>;
    nav: WhatHTMLAttributes<HTMLElementTagNameMap['nav']>;
    h1: WhatHTMLAttributes<HTMLElementTagNameMap['h1']>;
    h2: WhatHTMLAttributes<HTMLElementTagNameMap['h2']>;
    h3: WhatHTMLAttributes<HTMLElementTagNameMap['h3']>;
    h4: WhatHTMLAttributes<HTMLElementTagNameMap['h4']>;
    h5: WhatHTMLAttributes<HTMLElementTagNameMap['h5']>;
    h6: WhatHTMLAttributes<HTMLElementTagNameMap['h6']>;
    ul: WhatHTMLAttributes<HTMLElementTagNameMap['ul']>;
    ol: WhatHTMLAttributes<HTMLElementTagNameMap['ol']>;
    li: WhatHTMLAttributes<HTMLElementTagNameMap['li']>;
    dl: WhatHTMLAttributes<HTMLElementTagNameMap['dl']>;
    dt: WhatHTMLAttributes<HTMLElementTagNameMap['dt']>;
    dd: WhatHTMLAttributes<HTMLElementTagNameMap['dd']>;
    table: WhatHTMLAttributes<HTMLElementTagNameMap['table']>;
    thead: WhatHTMLAttributes<HTMLElementTagNameMap['thead']>;
    tbody: WhatHTMLAttributes<HTMLElementTagNameMap['tbody']>;
    tfoot: WhatHTMLAttributes<HTMLElementTagNameMap['tfoot']>;
    tr: WhatHTMLAttributes<HTMLElementTagNameMap['tr']>;
    th: WhatHTMLAttributes<HTMLElementTagNameMap['th']>;
    td: WhatHTMLAttributes<HTMLElementTagNameMap['td']>;
    caption: WhatHTMLAttributes<HTMLElementTagNameMap['caption']>;
    colgroup: WhatHTMLAttributes<HTMLElementTagNameMap['colgroup']>;
    col: WhatHTMLAttributes<HTMLElementTagNameMap['col']>;
    fieldset: WhatHTMLAttributes<HTMLElementTagNameMap['fieldset']>;
    legend: WhatHTMLAttributes<HTMLElementTagNameMap['legend']>;
    strong: WhatHTMLAttributes<HTMLElementTagNameMap['strong']>;
    em: WhatHTMLAttributes<HTMLElementTagNameMap['em']>;
    b: WhatHTMLAttributes<HTMLElementTagNameMap['b']>;
    i: WhatHTMLAttributes<HTMLElementTagNameMap['i']>;
    u: WhatHTMLAttributes<HTMLElementTagNameMap['u']>;
    small: WhatHTMLAttributes<HTMLElementTagNameMap['small']>;
    mark: WhatHTMLAttributes<HTMLElementTagNameMap['mark']>;
    code: WhatHTMLAttributes<HTMLElementTagNameMap['code']>;
    pre: WhatHTMLAttributes<HTMLElementTagNameMap['pre']>;
    kbd: WhatHTMLAttributes<HTMLElementTagNameMap['kbd']>;
    blockquote: WhatHTMLAttributes<HTMLElementTagNameMap['blockquote']>;
    hr: WhatHTMLAttributes<HTMLElementTagNameMap['hr']>;
    br: WhatHTMLAttributes<HTMLElementTagNameMap['br']>;
    figure: WhatHTMLAttributes<HTMLElementTagNameMap['figure']>;
    figcaption: WhatHTMLAttributes<HTMLElementTagNameMap['figcaption']>;
    details: WhatHTMLAttributes<HTMLElementTagNameMap['details']>;
    summary: WhatHTMLAttributes<HTMLElementTagNameMap['summary']>;
    dialog: WhatHTMLAttributes<HTMLElementTagNameMap['dialog']>;
    picture: WhatHTMLAttributes<HTMLElementTagNameMap['picture']>;
    iframe: WhatHTMLAttributes<HTMLElementTagNameMap['iframe']>;
    canvas: WhatHTMLAttributes<HTMLElementTagNameMap['canvas']>;
    template: WhatHTMLAttributes<HTMLElementTagNameMap['template']>;
    slot: WhatHTMLAttributes<HTMLElementTagNameMap['slot']>;
    time: WhatHTMLAttributes<HTMLElementTagNameMap['time']>;
    progress: WhatHTMLAttributes<HTMLElementTagNameMap['progress']>;
    meter: WhatHTMLAttributes<HTMLElementTagNameMap['meter']>;
    output: WhatHTMLAttributes<HTMLElementTagNameMap['output']>;
    datalist: WhatHTMLAttributes<HTMLElementTagNameMap['datalist']>;
    optgroup: WhatHTMLAttributes<HTMLElementTagNameMap['optgroup']>;

    // SVG.
    svg: WhatSVGAttributes<SVGElementTagNameMap['svg']>;
    g: WhatSVGAttributes<SVGElementTagNameMap['g']>;
    path: WhatSVGAttributes<SVGElementTagNameMap['path']>;
    circle: WhatSVGAttributes<SVGElementTagNameMap['circle']>;
    ellipse: WhatSVGAttributes<SVGElementTagNameMap['ellipse']>;
    rect: WhatSVGAttributes<SVGElementTagNameMap['rect']>;
    line: WhatSVGAttributes<SVGElementTagNameMap['line']>;
    polyline: WhatSVGAttributes<SVGElementTagNameMap['polyline']>;
    polygon: WhatSVGAttributes<SVGElementTagNameMap['polygon']>;
    text: WhatSVGAttributes<SVGElementTagNameMap['text']>;
    tspan: WhatSVGAttributes<SVGElementTagNameMap['tspan']>;
    defs: WhatSVGAttributes<SVGElementTagNameMap['defs']>;
    linearGradient: WhatSVGAttributes<SVGElementTagNameMap['linearGradient']>;
    radialGradient: WhatSVGAttributes<SVGElementTagNameMap['radialGradient']>;
    stop: WhatSVGAttributes<SVGElementTagNameMap['stop']>;
    clipPath: WhatSVGAttributes<SVGElementTagNameMap['clipPath']>;
    use: WhatSVGAttributes<SVGElementTagNameMap['use']>;

    // Custom elements / web components remain valid; their handlers see an Element.
    [tagName: string]: WhatHTMLAttributes;
  }
}
