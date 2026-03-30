// packages/compiler/src/babel-plugin.js
var EVENT_MODIFIERS = /* @__PURE__ */ new Set(["preventDefault", "stopPropagation", "once", "capture", "passive", "self"]);
var EVENT_OPTION_MODIFIERS = /* @__PURE__ */ new Set(["once", "capture", "passive"]);
var VOID_HTML_ELEMENTS = /* @__PURE__ */ new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
var DELEGATED_EVENTS = /* @__PURE__ */ new Set([
  "click",
  "input",
  "change",
  "keydown",
  "keyup",
  "submit",
  "focusin",
  "focusout",
  "mousedown",
  "mouseup"
]);
var SAFE_GLOBAL_CALLS = /* @__PURE__ */ new Set([
  "Math",
  "Number",
  "String",
  "Boolean",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "JSON",
  "Date",
  "Array",
  "Object",
  "console",
  "RegExp"
]);
var SIGNAL_CREATORS = /* @__PURE__ */ new Set([
  "useSignal",
  "signal",
  "computed",
  "useComputed",
  "useState",
  "useReducer",
  "createResource",
  "useSWR",
  "useQuery",
  "useInfiniteQuery"
]);
function whatBabelPlugin({ types: t }) {
  function parseEventModifiers(name) {
    const parts = name.split("|");
    const eventName = parts[0];
    const modifiers = parts.slice(1).filter((m) => EVENT_MODIFIERS.has(m));
    return { eventName, modifiers };
  }
  function isBindingAttribute(name) {
    return name.startsWith("bind:");
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
    return t.stringLiteral(value.value || "");
  }
  function normalizeAttrName(attrName) {
    if (attrName === "className") return "class";
    if (attrName === "htmlFor") return "for";
    return attrName;
  }
  function getAttrName(attr) {
    if (t.isJSXNamespacedName(attr.name)) {
      return `${attr.name.namespace.name}:${attr.name.name.name}`;
    }
    return typeof attr.name.name === "string" ? attr.name.name : String(attr.name.name);
  }
  function createEventHandler(handler, modifiers) {
    if (modifiers.length === 0) return handler;
    let wrappedHandler = handler;
    for (const mod of modifiers) {
      switch (mod) {
        case "preventDefault":
          wrappedHandler = t.arrowFunctionExpression(
            [t.identifier("e")],
            t.blockStatement([
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(t.identifier("e"), t.identifier("preventDefault")),
                  []
                )
              ),
              t.expressionStatement(
                t.callExpression(wrappedHandler, [t.identifier("e")])
              )
            ])
          );
          break;
        case "stopPropagation":
          wrappedHandler = t.arrowFunctionExpression(
            [t.identifier("e")],
            t.blockStatement([
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(t.identifier("e"), t.identifier("stopPropagation")),
                  []
                )
              ),
              t.expressionStatement(
                t.callExpression(wrappedHandler, [t.identifier("e")])
              )
            ])
          );
          break;
        case "self":
          wrappedHandler = t.arrowFunctionExpression(
            [t.identifier("e")],
            t.blockStatement([
              t.ifStatement(
                t.binaryExpression(
                  "===",
                  t.memberExpression(t.identifier("e"), t.identifier("target")),
                  t.memberExpression(t.identifier("e"), t.identifier("currentTarget"))
                ),
                t.expressionStatement(
                  t.callExpression(wrappedHandler, [t.identifier("e")])
                )
              )
            ])
          );
          break;
        case "once":
        case "capture":
        case "passive":
          break;
      }
    }
    return wrappedHandler;
  }
  function isSignalIdentifier(name, signalNames) {
    return signalNames.has(name);
  }
  function collectSignalNamesFromScope(path) {
    const signalNames = /* @__PURE__ */ new Set();
    function extractFromDeclarator(decl) {
      const init = decl.init;
      if (!init || !t.isCallExpression(init)) return;
      const callee = init.callee;
      let calleeName = "";
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
    let scope = path.scope;
    while (scope) {
      for (const [name, binding] of Object.entries(scope.bindings)) {
        if (binding.path.isVariableDeclarator()) {
          extractFromDeclarator(binding.path.node);
        }
        if (binding.path.isIdentifier() || binding.kind === "param") {
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
  function collectSignalNames(path) {
    return collectSignalNamesFromScope(path);
  }
  function isSafeGlobalCall(expr) {
    if (!t.isCallExpression(expr)) return false;
    const callee = expr.callee;
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.object)) {
      return SAFE_GLOBAL_CALLS.has(callee.object.name);
    }
    if (t.isIdentifier(callee)) {
      return SAFE_GLOBAL_CALLS.has(callee.name);
    }
    return false;
  }
  function isUncertainReactive(expr, signalNames, importedIds) {
    if (!signalNames) return false;
    if (t.isCallExpression(expr)) {
      if (t.isIdentifier(expr.callee) && isSignalIdentifier(expr.callee.name, signalNames)) {
        return false;
      }
      if (importedIds && t.isIdentifier(expr.callee) && importedIds.has(expr.callee.name) && !SAFE_GLOBAL_CALLS.has(expr.callee.name)) {
        return false;
      }
      if (t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.object) && isSignalIdentifier(expr.callee.object.name, signalNames)) {
        return false;
      }
      if (isSafeGlobalCall(expr)) return false;
      if (expr.arguments.some((arg) => isPotentiallyReactive(arg, signalNames, importedIds))) {
        return true;
      }
    }
    return false;
  }
  function isPotentiallyReactive(expr, signalNames, importedIds) {
    if (!signalNames) signalNames = /* @__PURE__ */ new Set();
    if (t.isCallExpression(expr)) {
      if (t.isIdentifier(expr.callee) && isSignalIdentifier(expr.callee.name, signalNames)) {
        return true;
      }
      if (importedIds && t.isIdentifier(expr.callee) && importedIds.has(expr.callee.name)) {
        if (!SAFE_GLOBAL_CALLS.has(expr.callee.name)) {
          return true;
        }
      }
      if (t.isMemberExpression(expr.callee)) {
        if (t.isIdentifier(expr.callee.object) && isSignalIdentifier(expr.callee.object.name, signalNames)) {
          return true;
        }
      }
      if (isSafeGlobalCall(expr)) {
        return expr.arguments.some((arg) => isPotentiallyReactive(arg, signalNames, importedIds));
      }
      if (t.isIdentifier(expr.callee)) {
        return expr.arguments.some((arg) => isPotentiallyReactive(arg, signalNames, importedIds));
      }
      return isPotentiallyReactive(expr.callee, signalNames, importedIds) || expr.arguments.some((arg) => isPotentiallyReactive(arg, signalNames, importedIds));
    }
    if (t.isIdentifier(expr)) {
      return isSignalIdentifier(expr.name, signalNames);
    }
    if (t.isMemberExpression(expr)) {
      return isPotentiallyReactive(expr.object, signalNames, importedIds);
    }
    if (t.isConditionalExpression(expr)) {
      return isPotentiallyReactive(expr.test, signalNames, importedIds) || isPotentiallyReactive(expr.consequent, signalNames, importedIds) || isPotentiallyReactive(expr.alternate, signalNames, importedIds);
    }
    if (t.isBinaryExpression(expr) || t.isLogicalExpression(expr)) {
      return isPotentiallyReactive(expr.left, signalNames, importedIds) || isPotentiallyReactive(expr.right, signalNames, importedIds);
    }
    if (t.isUnaryExpression(expr)) {
      return isPotentiallyReactive(expr.argument, signalNames, importedIds);
    }
    if (t.isTemplateLiteral(expr)) {
      return expr.expressions.some((e) => isPotentiallyReactive(e, signalNames, importedIds));
    }
    if (t.isObjectExpression(expr)) {
      return expr.properties.some(
        (prop) => t.isObjectProperty(prop) && isPotentiallyReactive(prop.value, signalNames, importedIds)
      );
    }
    if (t.isArrayExpression(expr)) {
      return expr.elements.some((el) => el && isPotentiallyReactive(el, signalNames, importedIds));
    }
    if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
      return false;
    }
    return false;
  }
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
  function isDynamicAttr(attr) {
    if (t.isJSXSpreadAttribute(attr)) return true;
    if (!attr.value) return false;
    return t.isJSXExpressionContainer(attr.value);
  }
  function extractStaticHTML(node) {
    if (t.isJSXText(node)) {
      const text = node.value.replace(/\n\s+/g, " ").trim();
      return text ? escapeHTML(text) : "";
    }
    if (t.isJSXExpressionContainer(node)) {
      if (t.isJSXEmptyExpression(node.expression)) return "";
      return "<!--$-->";
    }
    if (!t.isJSXElement(node)) return "";
    const el = node.openingElement;
    const tagName = el.name.name;
    if (isComponent(tagName)) return "";
    let html = `<${tagName}`;
    for (const attr of el.attributes) {
      if (t.isJSXSpreadAttribute(attr)) continue;
      const name = getAttrName(attr);
      if (name === "key") continue;
      if (name.startsWith("on") || name.startsWith("bind:") || name.includes("|")) continue;
      let domName = name;
      if (name === "className") domName = "class";
      if (name === "htmlFor") domName = "for";
      if (!attr.value) {
        html += ` ${domName}`;
      } else if (t.isStringLiteral(attr.value)) {
        html += ` ${domName}="${escapeAttr(attr.value.value)}"`;
      } else if (t.isJSXExpressionContainer(attr.value)) {
        continue;
      }
    }
    const selfClosing = node.openingElement.selfClosing;
    if (selfClosing && isVoidHtmlElement(tagName)) {
      html += ">";
      return html;
    }
    if (selfClosing) {
      html += `></${tagName}>`;
      return html;
    }
    html += ">";
    for (const child of node.children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, " ").trim();
        if (text) html += escapeHTML(text);
      } else if (t.isJSXExpressionContainer(child)) {
        if (!t.isJSXEmptyExpression(child.expression)) {
          html += "<!--$-->";
        }
      } else if (t.isJSXElement(child)) {
        if (isComponent(child.openingElement.name.name)) {
          html += "<!--$-->";
        } else {
          html += extractStaticHTML(child);
        }
      }
    }
    html += `</${tagName}>`;
    return html;
  }
  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function transformElementFineGrained(path, state) {
    const { node } = path;
    const openingElement = node.openingElement;
    const tagName = openingElement.name.name;
    if (isComponent(tagName)) {
      return transformComponentFineGrained(path, state);
    }
    if (tagName === "For") {
      return transformForFineGrained(path, state);
    }
    if (tagName === "Show") {
      return transformShowFineGrained(path, state);
    }
    const attributes = openingElement.attributes;
    const children = node.children;
    const allChildrenStatic = children.every(isStaticChild);
    const allAttrsStatic = attributes.every((attr) => !isDynamicAttr(attr));
    const noEvents = attributes.every((attr) => {
      if (t.isJSXSpreadAttribute(attr)) return false;
      const name = getAttrName(attr);
      return !name?.startsWith("on") && !name?.startsWith("bind:");
    });
    if (allChildrenStatic && allAttrsStatic && noEvents) {
      const html2 = extractStaticHTML(node);
      if (html2) {
        const tmplId2 = getOrCreateTemplate(state, html2);
        state.needsTemplate = true;
        return t.callExpression(t.identifier(tmplId2), []);
      }
    }
    const html = extractStaticHTML(node);
    if (!html) {
      const loc = node.loc;
      const fileName = state.filename || state.file?.opts?.filename || "<unknown>";
      const lineInfo = loc ? `:${loc.start.line}:${loc.start.column}` : "";
      console.warn(
        `[what-compiler] Could not extract template for <${tagName}> at ${fileName}${lineInfo}. Falling back to h() for this element. This element could not be statically analyzed. Consider simplifying the JSX.`
      );
      state.needsH = true;
      return transformElementAsH(path, state);
    }
    const tmplId = getOrCreateTemplate(state, html);
    state.needsTemplate = true;
    const elId = state.nextVarId();
    const statements = [
      t.variableDeclaration("const", [
        t.variableDeclarator(t.identifier(elId), t.callExpression(t.identifier(tmplId), []))
      ])
    ];
    applyDynamicAttrs(statements, elId, attributes, state);
    applyDynamicChildren(statements, elId, children, node, state);
    if (!state._pendingSetup) state._pendingSetup = [];
    state._pendingSetup.push(...statements);
    return t.identifier(elId);
  }
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
          /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(domAttrName) ? t.identifier(domAttrName) : t.stringLiteral(domAttrName),
          value
        )
      );
    }
    const transformedChildren = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, " ").trim();
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
    return t.callExpression(t.identifier("h"), [t.stringLiteral(tagName), propsExpr, ...transformedChildren]);
  }
  function applyDynamicAttrs(statements, elId, attributes, state) {
    function buildSetPropCall(propName, valueExpr) {
      state.needsSetProp = true;
      return t.callExpression(t.identifier("_$setProp"), [
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
            t.callExpression(t.identifier("_$spread"), [t.identifier(elId), attr.argument])
          )
        );
        continue;
      }
      const attrName = getAttrName(attr);
      if (attrName === "key") continue;
      if (attrName === "ref") {
        const refExpr = getAttributeValue(attr.value);
        statements.push(
          t.expressionStatement(
            t.conditionalExpression(
              t.binaryExpression(
                "===",
                t.unaryExpression("typeof", refExpr),
                t.stringLiteral("function")
              ),
              t.callExpression(t.cloneNode(refExpr), [t.identifier(elId)]),
              t.assignmentExpression(
                "=",
                t.memberExpression(t.cloneNode(refExpr), t.identifier("current")),
                t.identifier(elId)
              )
            )
          )
        );
        continue;
      }
      if (attrName.startsWith("on") && !attrName.includes("|")) {
        const event = attrName.slice(2).toLowerCase();
        const handler = getAttributeValue(attr.value);
        if (DELEGATED_EVENTS.has(event)) {
          state.needsDelegation = true;
          if (!state.delegatedEvents) state.delegatedEvents = /* @__PURE__ */ new Set();
          state.delegatedEvents.add(event);
          statements.push(
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(
                  t.identifier(elId),
                  t.identifier(`__${event}`)
                ),
                handler
              )
            )
          );
        } else {
          statements.push(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.identifier(elId), t.identifier("addEventListener")),
                [t.stringLiteral(event), handler]
              )
            )
          );
        }
        continue;
      }
      if (attrName.startsWith("on") && attrName.includes("|")) {
        const { eventName, modifiers } = parseEventModifiers(attrName);
        const handler = getAttributeValue(attr.value);
        const wrappedHandler = createEventHandler(handler, modifiers);
        const event = eventName.slice(2).toLowerCase();
        const optionMods = modifiers.filter((m) => EVENT_OPTION_MODIFIERS.has(m));
        const addEventArgs = [t.stringLiteral(event), wrappedHandler];
        if (optionMods.length > 0) {
          const optsProps = optionMods.map(
            (m) => t.objectProperty(t.identifier(m), t.booleanLiteral(true))
          );
          addEventArgs.push(t.objectExpression(optsProps));
        }
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(elId), t.identifier("addEventListener")),
              addEventArgs
            )
          )
        );
        continue;
      }
      if (isBindingAttribute(attrName)) {
        const bindProp = getBindingProperty(attrName);
        const signalExpr = attr.value.expression;
        state.needsEffect = true;
        if (bindProp === "value") {
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier("_$effect"), [
                t.arrowFunctionExpression([], t.assignmentExpression(
                  "=",
                  t.memberExpression(t.identifier(elId), t.identifier("value")),
                  t.callExpression(t.cloneNode(signalExpr), [])
                ))
              ])
            )
          );
          statements.push(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.identifier(elId), t.identifier("addEventListener")),
                [
                  t.stringLiteral("input"),
                  t.arrowFunctionExpression(
                    [t.identifier("e")],
                    t.callExpression(
                      t.memberExpression(t.cloneNode(signalExpr), t.identifier("set")),
                      [t.memberExpression(
                        t.memberExpression(t.identifier("e"), t.identifier("target")),
                        t.identifier("value")
                      )]
                    )
                  )
                ]
              )
            )
          );
        } else if (bindProp === "checked") {
          state.needsEffect = true;
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier("_$effect"), [
                t.arrowFunctionExpression([], t.assignmentExpression(
                  "=",
                  t.memberExpression(t.identifier(elId), t.identifier("checked")),
                  t.callExpression(t.cloneNode(signalExpr), [])
                ))
              ])
            )
          );
          statements.push(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.identifier(elId), t.identifier("addEventListener")),
                [
                  t.stringLiteral("change"),
                  t.arrowFunctionExpression(
                    [t.identifier("e")],
                    t.callExpression(
                      t.memberExpression(t.cloneNode(signalExpr), t.identifier("set")),
                      [t.memberExpression(
                        t.memberExpression(t.identifier("e"), t.identifier("target")),
                        t.identifier("checked")
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
      if (t.isJSXExpressionContainer(attr.value)) {
        const expr = attr.value.expression;
        const domName = normalizeAttrName(attrName);
        if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
          state.needsEffect = true;
          const effectCall = t.callExpression(t.identifier("_$effect"), [
            t.arrowFunctionExpression([], buildSetPropCall(domName, expr))
          ]);
          if (isUncertainReactive(expr, state.signalNames, state.importedIdentifiers)) {
            t.addComment(
              effectCall,
              "leading",
              " @what-dev: effect wrapping may be unnecessary \u2014 expression contains a non-signal function call with reactive args ",
              false
            );
          }
          statements.push(t.expressionStatement(effectCall));
        } else {
          statements.push(t.expressionStatement(buildSetPropCall(domName, expr)));
        }
      }
    }
  }
  function applyDynamicChildren(statements, elId, children, parentNode, state) {
    const entries = [];
    let childIndex = 0;
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, " ").trim();
        if (text) childIndex++;
        continue;
      }
      if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) continue;
        entries.push({ type: "expression", child, childIndex });
        childIndex++;
        continue;
      }
      if (t.isJSXElement(child)) {
        const childTag = child.openingElement.name.name;
        if (isComponent(childTag) || childTag === "For" || childTag === "Show") {
          entries.push({ type: "component", child, childIndex });
          childIndex++;
        } else {
          const hasAnythingDynamic = child.openingElement.attributes.some(isDynamicAttr) || child.openingElement.attributes.some((a) => !t.isJSXSpreadAttribute(a) && getAttrName(a)?.startsWith("on")) || !child.children.every(isStaticChild);
          entries.push({ type: "static", child, childIndex, hasAnythingDynamic });
          childIndex++;
        }
        continue;
      }
      if (t.isJSXFragment(child)) {
        entries.push({ type: "fragment", child });
      }
    }
    const entriesNeedingRef = entries.filter(
      (e) => e.type === "expression" || e.type === "component" || e.type === "static" && e.hasAnythingDynamic
    );
    const hasDynamicInsert = entries.some((e) => e.type === "expression" || e.type === "component");
    const needsPreCapture = entriesNeedingRef.length >= 2 && hasDynamicInsert;
    const markerVars = /* @__PURE__ */ new Map();
    if (needsPreCapture) {
      for (const entry of entriesNeedingRef) {
        const varName = `_m$${entry.childIndex}`;
        const markerVar = state.nextVarId();
        markerVars.set(entry.childIndex, markerVar);
        statements.push(
          t.variableDeclaration("const", [
            t.variableDeclarator(
              t.identifier(markerVar),
              buildChildAccess(elId, entry.childIndex)
            )
          ])
        );
      }
    }
    function getMarker(idx) {
      if (markerVars.has(idx)) {
        return t.identifier(markerVars.get(idx));
      }
      return buildChildAccess(elId, idx);
    }
    for (const entry of entries) {
      if (entry.type === "expression") {
        const expr = entry.child.expression;
        const marker = getMarker(entry.childIndex);
        state.needsInsert = true;
        if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
          const insertCall = t.callExpression(t.identifier("_$insert"), [
            t.identifier(elId),
            t.arrowFunctionExpression([], expr),
            marker
          ]);
          if (isUncertainReactive(expr, state.signalNames, state.importedIdentifiers)) {
            t.addComment(
              insertCall,
              "leading",
              " @what-dev: reactive wrapping may be unnecessary \u2014 expression contains a non-signal function call with reactive args ",
              false
            );
          }
          statements.push(t.expressionStatement(insertCall));
        } else {
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier("_$insert"), [
                t.identifier(elId),
                expr,
                marker
              ])
            )
          );
        }
        continue;
      }
      if (entry.type === "component") {
        const transformed = transformElementFineGrained({ node: entry.child }, state);
        const marker = getMarker(entry.childIndex);
        state.needsInsert = true;
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier("_$insert"), [
              t.identifier(elId),
              transformed,
              marker
            ])
          )
        );
        continue;
      }
      if (entry.type === "static" && entry.hasAnythingDynamic) {
        let childElRef;
        if (markerVars.has(entry.childIndex)) {
          childElRef = markerVars.get(entry.childIndex);
        } else {
          childElRef = state.nextVarId();
          statements.push(
            t.variableDeclaration("const", [
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
      if (entry.type === "fragment") {
        for (const fChild of entry.child.children) {
          if (t.isJSXExpressionContainer(fChild) && !t.isJSXEmptyExpression(fChild.expression)) {
            state.needsInsert = true;
            const expr = fChild.expression;
            if (isPotentiallyReactive(expr, state.signalNames, state.importedIdentifiers)) {
              statements.push(
                t.expressionStatement(
                  t.callExpression(t.identifier("_$insert"), [
                    t.identifier(elId),
                    t.arrowFunctionExpression([], expr)
                  ])
                )
              );
            } else {
              statements.push(
                t.expressionStatement(
                  t.callExpression(t.identifier("_$insert"), [
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
    if (index === 0) {
      return t.memberExpression(t.identifier(elId), t.identifier("firstChild"));
    }
    let expr = t.memberExpression(t.identifier(elId), t.identifier("firstChild"));
    for (let i = 0; i < index; i++) {
      expr = t.memberExpression(expr, t.identifier("nextSibling"));
    }
    return expr;
  }
  function transformComponentFineGrained(path, state) {
    const { node } = path;
    const openingElement = node.openingElement;
    const componentName = openingElement.name.name;
    const attributes = openingElement.attributes;
    const children = node.children;
    let clientDirective = null;
    const filteredAttrs = [];
    for (const attr of attributes) {
      if (t.isJSXAttribute(attr)) {
        let name;
        if (t.isJSXNamespacedName(attr.name)) {
          name = `${attr.name.namespace.name}:${attr.name.name.name}`;
        } else {
          name = attr.name.name;
        }
        if (name && typeof name === "string" && name.startsWith("client:")) {
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
        t.objectProperty(t.identifier("component"), t.identifier(componentName)),
        t.objectProperty(t.identifier("mode"), t.stringLiteral(clientDirective.type))
      ];
      if (clientDirective.value) {
        islandProps.push(
          t.objectProperty(t.identifier("mediaQuery"), t.stringLiteral(clientDirective.value))
        );
      }
      for (const attr of filteredAttrs) {
        if (t.isJSXSpreadAttribute(attr)) continue;
        const attrName = getAttrName(attr);
        const value = getAttributeValue(attr.value);
        islandProps.push(t.objectProperty(t.identifier(attrName), value));
      }
      return t.callExpression(
        t.identifier("_$createComponent"),
        [t.identifier("Island"), t.objectExpression(islandProps), t.arrayExpression([])]
      );
    }
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
      if (attrName === "key") continue;
      if (isBindingAttribute(attrName)) {
        const bindProp = getBindingProperty(attrName);
        const signalExpr = attr.value.expression;
        if (bindProp === "value") {
          props.push(
            t.objectProperty(t.identifier("value"), t.callExpression(t.cloneNode(signalExpr), []))
          );
          props.push(
            t.objectProperty(
              t.identifier("onInput"),
              t.arrowFunctionExpression(
                [t.identifier("e")],
                t.callExpression(
                  t.memberExpression(t.cloneNode(signalExpr), t.identifier("set")),
                  [t.memberExpression(
                    t.memberExpression(t.identifier("e"), t.identifier("target")),
                    t.identifier("value")
                  )]
                )
              )
            )
          );
        } else if (bindProp === "checked") {
          props.push(
            t.objectProperty(t.identifier("checked"), t.callExpression(t.cloneNode(signalExpr), []))
          );
          props.push(
            t.objectProperty(
              t.identifier("onChange"),
              t.arrowFunctionExpression(
                [t.identifier("e")],
                t.callExpression(
                  t.memberExpression(t.cloneNode(signalExpr), t.identifier("set")),
                  [t.memberExpression(
                    t.memberExpression(t.identifier("e"), t.identifier("target")),
                    t.identifier("checked")
                  )]
                )
              )
            )
          );
        }
        continue;
      }
      if (attrName.startsWith("on") && attrName.includes("|")) {
        const { eventName, modifiers } = parseEventModifiers(attrName);
        const handler = getAttributeValue(attr.value);
        const wrappedHandler = createEventHandler(handler, modifiers);
        props.push(t.objectProperty(t.identifier(eventName), wrappedHandler));
        continue;
      }
      const value = getAttributeValue(attr.value);
      props.push(
        t.objectProperty(
          /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(attrName) ? t.identifier(attrName) : t.stringLiteral(attrName),
          value
        )
      );
    }
    const transformedChildren = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, " ").trim();
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
          t.memberExpression(t.identifier("Object"), t.identifier("assign")),
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
    const childrenArray = transformedChildren.length > 0 ? t.arrayExpression(transformedChildren) : t.arrayExpression([]);
    return t.callExpression(t.identifier("_$createComponent"), [t.identifier(componentName), propsExpr, childrenArray]);
  }
  function transformForFineGrained(path, state) {
    const { node } = path;
    const attributes = node.openingElement.attributes;
    const children = node.children;
    let eachExpr = null;
    for (const attr of attributes) {
      if (t.isJSXAttribute(attr) && getAttrName(attr) === "each") {
        eachExpr = getAttributeValue(attr.value);
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
      console.warn("[what-compiler] <For> element missing render function child.");
      state.needsH = true;
      return transformElementAsH(path, state);
    }
    state.needsMapArray = true;
    return t.callExpression(t.identifier("_$mapArray"), [eachExpr, renderFn]);
  }
  function transformShowFineGrained(path, state) {
    state.needsCreateComponent = true;
    return transformComponentFineGrained(path, state);
  }
  function transformFragmentFineGrained(path, state) {
    const { node } = path;
    const children = node.children;
    const transformed = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, " ").trim();
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
  function getOrCreateTemplate(state, html) {
    if (state.templateMap.has(html)) {
      return state.templateMap.get(html);
    }
    const id = `_tmpl$${state.templateCount++}`;
    state.templateMap.set(html, id);
    state.templates.push({ id, html });
    return id;
  }
  return {
    name: "what-jsx-transform",
    visitor: {
      Program: {
        enter(path, state) {
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
          state.delegatedEvents = /* @__PURE__ */ new Set();
          state.templates = [];
          state.templateMap = /* @__PURE__ */ new Map();
          state.templateCount = 0;
          state._varCounter = 0;
          state._pendingSetup = [];
          state.nextVarId = () => `_el$${state._varCounter++}`;
          state.signalNames = /* @__PURE__ */ new Set();
          state.importedIdentifiers = /* @__PURE__ */ new Set();
          for (const node of path.node.body) {
            if (t.isImportDeclaration(node)) {
              const source = node.source.value;
              const isReactiveSource = source === "what-framework" || source.startsWith("what-framework/") || source === "what-core" || source.startsWith("what-core/") || source.startsWith("./") || source.startsWith("../");
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
              let calleeName = "";
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
          for (const tmpl of state.templates.reverse()) {
            path.unshiftContainer(
              "body",
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  t.identifier(tmpl.id),
                  t.callExpression(t.identifier("_$template"), [t.stringLiteral(tmpl.html)])
                )
              ])
            );
          }
          const fgSpecifiers = [];
          if (state.needsTemplate) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$template"), t.identifier("template"))
            );
          }
          if (state.needsInsert) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$insert"), t.identifier("insert"))
            );
          }
          if (state.needsEffect) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$effect"), t.identifier("effect"))
            );
          }
          if (state.needsMapArray) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$mapArray"), t.identifier("mapArray"))
            );
          }
          if (state.needsSpread) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$spread"), t.identifier("spread"))
            );
          }
          if (state.needsSetProp) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$setProp"), t.identifier("setProp"))
            );
          }
          if (state.needsCreateComponent) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$createComponent"), t.identifier("_$createComponent"))
            );
          }
          if (state.needsDelegation) {
            fgSpecifiers.push(
              t.importSpecifier(t.identifier("_$delegateEvents"), t.identifier("delegateEvents"))
            );
          }
          const coreSpecifiers = [];
          if (state.needsH) {
            coreSpecifiers.push(
              t.importSpecifier(t.identifier("h"), t.identifier("h"))
            );
          }
          if (state.needsFragment) {
            coreSpecifiers.push(
              t.importSpecifier(t.identifier("Fragment"), t.identifier("Fragment"))
            );
          }
          if (state.needsIsland) {
            coreSpecifiers.push(
              t.importSpecifier(t.identifier("Island"), t.identifier("Island"))
            );
          }
          if (fgSpecifiers.length > 0) {
            let existingRenderImport = null;
            for (const node of path.node.body) {
              if (t.isImportDeclaration(node) && (node.source.value === "what-framework/render" || node.source.value === "what-core/render")) {
                existingRenderImport = node;
                break;
              }
            }
            if (existingRenderImport) {
              const existingNames = new Set(
                existingRenderImport.specifiers.filter((s) => t.isImportSpecifier(s)).map((s) => s.imported.name)
              );
              for (const spec of fgSpecifiers) {
                if (!existingNames.has(spec.imported.name)) {
                  existingRenderImport.specifiers.push(spec);
                }
              }
            } else {
              path.unshiftContainer(
                "body",
                t.importDeclaration(fgSpecifiers, t.stringLiteral("what-framework/render"))
              );
            }
          }
          if (coreSpecifiers.length > 0) {
            addCoreImports(path, t, coreSpecifiers);
          }
          if (state.needsDelegation && state.delegatedEvents && state.delegatedEvents.size > 0) {
            const eventArray = t.arrayExpression(
              [...state.delegatedEvents].map((e) => t.stringLiteral(e))
            );
            path.pushContainer(
              "body",
              t.expressionStatement(
                t.callExpression(t.identifier("_$delegateEvents"), [eventArray])
              )
            );
          }
        }
      },
      JSXElement(path, state) {
        state.signalNames = collectSignalNamesFromScope(path);
        state._pendingSetup = [];
        const transformed = transformElementFineGrained(path, state);
        const pending = state._pendingSetup;
        state._pendingSetup = [];
        if (pending.length > 0) {
          let stmtPath = path;
          while (stmtPath && !stmtPath.isStatement()) {
            stmtPath = stmtPath.parentPath;
          }
          if (stmtPath && stmtPath.isStatement()) {
            for (const stmt of pending) {
              stmtPath.insertBefore(stmt);
            }
            path.replaceWith(transformed);
          } else {
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
    if (t.isImportDeclaration(node) && (node.source.value === "what-core" || node.source.value === "what-framework")) {
      existingImport = node;
      break;
    }
  }
  if (existingImport) {
    const existingNames = new Set(
      existingImport.specifiers.filter((s) => t.isImportSpecifier(s)).map((s) => s.imported.name)
    );
    for (const spec of coreSpecifiers) {
      if (!existingNames.has(spec.imported.name)) {
        existingImport.specifiers.push(spec);
      }
    }
  } else {
    const importDecl = t.importDeclaration(
      coreSpecifiers,
      t.stringLiteral("what-framework")
    );
    path.unshiftContainer("body", importDecl);
  }
}
export {
  whatBabelPlugin as default
};
//# sourceMappingURL=babel-plugin.js.map
