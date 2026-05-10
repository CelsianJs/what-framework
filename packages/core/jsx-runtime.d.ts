// What Framework - JSX Runtime Type Definitions
// Provides JSX IntrinsicElements and Element types for TypeScript JSX support.
// Used with: jsxImportSource: "what-core" or "what-framework"

import { VNode, VNodeChild, Component } from './index';

export { Fragment } from './index';

/** Automatic JSX transform entry point */
export function jsx(type: string | Component<any>, props: Record<string, any> | null, key?: string | number): VNode;
/** Automatic JSX transform entry point (static children) */
export function jsxs(type: string | Component<any>, props: Record<string, any> | null, key?: string | number): VNode;

// --- JSX Namespace ---

type Booleanish = boolean | 'true' | 'false';
type SignalOrValue<T> = T | (() => T);

export namespace JSX {
  type Element = VNode;
  type ElementClass = never;

  interface ElementChildrenAttribute {
    children: {};
  }

  interface IntrinsicAttributes {
    key?: string | number | null;
    ref?: ((el: HTMLElement) => void) | { current: HTMLElement | null };
  }

  // Event handler types
  type EventHandler<E extends Event = Event> = (event: E) => void;

  // Common HTML attributes shared by all elements
  interface HTMLAttributes<T extends EventTarget = HTMLElement> {
    // Core attributes
    id?: SignalOrValue<string>;
    class?: SignalOrValue<string>;
    className?: SignalOrValue<string>;
    style?: SignalOrValue<string | Record<string, string | number | null | undefined>>;
    title?: SignalOrValue<string>;
    tabIndex?: SignalOrValue<number>;
    role?: string;
    slot?: string;
    hidden?: SignalOrValue<boolean>;
    dir?: 'ltr' | 'rtl' | 'auto';
    lang?: string;
    translate?: 'yes' | 'no';
    draggable?: Booleanish;
    contentEditable?: Booleanish | 'inherit';
    spellcheck?: Booleanish;
    autofocus?: boolean;

    // ARIA attributes
    'aria-activedescendant'?: string;
    'aria-atomic'?: Booleanish;
    'aria-autocomplete'?: 'none' | 'inline' | 'list' | 'both';
    'aria-busy'?: Booleanish;
    'aria-checked'?: Booleanish | 'mixed';
    'aria-colcount'?: number;
    'aria-colindex'?: number;
    'aria-colspan'?: number;
    'aria-controls'?: string;
    'aria-current'?: Booleanish | 'page' | 'step' | 'location' | 'date' | 'time';
    'aria-describedby'?: string;
    'aria-details'?: string;
    'aria-disabled'?: Booleanish;
    'aria-errormessage'?: string;
    'aria-expanded'?: Booleanish;
    'aria-flowto'?: string;
    'aria-haspopup'?: Booleanish | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
    'aria-hidden'?: Booleanish;
    'aria-invalid'?: Booleanish | 'grammar' | 'spelling';
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-level'?: number;
    'aria-live'?: 'off' | 'assertive' | 'polite';
    'aria-modal'?: Booleanish;
    'aria-multiline'?: Booleanish;
    'aria-multiselectable'?: Booleanish;
    'aria-orientation'?: 'horizontal' | 'vertical';
    'aria-owns'?: string;
    'aria-placeholder'?: string;
    'aria-posinset'?: number;
    'aria-pressed'?: Booleanish | 'mixed';
    'aria-readonly'?: Booleanish;
    'aria-relevant'?: 'additions' | 'all' | 'removals' | 'text' | 'additions text';
    'aria-required'?: Booleanish;
    'aria-roledescription'?: string;
    'aria-rowcount'?: number;
    'aria-rowindex'?: number;
    'aria-rowspan'?: number;
    'aria-selected'?: Booleanish;
    'aria-setsize'?: number;
    'aria-sort'?: 'none' | 'ascending' | 'descending' | 'other';
    'aria-valuemax'?: number;
    'aria-valuemin'?: number;
    'aria-valuenow'?: number;
    'aria-valuetext'?: string;

    // Data attributes
    [key: `data-${string}`]: any;

    // Event handlers (What Framework style: lowercase)
    onclick?: EventHandler<MouseEvent>;
    ondblclick?: EventHandler<MouseEvent>;
    onmousedown?: EventHandler<MouseEvent>;
    onmouseup?: EventHandler<MouseEvent>;
    onmousemove?: EventHandler<MouseEvent>;
    onmouseenter?: EventHandler<MouseEvent>;
    onmouseleave?: EventHandler<MouseEvent>;
    onmouseover?: EventHandler<MouseEvent>;
    onmouseout?: EventHandler<MouseEvent>;
    oncontextmenu?: EventHandler<MouseEvent>;

    onkeydown?: EventHandler<KeyboardEvent>;
    onkeyup?: EventHandler<KeyboardEvent>;
    onkeypress?: EventHandler<KeyboardEvent>;

    onfocus?: EventHandler<FocusEvent>;
    onblur?: EventHandler<FocusEvent>;
    onfocusin?: EventHandler<FocusEvent>;
    onfocusout?: EventHandler<FocusEvent>;

    oninput?: EventHandler<InputEvent>;
    onchange?: EventHandler<Event>;
    onsubmit?: EventHandler<SubmitEvent>;
    onreset?: EventHandler<Event>;

    onscroll?: EventHandler<Event>;
    onwheel?: EventHandler<WheelEvent>;

    ondrag?: EventHandler<DragEvent>;
    ondragstart?: EventHandler<DragEvent>;
    ondragend?: EventHandler<DragEvent>;
    ondragenter?: EventHandler<DragEvent>;
    ondragleave?: EventHandler<DragEvent>;
    ondragover?: EventHandler<DragEvent>;
    ondrop?: EventHandler<DragEvent>;

    ontouchstart?: EventHandler<TouchEvent>;
    ontouchmove?: EventHandler<TouchEvent>;
    ontouchend?: EventHandler<TouchEvent>;
    ontouchcancel?: EventHandler<TouchEvent>;

    onpointerdown?: EventHandler<PointerEvent>;
    onpointermove?: EventHandler<PointerEvent>;
    onpointerup?: EventHandler<PointerEvent>;
    onpointercancel?: EventHandler<PointerEvent>;
    onpointerenter?: EventHandler<PointerEvent>;
    onpointerleave?: EventHandler<PointerEvent>;

    onanimationstart?: EventHandler<AnimationEvent>;
    onanimationend?: EventHandler<AnimationEvent>;
    onanimationiteration?: EventHandler<AnimationEvent>;
    ontransitionend?: EventHandler<TransitionEvent>;

    onload?: EventHandler<Event>;
    onerror?: EventHandler<Event>;

    // React-style camelCase event handlers (also supported)
    onClick?: EventHandler<MouseEvent>;
    onDblClick?: EventHandler<MouseEvent>;
    onMouseDown?: EventHandler<MouseEvent>;
    onMouseUp?: EventHandler<MouseEvent>;
    onMouseMove?: EventHandler<MouseEvent>;
    onMouseEnter?: EventHandler<MouseEvent>;
    onMouseLeave?: EventHandler<MouseEvent>;
    onKeyDown?: EventHandler<KeyboardEvent>;
    onKeyUp?: EventHandler<KeyboardEvent>;
    onFocus?: EventHandler<FocusEvent>;
    onBlur?: EventHandler<FocusEvent>;
    onInput?: EventHandler<InputEvent>;
    onChange?: EventHandler<Event>;
    onSubmit?: EventHandler<SubmitEvent>;
    onScroll?: EventHandler<Event>;

    // Ref
    ref?: ((el: T) => void) | { current: T | null };

    // What Framework internals
    dangerouslySetInnerHTML?: { __html: string };
    innerHTML?: { __html: string };

    // Children
    children?: VNodeChild;
  }

  // Specific HTML element attributes
  interface AnchorHTMLAttributes extends HTMLAttributes<HTMLAnchorElement> {
    href?: string;
    target?: '_blank' | '_self' | '_parent' | '_top' | string;
    rel?: string;
    download?: string | boolean;
    type?: string;
    hreflang?: string;
    ping?: string;
    referrerpolicy?: string;
  }

  interface ButtonHTMLAttributes extends HTMLAttributes<HTMLButtonElement> {
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    form?: string;
    formaction?: string;
    name?: string;
    value?: string | number;
  }

  interface FormHTMLAttributes extends HTMLAttributes<HTMLFormElement> {
    action?: string;
    method?: 'get' | 'post' | 'dialog';
    enctype?: string;
    target?: string;
    novalidate?: boolean;
    autocomplete?: 'on' | 'off';
    name?: string;
  }

  interface ImgHTMLAttributes extends HTMLAttributes<HTMLImageElement> {
    src?: string;
    alt?: string;
    width?: number | string;
    height?: number | string;
    loading?: 'lazy' | 'eager';
    decoding?: 'async' | 'auto' | 'sync';
    srcset?: string;
    sizes?: string;
    crossorigin?: '' | 'anonymous' | 'use-credentials';
    fetchpriority?: 'high' | 'low' | 'auto';
  }

  interface InputHTMLAttributes extends HTMLAttributes<HTMLInputElement> {
    type?: string;
    value?: SignalOrValue<string | number>;
    checked?: SignalOrValue<boolean>;
    disabled?: boolean;
    placeholder?: string;
    name?: string;
    required?: boolean;
    readonly?: boolean;
    min?: number | string;
    max?: number | string;
    step?: number | string;
    pattern?: string;
    minlength?: number;
    maxlength?: number;
    autocomplete?: string;
    autofocus?: boolean;
    form?: string;
    list?: string;
    multiple?: boolean;
    accept?: string;
    capture?: 'user' | 'environment';
    size?: number;
  }

  interface LabelHTMLAttributes extends HTMLAttributes<HTMLLabelElement> {
    for?: string;
    htmlFor?: string;
    form?: string;
  }

  interface SelectHTMLAttributes extends HTMLAttributes<HTMLSelectElement> {
    value?: SignalOrValue<string | number>;
    disabled?: boolean;
    name?: string;
    required?: boolean;
    multiple?: boolean;
    size?: number;
    form?: string;
    autocomplete?: string;
  }

  interface TextareaHTMLAttributes extends HTMLAttributes<HTMLTextAreaElement> {
    value?: SignalOrValue<string>;
    disabled?: boolean;
    placeholder?: string;
    name?: string;
    required?: boolean;
    readonly?: boolean;
    rows?: number;
    cols?: number;
    minlength?: number;
    maxlength?: number;
    autocomplete?: string;
    form?: string;
    wrap?: 'hard' | 'soft' | 'off';
  }

  interface OptionHTMLAttributes extends HTMLAttributes<HTMLOptionElement> {
    value?: string | number;
    disabled?: boolean;
    selected?: boolean;
    label?: string;
  }

  interface TableHTMLAttributes extends HTMLAttributes<HTMLTableElement> {
    cellpadding?: number | string;
    cellspacing?: number | string;
    summary?: string;
  }

  interface TdHTMLAttributes extends HTMLAttributes<HTMLTableCellElement> {
    colspan?: number;
    rowspan?: number;
    headers?: string;
  }

  interface ThHTMLAttributes extends HTMLAttributes<HTMLTableCellElement> {
    colspan?: number;
    rowspan?: number;
    scope?: 'col' | 'row' | 'colgroup' | 'rowgroup';
    headers?: string;
  }

  interface VideoHTMLAttributes extends HTMLAttributes<HTMLVideoElement> {
    src?: string;
    poster?: string;
    width?: number | string;
    height?: number | string;
    autoplay?: boolean;
    controls?: boolean;
    loop?: boolean;
    muted?: boolean;
    preload?: 'none' | 'metadata' | 'auto';
    playsinline?: boolean;
    crossorigin?: '' | 'anonymous' | 'use-credentials';
  }

  interface AudioHTMLAttributes extends HTMLAttributes<HTMLAudioElement> {
    src?: string;
    autoplay?: boolean;
    controls?: boolean;
    loop?: boolean;
    muted?: boolean;
    preload?: 'none' | 'metadata' | 'auto';
    crossorigin?: '' | 'anonymous' | 'use-credentials';
  }

  interface SourceHTMLAttributes extends HTMLAttributes<HTMLSourceElement> {
    src?: string;
    type?: string;
    srcset?: string;
    sizes?: string;
    media?: string;
  }

  interface CanvasHTMLAttributes extends HTMLAttributes<HTMLCanvasElement> {
    width?: number | string;
    height?: number | string;
  }

  interface IframeHTMLAttributes extends HTMLAttributes<HTMLIFrameElement> {
    src?: string;
    srcdoc?: string;
    name?: string;
    width?: number | string;
    height?: number | string;
    allow?: string;
    allowfullscreen?: boolean;
    loading?: 'lazy' | 'eager';
    sandbox?: string;
    referrerpolicy?: string;
  }

  interface MetaHTMLAttributes extends HTMLAttributes<HTMLMetaElement> {
    charset?: string;
    content?: string;
    'http-equiv'?: string;
    name?: string;
    property?: string;
  }

  interface LinkHTMLAttributes extends HTMLAttributes<HTMLLinkElement> {
    href?: string;
    rel?: string;
    type?: string;
    media?: string;
    sizes?: string;
    as?: string;
    crossorigin?: '' | 'anonymous' | 'use-credentials';
    integrity?: string;
  }

  interface ScriptHTMLAttributes extends HTMLAttributes<HTMLScriptElement> {
    src?: string;
    type?: string;
    async?: boolean;
    defer?: boolean;
    crossorigin?: '' | 'anonymous' | 'use-credentials';
    integrity?: string;
    nomodule?: boolean;
  }

  interface DialogHTMLAttributes extends HTMLAttributes<HTMLDialogElement> {
    open?: boolean;
  }

  interface DetailsHTMLAttributes extends HTMLAttributes<HTMLDetailsElement> {
    open?: boolean;
  }

  // SVG attributes
  interface SVGAttributes extends HTMLAttributes<SVGElement> {
    viewBox?: string;
    xmlns?: string;
    fill?: string;
    stroke?: string;
    'stroke-width'?: number | string;
    'stroke-linecap'?: 'butt' | 'round' | 'square';
    'stroke-linejoin'?: 'miter' | 'round' | 'bevel';
    'stroke-dasharray'?: string;
    'stroke-dashoffset'?: number | string;
    opacity?: number | string;
    transform?: string;
    d?: string;
    cx?: number | string;
    cy?: number | string;
    r?: number | string;
    rx?: number | string;
    ry?: number | string;
    x?: number | string;
    y?: number | string;
    x1?: number | string;
    y1?: number | string;
    x2?: number | string;
    y2?: number | string;
    width?: number | string;
    height?: number | string;
    points?: string;
    'clip-path'?: string;
    'clip-rule'?: 'nonzero' | 'evenodd';
    'fill-rule'?: 'nonzero' | 'evenodd';
    'fill-opacity'?: number | string;
    'stroke-opacity'?: number | string;
    'text-anchor'?: 'start' | 'middle' | 'end';
    'dominant-baseline'?: string;
    'font-size'?: number | string;
    'font-family'?: string;
    'font-weight'?: number | string;
    href?: string;
    preserveAspectRatio?: string;
    [key: string]: any;
  }

  // Intrinsic elements map
  interface IntrinsicElements {
    // Document structure
    html: HTMLAttributes<HTMLHtmlElement>;
    head: HTMLAttributes<HTMLHeadElement>;
    body: HTMLAttributes<HTMLBodyElement>;
    title: HTMLAttributes<HTMLTitleElement>;
    base: HTMLAttributes<HTMLBaseElement>;
    meta: MetaHTMLAttributes;
    link: LinkHTMLAttributes;
    style: HTMLAttributes<HTMLStyleElement> & { type?: string; media?: string };
    script: ScriptHTMLAttributes;
    noscript: HTMLAttributes;

    // Sections
    div: HTMLAttributes<HTMLDivElement>;
    span: HTMLAttributes<HTMLSpanElement>;
    section: HTMLAttributes;
    article: HTMLAttributes;
    aside: HTMLAttributes;
    header: HTMLAttributes;
    footer: HTMLAttributes;
    main: HTMLAttributes;
    nav: HTMLAttributes;
    address: HTMLAttributes;
    hgroup: HTMLAttributes;
    search: HTMLAttributes;

    // Headings
    h1: HTMLAttributes<HTMLHeadingElement>;
    h2: HTMLAttributes<HTMLHeadingElement>;
    h3: HTMLAttributes<HTMLHeadingElement>;
    h4: HTMLAttributes<HTMLHeadingElement>;
    h5: HTMLAttributes<HTMLHeadingElement>;
    h6: HTMLAttributes<HTMLHeadingElement>;

    // Text content
    p: HTMLAttributes<HTMLParagraphElement>;
    pre: HTMLAttributes<HTMLPreElement>;
    blockquote: HTMLAttributes<HTMLQuoteElement> & { cite?: string };
    hr: HTMLAttributes<HTMLHRElement>;
    br: HTMLAttributes<HTMLBRElement>;

    // Inline text
    a: AnchorHTMLAttributes;
    strong: HTMLAttributes;
    em: HTMLAttributes;
    b: HTMLAttributes;
    i: HTMLAttributes;
    u: HTMLAttributes;
    s: HTMLAttributes;
    small: HTMLAttributes;
    sub: HTMLAttributes;
    sup: HTMLAttributes;
    mark: HTMLAttributes;
    del: HTMLAttributes;
    ins: HTMLAttributes;
    code: HTMLAttributes;
    kbd: HTMLAttributes;
    var: HTMLAttributes;
    samp: HTMLAttributes;
    q: HTMLAttributes<HTMLQuoteElement> & { cite?: string };
    cite: HTMLAttributes;
    abbr: HTMLAttributes;
    time: HTMLAttributes<HTMLTimeElement> & { datetime?: string };
    dfn: HTMLAttributes;
    ruby: HTMLAttributes;
    rt: HTMLAttributes;
    rp: HTMLAttributes;
    wbr: HTMLAttributes;
    bdi: HTMLAttributes;
    bdo: HTMLAttributes & { dir?: 'ltr' | 'rtl' };

    // Lists
    ul: HTMLAttributes<HTMLUListElement>;
    ol: HTMLAttributes<HTMLOListElement> & { start?: number; reversed?: boolean; type?: '1' | 'a' | 'A' | 'i' | 'I' };
    li: HTMLAttributes<HTMLLIElement> & { value?: number };
    dl: HTMLAttributes<HTMLDListElement>;
    dt: HTMLAttributes;
    dd: HTMLAttributes;
    menu: HTMLAttributes<HTMLMenuElement>;

    // Tables
    table: TableHTMLAttributes;
    caption: HTMLAttributes<HTMLTableCaptionElement>;
    thead: HTMLAttributes<HTMLTableSectionElement>;
    tbody: HTMLAttributes<HTMLTableSectionElement>;
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    tr: HTMLAttributes<HTMLTableRowElement>;
    td: TdHTMLAttributes;
    th: ThHTMLAttributes;
    colgroup: HTMLAttributes<HTMLTableColElement> & { span?: number };
    col: HTMLAttributes<HTMLTableColElement> & { span?: number };

    // Forms
    form: FormHTMLAttributes;
    input: InputHTMLAttributes;
    button: ButtonHTMLAttributes;
    select: SelectHTMLAttributes;
    textarea: TextareaHTMLAttributes;
    label: LabelHTMLAttributes;
    fieldset: HTMLAttributes<HTMLFieldSetElement> & { disabled?: boolean; form?: string; name?: string };
    legend: HTMLAttributes<HTMLLegendElement>;
    option: OptionHTMLAttributes;
    optgroup: HTMLAttributes<HTMLOptGroupElement> & { disabled?: boolean; label?: string };
    datalist: HTMLAttributes<HTMLDataListElement>;
    output: HTMLAttributes<HTMLOutputElement> & { for?: string; form?: string; name?: string };
    progress: HTMLAttributes<HTMLProgressElement> & { max?: number; value?: number };
    meter: HTMLAttributes<HTMLMeterElement> & { min?: number; max?: number; low?: number; high?: number; optimum?: number; value?: number };

    // Media
    img: ImgHTMLAttributes;
    video: VideoHTMLAttributes;
    audio: AudioHTMLAttributes;
    source: SourceHTMLAttributes;
    track: HTMLAttributes<HTMLTrackElement> & { default?: boolean; kind?: string; label?: string; src?: string; srclang?: string };
    picture: HTMLAttributes;
    figure: HTMLAttributes;
    figcaption: HTMLAttributes;

    // Embedded content
    iframe: IframeHTMLAttributes;
    canvas: CanvasHTMLAttributes;
    embed: HTMLAttributes<HTMLEmbedElement> & { src?: string; type?: string; width?: number | string; height?: number | string };
    object: HTMLAttributes<HTMLObjectElement> & { data?: string; type?: string; width?: number | string; height?: number | string; name?: string; form?: string };
    param: HTMLAttributes<HTMLParamElement> & { name?: string; value?: string };

    // Interactive
    details: DetailsHTMLAttributes;
    summary: HTMLAttributes;
    dialog: DialogHTMLAttributes;

    // Template & Slots
    template: HTMLAttributes<HTMLTemplateElement>;

    // SVG elements
    svg: SVGAttributes;
    path: SVGAttributes;
    circle: SVGAttributes;
    rect: SVGAttributes;
    line: SVGAttributes;
    polyline: SVGAttributes;
    polygon: SVGAttributes;
    ellipse: SVGAttributes;
    g: SVGAttributes;
    defs: SVGAttributes;
    use: SVGAttributes;
    symbol: SVGAttributes;
    clipPath: SVGAttributes;
    mask: SVGAttributes;
    pattern: SVGAttributes;
    linearGradient: SVGAttributes;
    radialGradient: SVGAttributes;
    stop: SVGAttributes & { offset?: number | string; 'stop-color'?: string; 'stop-opacity'?: number | string };
    text: SVGAttributes;
    tspan: SVGAttributes;
    foreignObject: SVGAttributes;
    marker: SVGAttributes;
    image: SVGAttributes;
    animate: SVGAttributes;
    animateTransform: SVGAttributes;
    animateMotion: SVGAttributes;
    filter: SVGAttributes;
    feGaussianBlur: SVGAttributes;
    feOffset: SVGAttributes;
    feMerge: SVGAttributes;
    feMergeNode: SVGAttributes;
    feBlend: SVGAttributes;
    feColorMatrix: SVGAttributes;
    feComposite: SVGAttributes;
    feFlood: SVGAttributes;
  }
}
