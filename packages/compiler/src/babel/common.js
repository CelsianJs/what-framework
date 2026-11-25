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
} from '../tables/markup-rules.js';
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
// runtime path, so guessing wrong here renders the fallback forever. An arm
// written under the name What's Match was imported as counts too.
export function hasLiteralMatchArms(node, state) {
  return node.children.some((child) => t.isJSXElement(child) && t.isJSXIdentifier(child.openingElement.name)
    && (child.openingElement.name.name === 'Match' || (state != null && whatControlFlow(state).get(child.openingElement.name.name) === 'Match')));
}

// --- What's control flow, by where it was imported from ---
//
// <For>, <Show>, <Switch> and <Match> lower to inserters and conditionals
// (dom.js transformElementFineGrained, ssr.js jsxValue). The tag is what the
// file imported from What, under whatever name: `import { Switch as Branch }`
// lowers `<Branch>` as a <Switch>, so a file can keep the name `Switch` for a
// UI toggle of its own. A tag that was not imported from What keeps the old
// rule: lowered by its name unless a package other than What exports it.

const CONTROL_FLOW = new Set(['For', 'Show', 'Switch', 'Match']);

/** The local names this file imports What's control flow under, to the name What exports. */
function whatControlFlow(state) {
  if (state._whatControlFlow) return state._whatControlFlow;
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const node of state.file?.ast?.program?.body ?? []) {
    if (!t.isImportDeclaration(node) || node.importKind === 'type' || !isWhatModuleSource(node.source.value)) continue;
    for (const spec of node.specifiers) {
      if (!t.isImportSpecifier(spec) || spec.importKind === 'type') continue;
      const imported = spec.imported.name ?? spec.imported.value;
      if (CONTROL_FLOW.has(imported)) names.set(spec.local.name, imported);
    }
  }
  state._whatControlFlow = names;
  return names;
}

/**
 * The control flow built-in the JSX element `el` is, as What exports it
 * ('For', 'Show', 'Switch' or 'Match'), or null for any other element. A
 * third party's <Switch> is What's only when its literal <Match> arms say so.
 */
export function controlFlowTag(el, state) {
  const name = el && el.openingElement ? el.openingElement.name : null;
  if (!t.isJSXIdentifier(name)) return null;
  const local = name.name;
  const imported = whatControlFlow(state).get(local);
  if (imported !== undefined) return imported;
  if (!CONTROL_FLOW.has(local)) return null;
  if (!isForeignTag(local, state)) return local;
  return local === 'Switch' && hasLiteralMatchArms(el, state) ? 'Switch' : null;
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

// --- Props a component reads where it uses them ---
// Compiled JSX hands a component JSX as a getter that builds it when read:
// its children (dom.js _installLazyChildren), and the JSX it passes in any
// other prop (`header={<Nav />}`, _$slots). It hands a prop whose value reads
// a signal (`on={count() > 0}`) as a getter too, a live prop (what-core
// dom.js _isLiveProp), which reads the expression again wherever it is read.
// Destructuring a prop, in the parameter list or from props in the body,
// reads its getter there, once, before the component's output exists: a
// live prop would freeze at its first value, and JSX would be built before a
// boundary or a provider it is forwarded into is entered (the boundary never
// catches, the provider publishes too late) and, while hydrating, off the
// walk, taking the place of the server's nodes for it.
//
// So a destructured prop is read where it is used instead:
// - when every read of it places it, each read becomes a placing read of
//   `props.<key>` where it stands, which builds JSX where it renders, as
//   `props.children` written there does (and places a live prop as a
//   reactive child);
// - otherwise, in a function that renders JSX, each read becomes the read
//   `props.<key>` where it stands, which the JSX bindings around it track
//   (reactivity.js isPropsRead).
// A binding that is reassigned, one with a default that is not a plain
// literal (`items = []` would be a new array at every read), a nested
// pattern, one used as a JSX tag (`<Icon />`) and a computed key keep their
// destructuring, read once.
//
// The DOM back end also marks a read of `props.<key>` written by hand where
// it is placed. A placing read is `_$place(props, "key")` (render.js), which
// the reactivity analysis treats as the property read it is; the server back
// end renders vnodes, which build where they are placed, and reads
// `props.<key>`.
export function deferPlacedProps(fnPath, state) {
  const params = fnPath.node.params;
  // A second parameter that is a name is forwardRef's render function's ref
  // (`({ as: Tag, ...rest }, ref) => …`): the first is still the props.
  if (params.length === 0 || params.length > 2 || (params.length === 2 && !t.isIdentifier(params[1])) || isRowFunction(fnPath, state)) return;
  const param = params[0];
  const rendersJsx = containsJsx(fnPath.node);
  if (!rendersJsx && !isComponentWithoutJsx(fnPath, state)) return;
  if (t.isObjectPattern(param)) {
    const found = placedProps(fnPath, param, fnPath.scope, state, rendersJsx);
    if (found === null || !movesIntoBody(fnPath, found.others)) return;
    const propsId = fnPath.scope.generateUidIdentifier('props');
    if (param.typeAnnotation) propsId.typeAnnotation = param.typeAnnotation;
    readAtUse(fnPath, found, propsId, state);
    params[0] = propsId;
    if (rendersJsx) fnPath.node._whatPropsParam = propsId.name;
    // The parameter was a pattern: `props.<key>()` is a destructured
    // accessor prop's call (auto-selector.js sourceOf).
    fnPath.node._whatPropsPattern = true;
    const declarators = otherProps(fnPath, found, propsId, state);
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
    let binding = fnPath.scope.getBinding(param.name);
    if (!binding || binding.constantViolations.length > 0) return;
    // Its reads `props.<key>` in JSX are bindings (reactivity.js isPropsRead).
    if (rendersJsx) fnPath.node._whatPropsParam = param.name;
    if (rendersJsx && inlinePropAliases(fnPath, binding)) {
      fnPath.scope.crawl();
      binding = fnPath.scope.getBinding(param.name);
      if (!binding) return;
    }
    if (!readPropsWhereUsed(fnPath, binding, param, state, rendersJsx)) return;
  } else {
    return;
  }
  fnPath.scope.crawl();
  readRestsWhereUsed(fnPath, state, rendersJsx);
}

// The reads of the props object `binding` (named `id`) where they are used:
// a pattern destructured from it in the body (`const { children } = props`)
// and a read `props.<key>` where it is placed. Whether any was rewritten.
function readPropsWhereUsed(fnPath, binding, id, state, rendersJsx) {
  const rewrites = [];
  const reads = [];
  for (const ref of binding.referencePaths) {
    const decl = ref.parentPath;
    if (decl.isVariableDeclarator() && ref.key === 'init' && t.isObjectPattern(decl.node.id)) {
      // `const { children } = props` in the body, or in a function of it
      // that renders JSX (`const row = () => { const { a, ...rest } = props; … }`).
      const inner = ref.getFunctionParent();
      if (inner !== fnPath && !containsJsx(inner.node)) continue;
      if (decl.parent.kind === 'var') {
        if (rendersJsx) warnReadOnce(fnPath, state, decl.node.id, `{ ${[...collectNames(decl.node.id)].join(', ')} }`, 'it is declared with `var`', 'declare it with `const`');
        continue;
      }
      const found = placedProps(fnPath, decl.node.id, decl.scope, state, rendersJsx);
      if (found !== null) rewrites.push([decl, found]);
    } else if (!state.ssr && decl.isMemberExpression() && ref.key === 'object' && !t.isNumericLiteral(decl.node.property)
        && propertyName(decl.node.property, decl.node.computed) !== null && placesValue(decl, fnPath, state)) {
      reads.push(decl);
    }
  }
  if (rewrites.length === 0 && reads.length === 0) return false;
  for (const [decl, found] of rewrites) {
    readAtUse(fnPath, found, id, state);
    const declarators = otherProps(fnPath, found, id, state);
    if (declarators.length > 0) decl.replaceWithMultiple(declarators);
    else decl.remove();
  }
  for (const read of reads) read.replaceWith(placingRead(id, propertyName(read.node.property, read.node.computed), state));
  return true;
}

// A rest element of the props (otherProps marks its declarator,
// `_whatPropsRest`) holds the props' getters, so it is read the way the props
// are: destructured again (`const { href, ...more } = rest`), read by key
// (`rest.href`, a binding in JSX: reactivity.js isPropsRead) and placed
// (`{rest.children}`). Its own rest elements are, in turn.
function readRestsWhereUsed(fnPath, state, rendersJsx) {
  const done = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const pending = [];
    fnPath.traverse({
      Function(inner) { inner.skip(); },
      VariableDeclarator(decl) {
        if (decl.node._whatPropsRest === true && !done.has(decl.node)) pending.push(decl);
      },
    });
    if (pending.length === 0) return;
    let changed = false;
    for (const decl of pending) {
      done.add(decl.node);
      const binding = decl.scope.getBinding(decl.node.id.name);
      if (!binding || binding.constantViolations.length > 0) continue;
      if (readPropsWhereUsed(fnPath, binding, t.identifier(decl.node.id.name), state, rendersJsx)) changed = true;
    }
    if (!changed) return;
    fnPath.scope.crawl();
  }
}

// --- Aliases of a prop ---
//
// `const ev = props.ev;` and then `{ev.label}` read the prop's getter once,
// where the alias is declared, so the JSX showed the first value forever (in
// a keyed row, the row's first item). React evaluates it on every render. An
// alias that is a `const` holding a member chain off props (`props.ev`,
// `props.ev.item`, `props.ev?.item`, literal keys only), declared in the
// component's own body and never reassigned, is read as that chain where
// each read stands: the way a destructured prop is (readAtUse), so a read in
// JSX is a live binding. An alias of an alias resolves the same way. Any
// other initializer (a call, arithmetic, `let`) is read once, as before.

/** Rewrite the prop aliases of the component `fnPath` whose props are `binding`; whether any was. */
function inlinePropAliases(fnPath, binding) {
  let changed = false;
  for (let pass = 0; pass < 8; pass++) {
    const aliases = [];
    for (const ref of binding.referencePaths) {
      const alias = propAlias(ref, fnPath);
      if (alias !== null && !aliases.some((a) => a.binding === alias.binding)) aliases.push(alias);
    }
    if (aliases.length === 0) break;
    for (const { decl, binding: alias, init } of aliases) {
      for (const read of alias.referencePaths) {
        if (read.parentPath.isObjectProperty({ shorthand: true }) && read.key === 'value') read.parent.shorthand = false;
        read.replaceWith(t.cloneNode(init, true));
      }
      decl.remove();
    }
    changed = true;
    fnPath.scope.crawl();
    const next = fnPath.scope.getBinding(/** @type {any} */ (binding.identifier).name);
    if (!next) break;
    binding = next;
  }
  return changed;
}

// The alias `const name = <ref>.a.b` that the props reference `ref` starts,
// as { decl, binding, init }, or null.
function propAlias(ref, fnPath) {
  let top = ref;
  for (;;) {
    const parent = top.parentPath;
    if (!(parent.isMemberExpression() || parent.isOptionalMemberExpression()) || top.key !== 'object') break;
    if (parent.node.computed && propertyName(parent.node.property, true) === null) return null;
    top = parent;
  }
  if (top === ref) return null;
  const decl = top.parentPath;
  if (!decl.isVariableDeclarator() || top.key !== 'init' || !t.isIdentifier(decl.node.id)) return null;
  if (decl.parent.kind !== 'const' || decl.getFunctionParent() !== fnPath) return null;
  const alias = decl.scope.getBinding(decl.node.id.name);
  if (!alias || alias.constantViolations.length > 0 || alias.referencePaths.length === 0) return null;
  // A tag (`<ev.Icon />`) names a component, not a value to read live.
  if (alias.referencePaths.some((read) => read.isJSXIdentifier())) return null;
  // JSX handed in a prop is built when it is read (render.js _$slots): an
  // alias of it, read in the run, is that build, which a thunk running later
  // indexes (`{() => panels[at()]}`, core test lazy-props). So `children`,
  // which is always JSX, and an alias read with a computed key keep the
  // value they read in the run.
  const first = t.isMemberExpression(top.node) || t.isOptionalMemberExpression(top.node) ? firstKey(top.node) : null;
  if (first === 'children') return null;
  if (alias.referencePaths.some((read) => (read.parentPath.isMemberExpression() || read.parentPath.isOptionalMemberExpression())
      && read.key === 'object' && read.parent.computed && propertyName(read.parent.property, true) === null)) return null;
  return { decl, binding: alias, init: top.node };
}

// The first key read off the root of the member chain `node` (`props.a.b` → 'a').
function firstKey(node) {
  while (t.isMemberExpression(node.object) || t.isOptionalMemberExpression(node.object)) node = node.object;
  return propertyName(node.property, node.computed);
}

// --- Which functions are components ---
// Reading props where they are used changes what a function's parameter
// reads (`_$place`, `_$omit`, `props.<key>` for a destructured name), so it
// applies to a component only:
// - a function that renders JSX (JSX anywhere in its body, nested callbacks
//   included), whatever its name: a component, a memo() or forwardRef()
//   render function, a render helper;
// - a function with no JSX that is named as a component (`function Card`,
//   `const Card = …`, `memo(…)` or `forwardRef(…)` assigned to `Card`,
//   `Tabs.Panel = …`, a default export) and renders as one: it calls What's
//   h() (imported from what-framework or what-core), so
//   `function Box({ as, ...rest }) { return h(as, rest) }` keeps `rest` live,
//   or it returns a prop as it is (`return props.children`,
//   `({ children }) => children`), which is placed where it renders.
// Nothing else is: a helper that destructures its argument, capitalised or
// not (`function Point({ x, y, ...rest })` returning an object), a
// forwardRef() implementation that calls the render function it was given
// (what-react's `ForwardRefComponent`), a higher-order component that calls
// the component it wraps, a reducer, a class's method. In What's own packages
// (framework-files.js) only a function that renders JSX is.
function isComponentWithoutJsx(fnPath, state) {
  if (state.frameworkFile || !namedAsComponent(fnPath)) return false;
  return callsWhatH(fnPath) || returnsProp(fnPath);
}

function namedAsComponent(fnPath) {
  if (/^[A-Z]/.test(componentName(fnPath))) return true;
  let at = fnPath.parentPath;
  while (at && at.isCallExpression()) at = at.parentPath;
  if (!at) return false;
  if (at.isExportDefaultDeclaration()) return true;
  // `Tabs.Panel = (props) => …`, `{ Panel: (props) => … }`.
  if (at.isAssignmentExpression() && t.isMemberExpression(at.node.left) && !at.node.left.computed) return /^[A-Z]/.test(at.node.left.property.name || '');
  return at.isObjectProperty() && !at.node.computed && t.isIdentifier(at.node.key) && /^[A-Z]/.test(at.node.key.name);
}

// A call of What's h(): `h(…)` imported from a What module, or `ns.h(…)` of
// a namespace import of one.
function callsWhatH(fnPath) {
  let found = false;
  fnPath.traverse({
    CallExpression(call) {
      if (found) return call.stop();
      const callee = call.node.callee;
      if (t.isIdentifier(callee)) found = importedFrom(call.scope.getBinding(callee.name), t.isImportSpecifier, 'h');
      else if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property, { name: 'h' }) && t.isIdentifier(callee.object)) {
        found = importedFrom(call.scope.getBinding(callee.object.name), t.isImportNamespaceSpecifier, null);
      }
      if (found) call.stop();
    },
  });
  return found;
}

// Whether the function returns one of its props as it is: `props.<key>`, a
// name destructured from its props (in the parameter list or from the props
// in its body), in a branch of a conditional, a logical expression or an
// array.
function returnsProp(fnPath) {
  const param = fnPath.node.params[0];
  const isProp = (node) => {
    while (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node) || t.isParenthesizedExpression(node)) node = node.expression;
    if (t.isConditionalExpression(node)) return isProp(node.consequent) || isProp(node.alternate);
    if (t.isLogicalExpression(node)) return isProp(node.left) || isProp(node.right);
    if (t.isArrayExpression(node)) return node.elements.some((e) => e !== null && isProp(e));
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      let root = node;
      while (t.isMemberExpression(root) || t.isOptionalMemberExpression(root)) root = root.object;
      return t.isIdentifier(param) && t.isIdentifier(root, { name: param.name }) && fnPath.scope.getBinding(param.name)?.kind === 'param';
    }
    if (!t.isIdentifier(node)) return false;
    const binding = fnPath.scope.getBinding(node.name);
    if (!binding || binding.scope !== fnPath.scope) return false;
    if (binding.kind === 'param') return t.isObjectPattern(param) && binding.path.parentPath?.node === fnPath.node;
    const decl = binding.path;
    return decl.isVariableDeclarator() && t.isObjectPattern(decl.node.id) && t.isIdentifier(param)
      && t.isIdentifier(decl.node.init, { name: param.name });
  };
  const body = fnPath.node.body;
  if (!t.isBlockStatement(body)) return isProp(body);
  let found = false;
  fnPath.traverse({
    Function(inner) { inner.skip(); },
    ReturnStatement(ret) {
      if (!found && ret.node.argument && isProp(ret.node.argument)) found = true;
    },
  });
  return found;
}

// Whether a function renders JSX: JSX anywhere in its body, nested callbacks
// included (`items.map((i) => <li />)`).
function containsJsx(fn) {
  let found = false;
  t.traverseFast(fn.body, (node) => {
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') found = true;
  });
  return found;
}

// A callback a method calls (`.map(row => …)`, `.then(…)`), the row
// function of a <For>, or a function an attribute passes (a <For>'s `key`,
// an event handler, a render prop): its parameter is an item or an event,
// not props, and the list lowerings read a row's fields themselves
// (lists.js).
function isRowFunction(fnPath, state) {
  const parent = fnPath.parentPath;
  if (parent.isCallExpression() && fnPath.listKey === 'arguments') return t.isMemberExpression(parent.node.callee) || t.isOptionalMemberExpression(parent.node.callee);
  if (!parent.isJSXExpressionContainer()) return false;
  return parent.parentPath.isJSXAttribute() || (parent.parentPath.isJSXElement() && isLoweredTag(parent.parentPath.node, 'For', state));
}

// The properties of `pattern` read where they are used (`placed`: each read
// places the value; `live`: in a function that renders JSX, read as
// `props.<key>`; each with its key, binding and literal default), else null
// when there are none. `others` are the pattern's other properties, and
// `rest` its rest element.
function placedProps(fnPath, pattern, scope, state, rendersJsx) {
  const counts = new Map();
  for (const prop of pattern.properties) {
    const name = t.isObjectProperty(prop) ? propertyName(prop.key, prop.computed) : null;
    if (name !== null) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const placed = [];
  const live = [];
  const others = [];
  for (const prop of pattern.properties) {
    const entry = t.isObjectProperty(prop) ? readProp(fnPath, prop, scope) : null;
    // `{ style: { color } }`: each name is read as `props.style.color` where
    // it is used, as a live prop is, in a function that renders JSX.
    const nested = entry === null && rendersJsx && t.isObjectProperty(prop) ? nestedProps(fnPath, prop, scope) : null;
    if (nested !== null && counts.get(nested[0].key) === 1
        && nested.every((leaf) => leaf.binding.referencePaths.every((ref) => !ref.isJSXIdentifier()))) {
      live.push(...nested);
      continue;
    }
    // A second key would still read the getter where it is destructured.
    if (entry === null || counts.get(entry.key) !== 1) {
      others.push(prop);
      if (rendersJsx && t.isObjectProperty(prop)) readOnce(fnPath, state, prop, counts);
    } else if (entry.binding.referencePaths.every((ref) => placesValue(ref, fnPath, state))) placed.push(entry);
    else if (rendersJsx && entry.binding.referencePaths.every((ref) => !ref.isJSXIdentifier())) live.push(entry);
    else others.push(prop);
  }
  const last = others[others.length - 1];
  const rest = t.isRestElement(last) ? last : null;
  // A rest element is always built here, even with no prop read where it is
  // used: destructured natively it would read every getter once
  // (`({ as: Tag, ...rest }) => <Tag {...rest} />` showed the first `href`
  // forever), where _$omit keeps them.
  if (placed.length === 0 && live.length === 0 && rest === null) return null;
  // The rest object is built by naming the keys it leaves out.
  if (rest !== null && (!t.isIdentifier(rest.argument)
      || others.some((p) => t.isObjectProperty(p) && propertyName(p.key, p.computed) === null))) {
    if (rendersJsx && t.isIdentifier(rest.argument)) warnReadOnce(fnPath, state, rest, `...${rest.argument.name}`, 'the pattern has a computed key, so the keys the rest element leaves out are not known', `name the keys (\`const { [key]: v } = props\` apart from \`const { a, ...${rest.argument.name} } = props\`)`);
    return null;
  }
  return { placed, live, others, rest };
}

// --- ERR_PROP_READ_ONCE ---
// A destructured prop the compiler cannot read where it is used is read once,
// when the component runs, and keeps that value when the parent's state
// changes, where React would render the new one. That is never silent: a
// development build says so at compile time, with the fix.

/** Report why the destructured prop `prop` is read once, if it is used. */
function readOnce(fnPath, state, prop, counts) {
  const key = propertyName(prop.key, prop.computed);
  const value = t.isAssignmentPattern(prop.value) ? prop.value.left : prop.value;
  const name = t.isIdentifier(value) ? value.name : key ?? '(pattern)';
  if (t.isIdentifier(value)) {
    const binding = fnPath.scope.getBinding(value.name);
    if (!binding || binding.referencePaths.length === 0) return;
    // A component held in a prop and used as a tag (`as: Tag`) is read where
    // the component runs by design: see docs/GOTCHAS.md.
    if (binding.referencePaths.some((ref) => ref.isJSXIdentifier())) return;
    if (binding.constantViolations.length > 0) {
      return warnReadOnce(fnPath, state, prop, name, 'it is assigned again in the component', `leave the prop as it is and write a new name (\`const shown = () => props.${key ?? name} ?? fallback\`)`);
    }
  }
  if (key === null) return warnReadOnce(fnPath, state, prop, name, 'its key is computed', 'read `props[key]` where it is used');
  if (counts.get(key) !== 1) return warnReadOnce(fnPath, state, prop, name, `\`${key}\` is destructured twice`, 'destructure it once');
  if (t.isAssignmentPattern(prop.value)) {
    return warnReadOnce(fnPath, state, prop, name, 'its default reads a name of the component or calls something', `read \`props.${key} ?? <default>\` where it is used, or make the default a constant at module scope`);
  }
  if (t.isObjectPattern(value) || t.isArrayPattern(value)) {
    return warnReadOnce(fnPath, state, prop, name, 'its pattern holds a rest element, an array, a computed key or a default that is not a literal', `read \`props.${key}\` where it is used`);
  }
}

const warnedReadOnce = new Set();

function collectNames(pattern, out = new Set()) {
  if (t.isIdentifier(pattern)) out.add(pattern.name);
  else if (t.isAssignmentPattern(pattern)) collectNames(pattern.left, out);
  else if (t.isRestElement(pattern)) collectNames(pattern.argument, out);
  else if (t.isObjectPattern(pattern)) for (const p of pattern.properties) collectNames(t.isRestElement(p) ? p : p.value, out);
  else if (t.isArrayPattern(pattern)) for (const e of pattern.elements) if (e) collectNames(e, out);
  return out;
}

function warnReadOnce(fnPath, state, node, name, why, fix) {
  if (process.env.NODE_ENV === 'production' || state.ssr || !isComponentFunction(fnPath)) return;
  const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
  const loc = node.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : '';
  const at = `${fileName}${loc}`;
  if (warnedReadOnce.has(`${at}::${name}`)) return;
  warnedReadOnce.add(`${at}::${name}`);
  console.warn(
    `[what-compiler] ERR_PROP_READ_ONCE: \`${name}\`, destructured from the props of <${componentName(fnPath)}> at ${at}, ` +
    `is read once, when the component runs, because ${why}: it keeps that value when the parent's state changes. ` +
    `Fix: ${fix}. Run what_fix({ error: 'ERR_PROP_READ_ONCE' }) for the worked example.`
  );
}

// A function named as a component is (`function Card`, `const Card = …`).
function isComponentFunction(fnPath) {
  return /^[A-Z]/.test(componentName(fnPath));
}

function componentName(fnPath) {
  if (fnPath.node.id) return fnPath.node.id.name;
  let at = fnPath.parentPath;
  // `const Card = memo((props) => …)`, `forwardRef(...)`.
  while (at && at.isCallExpression()) at = at.parentPath;
  return at && at.isVariableDeclarator() && t.isIdentifier(at.node.id) ? at.node.id.name : 'anonymous';
}

// A destructured prop that can be read where it is used: a static key bound
// to a name that is never reassigned, with no default or a plain literal one.
function readProp(fnPath, prop, scope) {
  const key = propertyName(prop.key, prop.computed);
  if (key === null) return null;
  let local = prop.value;
  let fallback = null;
  let hoist = false;
  if (t.isAssignmentPattern(local)) {
    fallback = local.right;
    local = local.left;
    // Evaluated where each read stands now, so only a value that is the
    // same wherever and however often it is evaluated: a plain literal, or
    // one that reads nothing of the component and calls nothing
    // (`items = []`, `onChange = () => {}`, `size = SIZES.md`), made once
    // when the component runs and kept (readAtUse).
    if (!isPlainLiteral(fallback, fnPath.scope)) {
      if (!isClosedValue(fallback, fnPath)) return null;
      hoist = true;
    }
  }
  if (!t.isIdentifier(local)) return null;
  const binding = scope.getBinding(local.name);
  if (!binding || binding.constantViolations.length > 0) return null;
  return { key, binding, fallback, hoist };
}

// A value that evaluated once when the component starts is the value its
// default would have been: literals, arrays and objects of them, functions
// (evaluated when called), and names and member reads from outside the
// component. No call, no `new`, no `this`.
function isClosedValue(node, fnPath) {
  switch (node.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': case 'NullLiteral': case 'BigIntLiteral':
    case 'ArrowFunctionExpression': case 'FunctionExpression':
      return true;
    case 'TemplateLiteral':
      return node.expressions.every((e) => isClosedValue(e, fnPath));
    case 'ArrayExpression':
      return node.elements.every((e) => e === null || isClosedValue(t.isSpreadElement(e) ? e.argument : e, fnPath));
    case 'ObjectExpression':
      return node.properties.every((p) => (t.isObjectMethod(p) ? !p.computed
        : t.isSpreadElement(p) ? isClosedValue(p.argument, fnPath)
          : (!p.computed || isClosedValue(p.key, fnPath)) && isClosedValue(p.value, fnPath)));
    case 'Identifier': {
      const binding = fnPath.scope.getBinding(node.name);
      return !binding || !(binding.path === fnPath || binding.path.isDescendant(fnPath));
    }
    case 'MemberExpression':
      return isClosedValue(node.object, fnPath) && (!node.computed || isClosedValue(node.property, fnPath));
    case 'UnaryExpression':
      return node.operator !== 'delete' && isClosedValue(node.argument, fnPath);
    case 'BinaryExpression': case 'LogicalExpression':
      return isClosedValue(node.left, fnPath) && isClosedValue(node.right, fnPath);
    case 'ConditionalExpression':
      return isClosedValue(node.test, fnPath) && isClosedValue(node.consequent, fnPath) && isClosedValue(node.alternate, fnPath);
    default:
      return false;
  }
}

// The names of a nested pattern of prop `prop` (`style: { color, size = 1 }`,
// `style: { color } = {}`, nested further), each as a live read of its path
// (`{ key, path, optional, binding, fallback }`), or null when one cannot be:
// a computed key, a rest element, a default that is not a plain literal (an
// empty object for the pattern itself, read as `props.style?.color`), a name
// that is reassigned.
function nestedProps(fnPath, prop, scope) {
  const key = propertyName(prop.key, prop.computed);
  if (key === null) return null;
  const out = [];
  const visit = (value, path, optional) => {
    if (t.isAssignmentPattern(value) && t.isObjectPattern(value.left)) {
      if (!t.isObjectExpression(value.right) || value.right.properties.length > 0) return false;
      return visit(value.left, path, true);
    }
    if (!t.isObjectPattern(value) || value.properties.length === 0) return false;
    for (const inner of value.properties) {
      if (!t.isObjectProperty(inner)) return false;
      const name = propertyName(inner.key, inner.computed);
      if (name === null) return false;
      const at = [...path, { name, optional }];
      if (t.isObjectPattern(inner.value) || (t.isAssignmentPattern(inner.value) && t.isObjectPattern(inner.value.left))) {
        if (!visit(inner.value, at, false)) return false;
        continue;
      }
      const entry = readProp(fnPath, { ...inner, key: t.identifier('x'), computed: false }, scope);
      if (entry === null) return false;
      out.push({ key, path: at, binding: entry.binding, fallback: entry.fallback });
    }
    return true;
  };
  return visit(prop.value, [], false) ? out : null;
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
  return controlFlowTag(el, state) === tag;
}

/**
 * Whether the attribute `attr` of the JSX element `el` hands its value to a
 * component as a lazy prop (dom.js transformComponentFineGrained, _$slots):
 * any attribute of a component after its last spread, but `key`, `ref`,
 * `children`, an event handler, a namespaced name (`bind:`, `client:`) and
 * any attribute of an island or of a built-in the DOM back end lowers.
 */
export function isSlotAttribute(el, attr, state) {
  if (!isComponentElement(el) || controlFlowTag(el, state) !== null) return false;
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
function placingRead(propsId, key, state, fallback = null) {
  if (state.ssr) return t.memberExpression(t.cloneNode(propsId), propKey(key), !t.isIdentifier(propKey(key)));
  const callee = helper(state, '_$place');
  callee._whatPlace = true;
  const args = [t.cloneNode(propsId), t.stringLiteral(key)];
  // `({ label = 'x' })`: the default, applied where the value is undefined.
  if (fallback !== null) args.push(t.unaryExpression('void', t.numericLiteral(0)), t.cloneNode(fallback));
  return t.callExpression(callee, args);
}

// --- A spread's children ---
// `<a {...props} />` with `props.children` renders the children in React:
// the element's props are the spread, children included. An element with no
// children of its own is given the spread's as its content, read where they
// are placed (`{_$place(props, "children")}` for the DOM back end, the read
// `props.children` for the server's), so lazy children are built in the
// element and live ones stay live; the setters never write `children` as an
// attribute (render.js spread). Several spreads: the last that holds children,
// as their merge would. Only a spread of a name or a member chain is read
// again; any other argument is evaluated once by the spread (its children,
// if any, are not rendered). Not for a void element, a <textarea> (its
// children are its default, React's warning) or an element that names
// `children` itself.
const NO_SPREAD_CHILDREN = new Set(['textarea', 'noscript', 'template']);

export function spreadChildren(elPath, state) {
  const node = elPath.node;
  const name = node.openingElement.name;
  if (!t.isJSXIdentifier(name)) return;
  // A tag held in a binding may name an element (`<Tag {...rest} />`), which
  // what-core renders with the props' children (render.js tagComponent). The
  // server renders it as the vnode `h(Tag, props, ...children)`, so it is
  // handed them as its children too; a component given them that way gets
  // the same `props.children`.
  if (isComponent(name.name) ? !state.ssr || !mayHoldTag(elPath.scope.getBinding(name.name))
    : isVoidHtmlElement(name.name) || NO_SPREAD_CHILDREN.has(name.name)) return;
  const attrs = node.openingElement.attributes;
  const spreads = attrs.filter((a) => t.isJSXSpreadAttribute(a));
  if (spreads.length === 0 || attrs.some((a) => t.isJSXAttribute(a) && getAttrName(a) === 'children')) return;
  if (node.children.some((c) => !t.isJSXText(c) || /[^ \t\r\n]/.test(c.value))) return;
  if (!spreads.every((s) => isNameChain(s.argument))) return;
  const source = spreads.length === 1 ? spreads[0].argument
    : state.ssr ? t.objectExpression(spreads.map((s) => t.spreadElement(t.cloneNode(s.argument))))
      : t.callExpression(helper(state, '_$merge'), spreads.map((s) => t.cloneNode(s.argument)));
  node.children = [t.jsxExpressionContainer(placingRead(source, 'children', state))];
  if (node.openingElement.selfClosing) {
    node.openingElement.selfClosing = false;
    node.closingElement = t.jsxClosingElement(t.jsxIdentifier(name.name));
  }
}

// A binding that may hold an element's name: not a function, a class or an
// import, which name components.
function mayHoldTag(binding) {
  if (!binding || binding.kind === 'module' || binding.kind === 'hoisted') return false;
  const node = binding.path.node;
  if (t.isClassDeclaration(node) || t.isFunction(node)) return false;
  const init = t.isVariableDeclarator(node) ? node.init : null;
  return !(t.isFunction(init) || t.isClassExpression(init));
}

// `a`, `this`, `a.b.c`, `a['b']`: read again with no side effect.
function isNameChain(node) {
  while (t.isMemberExpression(node) && (!node.computed || t.isStringLiteral(node.property))) node = node.object;
  return t.isIdentifier(node) || t.isThisExpression(node);
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
// where it stands, and each read of a live one the read `props.<key>`. With
// a default, one read into a temporary: a read once the component has
// returned builds the value again.
function readAtUse(fnPath, found, propsId, state) {
  const entries = [
    ...found.placed.map((entry) => [entry, () => placingRead(propsId, entry.key, state)]),
    ...found.live.map((entry) => [entry, () => pathRead(propRead(propsId, entry.key), entry.path)]),
  ];
  for (const [entry, read] of entries) {
    const { key, binding } = entry;
    let fallback = entry.fallback;
    if (entry.hoist) {
      // The default, made once when the component runs.
      const made = fnPath.scope.generateUidIdentifier(`${key}Default`);
      fnPath.scope.push({ id: made, init: fallback, kind: 'const' });
      fallback = made;
    }
    for (const ref of binding.referencePaths) {
      // `{ id }` in an object literal names the prop's value.
      if (ref.parentPath.isObjectProperty({ shorthand: true }) && ref.key === 'value') ref.parent.shorthand = false;
    }
    if (fallback === null) {
      for (const ref of binding.referencePaths) ref.replaceWith(read());
      continue;
    }
    if (!state.ssr && found.placed.some((entry) => entry.binding === binding)) {
      // The DOM back end's placing read takes the default (dom.js _place),
      // which a live prop applies at each read.
      for (const ref of binding.referencePaths) ref.replaceWith(placingRead(propsId, key, state, fallback));
      continue;
    }
    const temp = fnPath.scope.generateUidIdentifier(key);
    for (const ref of binding.referencePaths) {
      ref.replaceWith(t.conditionalExpression(
        t.binaryExpression('===', t.assignmentExpression('=', t.cloneNode(temp), read()), t.unaryExpression('void', t.numericLiteral(0))),
        t.cloneNode(fallback),
        t.cloneNode(temp),
      ));
    }
    fnPath.scope.push({ id: temp });
  }
}

// `read.a.b` for a nested pattern's path, `read?.a` where the pattern
// defaults to `{}`.
function pathRead(read, path) {
  if (path === undefined) return read;
  for (const { name, optional } of path) {
    const k = propKey(name);
    read = optional ? t.optionalMemberExpression(read, k, !t.isIdentifier(k), true) : t.memberExpression(read, k, !t.isIdentifier(k));
  }
  return read;
}

// `props.<key>`, a live read (not a placing one).
function propRead(propsId, key) {
  const k = propKey(key);
  return t.memberExpression(t.cloneNode(propsId), k, !t.isIdentifier(k));
}

// Declarators for the pattern's other properties, read from `source`. The
// rest object names the keys it leaves out instead: destructuring a placed
// prop into nothing would read it.
function otherProps(fnPath, found, source, state) {
  const named = found.rest === null ? found.others : found.others.slice(0, -1);
  const declarators = [];
  if (named.length > 0) declarators.push(t.variableDeclarator(t.objectPattern(named), t.cloneNode(source)));
  if (found.rest !== null) {
    const excluded = [...new Set([...found.placed.map((p) => p.key), ...found.live.map((p) => p.key), ...named.map((p) => propertyName(p.key, p.computed))])].map((name) => t.stringLiteral(name));
    // The DOM back end's rest keeps live props live (render.js _$omit); the
    // server renders once and reads them.
    const omit = state.ssr ? fnPath.hub.addHelper('objectWithoutProperties') : helper(state, '_$omit');
    const without = t.callExpression(omit, [t.cloneNode(source), t.arrayExpression(excluded)]);
    const rest = t.variableDeclarator(found.rest.argument, without);
    // It holds the props' getters: its reads are props reads (readRestsWhereUsed).
    rest._whatPropsRest = true;
    (fnPath.node._whatPropsRests ||= []).push(found.rest.argument.name);
    declarators.push(rest);
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

// A component placed in SVG or MathML, or in HTML inside one of them (an
// integration point), also gets `_whatPlacedNs` (1 SVG, 2 MathML, 0 HTML):
// what-core creates a tag held in a binding below it that SVG and HTML both
// name in that namespace (render.js _$inNs).
export function annotateNamespaces(root) {
  const visit = (node, ns, foreign = false) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, ns, foreign);
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
        const within = foreign || own === 'svg' || own === 'math';
        visit(node.openingElement.attributes, inner, within);
        visit(node.children, inner, within);
      } else {
        // A component renders its children where it stands.
        node._whatNs = ns;
        if (ns === 'svg' || ns === 'math') node._whatPlacedNs = ns === 'svg' ? 1 : 2;
        else if (foreign) node._whatPlacedNs = 0;
        visit(node.openingElement.attributes, ns, foreign);
        visit(node.children, ns, foreign);
      }
      return;
    }
    if (node.type === 'JSXFragment') {
      node._whatNs = ns;
      visit(node.children, ns, foreign);
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] || []) visit(node[key], ns, foreign);
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
  const isMatch = (child) => t.isJSXElement(child) && (controlFlowTag(child, state) === 'Match'
    || (armsProveIt && t.isJSXIdentifier(child.openingElement.name, { name: 'Match' })));
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
