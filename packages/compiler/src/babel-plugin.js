/**
 * What Framework Babel Plugin — Fine-Grained Only
 *
 * JSX → template() + insert() + effect() calls
 * Static HTML extracted to module-level templates, dynamic expressions wrapped in effects.
 * Components run ONCE. All reactivity is signal-driven.
 *
 * Output:
 *   const _tmpl$1 = template('<div class="container"><h1>Title</h1><p></p></div>');
 *   function App() {
 *     const _el$ = _tmpl$1();
 *     insert(_el$.childNodes[1], () => desc());
 *     return _el$;
 *   }
 *
 * Template calls are hoisted to module scope — each unique HTML string gets one
 * top-level const. Component functions just clone: `const _el$ = _tmpl$1()`.
 */

const EVENT_MODIFIERS = new Set(['preventDefault', 'stopPropagation', 'once', 'capture', 'passive', 'self']);
const EVENT_OPTION_MODIFIERS = new Set(['once', 'capture', 'passive']);
const VOID_HTML_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

// Events that use document-level delegation for performance.
// The compiler emits `el.$$click = handler` instead of addEventListener.
// A one-time document listener walks event.target upward to find the handler.
const DELEGATED_EVENTS = new Set([
  'click', 'input', 'change', 'keydown', 'keyup', 'submit',
  'focusin', 'focusout', 'mousedown', 'mouseup',
]);

// Known non-reactive call expressions — these should NOT be wrapped in effects
// unless their arguments contain signal reads.
const SAFE_GLOBAL_CALLS = new Set([
  'Math', 'Number', 'String', 'Boolean', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'JSON', 'Date', 'Array', 'Object',
  'console', 'RegExp',
]);

// Known signal-creating functions
const SIGNAL_CREATORS = new Set([
  'useSignal', 'signal', 'computed', 'useComputed', 'useState', 'useReducer',
  'createResource', 'useSWR', 'useQuery', 'useInfiniteQuery',
]);

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
function normalizeJsxText(value) {
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

export default function whatBabelPlugin({ types: t }) {
  // =====================================================
  // Shared utilities
  // =====================================================

  // Warn-once tracking for unknown event modifier segments. Keyed by
  // `${filename}::${segment}` so each typo is reported at most once per file
  // per compile process. Without the filename in the key, the same typo in
  // two different files would silently warn for the first file only —
  // problematic in long-running Vite dev servers.
  const _unknownModifierWarned = new Set();
  const _forInfoWarned = new Set();

  function hasEventModifiers(name, state) {
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

  function parseEventModifiers(name) {
    // Support both '|' (template strings) and '__' (JSX-safe) as modifier delimiters
    const delimiter = name.includes('|') ? '|' : '__';
    const parts = name.split(delimiter);
    const eventName = parts[0];
    const modifiers = parts.slice(1).filter(m => EVENT_MODIFIERS.has(m));
    return { eventName, modifiers };
  }

  function isBindingAttribute(name) {
    return name.startsWith('bind:');
  }

  function getBindingProperty(name) {
    return name.slice(5);
  }

  function isComponent(name) {
    return /^[A-Z]/.test(name);
  }

  function isVoidHtmlElement(name) {
    return VOID_HTML_ELEMENTS.has(String(name).toLowerCase());
  }

  function getAttributeValue(value) {
    if (!value) return t.booleanLiteral(true);
    if (t.isJSXExpressionContainer(value)) return value.expression;
    if (t.isStringLiteral(value)) return value;
    return t.stringLiteral(value.value || '');
  }

  function normalizeAttrName(attrName) {
    if (attrName === 'className') return 'class';
    if (attrName === 'htmlFor') return 'for';
    return attrName;
  }

  // Safely extract attribute name, handling JSXNamespacedName (e.g., client:idle, bind:value)
  function getAttrName(attr) {
    if (t.isJSXNamespacedName(attr.name)) {
      return `${attr.name.namespace.name}:${attr.name.name.name}`;
    }
    return typeof attr.name.name === 'string' ? attr.name.name : String(attr.name.name);
  }

  function createEventHandler(handler, modifiers) {
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
  // Reactivity Detection — Signal-Aware
  // =====================================================

  // Check if an identifier is known to be a signal (from useSignal/signal/computed/useState)
  function isSignalIdentifier(name, signalNames) {
    return signalNames.has(name);
  }

  // Collect signal identifiers using Babel's scope analysis.
  // Walks the scope chain from the given path upward, collecting signals
  // defined in each lexical scope (function/block).
  function collectSignalNamesFromScope(path) {
    const signalNames = new Set();

    // Helper: extract signal names from a VariableDeclarator node
    function extractFromDeclarator(decl) {
      const init = decl.init;
      if (!init || !t.isCallExpression(init)) return;

      const callee = init.callee;
      let calleeName = '';
      if (t.isIdentifier(callee)) {
        calleeName = callee.name;
      } else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
        calleeName = callee.property.name;
      }

      if (SIGNAL_CREATORS.has(calleeName)) {
        const id = decl.id;
        if (t.isIdentifier(id)) {
          signalNames.add(id.name);
        } else if (t.isArrayPattern(id)) {
          for (const el of id.elements) {
            if (t.isIdentifier(el)) signalNames.add(el.name);
          }
        } else if (t.isObjectPattern(id)) {
          for (const prop of id.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
              signalNames.add(prop.value.name);
            }
          }
        }
      }
    }

    // Walk up the scope chain using Babel's scope API
    let scope = path.scope;
    while (scope) {
      // Check all bindings in this scope
      for (const [name, binding] of Object.entries(scope.bindings)) {
        if (binding.path.isVariableDeclarator()) {
          extractFromDeclarator(binding.path.node);
        }
        // Also check function params (destructured props)
        if (binding.path.isIdentifier() || binding.kind === 'param') {
          const fnPath = binding.scope.path;
          if (fnPath && fnPath.node && fnPath.node.params) {
            for (const param of fnPath.node.params) {
              if (t.isObjectPattern(param)) {
                for (const prop of param.properties) {
                  if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
                    signalNames.add(prop.value.name);
                  } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
                    signalNames.add(prop.argument.name);
                  }
                }
              }
            }
          }
        }
      }
      scope = scope.parent;
    }

    return signalNames;
  }

  // Legacy wrapper for backward compat (used in collectSignalNames calls)
  function collectSignalNames(path) {
    return collectSignalNamesFromScope(path);
  }

  // Check if a call expression is a safe (non-reactive) global call
  function isSafeGlobalCall(expr) {
    if (!t.isCallExpression(expr)) return false;
    const callee = expr.callee;

    // Math.max(), Number.parseInt(), etc.
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.object)) {
      return SAFE_GLOBAL_CALLS.has(callee.object.name);
    }

    // parseInt(), isNaN(), etc.
    if (t.isIdentifier(callee)) {
      return SAFE_GLOBAL_CALLS.has(callee.name);
    }

    return false;
  }

  // Check if an expression's reactivity is uncertain — e.g., a non-signal function call
  // whose arguments happen to contain signal reads. The function itself may not produce
  // a reactive result, so the compiler wraps it conservatively.
  function isUncertainReactive(expr, signalNames, importedIds) {
    if (!signalNames) return false;
    if (t.isCallExpression(expr)) {
      // Callee is a known signal — definitely reactive, not uncertain
      if (t.isIdentifier(expr.callee) && isSignalIdentifier(expr.callee.name, signalNames)) {
        return false;
      }
      // Imported identifier called as function — definitely reactive (not uncertain)
      if (importedIds && t.isIdentifier(expr.callee) && importedIds.has(expr.callee.name) &&
          !SAFE_GLOBAL_CALLS.has(expr.callee.name)) {
        return false;
      }
      // Callee is a member of a known signal — definitely reactive
      if (t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.object) &&
          isSignalIdentifier(expr.callee.object.name, signalNames)) {
        return false;
      }
      // Safe global call (Math.max, etc.) with reactive args — still deterministic, not uncertain
      if (isSafeGlobalCall(expr)) return false;
      // Unknown function call — if args are reactive, the wrapping is uncertain
      if (expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds))) {
        return true;
      }
    }
    return false;
  }

  // Check if an expression is potentially reactive (reads a signal)
  // importedIds: Set of identifiers imported from other modules — any imported
  // function call is conservatively treated as potentially reactive since the
  // imported binding could be a signal from another file.
  function isPotentiallyReactive(expr, signalNames, importedIds) {
    if (!signalNames) signalNames = new Set();

    if (t.isCallExpression(expr)) {
      // If callee is a known signal identifier being called (signal read), it's reactive
      if (t.isIdentifier(expr.callee) && isSignalIdentifier(expr.callee.name, signalNames)) {
        return true;
      }
      // Imported identifier called as a function — conservatively reactive.
      // Handles: import { count } from './store'; ... {count()} in JSX
      if (importedIds && t.isIdentifier(expr.callee) && importedIds.has(expr.callee.name)) {
        // Exclude known safe globals that happen to also be imported
        if (!SAFE_GLOBAL_CALLS.has(expr.callee.name)) {
          return true;
        }
      }
      // member.call() — e.g., data(), isLoading()
      if (t.isMemberExpression(expr.callee)) {
        // Check if the object is a signal
        if (t.isIdentifier(expr.callee.object) && isSignalIdentifier(expr.callee.object.name, signalNames)) {
          return true;
        }
      }
      // Safe global calls like Math.max — only reactive if their args are
      if (isSafeGlobalCall(expr)) {
        return expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds));
      }
      // Unknown call — check if callee or args contain signal reads
      if (t.isIdentifier(expr.callee)) {
        // Could be a function that reads signals internally
        // Be conservative: if it's not a known safe call and not a signal, still check args
        return expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds));
      }
      // For any other call expression, check recursively
      return isPotentiallyReactive(expr.callee, signalNames, importedIds) ||
             expr.arguments.some(arg => isPotentiallyReactive(arg, signalNames, importedIds));
    }

    if (t.isIdentifier(expr)) {
      return isSignalIdentifier(expr.name, signalNames) ||
             (importedIds && importedIds.has(expr.name));
    }

    if (t.isMemberExpression(expr)) {
      return isPotentiallyReactive(expr.object, signalNames, importedIds);
    }

    if (t.isConditionalExpression(expr)) {
      return isPotentiallyReactive(expr.test, signalNames, importedIds) ||
             isPotentiallyReactive(expr.consequent, signalNames, importedIds) ||
             isPotentiallyReactive(expr.alternate, signalNames, importedIds);
    }

    if (t.isBinaryExpression(expr) || t.isLogicalExpression(expr)) {
      return isPotentiallyReactive(expr.left, signalNames, importedIds) ||
             isPotentiallyReactive(expr.right, signalNames, importedIds);
    }

    if (t.isUnaryExpression(expr)) {
      return isPotentiallyReactive(expr.argument, signalNames, importedIds);
    }

    if (t.isTemplateLiteral(expr)) {
      return expr.expressions.some(e => isPotentiallyReactive(e, signalNames, importedIds));
    }

    if (t.isObjectExpression(expr)) {
      return expr.properties.some(prop =>
        t.isObjectProperty(prop) && isPotentiallyReactive(prop.value, signalNames, importedIds)
      );
    }

    if (t.isArrayExpression(expr)) {
      return expr.elements.some(el => el && isPotentiallyReactive(el, signalNames, importedIds));
    }

    if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
      // Function expressions are not reactive themselves — they're callbacks
      return false;
    }

    return false;
  }

  // --- Auto-lower .map() to mapArray ---
  // Detects: source().map((item) => <Comp key={expr} .../>)
  // or wrapped in an arrow: () => source().map(...)
  // Also walks into ternary (cond ? a.map(...) : fallback) and
  // logical (cond && a.map(...)) expressions so React-style
  // conditional list patterns get keyed reconciliation.
  // Produces: _$mapArray(source, (item) => <Comp .../>, { key: item => expr })
  function tryLowerMapToMapArray(expr, state) {
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
    // Check: something.map(fn)
    if (!t.isCallExpression(mapCall)) return null;
    if (!t.isMemberExpression(mapCall.callee)) return null;
    if (!t.isIdentifier(mapCall.callee.property, { name: 'map' })) return null;
    if (mapCall.arguments.length < 1) return null;

    const mapFn = mapCall.arguments[0];
    if (!t.isArrowFunctionExpression(mapFn) && !t.isFunctionExpression(mapFn)) return null;

    // Get the map callback's return expression
    let returnExpr = null;
    if (t.isArrowFunctionExpression(mapFn)) {
      if (t.isExpression(mapFn.body)) {
        returnExpr = mapFn.body;
      } else if (t.isBlockStatement(mapFn.body)) {
        const ret = mapFn.body.body.find(s => t.isReturnStatement(s));
        if (ret) returnExpr = ret.argument;
      }
    } else if (t.isFunctionExpression(mapFn)) {
      const ret = mapFn.body.body.find(s => t.isReturnStatement(s));
      if (ret) returnExpr = ret.argument;
    }

    if (!returnExpr) return null;

    // Check if the return is JSX with a `key` prop
    if (!t.isJSXElement(returnExpr)) return null;
    const attrs = returnExpr.openingElement.attributes;
    let keyAttr = null;
    for (const attr of attrs) {
      if (t.isJSXAttribute(attr) && getAttrName(attr) === 'key') {
        keyAttr = attr;
        break;
      }
    }
    if (!keyAttr) {
      // JSX returned without a key — bail out, but warn at compile time so
      // users notice they're missing keyed reconciliation. Only warn in dev
      // (production builds are noiseless).
      if (process.env.NODE_ENV !== 'production') {
        const loc = returnExpr.loc;
        const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
        const lineInfo = loc ? `:${loc.start.line}:${loc.start.column}` : '';
        console.warn(
          `[what-compiler] .map() returning JSX without a \`key\` prop at ${fileName}${lineInfo}. ` +
          `Without a key, the list cannot use keyed reconciliation — items are re-created on every update. ` +
          `Add key={...} to enable efficient updates.`
        );
      }
      return null;
    }

    // Extract the key expression
    const keyValue = getAttributeValue(keyAttr.value);
    if (!keyValue) return null;

    // Remove the key prop from the JSX element (mapArray handles keying, not the DOM)
    returnExpr.openingElement.attributes = attrs.filter(a => a !== keyAttr);

    // Build the source: the object before .map() — wrap in an arrow for reactive access
    const sourceObj = mapCall.callee.object;
    const source = t.arrowFunctionExpression([], sourceObj);

    // Build the key function: (item) => keyExpr.
    // Clone both the parameter and the key expression — the parameter is shared
    // with the user's map callback AST and keyValue may be referenced elsewhere
    // in the tree. Cloning insulates this new arrow from later mutations.
    const itemParam = mapFn.params[0] ? t.cloneNode(mapFn.params[0], true) : t.identifier('_item');
    const keyFn = t.arrowFunctionExpression([itemParam], t.cloneNode(keyValue, true));

    // Build: _$mapArray(source, mapFn, { key: keyFn, raw: true })
    // raw: true means mapFn receives the raw item value (not a signal accessor),
    // matching user-authored .map() semantics where `item.prop` accesses values directly.
    return t.callExpression(t.identifier('_$mapArray'), [
      source,
      mapFn,
      t.objectExpression([
        t.objectProperty(t.identifier('key'), keyFn),
        t.objectProperty(t.identifier('raw'), t.booleanLiteral(true))
      ])
    ]);
  }

  // =====================================================
  // Fine-Grained Mode (template + insert + effect)
  // =====================================================

  // Check if a JSX child is static (no expressions)
  function isStaticChild(child) {
    if (t.isJSXText(child)) return true;
    if (t.isJSXExpressionContainer(child)) return false;
    if (t.isJSXElement(child)) {
      const el = child.openingElement;
      const tagName = el.name.name;
      if (isComponent(tagName)) return false;
      for (const attr of el.attributes) {
        if (t.isJSXSpreadAttribute(attr)) return false;
        const value = attr.value;
        if (t.isJSXExpressionContainer(value)) return false;
      }
      return child.children.every(isStaticChild);
    }
    return false;
  }

  // Check if an attribute value is dynamic
  function isDynamicAttr(attr) {
    if (t.isJSXSpreadAttribute(attr)) return true;
    if (!attr.value) return false;
    return t.isJSXExpressionContainer(attr.value);
  }

  // Extract static HTML from JSX element for template()
  function extractStaticHTML(node) {
    if (t.isJSXText(node)) {
      const text = normalizeJsxText(node.value);
      return text ? escapeHTML(text) : '';
    }

    if (t.isJSXExpressionContainer(node)) {
      if (t.isJSXEmptyExpression(node.expression)) return '';
      return '<!--$-->';
    }

    if (!t.isJSXElement(node)) return '';

    const el = node.openingElement;
    const tagName = el.name.name;

    if (isComponent(tagName)) return '';

    let html = `<${tagName}`;

    for (const attr of el.attributes) {
      if (t.isJSXSpreadAttribute(attr)) continue;
      const name = getAttrName(attr);
      if (name === 'key') continue;
      if (name.startsWith('on') || name.startsWith('bind:') || name.includes('|')) continue;

      let domName = name;
      if (name === 'className') domName = 'class';
      if (name === 'htmlFor') domName = 'for';

      if (!attr.value) {
        html += ` ${domName}`;
      } else if (t.isStringLiteral(attr.value)) {
        html += ` ${domName}="${escapeAttr(attr.value.value)}"`;
      } else if (t.isJSXExpressionContainer(attr.value)) {
        continue; // Dynamic attr — set via effect
      }
    }

    const selfClosing = node.openingElement.selfClosing;
    if (selfClosing && isVoidHtmlElement(tagName)) {
      html += '>';
      return html;
    }

    if (selfClosing) {
      html += `></${tagName}>`;
      return html;
    }

    html += '>';

    for (const child of node.children) {
      if (t.isJSXText(child)) {
        const text = normalizeJsxText(child.value);
        if (text) html += escapeHTML(text);
      } else if (t.isJSXExpressionContainer(child)) {
        if (!t.isJSXEmptyExpression(child.expression)) {
          html += '<!--$-->';
        }
      } else if (t.isJSXElement(child)) {
        if (isComponent(child.openingElement.name.name)) {
          html += '<!--$-->';
        } else {
          html += extractStaticHTML(child);
        }
      }
    }

    html += `</${tagName}>`;
    return html;
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

    // Control flow components — check before generic isComponent since they start uppercase
    if (tagName === 'For') {
      return transformForFineGrained(path, state);
    }
    if (tagName === 'Show') {
      return transformShowFineGrained(path, state);
    }

    if (isComponent(tagName)) {
      return transformComponentFineGrained(path, state);
    }

    const attributes = openingElement.attributes;
    const children = node.children;

    // Check if this entire subtree is purely static
    const allChildrenStatic = children.every(isStaticChild);
    const allAttrsStatic = attributes.every(attr => !isDynamicAttr(attr));
    const noEvents = attributes.every(attr => {
      if (t.isJSXSpreadAttribute(attr)) return false;
      const name = getAttrName(attr);
      return !name?.startsWith('on') && !name?.startsWith('bind:');
    });

    if (allChildrenStatic && allAttrsStatic && noEvents) {
      // Fully static element — extract to template, return clone call
      const html = extractStaticHTML(node);
      if (html) {
        const tmplId = getOrCreateTemplate(state, html);
        state.needsTemplate = true;
        return t.callExpression(t.identifier(tmplId), []);
      }
    }

    // Mixed static/dynamic element — extract template, add effects for dynamic parts
    const html = extractStaticHTML(node);
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
      state.needsH = true;
      return transformElementAsH(path, state);
    }

    const tmplId = getOrCreateTemplate(state, html);
    state.needsTemplate = true;

    const elId = state.nextVarId();

    // Build statements: _el$ = _tmpl$1()
    // NO IIFE wrapping — statements are inlined into the containing function
    const statements = [
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(elId), t.callExpression(t.identifier(tmplId), []))
      ])
    ];

    // Apply dynamic attributes and events
    applyDynamicAttrs(statements, elId, attributes, state);

    // Handle dynamic children
    applyDynamicChildren(statements, elId, children, node, state);

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
      let domAttrName = normalizeAttrName(attrName);
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
    return t.callExpression(t.identifier('h'), [t.stringLiteral(tagName), propsExpr, ...transformedChildren]);
  }

  function applyDynamicAttrs(statements, elId, attributes, state) {
    function buildSetPropCall(propName, valueExpr) {
      state.needsSetProp = true;
      return t.callExpression(t.identifier('_$setProp'), [
        t.identifier(elId),
        t.stringLiteral(propName),
        valueExpr
      ]);
    }

    for (const attr of attributes) {
      if (t.isJSXSpreadAttribute(attr)) {
        state.needsSpread = true;
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier('_$spread'), [t.identifier(elId), attr.argument])
          )
        );
        continue;
      }

      const attrName = getAttrName(attr);

      // Strip key prop — WhatFW has no virtual DOM, so key is meaningless (issue #6)
      if (attrName === 'key') continue;

      // Ref handling — assign element to ref object/callback
      if (attrName === 'ref') {
        const refExpr = getAttributeValue(attr.value);
        // Generate: typeof ref === 'function' ? ref(el) : ref.current = el
        statements.push(
          t.expressionStatement(
            t.conditionalExpression(
              t.binaryExpression('===',
                t.unaryExpression('typeof', refExpr),
                t.stringLiteral('function')
              ),
              t.callExpression(t.cloneNode(refExpr), [t.identifier(elId)]),
              t.assignmentExpression('=',
                t.memberExpression(t.cloneNode(refExpr), t.identifier('current')),
                t.identifier(elId)
              )
            )
          )
        );
        continue;
      }

      // Event handlers
      if (attrName.startsWith('on') && !attrName.includes('|') && !hasEventModifiers(attrName, state)) {
        const event = attrName.slice(2).toLowerCase();
        const handler = getAttributeValue(attr.value);

        if (DELEGATED_EVENTS.has(event)) {
          // Use event delegation: el.$$click = handler (matches runtime lookup)
          state.needsDelegation = true;
          if (!state.delegatedEvents) state.delegatedEvents = new Set();
          state.delegatedEvents.add(event);
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
          // Non-delegated: use per-element addEventListener
          statements.push(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.identifier(elId), t.identifier('addEventListener')),
                [t.stringLiteral(event), handler]
              )
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
            t.callExpression(
              t.memberExpression(t.identifier(elId), t.identifier('addEventListener')),
              addEventArgs
            )
          )
        );
        continue;
      }

      // Binding
      if (isBindingAttribute(attrName)) {
        const bindProp = getBindingProperty(attrName);
        const signalExpr = attr.value.expression;
        state.needsEffect = true;

        if (bindProp === 'value') {
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier('_$effect'), [
                t.arrowFunctionExpression([], t.assignmentExpression('=',
                  t.memberExpression(t.identifier(elId), t.identifier('value')),
                  t.callExpression(t.cloneNode(signalExpr), [])
                ))
              ])
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
          state.needsEffect = true;
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier('_$effect'), [
                t.arrowFunctionExpression([], t.assignmentExpression('=',
                  t.memberExpression(t.identifier(elId), t.identifier('checked')),
                  t.callExpression(t.cloneNode(signalExpr), [])
                ))
              ])
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
        const domName = normalizeAttrName(attrName);

        if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
          state.needsEffect = true;
          // Auto-invoke bare signal/imported identifiers: value={name} -> name()
          const valueExpr = t.isIdentifier(expr) &&
            (isSignalIdentifier(expr.name, state.signalNames) ||
             (state.importedIdentifiers && state.importedIdentifiers.has(expr.name)))
            ? t.callExpression(expr, [])
            : expr;
          const effectCall = t.callExpression(t.identifier('_$effect'), [
            t.arrowFunctionExpression([], buildSetPropCall(domName, valueExpr))
          ]);
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
      }
    }
  }

  function applyDynamicChildren(statements, elId, children, parentNode, state) {
    // Two-pass approach: first collect all children needing DOM references,
    // then pre-capture markers before any _$insert() calls shift indices.
    // This fixes issue #1: childNodes index shifting with multiple dynamic children.

    // --- Pass 1: Scan children and collect entries ---
    const entries = [];
    let childIndex = 0;

    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = normalizeJsxText(child.value);
        if (text) childIndex++;
        continue;
      }

      if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) continue;
        entries.push({ type: 'expression', child, childIndex });
        childIndex++;
        continue;
      }

      if (t.isJSXElement(child)) {
        const childTag = child.openingElement.name.name;
        if (isComponent(childTag) || childTag === 'For' || childTag === 'Show') {
          entries.push({ type: 'component', child, childIndex });
          childIndex++;
        } else {
          const hasAnythingDynamic = child.openingElement.attributes.some(isDynamicAttr) ||
            child.openingElement.attributes.some(a => !t.isJSXSpreadAttribute(a) && getAttrName(a)?.startsWith('on')) ||
            !child.children.every(isStaticChild);

          entries.push({ type: 'static', child, childIndex, hasAnythingDynamic });
          childIndex++;
        }
        continue;
      }

      if (t.isJSXFragment(child)) {
        entries.push({ type: 'fragment', child });
      }
    }

    // --- Pre-capture marker references if needed ---
    // When there are multiple entries needing DOM refs and at least one _$insert(),
    // capture all markers upfront to avoid index shifting after DOM mutations.
    const entriesNeedingRef = entries.filter(e =>
      e.type === 'expression' || e.type === 'component' ||
      (e.type === 'static' && e.hasAnythingDynamic)
    );
    const hasDynamicInsert = entries.some(e => e.type === 'expression' || e.type === 'component');
    const needsPreCapture = entriesNeedingRef.length >= 2 && hasDynamicInsert;

    const markerVars = new Map(); // childIndex → variable name
    if (needsPreCapture) {
      for (const entry of entriesNeedingRef) {
        const varName = `_m$${entry.childIndex}`;
        // Use a unique name to avoid collisions with element vars
        const markerVar = state.nextVarId();
        markerVars.set(entry.childIndex, markerVar);
        statements.push(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier(markerVar),
              buildChildAccess(elId, entry.childIndex)
            )
          ])
        );
      }
    }

    // Helper: get a marker reference (pre-captured var or inline access)
    function getMarker(idx) {
      if (markerVars.has(idx)) {
        return t.identifier(markerVars.get(idx));
      }
      return buildChildAccess(elId, idx);
    }

    // --- Pass 2: Generate code using stable references ---
    for (const entry of entries) {
      if (entry.type === 'expression') {
        let expr = entry.child.expression;
        const marker = getMarker(entry.childIndex);
        state.needsInsert = true;

        // Auto-lower .map() to mapArray when the callback returns keyed JSX.
        // Pattern: source().map(item => <Comp key={...} />) or source().map((item, i) => ...)
        const mapResult = tryLowerMapToMapArray(expr, state);
        if (mapResult) {
          state.needsMapArray = true;
          // A bare _$mapArray(...) call is a self-managing inserter (it tracks
          // its source internally) and an arrow is already reactive — pass both
          // raw. But when lowering produced a ternary/logical wrapping the call
          // (e.g. cond ? _$mapArray(...) : fallback), the surrounding condition
          // must stay reactive, so wrap the whole expression in () => and let
          // _$insert re-evaluate it on change. Without this the condition is read
          // exactly once and never re-tracks. (AUDIT-2026-06-06 H1)
          const isBareMapArray = t.isCallExpression(mapResult) && t.isIdentifier(mapResult.callee) &&
            (mapResult.callee.name === '_$mapArray' || mapResult.callee.name === 'mapArray');
          const isArrowAlready = t.isArrowFunctionExpression(mapResult);
          const insertArg = (isBareMapArray || isArrowAlready)
            ? mapResult
            : t.arrowFunctionExpression([], mapResult);
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier('_$insert'), [
                t.identifier(elId),
                insertArg,
                marker
              ])
            )
          );
          continue;
        }

        // mapArray() calls return self-managing inserters — pass directly, never wrap in () =>
        const isMapArrayCall = t.isCallExpression(expr) && t.isIdentifier(expr.callee) &&
          (expr.callee.name === 'mapArray' || expr.callee.name === '_$mapArray');
        if (isMapArrayCall) {
          state.needsMapArray = true;
          if (expr.callee.name === 'mapArray') expr.callee.name = '_$mapArray';
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier('_$insert'), [
                t.identifier(elId),
                expr,
                marker
              ])
            )
          );
          continue;
        }

        if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
          const insertCall = t.callExpression(t.identifier('_$insert'), [
            t.identifier(elId),
            t.arrowFunctionExpression([], expr),
            marker
          ]);
          if (isUncertainReactive(expr, state.signalNames, state.importedIdentifiers)) {
            t.addComment(insertCall, 'leading',
              ' @what-dev: reactive wrapping may be unnecessary — expression contains a non-signal function call with reactive args ',
              false
            );
          }
          statements.push(t.expressionStatement(insertCall));
        } else {
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier('_$insert'), [
                t.identifier(elId),
                expr,
                marker
              ])
            )
          );
        }
        continue;
      }

      if (entry.type === 'component') {
        const transformed = transformElementFineGrained({ node: entry.child }, state);
        const marker = getMarker(entry.childIndex);
        state.needsInsert = true;
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier('_$insert'), [
              t.identifier(elId),
              transformed,
              marker
            ])
          )
        );
        continue;
      }

      if (entry.type === 'static' && entry.hasAnythingDynamic) {
        // Static child with dynamic content — get element reference
        let childElRef;
        if (markerVars.has(entry.childIndex)) {
          childElRef = markerVars.get(entry.childIndex);
        } else {
          childElRef = state.nextVarId();
          statements.push(
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.identifier(childElRef),
                buildChildAccess(elId, entry.childIndex)
              )
            ])
          );
        }
        applyDynamicAttrs(statements, childElRef, entry.child.openingElement.attributes, state);
        applyDynamicChildren(statements, childElRef, entry.child.children, entry.child, state);
        continue;
      }

      if (entry.type === 'fragment') {
        for (const fChild of entry.child.children) {
          if (t.isJSXExpressionContainer(fChild) && !t.isJSXEmptyExpression(fChild.expression)) {
            state.needsInsert = true;
            const expr = fChild.expression;
            if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
              statements.push(
                t.expressionStatement(
                  t.callExpression(t.identifier('_$insert'), [
                    t.identifier(elId),
                    t.arrowFunctionExpression([], expr)
                  ])
                )
              );
            } else {
              statements.push(
                t.expressionStatement(
                  t.callExpression(t.identifier('_$insert'), [
                    t.identifier(elId),
                    expr
                  ])
                )
              );
            }
          }
        }
      }
    }
  }

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
    const componentName = openingElement.name.name;
    const attributes = openingElement.attributes;
    const children = node.children;

    // Check for client: directive (islands)
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
          const mode = name.slice(7);
          if (attr.value) {
            clientDirective = { type: mode, value: attr.value.value };
          } else {
            clientDirective = { type: mode };
          }
          continue;
        }
      }
      filteredAttrs.push(attr);
    }

    if (clientDirective) {
      state.needsCreateComponent = true;
      state.needsIsland = true;

      const islandProps = [
        t.objectProperty(t.identifier('component'), t.identifier(componentName)),
        t.objectProperty(t.identifier('mode'), t.stringLiteral(clientDirective.type)),
      ];

      if (clientDirective.value) {
        islandProps.push(
          t.objectProperty(t.identifier('mediaQuery'), t.stringLiteral(clientDirective.value))
        );
      }

      for (const attr of filteredAttrs) {
        if (t.isJSXSpreadAttribute(attr)) continue;
        const attrName = getAttrName(attr);
        const value = getAttributeValue(attr.value);
        islandProps.push(t.objectProperty(t.identifier(attrName), value));
      }

      return t.callExpression(
        t.identifier('_$createComponent'),
        [t.identifier('Island'), t.objectExpression(islandProps), t.arrayExpression([])]
      );
    }

    // Regular component — use _$createComponent to instantiate, component runs once
    state.needsCreateComponent = true;

    const props = [];
    let hasSpread = false;
    let spreadExpr = null;

    for (const attr of filteredAttrs) {
      if (t.isJSXSpreadAttribute(attr)) {
        hasSpread = true;
        spreadExpr = attr.argument;
        continue;
      }

      const attrName = getAttrName(attr);

      // Strip key prop — WhatFW has no virtual DOM, so key is meaningless (issue #6)
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

      props.push(
        t.objectProperty(
          /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(attrName)
            ? t.identifier(attrName)
            : t.stringLiteral(attrName),
          value
        )
      );
    }

    // Transform children
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

    let propsExpr;
    if (hasSpread) {
      if (props.length > 0) {
        propsExpr = t.callExpression(
          t.memberExpression(t.identifier('Object'), t.identifier('assign')),
          [t.objectExpression([]), spreadExpr, t.objectExpression(props)]
        );
      } else {
        propsExpr = spreadExpr;
      }
    } else if (props.length > 0) {
      propsExpr = t.objectExpression(props);
    } else {
      propsExpr = t.nullLiteral();
    }

    const childrenArray = transformedChildren.length > 0
      ? t.arrayExpression(transformedChildren)
      : t.arrayExpression([]);

    return t.callExpression(t.identifier('_$createComponent'), [t.identifier(componentName), propsExpr, childrenArray]);
  }

  function transformForFineGrained(path, state) {
    const { node } = path;
    const attributes = node.openingElement.attributes;
    const children = node.children;

    // <For each={data} key={item => item.id}>{(item) => <Row />}</For>
    // → mapArray(data, (item) => ..., { key: item => item.id })
    //
    // NOTE: <For> is supported but .map() with a key prop is the preferred
    // pattern for list rendering. The compiler auto-lowers .map() to
    // _$mapArray with raw mode, which is simpler and matches JS idioms.
    // <For> is useful when you need signal-wrapped item accessors (keyed
    // mode without raw), so that item updates don't recreate DOM nodes.
    if (process.env.NODE_ENV !== 'production') {
      const fileName = state.filename || state.file?.opts?.filename || '<unknown>';
      if (!_forInfoWarned.has(fileName)) {
        _forInfoWarned.add(fileName);
        const loc = node.loc;
        const lineInfo = loc ? `:${loc.start.line}:${loc.start.column}` : '';
        console.info(
          `[what-compiler] <For> at ${fileName}${lineInfo}: consider using .map() with a key prop instead. ` +
          `The compiler auto-lowers .map() to efficient keyed reconciliation. ` +
          `<For> is only needed for signal-wrapped item accessors (advanced).`
        );
      }
    }

    let eachExpr = null;
    let keyExpr = null;
    for (const attr of attributes) {
      if (t.isJSXAttribute(attr)) {
        const name = getAttrName(attr);
        if (name === 'each') eachExpr = getAttributeValue(attr.value);
        else if (name === 'key') keyExpr = getAttributeValue(attr.value);
      }
    }

    if (!eachExpr) {
      console.warn('[what-compiler] <For> element missing "each" attribute.');
      state.needsH = true;
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
      state.needsH = true;
      return transformElementAsH(path, state);
    }

    state.needsMapArray = true;
    const args = [eachExpr, renderFn];
    if (keyExpr) {
      args.push(t.objectExpression([
        t.objectProperty(t.identifier('key'), keyExpr)
      ]));
    }
    return t.callExpression(t.identifier('_$mapArray'), args);
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
      // confusion. buildCodeFrameError pins the error to the JSX location.
      throw path.buildCodeFrameError(
        '<Show> requires a "when" prop. Example: <Show when={isOpen} fallback={null}>...</Show>'
      );
    }

    // Extract the content — either a render function child or static JSX children
    let contentExpr = null;
    for (const child of children) {
      if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
        // Render function: {() => <div>...</div>} or {(value) => <div>{value}</div>}
        contentExpr = child.expression;
        break;
      }
    }

    if (!contentExpr) {
      // Static children — collect and transform them
      const transformedChildren = [];
      for (const child of children) {
        if (t.isJSXText(child)) {
          const text = normalizeJsxText(child.value);
          if (text) transformedChildren.push(t.stringLiteral(text));
        } else if (t.isJSXElement(child)) {
          transformedChildren.push(transformElementFineGrained({ node: child }, state));
        }
      }
      if (transformedChildren.length === 1) {
        contentExpr = transformedChildren[0];
      } else if (transformedChildren.length > 1) {
        contentExpr = t.arrayExpression(transformedChildren);
      } else {
        contentExpr = t.nullLiteral();
      }
    }

    // Build:
    //   () => { const _v = <condition>; return _v ? <consequent> : <alternate>; }
    // Hoisting into a local prevents double-evaluation of the `when` signal
    // (the consequent's render callback also needs the resolved value).
    //
    // `whenExpr` shape determines how we form the condition:
    //   - call expression          → use as-is              <Show when={cond()}>
    //   - arrow w/ expression body → use the body            <Show when={() => x > 5}>
    //   - identifier that looks like a signal/import        <Show when={isOpen}>
    //                              → invoke it as accessor:  isOpen()
    //   - anything else (member, literal, logical, etc.)    <Show when={user.isAdmin}>
    //                              → use the raw expression. Do NOT invoke —
    //                                non-functions would throw at runtime.
    let condition;
    if (t.isCallExpression(whenExpr)) {
      condition = whenExpr;
    } else if (t.isArrowFunctionExpression(whenExpr) && t.isExpression(whenExpr.body)) {
      condition = whenExpr.body;
    } else if (
      t.isIdentifier(whenExpr) &&
      (
        (state.signalNames && isSignalIdentifier(whenExpr.name, state.signalNames)) ||
        (state.importedIdentifiers && state.importedIdentifiers.has(whenExpr.name))
      )
    ) {
      condition = t.callExpression(whenExpr, []);
    } else {
      // Plain boolean expression — member access, literal, logical, etc.
      condition = whenExpr;
    }

    const vId = path.scope
      ? path.scope.generateUidIdentifier('v')
      : t.identifier('_v');

    const consequent = t.isFunction(contentExpr)
      ? t.callExpression(contentExpr, [t.cloneNode(vId)])
      : contentExpr;
    const alternate = fallbackExpr || t.nullLiteral();

    return t.arrowFunctionExpression([], t.blockStatement([
      t.variableDeclaration('const', [
        t.variableDeclarator(vId, condition)
      ]),
      t.returnStatement(
        t.conditionalExpression(t.cloneNode(vId), consequent, alternate)
      )
    ]));
  }

  function transformFragmentFineGrained(path, state) {
    const { node } = path;
    const children = node.children;

    const transformed = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = normalizeJsxText(child.value);
        if (text) transformed.push(t.stringLiteral(text));
      } else if (t.isJSXExpressionContainer(child)) {
        if (!t.isJSXEmptyExpression(child.expression)) {
          transformed.push(child.expression);
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

  // Template deduplication: same HTML string → same module-level const
  function getOrCreateTemplate(state, html) {
    if (state.templateMap.has(html)) {
      return state.templateMap.get(html);
    }
    const id = `_tmpl$${state.templateCount++}`;
    state.templateMap.set(html, id);
    state.templates.push({ id, html });
    return id;
  }

  // =====================================================
  // Plugin entry
  // =====================================================

  return {
    name: 'what-jsx-transform',

    visitor: {
      Program: {
        enter(path, state) {
          // Fine-grained mode state
          state.needsTemplate = false;
          state.needsInsert = false;
          state.needsEffect = false;
          state.needsMapArray = false;
          state.needsSpread = false;
          state.needsSetProp = false;
          state.needsH = false;
          state.needsCreateComponent = false;
          state.needsFragment = false;
          state.needsIsland = false;
          state.needsDelegation = false;
          state.delegatedEvents = new Set();
          state.templates = [];
          state.templateMap = new Map(); // html → template id (deduplication)
          state.templateCount = 0;
          state._varCounter = 0;
          state._pendingSetup = [];
          state.nextVarId = () => `_el$${state._varCounter++}`;

          // Collect signal names for smart reactivity detection
          state.signalNames = new Set();

          // --- Imported Signal Tracking ---
          // Only mark imports as potentially reactive if they come from known
          // reactive sources: what-framework, what-framework/*, relative paths
          // (user stores), or functions matching use*/create* naming conventions.
          // This prevents over-wrapping of utility imports (lodash, etc.).
          state.importedIdentifiers = new Set();
          for (const node of path.node.body) {
            if (t.isImportDeclaration(node)) {
              const source = node.source.value;
              const isReactiveSource =
                source === 'what-framework' ||
                source.startsWith('what-framework/') ||
                source === 'what-core' ||
                source.startsWith('what-core/') ||
                source.startsWith('./') ||
                source.startsWith('../');

              for (const spec of node.specifiers) {
                let localName = null;
                if (t.isImportSpecifier(spec) && t.isIdentifier(spec.local)) {
                  localName = spec.local.name;
                } else if (t.isImportDefaultSpecifier(spec) && t.isIdentifier(spec.local)) {
                  localName = spec.local.name;
                } else if (t.isImportNamespaceSpecifier(spec) && t.isIdentifier(spec.local)) {
                  localName = spec.local.name;
                }

                if (localName) {
                  // Mark as reactive if from a reactive source, or if the name
                  // matches use*/create* conventions (hooks/signal creators)
                  if (isReactiveSource || /^(use|create)[A-Z]/.test(localName)) {
                    state.importedIdentifiers.add(localName);
                  }
                }
              }
            }
          }

          path.traverse({
            VariableDeclarator(declPath) {
              const init = declPath.node.init;
              if (!init || !t.isCallExpression(init)) return;

              const callee = init.callee;
              let calleeName = '';
              if (t.isIdentifier(callee)) {
                calleeName = callee.name;
              } else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
                calleeName = callee.property.name;
              }

              if (SIGNAL_CREATORS.has(calleeName)) {
                const id = declPath.node.id;
                if (t.isIdentifier(id)) {
                  state.signalNames.add(id.name);
                } else if (t.isArrayPattern(id)) {
                  for (const el of id.elements) {
                    if (t.isIdentifier(el)) state.signalNames.add(el.name);
                  }
                } else if (t.isObjectPattern(id)) {
                  for (const prop of id.properties) {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
                      state.signalNames.add(prop.value.name);
                    }
                  }
                }
              }
            }
          });
        },

        exit(path, state) {
          // Insert template declarations at top of program (hoisted to module scope)
          for (const tmpl of state.templates.reverse()) {
            path.unshiftContainer('body',
              t.variableDeclaration('const', [
                t.variableDeclarator(
                  t.identifier(tmpl.id),
                  t.callExpression(t.identifier('_$template'), [t.stringLiteral(tmpl.html)])
                )
              ])
            );
          }

          // Build fine-grained imports
          const fgSpecifiers = [];
          if (state.needsTemplate) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$template'), t.identifier('template'))
            );
          }
          if (state.needsInsert) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$insert'), t.identifier('insert'))
            );
          }
          if (state.needsEffect) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$effect'), t.identifier('effect'))
            );
          }
          if (state.needsMapArray) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$mapArray'), t.identifier('mapArray'))
            );
          }
          if (state.needsSpread) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$spread'), t.identifier('spread'))
            );
          }
          if (state.needsSetProp) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$setProp'), t.identifier('setProp'))
            );
          }
          if (state.needsCreateComponent) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$createComponent'), t.identifier('_$createComponent'))
            );
          }
          if (state.needsDelegation) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier('_$delegateEvents'), t.identifier('delegateEvents'))
            );
          }

          // Core imports (h/Fragment/Island for components)
          const coreSpecifiers = [];
          if (state.needsH) {
            coreSpecifiers.push(
              t.importSpecifier(t.identifier('h'), t.identifier('h'))
            );
          }
          if (state.needsFragment) {
            coreSpecifiers.push(
              t.importSpecifier(t.identifier('Fragment'), t.identifier('Fragment'))
            );
          }
          if (state.needsIsland) {
            coreSpecifiers.push(
              t.importSpecifier(t.identifier('Island'), t.identifier('Island'))
            );
          }

          if (fgSpecifiers.length > 0) {
            let existingRenderImport = null;
            for (const node of path.node.body) {
              if (t.isImportDeclaration(node) && (
                node.source.value === 'what-framework/render' ||
                node.source.value === 'what-core/render'
              )) {
                existingRenderImport = node;
                break;
              }
            }

            if (existingRenderImport) {
              const existingNames = new Set(
                existingRenderImport.specifiers
                  .filter(s => t.isImportSpecifier(s))
                  .map(s => s.imported.name)
              );
              for (const spec of fgSpecifiers) {
                if (!existingNames.has(spec.imported.name)) {
                  existingRenderImport.specifiers.push(spec);
                }
              }
            } else {
              path.unshiftContainer('body',
                t.importDeclaration(fgSpecifiers, t.stringLiteral('what-framework/render'))
              );
            }
          }

          if (coreSpecifiers.length > 0) {
            addCoreImports(path, t, coreSpecifiers);
          }

          // Emit event delegation setup call if any delegated events were used
          if (state.needsDelegation && state.delegatedEvents && state.delegatedEvents.size > 0) {
            const eventArray = t.arrayExpression(
              [...state.delegatedEvents].map(e => t.stringLiteral(e))
            );
            path.pushContainer('body',
              t.expressionStatement(
                t.callExpression(t.identifier('_$delegateEvents'), [eventArray])
              )
            );
          }
        }
      },

      JSXElement(path, state) {
        // FIX-1: Use scope-aware signal detection instead of file-global
        state.signalNames = collectSignalNamesFromScope(path);
        state._pendingSetup = [];
        const transformed = transformElementFineGrained(path, state);
        const pending = state._pendingSetup;
        state._pendingSetup = [];

        if (pending.length > 0) {
          // Find the enclosing statement to hoist setup before it,
          // but only if it's in the SAME function scope. Crossing into
          // an inner arrow/function (e.g., .map(item => <JSX/>)) would
          // hoist references to closure variables out of scope.
          let stmtPath = path;
          let crossedFunctionBoundary = false;
          while (stmtPath && !stmtPath.isStatement()) {
            if (stmtPath.isArrowFunctionExpression() || stmtPath.isFunctionExpression()) {
              crossedFunctionBoundary = true;
            }
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
          if (inStatementList && !crossedFunctionBoundary) {
            // Same function scope — safe to hoist setup before the enclosing
            // statement. Works for return statements too: `insertBefore`
            // places setup above `return <jsx/>` without wrapping in an IIFE.
            stmtPath.insertBefore(pending);
            path.replaceWith(transformed);
          } else {
            // Crossed a function boundary or no enclosing statement found —
            // fall back to IIFE so closure variables remain in scope.
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
      },

      JSXFragment(path, state) {
        const transformed = transformFragmentFineGrained(path, state);
        path.replaceWith(transformed);
      }
    }
  };
}

function addCoreImports(path, t, coreSpecifiers) {
  let existingImport = null;
  for (const node of path.node.body) {
    if (t.isImportDeclaration(node) && (
      node.source.value === 'what-core' || node.source.value === 'what-framework'
    )) {
      existingImport = node;
      break;
    }
  }

  if (existingImport) {
    const existingNames = new Set(
      existingImport.specifiers
        .filter(s => t.isImportSpecifier(s))
        .map(s => s.imported.name)
    );
    for (const spec of coreSpecifiers) {
      if (!existingNames.has(spec.imported.name)) {
        existingImport.specifiers.push(spec);
      }
    }
  } else {
    const importDecl = t.importDeclaration(
      coreSpecifiers,
      t.stringLiteral('what-framework')
    );
    path.unshiftContainer('body', importDecl);
  }
}
