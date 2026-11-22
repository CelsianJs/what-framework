// The front end both back ends share: how JSX is classified (element,
// component, control flow), how attribute names are normalized, the namespace
// every element is in, the child slots an element's children flatten to, and
// the hygienic names the generated code introduces.

import {
  HTML_ENCODINGS,
  INNER_HTML_PROPS,
  MATHML_IN_TEXT_POINTS,
  MATHML_TEXT_INTEGRATION_POINTS,
  SVG_HTML_INTEGRATION_POINTS,
  VOID_ELEMENTS,
  isRefusedAttr,
  isUnsafeUrl,
  isUrlAttr,
  attributeName,
  rawTextHazard,
  FIELD_PROPS,
  FIELD_TAGS,
  ATTRIBUTE_VALUE_TYPES,
} from 'what-core/internal/markup-rules';
import { t } from './types.js';

const EVENT_MODIFIERS = new Set(['preventDefault', 'stopPropagation', 'once', 'capture', 'passive', 'self']);
export const EVENT_OPTION_MODIFIERS = new Set(['once', 'capture', 'passive']);

// A bare specifier that resolves to this framework, entry point included:
// 'what-framework', 'what-framework/render', 'what-core', 'what-core/render'.
// Used to decide whether an imported binding is provably ours before the plugin
// changes how a call to it is compiled.
export function isWhatModuleSource(source) {
  return source === 'what-framework'
    || source.startsWith('what-framework/')
    || source === 'what-core'
    || source.startsWith('what-core/');
}

// Normalize JSX text per React/Babel rules:
//  - Split on newlines, treat tabs as spaces.
//  - For interior lines: trim leading and trailing horizontal whitespace.
//  - For the first line: only trim trailing whitespace.
//  - For the last line: only trim leading whitespace.
//  - Skip lines that are entirely whitespace (don't add a separator space).
//  - Join the remaining non-empty lines with single spaces.
//
// This preserves leading/trailing single-line whitespace that sits next to
// an expression like `{count} items` — without this, the space is eaten and
// the rendered output reads `5items`.
export function normalizeJsxText(value) {
  // Single-line text (no newlines): preserve the original (just tabs->spaces).
  // This keeps the space in cases like `{a} {b}` where the JSXText is " ".
  if (!/[\r\n]/.test(value)) {
    return value.replace(/\t/g, ' ');
  }
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i])) lastNonEmpty = i;
  }
  if (lastNonEmpty === -1) return '';
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, ' ');
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    if (!isFirst) line = line.replace(/^ +/, '');
    if (!isLast) line = line.replace(/ +$/, '');
    if (!line) continue;
    if (i !== lastNonEmpty) line += ' ';
    out += line;
  }
  return out;
}

// --- Generated names ---
//
// Every binding the compiler introduces (`_el$0`, `_tmpl$0`, `_c$0`, `_sel$0`,
// the `_$insert` style helper imports, ...) is unique in its file. The names
// the file already spells anywhere (bindings, references, globals, JSX tags)
// are collected in the one pass Program.enter makes before any JSX is lowered;
// a generated name skips every one of them. Counters are per prefix, so a file
// with no collision gets exactly the names it always did.

export function initFileState(state) {
  state._usedNames = new Set();
  state._nameCounters = new Map();
  state._helperNames = new Map();
}

export function recordName(state, name) {
  state._usedNames.add(name);
}

/** `_el$0`, `_el$1`, ... skipping any name the file already uses. */
export function uniqueName(state, prefix) {
  let n = state._nameCounters.get(prefix) || 0;
  let name = `${prefix}${n++}`;
  while (state._usedNames.has(name)) name = `${prefix}${n++}`;
  state._nameCounters.set(prefix, n);
  state._usedNames.add(name);
  return name;
}

/**
 * The local name of a runtime helper the generated code calls, as an
 * identifier: `name` itself unless the file already uses it, then `name2`,
 * `name3`, ... The back end emits one import specifier per helper it handed
 * out (see helperLocals).
 */
export function helper(state, name) {
  let local = state._helperNames.get(name);
  if (local === undefined) {
    local = name;
    for (let n = 2; state._usedNames.has(local); n++) local = `${name}${n}`;
    state._usedNames.add(local);
    state._helperNames.set(name, local);
  }
  return t.identifier(local);
}

/** The helpers `helper()` handed out, as [name, local] pairs in first-use order. */
export function helperLocals(state) {
  return state._helperNames;
}

// Warn-once tracking for unknown event modifier segments. Keyed by
// `${filename}::${segment}` so each typo is reported at most once per file
// per compile process. Without the filename in the key, the same typo in
// two different files would silently warn for the first file only —
// problematic in long-running Vite dev servers.
const _unknownModifierWarned = new Set();

export function hasEventModifiers(name, state) {
  // Any `__` in an `on*` attribute is intended as modifier syntax — even
  // if every segment is unknown. Returning false there would emit the
  // attribute as a plain delegated-event property (e.g.
  // `el.$$onclick__totalyWrong = handler`), which never fires. Instead,
  // always route through the modifier-handling branch so the parser can
  // warn about the typo and drop the unknown segments.
  if (!name.includes('__')) return false;
  if (!name.startsWith('on')) return false;
  const parts = name.split('__');
  const tail = parts.slice(1).filter(s => s !== '');
  if (tail.length === 0) return false;
  if (process.env.NODE_ENV !== 'production') {
    const unknown = tail.filter(m => !EVENT_MODIFIERS.has(m));
    const filename = (state && (state.filename || (state.file && state.file.opts && state.file.opts.filename))) || '<unknown>';
    for (const m of unknown) {
      const key = `${filename}::${m}`;
      if (!_unknownModifierWarned.has(key)) {
        _unknownModifierWarned.add(key);
        console.warn(
          `[what-compiler] Unknown event modifier "__${m}" in attribute "${name}" (${filename}). ` +
          `Known modifiers: ${[...EVENT_MODIFIERS].join(', ')}. ` +
          `Unknown segments are ignored.`
        );
      }
    }
  }
  return true;
}

export function parseEventModifiers(name) {
  // Support both '|' (template strings) and '__' (JSX-safe) as modifier delimiters
  const delimiter = name.includes('|') ? '|' : '__';
  const parts = name.split(delimiter);
  const eventName = parts[0];
  const modifiers = parts.slice(1).filter(m => EVENT_MODIFIERS.has(m));
  return { eventName, modifiers };
}

export function isBindingAttribute(name) {
  return name.startsWith('bind:');
}

export function getBindingProperty(name) {
  return name.slice(5);
}

export function isComponent(name) {
  return /^[A-Z]/.test(name);
}

// Build the Error for a JSX shape the compiler refuses to lower.
//
// Every fine-grained transform is reachable two ways: from the JSXElement
// visitor, where `path` is a real NodePath, and recursively from a parent
// transform, which passes a SYNTHETIC `{ node: child }` (see the
// transformElementFineGrained / transformFragmentFineGrained calls further
// down). Only the visitor's path carries buildCodeFrameError, so calling it
// unguarded threw "path.buildCodeFrameError is not a function" — an internal
// crash in place of the diagnostic the author was meant to act on. That hit
// the ordinary shapes, not the exotic ones: `<div><Show>…</Show></div>` is
// already synthetic, so only a control-flow tag that was the ENTIRE return
// value ever reported properly.
//
// Guarding the call is not enough either. `throw new Error(message)` reaches
// the developer, but with no file and no line, which for a build error in a
// 300-file app is barely better than the crash. state.file is Babel's File
// for the module being compiled and its buildCodeFrameError(node, msg) pins
// the frame from the node's own loc, so a synthetic path still gets the same
// pointed-at source the visitor path does.
export function compileError(path, state, message) {
  if (typeof path?.buildCodeFrameError === 'function') {
    return path.buildCodeFrameError(message);
  }
  const node = path?.node;
  if (node && typeof state?.file?.buildCodeFrameError === 'function') {
    return state.file.buildCodeFrameError(node, message);
  }
  // No NodePath and no File (a direct unit-test call, or a node the parser
  // never produced). Name the file and line by hand so the message still
  // says where to look.
  const loc = node?.loc?.start;
  const filename = state?.filename || state?.file?.opts?.filename || '<unknown>';
  return new Error(
    `[what-compiler] ${message} (${loc ? `${filename}:${loc.line}:${loc.column + 1}` : filename})`
  );
}

// A compile error that carries an ERR_* code and names its position as
// path:line:column (1-based column, path relative to projectRoot) in the
// message, with `loc` in the { file, line, column } form Vite's error overlay
// reads (0-based column, as Babel reports it).
export function codedCompileError(node, state, { code }, message) {
  const start = node.loc && node.loc.start;
  const file = String(state?.file?.opts?.filename || '<unknown>').replace(/\\/g, '/');
  const root = String(state?.opts?.projectRoot || state?.file?.opts?.cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const shown = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
  const where = start ? ` at ${shown}:${start.line}:${start.column + 1}` : '';
  const error = compileError({ node }, state, `${code}${where}: ${message}`);
  if (start) error.loc = { file, line: start.line, column: start.column };
  error.code = code;
  return error;
}

// --- Static markup ---
//
// A tag, attribute or text the source fixes is written into markup as it is:
// the DOM back end's template string, which the browser parses, and the server
// back end's string templates. So the markup rules the runtime applies to a
// value on every path (what-core's markup-rules.js) are applied to a static
// one here, as a compile error where it is written.

export function unsafeMarkup(node, state, message) {
  return codedCompileError(node, state, { code: 'ERR_UNSAFE_STATIC_MARKUP' }, message);
}

/** The JSX name of a tag as written: `div`, `Foo.Bar`, `svg:rect`. */
export function jsxTagName(name) {
  if (t.isJSXMemberExpression(name)) return `${jsxTagName(name.object)}.${name.property.name}`;
  if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
  return name.name;
}

// `<svg:rect>` is a JSX namespaced name, not an SVG element: markup has no
// namespace prefixes, and an element's namespace comes from where it stands.
export function checkElementName(node, state) {
  const name = node.openingElement.name;
  if (t.isJSXNamespacedName(name)) {
    throw unsafeMarkup(node, state,
      `<${jsxTagName(name)}> is a namespaced tag name, which markup does not have. Write <${name.name.name}> inside <${name.namespace.name}>.`);
  }
}

// A static attribute value: `value` is true for a valueless attribute, else the
// literal, or null/false when it writes nothing.
export function checkStaticAttribute(attr, key, name, value, state) {
  const present = value !== undefined && value !== null && value !== false;
  if (present && isRefusedAttr(key)) {
    throw unsafeMarkup(attr, state, key.toLowerCase() === 'srcdoc'
      ? 'srcdoc is parsed by the browser as a whole document, so escaping cannot make it safe; it is never written.'
      : `${key} replaces the element with its value parsed as markup, so escaping cannot make it safe; it is never written.`);
  }
  if (typeof value === 'string' && isUrlAttr(key) && isUnsafeUrl(value)) {
    throw unsafeMarkup(attr, state,
      `${key}=${JSON.stringify(value)} uses a javascript:, vbscript: or data: URL, which is never written.`);
  }
  if (present && INNER_HTML_PROPS.has(name)) {
    throw unsafeMarkup(attr, state,
      `${name} takes { __html: trustedString }, never a string, so markup cannot reach the page by accident.`);
  }
}

// Static text inside a <script> or <style>, which is written as it is: it must
// not hold a sequence that ends the element (what-core's rawTextHazard).
export function checkStaticRawText(node, tag, text, state) {
  if (rawTextHazard(tag, text)) {
    throw unsafeMarkup(node, state, tag === 'script'
      ? `the text of a <script> is written as it is, so it cannot contain "</" or "<!--", which can end the element. Write "<\\/" and "\\x3C!--" in a string, or pass the code as dangerouslySetInnerHTML={{ __html }}.`
      : `the text of a <style> is written as it is, so it cannot contain "</", which can end the element. Write "<\\/" in a string instead.`);
  }
}

// --- Islands and control flow, both back ends ---

// JSX inside an island prop, outside any function in it. Island props are
// serialized to JSON for the browser, and markup is not data.
function jsxInValue(node) {
  if (!node || typeof node !== 'object') return null;
  if (t.isJSXElement(node) || t.isJSXFragment(node)) return node;
  if (t.isFunction(node)) return null;
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const value = node[key];
    const found = Array.isArray(value) ? value.map(jsxInValue).find(Boolean) : jsxInValue(value);
    if (found) return found;
  }
  return null;
}

export function checkIslandProp(name, value, node, state) {
  const jsx = jsxInValue(value);
  if (!jsx) return;
  throw codedCompileError(jsx, state, { code: 'ERR_JSX_ISLAND_PROP' },
    `JSX is not an island prop: "${name}" of <${jsxTagName(node.openingElement.name)}> is serialized to JSON for the browser, and markup is not data. ` +
    'Pass it as a child of the island, or pass the data and build the markup inside the island.');
}

// `client:media="(min-width: 40em)"` or `client:media={query}`.
export function directiveValue(attr) {
  if (!attr.value) return null;
  if (t.isStringLiteral(attr.value)) return attr.value;
  if (t.isJSXExpressionContainer(attr.value) && !t.isJSXEmptyExpression(attr.value.expression)) return attr.value.expression;
  return null;
}

// The render function a <Show> or <For> child is: the only child that is not
// whitespace, written as a function. Null when the children are content.
export function renderFunctionChild(children) {
  const meaningful = children.filter(c => !(t.isJSXText(c) && !normalizeJsxText(c.value))
    && !(t.isJSXExpressionContainer(c) && t.isJSXEmptyExpression(c.expression)));
  if (meaningful.length !== 1) return null;
  const only = meaningful[0];
  return t.isJSXExpressionContainer(only) && t.isFunction(only.expression) ? only.expression : null;
}

// Dotted tags (<Ctx.Provider>, <Foo.Bar.Baz>) are always components.
export function isComponentElement(el) {
  const name = el.openingElement ? el.openingElement.name : el.name;
  if (t.isJSXMemberExpression(name)) return true;
  return t.isJSXIdentifier(name) && isComponent(name.name);
}

// A tag whose binding came from a package other than What. isWhatTag is the
// stronger claim: the binding came from What, so the tag is provably ours.
export function isForeignTag(name, state) {
  return !!(state.foreignImports && state.foreignImports.has(name));
}

function isWhatTag(name, state) {
  return !!(state.whatImports && state.whatImports.has(name));
}

// Literal <Match> arms are proof enough that a <Switch> is What's, whoever it
// was imported from: a bare specifier can be a re-export of What's control
// flow just as a relative one can, and nobody writes <Match> arms against a
// third-party <Switch>. Unlike <Show> and <For>, <Switch> has no working
// runtime path, so guessing wrong here renders the fallback forever.
export function hasLiteralMatchArms(node) {
  return node.children.some((child) =>
    t.isJSXElement(child) && t.isJSXIdentifier(child.openingElement.name, { name: 'Match' }));
}

// --- The JSX handed straight to hydrate() ---
//
// hydrate() can only adopt the server's markup from an UNBUILT tree: a node
// that has already been built has its bindings wired to itself, so hydrateNode
// inserts it and lets the trim delete everything the server sent. The
// documented client entry, `hydrate(<App />, el)`, lowered to
// `_$createComponent(App, ...)`, which runs App and builds its DOM before
// hydrate() is even called — so every compiled app that hydrated threw its
// server render away and re-rendered from scratch, silently in production
// where the warning is stripped.
//
// Only the first argument is the tree; the second is the container. And only a
// binding that provably resolves to OUR hydrate qualifies, because rewriting a
// call to somebody else's `hydrate` would change what their code means.
export function isHydrateRootArgument(path) {
  // transformElementFineGrained is also called with a bare `{ node }` stand-in
  // when it recurses into children, and a child is never the hydrate root.
  const parent = path.parentPath;
  if (!parent || typeof parent.isCallExpression !== 'function' || !parent.isCallExpression()) {
    return false;
  }
  if (parent.node.arguments[0] !== path.node) return false;
  return isWhatHydrateCallee(parent.node.callee, parent.scope);
}

// Resolve the callee through Babel's scope rather than by name, so a local
// `function hydrate()` or `const hydrate = ...` that shadows the import is left
// alone. getBinding returns the NEAREST binding, which is exactly the shadowing
// rule the language itself applies. An unresolved (global) `hydrate` is not
// ours either, so it stays untouched too.
function isWhatHydrateCallee(callee, scope) {
  // `ns.hydrate(...)` after `import * as ns from 'what-framework'`.
  if (t.isMemberExpression(callee) && !callee.computed
      && t.isIdentifier(callee.property, { name: 'hydrate' })
      && t.isIdentifier(callee.object)) {
    return importedFrom(scope.getBinding(callee.object.name), t.isImportNamespaceSpecifier, null);
  }
  if (!t.isIdentifier(callee)) return false;
  // `import { hydrate }` and `import { hydrate as boot }` alike: the binding
  // remembers the name that was IMPORTED, which is the one that matters.
  return importedFrom(scope.getBinding(callee.name), t.isImportSpecifier, 'hydrate');
}

// A binding is ours when it came from an import declaration of a What module
// through the expected specifier kind, optionally carrying a required imported
// name (`hydrate` for a named import, none for a namespace).
export function importedFrom(binding, isSpecifier, importedName) {
  if (!binding || binding.kind !== 'module' || !binding.path) return false;
  const spec = binding.path.node;
  if (!isSpecifier(spec)) return false;
  if (importedName !== null) {
    const imported = spec.imported;
    const name = t.isIdentifier(imported) ? imported.name
      : t.isStringLiteral(imported) ? imported.value
      : null;
    if (name !== importedName) return false;
  }
  const decl = binding.path.parent;
  return t.isImportDeclaration(decl) && isWhatModuleSource(decl.source.value);
}

// JSXMemberExpression -> MemberExpression callee for _$createComponent.
export function componentCallee(name) {
  if (t.isJSXMemberExpression(name)) {
    return t.memberExpression(componentCallee(name.object), t.identifier(name.property.name));
  }
  return t.identifier(name.name);
}

// --- Props a component only places ---
// Compiled JSX hands a component JSX as a getter that builds it when read:
// its children (dom.js _installLazyChildren), and the JSX it passes in any
// other prop (`header={<Nav />}`, _$slots). Destructuring such a prop, in
// the parameter list or from props in the body, reads it there, before the
// component's output exists: a boundary or a provider it is forwarded into
// is not entered yet (the boundary never catches, the provider publishes too
// late), and while hydrating the JSX is built off the walk and takes the
// place of the server's nodes for it. When every read of a destructured prop
// places it, each read becomes a placing read of `props.<key>` where it
// stands, which builds the JSX where it renders, as `props.children` written
// there does. A binding that is ever inspected (`children.length`,
// `Array.isArray(children)`, a truthiness test, a local alias) keeps its
// destructuring: inspecting builds the value.
//
// The DOM back end also marks a read of `props.<key>` written by hand where
// it is placed. A placing read is `_$place(props, "key")` (render.js), which
// the reactivity analysis treats as the property read it is; the server back
// end renders vnodes, which build where they are placed, and reads
// `props.<key>`.
export function deferPlacedProps(fnPath, state) {
  const params = fnPath.node.params;
  if (params.length !== 1 || isRowFunction(fnPath, state)) return;
  const param = params[0];
  if (t.isObjectPattern(param)) {
    const found = placedProps(fnPath, param, fnPath.scope, state);
    if (found === null || !movesIntoBody(fnPath, found.others)) return;
    const propsId = fnPath.scope.generateUidIdentifier('props');
    if (param.typeAnnotation) propsId.typeAnnotation = param.typeAnnotation;
    readAtUse(fnPath, found, propsId, state);
    params[0] = propsId;
    const declarators = otherProps(fnPath, found, propsId);
    if (declarators.length > 0) {
      if (!t.isBlockStatement(fnPath.node.body)) {
        fnPath.node.body = t.blockStatement([t.returnStatement(fnPath.node.body)]);
      }
      fnPath.node.body.body.unshift(t.variableDeclaration('const', declarators));
      // collectSignalNamesFromScope classifies a component's props by reading
      // the parameter list, so the moved pattern has to stay visible to it or
      // every sibling prop silently stops being treated as reactive.
      fnPath.node._whatMovedProps = t.objectPattern(found.others);
    }
  } else if (t.isIdentifier(param)) {
    const binding = fnPath.scope.getBinding(param.name);
    if (!binding || binding.constantViolations.length > 0) return;
    const rewrites = [];
    const reads = [];
    for (const ref of binding.referencePaths) {
      const decl = ref.parentPath;
      if (decl.isVariableDeclarator() && ref.key === 'init' && t.isObjectPattern(decl.node.id)) {
        // `const { children } = props` in the body.
        if (decl.parent.kind === 'var' || ref.getFunctionParent() !== fnPath) continue;
        const found = placedProps(fnPath, decl.node.id, decl.scope, state);
        if (found !== null) rewrites.push([decl, found]);
      } else if (!state.ssr && decl.isMemberExpression() && ref.key === 'object' && !t.isNumericLiteral(decl.node.property)
          && propertyName(decl.node.property, decl.node.computed) !== null && placesValue(decl, fnPath, state)) {
        reads.push(decl);
      }
    }
    if (rewrites.length === 0 && reads.length === 0) return;
    for (const [decl, found] of rewrites) {
      readAtUse(fnPath, found, param, state);
      const declarators = otherProps(fnPath, found, param);
      if (declarators.length > 0) decl.replaceWithMultiple(declarators);
      else decl.remove();
    }
    for (const read of reads) read.replaceWith(placingRead(param, propertyName(read.node.property, read.node.computed), state));
  } else {
    return;
  }
  fnPath.scope.crawl();
}

// A callback a method calls (`.map(row => …)`, `.then(…)`) or the row
// function of a <For>: its parameter is an item, not props, and the list
// lowerings read a row's fields themselves (lists.js).
function isRowFunction(fnPath, state) {
  const parent = fnPath.parentPath;
  if (parent.isCallExpression() && fnPath.listKey === 'arguments') return t.isMemberExpression(parent.node.callee) || t.isOptionalMemberExpression(parent.node.callee);
  return parent.isJSXExpressionContainer() && parent.parentPath.isJSXElement() && isLoweredTag(parent.parentPath.node, 'For', state);
}

// The properties of `pattern` whose every read places the value (`placed`:
// each with its key, binding and literal default), else null when there are
// none. `others` are the pattern's other properties, and `rest` its rest
// element.
function placedProps(fnPath, pattern, scope, state) {
  const counts = new Map();
  for (const prop of pattern.properties) {
    const name = t.isObjectProperty(prop) ? propertyName(prop.key, prop.computed) : null;
    if (name !== null) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const placed = [];
  const others = [];
  for (const prop of pattern.properties) {
    const entry = t.isObjectProperty(prop) ? placedProp(fnPath, prop, scope, state) : null;
    // A second key would still read the getter where it is destructured.
    if (entry !== null && counts.get(entry.key) === 1) placed.push(entry);
    else others.push(prop);
  }
  if (placed.length === 0) return null;
  const last = others[others.length - 1];
  const rest = t.isRestElement(last) ? last : null;
  // The rest object is built by naming the keys it leaves out.
  if (rest !== null && (!t.isIdentifier(rest.argument)
      || others.some((p) => t.isObjectProperty(p) && propertyName(p.key, p.computed) === null))) return null;
  return { placed, others, rest };
}

function placedProp(fnPath, prop, scope, state) {
  const key = propertyName(prop.key, prop.computed);
  if (key === null) return null;
  let local = prop.value;
  let fallback = null;
  if (t.isAssignmentPattern(local)) {
    fallback = local.right;
    local = local.left;
    // Evaluated where each read stands now, so only a value that is the
    // same wherever and however often it is evaluated.
    if (!isPlainLiteral(fallback, fnPath.scope)) return null;
  }
  if (!t.isIdentifier(local)) return null;
  const binding = scope.getBinding(local.name);
  if (!binding || binding.constantViolations.length > 0) return null;
  if (!binding.referencePaths.every((ref) => placesValue(ref, fnPath, state))) return null;
  return { key, binding, fallback };
}

function propertyName(key, computed) {
  if (t.isIdentifier(key) && !computed) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  return t.isNumericLiteral(key) ? String(key.value) : null;
}

function isPlainLiteral(node, scope) {
  if (t.isNullLiteral(node) || t.isBooleanLiteral(node) || t.isNumericLiteral(node) || t.isStringLiteral(node) || t.isBigIntLiteral(node)) return true;
  if (t.isTemplateLiteral(node)) return node.expressions.length === 0;
  if (t.isIdentifier(node, { name: 'undefined' })) return !scope.hasBinding('undefined');
  return t.isUnaryExpression(node, { operator: 'void' }) && t.isNumericLiteral(node.argument);
}

// Whether the value at `path` is rendered where it stands: a child of an
// element, a fragment or a component, a prop handed on to a component
// (isSlotAttribute), what the component returns, or a branch of a
// conditional, a logical expression or an array that is one of those. A
// function written in such a place is a reactive child, so what it returns
// is placed too. The child of <For> is its row function, not content.
function placesValue(path, fnPath, state) {
  let child = path;
  let parent = path.parentPath;
  while ((parent.isConditionalExpression() && child.key !== 'test')
      || (parent.isLogicalExpression() && child.key === 'right')
      || parent.isArrayExpression()
      || parent.isTSAsExpression() || parent.isTSSatisfiesExpression() || parent.isTSNonNullExpression()) {
    child = parent;
    parent = parent.parentPath;
  }
  if (parent.isJSXExpressionContainer()) {
    const owner = parent.parentPath;
    if (owner.isJSXAttribute()) return placingAttribute(owner.parentPath.parent, owner.node, state);
    if (parent.listKey !== 'children') return false;
    return owner.isJSXFragment() || !isLoweredTag(owner.node, 'For', state);
  }
  /** @type {any} */
  let fn = null;
  if (parent.isReturnStatement()) fn = parent.getFunctionParent();
  else if (parent.isArrowFunctionExpression() && child.key === 'body') fn = parent;
  if (fn === null) return false;
  if (fn === fnPath) return true;
  return (fn.isArrowFunctionExpression() || fn.isFunctionExpression()) && placesValue(fn, fnPath, state);
}

// An attribute whose value is rendered where it stands: one a component
// takes as a lazy prop, or the fallback of a <Show> or a <Switch>, which the
// compiler places in the conditional it lowers them to.
function placingAttribute(el, attr, state) {
  if (isLoweredTag(el, 'Show', state) || isLoweredTag(el, 'Switch', state)) return getAttrName(attr) === 'fallback';
  return isSlotAttribute(el, attr, state);
}

// A built-in the DOM back end lowers (dom.js transformElementFineGrained):
// What's own <For>, <Show> or <Switch>, never a third party's of that name.
function isLoweredTag(el, tag, state) {
  const name = el.openingElement.name;
  if (!t.isJSXIdentifier(name, { name: tag })) return false;
  return !isForeignTag(tag, state) || (tag === 'Switch' && hasLiteralMatchArms(el));
}

/**
 * Whether the attribute `attr` of the JSX element `el` hands its value to a
 * component as a lazy prop (dom.js transformComponentFineGrained, _$slots):
 * any attribute of a component after its last spread, but `key`, `ref`,
 * `children`, an event handler, a namespaced name (`bind:`, `client:`) and
 * any attribute of an island or of a built-in the DOM back end lowers.
 */
export function isSlotAttribute(el, attr, state) {
  if (!isComponentElement(el) || ['For', 'Show', 'Switch', 'Match'].some((tag) => isLoweredTag(el, tag, state))) return false;
  const attrs = el.openingElement.attributes;
  const name = getAttrName(attr);
  // A later spread or a later attribute of the same name decides the value.
  for (let i = attrs.indexOf(attr) + 1; i < attrs.length; i++) {
    if (t.isJSXSpreadAttribute(attrs[i]) || getAttrName(attrs[i]) === name) return false;
  }
  if (attrs.some((a) => t.isJSXAttribute(a) && getAttrName(a).startsWith('client:'))) return false;
  return name !== 'key' && name !== 'ref' && name !== 'children' && !name.includes(':') && !isEventAttrName(name);
}

// `props[key]` read where it is placed: `_$place(props, "key")` for the DOM
// back end (the reactivity analysis reads it as `props.key`), `props.key` for
// the server's.
function placingRead(propsId, key, state) {
  if (state.ssr) return t.memberExpression(t.cloneNode(propsId), propKey(key), !t.isIdentifier(propKey(key)));
  const callee = helper(state, '_$place');
  callee._whatPlace = true;
  return t.callExpression(callee, [t.cloneNode(propsId), t.stringLiteral(key)]);
}

// Moving a parameter pattern into the body changes what its defaults and
// computed keys see: a name the body declares, which they could not see
// before.
function movesIntoBody(fnPath, others) {
  let safe = true;
  for (const prop of fnPath.get('params.0.properties')) {
    if (!others.includes(prop.node)) continue;
    prop.traverse({
      ReferencedIdentifier(ref) {
        const binding = fnPath.scope.getOwnBinding(ref.node.name);
        if (binding && binding.kind !== 'param') safe = false;
      },
    });
  }
  return safe;
}

// Each read of a placed binding becomes a placing read of `props.<key>`
// where it stands. With a default, one read into a temporary: a read once
// the component has returned builds the value again.
function readAtUse(fnPath, found, propsId, state) {
  for (const { key, binding, fallback } of found.placed) {
    if (fallback === null) {
      for (const ref of binding.referencePaths) ref.replaceWith(placingRead(propsId, key, state));
      continue;
    }
    const temp = fnPath.scope.generateUidIdentifier(key);
    for (const ref of binding.referencePaths) {
      ref.replaceWith(t.conditionalExpression(
        t.binaryExpression('===', t.assignmentExpression('=', t.cloneNode(temp), placingRead(propsId, key, state)), t.unaryExpression('void', t.numericLiteral(0))),
        t.cloneNode(fallback),
        t.cloneNode(temp),
      ));
    }
    fnPath.scope.push({ id: temp });
  }
}

// Declarators for the pattern's other properties, read from `source`. The
// rest object names the keys it leaves out instead: destructuring a placed
// prop into nothing would read it.
function otherProps(fnPath, found, source) {
  const named = found.rest === null ? found.others : found.others.slice(0, -1);
  const declarators = [];
  if (named.length > 0) declarators.push(t.variableDeclarator(t.objectPattern(named), t.cloneNode(source)));
  if (found.rest !== null) {
    const excluded = [...found.placed.map((p) => p.key), ...named.map((p) => propertyName(p.key, p.computed))].map((name) => t.stringLiteral(name));
    const without = t.callExpression(fnPath.hub.addHelper('objectWithoutProperties'), [t.cloneNode(source), t.arrayExpression(excluded)]);
    declarators.push(t.variableDeclarator(found.rest.argument, without));
  }
  return declarators;
}

export function isVoidHtmlElement(name) {
  return VOID_ELEMENTS.has(String(name).toLowerCase());
}

export function getAttributeValue(value) {
  if (!value) return t.booleanLiteral(true);
  if (t.isJSXExpressionContainer(value)) return value.expression;
  if (t.isStringLiteral(value)) return value;
  return t.stringLiteral(value.value || '');
}

// Is this attribute overwritten by a later one naming the same DOM property?
//
// `<div id={a} id="b"/>` is legal JSX and means id="b": the last writer of a
// name wins, exactly as it does in the object literal the h() spelling
// builds. The template could not express that, because a repeated attribute
// in an HTML string keeps the FIRST value and a dynamic attribute is applied
// after the template regardless of where it was written. Dropping the
// shadowed one leaves a single writer per name, so written order decides.
//
// A later SPREAD never shadows: it overrides only the names it actually
// carries, which is not knowable here and is handled by ordering instead.
export function isShadowedAttr(attributes, index) {
  const name = attributeName(getAttrName(attributes[index]));
  for (let i = index + 1; i < attributes.length; i += 1) {
    const later = attributes[i];
    if (t.isJSXSpreadAttribute(later)) continue;
    if (attributeName(getAttrName(later)) === name) return true;
  }
  return false;
}

// Safely extract attribute name, handling JSXNamespacedName (e.g., client:idle, bind:value)
export function getAttrName(attr) {
  if (t.isJSXNamespacedName(attr.name)) {
    return `${attr.name.namespace.name}:${attr.name.name.name}`;
  }
  return typeof attr.name.name === 'string' ? attr.name.name : String(attr.name.name);
}

// The key half of a prop in an emitted object literal. A JSX attribute name is
// frequently NOT a valid JavaScript identifier — `data-x`, `aria-label` and
// every namespaced name contain characters an identifier cannot — so anything
// that does not match has to be quoted.
//
// Shared rather than inlined because babel's builders do not validate: handing
// t.identifier() a name with a dash produces `{data-x: "1"}` in the output and
// no error anywhere, so the mistake surfaces as a parse failure in generated
// code. Two call sites had their own copy of this test and one of them was
// missing it entirely.
export function propKey(name) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? t.identifier(name) : t.stringLiteral(name);
}

// Handler-shaped attribute name, case-insensitive. Mirrors _isEventProp in
// what-core's dom.js.
export function isEventAttrName(name) {
  return !!name && name.length > 2 && /^on/i.test(name);
}

export function createEventHandler(handler, modifiers) {
  if (modifiers.length === 0) return handler;

  let wrappedHandler = handler;

  for (const mod of modifiers) {
    switch (mod) {
      case 'preventDefault':
        wrappedHandler = t.arrowFunctionExpression(
          [t.identifier('e')],
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.identifier('e'), t.identifier('preventDefault')),
                []
              )
            ),
            t.expressionStatement(
              t.callExpression(wrappedHandler, [t.identifier('e')])
            )
          ])
        );
        break;

      case 'stopPropagation':
        wrappedHandler = t.arrowFunctionExpression(
          [t.identifier('e')],
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.identifier('e'), t.identifier('stopPropagation')),
                []
              )
            ),
            t.expressionStatement(
              t.callExpression(wrappedHandler, [t.identifier('e')])
            )
          ])
        );
        break;

      case 'self':
        wrappedHandler = t.arrowFunctionExpression(
          [t.identifier('e')],
          t.blockStatement([
            t.ifStatement(
              t.binaryExpression(
                '===',
                t.memberExpression(t.identifier('e'), t.identifier('target')),
                t.memberExpression(t.identifier('e'), t.identifier('currentTarget'))
              ),
              t.expressionStatement(
                t.callExpression(wrappedHandler, [t.identifier('e')])
              )
            )
          ])
        );
        break;

      case 'once':
      case 'capture':
      case 'passive':
        break;
    }
  }

  return wrappedHandler;
}

// =====================================================
// Fine-Grained Mode (template + insert + effect)
// =====================================================

// Whether the attribute at `index` is a form field's value, checked or
// default (an input's, a textarea's or a select's). The template's attribute
// is the field's default, which no value is written to, and a textarea's or a
// select's default is no attribute at all, so these are set by the runtime's
// field setters (render.js setValue, setChecked, setProp). An input whose
// static type makes its value an attribute (a checkbox, a button) keeps it.
export function isFieldProp(tagName, attributes, index) {
  if (!FIELD_TAGS.has(tagName)) return false;
  const name = getAttrName(attributes[index]);
  if (!FIELD_PROPS.has(name)) return false;
  if (tagName !== 'input' || (name !== 'value' && name !== 'defaultValue')) return true;
  const type = attributes.find((a) => !t.isJSXSpreadAttribute(a) && getAttrName(a) === 'type');
  return !(type && t.isStringLiteral(type.value) && ATTRIBUTE_VALUE_TYPES.has(type.value.value.toLowerCase()));
}

// Check if a JSX child is static (no expressions, nothing a runtime setter writes)
export function isStaticChild(child) {
  if (t.isJSXText(child)) return true;
  if (t.isJSXExpressionContainer(child)) return false;
  if (t.isJSXElement(child)) {
    const el = child.openingElement;
    if (isComponentElement(child)) return false;
    for (const [i, attr] of el.attributes.entries()) {
      if (t.isJSXSpreadAttribute(attr)) return false;
      const value = attr.value;
      if (t.isJSXExpressionContainer(value)) return false;
      if (isFieldProp(el.name.name, el.attributes, i)) return false;
    }
    return child.children.every(isStaticChild);
  }
  return false;
}

// Check if an attribute value is dynamic
export function isDynamicAttr(attr) {
  if (t.isJSXSpreadAttribute(attr)) return true;
  if (!attr.value) return false;
  return t.isJSXExpressionContainer(attr.value);
}

// --- Element namespaces ---
//
// What a template parses as depends on where its root sits: under <svg> an
// element is SVG and under <math> it is MathML, except where the HTML parser
// switches back to HTML (its integration points):
//   - the children of SVG <foreignObject>, <desc> and <title>;
//   - the children of MathML <annotation-xml> whose encoding is text/html or
//     application/xhtml+xml;
//   - the children of the MathML token elements <mi>, <mo>, <mn>, <ms> and
//     <mtext>, apart from <mglyph> and <malignmark>, which stay MathML.
// A JSX tree is split into several templates (each dynamic child's JSX becomes
// a root of its own), and by the time a nested root is lowered its enclosing
// JSX is gone, so every element of a tree is annotated with its namespace
// (`_whatNs`) before the tree is lowered.
//
// A root with no JSX around it is placed by its tag: an element that exists
// only in SVG or only in MathML is in that namespace; anything else,
// including the names both share with HTML (a, title, script, style), is HTML.
const SVG_ONLY_TAGS = new Set([
  'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs', 'desc',
  'ellipse', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
  'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'filter', 'foreignObject',
  'g', 'image', 'line', 'linearGradient', 'marker', 'mask', 'metadata', 'mpath', 'path',
  'pattern', 'polygon', 'polyline', 'radialGradient', 'rect', 'set', 'stop', 'switch',
  'symbol', 'text', 'textPath', 'tspan', 'use', 'view',
]);
const MATHML_ONLY_TAGS = new Set([
  'annotation', 'annotation-xml', 'maction', 'menclose', 'merror', 'mfenced', 'mfrac', 'mi',
  'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mprescripts', 'mroot', 'mrow',
  'ms', 'mspace', 'msqrt', 'mstyle', 'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr',
  'munder', 'munderover', 'semantics',
]);


// The context an element's children are parsed in. 'mathtext' is the inside of
// a MathML token element: HTML, except for the two MathML-only names above.
function childContext(own, tag, attributes) {
  if (own === 'svg') return SVG_HTML_INTEGRATION_POINTS.has(tag) ? 'html' : 'svg';
  if (own !== 'math') return own;
  if (MATHML_TEXT_INTEGRATION_POINTS.has(tag)) return 'mathtext';
  if (tag === 'annotation-xml') {
    const encoding = attributes.find(a => t.isJSXAttribute(a) && getAttrName(a) === 'encoding');
    if (encoding && t.isStringLiteral(encoding.value) && HTML_ENCODINGS.has(encoding.value.value.toLowerCase())) {
      return 'html';
    }
  }
  return 'math';
}

export function annotateNamespaces(root) {
  const visit = (node, ns) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, ns);
      return;
    }
    if (node.type === 'JSXElement') {
      const name = node.openingElement.name;
      if (t.isJSXIdentifier(name) && !isComponent(name.name)) {
        const tag = name.name;
        const own = tag === 'svg' ? 'svg'
          : tag === 'math' ? 'math'
            : ns === 'mathtext' ? (MATHML_IN_TEXT_POINTS.has(tag) ? 'math' : 'html')
              : ns !== null ? ns
                : SVG_ONLY_TAGS.has(tag) ? 'svg'
                  : MATHML_ONLY_TAGS.has(tag) ? 'math'
                    : 'html';
        node._whatNs = own;
        const inner = childContext(own, tag, node.openingElement.attributes);
        visit(node.openingElement.attributes, inner);
        visit(node.children, inner);
      } else {
        // A component renders its children where it stands.
        node._whatNs = ns;
        visit(node.openingElement.attributes, ns);
        visit(node.children, ns);
      }
      return;
    }
    if (node.type === 'JSXFragment') {
      node._whatNs = ns;
      visit(node.children, ns);
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] || []) visit(node[key], ns);
  };
  visit(root, null);
}

// Does `path` sit in a slot its parent only evaluates SOMETIMES?
//
// Used to decide whether a JSX root's setup statements may be hoisted out to
// the enclosing statement. Anything in one of these slots must not be: the
// source deliberately said "only build this when the guard opens", and the
// hoist turns that into "always build this".
//
// Only the slots that are genuinely skipped count. A logical expression's
// LEFT operand and a ternary's TEST always run, so JSX there is not guarded
// and keeps the cheaper hoist.
export function isConditionallyEvaluated(path) {
  const parent = path.parent;
  if (!parent) return false;
  if (t.isLogicalExpression(parent)) return path.key === 'right';
  if (t.isConditionalExpression(parent)) {
    return path.key === 'consequent' || path.key === 'alternate';
  }
  // `maybe?.render(<jsx/>)` skips its whole argument list when the chain
  // short-circuits, so an argument is guarded; the callee/object is not.
  if (t.isOptionalCallExpression(parent) || t.isOptionalMemberExpression(parent)) {
    return path.key !== 'callee' && path.key !== 'object';
  }
  return false;
}


// --- <Switch> arms ---
//
// <Switch fallback={alt}><Match when={a}>A</Match><Match when={b}>B</Match></Switch>
// is read statically by both back ends. A <Switch> is provably What's when
// either its binding was imported from What or it has literal <Match> arms;
// anything else with the same tag name is somebody else's component, and this
// returns null so it goes to the component path untouched. Once it is provably
// ours, a shape whose arms cannot be read statically has nowhere to go, since
// the runtime component would render its fallback and nothing else forever:
// that is a compile error rather than a silent blank.
export function readSwitch(path, state) {
  const { node } = path;
  // A <Switch> that got here on its arms alone came from the same foreign
  // specifier its arms did, so its <Match> is ours by the same reasoning.
  const armsProveIt = isForeignTag(node.openingElement.name.name, state);
  const isMatch = (child) =>
    t.isJSXElement(child) && t.isJSXIdentifier(child.openingElement.name, { name: 'Match' }) &&
    (armsProveIt || !isForeignTag('Match', state));
  if (!node.children.some(isMatch) && !isWhatTag(node.openingElement.name.name, state)) return null;

  const unsupported = (why) => {
    throw compileError(
      path,
      state,
      `<Switch> ${why}. The compiler needs to read its arms statically. ` +
      'Write them out: <Switch fallback={...}><Match when={a}>…</Match><Match when={b}>…</Match></Switch>'
    );
  };

  let fallback = null;
  for (const attr of node.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attr)) unsupported('cannot take a spread attribute');
    if (getAttrName(attr) === 'fallback') fallback = getAttributeValue(attr.value);
  }

  const arms = [];
  for (const child of node.children) {
    if (t.isJSXText(child)) {
      if (normalizeJsxText(child.value)) unsupported('cannot mix text with its <Match> arms');
      continue;
    }
    if (t.isJSXExpressionContainer(child)) {
      if (t.isJSXEmptyExpression(child.expression)) continue;
      unsupported('cannot read its arms from an expression child');
    }
    if (!isMatch(child)) unsupported('cannot mix other elements with its <Match> arms');
    let when = null;
    for (const attr of child.openingElement.attributes) {
      if (t.isJSXAttribute(attr) && getAttrName(attr) === 'when') when = getAttributeValue(attr.value);
    }
    if (!when) unsupported('has a <Match> with no "when" prop');
    arms.push({ when, children: child.children });
  }
  if (arms.length === 0) unsupported('has no <Match> arms');
  return { fallback, arms };
}

// Add specifiers to the file's first import from one of `sources`, or to a new
// import of `fallback`. A specifier whose local name is already imported there
// is the same binding and is not repeated.
export function addImports(path, specifiers, sources, fallback) {
  if (specifiers.length === 0) return;
  /** @type {any} */
  let existing = null;
  for (const node of path.node.body) {
    if (t.isImportDeclaration(node) && sources.includes(node.source.value)) {
      existing = node;
      break;
    }
  }
  if (!existing) {
    path.unshiftContainer('body', t.importDeclaration(specifiers, t.stringLiteral(fallback)));
    return;
  }
  const locals = new Set(existing.specifiers.map(s => s.local.name));
  for (const spec of specifiers) {
    if (!locals.has(spec.local.name)) existing.specifiers.push(spec);
  }
}
