// The server back end (`generate: "ssr"`): JSX lowered to server markup.
//
// An element becomes a module-level array of static strings, escaped and
// validated at build time, and one `_$ssr(template, ...holes)` call made where
// the JSX expression runs, as the h() call it stands for would be:
//
//   <div class="card" id={props.id} title={t()} onClick={go}>Hello {name}!{count()}</div>
//   const _tmpl$0 = _$ssrTemplate(['<div class="card"', '', '>Hello ', '!', '</div>'],
//     [['plain', 'id'], ['plain', 'title'], null, null]);
//   _$ssr(_tmpl$0, props.id, () => t(), _$ssrText(name), () => count())
//
// Every hole is what h() would be handed in its place, in source order (an
// attribute hole's kind and name are declared once, with the template):
//   - a value written as itself (`{label}`, `{props.children}`, a literal, a
//     non-reactive expression) is read now (_$ssrText for a child);
//   - a reactive expression (`{count()}`, `title={t()}`) is the thunk h() gets
//     from the DOM back end's auto-thunk, `() => count()`, rendered where the
//     markup is placed;
//   - a component, a fragment, <Show>, <Switch> and <For> are the vnode or the
//     reactive child they are with h() and the DOM back end;
//   - `{src.map(item => <li/>)}` renders its rows into one hole (_$ssrList).
// what-server's ssr-runtime renders the result (Markup) with h()'s rules, so
// the compiled string equals the h()-rendered string byte for byte, side
// effects in the same order (lowering-parity-fuzz.test.js). Event handlers,
// refs and keys are dropped.
//
// Compile-time checks (common.js applies the same static rules for the DOM
// back end; the run-time half is in ssr-runtime.js): tag and attribute names
// must be safe to emit verbatim, a static URL attribute must not use a
// javascript:/vbscript:/data: scheme, a static srcdoc or outerHTML is refused,
// innerHTML / dangerouslySetInnerHTML take { __html } values, never a string,
// static <script>/<style> text cannot end its element, and JSX is not an
// island prop.

import {
  RAW_TEXT_ELEMENTS, TEXT_ONLY_ELEMENTS, LEADING_NEWLINE_ELEMENTS, SAFE_ATTR_NAME, SAFE_TAG_NAME, VOID_ELEMENTS, escapeHtml,
  attributeName, isEnumeratedAttr, isNamespaceNeutralText, isRefusedAttr, isUrlAttr,
} from 'what-core/internal/markup-rules';
import { t } from './types.js';
import {
  addImports, checkElementName, checkStaticAttribute, checkStaticRawText, compileError,
  componentCallee, createEventHandler, getAttrName, getAttributeValue, getBindingProperty, hasEventModifiers,
  hasLiteralMatchArms, helper, helperLocals, isBindingAttribute, isComponentElement, isEventAttrName,
  isForeignTag, normalizeJsxText, parseEventModifiers, propKey, readSwitch, uniqueName, unsafeMarkup,
  checkIslandProp, directiveValue, renderFunctionChild,
} from './common.js';
import { buildWhenCondition, isPotentiallyReactive } from './reactivity.js';
import { findMappedJsx, isKeyedRow, markRowItemReads, rowField } from './lists.js';
import { enterJsxRoot } from './jsx-root.js';
import { componentMetadata } from './dev-metadata.js';

const RUNTIME_ATTRS = new Set(['classList', 'innerHTML', 'dangerouslySetInnerHTML']);

export function initSsrState(state) {
  state.ssrTemplates = [];
  state.ssrTemplateMap = new Map();
}

function call(state, name, args) {
  return t.callExpression(helper(state, name), args);
}

function thunk(expr) {
  return t.arrowFunctionExpression([], expr);
}

// A plain reference (`label`, `props.children`, `a.b.c`): h() is handed the
// value itself, whatever it holds.
function isReference(expr) {
  let node = expr;
  while (t.isMemberExpression(node) && !node.computed) node = node.object;
  return t.isIdentifier(node) || t.isThisExpression(node);
}

// What h() gets from the DOM back end's auto-thunk: a reactive expression
// that is not a plain reference, or one that reads a keyed row's item, which
// the DOM back end binds (lists.js markRowItemReads).
function isReactive(expr, state) {
  return readsRowItem(expr) || (!isReference(expr) && isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers));
}

function readsRowItem(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(readsRowItem);
  if (node._whatRowItem === true) return true;
  if (t.isFunction(node)) return false;
  for (const field of t.VISITOR_KEYS[node.type] || []) {
    if (readsRowItem(node[field])) return true;
  }
  return false;
}

// The value h() would be handed: the expression, or its thunk when reactive.
function asH(expr, state) {
  return isReactive(expr, state) ? thunk(expr) : expr;
}

// --- Markup builder ----------------------------------------------------------

// Static strings and the holes between them; strings.length === holes.length + 1.
// `foreign` records an SVG or MathML element, which decides how what the
// markup defers is placed (ssr-runtime's ssrForeign).
// `slots` declares each hole: null for a child, [kind, name] for an
// attribute (ssr-runtime's ssrTemplate).
/** @returns {{ strings: string[], holes: any[], slots: Array<[string, string] | null>, foreign: boolean }} */
function createMarkup(foreign = false) {
  return { strings: [''], holes: [], slots: [], foreign };
}

function addText(markup, text) {
  markup.strings[markup.strings.length - 1] += text;
}

/** @param {[string, string] | null} [slot] */
function addHole(markup, expr, slot = null) {
  markup.holes.push(expr);
  markup.slots.push(slot);
  markup.strings.push('');
}

/** @param {Array<[string, string] | null>} [slots] */
function templateId(state, strings, isStatic, slots = []) {
  const key = (isStatic ? 'static:' : '') + JSON.stringify([strings, slots]);
  let id = state.ssrTemplateMap.get(key);
  if (id === undefined) {
    id = uniqueName(state, '_tmpl$');
    state.ssrTemplateMap.set(key, id);
    state.ssrTemplates.push({ id, strings, isStatic, slots });
  }
  return id;
}

// The expression that produces the markup: a module-level Markup when it has
// no holes (it is the same every time), the hole itself when it is all there
// is and already markup (a run-time element), else a call that fills a
// hoisted template. A `.map()` row is written straight into its list
// (ssr-runtime's ssrRow).
function markupExpression(markup, state, row = false) {
  if (markup.holes.length === 0) return t.identifier(templateId(state, markup.strings, true));
  if (markup.holes.length === 1 && markup.strings[0] === '' && markup.strings[1] === '' && markup.holes[0]._whatHtml) {
    return markup.holes[0];
  }
  const fill = markup.foreign ? '_$ssrForeign' : row ? '_$ssrRow' : '_$ssr';
  const slots = markup.slots.some(Boolean) ? markup.slots : [];
  return call(state, fill, [t.identifier(templateId(state, markup.strings, false, slots)), ...markup.holes]);
}

// --- Roots -------------------------------------------------------------------

export function transformSsrRoot(path, state) {
  enterJsxRoot(path, state);
  path.replaceWith(jsxValue(path.node, path, state));
}

// Any JSX as a value: Markup for an element, a vnode for a component or a
// fragment, a reactive child for control flow.
function jsxValue(node, path, state) {
  if (t.isJSXFragment(node)) return fragmentValue(node, state);
  const tag = node.openingElement.name;
  if (t.isJSXIdentifier(tag)) {
    const name = tag.name;
    if (!isForeignTag(name, state)) {
      if (name === 'For') return forValue(node, path, state);
      if (name === 'Show') return showValue(node, path, state);
    }
    if (name === 'Switch' && (!isForeignTag(name, state) || hasLiteralMatchArms(node))) {
      const value = switchValue(node, path, state);
      if (value) return value;
    }
  }
  if (isComponentElement(node)) return componentValue(node, state);
  const markup = createMarkup();
  appendElement(node, markup, state);
  return markupExpression(markup, state, node._whatRow === true);
}

// --- Elements ----------------------------------------------------------------

function isForeignNs(node) {
  return node._whatNs === 'svg' || node._whatNs === 'math';
}

function appendElement(node, markup, state) {
  checkElementName(node, state);
  const tag = node.openingElement.name.name;
  if (!SAFE_TAG_NAME.test(tag)) {
    throw unsafeMarkup(node, state, `<${tag}> is not a tag name what-server can emit.`);
  }
  if (isForeignNs(node)) markup.foreign = true;
  const attributes = readAttributes(node, state);
  if (attributes.runtime) {
    let children = t.nullLiteral();
    if (node.children.length > 0 && !VOID_ELEMENTS.has(tag)) {
      // The element's own namespace decides where its children sit.
      const content = createMarkup(isForeignNs(node));
      appendChildren(node, content, state);
      children = markupExpression(content, state);
    }
    const element = call(state, '_$ssrElement', [t.stringLiteral(tag), attributes.props, children]);
    element._whatHtml = true;
    addHole(markup, element);
    return;
  }
  addText(markup, `<${tag}`);
  for (const attr of attributes.list) appendAttribute(attr, markup, state);
  addText(markup, '>');
  if (VOID_ELEMENTS.has(tag)) return;
  // The newline the parser drops after this start tag (markup-rules.js).
  if (!isForeignNs(node) && LEADING_NEWLINE_ELEMENTS.has(tag)) addText(markup, '\n');
  appendChildren(node, markup, state);
  addText(markup, `</${tag}>`);
}

// The value of an attribute when the source fixes it: true for a valueless
// attribute, else a string, number, boolean or null literal (or a template
// literal with no expressions). Undefined when it is only known at run time.
function staticValue(attr) {
  if (!attr.value) return true;
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  const expr = t.isJSXExpressionContainer(attr.value) ? attr.value.expression : null;
  if (t.isStringLiteral(expr) || t.isNumericLiteral(expr) || t.isBooleanLiteral(expr)) return expr.value;
  if (t.isNullLiteral(expr)) return null;
  if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) return expr.quasis[0].value.cooked;
  return undefined;
}

// The attributes in the order the h() spelling's props object holds them: a
// name written twice keeps its first position and its last value. Events,
// refs and keys are not markup. A spread, a classList or innerHTML make the
// whole element a run-time element whose props object is built exactly as
// h() would build it.
/** @returns {{ runtime: boolean, props: any, list: any[] }} */
function readAttributes(node, state) {
  const attrs = node.openingElement.attributes;
  const entries = [];
  let runtime = false;
  for (const attr of attrs) {
    if (t.isJSXSpreadAttribute(attr)) {
      runtime = true;
      entries.push({ spread: attr.argument });
      continue;
    }
    let name = getAttrName(attr);
    if (name === 'key' || name === 'ref' || name === 'children' || isEventAttrName(name)) continue;
    let expr = null;
    if (isBindingAttribute(name)) {
      const prop = getBindingProperty(name);
      if (prop !== 'value' && prop !== 'checked') continue;
      name = prop;
      expr = t.callExpression(t.cloneNode(attr.value.expression), []);
    }
    if (RUNTIME_ATTRS.has(name)) runtime = true;
    const key = attributeName(name);
    if (!SAFE_ATTR_NAME.test(key)) {
      throw unsafeMarkup(attr, state, `"${key}" is not an attribute name what-server can emit.`);
    }
    const fixed = expr ? undefined : staticValue(attr);
    checkStaticAttribute(attr, key, name, fixed, state);
    entries.push({ name, key, attr, fixed, expr: expr || (fixed === undefined ? getAttributeValue(attr.value) : null) });
  }

  if (runtime) {
    const properties = entries.map(e => (e.spread
      ? t.spreadElement(e.spread)
      : t.objectProperty(propKey(e.name), e.fixed !== undefined ? literal(e.fixed) : asH(e.expr, state))));
    return { runtime: true, props: t.objectExpression(properties), list: [] };
  }

  const byName = new Map();
  for (const entry of entries) {
    const first = byName.get(entry.name);
    if (first) Object.assign(first, { fixed: entry.fixed, expr: entry.expr, attr: entry.attr });
    else byName.set(entry.name, entry);
  }
  return { runtime: false, props: null, list: [...byName.values()] };
}

function literal(value) {
  if (value === true || value === false) return t.booleanLiteral(value);
  if (value === null) return t.nullLiteral();
  if (typeof value === 'number') return t.numericLiteral(value);
  return t.stringLiteral(value);
}

function kindOf(key) {
  if (isRefusedAttr(key)) return 'refused';
  if (key === 'class') return 'class';
  if (key === 'style') return 'style';
  if (isEnumeratedAttr(key)) return 'enum';
  if (isUrlAttr(key)) return 'url';
  return 'plain';
}

// One attribute, as what-server's renderAttrs writes it.
function appendAttribute({ key, fixed, expr }, markup, state) {
  const kind = kindOf(key);
  if (fixed === undefined) {
    addHole(markup, asH(expr, state), [kind, key]);
    return;
  }
  if (fixed === null || kind === 'refused') return;
  if (fixed === false) {
    if (kind === 'enum') addText(markup, ` ${key}="false"`);
    return;
  }
  if (fixed === true && kind !== 'class' && kind !== 'enum') {
    addText(markup, ` ${key}`);
    return;
  }
  addText(markup, ` ${key}="${escapeHtml(String(fixed))}"`);
}

// --- Children ------------------------------------------------------------------

function appendChildren(node, markup, state) {
  const tag = node.openingElement.name.name;
  if (RAW_TEXT_ELEMENTS.has(tag) || (TEXT_ONLY_ELEMENTS.has(tag) && !isForeignNs(node))) {
    appendRawText(node, tag, markup, state);
    return;
  }
  for (const child of node.children) {
    if (t.isJSXText(child)) {
      const text = normalizeJsxText(child.value);
      if (text) addText(markup, escapeHtml(text));
    } else if (t.isJSXExpressionContainer(child)) {
      const expr = child.expression;
      if (t.isJSXEmptyExpression(expr)) continue;
      if (t.isStringLiteral(expr) || t.isNumericLiteral(expr)) {
        addText(markup, escapeHtml(String(expr.value)));
        continue;
      }
      addHole(markup, childHole(expr, state));
    } else if (t.isJSXElement(child) && !isComponentElement(child)) {
      appendElement(child, markup, state);
    } else if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      addHole(markup, jsxValue(child, { node: child }, state));
    }
  }
}

// The children of a <script> or <style>: text written as it is. Static text
// that reads the same in every namespace goes into the template; anything else
// (an expression, text holding `&` or `<`) makes one hole for all of them,
// because the encoding that keeps the element from ending applies to the text
// as a whole, and whether the element holds raw text at all depends on the
// namespace it is placed in (ssr-runtime's ssrRawText). The children of a
// <textarea> or <title> in HTML are text too: escaped, and with no hydration
// markers, which the parser would read as text.
function appendRawText(node, tag, markup, state) {
  const textOnly = !RAW_TEXT_ELEMENTS.has(tag);
  const pieces = [];
  let fixed = true;
  for (const child of node.children) {
    /** @type {string | null | undefined} */
    let text;
    if (t.isJSXText(child)) text = normalizeJsxText(child.value);
    else if (t.isJSXExpressionContainer(child)) {
      const expr = child.expression;
      if (t.isJSXEmptyExpression(expr)) continue;
      if (t.isStringLiteral(expr) || t.isNumericLiteral(expr)) text = String(expr.value);
      else if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) text = expr.quasis[0].value.cooked;
      else {
        fixed = false;
        pieces.push(asH(expr, state));
        continue;
      }
    } else {
      fixed = false;
      pieces.push(jsxValue(child, { node: child }, state));
      continue;
    }
    if (!text) continue;
    if (!textOnly) {
      checkStaticRawText(child, tag, text, state);
      if (!isNamespaceNeutralText(text)) fixed = false;
    }
    pieces.push(t.stringLiteral(text));
  }
  if (pieces.length === 0) return;
  if (fixed) {
    for (const piece of pieces) addText(markup, textOnly ? escapeHtml(piece.value) : piece.value);
    return;
  }
  addHole(markup, call(state, '_$ssrRawText', [t.stringLiteral(tag), t.arrayExpression(pieces)]));
}

function childHole(expr, state) {
  const list = listHole(expr, state);
  if (list) return list;
  // A plain field of a keyed row's item is a text binding on the client
  // (lists.js rowField): written as text, with no markers.
  if (rowField(expr) !== null) return call(state, '_$ssrText', [expr]);
  return isReactive(expr, state) ? thunk(expr) : call(state, '_$ssrText', [expr]);
}

// `{src.map(item => <li/>)}`: the rows rendered into one hole. A plain call
// is read now and its rows flattened into the parent, as h() flattens an
// array child; written as a reactive child (`{src().map(...)}`,
// `{() => src.map(...)}`, or a list of a keyed row's item, `{row.children.map(...)}`,
// which the DOM target reads through the row's item cell) it is the thunk,
// and its rows are a list, as they are inside the content a control-flow arm
// returns (`inArray`). The call may stand where the DOM target finds it
// (dom.js tryLowerMapToMapArray): in either arm of a ternary, or on the right
// of `&&` or `||`.
function listHole(expr, state, inArray = false) {
  let body = expr;
  let reactive;
  if (t.isArrowFunctionExpression(expr) && expr.params.length === 0 && t.isExpression(expr.body)) {
    body = expr.body;
    reactive = true;
  } else {
    reactive = isReactive(expr, state);
  }
  const asArray = reactive || inArray;
  let list;
  if (t.isConditionalExpression(body)) {
    const consequent = ssrListOf(body.consequent, state, asArray);
    const alternate = ssrListOf(body.alternate, state, asArray);
    list = consequent || alternate ? t.conditionalExpression(body.test, consequent || body.consequent, alternate || body.alternate) : null;
  } else if (t.isLogicalExpression(body) && (body.operator === '&&' || body.operator === '||')) {
    const right = ssrListOf(body.right, state, asArray);
    list = right && t.logicalExpression(body.operator, body.left, right);
  } else {
    list = ssrListOf(body, state, asArray);
  }
  if (!list) return null;
  return reactive ? thunk(list) : list;
}

// `src.map(fn)` (or `src?.map(fn)`) as the _$ssrList that renders its rows,
// or null for anything else.
function ssrListOf(mapCall, state, asArray) {
  const found = findMappedJsx(mapCall, state, false);
  if (!found) return null;
  const keyed = isKeyedRow(found);
  if (keyed) markRowItemReads(found.mapFn, found.keyValue);
  // A row that is the callback's whole result goes straight into the list.
  if (found.mapFn.body === found.returnExpr && !isComponentElement(found.returnExpr)) found.returnExpr._whatRow = true;
  const args = [mapCall.callee.object, found.mapFn, t.booleanLiteral(asArray)];
  // The key function the DOM target's list keys its rows with (dom.js
  // tryLowerMapCall), for the keys the hydratable markup carries.
  if (keyed) {
    const item = found.mapFn.params[0] ? t.cloneNode(found.mapFn.params[0], true) : t.identifier('_item');
    args.push(t.arrowFunctionExpression([item], t.cloneNode(found.keyValue, true)));
  }
  return call(state, '_$ssrList', args);
}

// The children of a component, a fragment or a control-flow arm, as the
// values h() would be handed: text, the expression (or its thunk when it is
// reactive), Markup per element, a vnode per component. A component's and a
// fragment's children are h()'s arguments, which it flattens; an arm's are
// the content its thunk returns (`inArray`), which it does not.
function childValues(children, state, inArray = false) {
  const values = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = normalizeJsxText(child.value);
      if (text) values.push(t.stringLiteral(text));
    } else if (t.isJSXExpressionContainer(child)) {
      const expr = child.expression;
      if (t.isJSXEmptyExpression(expr)) continue;
      values.push(listHole(expr, state, inArray) || asH(expr, state));
    } else if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      values.push(jsxValue(child, { node: child }, state));
    }
  }
  return values;
}

function fragmentValue(node, state) {
  return call(state, '_$ssrFragment', [t.arrayExpression(childValues(node.children, state))]);
}

// --- Components ------------------------------------------------------------------

function componentValue(node, state) {
  const opening = node.openingElement;
  /** @type {{ mode: string, mediaQuery: any } | null} */
  let directive = null;
  for (const attr of opening.attributes) {
    if (t.isJSXAttribute(attr) && getAttrName(attr).startsWith('client:')) {
      directive = { mode: getAttrName(attr).slice(7), mediaQuery: directiveValue(attr) };
    }
  }
  const properties = [];
  for (const attr of opening.attributes) {
    if (t.isJSXSpreadAttribute(attr)) {
      if (directive && t.isObjectExpression(attr.argument)) {
        for (const prop of attr.argument.properties) {
          if (t.isObjectProperty(prop)) checkIslandProp(t.isIdentifier(prop.key) ? prop.key.name : String(prop.key.value), prop.value, node, state);
        }
      }
      properties.push(t.spreadElement(attr.argument));
      continue;
    }
    const name = getAttrName(attr);
    if (name.startsWith('client:') || name === 'key') continue;
    if (isBindingAttribute(name)) {
      properties.push(...bindingProps(getBindingProperty(name), attr.value.expression));
      continue;
    }
    if (name.startsWith('on') && (name.includes('|') || hasEventModifiers(name, state))) {
      const { eventName, modifiers } = parseEventModifiers(name);
      properties.push(t.objectProperty(t.identifier(eventName), createEventHandler(getAttributeValue(attr.value), modifiers)));
      continue;
    }
    if (directive) checkIslandProp(name, attr.value, node, state);
    properties.push(t.objectProperty(propKey(name), getAttributeValue(attr.value)));
  }
  const children = t.arrayExpression(childValues(node.children, state));
  const meta = componentMetadata(node, state);

  if (directive) {
    // The directive's keys come last, so nothing a caller spreads in can
    // replace the component or the mode (the DOM back end's rule).
    properties.push(t.objectProperty(t.identifier('component'), componentCallee(opening.name)));
    properties.push(t.objectProperty(t.identifier('mode'), t.stringLiteral(directive.mode)));
    if (directive.mediaQuery) properties.push(t.objectProperty(t.identifier('mediaQuery'), directive.mediaQuery));
    const args = [t.objectExpression(properties), children];
    if (meta) args.push(meta);
    return call(state, '_$ssrIsland', args);
  }

  const args = [componentCallee(opening.name), properties.length ? t.objectExpression(properties) : t.nullLiteral(), children];
  if (meta) args.push(meta);
  return call(state, '_$ssrComponent', args);
}

// bind:value / bind:checked on a component: the value and its change handler,
// as the DOM back end passes them.
function bindingProps(prop, signalExpr) {
  const target = (field) => t.memberExpression(t.memberExpression(t.identifier('e'), t.identifier('target')), t.identifier(field));
  const setter = (field) => t.arrowFunctionExpression([t.identifier('e')],
    t.callExpression(t.memberExpression(t.cloneNode(signalExpr), t.identifier('set')), [target(field)]));
  if (prop === 'value') {
    return [
      t.objectProperty(t.identifier('value'), t.callExpression(t.cloneNode(signalExpr), [])),
      t.objectProperty(t.identifier('onInput'), setter('value')),
    ];
  }
  if (prop === 'checked') {
    return [
      t.objectProperty(t.identifier('checked'), t.callExpression(t.cloneNode(signalExpr), [])),
      t.objectProperty(t.identifier('onChange'), setter('checked')),
    ];
  }
  return [];
}

// --- Control flow ----------------------------------------------------------------
//
// The same reactive children the DOM back end lowers <Show>, <Switch> and
// <For> to, minus the memos: a server render evaluates each one once.

function attributeOf(node, name) {
  for (const attr of node.openingElement.attributes) {
    if (t.isJSXAttribute(attr) && getAttrName(attr) === name) return getAttributeValue(attr.value);
  }
  return null;
}

function contentOf(values) {
  return values.length === 0 ? t.nullLiteral() : values.length === 1 ? values[0] : t.arrayExpression(values);
}

function showValue(node, path, state) {
  const when = attributeOf(node, 'when');
  if (!when) {
    throw compileError(path, state, '<Show> requires a "when" prop. Example: <Show when={isOpen} fallback={null}>...</Show>');
  }
  const fallback = attributeOf(node, 'fallback') || t.nullLiteral();
  const renderFn = renderFunctionChild(node.children);
  const v = t.identifier(uniqueName(state, '_v$'));
  const content = renderFn
    ? t.callExpression(renderFn, [t.cloneNode(v)])
    : contentOf(childValues(node.children, state, true));
  return thunk(t.blockStatement([
    t.variableDeclaration('const', [t.variableDeclarator(v, buildWhenCondition(when, state))]),
    t.returnStatement(t.conditionalExpression(t.cloneNode(v), content, fallback)),
  ]));
}

function switchValue(node, path, state) {
  const read = readSwitch(path, state);
  if (read === null) return null;
  let expr = read.fallback || t.nullLiteral();
  for (let i = read.arms.length - 1; i >= 0; i--) {
    expr = t.conditionalExpression(buildWhenCondition(read.arms[i].when, state), contentOf(childValues(read.arms[i].children, state, true)), expr);
  }
  return thunk(expr);
}

function forValue(node, path, state) {
  const each = attributeOf(node, 'each');
  const key = attributeOf(node, 'key');
  const fallback = attributeOf(node, 'fallback');
  const renderFn = node.children.find(c => t.isJSXExpressionContainer(c) && !t.isJSXEmptyExpression(c.expression));
  if (!each || !renderFn) {
    throw compileError(path, state, '<For> needs an "each" prop and a render function child: <For each={items}>{(item) => <li>{item}</li>}</For>');
  }
  return call(state, '_$ssrFor', [each, renderFn.expression, key || t.booleanLiteral(false), fallback || t.nullLiteral()]);
}

// --- Program teardown ------------------------------------------------------------

// The runtime helpers compiled server output imports, in specifier order.
const SSR_IMPORTS = [
  ['_$ssr', 'ssr'],
  ['_$ssrForeign', 'ssrForeign'],
  ['_$ssrRow', 'ssrRow'],
  ['_$ssrText', 'ssrText'],
  ['_$ssrList', 'ssrList'],
  ['_$ssrFor', 'ssrFor'],
  ['_$ssrTemplate', 'ssrTemplate'],
  ['_$ssrElement', 'ssrElement'],
  ['_$ssrRawText', 'ssrRawText'],
  ['_$ssrComponent', 'ssrComponent'],
  ['_$ssrFragment', 'ssrFragment'],
  ['_$ssrIsland', 'ssrIsland'],
];

export function finishSsrProgram(path, state) {
  for (const tmpl of state.ssrTemplates.reverse()) {
    const strings = t.arrayExpression(tmpl.strings.map(s => t.stringLiteral(s)));
    // A static element is one Markup for the whole module: it never changes.
    // A template with attribute holes declares their kinds and names.
    let init = strings;
    if (tmpl.isStatic) init = call(state, '_$ssr', [strings]);
    else if (tmpl.slots.length > 0) {
      init = call(state, '_$ssrTemplate', [strings, t.arrayExpression(tmpl.slots.map(slot => (slot === null
        ? t.nullLiteral()
        : t.arrayExpression([t.stringLiteral(slot[0]), t.stringLiteral(slot[1])]))))]);
    }
    if (init !== strings) t.addComment(init, 'leading', ' @__PURE__ ');
    path.unshiftContainer('body', t.variableDeclaration('const', [t.variableDeclarator(t.identifier(tmpl.id), init)]));
  }
  const used = helperLocals(state);
  const specifiers = [];
  for (const [name, exported] of SSR_IMPORTS) {
    const local = used.get(name);
    if (local !== undefined) specifiers.push(t.importSpecifier(t.identifier(local), t.identifier(exported)));
  }
  addImports(path, specifiers, ['what-framework/ssr-runtime'], 'what-framework/ssr-runtime');
}
