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

import type { VNode, VNodeChild } from './index';

export { Fragment } from './index';

/** A JSX attribute value in What may be static or a reactive `() => value` thunk. */
export type Reactive<T> = T | (() => T);

export function jsx(type: any, props: any, key?: any): VNode;
export function jsxs(type: any, props: any, key?: any): VNode;

type EventHandler<E extends Event = Event> = (event: E & { currentTarget: EventTarget & Element; target: Element }) => void;

interface WhatEventHandlers {
  // What lowercases the event name, so both spellings resolve to the same DOM event.
  onClick?: EventHandler<MouseEvent>;
  onclick?: EventHandler<MouseEvent>;
  onDblClick?: EventHandler<MouseEvent>;
  ondblclick?: EventHandler<MouseEvent>;
  onMouseDown?: EventHandler<MouseEvent>;
  onmousedown?: EventHandler<MouseEvent>;
  onMouseUp?: EventHandler<MouseEvent>;
  onmouseup?: EventHandler<MouseEvent>;
  onMouseEnter?: EventHandler<MouseEvent>;
  onmouseenter?: EventHandler<MouseEvent>;
  onMouseLeave?: EventHandler<MouseEvent>;
  onmouseleave?: EventHandler<MouseEvent>;
  onMouseMove?: EventHandler<MouseEvent>;
  onmousemove?: EventHandler<MouseEvent>;
  onInput?: EventHandler<InputEvent>;
  oninput?: EventHandler<InputEvent>;
  onChange?: EventHandler<Event>;
  onchange?: EventHandler<Event>;
  onSubmit?: EventHandler<SubmitEvent>;
  onsubmit?: EventHandler<SubmitEvent>;
  onReset?: EventHandler<Event>;
  onreset?: EventHandler<Event>;
  onKeyDown?: EventHandler<KeyboardEvent>;
  onkeydown?: EventHandler<KeyboardEvent>;
  onKeyUp?: EventHandler<KeyboardEvent>;
  onkeyup?: EventHandler<KeyboardEvent>;
  onKeyPress?: EventHandler<KeyboardEvent>;
  onkeypress?: EventHandler<KeyboardEvent>;
  onFocus?: EventHandler<FocusEvent>;
  onfocus?: EventHandler<FocusEvent>;
  onBlur?: EventHandler<FocusEvent>;
  onblur?: EventHandler<FocusEvent>;
  onScroll?: EventHandler<Event>;
  onscroll?: EventHandler<Event>;
}

interface WhatHTMLAttributes extends WhatEventHandlers {
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

interface WhatInputAttributes extends WhatHTMLAttributes {
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

interface WhatAnchorAttributes extends WhatHTMLAttributes {
  href?: Reactive<string>;
  target?: Reactive<string>;
  rel?: Reactive<string>;
  download?: Reactive<string | boolean>;
}

interface WhatImgAttributes extends WhatHTMLAttributes {
  src?: Reactive<string>;
  srcset?: Reactive<string>;
  alt?: Reactive<string>;
  width?: Reactive<string | number>;
  height?: Reactive<string | number>;
  loading?: Reactive<'eager' | 'lazy'>;
  decoding?: Reactive<'async' | 'auto' | 'sync'>;
}

interface WhatButtonAttributes extends WhatHTMLAttributes {
  type?: Reactive<'button' | 'submit' | 'reset'>;
  disabled?: Reactive<boolean>;
  name?: Reactive<string>;
  value?: Reactive<string | number>;
  form?: Reactive<string>;
}

interface WhatFormAttributes extends WhatHTMLAttributes {
  action?: Reactive<string>;
  method?: Reactive<string>;
  enctype?: Reactive<string>;
  novalidate?: Reactive<boolean>;
  target?: Reactive<string>;
}

interface WhatLabelAttributes extends WhatHTMLAttributes {
  for?: Reactive<string>;
  htmlFor?: Reactive<string>;
}

interface WhatOptionAttributes extends WhatHTMLAttributes {
  value?: Reactive<string | number>;
  selected?: Reactive<boolean>;
  disabled?: Reactive<boolean>;
}

interface WhatSelectAttributes extends WhatHTMLAttributes {
  value?: Reactive<string | number>;
  name?: Reactive<string>;
  disabled?: Reactive<boolean>;
  required?: Reactive<boolean>;
  multiple?: Reactive<boolean>;
}

interface WhatTextareaAttributes extends WhatHTMLAttributes {
  value?: Reactive<string>;
  placeholder?: Reactive<string>;
  rows?: Reactive<string | number>;
  cols?: Reactive<string | number>;
  disabled?: Reactive<boolean>;
  readonly?: Reactive<boolean>;
  required?: Reactive<boolean>;
  name?: Reactive<string>;
}

interface WhatMediaAttributes extends WhatHTMLAttributes {
  src?: Reactive<string>;
  controls?: Reactive<boolean>;
  autoplay?: Reactive<boolean>;
  loop?: Reactive<boolean>;
  muted?: Reactive<boolean>;
  poster?: Reactive<string>;
  preload?: Reactive<string>;
}

// SVG (recharts and other chart libraries render through this).
interface WhatSVGAttributes extends WhatHTMLAttributes {
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
  type Element = VNode;
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: string | number;
  }

  interface IntrinsicElements {
    // Element-specific typing (autocomplete for the props that matter most).
    a: WhatAnchorAttributes;
    img: WhatImgAttributes;
    input: WhatInputAttributes;
    button: WhatButtonAttributes;
    form: WhatFormAttributes;
    label: WhatLabelAttributes;
    option: WhatOptionAttributes;
    select: WhatSelectAttributes;
    textarea: WhatTextareaAttributes;
    video: WhatMediaAttributes;
    audio: WhatMediaAttributes;
    source: WhatMediaAttributes;

    // Structural / text / sectioning elements.
    div: WhatHTMLAttributes;
    span: WhatHTMLAttributes;
    p: WhatHTMLAttributes;
    section: WhatHTMLAttributes;
    article: WhatHTMLAttributes;
    header: WhatHTMLAttributes;
    footer: WhatHTMLAttributes;
    main: WhatHTMLAttributes;
    aside: WhatHTMLAttributes;
    nav: WhatHTMLAttributes;
    h1: WhatHTMLAttributes;
    h2: WhatHTMLAttributes;
    h3: WhatHTMLAttributes;
    h4: WhatHTMLAttributes;
    h5: WhatHTMLAttributes;
    h6: WhatHTMLAttributes;
    ul: WhatHTMLAttributes;
    ol: WhatHTMLAttributes;
    li: WhatHTMLAttributes;
    dl: WhatHTMLAttributes;
    dt: WhatHTMLAttributes;
    dd: WhatHTMLAttributes;
    table: WhatHTMLAttributes;
    thead: WhatHTMLAttributes;
    tbody: WhatHTMLAttributes;
    tfoot: WhatHTMLAttributes;
    tr: WhatHTMLAttributes;
    th: WhatHTMLAttributes;
    td: WhatHTMLAttributes;
    caption: WhatHTMLAttributes;
    colgroup: WhatHTMLAttributes;
    col: WhatHTMLAttributes;
    fieldset: WhatHTMLAttributes;
    legend: WhatHTMLAttributes;
    strong: WhatHTMLAttributes;
    em: WhatHTMLAttributes;
    b: WhatHTMLAttributes;
    i: WhatHTMLAttributes;
    u: WhatHTMLAttributes;
    small: WhatHTMLAttributes;
    mark: WhatHTMLAttributes;
    code: WhatHTMLAttributes;
    pre: WhatHTMLAttributes;
    kbd: WhatHTMLAttributes;
    blockquote: WhatHTMLAttributes;
    hr: WhatHTMLAttributes;
    br: WhatHTMLAttributes;
    figure: WhatHTMLAttributes;
    figcaption: WhatHTMLAttributes;
    details: WhatHTMLAttributes;
    summary: WhatHTMLAttributes;
    dialog: WhatHTMLAttributes;
    picture: WhatHTMLAttributes;
    iframe: WhatHTMLAttributes;
    canvas: WhatHTMLAttributes;
    template: WhatHTMLAttributes;
    slot: WhatHTMLAttributes;
    time: WhatHTMLAttributes;
    progress: WhatHTMLAttributes;
    meter: WhatHTMLAttributes;
    output: WhatHTMLAttributes;
    datalist: WhatHTMLAttributes;
    optgroup: WhatHTMLAttributes;

    // SVG.
    svg: WhatSVGAttributes;
    g: WhatSVGAttributes;
    path: WhatSVGAttributes;
    circle: WhatSVGAttributes;
    ellipse: WhatSVGAttributes;
    rect: WhatSVGAttributes;
    line: WhatSVGAttributes;
    polyline: WhatSVGAttributes;
    polygon: WhatSVGAttributes;
    text: WhatSVGAttributes;
    tspan: WhatSVGAttributes;
    defs: WhatSVGAttributes;
    linearGradient: WhatSVGAttributes;
    radialGradient: WhatSVGAttributes;
    stop: WhatSVGAttributes;
    clipPath: WhatSVGAttributes;
    use: WhatSVGAttributes;

    // Custom elements / web components remain valid.
    [tagName: string]: WhatHTMLAttributes;
  }
}
