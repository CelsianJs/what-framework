// The DOM back end: JSX lowered to cloned templates, fine-grained bindings and
// keyed list inserters (what-framework/render).

import { RAW_TEXT_ELEMENTS, TEXT_ONLY_ELEMENTS, INNER_HTML_PROPS, ATTRIBUTE_ALIASES, attributeName, markupName, isEnumeratedAttr } from '../tables/markup-rules.js';
import { t } from './types.js';
import {
  EVENT_OPTION_MODIFIERS, captureEventName, compileError, componentCallee, createEventHandler, eventType,
  getAttrName, getAttributeValue, getBindingProperty, hasEventModifiers, controlFlowTag,
  isBindingAttribute, isComponentElement, isConditionallyEvaluated, isDynamicAttr,
  isEventAttrName, isFieldProp, isHydrateRootArgument, isShadowedAttr, isSlotAttribute, isStaticChild,
  isVoidHtmlElement, normalizeJsxText, parseEventModifiers, propKey,
  addImports, helper, helperLocals, readSwitch, uniqueName,
  checkElementName, checkIslandProp, checkStaticAttribute, checkStaticRawText, directiveValue,
  islandOptions, renderFunctionChild, diagnosticRecord,
} from './common.js';
import {
  buildEachValue, buildWhenCondition, isPotentiallyReactive, isSignalIdentifier, isUncertainReactive,
} from './reactivity.js';
import { enterJsxRoot } from './jsx-root.js';
import { bindingMetadata, componentMetadata } from './dev-metadata.js';
import { findMappedJsx, keyIndex, listSlot, liveKey, readItemThroughAccessor, rowField, rowItemUnread, withItem } from './lists.js';
import { hasNoSelectorPragma, lowerRowSelectors } from './auto-selector.js';


// Events that use document-level delegation for performance.
// The compiler emits `el.$$click = handler` instead of addEventListener.
// A one-time document listener walks event.target upward to find the handler.
// `$$change` is onChange, React's change event: a module that sets one
// installs it (`_$changes()`, what-core render.js), and a text field's
// `input` reaches it too.
const DELEGATED_EVENTS = new Set([
  'click', 'input', 'change', 'keydown', 'keyup', 'submit',
  'focusin', 'focusout', 'mousedown', 'mouseup',
]);

const _forInfoWarned = new Set();

// --- Child layout ---
//
// An element's child positions, with fragments flattened (a fragment renders
// no node of its own, so its children are siblings of the fragment's
// siblings) and adjacent static text merged (two strings next to each other
// in the template parse as one text node). Static text and intrinsic elements
// are written into the template. A dynamic child (an expression, a component,
// <For>/<Show>) is inserted at runtime before a marker:
//   - the next element, when one follows;
//   - the next text node, when one follows and the template has no text right
//     before this child (the two would merge into one node);
//   - otherwise a `<!>` comment placeholder written right after it;
//   - nothing (append, `null`) in the last position;
//   - no marker at all (`undefined`) when it is the element's only child,
//     which lets the runtime set text with a single textContent write.
// Each entry carries the template node index it occupies (text, element) or
// inserts before (dynamic), and a dynamic entry whether that node is the `<!>`
// written for it (`placeholder`). extractStaticHTML() builds the template from
// this layout and applyDynamicChildren() addresses nodes with it, so the two
// can never disagree.
// Rule credit: dom-expressions' marker placement (MIT, Ryan Carniato).
//
// With `withHtml`, `rawTag` names the <script> or <style> whose children these
// are, if any: its text is raw text, written as it is (checkStaticRawText).
//
// In an element whose content is text (`textOnly`: <title>, <textarea>,
// <script>, <style> in HTML) a comment is text too, so no `<!>` can stand
// there: where one would be written, the layout is made again (`textOnly`
// 2) with the children from the first dynamic one on as one dynamic child,
// an array of them, the static text as strings, and the template holds only
// the text before it.
/**
 * @param {any[]} children
 * @param {boolean} withHtml
 * @param {any} state
 * @param {string | null} [rawTag]
 * @param {boolean | 2} [textOnly]
 */
function layoutChildren(children, withHtml, state, rawTag = null, textOnly = false) {
  const slots = [];
  const flatten = (list) => {
    for (const child of list) {
      if (t.isJSXText(child)) {
        const text = normalizeJsxText(child.value);
        if (!text) continue;
        const last = slots[slots.length - 1];
        if (last && last.kind === 'text') last.text += text;
        else slots.push({ kind: 'text', text, node: child });
      } else if (t.isJSXFragment(child)) {
        flatten(child.children);
      } else if (t.isJSXExpressionContainer(child)) {
        if (!t.isJSXEmptyExpression(child.expression)) slots.push({ kind: 'dynamic', node: child });
      } else if (t.isJSXElement(child)) {
        slots.push({ kind: isComponentElement(child) ? 'dynamic' : 'element', node: child });
      }
    }
  };
  flatten(children);

  let html = '';
  let index = 0;
  let afterText = false;
  const entries = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (textOnly === 2 && slot.kind !== 'text') {
      const rest = slots.slice(i).map((r) => (r.kind === 'text' ? t.stringLiteral(r.text) : t.isJSXExpressionContainer(r.node) ? r.node.expression : r.node));
      const node = rest.length === 1 ? slot.node : t.jsxExpressionContainer(t.arrayExpression(rest));
      entries.push({ kind: 'dynamic', node, marker: i === 0 ? undefined : null, placeholder: false });
      break;
    }
    if (slot.kind === 'text') {
      if (withHtml && rawTag !== null) {
        checkStaticRawText(slot.node, rawTag, slot.text, state);
        html += slot.text;
      } else if (withHtml) {
        html += escapeHTML(slot.text);
      }
      entries.push({ kind: 'text', index });
      index++;
      afterText = true;
    } else if (slot.kind === 'element') {
      if (withHtml) html += extractStaticHTML(slot.node, state);
      entries.push({ kind: 'element', node: slot.node, index });
      index++;
      afterText = false;
    } else {
      const next = slots[i + 1];
      let marker;
      let placeholder = false;
      if (next === undefined) {
        marker = slots.length === 1 ? undefined : null;
      } else if (next.kind === 'element' || (next.kind === 'text' && !afterText)) {
        marker = index;
      } else {
        if (textOnly) return layoutChildren(children, withHtml, state, rawTag, 2);
        if (withHtml) html += '<!>';
        marker = index;
        placeholder = true;
        index++;
        afterText = false;
      }
      entries.push({ kind: 'dynamic', node: slot.node, marker, placeholder });
    }
  }
  return { html, entries };
}

// --- Auto-lower .map() to mapArray ---
// Detects: source().map((item) => <Comp key={expr} .../>)
// or wrapped in an arrow: () => source().map(...)
// Also walks into ternary (cond ? a.map(...) : fallback) and
// logical (cond && a.map(...)) expressions so React-style
// conditional list patterns get keyed reconciliation.
// Produces: _$mapArray(source, (item) => <Comp .../>, { key: item => expr })
function tryLowerMapToMapArray(expr, state) {
  state._noSelector = hasNoSelectorPragma(expr);
  // Unwrap arrow function: () => source().map(...)
  let mapCall = expr;
  let wrappedInArrow = false;
  if (t.isArrowFunctionExpression(expr) && expr.params.length === 0) {
    mapCall = expr.body;
    wrappedInArrow = true;
  }

  // Walk into ternary: cond ? arr().map(...) : fallback
  if (t.isConditionalExpression(mapCall)) {
    const loweredCon = tryLowerMapCall(mapCall.consequent, state);
    const loweredAlt = tryLowerMapCall(mapCall.alternate, state);
    if (loweredCon || loweredAlt) {
      const result = t.conditionalExpression(
        mapCall.test,
        loweredCon || mapCall.consequent,
        loweredAlt || mapCall.alternate
      );
      return wrappedInArrow ? t.arrowFunctionExpression([], result) : result;
    }
    return null;
  }

  // Walk into logical: cond && arr().map(...)
  if (t.isLogicalExpression(mapCall) && (mapCall.operator === '&&' || mapCall.operator === '||')) {
    const loweredRight = tryLowerMapCall(mapCall.right, state);
    if (loweredRight) {
      const result = t.logicalExpression(mapCall.operator, mapCall.left, loweredRight);
      return wrappedInArrow ? t.arrowFunctionExpression([], result) : result;
    }
    return null;
  }

  // Direct .map() call
  const lowered = tryLowerMapCall(mapCall, state);
  return lowered;
}

// Core .map() lowering — extracted so it can be called per-branch
function tryLowerMapCall(mapCall, state) {
  const found = findMappedJsx(mapCall, state, true);
  if (!found) return null;
  const { mapFn, returnExpr, keyAttr, keyValue } = found;
  const attrs = returnExpr.openingElement.attributes;

  // Remove the key prop from the JSX element (mapArray handles keying, not the DOM)
  returnExpr.openingElement.attributes = attrs.filter(a => a !== keyAttr);

  // `sel() === row.id` in the row's bindings → an O(1) selector lookup.
  let leftmost = mapCall;
  let optedOut = state._noSelector || state.opts?.autoSelector === false;
  while (!optedOut && leftmost) {
    optedOut = hasNoSelectorPragma(leftmost);
    leftmost = t.isCallExpression(leftmost) || t.isOptionalCallExpression(leftmost) ? leftmost.callee
      : t.isMemberExpression(leftmost) || t.isOptionalMemberExpression(leftmost) ? leftmost.object : null;
  }
  if (!optedOut) lowerRowSelectors(returnExpr, mapFn, state);

  // Build the source: the object before .map() — wrap in an arrow for reactive access
  const sourceObj = mapCall.callee.object;
  const source = t.arrowFunctionExpression([], sourceObj);

  // Build the key function: (item) => keyExpr.
  // Clone both the parameter and the key expression — the parameter is shared
  // with the user's map callback AST and keyValue may be referenced elsewhere
  // in the tree. Cloning insulates this new arrow from later mutations.
  const itemParam = mapFn.params[0] ? t.cloneNode(mapFn.params[0], true) : t.identifier('_item');
  // A key that reads the index takes it too (lists.js keyIndex; what-core
  // hands every key function the item's index).
  const index = keyIndex(found);
  const keyFn = t.arrowFunctionExpression(index === null ? [itemParam] : [itemParam, t.identifier(index)], t.cloneNode(keyValue, true));

  // Build: _$mapArray(source, mapFn, { key: keyFn, follow: true }). A row that
  // reads its item for more than its key reads it through an accessor
  // (lists.js readItemThroughAccessor) and follows an item replaced under the
  // same key (mapArray's follow mode); a row that reads only the key gets the
  // raw item (`raw: true`).
  const cellName = uniqueName(state, '_item$');
  const follow = readItemThroughAccessor(mapFn, keyValue, () => helper(state, '_$item'), cellName, uniqueName(state, '_i$'));
  // The element the row's callback returns is built with the row, in the
  // row's own scope: a field in its template is the row's (fieldCall).
  if (follow) returnExpr._whatRowCell = cellName;
  // A row whose reads of its item cannot be found (lists.js rowItemUnread) is
  // handed its item from the cell where it is built, `(cell, i) =>
  // fn(_$item(cell), i)`: a read of the whole item while the row is built,
  // so follow mode builds the row again for an item replaced under its key.
  let rowFn = mapFn;
  if (!follow && rowItemUnread(mapFn, keyValue)) {
    const index = uniqueName(state, '_i$');
    rowFn = t.arrowFunctionExpression([t.identifier(cellName), t.identifier(index)],
      t.callExpression(mapFn, [t.callExpression(helper(state, '_$item'), [t.identifier(cellName)]), t.identifier(index)]));
  }
  const options = [
    t.objectProperty(t.identifier('key'), keyFn),
    t.objectProperty(t.identifier(follow || rowFn !== mapFn ? 'follow' : 'raw'), t.booleanLiteral(true)),
  ];
  if (follow && rowHoldsPlainFields(mapFn)) options.push(rowFieldsOption(state));
  // The server's list has the same number (lists.js listSlot).
  const slot = listSlot(mapCall);
  if (slot !== null) options.push(t.objectProperty(t.identifier('slot'), slot));
  const list = t.callExpression(helper(state, '_$mapArray'), [source, rowFn, t.objectExpression(options)]);
  list._whatList = true;
  return list;
}

// Whether a row built by `fn` (a keyed list's callback, its item reads already
// lowered) can hold a plain child that is a field of the row (what-core
// render.js _$plain, _$rowFields): it renders a component, which may read the
// item it is handed in a child of its own, or it holds a child that only
// reads, reads the item, and is not one field of it (`{row.a + row.b}`; one
// field is _$field's). A row with neither reaches no such child.
function rowHoldsPlainFields(fn) {
  let found = false;
  t.traverseFast(fn, (node) => {
    if (found) return;
    if (t.isJSXElement(node) && isComponentElement(node)) found = true;
    else if (t.isJSXElement(node) || t.isJSXFragment(node)) {
      found = node.children.some((child) => t.isJSXExpressionContainer(child) && isPlainRowRead(child.expression));
    }
  });
  return found;
}

function isPlainRowRead(expr) {
  if (!isPlainRead(expr) || rowField(expr) !== null) return false;
  let reads = false;
  t.traverseFast(expr, (node) => {
    if (t.isCallExpression(node) && node.callee._whatRowItem === true) reads = true;
  });
  return reads;
}

// `fields: _$rowFields()`, in the options of a list whose rows can hold plain
// fields: the call installs the code that binds them when the list is made,
// so a program with no such list does not carry it. The runtime reads no
// option of that name.
function rowFieldsOption(state) {
  return t.objectProperty(t.identifier('fields'), t.callExpression(helper(state, '_$rowFields'), []));
}


// An attribute value written without quotes: non-empty, none of the characters
// that end or change an unquoted value, and no `&` (left to the quoted form).
const UNQUOTED_ATTR_VALUE = /^[^\s"'=<>`&]+$/;

// The names an element's attributes after the spread at `index` write, as
// the spread's third argument (render.js spread skips them): `<a {...rest}
// href="/x" />` means href "/x" whatever `rest.href` becomes, as the later
// attribute wins in React, and a live `rest.href` re-bound by the spread
// overwrote it. A name and its alias (`class`, `className`) are one.
// Nothing when no attribute follows.
function writtenAfter(attributes, index) {
  const names = new Set();
  for (let i = index + 1; i < attributes.length; i++) {
    const attr = attributes[i];
    if (t.isJSXSpreadAttribute(attr)) continue;
    const name = getAttrName(attr);
    if (name === 'key' || isDirective(name)) continue;
    // An event in lower case, the name the runtime compares (render.js spread).
    if (isEventAttrName(name)) { names.add(name.toLowerCase()); continue; }
    names.add(name);
    const alias = attributeName(name);
    if (alias !== name) names.add(alias);
    for (const [prop, attrName] of ATTRIBUTE_ALIASES) if (attrName === name) names.add(prop);
    // An XLink attribute in both spellings (`xlink:href`, `xlinkHref`).
    if (name.startsWith('xlink') && name.length > 6) {
      const local = name.slice(name[5] === ':' ? 6 : 5).toLowerCase();
      names.add('xlink:' + local).add('xlink' + local[0].toUpperCase() + local.slice(1));
    }
  }
  return names.size === 0 ? [] : [t.arrayExpression([...names].map((n) => t.stringLiteral(n)))];
}

// `bind:value`, `client:load`: compiler directives, never an element's prop.
function isDirective(name) {
  return name.startsWith('bind:') || name.startsWith('client:');
}


// A spread whose object the code may build again with other keys
// (`{...attrs()}`, `{...props.attrs}`, a keyed row's item, a literal that
// reads state, a call whose arguments do): the runtime reads its sources
// again when what they read changes (render.js _$spreads). A name is read
// once, a props object or a rest of it keeping its own getters live.
function liveSpread(arg, state) {
  if (t.isIdentifier(arg)) return false;
  const reads = (node) => isPotentiallyReactive(node, state.signalNames, state.importedIdentifiers);
  // A call handed arguments is made again where its callee or an argument
  // reads state (`{...make(state())}`, `{...pick(props.kind)}`), as React
  // calls it again in the render the state change causes; with arguments
  // that read none (`{...register('title')}`) it is made once.
  if (t.isCallExpression(arg) && arg.arguments.length > 0 && arg.callee._whatRowItem !== true) {
    return reads(arg.callee) || arg.arguments.some((a) => reads(t.isSpreadElement(a) ? a.argument : a));
  }
  return reads(arg);
}

// Whether the element's spreads are written as one merge of everything in
// source order (applyDynamicAttrs): two spreads or more, or one with an
// attribute before it that the template does not hold, so each name has one
// writer, the last (`<button {...rest} {...{ title: 'last', onClick: b }} />`,
// `<button onClick={own} {...rest} />`), as the props object React builds.
// One spread with attributes only after it skips their names instead
// (writtenAfter). An attribute that is not a plain prop (`bind:`, an event
// modifier) stays out of the merge (unmerged); a namespaced attribute
// (`xlink:href`) is one.
function mergesSpreads(attributes, tagName, state) {
  const last = attributes.findLastIndex((a) => t.isJSXSpreadAttribute(a));
  if (last === -1) return false;
  let contested = false;
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (t.isJSXSpreadAttribute(attr)) {
      if (i < last) contested = true;
      continue;
    }
    const name = getAttrName(attr);
    if (unmerged(name, state)) continue;
    // A ref is applied as it is, beside the spreads' own (`ref={input}
    // {...register('title')}` hands both the element).
    if (i < last && name !== 'key' && name !== 'ref' && (!inTemplate(attributes, i, tagName) || fallsBack(attributes, i, state)) && !isShadowedAttr(attributes, i)) contested = true;
  }
  return contested;
}

// An attribute that is not a plain prop (`bind:value`, an event with
// modifiers): it has no place in a props object, and is applied as it is
// beside the merge of the others.
function unmerged(name, state) {
  return isDirective(name) || name.includes('|') || (isEventAttrName(name) && hasEventModifiers(name, state));
}

// Whether a spread after `index` is read again (liveSpread): it may drop a
// name, and the attribute at `index` shows again (`<div title="fallback"
// {...attrs()} />`), so the attribute is one of its sources too, beside the
// template that holds it from the start (`multiple` before the options).
function fallsBack(attributes, index, state) {
  return attributes.some((a, i) => i > index && t.isJSXSpreadAttribute(a) && liveSpread(a.argument, state));
}

// Whether the template holds the attribute at `index` (extractStaticHTML).
function inTemplate(attributes, index, tagName) {
  const attr = attributes[index];
  const name = getAttrName(attr);
  return !t.isJSXExpressionContainer(attr.value) && isTemplateAttr(attributes, index, tagName) && !isShadowedAttr(attributes, index)
    && name !== 'key' && !isEventAttrName(name) && !name.startsWith('bind:') && !name.includes('|');
}

// Extract the template markup for an intrinsic JSX element. The markup is
// minified the way the HTML parser allows: simple attribute values unquoted,
// no space after a quoted value, and (in getOrCreateTemplate) no closing tags
// at the end of the template, where end-of-input closes them.
// May a static attribute be baked into the template? The template is applied
// before anything else touches the element, so an attribute whose writer is
// ordered after another runtime writer of the same thing cannot be:
//   - anything after a spread: `<div {...{id:'a'}} id="b"/>` means id="b",
//     and baking it let the spread overwrite it;
//   - class/className after a classList: `classList={{a: on()}} class="b"`
//     means class "b" (the later write replaces the toggled class, as in h()
//     and on the server), and baking it applied "b" first.
//   - a form field's value, checked and defaults (isFieldProp).
// Those are set in source order by applyDynamicAttrs instead.
function isTemplateAttr(attributes, index, tagName) {
  if (isFieldProp(tagName, attributes, index)) return false;
  for (let i = 0; i < index; i++) {
    const earlier = attributes[i];
    if (t.isJSXSpreadAttribute(earlier)) return false;
    if (getAttrName(earlier) === 'classList' && attributeName(getAttrName(attributes[index])) === 'class') return false;
  }
  return true;
}

function extractStaticHTML(node, state) {
  if (!t.isJSXElement(node) || isComponentElement(node)) return '';
  checkElementName(node, state);
  const el = node.openingElement;
  const tagName = el.name.name;
  if (buildsField(tagName, el.attributes)) state.carriesFields = true;

  let html = `<${tagName}`;
  let afterQuote = false;

  for (const [attrIndex, attr] of el.attributes.entries()) {
    if (t.isJSXSpreadAttribute(attr)) continue;
    if (!isTemplateAttr(el.attributes, attrIndex, tagName)) continue;
    if (isShadowedAttr(el.attributes, attrIndex)) continue;
    const name = getAttrName(attr);
    if (name === 'key') continue;
    // Case-insensitive: a static template is applied via innerHTML, so an
    // `ONCLICK="alert(1)"` baked into the string becomes a live handler.
    // Lowercase handlers are compiled separately; uppercase ones are dropped,
    // matching how the runtime and SSR paths treat them.
    if (isEventAttrName(name) || name.startsWith('bind:') || name.includes('|')) continue;
    if (t.isJSXExpressionContainer(attr.value)) continue; // Dynamic attr — set via effect

    const domName = markupName(name);
    checkStaticAttribute(attr, domName, name, t.isStringLiteral(attr.value) ? attr.value.value : true, state);
    const sep = afterQuote ? '' : ' ';
    if (!attr.value && isEnumeratedAttr(domName)) {
      // A valueless aria-* or data-* attribute is `true`, which those write
      // as "true" (aria-hidden="" would mean no value at all), as the server
      // target and the runtime write it.
      html += `${sep}${domName}=true`;
      afterQuote = false;
    } else if (!attr.value) {
      html += sep + domName;
      afterQuote = false;
    } else if (t.isStringLiteral(attr.value)) {
      const value = attr.value.value;
      if (UNQUOTED_ATTR_VALUE.test(value)) {
        html += `${sep}${domName}=${value}`;
        afterQuote = false;
      } else {
        html += `${sep}${domName}="${escapeAttr(value)}"`;
        afterQuote = true;
      }
    }
  }

  // An HTML void element has no closing tag and no children. A closing tag
  // would not be ignored either: `</br>` parses as a second <br>.
  if (node._whatNs !== 'svg' && node._whatNs !== 'math' && isVoidHtmlElement(tagName)) {
    return html + '>';
  }
  const rawTag = RAW_TEXT_ELEMENTS.has(tagName) && node._whatNs === 'html' ? tagName : null;
  return `${html}>${layoutChildren(node.children, true, state, rawTag, isTextOnly(node)).html}</${tagName}>`;
}

// Whether `node`'s content is text, a comment included (layoutChildren).
function isTextOnly(node) {
  const tag = node.openingElement.name.name;
  return node._whatNs === 'html' && (RAW_TEXT_ELEMENTS.has(tag) || TEXT_ONLY_ELEMENTS.has(tag));
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Analyze JSX tree and generate fine-grained output
function transformElementFineGrained(path, state) {
  const { node } = path;
  const openingElement = node.openingElement;
  const tagName = openingElement.name.name;

  // Control flow components, checked before generic isComponent since they start uppercase.
  // What's own, under the name the file imported it as (common.js
  // controlFlowTag); a tag imported from somewhere other than What is that
  // package's component, whatever it is called, so it goes to the component
  // path untouched, unless its own arms prove otherwise.
  const flow = controlFlowTag(node, state);
  if (flow === 'For') return transformForFineGrained(path, state);
  if (flow === 'Show') return transformShowFineGrained(path, state);
  if (flow === 'Switch') return transformSwitchFineGrained(path, state);

  if (isComponentElement(node)) {
    return transformComponentFineGrained(path, state);
  }

  const attributes = openingElement.attributes;
  const children = node.children;

  // Check if this entire subtree is purely static
  const allChildrenStatic = children.every(isStaticChild);
  const allAttrsStatic = attributes.every((attr, i) => !isDynamicAttr(attr) && !isFieldProp(tagName, attributes, i));
  const noEvents = attributes.every(attr => {
    if (t.isJSXSpreadAttribute(attr)) return false;
    const name = getAttrName(attr);
    return !name?.startsWith('on') && !name?.startsWith('bind:');
  });

  if (allChildrenStatic && allAttrsStatic && noEvents) {
    // Fully static element — extract to template, return clone call
    const html = extractStaticHTML(node, state);
    if (html) {
      const tmplId = getOrCreateTemplate(state, html, node._whatNs, tagName);
      return state.hydratable
        ? t.callExpression(helper(state, '_$claim'), [t.identifier(tmplId)])
        : t.callExpression(t.identifier(tmplId), []);
    }
  }

  // Mixed static/dynamic element — extract template, add effects for dynamic parts
  const html = extractStaticHTML(node, state);
  if (!html) {
    // Template extraction failed — emit a detailed compile warning and use h() as fallback
    const loc = node.loc;
    const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
    const lineInfo = loc ? `:${loc.start.line}:${loc.start.column}` : '';
    console.warn(
      `[what-compiler] Could not extract template for <${tagName}> at ${fileName}${lineInfo}. ` +
      `Falling back to h() for this element. ` +
      `This element could not be statically analyzed. Consider simplifying the JSX.`
    );
    return transformElementAsH(path, state);
  }

  const tmplId = getOrCreateTemplate(state, html, node._whatNs, tagName);

  const elId = state.nextVarId();

  // Build statements: _el$ = _tmpl$1()
  // NO IIFE wrapping — statements are inlined into the containing function.
  // A hydratable build claims the root instead (see applyDynamicChildren).
  const acquire = state.hydratable
    ? t.callExpression(helper(state, FORM_CONTROLS.has(tagName) ? '_$claimControl' : '_$claim'), [t.identifier(tmplId)])
    : t.callExpression(t.identifier(tmplId), []);
  const statements = [
    t.variableDeclaration('const', [
      t.variableDeclarator(t.identifier(elId), acquire)
    ])
  ];

  // Apply dynamic attributes and events
  applyDynamicAttrs(statements, elId, attributes, state, tagName, node._whatNs);

  // Handle dynamic children
  const rootFlags = (applyDynamicChildren(statements, elId, children, node, state, node._whatRowCell) ? 1 : 0) | (writesContent(attributes) ? 2 : 0);
  if (state.hydratable) claimArguments(acquire, rootFlags, FORM_CONTROLS.has(tagName) ? null : ownedAttrs(attributes, tagName, node._whatNs));

  // Instead of wrapping in an IIFE, store setup statements for hoisting.
  // The JSXElement visitor will insert them before the enclosing statement.
  if (!state._pendingSetup) state._pendingSetup = [];
  state._pendingSetup.push(...statements);
  return t.identifier(elId);
}

// A hydratable claim's arguments after the template or the count of static
// children it steps over: its flags (what-core render.js _$claim, _$next),
// then the attributes its bindings own (ownedAttrs), when there are any.
function claimArguments(call, flags, owned) {
  if (flags !== 0 || owned !== null) call.arguments.push(t.numericLiteral(flags));
  if (owned !== null) call.arguments.push(t.stringLiteral(owned));
}

// The attributes of a claimed element whose bindings write them in full on
// their first run, whatever the server wrote: a class (_$className,
// _$setClass), a data-* or aria-* attribute (_$setAttr), and an id or a title
// (_$setProp, through a property the attribute reflects, or the attribute).
// Hydration leaves the server's to them (what-core render.js
// keepTemplateAttrs) instead of removing it for the binding to write again.
// Their names separated by spaces, or null: none on an element with a spread
// or a classList, a custom element, a select or an option, or outside HTML
// and SVG.
function ownedAttrs(attributes, tagName, ns) {
  if ((ns !== 'html' && ns !== 'svg') || tagName.includes('-') || SELECT_TAGS.has(tagName)) return null;
  const names = [];
  for (const [index, attr] of attributes.entries()) {
    if (t.isJSXSpreadAttribute(attr)) return null;
    const name = getAttrName(attr);
    if (name === 'classList') return null;
    if (!t.isJSXExpressionContainer(attr.value) || isShadowedAttr(attributes, index) || isBindingAttribute(name)) continue;
    const written = attributeName(name);
    if ((written === 'class' || written === 'id' || written === 'title' || isEnumeratedAttr(written)) && !names.includes(written)) names.push(written);
  }
  return names.length > 0 ? names.join(' ') : null;
}

// Fallback: transform element using h() when template extraction fails
function transformElementAsH(path, state) {
  const { node } = path;
  const openingElement = node.openingElement;
  const tagName = openingElement.name.name;
  const attributes = openingElement.attributes;
  const children = node.children;

  const props = [];
  for (const attr of attributes) {
    if (t.isJSXSpreadAttribute(attr)) continue;
    const attrName = getAttrName(attr);
    const value = getAttributeValue(attr.value);
    let domAttrName = attributeName(attrName);
    props.push(
      t.objectProperty(
        /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(domAttrName)
          ? t.identifier(domAttrName)
          : t.stringLiteral(domAttrName),
        value
      )
    );
  }

  const transformedChildren = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = normalizeJsxText(child.value);
      if (text) transformedChildren.push(t.stringLiteral(text));
    } else if (t.isJSXExpressionContainer(child)) {
      if (!t.isJSXEmptyExpression(child.expression)) {
        transformedChildren.push(child.expression);
      }
    } else if (t.isJSXElement(child)) {
      transformedChildren.push(transformElementFineGrained({ node: child }, state));
    } else if (t.isJSXFragment(child)) {
      transformedChildren.push(transformFragmentFineGrained({ node: child }, state));
    }
  }

  const propsExpr = props.length > 0 ? t.objectExpression(props) : t.nullLiteral();
  return t.callExpression(helper(state, 'h'), [t.stringLiteral(tagName), propsExpr, ...transformedChildren]);
}

// ref={...}. An inline function is called with the element. Anything else
// goes through applyRef, evaluated once: a callback is called, a ref object
// gets `.current`. A `let`/`var` binding is assigned the element when it does
// not already hold a callback or a ref object (`let el; <div ref={el}>`),
// which needs the assignment written out here.
function buildRef(refExpr, elId, state) {
  if (t.isArrowFunctionExpression(refExpr) || t.isFunctionExpression(refExpr)) {
    return t.callExpression(refExpr, [t.identifier(elId)]);
  }
  const call = t.callExpression(helper(state, '_$applyRef'), [refExpr, t.identifier(elId)]);
  if (t.isIdentifier(refExpr)) {
    const binding = state._jsxScope && state._jsxScope.getBinding(refExpr.name);
    if (binding && (binding.kind === 'let' || binding.kind === 'var')) {
      // Once the variable holds the element of an earlier render (a branch
      // that re-creates it), it is an object, and applyRef would treat it as
      // a ref object and write `.current` onto the detached element. An
      // element is replaced; a callback or a ref object it still holds is
      // applied as usual.
      //   el = el != null && el.nodeType > 0 ? _el$0 : _$applyRef(el, _el$0)
      const name = refExpr.name;
      return t.assignmentExpression('=', t.identifier(name), t.conditionalExpression(
        t.logicalExpression('&&',
          t.binaryExpression('!=', t.identifier(name), t.nullLiteral()),
          t.binaryExpression('>', t.memberExpression(t.identifier(name), t.identifier('nodeType')), t.numericLiteral(0))),
        t.identifier(elId),
        call,
      ));
    }
  }
  return call;
}

// Tags where `value` / `checked` are live DOM properties the user expects a
// dynamic binding to drive (input.value, select.value, input.checked, ...).
// Other tags keep the generic setProp path (e.g. <div value={x}> sets an
// attribute, <li value={n}> hits the `key in el` property branch).
const VALUE_PROP_TAGS = new Set(['input', 'textarea', 'select', 'option']);
// The form fields a `value` or `checked` prop controls.
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);
// The elements whose props the selection code of what-core keeps in step.
const SELECT_TAGS = new Set(['select', 'option']);

function applyDynamicAttrs(statements, elId, attributes, state, tagName, ns) {
  if (ns === 'svg' && attributes.some((a) => t.isJSXSpreadAttribute(a) || (/^x(?:link|ml(?!ns))/.test(getAttrName(a)) && t.isJSXExpressionContainer(a.value)))) state.writesXlink = true;
  // Specialized monomorphic setters for statically-known attribute names.
  // The generic _$setProp re-dispatches on the key string
  // (ref/key/url/class/style/innerHTML/boolean/...) on EVERY reactive update;
  // when the compiler knows the name it emits the direct helper instead.
  // SECURITY: URL attributes (href/src/action/formaction) and innerHTML/
  // dangerouslySetInnerHTML intentionally fall through to _$setProp — URL
  // sanitization and the { __html } enforcement live there.
  // `bound`: the call is made in the effect of a binding (bindingEffect).
  function buildSetPropCall(propName, valueExpr, bound) {
    // A prop of a select or an option brings the code that keeps the
    // selection (what-core _$selects, written once at module scope).
    if (SELECT_TAGS.has(tagName)) state.makesSelects = true;
    // A value or checked a binding writes to a form field: the field shows it
    // again after each of its events when the binding read state (what-core
    // setValue, _controlFields). A value written once is where the field
    // starts.
    const binding = bound && FIELD_TAGS.has(tagName) ? [t.numericLiteral(1)] : [];
    if (propName === 'class') {
      // attributeName already mapped className → class. The template
      // decided this element's namespace, so only an SVG element needs the
      // setter that writes the attribute instead of `className`.
      if (ns === 'svg') {
        return t.callExpression(helper(state, '_$setClass'), [t.identifier(elId), valueExpr]);
      }
      return t.callExpression(helper(state, '_$className'), [t.identifier(elId), valueExpr]);
    }
    if (propName === 'classList') {
      return t.callExpression(helper(state, '_$setClassList'), [t.identifier(elId), valueExpr]);
    }
    if (propName === 'style') {
      return t.callExpression(helper(state, '_$setStyle'), [t.identifier(elId), valueExpr]);
    }
    if (propName === 'value' && tagName && VALUE_PROP_TAGS.has(tagName)) {
      return t.callExpression(helper(state, '_$setValue'), [t.identifier(elId), valueExpr, ...binding]);
    }
    if (propName === 'checked' && tagName === 'input') {
      // Live property write — matches bind:checked semantics. (The old
      // setAttribute('checked') path only set the DEFAULT-checked state,
      // which stops reflecting once the user has toggled the input.)
      // A helper (not a raw `.checked =`) so function values still get
      // reactive-accessor treatment, like every other setter.
      return t.callExpression(helper(state, '_$setChecked'), [t.identifier(elId), valueExpr, ...binding]);
    }
    // An input's type and a select's multiple: a write that changes one
    // writes the field's value and checked again (what-core _$retype), as
    // `type={kind()} value="abc"` shows `abc` again once `date` gives way to
    // `text`. An HTML element's attribute names fold their case (`TYPE`).
    const folded = propName.toLowerCase();
    if ((folded === 'type' && tagName === 'input') || (folded === 'multiple' && tagName === 'select')) {
      return t.callExpression(helper(state, '_$retype'), [t.identifier(elId), t.stringLiteral(propName), valueExpr]);
    }
    if (isEnumeratedAttr(propName)) {
      return t.callExpression(helper(state, '_$setAttr'), [
        t.identifier(elId),
        t.stringLiteral(propName),
        valueExpr
      ]);
    }
    return t.callExpression(helper(state, '_$setProp'), [
      t.identifier(elId),
      t.stringLiteral(propName),
      valueExpr
    ]);
  }

  // _$effect(fn), named "tag.prop@loc" in a development build.
  function bindingEffect(fn, what, node) {
    const args = [fn];
    const name = bindingMetadata(tagName, what, node, state);
    if (name) args.push(t.objectExpression([
      t.objectProperty(t.identifier('name'), name),
      t.objectProperty(t.identifier('binding'), t.identifier(elId)),
    ]));
    return t.callExpression(helper(state, '_$effect'), args);
  }

  // Lazy delegation init (C6): an element that is assigned a delegated
  // `$$event` handler calls the module's once-guarded _$delegate$() helper at
  // construction time, which also marks the element's handlers as the current
  // owner's (render.js _$own). Emitted at most once per element.
  let delegateInitEmitted = false;
  function emitDelegateInit() {
    if (delegateInitEmitted) return;
    delegateInitEmitted = true;
    statements.push(
      t.expressionStatement(t.callExpression(helper(state, '_$delegate$'), [t.identifier(elId)]))
    );
  }

  // Spreads with other writers before them: one props object, merged in
  // source order (mergesSpreads). An attribute is a property of it, a getter
  // where its value reads state; a ref written on the element is applied
  // after it, as it is (one after the last spread is the only one: the
  // merge's own is skipped).
  if (mergesSpreads(attributes, tagName, state)) {
    if (SELECT_TAGS.has(tagName)) state.makesSelects = true;
    const parts = [];
    /** @type {any} */
    let literal = null;
    const refs = [];
    const separate = [];
    const last = attributes.findLastIndex((a) => t.isJSXSpreadAttribute(a));
    for (const [attrIndex, attr] of attributes.entries()) {
      if (t.isJSXSpreadAttribute(attr)) {
        parts.push(attr.argument);
        literal = null;
        continue;
      }
      const name = getAttrName(attr);
      if (unmerged(name, state)) {
        separate.push(attr);
        continue;
      }
      // A later attribute of the same name is its only writer (isShadowedAttr).
      if (name === 'key' || (inTemplate(attributes, attrIndex, tagName) && !fallsBack(attributes, attrIndex, state)) || isShadowedAttr(attributes, attrIndex)) continue;
      const value = getAttributeValue(attr.value);
      if (name === 'ref') {
        refs.push([t.expressionStatement(buildRef(value, elId, state)), attrIndex > last]);
        continue;
      }
      const live = t.isJSXExpressionContainer(attr.value) && !t.isFunction(value) && isPotentiallyReactive(value, state.signalNames, state.importedIdentifiers);
      if (literal === null) parts.push(literal = t.objectExpression([t.objectProperty(t.identifier('__proto__'), t.nullLiteral())]));
      literal.properties.push(live
        ? t.objectMethod('get', propKey(name), [], t.blockStatement([t.returnStatement(value)]))
        : t.objectProperty(propKey(name), value));
    }
    // The sources in source order; read again where one may be built again
    // with other keys (liveSpread).
    const sources = t.arrayExpression(parts);
    statements.push(t.expressionStatement(t.callExpression(helper(state, '_$spreads'), [
      FIELD_TAGS.has(tagName) ? t.callExpression(helper(state, '_$controlled'), [t.identifier(elId)]) : t.identifier(elId),
      attributes.some((a) => t.isJSXSpreadAttribute(a) && liveSpread(a.argument, state)) ? t.arrowFunctionExpression([], sources) : sources,
      // A ref after the last spread is the element's only one.
      ...(refs.some(([, after]) => after) ? [t.arrayExpression([t.stringLiteral('ref')])] : []),
    ])), ...refs.map(([statement]) => statement));
    if (separate.length > 0) applyDynamicAttrs(statements, elId, separate, state, tagName, ns);
    return;
  }

  // Static attributes the template holds are already applied (isTemplateAttr).
  // The rest are set here, in source order, so the last write for a key wins
  // exactly as it does in the h() call.
  for (const [attrIndex, attr] of attributes.entries()) {
    if (t.isJSXSpreadAttribute(attr)) {
      if (SELECT_TAGS.has(tagName)) state.makesSelects = true;
      statements.push(
        t.expressionStatement(
          // A spread on a form field may bind its value or checked to state:
          // the field then shows what they hold after its events (what-core
          // _$controlled).
          // One that may be built again with other keys is read again
          // (liveSpread, what-core _$spreads).
          liveSpread(attr.argument, state)
            ? t.callExpression(helper(state, '_$spreads'), [FIELD_TAGS.has(tagName) ? t.callExpression(helper(state, '_$controlled'), [t.identifier(elId)]) : t.identifier(elId),
              t.arrowFunctionExpression([], t.arrayExpression([attr.argument])), ...writtenAfter(attributes, attrIndex)])
            : t.callExpression(helper(state, '_$spread'), [FIELD_TAGS.has(tagName) ? t.callExpression(helper(state, '_$controlled'), [t.identifier(elId)]) : t.identifier(elId), attr.argument, ...writtenAfter(attributes, attrIndex)])
        )
      );
      continue;
    }

    // A later attribute of the same name is the only writer that matters.
    // Emitting this one too would apply it after the template and let it win.
    if (isShadowedAttr(attributes, attrIndex)) continue;

    const attrName = getAttrName(attr);

    // `key` is not an attribute: the list lowering reads a .map() row's key
    // before this runs, and on any other element it does nothing.
    if (attrName === 'key') continue;

    // Ref handling — assign element to ref object/callback
    if (attrName === 'ref') {
      statements.push(t.expressionStatement(buildRef(getAttributeValue(attr.value), elId, state)));
      continue;
    }

    // Event handlers
    if (attrName.startsWith('on') && !attrName.includes('|') && !hasEventModifiers(attrName, state)) {
      // `onClickCapture` is a listener in the capture phase, which delegation
      // (the bubble phase, at the document) cannot give.
      const captured = captureEventName(attrName);
      const event = eventType(captured ?? attrName);
      const handler = getAttributeValue(attr.value);
      const metadata = bindingMetadata(tagName, attrName, attr, state);
      if (metadata) {
        statements.push(t.expressionStatement(t.assignmentExpression('=',
          t.memberExpression(t.identifier(elId), t.stringLiteral(`_$source_${event}`), true),
          metadata
        )));
      }

      if (captured === null && DELEGATED_EVENTS.has(event)) {
        // Use event delegation: el.$$click = handler (matches runtime lookup)
        if (!state.delegatedEvents) state.delegatedEvents = new Set();
        state.delegatedEvents.add(event);
        emitDelegateInit();
        statements.push(
          t.expressionStatement(
            t.assignmentExpression('=',
              t.memberExpression(
                t.identifier(elId),
                t.identifier(`$$${event}`)
              ),
              handler
            )
          )
        );
      } else {
        // Non-delegated: a listener per element, which its owner removes.
        statements.push(
          t.expressionStatement(
            t.callExpression(helper(state, '_$on'), [t.identifier(elId), t.stringLiteral(event), handler,
              ...(captured === null ? [] : [t.booleanLiteral(true)])])
          )
        );
      }
      continue;
    }

    // Event with modifiers (pipe '|' or JSX-safe double underscore '__')
    if (attrName.startsWith('on') && (attrName.includes('|') || hasEventModifiers(attrName, state))) {
      const { eventName, modifiers } = parseEventModifiers(attrName);
      const handler = getAttributeValue(attr.value);
      const wrappedHandler = createEventHandler(handler, modifiers);
      const captured = captureEventName(eventName);
      const event = eventType(captured ?? eventName);

      const optionMods = modifiers.filter(m => EVENT_OPTION_MODIFIERS.has(m));
      if (captured !== null && !optionMods.includes('capture')) optionMods.push('capture');
      const addEventArgs = [t.stringLiteral(event), wrappedHandler];
      if (optionMods.length > 0) {
        const optsProps = optionMods.map(m =>
          t.objectProperty(t.identifier(m), t.booleanLiteral(true))
        );
        addEventArgs.push(t.objectExpression(optsProps));
      }

      // onChange is React's change event, which a spread's listener is
      // (what-core render.js listen): `_$spread(el, { onchange }, null,
      // options)`. It listens for two events, so `once` is the handler's: it
      // runs for the first change, whichever event brings it.
      if (event === 'change') {
        const options = optionMods.filter(m => m !== 'once').map(m => t.objectProperty(t.identifier(m), t.booleanLiteral(true)));
        let changeHandler = wrappedHandler;
        if (optionMods.includes('once')) {
          // ((h, done) => (e) => done || (done = true, h(e)))(handler)
          const [h, done, e] = [t.identifier('h'), t.identifier('done'), t.identifier('e')];
          changeHandler = t.callExpression(t.arrowFunctionExpression([h, done], t.arrowFunctionExpression([e],
            t.logicalExpression('||', done, t.sequenceExpression([t.assignmentExpression('=', t.cloneNode(done), t.booleanLiteral(true)), t.callExpression(t.cloneNode(h), [e])])))), [wrappedHandler]);
        }
        statements.push(t.expressionStatement(t.callExpression(helper(state, '_$spread'), [
          t.identifier(elId),
          t.objectExpression([t.objectProperty(t.identifier('onchange'), changeHandler)]),
          ...(options.length > 0 ? [t.nullLiteral(), t.objectExpression(options)] : []),
        ])));
        continue;
      }

      statements.push(
        t.expressionStatement(
          t.callExpression(helper(state, '_$on'), [t.identifier(elId), ...addEventArgs])
        )
      );
      continue;
    }

    // Binding
    if (isBindingAttribute(attrName)) {
      const bindProp = getBindingProperty(attrName);
      const signalExpr = attr.value.expression;

      if (bindProp === 'value') {
        statements.push(
          t.expressionStatement(
            bindingEffect(t.arrowFunctionExpression([], t.assignmentExpression('=',
              t.memberExpression(t.identifier(elId), t.identifier('value')),
              t.callExpression(t.cloneNode(signalExpr), [])
            )), 'value', attr)
          )
        );
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(elId), t.identifier('addEventListener')),
              [
                t.stringLiteral('input'),
                t.arrowFunctionExpression(
                  [t.identifier('e')],
                  t.callExpression(
                    t.memberExpression(t.cloneNode(signalExpr), t.identifier('set')),
                    [t.memberExpression(
                      t.memberExpression(t.identifier('e'), t.identifier('target')),
                      t.identifier('value')
                    )]
                  )
                )
              ]
            )
          )
        );
      } else if (bindProp === 'checked') {
        statements.push(
          t.expressionStatement(
            bindingEffect(t.arrowFunctionExpression([], t.assignmentExpression('=',
              t.memberExpression(t.identifier(elId), t.identifier('checked')),
              t.callExpression(t.cloneNode(signalExpr), [])
            )), 'checked', attr)
          )
        );
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(elId), t.identifier('addEventListener')),
              [
                t.stringLiteral('change'),
                t.arrowFunctionExpression(
                  [t.identifier('e')],
                  t.callExpression(
                    t.memberExpression(t.cloneNode(signalExpr), t.identifier('set')),
                    [t.memberExpression(
                      t.memberExpression(t.identifier('e'), t.identifier('target')),
                      t.identifier('checked')
                    )]
                  )
                )
              ]
            )
          )
        );
      }
      continue;
    }

    // Dynamic attribute (expression)
    if (t.isJSXExpressionContainer(attr.value)) {
      const expr = attr.value.expression;
      const domName = attributeName(attrName);

      if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
        // Auto-invoke a bare identifier only when it is a PROVEN signal:
        // value={count} -> count() for a local `const count = signal(...)`.
        //
        // Never a destructured prop or an import. Either one can hold any
        // value: a prop is whatever the parent passed, and an import is
        // whatever the other module exported (`href={DOCS_URL}` with a string
        // constant is the common case). Calling one of those threw
        // "X is not a function". The runtime setters resolve a function value
        // as a reactive accessor themselves, exactly as h() does, so the
        // uncalled identifier is correct for a plain value AND keeps an
        // imported signal live.
        const fromProps = state.signalNames && state.signalNames.fromDestructuredProps;
        const valueExpr = t.isIdentifier(expr) &&
          !(fromProps && fromProps.has(expr.name)) &&
          isSignalIdentifier(expr.name, state.signalNames)
          ? t.callExpression(expr, [])
          : expr;
        const effectCall = bindingEffect(t.arrowFunctionExpression([], buildSetPropCall(domName, valueExpr, true)), domName, attr);
        // In dev mode, add a leading comment when the effect wrapping is uncertain
        // (non-signal function call whose args happen to contain signal reads)
        if (isUncertainReactive(expr, state.signalNames, state.importedIdentifiers)) {
          t.addComment(effectCall, 'leading',
            ' @what-dev: effect wrapping may be unnecessary — expression contains a non-signal function call with reactive args ',
            false
          );
        }
        statements.push(t.expressionStatement(effectCall));
      } else {
        // Static expression (no signal calls) — set once
        statements.push(t.expressionStatement(buildSetPropCall(domName, expr)));
      }
      continue;
    }

    // A literal attribute the template could not hold (see isTemplateAttr):
    // applied here, in the order the author wrote it. A valueless attribute is
    // `true` in JSX, which is what the h() spelling passes.
    if (!isTemplateAttr(attributes, attrIndex, tagName)) {
      statements.push(
        t.expressionStatement(
          buildSetPropCall(attributeName(attrName), getAttributeValue(attr.value))
        )
      );
    }
  }
}

// =====================================================
// Branch Memoization
// =====================================================
// `_$insert(el, () => cond() ? <A/> : <B/>)` re-creates the taken branch's
// DOM tree (and re-registers every effect inside it) on EVERY re-evaluation
// of the insert effect — including writes to signals read by the condition
// that do NOT flip which branch is taken (e.g. `count() > 5` while count
// goes 6 → 7). Solid solves this by memoizing the condition: route the
// condition through an eager, equality-gated memo so the insert effect
// depends on the *memo* instead of the raw signals:
//
//   const _c$0 = _$memo(() => !!(count() > 5));
//   _$insert(_el$, () => _c$0() ? <A/> : <B/>, marker);
//
// The memo re-evaluates on every count write, but only NOTIFIES when its
// value changes — so branch DOM is recreated exactly on real flips.
//
// Semantics preserved:
//  - Ternary tests only matter for truthiness → memoize `!!test`.
//  - `a && b` / `a || b` render the LEFT operand's VALUE when it
//    short-circuits (`{0 && <div/>}` renders "0"), so the left side is
//    memoized by value (Object.is) — never coerced.
//  - Branch-internal reactivity (signals read inside <A/>) is fine-grained
//    and unaffected; plain-value branches read in the insert arrow are
//    still tracked by the insert effect directly.

// A keyed list inserter: one this back end built (_$mapArray), or a
// hand-written mapArray() call, which is handed the same import.
function isListInserterCall(node) {
  return t.isCallExpression(node)
    && (node._whatList === true || t.isIdentifier(node.callee, { name: 'mapArray' }));
}

function adoptMapArrayCall(call, state) {
  state.needsGeneralMapArray = true;
  if (call._whatList !== true) {
    call.callee = helper(state, '_$mapArray');
    call._whatList = true;
  }
}

// Does this expression produce DOM when evaluated? (raw JSX still present at
// this stage, or an already-lowered _$mapArray list). Only then is branch
// memoization worth the extra memo node.
function buildsDOM(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(buildsDOM);
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  if (isListInserterCall(node)) return true;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' ||
        key === 'trailingComments' || key === 'innerComments') continue;
    const v = node[key];
    if (v && typeof v === 'object' && buildsDOM(v)) return true;
  }
  return false;
}

// --- Ternary trees ---
//
// `a() ? <A /> : b() ? <B /> : <C />` picks one of its leaves by its tests.
// With only its first test memoized, the inner `b()` is read by the region
// itself, and <C /> is built again whenever b's inputs change, truthiness or
// not. The whole tree's choice is one memo instead: the tree with each leaf
// replaced by its index (`a() ? 0 : b() ? 1 : 2`), which evaluates exactly
// the tests the original evaluates, in its order, so a test an outer one
// guards (`q.data().items.length` behind `q.isLoading()`) is never read
// unguarded. The memo is lazy (_$lazyMemo), read first where the region
// first runs, so a tree handed over unplaced (a <Show> fallback, a slot) is
// not evaluated before its place renders. The region then reads the index
// and builds a leaf only when the index changes: what <Switch> lowers to.

function ternaryTree(expr, leaves, tests) {
  if (!t.isConditionalExpression(expr)) {
    leaves.push(expr);
    return t.numericLiteral(leaves.length - 1);
  }
  tests.push(expr.test);
  return t.conditionalExpression(expr.test, ternaryTree(expr.consequent, leaves, tests), ternaryTree(expr.alternate, leaves, tests));
}

/**
 * `expr` (a ternary with a reactive test and a leaf that builds DOM) as a
 * read of one lazy memo of the leaf it takes, the memo's declaration pushed
 * onto `statements`; null for any other expression.
 */
function memoizeTernaryTree(expr, statements, state) {
  if (!t.isConditionalExpression(expr)) return null;
  const leaves = [];
  const tests = [];
  const selector = ternaryTree(expr, leaves, tests);
  if (!tests.some((test) => isPotentiallyReactive(test, state.signalNames, state.importedIdentifiers))) return null;
  if (!leaves.some(buildsDOM)) return null;
  const id = state.nextMemoId();
  statements.push(t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier(id), t.callExpression(helper(state, '_$lazyMemo'), [t.arrowFunctionExpression([], selector)])),
  ]));
  // A leaf `b() && <B />` keeps <B> the same way (memoizeLogical); its memo
  // is lazy too, read only when the tree takes that leaf.
  for (let i = 0; i < leaves.length; i++) leaves[i] = memoizeLogical(leaves[i], statements, state) ?? leaves[i];
  let out = leaves[leaves.length - 1];
  for (let i = leaves.length - 2; i >= 0; i--) {
    out = t.conditionalExpression(t.binaryExpression('===', t.callExpression(t.identifier(id), []), t.numericLiteral(i)), leaves[i], out);
  }
  return out;
}

// --- `&&` and `||` ---
//
// `{user() && <Profile user={user()} />}` is how React code renders a part
// that needs a value. Gated on the left VALUE, the region ran again, and
// rebuilt <Profile> with its state, whenever user() returned another object.
// The arm is picked by the left side's truthiness instead, a lazy memo, and
// the left value itself is read only where it renders, React's way: falsy
// for `&&` (`{count() && <X />}` with 0 renders "0"; false, null, undefined
// and '' render nothing), truthy for `||`. `||` lowers so only when its right
// side builds DOM and its left side does not (a left side that is JSX is
// rendered, and built, on every read). The server renders `left && right`
// itself, which is the same output.

/**
 * `expr` (a `&&`/`||` with a reactive left side and a right side that builds
 * DOM) as a ternary over a lazy memo of the left side's truthiness, the
 * memo's declaration pushed onto `statements`; null otherwise.
 */
function memoizeLogical(expr, statements, state) {
  if (!t.isLogicalExpression(expr) || (expr.operator !== '&&' && expr.operator !== '||')) return null;
  if (!isPotentiallyReactive(expr.left, state.signalNames, state.importedIdentifiers)) return null;
  if (!buildsDOM(expr.right)) return null;
  if (expr.operator === '||' && buildsDOM(expr.left)) return null;
  const id = state.nextMemoId();
  statements.push(t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier(id), t.callExpression(helper(state, '_$lazyMemo'), [
      t.arrowFunctionExpression([], t.unaryExpression('!', t.unaryExpression('!', expr.left))),
    ])),
  ]));
  const truthy = t.callExpression(t.identifier(id), []);
  const left = t.cloneNode(expr.left, true);
  return expr.operator === '&&'
    ? t.conditionalExpression(truthy, expr.right, left)
    : t.conditionalExpression(truthy, left, expr.right);
}

// If `expr` is a conditional (ternary / && / ||) with a reactive test and a
// DOM-producing branch, hoist the test into `const _c$N = _$memo(...)` (pushed
// onto `statements`) and return the expression rewritten to read the memo.
// A ternary with ternaries for arms is one memo of the arm it takes
// (memoizeTernaryTree), and `&&`/`||` a memo of the left side's truthiness
// (memoizeLogical). Otherwise returns `expr` unchanged.
function memoizeBranchCondition(expr, statements, state) {
  if (t.isConditionalExpression(expr) && (t.isConditionalExpression(expr.consequent) || t.isConditionalExpression(expr.alternate))) {
    const tree = memoizeTernaryTree(expr, statements, state);
    if (tree !== null) return tree;
  }
  const logical = memoizeLogical(expr, statements, state);
  if (logical !== null) return logical;
  let testExpr = null;
  let isTernary = false;
  if (t.isConditionalExpression(expr)) {
    testExpr = expr.test;
    isTernary = true;
  } else if (t.isLogicalExpression(expr) && (expr.operator === '&&' || expr.operator === '||')) {
    testExpr = expr.left;
  } else {
    return expr;
  }

  if (!isPotentiallyReactive(testExpr, state.signalNames, state.importedIdentifiers)) return expr;

  const branches = isTernary ? [expr.consequent, expr.alternate] : [expr.right];
  if (!branches.some(buildsDOM)) return expr;

  const condId = state.nextMemoId();
  // Ternary: only truthiness matters in test position → gate on !!test so
  // value changes that don't flip truthiness (5 → 6) never notify.
  // Logical: the left VALUE is rendered on short-circuit → gate on the value.
  const memoBody = isTernary
    ? t.unaryExpression('!', t.unaryExpression('!', testExpr))
    : testExpr;
  statements.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(condId),
        t.callExpression(helper(state, '_$memo'), [
          t.arrowFunctionExpression([], memoBody)
        ])
      )
    ])
  );

  const condRead = t.callExpression(t.identifier(condId), []);
  // An arm `b() && <B />` keeps <B> by a lazy memo of its own (memoizeLogical).
  return isTernary
    ? t.conditionalExpression(condRead, memoizeLogical(expr.consequent, statements, state) ?? expr.consequent, memoizeLogical(expr.alternate, statements, state) ?? expr.alternate)
    : t.logicalExpression(expr.operator, condRead, expr.right);
}

// Whether an element can be or hold a form field: a field's tag, or inner
// HTML its props write (innerHTML, dangerouslySetInnerHTML, or a spread that
// can give either). Its module installs the carrying of what the user changed
// in a form before hydration into the fields built before the walk reached
// them (what-core _$carryFields, once at module scope).
function buildsField(tagName, attributes) {
  return FIELD_TAGS.has(tagName.toLowerCase()) || attributes.some((attr) => t.isJSXSpreadAttribute(attr) || INNER_HTML_PROPS.has(getAttrName(attr)));
}

// Whether a binding writes the element's content as raw HTML: a hydratable
// claim then keeps what the server put in it (render.js claimNode, flag 2).
function writesContent(attributes) {
  return attributes.some((attr) => t.isJSXAttribute(attr) && INNER_HTML_PROPS.has(getAttrName(attr)));
}

// The bindings for an element's children. A hydratable build reaches the
// children in document order through the hydration cursor instead of by
// firstChild/nextSibling paths (render.js _$claim): `_$skip(k)` passes k static
// children, `_$next(k, 1?)` takes the next element with bindings (1: entering
// it), `_$hole(el, value, flag)` is a dynamic child, and `_$exit()` leaves the
// element. Returns whether it emitted such steps, in which case the caller
// enters the element when it takes it.
// `rowCell`: the item cell of the keyed row whose callback returns this
// template, when it is one.
function applyDynamicChildren(statements, elId, children, parentNode, state, rowCell) {
  const { entries } = layoutChildren(children, false, state, null, isTextOnly(parentNode));
  const hydratable = state.hydratable;
  // Static children since the last step (hydratable output).
  let skip = 0;
  let stepped = false;
  const flushSkip = () => {
    if (skip > 0) statements.push(t.expressionStatement(t.callExpression(helper(state, '_$skip'), [t.numericLiteral(skip)])));
    skip = 0;
  };

  // Template nodes the code below must reach: each dynamic child's marker,
  // and every element child with something dynamic of its own.
  const uses = [];
  for (const entry of entries) {
    if (entry.kind === 'dynamic') {
      if (typeof entry.marker === 'number') uses.push(entry.marker);
    } else if (entry.kind === 'element') {
      const attrs = entry.node.openingElement.attributes;
      entry.hasAnythingDynamic = attrs.some((attr, i) => isDynamicAttr(attr) || isFieldProp(entry.node.openingElement.name.name, attrs, i)) ||
        attrs.some(a => !t.isJSXSpreadAttribute(a) && getAttrName(a)?.startsWith('on')) ||
        !entry.node.children.every(isStaticChild);
      if (entry.hasAnythingDynamic) uses.push(entry.index);
    }
  }
  const refIndices = [...new Set(uses)].sort((a, b) => a - b);

  // An insert puts nodes before its marker, which moves every later node
  // relative to `firstChild`. So when more than one node is needed, or one
  // node is needed twice (as a marker, then as an element), all of them are
  // captured up front, before any insert runs. The capture is one cursor
  // walk, each reference chained from the previous one: O(n) in compile
  // time and emitted size rather than O(n^2).
  const markerVars = new Map(); // template node index → variable name
  if (!hydratable && (refIndices.length >= 2 || uses.length > refIndices.length)) {
    let prevVar = null;
    let prevIndex = 0;
    for (const idx of refIndices) {
      const markerVar = state.nextVarId();
      markerVars.set(idx, markerVar);
      let init;
      if (prevVar === null) {
        init = buildChildAccess(elId, idx);
      } else {
        init = t.identifier(prevVar);
        for (let i = prevIndex; i < idx; i++) {
          init = t.memberExpression(init, t.identifier('nextSibling'));
        }
      }
      statements.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(markerVar), init)
        ])
      );
      prevVar = markerVar;
      prevIndex = idx;
    }
  }

  // `_$insert(el, value[, marker])`: no third argument when the child is the
  // element's only content, `null` when it is appended. A development build
  // adds the binding's name, "tag.children@loc", as a fourth argument.
  // Hydratable: `_$hole(el, value, flag)`, the flag saying where a client
  // render inserts (3 only child, 2 appended, 1 before its `<!>`, 0 before
  // the next node).
  // `plain`: the value is a thunk over an expression that only reads
  // (isPlainRead), which the runtime reads once before it decides whether an
  // effect is needed (`_$plain`, `_$hplain`, same arguments).
  function insertCall(value, marker, node, placeholder, plain) {
    if (hydratable) {
      flushSkip();
      stepped = true;
      // The value is placed where it is evaluated: its JSX claims (transformJsxRoot).
      value._whatInPlace = true;
      placeFlat(value);
      const flag = marker === undefined ? 3 : marker === null ? 2 : placeholder ? 1 : 0;
      const args = [t.identifier(elId), value, t.numericLiteral(flag)];
      const name = bindingMetadata(parentNode.openingElement.name.name, 'children', node, state);
      if (name) args.push(name);
      return t.callExpression(helper(state, plain ? '_$hplain' : '_$hole'), args);
    }
    const args = [t.identifier(elId), value];
    if (marker === null) args.push(t.nullLiteral());
    else if (marker !== undefined) {
      args.push(markerVars.has(marker) ? t.identifier(markerVars.get(marker)) : buildChildAccess(elId, marker));
    }
    const name = bindingMetadata(parentNode.openingElement.name.name, 'children', node, state);
    if (name) {
      if (marker === undefined) args.push(t.unaryExpression('void', t.numericLiteral(0)));
      args.push(name);
    }
    // A function written where it is inserted is no list and no children
    // factory, so insert() could only hand it to its reactive region. A
    // module whose every insert is one imports that region under insert's
    // name (renderExport), and does not bring insert() itself.
    if (!plain && !t.isArrowFunctionExpression(value) && !t.isFunctionExpression(value)) state.needsGeneralInsert = true;
    return t.callExpression(helper(state, plain ? '_$plain' : '_$insert'), args);
  }

  // A plain field of a keyed row's item (`{row.label}`): a text node the
  // row's item cell writes (render.js _$field), read now from the item the
  // row is built from, with its reader hoisted to the module. A field in the
  // template the row's callback returns is built with the row and goes with
  // it. Anywhere else (a region of the row, a row of a list inside it, a
  // component's children) it gets a last argument, 1: the runtime then binds
  // it to the row only when what builds it lives as long as the row.
  function fieldCall(expr, root, marker, placeholder) {
    const id = uniqueName(state, '_f$');
    state.rowFieldReaders.push({ id, fn: t.arrowFunctionExpression([t.identifier('r')], withItem(expr, root, t.identifier('r'))) });
    const value = withItem(expr, root, t.identifier(root._whatRowItemName));
    const cell = t.cloneNode(root.arguments[0]);
    const elsewhere = rowCell !== undefined && t.isIdentifier(cell, { name: rowCell }) ? [] : [t.numericLiteral(1)];
    if (hydratable) {
      flushSkip();
      stepped = true;
      const flag = marker === undefined ? 3 : marker === null ? 2 : placeholder ? 1 : 0;
      return t.callExpression(helper(state, '_$hfield'), [t.identifier(elId), cell, value, t.numericLiteral(flag), t.identifier(id), ...elsewhere]);
    }
    const at = marker === undefined ? t.unaryExpression('void', t.numericLiteral(0))
      : marker === null ? t.nullLiteral()
        : markerVars.has(marker) ? t.identifier(markerVars.get(marker)) : buildChildAccess(elId, marker);
    return t.callExpression(helper(state, '_$field'), [t.identifier(elId), cell, value, at, t.identifier(id), ...elsewhere]);
  }

  for (const entry of entries) {
    if (entry.kind === 'dynamic' && t.isJSXExpressionContainer(entry.node)) {
      let expr = entry.node.expression;

      const field = rowField(expr);
      if (field !== null && t.isCallExpression(field) && field._whatRowItemName) {
        statements.push(t.expressionStatement(fieldCall(expr, field, entry.marker, entry.placeholder)));
        continue;
      }

      // Auto-lower .map() to mapArray when the callback returns keyed JSX.
      // Pattern: source().map(item => <Comp key={...} />) or source().map((item, i) => ...)
      let mapResult = tryLowerMapToMapArray(expr, state);
      if (mapResult) {
        // A bare _$mapArray(...) call is a self-managing inserter (it tracks
        // its source internally) and an arrow is already reactive — pass both
        // raw. But when lowering produced a ternary/logical wrapping the call
        // (e.g. cond ? _$mapArray(...) : fallback), the surrounding condition
        // must stay reactive, so wrap the whole expression in () => and let
        // _$insert re-evaluate it on change. Without this the condition is read
        // exactly once and never re-tracks.
        const isBareMapArray = isListInserterCall(mapResult);
        const isArrowAlready = t.isArrowFunctionExpression(mapResult);
        // Branch memoization (C1): when the lowered result is a conditional
        // around the list (cond ? _$mapArray(...) : fallback), memoize the
        // condition so non-flip writes don't tear down and recreate the
        // entire list inserter.
        if (isArrowAlready && t.isExpression(mapResult.body)) {
          mapResult.body = memoizeBranchCondition(mapResult.body, statements, state);
        } else if (!isBareMapArray && !isArrowAlready) {
          mapResult = memoizeBranchCondition(mapResult, statements, state);
        }
        const insertArg = (isBareMapArray || isArrowAlready)
          ? mapResult
          : t.arrowFunctionExpression([], mapResult);
        statements.push(t.expressionStatement(insertCall(insertArg, entry.marker, entry.node, entry.placeholder)));
        continue;
      }

      // mapArray() calls return self-managing inserters — pass directly, never wrap in () =>
      if (isListInserterCall(expr)) {
        adoptMapArrayCall(expr, state);
        statements.push(t.expressionStatement(insertCall(expr, entry.marker, entry.node, entry.placeholder)));
        continue;
      }

      if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
        // Branch memoization (C1): conditional children only rebuild branch
        // DOM when the condition actually flips.
        expr = memoizeBranchCondition(expr, statements, state);
        // Hydratable output hands a signal written as a child (`{count}`) to
        // the hole as itself: the server renders it as one region, and a
        // thunk returning it would be a region holding another.
        const value = hydratable && t.isIdentifier(expr) ? expr : t.arrowFunctionExpression([], orderedRows(expr, state, true));
        // An expression that only reads (`{props.title}`, `{item.price *
        // item.qty}`) needs no effect when what it reads is not reactive, or
        // is a list row's item alone (render.js _$plain). A bare name is a
        // signal handed on as it is, never a read.
        const plain = t.isArrowFunctionExpression(value) && !t.isIdentifier(value.body) && isPlainRead(value.body);
        const call = insertCall(value, entry.marker, entry.node, entry.placeholder, plain);
        if (isUncertainReactive(expr, state.signalNames, state.importedIdentifiers)) {
          t.addComment(call, 'leading',
            ' @what-dev: reactive wrapping may be unnecessary — expression contains a non-signal function call with reactive args ',
            false
          );
        }
        statements.push(t.expressionStatement(call));
      } else {
        statements.push(t.expressionStatement(insertCall(orderedRows(expr, state, false), entry.marker, entry.node, entry.placeholder)));
      }
      continue;
    }

    if (entry.kind === 'dynamic') {
      const transformed = transformElementFineGrained({ node: entry.node }, state);
      statements.push(t.expressionStatement(insertCall(transformed, entry.marker, entry.node, entry.placeholder)));
      continue;
    }

    if (hydratable && entry.kind !== 'dynamic') {
      if (!entry.hasAnythingDynamic) {
        skip++;
        continue;
      }
      // An element with bindings: taken in its place, entered when its own
      // children have steps.
      const childElRef = state.nextVarId();
      const childEl = entry.node.openingElement;
      const next = t.callExpression(helper(state, FORM_CONTROLS.has(childEl.name.name) ? '_$control' : '_$next'), [t.numericLiteral(skip)]);
      skip = 0;
      stepped = true;
      statements.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(childElRef), next)]));
      applyDynamicAttrs(statements, childElRef, childEl.attributes, state, childEl.name.name, entry.node._whatNs);
      const flags = (applyDynamicChildren(statements, childElRef, entry.node.children, entry.node, state, rowCell) ? 1 : 0) | (writesContent(childEl.attributes) ? 2 : 0);
      claimArguments(next, flags, FORM_CONTROLS.has(childEl.name.name) ? null : ownedAttrs(childEl.attributes, childEl.name.name, entry.node._whatNs));
      continue;
    }

    if (entry.kind === 'element' && entry.hasAnythingDynamic) {
      // Static child with dynamic content — get element reference
      let childElRef;
      if (markerVars.has(entry.index)) {
        childElRef = markerVars.get(entry.index);
      } else {
        childElRef = state.nextVarId();
        statements.push(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier(childElRef),
              buildChildAccess(elId, entry.index)
            )
          ])
        );
      }
      const childEl = entry.node.openingElement;
      applyDynamicAttrs(statements, childElRef, childEl.attributes, state, childEl.name.name, entry.node._whatNs);
      applyDynamicChildren(statements, childElRef, entry.node.children, entry.node, state, rowCell);
    }
  }
  if (stepped) statements.push(t.expressionStatement(t.callExpression(helper(state, '_$exit'), [])));
  return stepped;
}

// A hydratable template claims a form control with _$control (_$claimControl
// for its root): what the user changed in it before hydration stays.
const FORM_CONTROLS = new Set(['input', 'select', 'textarea']);

function buildChildAccess(elId, index) {
  // Use firstChild/nextSibling chains instead of childNodes[N]
  // This is more robust with whitespace text nodes
  if (index === 0) {
    return t.memberExpression(t.identifier(elId), t.identifier('firstChild'));
  }
  // Chain .nextSibling for subsequent indices
  let expr = t.memberExpression(t.identifier(elId), t.identifier('firstChild'));
  for (let i = 0; i < index; i++) {
    expr = t.memberExpression(expr, t.identifier('nextSibling'));
  }
  return expr;
}

// The factory a slot prop's JSX is built by (render.js _$slots). A ternary
// with a reactive test (`header={b() ? <X /> : <Y />}`) hands the component a
// reactive child instead of the arm it found first: the arm is picked by a
// lazy memo (memoizeTernaryTree) the slot creates when it builds, so the arm
// placed stays while the choice holds and the other one shows when it
// changes. Read once, as before, the slot showed its first arm forever.
// what-server hands the same function (ssr.js slotValue), so hydration finds
// the region it brackets. Only when every arm is JSX: a component may test
// the prop instead of placing it (`props.icon ? ... : ...`), and an arm that
// is null has to read as false there, which a function never does
// (core test lazy-props, "a condition the run never read").
function slotFactory(value, state) {
  if (!everyArmIsJsx(value)) return t.arrowFunctionExpression([], value);
  const setup = [];
  const tree = memoizeTernaryTree(value, setup, state);
  if (tree === null) return t.arrowFunctionExpression([], value);
  return t.arrowFunctionExpression([], t.blockStatement([...setup, t.returnStatement(t.arrowFunctionExpression([], tree))]));
}

/** Whether every arm of the ternary `expr` is a JSX element or fragment. */
function everyArmIsJsx(expr) {
  if (t.isConditionalExpression(expr)) return everyArmIsJsx(expr.consequent) && everyArmIsJsx(expr.alternate);
  return t.isJSXElement(expr) || t.isJSXFragment(expr);
}

function transformComponentFineGrained(path, state) {
  const { node } = path;
  const openingElement = node.openingElement;
  const componentRef = componentCallee(openingElement.name);
  // The tag's own reference, for isPlainFunctionComponent.
  componentRef._whatTag = true;
  const attributes = openingElement.attributes;
  const children = node.children;

  // Check for client: directive (islands)
  /** @type {{ type: string, value?: any } | null} */
  let clientDirective = null;
  const filteredAttrs = [];

  for (const attr of attributes) {
    if (t.isJSXAttribute(attr)) {
      // Handle both simple names and namespaced names (client:idle)
      let name;
      if (t.isJSXNamespacedName(attr.name)) {
        name = `${attr.name.namespace.name}:${attr.name.name.name}`;
      } else {
        name = attr.name.name;
      }
      if (name && typeof name === 'string' && name.startsWith('client:')) {
        clientDirective = { type: name.slice(7), value: directiveValue(attr) };
        continue;
      }
    }
    filteredAttrs.push(attr);
  }

  // Transform children.
  // Element children build their DOM at the call site, i.e. before the parent
  // component ever runs, so a <Provider> publishes its context value too late
  // for its own subtree. Collect the element setup and emit it behind a
  // zero-arg factory instead; the runtime calls the factory while the parent's
  // owner is current. An expression child is deferred for the same
  // reason: it is the shape a wrapper forwards its own children through, and
  // reading it while the argument list is built happens before the component
  // it is being handed to has run. Text children have nothing to defer.
  //
  // Shared by the island branch and the regular component branch: an island is
  // still a component, and `<Panel client:visible>...</Panel>` must keep its
  // children rather than silently dropping them.
  function transformComponentChildren() {
    const setupMark = state._pendingSetup ? state._pendingSetup.length : 0;
    const members = [];
    let deferChildren = false;
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = normalizeJsxText(child.value);
        if (text) members.push({ expr: t.stringLiteral(text), setup: [] });
      } else if (t.isJSXExpressionContainer(child)) {
        if (!t.isJSXEmptyExpression(child.expression)) {
          deferChildren = true;
          // The same lowering an element child and a fragment child get.
          // Without it `<Box>{count()}</Box>` was evaluated once and never
          // again, while `<div>{count()}</div>` right beside it stayed live —
          // the auto-thunk docs/GOTCHAS.md section 2 promises for "any call
          // with no arguments" reached every JSX position EXCEPT this one.
          //
          // Nothing about it is component-specific: a component's children
          // are built into an array with no host element to _$insert into,
          // which is exactly the situation lowerFragmentExprChild exists for,
          // and it is where `.map()` picks up keyed reconciliation too.
          members.push(arrayMember(state, () => lowerFragmentExprChild(child.expression, state)));
        }
      } else if (t.isJSXElement(child)) {
        // <For>/<Show>/<Switch> lower to an inserter or a thunk (already lazy).
        const childFlow = controlFlowTag(child, state);
        if (childFlow !== 'For' && childFlow !== 'Show' && childFlow !== 'Switch') deferChildren = true;
        members.push(arrayMember(state, () => transformElementFineGrained({ node: child }, state)));
      } else if (t.isJSXFragment(child)) {
        deferChildren = true;
        members.push(arrayMember(state, () => transformFragmentFineGrained({ node: child }, state)));
      }
    }

    // Several children have markers of their own where they are placed as an
    // array (the value of a component or of a reactive child, a member of an
    // array), before those of a component among them; placed in an element's
    // hole or among other members they have none, and the first may bring
    // markers of its own (render.js _$members, dom.js _place). One child is
    // handed over as itself, so it never has markers but its own.
    const first = members[0];
    let childrenArg = membersArray(members, state, false, true,
      members.length > 1 && !createdClaims(first, state) && !t.isStringLiteral(first.expr));
    if (isMembersCall(childrenArg, state)) childrenArg.arguments.push(t.numericLiteral(members.length > 1 ? 2 : 1));
    // An array built in order claims where it is built: where the component
    // places its children.
    if (deferChildren || !t.isArrayExpression(childrenArg)) {
      // Hoisted element setup emitted while transforming these children belongs
      // inside the factory, not before the enclosing statement.
      const setup = state._pendingSetup ? state._pendingSetup.splice(setupMark) : [];
      childrenArg = t.arrowFunctionExpression(
        [],
        setup.length > 0
          ? t.blockStatement([...setup, t.returnStatement(childrenArg)])
          : childrenArg
      );
    }
    return childrenArg;
  }

  if (clientDirective) {
    // User props in source order — same rule, and the same reasons, as the
    // regular component path below. An island IS a component, so
    // `<Chart client:load {...a} {...b} />` has to mean `{ ...a, ...b }` for
    // exactly the reason `<Chart {...a} {...b} />` does. They travel apart
    // from the island's own options (common.js islandOptions), so no prop
    // name, and nothing a caller spreads in, can reach the component or the
    // mode.
    const islandParts = [];
    let islandUserProps = [];
    const flushIslandUserProps = () => {
      if (islandUserProps.length > 0) {
        islandParts.push(t.objectExpression(islandUserProps));
        islandUserProps = [];
      }
    };

    for (const attr of filteredAttrs) {
      if (t.isJSXSpreadAttribute(attr)) {
        // Every spread is its own part of the island's props, in source order,
        // so `<Chart client:visible {...a} {...b} />` keeps the keys of both.
        if (t.isObjectExpression(attr.argument)) {
          for (const prop of attr.argument.properties) {
            if (t.isObjectProperty(prop)) checkIslandProp(t.isIdentifier(prop.key) ? prop.key.name : String(prop.key.value), prop.value, node, state);
          }
        }
        flushIslandUserProps();
        islandParts.push(attr.argument);
        continue;
      }
      const attrName = getAttrName(attr);
      if (attrName === 'key') continue;
      checkIslandProp(attrName, attr.value, node, state);
      const value = getAttributeValue(attr.value);
      // `data-x` and `aria-label` are not identifiers: propKey quotes them.
      islandUserProps.push(t.objectProperty(propKey(attrName), value));
    }

    let islandPropsExpr = null;
    if (islandParts.length === 0) {
      // No spread anywhere: one object literal, the shape nearly every island has.
      if (islandUserProps.length > 0) islandPropsExpr = t.objectExpression(islandUserProps);
    } else {
      flushIslandUserProps();
      islandPropsExpr = t.callExpression(
        t.memberExpression(t.identifier('Object'), t.identifier('assign')),
        [t.objectExpression([]), ...islandParts]
      );
    }

    const islandChildren = transformComponentChildren();
    if (!isEmptyArray(islandChildren)) state.needsLazyProps = true;
    const islandArgs = [helper(state, '_$Island'), islandOptions(openingElement.name, clientDirective.type, clientDirective.value, islandPropsExpr), islandChildren];
    const islandMeta = componentMetadata(node, state);
    // Hydratable output's component call takes the JSX's number before its
    // development location (below); an island has none, as on the server.
    if (islandMeta) islandArgs.push(...(state.hydratable ? [t.unaryExpression('void', t.numericLiteral(0))] : []), islandMeta);
    return t.callExpression(helper(state, '_$createComponent'), islandArgs);
  }

  // Regular component — use _$createComponent to instantiate, component runs once.
  // Unless this element IS the tree handed to hydrate(), in which case it has
  // to arrive unbuilt: see isHydrateRootArgument.
  //
  // The root, and only the root. A host element lowers to a template clone, so
  // "unbuilt" is not something the children of an arbitrary tree can inherit —
  // <App><p>hi</p></App> would still build the <p>, and pushing the choice down
  // through component children only would produce a tree that hydrates in
  // patches. The root is the one position where the answer is unambiguous and
  // it is where the documented entry point lives.
  const isHydrateRoot = isHydrateRootArgument(path);

  // Props resolve in SOURCE order. `<Box a {...s} b />` is one spelling of
  // `{ a, ...s, b }`, which is what h(), the JSX runtime, every other JSX
  // toolchain, and this compiler's own ELEMENT path all produce.
  // `parts` is that argument list: runs of explicit attributes, separated by
  // the spreads written between them.
  //
  // A single `spreadExpr` with every explicit prop appended last would get
  // both halves wrong: `<Box {...a} {...b} />` would keep only `b`, so every
  // key `a` carried and `b` did not would vanish — data loss, not merely
  // precedence — and an attribute written BEFORE a spread would beat it, which
  // no other JSX implementation does.
  //
  // The merge is a shallow copy, deliberately: a prop is reactive here when
  // its VALUE is an accessor, and Object.assign copies that function through
  // untouched. A lone non-literal spread is copied too, the same
  // Object.assign path a multi-prop merge already used, so two
  // `<Box {...reused}>` sites do not share one identity. createComponent
  // (dom.js) copies again before the component sees the props.
  const parts = [];
  let props = [];
  const slots = [];
  // Whether a prop is live (a getter): the literal then has no prototype.
  let live = false;
  const flushProps = () => {
    if (props.length > 0) {
      parts.push(t.objectExpression(props));
      props = [];
    }
  };

  for (const attr of filteredAttrs) {
    if (t.isJSXSpreadAttribute(attr)) {
      flushProps();
      parts.push(attr.argument);
      continue;
    }

    const attrName = getAttrName(attr);

    // `key` is not a prop: the list lowering reads a .map() row's key before
    // this runs, and on any other component it does nothing.
    if (attrName === 'key') continue;

    // Handle bind: attributes for components
    if (isBindingAttribute(attrName)) {
      const bindProp = getBindingProperty(attrName);
      const signalExpr = attr.value.expression;

      if (bindProp === 'value') {
        props.push(
          t.objectProperty(t.identifier('value'), t.callExpression(t.cloneNode(signalExpr), []))
        );
        props.push(
          t.objectProperty(
            t.identifier('onInput'),
            t.arrowFunctionExpression(
              [t.identifier('e')],
              t.callExpression(
                t.memberExpression(t.cloneNode(signalExpr), t.identifier('set')),
                [t.memberExpression(
                  t.memberExpression(t.identifier('e'), t.identifier('target')),
                  t.identifier('value')
                )]
              )
            )
          )
        );
      } else if (bindProp === 'checked') {
        props.push(
          t.objectProperty(t.identifier('checked'), t.callExpression(t.cloneNode(signalExpr), []))
        );
        props.push(
          t.objectProperty(
            t.identifier('onChange'),
            t.arrowFunctionExpression(
              [t.identifier('e')],
              t.callExpression(
                t.memberExpression(t.cloneNode(signalExpr), t.identifier('set')),
                [t.memberExpression(
                  t.memberExpression(t.identifier('e'), t.identifier('target')),
                  t.identifier('checked')
                )]
              )
            )
          )
        );
      }
      continue;
    }

    // Handle event modifiers on components
    if (attrName.startsWith('on') && (attrName.includes('|') || hasEventModifiers(attrName, state))) {
      const { eventName, modifiers } = parseEventModifiers(attrName);
      const handler = getAttributeValue(attr.value);
      const wrappedHandler = createEventHandler(handler, modifiers);
      props.push(t.objectProperty(t.identifier(eventName), wrappedHandler));
      continue;
    }

    const value = getAttributeValue(attr.value);
    // JSX handed to a component in a prop, and a prop handed on to one
    // (`fallback={props.fallback}`, a placing read), are built where the
    // component reads them, as its children are: a lazy getter over a
    // factory (render.js _$slots, dom.js _installLazyChildren). While
    // hydrating, the factory's JSX claims the server's nodes where the
    // component places it.
    if (isSlotAttribute(node, attr, state) && (yieldsJsx(value) || isPlacingRead(value))) {
      slots.push(t.objectProperty(propKey(attrName), slotFactory(value, state)));
      continue;
    }

    // A value that reads a signal is a live prop: a getter over the
    // expression, which the component reads again wherever it reads it
    // (what-core dom.js _isLiveProp), so `<Badge on={count() > 0} />` shows
    // the current count as `<b>{count() > 0}</b>` would.
    if (isLivePropValue(attrName, value, state)) {
      props.push(t.objectMethod('get', propKey(attrName), [], t.blockStatement([t.returnStatement(value)])));
      live = true;
      continue;
    }

    props.push(t.objectProperty(propKey(attrName), value));
  }

  flushProps();

  let propsExpr;
  if (parts.length === 0) {
    propsExpr = t.nullLiteral();
  } else if (parts.length === 1 && t.isObjectExpression(parts[0])) {
    // A lone object literal (no spread, or an inline `{...}`) is already a
    // fresh props object. A lone identifier/member/call spread is the
    // CALLER'S object and goes through the merge below. One holding a getter
    // is the component's own, taken as it is so its getters stay live
    // (render.js ownProps): it is marked (`_$marked({ ... })`, the mark
    // hidden). Not built with no prototype: setting a prototype in place gives
    // each object a hidden class of its own in V8 (prop reads about 13x
    // slower). Not marked in the literal (`[_$props]: true`) either: V8 builds
    // every property after a computed key one at a time, and the mark is then
    // hidden in place.
    propsExpr = live ? markedProps(parts[0], state) : parts[0];
  } else {
    // Merged in source order, getters kept: a wrapper's `{...props}` stays
    // live (render.js _$merge).
    propsExpr = t.callExpression(helper(state, '_$merge'), parts.map((part) => (
      t.isObjectExpression(part) && part.properties.some((p) => t.isObjectMethod(p)) ? withoutPrototype(part) : part
    )));
  }

  if (slots.length > 0) {
    propsExpr = t.callExpression(helper(state, '_$slots'), [
      t.isNullLiteral(propsExpr) ? t.objectExpression([]) : propsExpr,
      t.objectExpression(slots),
    ]);
  }

  const childrenArg = transformComponentChildren();
  // Children, or JSX in a prop, are built where the component reads them
  // (render.js lazyProps). A module with neither imports the call that
  // installs no lazy getter (renderExport).
  if (slots.length > 0 || !isEmptyArray(childrenArg)) state.needsLazyProps = true;
  // And one whose every component is a plain function imports the call that
  // does not look for a class component.
  const scope = path.scope ?? state.file?.path?.scope;
  const plain = isPlainFunctionComponent(scope, openingElement.name);
  if (!plain) state.classComponents = true;
  // A tag held in a binding can name a form field (render.js tagComponent).
  const holdsTag = !plain && mayHoldTag(scope, openingElement.name);
  if (holdsTag) state.carriesFields = true;

  const componentArgs = [componentRef, propsExpr, childrenArg];
  const meta = componentMetadata(node, state);
  // Hydratable output gives the component the number of the JSX that renders
  // it (lists.js listSlot), the server target's too: its place among the keyed
  // rows (what-core hydration-data.js). The root handed to hydrate() has none,
  // as the page the server renders has none.
  const site = state.hydratable && !isHydrateRoot ? listSlot(node) : null;
  if (site !== null || (meta && state.hydratable && !isHydrateRoot)) componentArgs.push(site ?? t.unaryExpression('void', t.numericLiteral(0)));
  if (meta) componentArgs.push(meta);
  // The root handed to hydrate() arrives unbuilt; one whose tag may be a
  // string claims the server's element when hydrate() runs it.
  const vnodeCall = holdsTag ? '_$hcomponentVNode' : '_$componentVNode';
  let call = t.callExpression(helper(state, isHydrateRoot ? vnodeCall : '_$createComponent'), componentArgs);
  // A component placed in SVG or MathML is told so, for a tag held in a
  // binding that it builds (render.js _$inNs). Not one this module defines
  // whose JSX, and that of the components it calls, names no such tag: the
  // compiler places its elements itself.
  if (node._whatPlacedNs !== undefined && !isHydrateRoot && node._whatMayBuildTag !== false) {
    call = t.callExpression(helper(state, '_$inNs'), [t.numericLiteral(node._whatPlacedNs), t.arrowFunctionExpression([], call)]);
  }
  // A key outside a list that can change (lists.js liveKey): a reactive
  // child that builds the component again whenever the key's value changes
  // (render.js _$keyed).
  const key = isHydrateRoot ? null : liveKey(node, state);
  if (key !== null) call = t.callExpression(helper(state, '_$keyed'), [t.arrowFunctionExpression([], key), t.arrowFunctionExpression([], call)]);
  return call;
}

// Whether the component JSX tag `name` names can build a tag held in a
// binding: anything but What's own and a function this module defines whose
// JSX names only elements and such functions. Read before any JSX is lowered
// (babel-plugin.js marks each component element, `_whatMayBuildTag`).
export function mayBuildTag(scope, name, seen = new Set()) {
  if (!t.isJSXIdentifier(name) || scope == null) return true;
  const binding = scope.getBinding(name.name);
  if (!binding || !binding.constant) return true;
  const node = binding.path.node;
  if (binding.kind === 'module') return !(t.isImportSpecifier(node) && FRAMEWORK_SOURCES.has(binding.path.parent.source.value));
  const fn = t.isFunctionDeclaration(node) ? binding.path : t.isVariableDeclarator(node) && t.isFunction(node.init) ? binding.path.get('init') : null;
  if (fn === null) return true;
  if (seen.has(fn.node)) return false;
  seen.add(fn.node);
  let found = false;
  fn.traverse({
    JSXOpeningElement(el) {
      if (found || !isComponentElement(el.node)) return;
      if (mayBuildTag(el.scope, el.node.name, seen)) found = true;
    },
  });
  return found;
}

// `_$inNs(ns, () => call)`: the call it places.
function placedCall(node, state) {
  return t.isCallExpression(node) && t.isIdentifier(node.callee) && helperLocals(state).get('_$inNs') === node.callee.name
    && t.isArrowFunctionExpression(node.arguments[1]) ? node.arguments[1].body : node;
}

// An expression that only reads: names, member reads and literals, and the
// operators over them. No call (but a keyed row's read of its item, which the
// compiler wrote), no `new`, no assignment, no JSX, no function: evaluating it
// once more changes nothing, and it creates nothing that would need an owner.
function isPlainRead(node) {
  switch (node.type) {
    case 'Identifier':
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
      return true;
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return isPlainRead(node.object) && (!node.computed || isPlainRead(node.property));
    case 'TemplateLiteral':
      return node.expressions.every(isPlainRead);
    case 'UnaryExpression':
      return node.operator !== 'delete' && isPlainRead(node.argument);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return isPlainRead(node.left) && isPlainRead(node.right);
    case 'ConditionalExpression':
      return isPlainRead(node.test) && isPlainRead(node.consequent) && isPlainRead(node.alternate);
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
      return isPlainRead(node.expression);
    case 'CallExpression':
      return node.callee._whatRowItem === true;
    default:
      return false;
  }
}

// Whether a component prop is passed live, as a getter over its value: an
// expression that reads a signal (a call, `props.x`, a store's member),
// never a name (an accessor handed on as `count={count}` stays the accessor),
// a literal, a function, `ref` or `children`.
function isLivePropValue(name, value, state) {
  // `children={label()}` is the children, as React reads it: live like any
  // other prop (dom.js _place shows it as a reactive child), so children a
  // wrapper forwards through its rest follow the parent's state.
  if (name === 'ref') return false;
  let expr = value;
  while (t.isTSAsExpression(expr) || t.isTSSatisfiesExpression(expr) || t.isTSNonNullExpression(expr) || t.isTSTypeAssertion(expr)) expr = expr.expression;
  // A template literal with holes is not a literal here (Babel's isLiteral
  // counts it): `label={`Hi ${props.name}`}` reads what its holes read.
  const literal = t.isLiteral(expr) && !(t.isTemplateLiteral(expr) && expr.expressions.length > 0);
  if (t.isIdentifier(expr) || literal || t.isFunction(expr) || t.isJSXElement(expr) || t.isJSXFragment(expr)) return false;
  return isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers);
}

// `{ __proto__: null, ... }`: a props object with no prototype, which the
// runtime takes as the component's own (render.js ownProps, _$merge).
function withoutPrototype(literal) {
  literal.properties.unshift(t.objectProperty(t.identifier('__proto__'), t.nullLiteral()));
  return literal;
}

// `_$marked({ ... })`: the component's own props object, a plain one What's
// runtime recognises by its mark (render.js ownProps), so its getters stay
// live props.
function markedProps(literal, state) {
  return t.callExpression(helper(state, '_$marked'), [literal]);
}

// JSX, or a conditional that renders JSX in one of its branches.
function isJsxValue(node) {
  if (t.isJSXElement(node) || t.isJSXFragment(node)) return true;
  if (t.isConditionalExpression(node)) return isJsxValue(node.consequent) || isJsxValue(node.alternate);
  return t.isLogicalExpression(node) && isJsxValue(node.right);
}

function isPlacingRead(node) {
  return t.isCallExpression(node) && node.callee._whatPlace === true;
}

// A value that renders JSX it builds: JSX, a condition with JSX in a branch,
// an array literal holding some, or a `.map()` / `.flatMap()` whose callback
// returns some (`items={links.map((l) => <li>{l}</li>)}`).
function yieldsJsx(node) {
  if (t.isJSXElement(node) || t.isJSXFragment(node)) return true;
  if (t.isConditionalExpression(node)) return yieldsJsx(node.consequent) || yieldsJsx(node.alternate);
  if (t.isLogicalExpression(node)) return yieldsJsx(node.right);
  if (t.isArrayExpression(node)) return node.elements.some((m) => m !== null && yieldsJsx(t.isSpreadElement(m) ? m.argument : m));
  if (!(t.isCallExpression(node) || t.isOptionalCallExpression(node))) return false;
  const callee = node.callee;
  if (!(t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) || callee.computed
      || !t.isIdentifier(callee.property) || (callee.property.name !== 'map' && callee.property.name !== 'flatMap')) return false;
  const fn = node.arguments[0];
  return (t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn)) && returnsJsx(fn);
}

// Whether a function's result renders JSX it builds: its expression body, or
// one of its own return statements.
function returnsJsx(fn) {
  if (!t.isBlockStatement(fn.body)) return yieldsJsx(fn.body);
  let found = false;
  const visit = (node) => {
    if (found || node == null || typeof node.type !== 'string' || t.isFunction(node)) return;
    if (t.isReturnStatement(node) && node.argument != null && yieldsJsx(node.argument)) {
      found = true;
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] || []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  fn.body.body.forEach(visit);
  return found;
}

function transformForFineGrained(path, state) {
  const { node } = path;
  const attributes = node.openingElement.attributes;
  const children = node.children;

  // <For each={data} key={item => item.id}>{(item) => <Row />}</For>
  // → mapArray(data, (item) => ..., { key: item => item.id })
  //
  // <For> and .map() with a key prop compile to the same keyed rows: the
  // compiler lowers .map() to _$mapArray with the row reading its item through
  // an accessor, so a row keeps its DOM and follows an item replaced under the
  // same key, as a <For> row does. Saying so is a note on correct code,
  // printed only when asked for (the `verbose` option).
  if (process.env.NODE_ENV !== 'production' && state.opts?.verbose === true && !state.opts?.production) {
    const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
    if (!_forInfoWarned.has(fileName)) {
      _forInfoWarned.add(fileName);
      const loc = node.loc;
      const lineInfo = loc ? `:${loc.start.line}:${loc.start.column}` : '';
      console.info(
        `[what-compiler] <For> at ${fileName}${lineInfo}: consider using .map() with a key prop instead. ` +
        `The compiler lowers .map() to the same keyed rows: a row keeps its DOM, and its bindings follow ` +
        `an item replaced under the same key (an immutable update, a refetch).`
      );
    }
  }

  let eachExpr = null;
  let keyExpr = null;
  let fallbackExpr = null;
  for (const attr of attributes) {
    if (t.isJSXAttribute(attr)) {
      const name = getAttrName(attr);
      if (name === 'each') eachExpr = getAttributeValue(attr.value);
      else if (name === 'key') keyExpr = getAttributeValue(attr.value);
      else if (name === 'fallback') fallbackExpr = getAttributeValue(attr.value);
    }
  }

  if (!eachExpr) {
    console.warn('[what-compiler] <For> element missing "each" attribute.');
    return transformElementAsH(path, state);
  }

  let renderFn = null;
  for (const child of children) {
    if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      renderFn = child.expression;
      break;
    }
  }

  if (!renderFn) {
    console.warn('[what-compiler] <For> element missing render function child.');
    return transformElementAsH(path, state);
  }

  state.needsGeneralMapArray = true;

  // An expression that reads reactively is the list's accessor, as in any
  // other position: each={list()}, each={user()?.orders}. A plain name is
  // handed over as it is: a signal is an accessor already, and a prop or a
  // variable may hold an accessor or an array, both of which mapArray takes.
  if (!t.isIdentifier(eachExpr) && !t.isArrowFunctionExpression(eachExpr) && !t.isFunctionExpression(eachExpr) &&
      isPotentiallyReactive(eachExpr, state.signalNames, state.importedIdentifiers)) {
    eachExpr = t.arrowFunctionExpression([], buildEachValue(eachExpr, state));
  }

  // `_$mapArray(source, renderFn[, { key }])` — built from whichever source
  // expression the caller wants, because the fallback lowering below has to
  // read the source twice and therefore binds it to a const first.
  const buildMapArrayCall = (sourceExpr) => {
    const args = [sourceExpr, renderFn];
    if (keyExpr) {
      const options = [t.objectProperty(t.identifier('key'), keyExpr)];
      // A keyed <For> row reads its item with a call (`item()`), so only a
      // component in it can hold a plain field of the row.
      if (rowHoldsPlainFields(renderFn)) options.push(rowFieldsOption(state));
      const slot = listSlot(node);
      if (slot !== null) options.push(t.objectProperty(t.identifier('slot'), slot));
      args.push(t.objectExpression(options));
    }
    const list = t.callExpression(helper(state, '_$mapArray'), args);
    list._whatList = true;
    return list;
  };

  if (!fallbackExpr) {
    return buildMapArrayCall(eachExpr);
  }

  // The RUNTIME For (packages/core/src/components.js) implements `fallback`,
  // so the compiled form does too: an app that moves from a buildless setup
  // to the Vite compiler keeps its empty state.
  //
  // mapArray has no fallback of its own, and the obvious lowering — gate the
  // WHOLE thing on emptiness, `() => empty() ? _$mapArray(...) : fallback` —
  // is a trap. `insert()` has a fast path for a mapArray inserter: it
  // recognises `child._mapArray` and installs the list ONCE for the life of
  // the component. A thunk is not that, so the gated form falls through to
  // the generic reactive branch, whose effect calls the thunk again on every
  // flip and gets a BRAND NEW inserter each time. Nothing disposes the old
  // one, so it stays subscribed to the source forever: every empty -> fill
  // cycle permanently adds one more live list. Measured row-render-fn calls
  // per two writes, over successive cycles, went 2 -> 9 -> 16 -> 23 while
  // logging "NotFoundError: The child can not be found in the parent" from
  // the orphans reconciling against the detached fragment they captured. The
  // DOM stayed correct, which is why it looked fine.
  //
  // So keep the list permanent and give the fallback its OWN inserter beside
  // it, both anchored to the same marker:
  //     _$insert(el, _$mapArray(each, fn), marker)          // permanent
  //     _$insert(el, () => empty() ? null : fallback, marker)
  // Only one of the two ever has content, and each reconciles independently.
  //
  // This function has to return a single expression, and a <For> can land in
  // a component's return, an element child, a component prop or a fragment.
  // Rather than teach all of those to emit two inserts, wrap the pair in one
  // inserter that performs both when it is mounted, and copy the list's own
  // marker properties onto it with Object.assign so it IS a mapArray inserter
  // to every consumer: `insert`, `createDOM`, `hydrateNode` and the server's
  // `_mapArrayToArray` all key off `_mapArray` and the `_mapArraySource` /
  // `_mapArrayFn` / `_mapArrayKeyed` trio. Object.assign copies exactly the
  // own enumerable properties mapArray sets, so this keeps working if the
  // runtime adds another one.
  //
  // Two more things this has to get right:
  //  - The source expression is evaluated ONCE and shared, so the list and
  //    the emptiness test can never disagree about which list they see.
  //  - The emptiness test is MEMOIZED, so a write that leaves the list
  //    non-empty does not re-run the fallback thunk and rebuild its DOM.
  if (!state._pendingSetup) state._pendingSetup = [];
  const eachId = uniqueName(state, '_each$');
  const listId = uniqueName(state, '_for$');
  const fallbackId = uniqueName(state, '_fb$');
  const emptyId = state.nextMemoId();

  // `each` is an accessor or an array, as mapArray takes either: the
  // emptiness test resolves it the same way.
  const resolvedId = path.scope
    ? path.scope.generateUidIdentifier('list')
    : t.identifier('_list');
  const resolveList = t.conditionalExpression(
    t.binaryExpression('===',
      t.unaryExpression('typeof', t.identifier(eachId)),
      t.stringLiteral('function')
    ),
    t.callExpression(t.identifier(eachId), []),
    t.identifier(eachId)
  );

  state._pendingSetup.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(t.identifier(eachId), eachExpr)
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(emptyId),
        t.callExpression(helper(state, '_$memo'), [
          t.arrowFunctionExpression([], t.blockStatement([
            t.variableDeclaration('const', [
              t.variableDeclarator(resolvedId, resolveList)
            ]),
            t.returnStatement(
              t.unaryExpression('!', t.unaryExpression('!',
                t.logicalExpression('&&',
                  t.cloneNode(resolvedId),
                  t.memberExpression(t.cloneNode(resolvedId), t.identifier('length'))
                )
              ))
            )
          ]))
        ])
      )
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(t.identifier(listId), buildMapArrayCall(t.identifier(eachId)))
    ]),
    // The fallback thunk is hoisted rather than written inline in the
    // inserter below so that the inserter's body mentions no user code at
    // all. Its parameters can then be given fixed names without any risk of
    // capturing an identifier the fallback expression wanted from an outer
    // scope — this function is also called with a synthetic `{ node }` path
    // that carries no scope to generate a unique name from.
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(fallbackId),
        t.arrowFunctionExpression([], t.conditionalExpression(
          t.callExpression(t.identifier(emptyId), []),
          t.nullLiteral(),
          fallbackExpr
        ))
      )
    ])
  );

  // The fallback goes in as an array (below), which only insert() takes.
  state.needsGeneralInsert = true;
  const parentParam = t.identifier('_parent');
  const markerParam = t.identifier('_marker');
  const endId = t.identifier('_end');
  return t.callExpression(
    t.memberExpression(t.identifier('Object'), t.identifier('assign')),
    [
      t.arrowFunctionExpression(
        [parentParam, markerParam],
        t.blockStatement([
          // The list goes in first so its `<!--/list-->` end marker sits
          // BEFORE the fallback: rows render above the empty state, and the
          // return value stays the end marker every other mapArray inserter
          // hands back.
          t.variableDeclaration('const', [
            t.variableDeclarator(endId, t.callExpression(t.identifier(listId), [
              t.cloneNode(parentParam),
              t.cloneNode(markerParam)
            ]))
          ]),
          // The thunk is wrapped in an ARRAY on purpose. `insert()` has two
          // ways to mount a function and only one of them survives here:
          //  - passed bare, it takes insert's own reactive branch, whose
          //    effect closes over the `parent` it was handed. When this
          //    inserter is mounted through createDOM (a <For> as a component's
          //    return value, at a fragment root, or inside a <Show> arm)
          //    that parent is a throwaway DocumentFragment which is emptied
          //    into the real container straight after. Every later run then
          //    reconciles against a detached node, so the fallback was never
          //    removed once rows arrived and stayed on screen underneath them.
          //  - wrapped in an array, it goes through valuesToNodes -> createDOM,
          //    whose reactive branch re-reads `endMarker.parentNode` on every
          //    run. That is the same live-parent resolution mapArray does for
          //    exactly this reason, so both halves survive being moved.
          t.expressionStatement(t.callExpression(helper(state, '_$insert'), [
            t.cloneNode(parentParam),
            t.arrayExpression([t.identifier(fallbackId)]),
            t.cloneNode(markerParam)
          ])),
          t.returnStatement(t.cloneNode(endId))
        ])
      ),
      t.identifier(listId),
      // Hydratable output also hands over the fallback, which hydrate()
      // adopts beside the list's rows (render.js adoptList).
      ...(state.hydratable ? [t.objectExpression([t.objectProperty(t.identifier('_fallback'), t.identifier(fallbackId))])] : []),
    ]
  );
}

function transformShowFineGrained(path, state) {
  // <Show when={cond} fallback={alt}>{content}</Show>
  // → () => cond() ? content : (fallback || null)
  // This compiles to a reactive expression that insert() wraps in an effect.
  const { node } = path;
  const attributes = node.openingElement.attributes;
  const children = node.children;

  let whenExpr = null;
  let fallbackExpr = null;
  for (const attr of attributes) {
    if (t.isJSXAttribute(attr)) {
      const name = getAttrName(attr);
      if (name === 'when') whenExpr = getAttributeValue(attr.value);
      else if (name === 'fallback') fallbackExpr = getAttributeValue(attr.value);
    }
  }

  if (!whenExpr) {
    // <Show> without a when prop has no defined semantics — fail loudly at
    // build time so the user fixes their source instead of seeing runtime
    // confusion. compileError pins the message to the JSX location from
    // either a real NodePath or the synthetic `{ node }` a parent transform
    // passes; calling path.buildCodeFrameError directly crashed on the
    // second, which is the shape almost every real <Show> arrives as.
    throw compileError(
      path,
      state,
      '<Show> requires a "when" prop. Example: <Show when={isOpen} fallback={null}>...</Show>'
    );
  }

  // The content: a render function written as the only child
  // ({(value) => <div>{value}</div>}), or the children themselves, text,
  // expressions, elements and fragments alike, as in a <Match> arm.
  let contentExpr = renderFunctionChild(children);

  if (!contentExpr) {
    // Content children — collect and transform them.
    //
    // The arm's element setup belongs INSIDE the arm, exactly as it does for
    // a <Match> arm (see the identical splice in transformSwitchFineGrained).
    // transformElementFineGrained pushes `const _el$N = _tmpl$X()` and every
    // binding it needs into state._pendingSetup, and _pendingSetup is drained
    // next to the thunk this function returns. So without the splice the arm
    // was built, and its bindings ran, alongside the enclosing component:
    //   <Show when={user}><p>{() => user().name}</p></Show>
    // threw at first render with a null user, and logged an uncaught effect
    // error on every transition back to falsy because the binding stayed
    // subscribed. Uncompiled, the same JSX is lazy — children of the runtime
    // Show really are deferred — so this was a compiled-vs-runtime
    // divergence, not just a bug.
    if (!state._pendingSetup) state._pendingSetup = [];
    const setupMark = state._pendingSetup.length;
    contentExpr = collectControlFlowContent(children, state);
    const setup = state._pendingSetup.splice(setupMark);
    if (setup.length > 0) {
      contentExpr = t.callExpression(
        t.arrowFunctionExpression([], t.blockStatement([...setup, t.returnStatement(contentExpr)])),
        []
      );
    }
  }

  // Build:
  //   () => { const _v = <condition>; return _v ? <consequent> : <alternate>; }
  // Hoisting into a local prevents double-evaluation of the `when` signal
  // (the consequent's render callback also needs the resolved value).
  let condition = buildWhenCondition(whenExpr, state);

  const vId = path.scope
    ? path.scope.generateUidIdentifier('v')
    : t.identifier('_v');

  const contentIsFn = t.isFunction(contentExpr);
  const consequent = contentIsFn
    ? t.callExpression(contentExpr, [t.cloneNode(vId)])
    : contentExpr;
  // A ternary fallback picks its arm by a lazy memo of its own, read only
  // while the fallback shows (memoizeTernaryTree).
  if (!state._pendingSetup) state._pendingSetup = [];
  const alternate = (fallbackExpr && memoizeTernaryTree(fallbackExpr, state._pendingSetup, state)) || fallbackExpr || t.nullLiteral();

  // Branch memoization: route a reactive `when` through an
  // equality-gated memo so the insert effect only re-fires (recreating the
  // taken branch's DOM) when the condition actually changes — not on every
  // write to a signal the condition happens to read.
  //  - Render-function children receive the resolved value (`{v => ...}`),
  //    so the memo is VALUE-gated (Object.is): identity changes re-render,
  //    matching pre-memo semantics.
  //  - Static children only use the value for truthiness → gate on !!cond
  //    so e.g. `when={items().length}` doesn't re-render on 2 → 3.
  if (isPotentiallyReactive(condition, state.signalNames, state.importedIdentifiers)) {
    const condId = state.nextMemoId();
    const memoBody = contentIsFn
      ? condition
      : t.unaryExpression('!', t.unaryExpression('!', condition));
    if (!state._pendingSetup) state._pendingSetup = [];
    state._pendingSetup.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(condId),
          t.callExpression(helper(state, '_$memo'), [
            t.arrowFunctionExpression([], memoBody)
          ])
        )
      ])
    );
    condition = t.callExpression(t.identifier(condId), []);
  }

  return t.arrowFunctionExpression([], t.blockStatement([
    t.variableDeclaration('const', [
      t.variableDeclarator(vId, condition)
    ]),
    t.returnStatement(
      t.conditionalExpression(t.cloneNode(vId), consequent, alternate)
    )
  ]));
}

function collectControlFlowContent(children, state) {
  const parts = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = normalizeJsxText(child.value);
      if (text) parts.push({ expr: t.stringLiteral(text), setup: [] });
    } else if (t.isJSXExpressionContainer(child)) {
      // The lowering an element's or a fragment's expression child gets: a
      // reactive one is a reactive child of its own, as the server renders it.
      if (!t.isJSXEmptyExpression(child.expression)) parts.push(arrayMember(state, () => lowerFragmentExprChild(child.expression, state)));
    } else if (t.isJSXElement(child)) {
      parts.push(arrayMember(state, () => transformElementFineGrained({ node: child }, state)));
    } else if (t.isJSXFragment(child)) {
      parts.push(arrayMember(state, () => transformFragmentFineGrained({ node: child }, state)));
    }
  }
  if (parts.length === 0) return t.nullLiteral();
  if (parts.length === 1) return parts[0].expr;
  return membersArray(parts, state, false, true);
}

function transformSwitchFineGrained(path, state) {
  // <Switch fallback={alt}><Match when={a}>A</Match><Match when={b}>B</Match></Switch>
  // → () => a ? A : b ? B : alt
  //
  // Same reactive-thunk shape <Show> lowers to, for the same reason: the
  // component runs once, so the arm has to be picked inside a thunk that
  // insert() re-evaluates. The runtime Switch matches on Match marker vnodes,
  // which _$createComponent never produces (calling Match instead recurses),
  // so compiled JSX has no working runtime path. readSwitch decides whether the
  // <Switch> is What's and reads its arms.
  const read = readSwitch(path, state);
  if (read === null) return transformComponentFineGrained(path, state);
  const { arms, fallback: fallbackExpr } = read;

  if (!state._pendingSetup) state._pendingSetup = [];
  const branches = [];

  for (const { when: whenExpr, children } of arms) {
    // An arm's element setup belongs inside the arm. Hoisting it next to the
    // thunk, the way a lone element does, would build every arm's DOM on the
    // way to picking one.
    const setupMark = state._pendingSetup.length;
    let content = collectControlFlowContent(children, state);
    const setup = state._pendingSetup.splice(setupMark);
    if (setup.length > 0) {
      content = t.callExpression(
        t.arrowFunctionExpression([], t.blockStatement([...setup, t.returnStatement(content)])),
        []
      );
    }

    branches.push([buildWhenCondition(whenExpr, state), content]);
  }

  const anyReactive = branches.some(([condition]) =>
    isPotentiallyReactive(condition, state.signalNames, state.importedIdentifiers));

  // A ternary fallback picks its arm by a lazy memo of its own, read only
  // when no arm matches (memoizeTernaryTree).
  const fallback = (fallbackExpr && memoizeTernaryTree(fallbackExpr, state._pendingSetup, state)) || fallbackExpr || t.nullLiteral();

  if (!anyReactive) {
    let expr = fallback;
    for (let i = branches.length - 1; i >= 0; i--) {
      expr = t.conditionalExpression(branches[i][0], branches[i][1], expr);
    }
    return t.arrowFunctionExpression([], expr);
  }

  // ONE memo over the whole chain, not one per arm. _$memo evaluates its body
  // immediately, so a memo per arm would evaluate every arm's `when` up front,
  // while the runtime Switch stops at the first match. A single memo that
  // resolves to the winning arm's index keeps that short-circuit (`when` props
  // after the first truthy one are never read) and still gates re-rendering on
  // the selected arm actually changing.
  let selector = t.numericLiteral(-1);
  for (let i = branches.length - 1; i >= 0; i--) {
    selector = t.conditionalExpression(branches[i][0], t.numericLiteral(i), selector);
  }

  const armId = state.nextMemoId();
  state._pendingSetup.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(armId),
        t.callExpression(helper(state, '_$memo'), [t.arrowFunctionExpression([], selector)])
      )
    ])
  );

  let expr = fallback;
  for (let i = branches.length - 1; i >= 0; i--) {
    expr = t.conditionalExpression(
      t.binaryExpression('===', t.callExpression(t.identifier(armId), []), t.numericLiteral(i)),
      branches[i][1],
      expr
    );
  }
  return t.arrowFunctionExpression([], expr);
}

// A fragment-as-root returns an array (or single value) that the runtime
// mounts element-by-element (createDOM / insert). Unlike the element-child
// path there's no host element to _$insert into with a marker, so reactive
// children must instead be emitted as `() => expr` arrows — the runtime's
// createDOM/insert treat a function array-item as a reactive binding (it
// wraps it in an effect with comment markers). Without this, a bare dynamic
// expression like `{count()}` is evaluated exactly once and never updates.
//
// This applies the SAME lowering the element-child expression path uses:
//  - tryLowerMapToMapArray for keyed `items().map(...)` → _$mapArray
//  - memoizeBranchCondition for reactive ternary/&&/|| (node-identity stable
//    branches: the taken branch's DOM is only rebuilt when the condition
//    actually flips, not on every read of a signal the condition touches)
//  - reactive expressions wrapped in `() =>` so the runtime tracks them
// Memo (_$memo) declarations are pushed into state._pendingSetup, which
// transformJsxRoot drains into the enclosing scope.
function lowerFragmentExprChild(expr, state) {
  if (!state._pendingSetup) state._pendingSetup = [];
  const setup = state._pendingSetup;

  // Auto-lower .map() to mapArray when the callback returns keyed JSX.
  const mapResult = tryLowerMapToMapArray(expr, state);
  if (mapResult) {
    // A bare _$mapArray(...) is a self-managing inserter and an arrow is
    // already reactive — emit as-is. A ternary/logical wrapping the call
    // keeps its condition reactive via a () => wrapper (and memoization).
    const isBareMapArray = isListInserterCall(mapResult);
    const isArrowAlready = t.isArrowFunctionExpression(mapResult);
    if (isArrowAlready && t.isExpression(mapResult.body)) {
      mapResult.body = memoizeBranchCondition(mapResult.body, setup, state);
      return mapResult;
    }
    if (isBareMapArray) return mapResult;
    const memoized = memoizeBranchCondition(mapResult, setup, state);
    return t.arrowFunctionExpression([], memoized);
  }

  // mapArray() calls are self-managing inserters — pass directly.
  if (isListInserterCall(expr)) {
    adoptMapArrayCall(expr, state);
    return expr;
  }

  if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
    // Branch memoization (C1): conditional/logical children only rebuild the
    // taken branch's DOM when the condition actually flips.
    expr = memoizeBranchCondition(expr, setup, state);
    return t.arrowFunctionExpression([], orderedRows(expr, state, true));
  }

  // Static — emit verbatim.
  return orderedRows(expr, state, false);
}

// In hydratable output, the arrays an expression child places, built so that
// they claim the server's nodes in document order (_$members). `bracketed`:
// the child is a reactive one, whose array value the server writes markers
// around; the array an element's hole holds directly it writes none for.
//   - an array literal with JSX among its members: the elements claim as the
//     literal is evaluated, and the other members are adopted where they
//     stand;
//   - an unkeyed `.map()` whose rows are components, in a reactive child: each
//     row component claims as the call creates it, before the array the rows
//     make is placed, so it would take the markers the server wrote around
//     that array for its own. _$members enters them first.
function orderedRows(expr, state, bracketed) {
  if (!state.hydratable) return expr;
  if (t.isArrayExpression(expr) && expr.elements.some(isJsxValue) && expr.elements.every((m) => m !== null && !t.isSpreadElement(m))) {
    const body = [];
    const items = expr.elements.map((member, i) => {
      const id = t.identifier(uniqueName(state, '_m$'));
      // Its JSX is built where it stands (isInPlace).
      member._whatInPlace = true;
      placeFlat(member);
      const value = t.isJSXElement(member) && !lowersToRegion(member, state) ? member : t.callExpression(helper(state, '_$member'), [member, t.numericLiteral(i)]);
      body.push(t.variableDeclaration('const', [t.variableDeclarator(id, value)]));
      return t.cloneNode(id);
    });
    body.push(t.returnStatement(t.arrayExpression(items)));
    const args = [t.arrowFunctionExpression([], t.blockStatement(body))];
    if (!bracketed) args.push(t.numericLiteral(1));
    return t.callExpression(helper(state, '_$members'), args);
  }
  if (t.isConditionalExpression(expr)) {
    expr.consequent = orderedRows(expr.consequent, state, bracketed);
    expr.alternate = orderedRows(expr.alternate, state, bracketed);
    return expr;
  }
  if (t.isLogicalExpression(expr)) {
    expr.right = orderedRows(expr.right, state, bracketed);
    return expr;
  }
  if (!bracketed || !t.isCallExpression(expr) || !t.isMemberExpression(expr.callee) || expr.callee.computed
      || !t.isIdentifier(expr.callee.property, { name: 'map' })) return expr;
  const fn = expr.arguments[0];
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) return expr;
  let row = fn.body;
  if (t.isBlockStatement(row)) {
    const last = row.body[row.body.length - 1];
    row = t.isReturnStatement(last) ? last.argument : null;
  }
  if (!t.isJSXElement(row) || !isComponentElement(row)) return expr;
  return t.callExpression(helper(state, '_$members'), [t.arrowFunctionExpression([], expr)]);
}

// Whether JSX lowers to what claims only where it is placed, not where it is
// created: <For>, <Show> and <Switch> (transformElementFineGrained) are a list
// or a reactive child.
function lowersToRegion(node, state) {
  const flow = controlFlowTag(node, state);
  return flow === 'For' || flow === 'Show' || flow === 'Switch' || (flow === null && isComponentElement(node) && liveKey(node, state) !== null);
}

function transformFragmentFineGrained(path, state) {
  const { node } = path;
  const children = node.children;

  const members = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = normalizeJsxText(child.value);
      if (text) members.push({ expr: t.stringLiteral(text), setup: [] });
    } else if (t.isJSXExpressionContainer(child)) {
      if (!t.isJSXEmptyExpression(child.expression)) {
        members.push(arrayMember(state, () => lowerFragmentExprChild(child.expression, state)));
      }
    } else if (t.isJSXElement(child)) {
      members.push(arrayMember(state, () => transformElementFineGrained({ node: child }, state)));
    } else if (t.isJSXFragment(child)) {
      members.push(arrayMember(state, () => transformFragmentFineGrained({ node: child }, state)));
    }
  }

  if (members.length === 1) return members[0].expr;
  // The server renders a fragment as the array a Fragment returns, which it
  // brackets, unless it is a member of an array other code builds.
  const nested = path.parentPath ? followsOtherMarkers(path) : false;
  return membersArray(members, state, nested, !nested);
}

// Whether the fragment at `path` is a member of an array other code builds:
// a row a callback returns (`.map(x => <>…</>)`) or a member of an array
// literal. The server brackets that array before the fragment.
function followsOtherMarkers(path) {
  let p = path;
  for (;;) {
    const parent = p.parentPath;
    if (!parent || parent.isArrayExpression()) return parent !== null;
    if (parent.isReturnStatement() || (parent.isArrowFunctionExpression() && p.key === 'body')) {
      const fn = parent.isReturnStatement() ? parent.getFunctionParent() : parent;
      return fn !== null && fn.parentPath.isCallExpression() && fn.listKey === 'arguments';
    }
    const climbs = (parent.isConditionalExpression() && p.key !== 'test')
      || (parent.isLogicalExpression() && p.key === 'right')
      || parent.isParenthesizedExpression() || parent.isTSAsExpression() || parent.isTSNonNullExpression();
    if (!climbs) return false;
    p = parent;
  }
}

// --- Arrays, hydrated in order ---
// While hydrating, an element or a component claims the server's nodes when
// it is created, and an array's other members (text, a reactive child, a
// list, a value) are adopted when the array is placed, after all of them
// were created. An array literal written after its members' setup therefore
// claims out of document order where such a member stands before one that
// claims when created, or where a member's setup claims before an earlier
// member claims inline: the server's nodes go to the wrong members, and the
// page shows them in the wrong order. A hydratable build builds that array
// with _$members, which creates the members in order and adopts each one
// that does not claim when created where it stands (_$member).

// A member of an array: its expression and the statements transforming it
// added to _pendingSetup.
function arrayMember(state, transform) {
  if (!state._pendingSetup) state._pendingSetup = [];
  const mark = state._pendingSetup.length;
  const expr = transform();
  return { expr, setup: state._pendingSetup.slice(mark) };
}

// The array of `members`, whose setup is the end of _pendingSetup.
// `nested`: it follows the markers of an array other code builds.
// `bracketed`: the server writes its markers around it (a conditional's
// content, the value of a reactive child), before those of a component in it.
// `always`: built with _$members whatever the order its members claim in.
function membersArray(members, state, nested = false, bracketed = false, always = false) {
  if (state.hydratable) for (const m of members) placeFlat(m.expr);
  if (!state.hydratable || !(always || claimsOutOfOrder(members, state, nested, bracketed))) return t.arrayExpression(members.map((m) => m.expr));
  const own = members.reduce((n, m) => n + m.setup.length, 0);
  state._pendingSetup.splice(state._pendingSetup.length - own, own);
  const body = [];
  const items = members.map((m, i) => {
    body.push(...m.setup);
    if (t.isIdentifier(m.expr) && createdClaims(m, state)) return m.expr;
    const id = t.identifier(uniqueName(state, '_m$'));
    // JSX inside the member is still built where it stands (isInPlace).
    m.expr._whatInPlace = true;
    const value = createdClaims(m, state) ? m.expr : t.callExpression(helper(state, '_$member'), [m.expr, t.numericLiteral(i)]);
    body.push(t.variableDeclaration('const', [t.variableDeclarator(id, value)]));
    return t.cloneNode(id);
  });
  body.push(t.returnStatement(t.arrayExpression(items)));
  const args = [t.arrowFunctionExpression([], t.blockStatement(body))];
  if (nested) args.push(t.numericLiteral(1));
  return t.callExpression(helper(state, '_$members'), args);
}

function claimsOutOfOrder(members, state, nested, bracketed) {
  // An array _$members builds among the members takes its own markers, so
  // this one must have taken its own before; so does a component in an array
  // the server brackets, whose output may be such an array.
  if (members.some((m) => isMembersCall(m.expr, state))) return true;
  if (bracketed && members.length > 1 && members.some((m) => isComponentCall(m.expr, state))) return true;
  // The other code builds its next members before it places this one.
  if (nested && members.some((m) => !createdClaims(m, state))) return true;
  // An earlier member is adopted only when the array is placed; an earlier
  // member claims as the literal is evaluated.
  let placed = false;
  let inline = false;
  for (const m of members) {
    const setupClaims = m.setup.some((stmt) => containsClaim(stmt, state));
    const inlineClaims = claimsInline(m.expr);
    if ((placed && (setupClaims || inlineClaims)) || (inline && setupClaims)) return true;
    if (!createdClaims(m, state)) placed = true;
    if (inlineClaims) inline = true;
  }
  return false;
}

// The placing reads (_$place) a value holds where it is placed: placed in an
// element's hole, or as a member of a fragment or an array, they are placed
// where the server writes their members in place, with no markers of their
// own (dom.js _place).
function placeFlat(expr) {
  if (t.isConditionalExpression(expr)) {
    placeFlat(expr.consequent);
    placeFlat(expr.alternate);
  } else if (t.isLogicalExpression(expr)) {
    placeFlat(expr.left);
    placeFlat(expr.right);
  } else if (t.isCallExpression(expr) && expr.callee._whatPlace === true && expr.arguments.length === 2) {
    expr.arguments.push(t.numericLiteral(1));
  }
}

const CLAIMING = ['_$claim', '_$claimControl', '_$createComponent', '_$members'];

function isMembersCall(node, state) {
  return t.isCallExpression(node) && t.isIdentifier(node.callee) && helperLocals(state).get('_$members') === node.callee.name;
}

// A call to one of the runtime helpers compiled output imports.
function isHelperCall(node, state) {
  if (!t.isIdentifier(node.callee)) return false;
  for (const local of helperLocals(state).values()) if (local === node.callee.name) return true;
  return false;
}

function isComponentCall(node, state) {
  node = placedCall(node, state);
  return t.isCallExpression(node) && t.isIdentifier(node.callee) && helperLocals(state).get('_$createComponent') === node.callee.name;
}

function isClaimCall(node, state) {
  node = placedCall(node, state);
  return t.isCallExpression(node) && t.isIdentifier(node.callee)
    && CLAIMING.some((name) => helperLocals(state).get(name) === node.callee.name);
}

function containsClaim(node, state) {
  let found = false;
  t.traverseFast(node, (n) => { if (!found && isClaimCall(n, state)) found = true; });
  return found;
}

// Whether creating the member claims everything it renders: an element, a
// component, or an array _$members builds.
function createdClaims(m, state) {
  if (isClaimCall(m.expr, state)) return true;
  return t.isIdentifier(m.expr) && m.setup.some((stmt) => t.isVariableDeclaration(stmt)
    && stmt.declarations.some((d) => t.isIdentifier(d.id, { name: m.expr.name }) && isClaimCall(d.init, state)));
}

// Whether evaluating `expr` can claim: anything but a literal, a function, a
// name or a list's inserter.
function claimsInline(expr) {
  return !(t.isLiteral(expr) || t.isFunction(expr) || t.isIdentifier(expr) || isListInserterCall(expr));
}

// Closing tags at the very end of a template: end of input closes them.
const TRAILING_CLOSE_TAGS = /(?:<\/[a-zA-Z][\w:.-]*>)+$/;

// Template deduplication: same markup → same module-level const.
//
// An SVG or MathML root other than <svg>/<math> itself only parses in its
// namespace inside one, so the compiler wraps it and flags the template (2):
// the runtime clones the wrapper's only child.
// Flag credit: Solid 2.0's template flags (MIT, Ryan Carniato).
function getOrCreateTemplate(state, html, ns, rootTag) {
  let flag = 0;
  if (ns === 'svg' && rootTag !== 'svg') {
    html = `<svg>${html}</svg>`;
    flag = 2;
  } else if (ns === 'math' && rootTag !== 'math') {
    html = `<math>${html}</math>`;
    flag = 2;
  }
  html = html.replace(TRAILING_CLOSE_TAGS, '');
  const dedupKey = `${flag}:${html}`;
  if (state.templateMap.has(dedupKey)) {
    return state.templateMap.get(dedupKey);
  }
  const id = uniqueName(state, '_tmpl$');
  state.templateMap.set(dedupKey, id);
  state.templates.push({ id, html, flag });
  return id;
}

// Shared driver for top-level JSX roots (elements AND fragments).
//
// transformElementFineGrained does NOT emit IIFEs: it pushes setup
// statements (`const _el$N = _tmpl$X(); _el$N.$$click = ...; _$insert(...)`)
// into state._pendingSetup and returns the bare `_el$N` identifier. Whoever
// visits the JSX root is responsible for draining _pendingSetup and placing
// those statements somewhere the returned reference can see them.
//
// The JSXElement and JSXFragment visitors both use this driver, so a fragment
// whose element children have dynamic parts (event handlers, dynamic
// attrs/children) declares the _el$N variables those parts reference. Branch
// memo and specialized-setter statements ride in _pendingSetup too.
export function transformJsxRoot(path, state) {
  enterJsxRoot(path, state);
  state._pendingSetup = [];
  state._selectorIds = new Map();
  const outside = state.hydratable && !isInPlace(path, state);
  const transform = t.isJSXFragment(path.node) ? transformFragmentFineGrained : transformElementFineGrained;
  const transformed = transform(path, state);
  const pending = state._pendingSetup;
  state._pendingSetup = [];
  if (state._selectorDecls.length > 0) {
    pending.unshift(...state._selectorDecls);
    state._selectorDecls = [];
  }

  // Hydratable output: JSX built before it is placed is built on the client
  // while hydrating, and replaces the server's copy where it lands.
  if (outside) {
    pending.push(t.returnStatement(transformed));
    path.replaceWith(t.callExpression(helper(state, '_$outside'), [t.arrowFunctionExpression([], t.blockStatement(pending))]));
    return;
  }

  if (pending.length > 0) {
    // Find the enclosing statement to hoist setup before it,
    // but only if it's in the SAME function scope. Crossing into
    // an inner arrow/function (e.g., .map(item => <JSX/>)) would
    // hoist references to closure variables out of scope.
    let stmtPath = path;
    let crossedFunctionBoundary = false;
    // Setup hoisted out of a guard runs whether the guard opens or not.
    // `return user() && <p>{user().name}</p>` is the React shape everybody
    // writes, and hoisting built the <p> and ran `() => user().name` at
    // mount, so the very first render threw on a null user. Same for a
    // ternary arm and for a guarded arm sitting in a component prop.
    // A guarded arm has to be CONSTRUCTED INSIDE its guard, which is exactly
    // what the IIFE path below does.
    let crossedGuard = false;
    while (stmtPath && !stmtPath.isStatement()) {
      if (stmtPath.isArrowFunctionExpression() || stmtPath.isFunctionExpression()) {
        crossedFunctionBoundary = true;
      }
      if (isConditionallyEvaluated(stmtPath)) crossedGuard = true;
      stmtPath = stmtPath.parentPath;
    }
    // We can safely hoist setup as siblings of `stmtPath` ONLY if
    // `stmtPath` lives inside a statement list (BlockStatement.body or
    // Program.body). For single-statement positions like
    // `if (cond) return <jsx/>;` or `while (x) return <jsx/>;`,
    // Babel's `insertBefore` wraps the parent into a block lazily and
    // multi-statement inserts end up split across scopes, leaving the
    // `_$insert(_el$N, ...)` call outside the block that declares
    // `const _el$N`. This is a TDZ/ReferenceError at runtime.
    //
    // To guarantee that ALL setup statements and the returned reference
    // share one lexical block, require that `stmtPath.listKey` points
    // at a statement list. Otherwise fall through to the IIFE path,
    // which is always safe.
    const inStatementList =
      stmtPath
      && stmtPath.isStatement()
      && (stmtPath.listKey === 'body' || stmtPath.listKey === 'consequent')
      && Array.isArray(stmtPath.container);
    if (inStatementList && !crossedFunctionBoundary && !crossedGuard) {
      // Same function scope — safe to hoist setup before the enclosing
      // statement. Works for return statements too: `insertBefore`
      // places setup above `return <jsx/>` without wrapping in an IIFE.
      stmtPath.insertBefore(pending);
      path.replaceWith(transformed);
    } else if (path.parentPath.isArrowFunctionExpression() && path.key === 'body') {
      // The JSX is an arrow's whole body (`row => <tr>…</tr>`): the arrow
      // takes a block body, which is the same scope and placement an IIFE
      // would give, without a closure and a call per evaluation.
      pending.push(t.returnStatement(transformed));
      path.replaceWith(t.blockStatement(pending));
    } else {
      // Crossed a function boundary or a guard, or no enclosing statement
      // was found — fall back to IIFE, which keeps closure variables in
      // scope AND keeps the construction where the source put it.
      pending.push(t.returnStatement(transformed));
      path.replaceWith(
        t.callExpression(
          t.arrowFunctionExpression([], t.blockStatement(pending)),
          []
        )
      );
    }
  } else {
    path.replaceWith(transformed);
  }
}


// Whether a JSX root is evaluated where it renders, so that a hydratable
// build can claim the server's nodes for it as it is built: returned (from a
// function, or as an arrow's body, e.g. a component, a row or a region
// thunk), or the value of a hole the compiler placed (_whatInPlace), through
// conditionals, logical operators and array literals. What a callback a call
// takes returns (`links.map((l) => <li />)`) is where that call is: in place
// in a hole, built before it is placed in a variable. Anything else (a
// variable, an attribute that is not a slot, an argument) is built before it
// is placed.
function isInPlace(path, state) {
  let p = path;
  for (;;) {
    const parent = p.parentPath;
    if (!parent) return false;
    if (p.node._whatInPlace) return true;
    /** @type {any} */
    let fn = null;
    if (parent.isReturnStatement()) fn = parent.getFunctionParent();
    else if (parent.isArrowFunctionExpression() && p.key === 'body') fn = parent;
    if (fn !== null) {
      // A function the runtime calls where it renders (a component, a row, a
      // region, a children factory, a slot) places what it returns.
      const call = fn.parentPath;
      if (fn.listKey !== 'arguments' || !(call.isCallExpression() || call.isOptionalCallExpression()) || isHelperCall(call.node, state)) return true;
      p = call;
      continue;
    }
    const climbs = (parent.isConditionalExpression() && p.key !== 'test')
      || (parent.isLogicalExpression() && p.key === 'right')
      || (parent.isSequenceExpression() && p.key === parent.node.expressions.length - 1)
      || parent.isArrayExpression()
      || parent.isParenthesizedExpression()
      || parent.isTSAsExpression() || parent.isTSNonNullExpression() || parent.isTypeCastExpression()
      || (parent.isJSXExpressionContainer() && parent.parentPath.isJSXElement());
    if (!climbs) return false;
    p = parent;
  }
}

// --- Program setup and teardown ---

export function initDomState(state) {
  // A module whose every list is a keyed .map() imports the keyed-only list
  // entry; <For> and hand-written mapArray() need the general one.
  state.needsGeneralMapArray = false;
  // A module none of whose component calls hands over children or JSX in a
  // prop imports the component call that installs no lazy getter.
  state.needsLazyProps = false;
  // A module whose every insert is of a function written in the hole imports
  // the reactive region insert() would hand it to.
  state.needsGeneralInsert = false;
  // A module that calls a component which may be a class component (one
  // whose prototype has render(): anything but a plain function the module
  // can see, isPlainFunctionComponent) imports the call that runs one.
  state.classComponents = false;
  // A module whose JSX writes a prop of a select or an option installs the
  // selection code (_$selects()).
  state.makesSelects = false;
  // A module whose JSX has an SVG element with an XLink or XML attribute
  // (`xlinkHref`, `xmlLang`) or a spread installs their writer (_$xlink()).
  state.writesXlink = false;
  // A module whose JSX can build a form field installs the carrying of what
  // the user changed before hydration (_$carryFields(), buildsField).
  state.carriesFields = false;
  // A component reads a field of a prop in its run (common.js markPropFieldReads).
  state.marksPropFields = false;
  state._selectorDecls = [];
  state._selectorIds = new Map();
  state.delegatedEvents = new Set();
  state.templates = [];
  state.templateMap = new Map(); // html → template id (deduplication)
  // The readers of keyed rows' plain fields (`r => r.label`), hoisted to the
  // module so a row allocates none.
  state.rowFieldReaders = [];
  state._pendingSetup = [];
  state.nextVarId = () => uniqueName(state, '_el$');
  state.nextMemoId = () => uniqueName(state, '_c$');
  // Output a page that a server rendered can hydrate (render.js _$claim).
  state.hydratable = state.opts?.hydratable === true;
}

// The runtime helpers compiled DOM output imports, in the order their import
// specifiers are written. `null` takes the export name from the module state.
const RENDER_IMPORTS = [
  // The compiler-internal `_$template`, never the public `template`, which
  // dev-warns for hand-written calls with dynamic strings.
  // Hydratable output takes `_$htemplate`, which also hands claims the root.
  ['_$template', null],
  ['_$insert', null],
  ['_$effect', 'effect'],
  ['_$mapArray', null],
  ['_$item', '_$item'],
  ['_$field', '_$field'],
  ['_$hfield', '_$hfield'],
  ['_$plain', '_$plain'],
  ['_$hplain', '_$hplain'],
  ['_$rowFields', '_$rowFields'],
  ['_$propField', '_$propField'],
  ['_$createSelector', 'createSelector'],
  ['_$spread', '_$spread'],
  ['_$spreads', '_$spreads'],
  ['_$xlink', '_$xlink'],
  ['_$controlled', '_$controlled'],
  ['_$setProp', '_$setProp'],
  ['_$retype', '_$retype'],
  ['_$memo', '_$memo'],
  ['_$lazyMemo', '_$lazyMemo'],
  ['_$keyed', '_$keyed'],
  ['_$Island', '_$Island'],
  ['_$buildDiagnostics', '_$buildDiagnostics'],
  ['_$setClass', 'setClass'],
  ['_$className', 'className'],
  ['_$setClassList', 'setClassList'],
  ['_$applyRef', 'applyRef'],
  ['_$setStyle', 'setStyle'],
  ['_$setAttr', 'setAttr'],
  ['_$setValue', '_$setValue'],
  ['_$setChecked', 'setChecked'],
  ['_$createComponent', null],
  ['_$componentVNode', '_$componentVNode'],
  ['_$hcomponentVNode', '_$hcomponentVNode'],
  ['_$delegateEvents', 'delegateEvents'],
  ['_$changes', '_$changes'],
  ['_$own', '_$own'],
  ['_$on', 'on'],
  ['_$claim', '_$claim'],
  ['_$next', '_$next'],
  ['_$control', '_$control'],
  ['_$claimControl', '_$claimControl'],
  ['_$skip', '_$skip'],
  ['_$hole', '_$hole'],
  ['_$exit', '_$exit'],
  ['_$outside', '_$outside'],
  ['_$members', '_$members'],
  ['_$member', '_$member'],
  ['_$slots', '_$slots'],
  ['_$place', '_$place'],
  ['_$merge', '_$merge'],
  ['_$marked', '_$marked'],
  ['_$omit', '_$omit'],
  ['_$inNs', '_$inNs'],
  ['_$selects', '_$selects'],
  ['_$carryFields', '_$carryFields'],
];

// The export a helper whose RENDER_IMPORTS entry is null imports.
function renderExport(name, state) {
  if (name === '_$mapArray') return state.needsGeneralMapArray ? 'mapArray' : '_$mapKeyed';
  if (name === '_$template') return state.hydratable ? '_$htemplate' : '_$template';
  if (name === '_$insert') return state.needsGeneralInsert ? 'insert' : '_$reactive';
  // A module whose every component is a plain function imports the call that
  // looks for neither a class component nor a tag held in a binding (render.js
  // asComponent).
  if (state.hydratable) return state.classComponents ? '_$hcreateComponent' : '_$hcreateFn';
  if (state.needsLazyProps) return state.classComponents ? '_$createComponent' : '_$createLazyFn';
  return state.classComponents ? '_$createLeaf' : '_$createFn';
}

// The components of what-framework itself, which are functions: its root
// entry's, and its router's.
const FRAMEWORK_SOURCES = new Set(['what-framework', 'what-core', 'what-framework/router', 'what-router']);

// Whether the component a JSX tag names is a plain function, which a class
// component (a prototype with render() or isReactComponent, render.js
// _toFunctionComponent) can never be: an arrow function the module defines
// (the bridge would construct it, which throws for an arrow, whatever its
// prototype holds), a function the module defines, does not export and uses
// only in JSX (so nothing can give its prototype a render()), and a component
// imported from what-framework. In every case the binding is never
// reassigned.
function isPlainFunctionComponent(scope, name) {
  if (!t.isJSXIdentifier(name) || scope == null) return false;
  const binding = scope.getBinding(name.name);
  if (!binding || !binding.constant) return false;
  const decl = binding.path;
  if (binding.kind === 'module') {
    return t.isImportSpecifier(decl.node) && FRAMEWORK_SOURCES.has(decl.parent.source.value);
  }
  /** @type {any} */
  let fn = null;
  if (t.isFunctionDeclaration(decl.node)) fn = decl.node;
  else if (t.isVariableDeclarator(decl.node) && (t.isArrowFunctionExpression(decl.node.init) || t.isFunctionExpression(decl.node.init))) fn = decl.node.init;
  if (fn === null || fn.async || fn.generator) return false;
  if (t.isArrowFunctionExpression(fn)) return true;
  // Another module could give an exported function a prototype with render().
  const statement = t.isVariableDeclarator(decl.node) ? decl.parentPath : decl;
  if (t.isExportNamedDeclaration(statement.parent) || t.isExportDefaultDeclaration(statement.parent)) return false;
  // A component call this compiler wrote is a tag too: Babel counts its
  // reference once the call stands in a function a later lowering made (the
  // element of a branch's arm, a key's build: render.js _$keyed).
  return binding.referencePaths.every((ref) => ref.node._whatTag === true || t.isJSXOpeningElement(ref.parent) || t.isJSXClosingElement(ref.parent));
}

// Whether a component tag may hold a string at run time (a tag held in a
// binding: a prop, a parameter, a variable), unlike a name, or a member of a
// name, that the module imports.
function mayHoldTag(scope, name) {
  let root = name;
  while (t.isJSXMemberExpression(root)) root = root.object;
  const binding = t.isJSXIdentifier(root) && scope != null ? scope.getBinding(root.name) : null;
  return binding?.kind !== 'module';
}

function isEmptyArray(node) {
  return t.isArrayExpression(node) && node.elements.length === 0;
}
const CORE_IMPORTS = ['h'];

export function finishDomProgram(path, state) {
  // Emit LAZY event delegation setup if any delegated events were used.
  // A bare module-top-level `_$delegateEvents([...])` call would be a side
  // effect that (a) keeps bundlers from tree-shaking modules whose components
  // are never used, and (b) attaches document listeners at import time even
  // when no component ever mounts.
  // Instead we emit a once-guarded helper that each element setup calls
  // at construction time; unused modules carry only dead declarations
  // that DCE removes.
  /** @type {any[] | null} */
  let delegation = null;
  if (state.delegatedEvents.size > 0) {
    // onChange (`$$change`) is React's change event, which its own install
    // delegates (what-core render.js _$changes): a module without one carries
    // none of its code.
    const events = [...state.delegatedEvents].filter(e => e !== 'change');
    const install = [];
    if (events.length > 0) {
      install.push(t.expressionStatement(
        t.callExpression(helper(state, '_$delegateEvents'), [t.arrayExpression(events.map(e => t.stringLiteral(e)))])
      ));
    }
    if (state.delegatedEvents.has('change')) {
      install.push(t.expressionStatement(t.callExpression(helper(state, '_$changes'), [])));
    }
    // function _$delegate$(el) { _$own(el); if (_$delegated$) return; _$delegated$ = true; _$delegateEvents([...]); _$changes(); }
    const helperFn = t.functionDeclaration(
      helper(state, '_$delegate$'),
      [t.identifier('el')],
      t.blockStatement([
        t.expressionStatement(t.callExpression(helper(state, '_$own'), [t.identifier('el')])),
        t.ifStatement(
          helper(state, '_$delegated$'),
          t.returnStatement()
        ),
        t.expressionStatement(
          t.assignmentExpression('=', helper(state, '_$delegated$'), t.booleanLiteral(true))
        ),
        ...install,
      ])
    );
    delegation = [
      t.variableDeclaration('let', [
        t.variableDeclarator(helper(state, '_$delegated$'), t.booleanLiteral(false))
      ]),
      helperFn,
    ];
  }

  // At module scope, so the code is installed before any of the module's
  // components builds a select.
  if (state.makesSelects) path.unshiftContainer('body', t.expressionStatement(t.callExpression(helper(state, '_$selects'), [])));
  if (state.writesXlink) path.unshiftContainer('body', t.expressionStatement(t.callExpression(helper(state, '_$xlink'), [])));
  if (state.carriesFields) path.unshiftContainer('body', t.expressionStatement(t.callExpression(helper(state, '_$carryFields'), [])));

  for (const reader of state.rowFieldReaders.reverse()) {
    path.unshiftContainer('body', t.variableDeclaration('const', [t.variableDeclarator(t.identifier(reader.id), reader.fn)]));
  }

  // Insert template declarations at top of program (hoisted to module scope)
  for (const tmpl of state.templates.reverse()) {
    // /* @__PURE__ */ marks the hoisted call as side-effect-free so
    // bundlers (esbuild/rollup/terser) can drop templates whose
    // components are tree-shaken away.
    const tmplCall = t.callExpression(helper(state, '_$template'), tmpl.flag
      ? [t.stringLiteral(tmpl.html), t.numericLiteral(tmpl.flag)]
      : [t.stringLiteral(tmpl.html)]);
    t.addComment(tmplCall, 'leading', ' @__PURE__ ');
    path.unshiftContainer('body',
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(tmpl.id), tmplCall)
      ])
    );
  }

  if (state._buildDiagnostics?.length) {
    const records = state._buildDiagnostics.map(diagnosticRecord);
    path.pushContainer('body', t.expressionStatement(t.callExpression(helper(state, '_$buildDiagnostics'), [t.arrayExpression(records)])));
  }

  const used = helperLocals(state);
  // Whether this module builds DOM (a template clone or a component call that
  // renders one), which a server bundle cannot run. The Vite plugin reads it.
  if (state.file?.metadata && (used.has('_$template') || used.has('_$createComponent'))) {
    state.file.metadata.whatBuildsDom = true;
  }
  const renderSpecifiers = [];
  for (const [name, exported] of RENDER_IMPORTS) {
    const local = used.get(name);
    if (local === undefined) continue;
    const imported = exported ?? renderExport(name, state);
    renderSpecifiers.push(t.importSpecifier(t.identifier(local), t.identifier(imported)));
  }
  addImports(path, renderSpecifiers, ['what-framework/render', 'what-core/render'], 'what-framework/render');

  const coreSpecifiers = [];
  for (const name of CORE_IMPORTS) {
    const local = used.get(name);
    if (local !== undefined) coreSpecifiers.push(t.importSpecifier(t.identifier(local), t.identifier(name)));
  }
  addImports(path, coreSpecifiers, ['what-core', 'what-framework'], 'what-framework');

  // First in the file, so `let _$delegated$ = false` executes before any
  // top-level component construction (e.g. a same-module mount()).
  if (delegation) path.unshiftContainer('body', delegation);
}
