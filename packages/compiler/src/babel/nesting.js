// Compile-time HTML nesting rules.
//
// Static markup is parsed by a real HTML parser: the DOM back end's templates
// through innerHTML, the server back end's output by the browser that receives
// it. The parser restructures some nestings instead of keeping them, so the
// tree it builds no longer matches the JSX. Compiled DOM output then walks a
// tree with different children (ERR_INVALID_HTML_NESTING at first render, in
// development only), and server markup hydrates against the wrong nodes. Every
// rule below is one the parser actually enforces; content-model rules it does
// not enforce (a <div> in a <span>, a <button> in an <a>) are not errors here.
//
// Only nesting fixed by the source is checked: elements written inside
// elements in one JSX tree, through fragments, in the HTML namespace. A
// component starts a new tree, because what it renders is not known here. So
// does JSX in an expression container for the DOM back end, which inserts it
// at run time; the server back end writes it into its parent's markup, so
// there an element written as a child expression (`{ok && <div/>}`, the rows
// of `{rows.map(r => <tr/>)}`) is checked where it stands, and so is static
// text written as one (`{"x"}`).

import { VOID_ELEMENTS } from '../tables/markup-rules.js';
import { t } from './types.js';
import { codedCompileError, isComponentElement, normalizeJsxText } from './common.js';

// Start tags that close an open <p> ("close a p element" in the HTML parser).
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre',
  'search', 'section', 'summary', 'table', 'ul', 'xmp',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Elements that end the parser's "in scope" searches.
const SCOPE_BOUNDARIES = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']);
// The "special" category, which stops the search an <li>, <dd> or <dt> start
// tag makes for an open element of its own kind (address, div and p excepted).
const SPECIAL = new Set([
  'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body', 'br',
  'button', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dir', 'dl', 'dt', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'keygen',
  'li', 'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes',
  'noscript', 'object', 'ol', 'param', 'plaintext', 'pre', 'script', 'search', 'section', 'select',
  'source', 'style', 'summary', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
  'thead', 'title', 'tr', 'track', 'ul', 'wbr', 'xmp',
]);
// Elements whose content the parser reads as text, so an element inside one
// becomes literal text.
const TEXT_ONLY = new Set(['textarea', 'title', 'style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
// Table structure: what each table element may hold, and the elements that are
// only valid inside one of those.
const TABLE_CONTENT = {
  table: new Set(['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'script', 'template', 'style']),
  thead: new Set(['tr', 'script', 'template', 'style']),
  tbody: new Set(['tr', 'script', 'template', 'style']),
  tfoot: new Set(['tr', 'script', 'template', 'style']),
  tr: new Set(['td', 'th', 'script', 'template', 'style']),
  colgroup: new Set(['col', 'template']),
};
const TABLE_PARENT = {
  caption: 'table', colgroup: 'table', thead: 'table', tbody: 'table', tfoot: 'table',
  tr: 'a table section (<tbody>, <thead> or <tfoot>)', td: '<tr>', th: '<tr>', col: '<colgroup>',
};

function fail(node, state, parent, child, why) {
  return codedCompileError(node, state, { code: 'ERR_INVALID_HTML_NESTING' },
    `<${parent}> cannot contain <${child}>: ${why} ` +
    'The browser would build a different tree than this JSX describes. ' +
    "Run what_fix({ error: 'ERR_INVALID_HTML_NESTING' }) for the worked example.");
}

// HTML start tags that end SVG or MathML content wherever they appear in it
// (outside an HTML integration point): the parser closes the foreign element
// and creates the tag as HTML beside it.
const BREAKS_FOREIGN_CONTENT = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta',
  'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table',
  'tt', 'u', 'ul', 'var',
]);
const TABLE_SECTIONS = new Set(['thead', 'tbody', 'tfoot']);

// <input type="hidden"> is the one input a table holds in place: any other is
// moved in front of the table.
function isHiddenInput(node) {
  return node.openingElement.attributes.some((attr) => t.isJSXAttribute(attr)
    && t.isJSXIdentifier(attr.name, { name: 'type' })
    && t.isStringLiteral(attr.value) && attr.value.value.toLowerCase() === 'hidden');
}

// <font> with a color, face or size attribute ends SVG or MathML content like
// the tags in BREAKS_FOREIGN_CONTENT do. Only a static attribute is certain
// to be written.
function isBreakoutFont(node) {
  return node.openingElement.attributes.some((attr) => t.isJSXAttribute(attr)
    && t.isJSXIdentifier(attr.name) && ['color', 'face', 'size'].includes(attr.name.name.toLowerCase())
    && (!attr.value || t.isStringLiteral(attr.value)));
}

function describeAllowed(set) {
  return [...set].filter(n => n !== 'script' && n !== 'template' && n !== 'style').map(n => `<${n}>`).join(', ');
}

// `stack` is the chain of open HTML elements in this tree, outermost first.
function checkElement(node, stack, state) {
  const tag = node.openingElement.name.name;
  const parent = stack.length > 0 ? stack[stack.length - 1].tag : null;

  if (parent !== null) {
    if (TEXT_ONLY.has(parent)) throw fail(node, state, parent, tag, `the parser reads the content of <${parent}> as text, so the element becomes literal characters.`);
    if (VOID_ELEMENTS.has(parent)) throw fail(node, state, parent, tag, `<${parent}> is a void element and has no content.`);
    const allowed = TABLE_CONTENT[parent];
    if (allowed && !allowed.has(tag) && !(tag === 'input' && parent !== 'colgroup' && isHiddenInput(node))) {
      const why = tag === 'tr' && parent === 'table' ? 'the parser inserts a <tbody> around the row. Write the <tbody> yourself.'
        : (tag === 'td' || tag === 'th') && TABLE_SECTIONS.has(parent) ? 'the parser inserts a <tr> around the cell. Write the <tr> yourself.'
          : `the parser moves it out of the table. <${parent}> holds only ${describeAllowed(allowed)}.`;
      throw fail(node, state, parent, tag, why);
    }
    if (TABLE_PARENT[tag] && !TABLE_CONTENT[parent] && parent !== 'template') {
      throw fail(node, state, parent, tag, `outside its table parent the parser drops the <${tag}> tag. It belongs in ${TABLE_PARENT[tag]}.`);
    }
    if (HEADINGS.has(tag) && HEADINGS.has(parent)) throw fail(node, state, parent, tag, 'a heading start tag closes the heading that is open.');
    if (tag === 'option' && parent === 'option') throw fail(node, state, parent, tag, 'an <option> start tag closes the open <option>.');
    if ((tag === 'rp' || tag === 'rt') && (parent === 'rb' || parent === 'rp' || parent === 'rt') && stack.some(open => open.tag === 'ruby')) {
      throw fail(node, state, parent, tag, `an <${tag}> start tag inside a <ruby> closes the open <${parent}>.`);
    }
    if (tag === 'optgroup' && (parent === 'option' || parent === 'optgroup')) throw fail(node, state, parent, tag, `an <optgroup> start tag closes the open <${parent}>.`);
  }

  if (CLOSES_P.has(tag)) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i].tag;
      if (open === 'p') throw fail(node, state, 'p', tag, `<p> holds only phrasing content, and a <${tag}> start tag closes it.`);
      if (open === 'button' || SCOPE_BOUNDARIES.has(open)) break;
      // Inside a <select>, an <hr> is a separator, not a paragraph break.
      if (tag === 'hr' && open === 'select') break;
    }
  }
  if (tag === 'nobr') {
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i].tag;
      if (open === 'nobr') throw fail(node, state, 'nobr', 'nobr', 'a <nobr> start tag closes the open <nobr>.');
      if (SCOPE_BOUNDARIES.has(open)) break;
    }
  }
  if (tag === 'a') {
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i].tag;
      if (open === 'a') throw fail(node, state, 'a', 'a', 'a link cannot hold another link; the parser closes the outer one.');
      if (open === 'td' || open === 'th' || open === 'caption' || open === 'object' || open === 'applet' || open === 'marquee' || open === 'template') break;
    }
  }
  if (tag === 'form') {
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i].tag;
      if (open === 'form') throw fail(node, state, 'form', 'form', 'the parser ignores a <form> start tag inside an open form.');
      if (open === 'template') break;
    }
  }
  if (tag === 'button') {
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i].tag;
      if (open === 'button') throw fail(node, state, 'button', 'button', 'a <button> start tag closes the open button.');
      if (SCOPE_BOUNDARIES.has(open)) break;
    }
  }
  if (tag === 'li' || tag === 'dd' || tag === 'dt') {
    for (let i = stack.length - 1; i >= 0; i--) {
      const open = stack[i].tag;
      if (tag === 'li' ? open === 'li' : open === 'dd' || open === 'dt') {
        throw fail(node, state, open, tag, `a <${tag}> start tag closes the open <${open}>; nest a list between them.`);
      }
      if (SPECIAL.has(open) && open !== 'address' && open !== 'div' && open !== 'p') break;
    }
  }
  if (tag === 'select' && stack.some(open => open.tag === 'select')) {
    throw fail(node, state, 'select', 'select', 'a <select> start tag inside a select closes it.');
  }
  if (tag === 'input' && stack.some(open => open.tag === 'select')) {
    throw fail(node, state, 'select', 'input', 'an <input> start tag inside a select closes it, and the input is created after it.');
  }
}

// Static text the parser would move or drop: inside a table structure element
// it is moved in front of the table, inside a void element it has nowhere to go.
function checkText(node, text, stack, state) {
  if (stack.length === 0) return;
  const parent = stack[stack.length - 1].tag;
  if (!TABLE_CONTENT[parent] && !VOID_ELEMENTS.has(parent)) return;
  if (!text) return;
  throw fail(node, state, parent, '#text', VOID_ELEMENTS.has(parent)
    ? `<${parent}> is a void element and has no content.`
    : `the parser moves text out of <${parent}> to before the table.`);
}

// Walk one JSX tree: elements written inside elements, through fragments and
// component children. JSX in an expression container or an attribute value
// is a root of its own and is checked when it is lowered.
function walk(node, stack, state, foreign) {
  if (t.isJSXText(node)) {
    checkText(node, normalizeJsxText(node.value), stack, state);
    return;
  }
  if (t.isJSXExpressionContainer(node)) {
    if (state.ssr) walkExpression(node.expression, stack, state, foreign);
    return;
  }
  if (t.isJSXFragment(node)) {
    node._whatChecked = true;
    for (const child of node.children) walk(child, stack, state, foreign);
    return;
  }
  if (!t.isJSXElement(node)) return;
  node._whatChecked = true;
  if (isComponentElement(node)) {
    for (const child of node.children) walk(child, [], state, []);
    return;
  }
  const tag = node.openingElement.name.name;
  const html = node._whatNs === 'html';
  if (html) checkElement(node, stack, state);
  else if (foreign.length > 0 && (BREAKS_FOREIGN_CONTENT.has(tag) || (tag === 'font' && isBreakoutFont(node)))) {
    throw fail(node, state, foreign[foreign.length - 1], tag,
      'an HTML element inside SVG or MathML content closes it, and the parser creates the element as HTML beside it. Wrap HTML in <foreignObject> (SVG) or <mtext> (MathML).');
  }
  const inner = html ? [...stack, { tag }] : [];
  const innerForeign = html ? [] : [...foreign, tag];
  for (const child of node.children) walk(child, inner, state, innerForeign);
}

// The server back end writes a child expression's JSX and static text into the
// parent's markup, so it is checked in the parent's place: a literal, an
// element written as the expression, either arm of a conditional, the operands
// of a logical expression, and the rows a .map() callback returns.
function walkExpression(expr, stack, state, foreign) {
  if (t.isStringLiteral(expr) || t.isNumericLiteral(expr)) {
    if (foreign.length === 0) checkText(expr, String(expr.value), stack, state);
  } else if (t.isJSXElement(expr) || t.isJSXFragment(expr)) {
    walk(expr, stack, state, foreign);
  } else if (t.isConditionalExpression(expr)) {
    walkExpression(expr.consequent, stack, state, foreign);
    walkExpression(expr.alternate, stack, state, foreign);
  } else if (t.isLogicalExpression(expr)) {
    walkExpression(expr.left, stack, state, foreign);
    walkExpression(expr.right, stack, state, foreign);
  } else if (t.isArrowFunctionExpression(expr) && expr.params.length === 0) {
    walkExpression(expr.body, stack, state, foreign);
  } else if (t.isCallExpression(expr) && t.isMemberExpression(expr.callee)
      && t.isIdentifier(expr.callee.property, { name: 'map' }) && t.isFunction(expr.arguments[0])) {
    const fn = expr.arguments[0];
    if (t.isExpression(fn.body)) walkExpression(fn.body, stack, state, foreign);
    else for (const statement of fn.body.body) if (t.isReturnStatement(statement) && statement.argument) walkExpression(statement.argument, stack, state, foreign);
  }
}

export function validateNesting(root, state) {
  if (root._whatChecked) return;
  const ns = root._whatNs;
  walk(root, [], state, ns === 'svg' || ns === 'math' ? [ns] : []);
}
