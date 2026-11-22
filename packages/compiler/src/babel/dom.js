// The DOM back end: JSX lowered to cloned templates, fine-grained bindings and
// keyed list inserters (what-framework/render).

import { RAW_TEXT_ELEMENTS, INNER_HTML_PROPS, attributeName, markupName, isEnumeratedAttr } from 'what-core/internal/markup-rules';
import { t } from './types.js';
import {
  EVENT_OPTION_MODIFIERS, compileError, componentCallee, createEventHandler,
  getAttrName, getAttributeValue, getBindingProperty, hasEventModifiers, hasLiteralMatchArms,
  isBindingAttribute, isComponentElement, isConditionallyEvaluated, isDynamicAttr,
  isEventAttrName, isFieldProp, isForeignTag, isHydrateRootArgument, isShadowedAttr, isStaticChild,
  isVoidHtmlElement, normalizeJsxText, parseEventModifiers, propKey,
  addImports, helper, helperLocals, readSwitch, uniqueName,
  checkElementName, checkIslandProp, checkStaticAttribute, checkStaticRawText, directiveValue,
  renderFunctionChild,
} from './common.js';
import {
  buildEachValue, buildWhenCondition, isPotentiallyReactive, isSignalIdentifier, isUncertainReactive,
} from './reactivity.js';
import { enterJsxRoot } from './jsx-root.js';
import { bindingMetadata, componentMetadata } from './dev-metadata.js';
import { findMappedJsx, readItemThroughAccessor, rowField, withItem } from './lists.js';
import { hasNoSelectorPragma, lowerRowSelectors } from './auto-selector.js';


// Events that use document-level delegation for performance.
// The compiler emits `el.$$click = handler` instead of addEventListener.
// A one-time document listener walks event.target upward to find the handler.
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
function layoutChildren(children, withHtml, state, rawTag = null) {
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
  const keyFn = t.arrowFunctionExpression([itemParam], t.cloneNode(keyValue, true));

  // Build: _$mapArray(source, mapFn, { key: keyFn, follow: true }). A row that
  // reads its item for more than its key reads it through an accessor
  // (lists.js readItemThroughAccessor) and follows an item replaced under the
  // same key (mapArray's follow mode); a row that reads only the key gets the
  // raw item (`raw: true`).
  const follow = readItemThroughAccessor(mapFn, keyValue, () => helper(state, '_$item'), uniqueName(state, '_item$'), uniqueName(state, '_i$'));
  const list = t.callExpression(helper(state, '_$mapArray'), [
    source,
    mapFn,
    t.objectExpression([
      t.objectProperty(t.identifier('key'), keyFn),
      t.objectProperty(t.identifier(follow ? 'follow' : 'raw'), t.booleanLiteral(true)),
    ]),
  ]);
  list._whatList = true;
  return list;
}


// An attribute value written without quotes: non-empty, none of the characters
// that end or change an unquoted value, and no `&` (left to the quoted form).
const UNQUOTED_ATTR_VALUE = /^[^\s"'=<>`&]+$/;

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
    if (!attr.value) {
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
  return `${html}>${layoutChildren(node.children, true, state, rawTag).html}</${tagName}>`;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Analyze JSX tree and generate fine-grained output
export function transformElementFineGrained(path, state) {
  const { node } = path;
  const openingElement = node.openingElement;
  const tagName = openingElement.name.name;

  // Control flow components, checked before generic isComponent since they start uppercase.
  // A tag imported from somewhere other than What is that package's component,
  // whatever it is called, so it goes to the component path untouched, unless
  // its own arms prove otherwise.
  if (!isForeignTag(tagName, state)) {
    if (tagName === 'For') {
      return transformForFineGrained(path, state);
    }
    if (tagName === 'Show') {
      return transformShowFineGrained(path, state);
    }
  }
  if (tagName === 'Switch' && (!isForeignTag(tagName, state) || hasLiteralMatchArms(node))) {
    return transformSwitchFineGrained(path, state);
  }

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
  const rootFlags = (applyDynamicChildren(statements, elId, children, node, state) ? 1 : 0) | (writesContent(attributes) ? 2 : 0);
  if (state.hydratable && rootFlags !== 0) acquire.arguments.push(t.numericLiteral(rootFlags));

  // Instead of wrapping in an IIFE, store setup statements for hoisting.
  // The JSXElement visitor will insert them before the enclosing statement.
  if (!state._pendingSetup) state._pendingSetup = [];
  state._pendingSetup.push(...statements);
  return t.identifier(elId);
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

function applyDynamicAttrs(statements, elId, attributes, state, tagName, ns) {
  // Specialized monomorphic setters for statically-known attribute names.
  // The generic _$setProp re-dispatches on the key string
  // (ref/key/url/class/style/innerHTML/boolean/...) on EVERY reactive update;
  // when the compiler knows the name it emits the direct helper instead.
  // SECURITY: URL attributes (href/src/action/formaction) and innerHTML/
  // dangerouslySetInnerHTML intentionally fall through to _$setProp — URL
  // sanitization and the { __html } enforcement live there.
  function buildSetPropCall(propName, valueExpr) {
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
      return t.callExpression(helper(state, '_$setValue'), [t.identifier(elId), valueExpr]);
    }
    if (propName === 'checked' && tagName === 'input') {
      // Live property write — matches bind:checked semantics. (The old
      // setAttribute('checked') path only set the DEFAULT-checked state,
      // which stops reflecting once the user has toggled the input.)
      // A helper (not a raw `.checked =`) so function values still get
      // reactive-accessor treatment, like every other setter.
      return t.callExpression(helper(state, '_$setChecked'), [t.identifier(elId), valueExpr]);
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

  // Static attributes the template holds are already applied (isTemplateAttr).
  // The rest are set here, in source order, so the last write for a key wins
  // exactly as it does in the h() call.
  for (const [attrIndex, attr] of attributes.entries()) {
    if (t.isJSXSpreadAttribute(attr)) {
      statements.push(
        t.expressionStatement(
          t.callExpression(helper(state, '_$spread'), [t.identifier(elId), attr.argument])
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
      const event = attrName.slice(2).toLowerCase();
      const handler = getAttributeValue(attr.value);
      const metadata = bindingMetadata(tagName, attrName, attr, state);
      if (metadata) {
        statements.push(t.expressionStatement(t.assignmentExpression('=',
          t.memberExpression(t.identifier(elId), t.stringLiteral(`_$source_${event}`), true),
          metadata
        )));
      }

      if (DELEGATED_EVENTS.has(event)) {
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
            t.callExpression(helper(state, '_$on'), [t.identifier(elId), t.stringLiteral(event), handler])
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
      const event = eventName.slice(2).toLowerCase();

      const optionMods = modifiers.filter(m => EVENT_OPTION_MODIFIERS.has(m));
      const addEventArgs = [t.stringLiteral(event), wrappedHandler];
      if (optionMods.length > 0) {
        const optsProps = optionMods.map(m =>
          t.objectProperty(t.identifier(m), t.booleanLiteral(true))
        );
        addEventArgs.push(t.objectExpression(optsProps));
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
        const effectCall = bindingEffect(t.arrowFunctionExpression([], buildSetPropCall(domName, valueExpr)), domName, attr);
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

// If `expr` is a conditional (ternary / && / ||) with a reactive test and a
// DOM-producing branch, hoist the test into `const _c$N = _$memo(...)` (pushed
// onto `statements`) and return the expression rewritten to read the memo.
// Otherwise returns `expr` unchanged.
function memoizeBranchCondition(expr, statements, state) {
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
  return isTernary
    ? t.conditionalExpression(condRead, expr.consequent, expr.alternate)
    : t.logicalExpression(expr.operator, condRead, expr.right);
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
function applyDynamicChildren(statements, elId, children, parentNode, state) {
  const { entries } = layoutChildren(children, false, state);
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
  function insertCall(value, marker, node, placeholder) {
    if (hydratable) {
      flushSkip();
      stepped = true;
      // The value is placed where it is evaluated: its JSX claims (transformJsxRoot).
      value._whatInPlace = true;
      const flag = marker === undefined ? 3 : marker === null ? 2 : placeholder ? 1 : 0;
      const args = [t.identifier(elId), value, t.numericLiteral(flag)];
      const name = bindingMetadata(parentNode.openingElement.name.name, 'children', node, state);
      if (name) args.push(name);
      return t.callExpression(helper(state, '_$hole'), args);
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
    return t.callExpression(helper(state, '_$insert'), args);
  }

  // A plain field of a keyed row's item (`{row.label}`): a text node the
  // row's item cell writes (render.js _$field), read now from the item the
  // row is built from, with its reader hoisted to the module.
  function fieldCall(expr, root, marker, placeholder) {
    const id = uniqueName(state, '_f$');
    state.rowFieldReaders.push({ id, fn: t.arrowFunctionExpression([t.identifier('r')], withItem(expr, root, t.identifier('r'))) });
    const value = withItem(expr, root, t.identifier(root._whatRowItemName));
    const cell = t.cloneNode(root.arguments[0]);
    if (hydratable) {
      flushSkip();
      stepped = true;
      const flag = marker === undefined ? 3 : marker === null ? 2 : placeholder ? 1 : 0;
      return t.callExpression(helper(state, '_$hfield'), [t.identifier(elId), cell, value, t.numericLiteral(flag), t.identifier(id)]);
    }
    const at = marker === undefined ? t.unaryExpression('void', t.numericLiteral(0))
      : marker === null ? t.nullLiteral()
        : markerVars.has(marker) ? t.identifier(markerVars.get(marker)) : buildChildAccess(elId, marker);
    return t.callExpression(helper(state, '_$field'), [t.identifier(elId), cell, value, at, t.identifier(id)]);
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
        const value = hydratable && t.isIdentifier(expr) ? expr : t.arrowFunctionExpression([], expr);
        const call = insertCall(value, entry.marker, entry.node, entry.placeholder);
        if (isUncertainReactive(expr, state.signalNames, state.importedIdentifiers)) {
          t.addComment(call, 'leading',
            ' @what-dev: reactive wrapping may be unnecessary — expression contains a non-signal function call with reactive args ',
            false
          );
        }
        statements.push(t.expressionStatement(call));
      } else {
        statements.push(t.expressionStatement(insertCall(expr, entry.marker, entry.node, entry.placeholder)));
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
      const flags = (applyDynamicChildren(statements, childElRef, entry.node.children, entry.node, state) ? 1 : 0) | (writesContent(childEl.attributes) ? 2 : 0);
      if (flags !== 0) next.arguments.push(t.numericLiteral(flags));
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
      applyDynamicChildren(statements, childElRef, entry.node.children, entry.node, state);
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

function transformComponentFineGrained(path, state) {
  const { node } = path;
  const openingElement = node.openingElement;
  const componentRef = componentCallee(openingElement.name);
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
    const transformedChildren = [];
    let deferChildren = false;
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = normalizeJsxText(child.value);
        if (text) transformedChildren.push(t.stringLiteral(text));
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
          transformedChildren.push(lowerFragmentExprChild(child.expression, state));
        }
      } else if (t.isJSXElement(child)) {
        // <For>/<Show>/<Switch> lower to an inserter or a thunk (already lazy).
        const childTag = child.openingElement.name.name;
        if (childTag !== 'For' && childTag !== 'Show' && childTag !== 'Switch') deferChildren = true;
        transformedChildren.push(transformElementFineGrained({ node: child }, state));
      } else if (t.isJSXFragment(child)) {
        deferChildren = true;
        transformedChildren.push(transformFragmentFineGrained({ node: child }, state));
      }
    }

    let childrenArg = t.arrayExpression(transformedChildren);
    if (deferChildren) {
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

    // The directive's own machinery, kept apart from user data because it is
    // always applied LAST: `component` comes from the tag and `mode` from the
    // directive, so nothing a caller spreads in can reach either one.
    const directiveProps = [
      t.objectProperty(t.identifier('component'), componentRef),
      t.objectProperty(t.identifier('mode'), t.stringLiteral(clientDirective.type)),
    ];

    if (clientDirective.value) {
      directiveProps.push(t.objectProperty(t.identifier('mediaQuery'), clientDirective.value));
    }

    // User props in source order — same rule, and the same reasons, as the
    // regular component path below. An island IS a component, so
    // `<Chart client:load {...a} {...b} />` has to mean `{ ...a, ...b }` for
    // exactly the reason `<Chart {...a} {...b} />` does.
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
      // `data-x` and `aria-label` are not identifiers. Emitting one as a bare
      // key produced `{data-x: "1"}`, which is a SYNTAX ERROR: babel does not
      // validate what its builders are handed, so the compiler exited 0 and
      // wrote a file that no parser would accept. `<Chart client:load
      // aria-label="..." />` is an ordinary thing to write, and it took the
      // whole build down with an error pointing at generated output.
      //
      // The regular component branch below has always tested the name first;
      // this branch is the copy that did not.
      islandUserProps.push(t.objectProperty(propKey(attrName), value));
    }

    let islandPropsExpr;
    if (islandParts.length === 0) {
      // No spread anywhere: one object literal, directive keys written last so
      // they still win. This is the shape nearly every island has, and keeping
      // it a literal keeps the emitted output byte-identical to before.
      islandPropsExpr = t.objectExpression([...islandUserProps, ...directiveProps]);
    } else {
      flushIslandUserProps();
      islandPropsExpr = t.callExpression(
        t.memberExpression(t.identifier('Object'), t.identifier('assign')),
        [t.objectExpression([]), ...islandParts, t.objectExpression(directiveProps)]
      );
    }

    const islandArgs = [helper(state, '_$Island'), islandPropsExpr, transformComponentChildren()];
    const islandMeta = componentMetadata(node, state);
    if (islandMeta) islandArgs.push(islandMeta);
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

    let value = getAttributeValue(attr.value);
    // Hydratable output: a boundary's fallback JSX is built when the boundary
    // shows it, so a page that hydrates with the children showing builds none
    // and one that hydrates with the fallback showing claims the server's.
    // Both boundaries take a function fallback (ErrorBoundary calls it with
    // the error, which this one ignores).
    if (state.hydratable && attrName === 'fallback' && isWhatBoundary(openingElement.name, state)
        && (t.isJSXElement(value) || t.isJSXFragment(value))) {
      value = t.arrowFunctionExpression([], value);
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
    // CALLER'S object and must go through the copy below.
    propsExpr = parts[0];
  } else {
    propsExpr = t.callExpression(
      t.memberExpression(t.identifier('Object'), t.identifier('assign')),
      [t.objectExpression([]), ...parts]
    );
  }

  const childrenArg = transformComponentChildren();

  const componentArgs = [componentRef, propsExpr, childrenArg];
  const meta = componentMetadata(node, state);
  if (meta) componentArgs.push(meta);
  return t.callExpression(helper(state, isHydrateRoot ? '_$componentVNode' : '_$createComponent'), componentArgs);
}

function isWhatBoundary(name, state) {
  return t.isJSXIdentifier(name) && (name.name === 'Suspense' || name.name === 'ErrorBoundary') && !isForeignTag(name.name, state);
}

function transformForFineGrained(path, state) {
  const { node } = path;
  const attributes = node.openingElement.attributes;
  const children = node.children;

  // <For each={data} key={item => item.id}>{(item) => <Row />}</For>
  // → mapArray(data, (item) => ..., { key: item => item.id })
  //
  // NOTE: <For> is supported but .map() with a key prop is the preferred
  // pattern for list rendering. The compiler lowers .map() to _$mapArray with
  // the row reading its item through an accessor, so a row keeps its DOM and
  // follows an item replaced under the same key, as a <For> row does.
  if (process.env.NODE_ENV !== 'production') {
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
      args.push(t.objectExpression([
        t.objectProperty(t.identifier('key'), keyExpr)
      ]));
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
  const alternate = fallbackExpr || t.nullLiteral();

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
      if (text) parts.push(t.stringLiteral(text));
    } else if (t.isJSXExpressionContainer(child)) {
      if (!t.isJSXEmptyExpression(child.expression)) parts.push(child.expression);
    } else if (t.isJSXElement(child)) {
      parts.push(transformElementFineGrained({ node: child }, state));
    } else if (t.isJSXFragment(child)) {
      parts.push(transformFragmentFineGrained({ node: child }, state));
    }
  }
  if (parts.length === 0) return t.nullLiteral();
  if (parts.length === 1) return parts[0];
  return t.arrayExpression(parts);
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

  const fallback = fallbackExpr || t.nullLiteral();

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
    return t.arrowFunctionExpression([], expr);
  }

  // Static — emit verbatim.
  return expr;
}

export function transformFragmentFineGrained(path, state) {
  const { node } = path;
  const children = node.children;

  const transformed = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = normalizeJsxText(child.value);
      if (text) transformed.push(t.stringLiteral(text));
    } else if (t.isJSXExpressionContainer(child)) {
      if (!t.isJSXEmptyExpression(child.expression)) {
        transformed.push(lowerFragmentExprChild(child.expression, state));
      }
    } else if (t.isJSXElement(child)) {
      transformed.push(transformElementFineGrained({ node: child }, state));
    } else if (t.isJSXFragment(child)) {
      transformed.push(transformFragmentFineGrained({ node: child }, state));
    }
  }

  if (transformed.length === 1) return transformed[0];
  return t.arrayExpression(transformed);
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
  const outside = state.hydratable && !isInPlace(path);
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
// function, or as an arrow's body, e.g. a component, a .map() row or a region
// thunk), or the value of a hole the compiler placed (_whatInPlace), through
// conditionals, logical operators and array literals. Anything else (a
// variable, a prop other than children, an argument) is built before it is
// placed.
function isInPlace(path) {
  let p = path;
  for (;;) {
    const parent = p.parentPath;
    if (!parent) return false;
    if (p.node._whatInPlace) return true;
    if (parent.isReturnStatement()) return true;
    if (parent.isArrowFunctionExpression() && p.key === 'body') return true;
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
  ['_$insert', 'insert'],
  ['_$effect', 'effect'],
  ['_$mapArray', null],
  ['_$item', '_$item'],
  ['_$field', '_$field'],
  ['_$hfield', '_$hfield'],
  ['_$createSelector', 'createSelector'],
  ['_$spread', 'spread'],
  ['_$setProp', 'setProp'],
  ['_$memo', '_$memo'],
  ['_$Island', '_$Island'],
  ['_$setClass', 'setClass'],
  ['_$className', 'className'],
  ['_$setClassList', 'setClassList'],
  ['_$applyRef', 'applyRef'],
  ['_$setStyle', 'setStyle'],
  ['_$setAttr', 'setAttr'],
  ['_$setValue', 'setValue'],
  ['_$setChecked', 'setChecked'],
  ['_$createComponent', null],
  ['_$componentVNode', '_$componentVNode'],
  ['_$delegateEvents', 'delegateEvents'],
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
];

// The export a helper whose RENDER_IMPORTS entry is null imports.
function renderExport(name, state) {
  if (name === '_$mapArray') return state.needsGeneralMapArray ? 'mapArray' : '_$mapKeyed';
  if (name === '_$template') return state.hydratable ? '_$htemplate' : '_$template';
  return state.hydratable ? '_$hcreateComponent' : '_$createComponent';
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
    const eventArray = t.arrayExpression(
      [...state.delegatedEvents].map(e => t.stringLiteral(e))
    );
    // function _$delegate$(el) { _$own(el); if (_$delegated$) return; _$delegated$ = true; _$delegateEvents([...]); }
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
        t.expressionStatement(
          t.callExpression(helper(state, '_$delegateEvents'), [eventArray])
        ),
      ])
    );
    delegation = [
      t.variableDeclaration('let', [
        t.variableDeclarator(helper(state, '_$delegated$'), t.booleanLiteral(false))
      ]),
      helperFn,
    ];
  }

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
