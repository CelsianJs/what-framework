// what-core/internal/markup-rules: the markup rules every renderer applies
// (src/markup-rules.js). what-server applies them to every value it renders,
// what-compiler to static markup when a module is compiled, and the client to
// every attribute it sets. Import-free. Not for applications, and not covered
// by semver.

/** A namespace: null for HTML, or SVG / MathML content ('foreign' when it is not known which). */
export type MarkupNamespace = 'svg' | 'math' | 'foreign' | null;

/** Attribute names that can be emitted verbatim. */
export const SAFE_ATTR_NAME: RegExp;
/** Tag names that can be emitted verbatim. */
export const SAFE_TAG_NAME: RegExp;
/** Attributes whose value is a URL, in lower case (the SVG animation values among them). */
export const URL_ATTRS: ReadonlySet<string>;
/** Whether `name`, in any case, holds a URL. */
export function isUrlAttr(name: string): boolean;
/** Whether a URL value (or an item of a `;`-separated list of them) uses a javascript:, vbscript: or data: scheme. */
export function isUnsafeUrl(value: unknown): boolean;
/** Props never applied, in lower case: srcdoc, outerhtml. */
export const REFUSED_ATTRS: ReadonlySet<string>;
/** Whether `name`, in any case, is never applied. */
export function isRefusedAttr(name: string): boolean;
/** innerHTML and dangerouslySetInnerHTML, which take { __html } only. */
export const INNER_HTML_PROPS: ReadonlySet<string>;
/** Prop names whose attribute is spelled differently (className -> class). */
export const ATTRIBUTE_ALIASES: ReadonlyMap<string, string>;
/** The attribute a prop name writes. */
export function attributeName(prop: string): string;
/** The attribute `prop` is written as in markup: a field default (`defaultValue`, `defaultChecked`, `defaultSelected`) is its content attribute. */
export function markupName(prop: string): string;
/** value, defaultValue, checked, defaultChecked: the props that hold a form field's state. */
export const FIELD_PROPS: ReadonlySet<string>;
/** input, textarea, select: the elements whose state those props hold. */
export const FIELD_TAGS: ReadonlySet<string>;
/** The <input> types whose `value` is an attribute (checkbox, radio, hidden and the buttons). */
export const ATTRIBUTE_VALUE_TYPES: ReadonlySet<string>;
/** `text` with ASCII whitespace stripped from both ends and collapsed: an <option>'s value from its text. */
export function stripAndCollapse(text: string): string;
/** One boolean per option value: whether the <select> value `value` selects that option. */
export function selectedOptions(values: readonly string[], value: unknown): boolean[];
/** role and aria-*. */
export function isAriaAttr(name: string): boolean;
/** aria-*, role and data-*: true and false are written out. */
export function isEnumeratedAttr(name: string): boolean;
/** HTML void elements. */
export const VOID_ELEMENTS: ReadonlySet<string>;
/** SVG elements whose children are parsed as HTML. */
export const SVG_HTML_INTEGRATION_POINTS: ReadonlySet<string>;
/** MathML token elements whose children are parsed as HTML. */
export const MATHML_TEXT_INTEGRATION_POINTS: ReadonlySet<string>;
/** MathML elements that stay MathML inside a token element. */
export const MATHML_IN_TEXT_POINTS: ReadonlySet<string>;
/** The annotation-xml encodings whose children are parsed as HTML. */
export const HTML_ENCODINGS: ReadonlySet<string>;
/** The namespace the children of `tag` are parsed in, given the namespace `tag` is in. */
export function childNamespace(ns: MarkupNamespace, tag: string, encoding?: unknown): MarkupNamespace;
/** Elements whose content the HTML parser reads as raw text: script, style. */
export const RAW_TEXT_ELEMENTS: ReadonlySet<string>;
/** <textarea> and <title>: text the parser decodes, with no markup (a comment there is text). */
export const TEXT_ONLY_ELEMENTS: ReadonlySet<string>;
/** <pre>, <textarea> and <listing>: the parser drops a newline right after their start tag. */
export const LEADING_NEWLINE_ELEMENTS: ReadonlySet<string>;
/** Whether raw text holds a sequence that could end its element. */
export function rawTextHazard(tag: string, text: string): boolean;
/** Raw text, encoded so it cannot end its element. */
export function encodeRawText(tag: string, text: string): string;
/** The content of a script or style holding `text`, written in namespace `ns`. */
export function rawTextContent(tag: string, text: string, ns: MarkupNamespace): string;
/** Text without `&` or `<`: the same in a raw-text element in every namespace. */
export function isNamespaceNeutralText(text: string): boolean;
/** Escapes `& < > " '` for HTML text and attribute values. */
export function escapeHtml(str: string): string;
/** A style object as CSS text: what-server's style attribute and what-framework/dom's style(). A declaration the client's CSSOM would refuse, and a null, undefined, boolean or empty value, is left out. */
export function styleText(style: Record<string, unknown>): string;
/** Whether `text` is one declaration's value in a conservative CSS grammar. */
export function oneDeclaration(text: string): boolean;
/** Values that are one declaration's value by their characters alone. */
export const PLAIN_CSS_VALUE: RegExp;
/** How many property names styleText remembers. */
export const CSS_NAME_CACHE_SIZE: number;
/** The property names styleText has written, by the name a style object gave. */
export const _cssNames: Map<string, string | null>;
