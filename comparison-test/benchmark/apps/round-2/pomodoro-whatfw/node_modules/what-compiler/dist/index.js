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
  function collectSignalNamesFromScope(path3) {
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
    let scope = path3.scope;
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
  function collectSignalNames(path3) {
    return collectSignalNamesFromScope(path3);
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
  function transformElementFineGrained(path3, state) {
    const { node } = path3;
    const openingElement = node.openingElement;
    const tagName = openingElement.name.name;
    if (isComponent(tagName)) {
      return transformComponentFineGrained(path3, state);
    }
    if (tagName === "For") {
      return transformForFineGrained(path3, state);
    }
    if (tagName === "Show") {
      return transformShowFineGrained(path3, state);
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
      return transformElementAsH(path3, state);
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
  function transformElementAsH(path3, state) {
    const { node } = path3;
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
    let childIndex = 0;
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, " ").trim();
        if (text) childIndex++;
        continue;
      }
      if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) continue;
        const expr = child.expression;
        const marker = buildChildAccess(elId, childIndex);
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
        childIndex++;
        continue;
      }
      if (t.isJSXElement(child)) {
        const childTag = child.openingElement.name.name;
        if (isComponent(childTag) || childTag === "For" || childTag === "Show") {
          const transformed = transformElementFineGrained({ node: child }, state);
          const marker = buildChildAccess(elId, childIndex);
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
          childIndex++;
        } else {
          const hasAnythingDynamic = child.openingElement.attributes.some(isDynamicAttr) || child.openingElement.attributes.some((a) => !t.isJSXSpreadAttribute(a) && getAttrName(a)?.startsWith("on")) || !child.children.every(isStaticChild);
          if (hasAnythingDynamic) {
            const childElId = state.nextVarId();
            statements.push(
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  t.identifier(childElId),
                  buildChildAccess(elId, childIndex)
                )
              ])
            );
            applyDynamicAttrs(statements, childElId, child.openingElement.attributes, state);
            applyDynamicChildren(statements, childElId, child.children, child, state);
          }
          childIndex++;
        }
        continue;
      }
      if (t.isJSXFragment(child)) {
        for (const fChild of child.children) {
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
  function transformComponentFineGrained(path3, state) {
    const { node } = path3;
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
  function transformForFineGrained(path3, state) {
    const { node } = path3;
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
      return transformElementAsH(path3, state);
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
      return transformElementAsH(path3, state);
    }
    state.needsMapArray = true;
    return t.callExpression(t.identifier("_$mapArray"), [eachExpr, renderFn]);
  }
  function transformShowFineGrained(path3, state) {
    state.needsCreateComponent = true;
    return transformComponentFineGrained(path3, state);
  }
  function transformFragmentFineGrained(path3, state) {
    const { node } = path3;
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
        enter(path3, state) {
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
          for (const node of path3.node.body) {
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
          path3.traverse({
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
        exit(path3, state) {
          for (const tmpl of state.templates.reverse()) {
            path3.unshiftContainer(
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
            for (const node of path3.node.body) {
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
              path3.unshiftContainer(
                "body",
                t.importDeclaration(fgSpecifiers, t.stringLiteral("what-framework/render"))
              );
            }
          }
          if (coreSpecifiers.length > 0) {
            addCoreImports(path3, t, coreSpecifiers);
          }
          if (state.needsDelegation && state.delegatedEvents && state.delegatedEvents.size > 0) {
            const eventArray = t.arrayExpression(
              [...state.delegatedEvents].map((e) => t.stringLiteral(e))
            );
            path3.pushContainer(
              "body",
              t.expressionStatement(
                t.callExpression(t.identifier("_$delegateEvents"), [eventArray])
              )
            );
          }
        }
      },
      JSXElement(path3, state) {
        state.signalNames = collectSignalNamesFromScope(path3);
        state._pendingSetup = [];
        const transformed = transformElementFineGrained(path3, state);
        const pending = state._pendingSetup;
        state._pendingSetup = [];
        if (pending.length > 0) {
          let stmtPath = path3;
          while (stmtPath && !stmtPath.isStatement()) {
            stmtPath = stmtPath.parentPath;
          }
          if (stmtPath && stmtPath.isStatement()) {
            for (const stmt of pending) {
              stmtPath.insertBefore(stmt);
            }
            path3.replaceWith(transformed);
          } else {
            pending.push(t.returnStatement(transformed));
            path3.replaceWith(
              t.callExpression(
                t.arrowFunctionExpression([], t.blockStatement(pending)),
                []
              )
            );
          }
        } else {
          path3.replaceWith(transformed);
        }
      },
      JSXFragment(path3, state) {
        const transformed = transformFragmentFineGrained(path3, state);
        path3.replaceWith(transformed);
      }
    }
  };
}
function addCoreImports(path3, t, coreSpecifiers) {
  let existingImport = null;
  for (const node of path3.node.body) {
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
    path3.unshiftContainer("body", importDecl);
  }
}

// packages/compiler/src/vite-plugin.js
import path2 from "path";
import { transformSync } from "@babel/core";

// packages/compiler/src/file-router.js
import fs from "fs";
import path from "path";
var PAGE_EXTENSIONS = /* @__PURE__ */ new Set([".jsx", ".tsx", ".js", ".ts"]);
var IGNORED_FILES = /* @__PURE__ */ new Set(["_layout", "_error", "_loading", "_404"]);
function scanPages(pagesDir) {
  const pages = [];
  const layouts = [];
  const apiRoutes = [];
  function walk(dir, urlPrefix = "") {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const groupMatch = entry.name.match(/^\((.+)\)$/);
        if (groupMatch) {
          walk(fullPath, urlPrefix);
          continue;
        }
        if (entry.name === "api" && urlPrefix === "") {
          walkApi(fullPath, "/api");
          continue;
        }
        walk(fullPath, urlPrefix + "/" + fileNameToSegment(entry.name));
        continue;
      }
      const ext = path.extname(entry.name);
      if (!PAGE_EXTENSIONS.has(ext)) continue;
      const baseName = path.basename(entry.name, ext);
      if (baseName === "_layout") {
        layouts.push({
          filePath: fullPath,
          urlPrefix: urlPrefix || "/"
        });
        continue;
      }
      if (IGNORED_FILES.has(baseName)) continue;
      const urlSegment = fileNameToSegment(baseName);
      const routePath = baseName === "index" ? urlPrefix || "/" : urlPrefix + "/" + urlSegment;
      pages.push({
        filePath: fullPath,
        routePath: normalizePath(routePath),
        isDynamic: routePath.includes(":") || routePath.includes("*")
      });
    }
  }
  function walkApi(dir, urlPrefix) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkApi(fullPath, urlPrefix + "/" + fileNameToSegment(entry.name));
        continue;
      }
      const ext = path.extname(entry.name);
      if (!PAGE_EXTENSIONS.has(ext)) continue;
      const baseName = path.basename(entry.name, ext);
      const segment = fileNameToSegment(baseName);
      const routePath = baseName === "index" ? urlPrefix : urlPrefix + "/" + segment;
      apiRoutes.push({
        filePath: fullPath,
        routePath: normalizePath(routePath)
      });
    }
  }
  walk(pagesDir);
  pages.sort((a, b) => {
    const aWeight = routeWeight(a.routePath);
    const bWeight = routeWeight(b.routePath);
    return aWeight - bWeight;
  });
  return { pages, layouts, apiRoutes };
}
function fileNameToSegment(name) {
  const catchAll = name.match(/^\[\.\.\.(\w+)\]$/);
  if (catchAll) return "*" + catchAll[1];
  const dynamic = name.match(/^\[(\w+)\]$/);
  if (dynamic) return ":" + dynamic[1];
  return name.toLowerCase();
}
function normalizePath(p) {
  let result = p.replace(/\/+/g, "/");
  if (result.length > 1 && result.endsWith("/")) {
    result = result.slice(0, -1);
  }
  return result || "/";
}
function routeWeight(path3) {
  if (path3.includes("*")) return 100;
  if (path3.includes(":")) return 10;
  return 0;
}
function extractPageConfig(source) {
  const match = source.match(
    /export\s+const\s+page\s*=\s*(\{[^}]*\})/s
  );
  if (!match) {
    return { mode: "client" };
  }
  try {
    const obj = match[1].replace(/'/g, '"').replace(/(\w+)\s*:/g, '"$1":').replace(/,\s*}/g, "}").replace(/\/\/[^\n]*/g, "");
    return { mode: "client", ...JSON.parse(obj) };
  } catch {
    return { mode: "client" };
  }
}
function generateRoutesModule(pagesDir, rootDir) {
  const { pages, layouts, apiRoutes } = scanPages(pagesDir);
  const imports = [];
  const routeEntries = [];
  const layoutMap = /* @__PURE__ */ new Map();
  layouts.forEach((layout, i) => {
    const varName = `_layout${i}`;
    const relPath = toImportPath(layout.filePath, rootDir);
    imports.push(`import ${varName} from '${relPath}';`);
    layoutMap.set(layout.urlPrefix, varName);
  });
  pages.forEach((page, i) => {
    const varName = `_page${i}`;
    const relPath = toImportPath(page.filePath, rootDir);
    imports.push(`import ${varName} from '${relPath}';`);
    let pageConfig = { mode: "client" };
    try {
      const source = fs.readFileSync(page.filePath, "utf-8");
      pageConfig = extractPageConfig(source);
    } catch {
    }
    const layoutVar = findLayout(page.routePath, layoutMap);
    const entry = {
      path: page.routePath,
      component: varName,
      mode: pageConfig.mode || "client",
      layout: layoutVar || null
    };
    routeEntries.push(entry);
  });
  const apiEntries = [];
  apiRoutes.forEach((route, i) => {
    const varName = `_api${i}`;
    const relPath = toImportPath(route.filePath, rootDir);
    imports.push(`import * as ${varName} from '${relPath}';`);
    apiEntries.push({
      path: route.routePath,
      handlers: varName
    });
  });
  const lines = [
    "// Auto-generated by What Framework file router",
    "// Do not edit \u2014 changes will be overwritten",
    "",
    ...imports,
    "",
    "export const routes = [",
    ...routeEntries.map(
      (r) => `  { path: '${r.path}', component: ${r.component}, mode: '${r.mode}'${r.layout ? `, layout: ${r.layout}` : ""} },`
    ),
    "];",
    "",
    `export const apiRoutes = [`,
    ...apiEntries.map(
      (r) => `  { path: '${r.path}', handlers: ${r.handlers} },`
    ),
    "];",
    "",
    // Export page modes for the build system
    "export const pageModes = {",
    ...routeEntries.map(
      (r) => `  '${r.path}': '${r.mode}',`
    ),
    "};"
  ];
  return lines.join("\n");
}
function toImportPath(filePath, rootDir) {
  const rel = path.relative(rootDir, filePath);
  return "/" + rel.split(path.sep).join("/");
}
function findLayout(routePath, layoutMap) {
  const segments = routePath.split("/").filter(Boolean);
  while (segments.length > 0) {
    const prefix = "/" + segments.join("/");
    if (layoutMap.has(prefix)) return layoutMap.get(prefix);
    segments.pop();
  }
  if (layoutMap.has("/")) return layoutMap.get("/");
  return null;
}

// packages/compiler/src/error-overlay.js
var OVERLAY_STYLES = `
  :host {
    position: fixed;
    inset: 0;
    z-index: 99999;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.66);
  }

  .panel {
    position: fixed;
    inset: 2rem;
    overflow: auto;
    background: #1a1a2e;
    border: 1px solid #2a2a4a;
    border-radius: 12px;
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
    color: #e0e0e0;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #2a2a4a;
    background: #16163a;
    border-radius: 12px 12px 0 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .logo {
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 14px;
    color: #fff;
  }

  .brand {
    font-size: 14px;
    font-weight: 600;
    color: #a0a0c0;
  }

  .tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
  }

  .tag-error {
    background: #3b1219;
    color: #f87171;
  }

  .tag-warning {
    background: #3b2f19;
    color: #fbbf24;
  }

  .close-btn, .copy-btn {
    background: none;
    border: 1px solid #3a3a5a;
    color: #a0a0c0;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }

  .close-btn:hover, .copy-btn:hover {
    background: #2a2a4a;
    color: #fff;
  }

  .copy-btn.copied {
    border-color: #22c55e;
    color: #22c55e;
  }

  .body {
    padding: 1.5rem;
  }

  .error-title {
    font-size: 16px;
    font-weight: 700;
    color: #f87171;
    margin: 0 0 0.5rem;
  }

  .error-message {
    font-size: 14px;
    color: #e0e0e0;
    margin: 0 0 1rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .file-path {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 12px;
    color: #818cf8;
    margin-bottom: 1rem;
    padding: 0.25rem 0;
  }

  .code-frame {
    background: #0d0d1a;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    overflow-x: auto;
    margin-bottom: 1rem;
  }

  .code-line {
    display: flex;
    padding: 0 1rem;
    font-size: 13px;
    line-height: 1.7;
  }

  .code-line.highlight {
    background: rgba(248, 113, 113, 0.1);
  }

  .line-number {
    color: #4a4a6a;
    min-width: 3ch;
    text-align: right;
    margin-right: 1rem;
    user-select: none;
  }

  .line-content {
    white-space: pre;
  }

  .tip {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: #1a2744;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    font-size: 13px;
    color: #93c5fd;
    line-height: 1.5;
  }

  .tip-label {
    font-weight: 700;
    color: #60a5fa;
  }

  .stack {
    margin-top: 1rem;
    font-size: 12px;
    color: #6a6a8a;
    white-space: pre-wrap;
    line-height: 1.5;
  }
`;
var OVERLAY_ELEMENT = `
class WhatErrorOverlay extends HTMLElement {
  constructor(err) {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = '<style>${OVERLAY_STYLES}</style>';
    this._err = err;
    this.show(err);
  }

  // --- Inlined helper: escapeHTML ---
  _escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Inlined helper: cleanStack ---
  _cleanStack(stack) {
    return stack
      .split('\\n')
      .filter(function(line) { return line.indexOf('node_modules') === -1; })
      .slice(0, 10)
      .join('\\n');
  }

  // --- Inlined helper: getTip ---
  _getTip(err) {
    var msg = (err.message || '').toLowerCase();

    if (msg.indexOf('infinite') !== -1 && msg.indexOf('effect') !== -1) {
      return 'An effect is writing to a signal it also reads. Use untrack() to read without subscribing, or move the write to a different effect.';
    }
    if (msg.indexOf('jsx') !== -1 && msg.indexOf('unexpected') !== -1) {
      return 'Make sure your vite.config includes the What compiler plugin: import what from "what-compiler/vite"';
    }
    if (msg.indexOf('not a function') !== -1 && msg.indexOf('signal') !== -1) {
      return 'Signals are functions: call sig() to read, sig(value) to write. Check you are not destructuring a signal.';
    }
    if (msg.indexOf('hydrat') !== -1) {
      return 'Hydration mismatches happen when SSR output differs from client render. Ensure server and client see the same initial state.';
    }
    // New tips for common mistakes
    if (msg.indexOf('signal') !== -1 && msg.indexOf('without') !== -1 && msg.indexOf('call') !== -1) {
      return 'Signals must be called to read their value. Use {count()} in JSX, not {count}. The parentheses trigger the reactive subscription.';
    }
    if (msg.indexOf('innerhtml') !== -1 && msg.indexOf('__html') !== -1) {
      return 'Raw innerHTML is blocked for security. Use innerHTML={{ __html: trustedString }} or dangerouslySetInnerHTML={{ __html: trustedString }} instead.';
    }
    if ((msg.indexOf('innerhtml') !== -1 || msg.indexOf('xss') !== -1) && msg.indexOf('raw string') !== -1) {
      return 'Raw innerHTML is a security risk (XSS). Wrap your HTML in an object: innerHTML={{ __html: yourString }}.';
    }
    if (msg.indexOf('cleanup') !== -1 && (msg.indexOf('effect') !== -1 || msg.indexOf('listener') !== -1)) {
      return 'Effects that add event listeners or timers should return a cleanup function: effect(() => { el.addEventListener(...); return () => el.removeEventListener(...); })';
    }
    if (msg.indexOf('route') !== -1 && (msg.indexOf('not found') !== -1 || msg.indexOf('404') !== -1 || msg.indexOf('no match') !== -1)) {
      return 'No route matched the current URL. Check that your route paths are correct and you have a catch-all or 404 route defined.';
    }
    if (msg.indexOf('key') !== -1 && (msg.indexOf('missing') !== -1 || msg.indexOf('list') !== -1 || msg.indexOf('each') !== -1)) {
      return 'Lists need unique keys for efficient DOM updates. Add a key prop: items.map(item => <Item key={item.id} />)';
    }
    return '';
  }

  // --- Build overlay HTML ---
  _buildHTML(err) {
    var isCompilerError = err._isCompilerError || err.plugin === 'vite-plugin-what';
    var type = isCompilerError ? 'Compiler Error' : 'Runtime Error';
    var tagClass = isCompilerError ? 'tag-error' : 'tag-warning';

    var codeFrame = '';
    var rawFrame = err.frame || err._frame;
    if (rawFrame) {
      var lines = rawFrame.split('\\n');
      var frameLines = '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var isHighlight = line.trimStart().startsWith('>');
        var cleaned = line.replace(/^\\s*>\\s?/, ' ').replace(/^\\s{2}/, '');
        var match = cleaned.match(/^(\\s*\\d+)\\s*\\|(.*)$/);
        if (match) {
          frameLines += '<div class="code-line' + (isHighlight ? ' highlight' : '') + '"><span class="line-number">' + match[1].trim() + '</span><span class="line-content">' + this._escapeHTML(match[2]) + '</span></div>';
        } else if (cleaned.trim().startsWith('|')) {
          frameLines += '<div class="code-line highlight"><span class="line-number"></span><span class="line-content" style="color:#f87171">' + this._escapeHTML(cleaned.replace(/^\\s*\\|/, '')) + '</span></div>';
        }
      }
      if (frameLines) {
        codeFrame = '<div class="code-frame">' + frameLines + '</div>';
      }
    }

    var filePath = err.id || (err.loc && err.loc.file) || '';
    var lineNum = (err.loc && err.loc.line != null) ? err.loc.line : '';
    var col = (err.loc && err.loc.column != null) ? err.loc.column : '';
    var location = filePath
      ? '<div class="file-path">' + this._escapeHTML(filePath) + (lineNum ? ':' + lineNum : '') + (col ? ':' + col : '') + '</div>'
      : '';

    var tip = this._getTip(err);
    var tipHTML = tip ? '<div class="tip"><span class="tip-label">Tip: </span>' + this._escapeHTML(tip) + '</div>' : '';

    var stack = (err.stack && !isCompilerError)
      ? '<div class="stack">' + this._escapeHTML(this._cleanStack(err.stack)) + '</div>'
      : '';

    return '<div class="backdrop"></div>'
      + '<div class="panel">'
      +   '<div class="header">'
      +     '<div class="header-left">'
      +       '<div class="logo">W</div>'
      +       '<span class="brand">What Framework</span>'
      +       '<span class="tag ' + tagClass + '">' + type + '</span>'
      +     '</div>'
      +     '<div class="header-right">'
      +       '<button class="copy-btn">Copy Error</button>'
      +       '<button class="close-btn">Dismiss (Esc)</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="body">'
      +     '<h2 class="error-title">' + this._escapeHTML(err.name || 'Error') + '</h2>'
      +     location
      +     '<pre class="error-message">' + this._escapeHTML(err.message || String(err)) + '</pre>'
      +     codeFrame
      +     tipHTML
      +     stack
      +   '</div>'
      + '</div>';
  }

  show(err) {
    var template = document.createElement('template');
    template.innerHTML = this._buildHTML(err);
    this.root.appendChild(template.content.cloneNode(true));

    // Close handlers
    var self = this;
    var closeBtn = this.root.querySelector('.close-btn');
    if (closeBtn) closeBtn.addEventListener('click', function() { self.close(); });
    var backdrop = this.root.querySelector('.backdrop');
    if (backdrop) backdrop.addEventListener('click', function() { self.close(); });
    document.addEventListener('keydown', this._onKey = function(e) {
      if (e.key === 'Escape') self.close();
    });

    // Copy Error button
    var copyBtn = this.root.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        self._copyError(copyBtn);
      });
    }
  }

  _copyError(btn) {
    var err = this._err;
    var data = {
      name: err.name || 'Error',
      message: err.message || String(err),
      file: err.id || (err.loc && err.loc.file) || null,
      line: (err.loc && err.loc.line != null) ? err.loc.line : null,
      column: (err.loc && err.loc.column != null) ? err.loc.column : null,
      stack: err.stack ? this._cleanStack(err.stack) : null,
      framework: 'What Framework',
      timestamp: new Date().toISOString()
    };

    var text = JSON.stringify(data, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy Error';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(function() {
        // Fallback: select text
        prompt('Copy error details:', text);
      });
    } else {
      prompt('Copy error details:', text);
    }
  }

  close() {
    document.removeEventListener('keydown', this._onKey);
    this.remove();
  }
}

if (!customElements.get('what-error-overlay')) {
  customElements.define('what-error-overlay', WhatErrorOverlay);
}
`;
function setupErrorOverlay(server) {
  const origSend = server.ws.send.bind(server.ws);
  server.ws.send = function(payload) {
    if (payload?.type === "error") {
      if (payload.err?.plugin === "vite-plugin-what") {
        payload.err._isCompilerError = true;
      }
    }
    return origSend(payload);
  };
}

// packages/compiler/src/vite-plugin.js
var VIRTUAL_ROUTES_ID = "virtual:what-routes";
var RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ROUTES_ID;
var COMPONENT_EXPORT_RE = /export\s+(?:default\s+)?function\s+([A-Z]\w*)/;
var UTILITY_FILE_RE = /(?:store|signal|state|context|util|helper|lib|config)\b/i;
function whatVitePlugin(options = {}) {
  const {
    // File extensions to process
    include = /\.[jt]sx$/,
    // Files to exclude
    exclude = /node_modules/,
    // Enable source maps
    sourceMaps = true,
    // Production optimizations
    production = false,
    // Pages directory (relative to project root)
    pages = "src/pages",
    // HMR: enabled by default in dev, disabled in production
    hot = !production
  } = options;
  let rootDir = "";
  let pagesDir = "";
  let server = null;
  let isDevMode = false;
  return {
    name: "vite-plugin-what",
    configResolved(config) {
      rootDir = config.root;
      pagesDir = path2.resolve(rootDir, pages);
      isDevMode = config.command === "serve";
    },
    configureServer(devServer) {
      server = devServer;
      setupErrorOverlay(devServer);
      devServer.watcher.on("add", (file) => {
        if (file.startsWith(pagesDir)) {
          const mod = devServer.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
          if (mod) {
            devServer.moduleGraph.invalidateModule(mod);
            devServer.ws.send({ type: "full-reload" });
          }
        }
      });
      devServer.watcher.on("unlink", (file) => {
        if (file.startsWith(pagesDir)) {
          const mod = devServer.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
          if (mod) {
            devServer.moduleGraph.invalidateModule(mod);
            devServer.ws.send({ type: "full-reload" });
          }
        }
      });
    },
    // Resolve virtual module
    resolveId(id) {
      if (id === VIRTUAL_ROUTES_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
    },
    // Generate the routes module
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return generateRoutesModule(pagesDir, rootDir);
      }
    },
    // Transform JSX files
    transform(code, id) {
      if (!include.test(id)) return null;
      if (exclude && exclude.test(id)) return null;
      try {
        const result = transformSync(code, {
          filename: id,
          sourceMaps,
          plugins: [
            [whatBabelPlugin, { production }]
          ],
          parserOpts: {
            plugins: ["jsx", "typescript"]
          }
        });
        if (!result || !result.code) {
          return null;
        }
        let outputCode = result.code;
        if (hot && isDevMode && !production) {
          const isComponentFile = isComponentModule(code, id);
          if (isComponentFile) {
            outputCode += generateHMRBoundary(id);
          }
        }
        return {
          code: outputCode,
          map: result.map
        };
      } catch (error) {
        error.plugin = "vite-plugin-what";
        if (!error.id) error.id = id;
        if (error.loc === void 0 && error._loc) {
          error.loc = { file: id, line: error._loc.line, column: error._loc.column };
        }
        console.error(`[what] Error transforming ${id}:`, error.message);
        throw error;
      }
    },
    // HMR: detect component vs utility files and handle accordingly
    handleHotUpdate({ file, server: devServer, modules }) {
      if (!hot) return;
      if (!include.test(file)) return;
      if (exclude && exclude.test(file)) return;
      if (isUtilityFile(file)) {
        devServer.ws.send({ type: "full-reload" });
        return [];
      }
      return;
    },
    // Configure for development
    config(config, { mode }) {
      return {
        esbuild: {
          // Preserve JSX so our babel plugin handles it -- don't let esbuild transform it
          jsx: "preserve"
        },
        optimizeDeps: {
          // Pre-bundle the framework
          include: ["what-framework"]
        }
      };
    }
  };
}
function isComponentModule(source, filePath) {
  if (COMPONENT_EXPORT_RE.test(source)) return true;
  if (filePath.includes("/pages/") || filePath.includes("\\pages\\")) return true;
  return false;
}
function isUtilityFile(filePath) {
  const basename = path2.basename(filePath, path2.extname(filePath));
  return UTILITY_FILE_RE.test(basename);
}
function generateHMRBoundary(filePath) {
  return `

// --- What Framework HMR Boundary ---
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      // Signal to the What runtime that this module was hot-updated
      if (window.__WHAT_HMR_ACCEPT__) {
        window.__WHAT_HMR_ACCEPT__(${JSON.stringify(filePath)}, newModule);
      }
    }
  });
}
`;
}

// packages/compiler/src/runtime.js
import { h, Fragment, mount, Island } from "what-core";
export {
  Fragment,
  Island,
  whatBabelPlugin as babelPlugin,
  extractPageConfig,
  generateRoutesModule,
  h,
  mount,
  scanPages,
  whatVitePlugin as vitePlugin,
  whatVitePlugin as what
};
//# sourceMappingURL=index.js.map
