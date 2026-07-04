// what-react/jsx-runtime — JSX automatic-runtime type definitions.
//
// Enables type-checked JSX authoring against what-react with:
//   "jsx": "react-jsx", "jsxImportSource": "what-react"
//
// The prop model is React's (camelCase events, `className`, object `style`,
// plain — not reactive — values), matching what-react's real React semantics.
// Common attributes are typed for autocomplete; an index signature keeps
// arbitrary/custom attributes and web-component tags valid.

import type { ReactElement, ReactNode, Ref, Key } from './index';

export { Fragment } from './index';

export function jsx(type: any, props: any, key?: Key): ReactElement;
export function jsxs(type: any, props: any, key?: Key): ReactElement;

type EventHandler<E extends Event = Event> = (
  event: E & { currentTarget: EventTarget & Element; target: Element },
) => void;

interface DOMEventHandlers {
  onClick?: EventHandler<MouseEvent>;
  onDoubleClick?: EventHandler<MouseEvent>;
  onMouseDown?: EventHandler<MouseEvent>;
  onMouseUp?: EventHandler<MouseEvent>;
  onMouseEnter?: EventHandler<MouseEvent>;
  onMouseLeave?: EventHandler<MouseEvent>;
  onMouseMove?: EventHandler<MouseEvent>;
  onMouseOver?: EventHandler<MouseEvent>;
  onMouseOut?: EventHandler<MouseEvent>;
  onContextMenu?: EventHandler<MouseEvent>;
  onInput?: EventHandler<InputEvent>;
  onChange?: EventHandler<Event>;
  onSubmit?: EventHandler<SubmitEvent>;
  onReset?: EventHandler<Event>;
  onKeyDown?: EventHandler<KeyboardEvent>;
  onKeyUp?: EventHandler<KeyboardEvent>;
  onKeyPress?: EventHandler<KeyboardEvent>;
  onFocus?: EventHandler<FocusEvent>;
  onBlur?: EventHandler<FocusEvent>;
  onScroll?: EventHandler<Event>;
  onWheel?: EventHandler<WheelEvent>;
  onDragStart?: EventHandler<DragEvent>;
  onDragOver?: EventHandler<DragEvent>;
  onDrop?: EventHandler<DragEvent>;
  onTouchStart?: EventHandler<TouchEvent>;
  onTouchMove?: EventHandler<TouchEvent>;
  onTouchEnd?: EventHandler<TouchEvent>;
}

interface HTMLAttributes extends DOMEventHandlers {
  children?: ReactNode;
  key?: Key;
  ref?: Ref<any>;
  dangerouslySetInnerHTML?: { __html: string };

  className?: string;
  class?: string;
  id?: string;
  style?: string | Record<string, string | number>;
  title?: string;
  role?: string;
  slot?: string;
  lang?: string;
  dir?: string;
  hidden?: boolean;
  draggable?: boolean;
  contentEditable?: boolean | 'true' | 'false' | 'inherit';
  spellCheck?: boolean;
  tabIndex?: number;

  [dataAttr: `data-${string}`]: any;
  [ariaAttr: `aria-${string}`]: any;
  // what-react passes unknown attributes straight through — keep them valid.
  [attr: string]: any;
}

interface InputAttributes extends HTMLAttributes {
  type?: string;
  value?: string | number | ReadonlyArray<string>;
  defaultValue?: string | number | ReadonlyArray<string>;
  checked?: boolean;
  defaultChecked?: boolean;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  pattern?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  multiple?: boolean;
  accept?: string;
}

interface AnchorAttributes extends HTMLAttributes {
  href?: string;
  target?: string;
  rel?: string;
  download?: string | boolean;
}

interface ImgAttributes extends HTMLAttributes {
  src?: string;
  srcSet?: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'auto' | 'sync';
}

interface ButtonAttributes extends HTMLAttributes {
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  name?: string;
  value?: string | number;
  form?: string;
}

interface FormAttributes extends HTMLAttributes {
  action?: string;
  method?: string;
  encType?: string;
  noValidate?: boolean;
  target?: string;
}

interface LabelAttributes extends HTMLAttributes {
  htmlFor?: string;
  for?: string;
}

interface OptionAttributes extends HTMLAttributes {
  value?: string | number;
  selected?: boolean;
  disabled?: boolean;
}

interface SelectAttributes extends HTMLAttributes {
  value?: string | number | ReadonlyArray<string>;
  defaultValue?: string | number | ReadonlyArray<string>;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  multiple?: boolean;
}

interface TextareaAttributes extends HTMLAttributes {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  cols?: number;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
}

interface MediaAttributes extends HTMLAttributes {
  src?: string;
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  poster?: string;
  preload?: string;
}

interface SVGAttributes extends HTMLAttributes {
  width?: string | number;
  height?: string | number;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: string | number;
  x?: string | number;
  y?: string | number;
  cx?: string | number;
  cy?: string | number;
  r?: string | number;
  d?: string;
  points?: string;
  transform?: string;
  xmlns?: string;
}

export namespace JSX {
  type Element = ReactElement;
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: Key;
  }

  interface IntrinsicElements {
    a: AnchorAttributes;
    img: ImgAttributes;
    input: InputAttributes;
    button: ButtonAttributes;
    form: FormAttributes;
    label: LabelAttributes;
    option: OptionAttributes;
    select: SelectAttributes;
    textarea: TextareaAttributes;
    video: MediaAttributes;
    audio: MediaAttributes;
    source: MediaAttributes;

    div: HTMLAttributes;
    span: HTMLAttributes;
    p: HTMLAttributes;
    section: HTMLAttributes;
    article: HTMLAttributes;
    header: HTMLAttributes;
    footer: HTMLAttributes;
    main: HTMLAttributes;
    aside: HTMLAttributes;
    nav: HTMLAttributes;
    h1: HTMLAttributes;
    h2: HTMLAttributes;
    h3: HTMLAttributes;
    h4: HTMLAttributes;
    h5: HTMLAttributes;
    h6: HTMLAttributes;
    ul: HTMLAttributes;
    ol: HTMLAttributes;
    li: HTMLAttributes;
    dl: HTMLAttributes;
    dt: HTMLAttributes;
    dd: HTMLAttributes;
    table: HTMLAttributes;
    thead: HTMLAttributes;
    tbody: HTMLAttributes;
    tfoot: HTMLAttributes;
    tr: HTMLAttributes;
    th: HTMLAttributes;
    td: HTMLAttributes;
    caption: HTMLAttributes;
    colgroup: HTMLAttributes;
    col: HTMLAttributes;
    fieldset: HTMLAttributes;
    legend: HTMLAttributes;
    strong: HTMLAttributes;
    em: HTMLAttributes;
    b: HTMLAttributes;
    i: HTMLAttributes;
    u: HTMLAttributes;
    small: HTMLAttributes;
    mark: HTMLAttributes;
    code: HTMLAttributes;
    pre: HTMLAttributes;
    kbd: HTMLAttributes;
    blockquote: HTMLAttributes;
    hr: HTMLAttributes;
    br: HTMLAttributes;
    figure: HTMLAttributes;
    figcaption: HTMLAttributes;
    details: HTMLAttributes;
    summary: HTMLAttributes;
    dialog: HTMLAttributes;
    picture: HTMLAttributes;
    iframe: HTMLAttributes;
    canvas: HTMLAttributes;
    template: HTMLAttributes;
    time: HTMLAttributes;
    progress: HTMLAttributes;
    meter: HTMLAttributes;
    output: HTMLAttributes;
    datalist: HTMLAttributes;
    optgroup: HTMLAttributes;

    svg: SVGAttributes;
    g: SVGAttributes;
    path: SVGAttributes;
    circle: SVGAttributes;
    ellipse: SVGAttributes;
    rect: SVGAttributes;
    line: SVGAttributes;
    polyline: SVGAttributes;
    polygon: SVGAttributes;
    text: SVGAttributes;
    tspan: SVGAttributes;
    defs: SVGAttributes;
    linearGradient: SVGAttributes;
    radialGradient: SVGAttributes;
    stop: SVGAttributes;
    clipPath: SVGAttributes;
    use: SVGAttributes;

    // Custom elements / web components remain valid.
    [tagName: string]: HTMLAttributes;
  }
}
