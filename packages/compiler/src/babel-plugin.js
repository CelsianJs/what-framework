/**
 * What Framework Babel Plugin
 *
 * Two modes:
 * - 'vdom' (legacy): JSX → h() calls through VNode reconciler
 * - 'fine-grained' (default): JSX → template() + insert() + effect() calls
 *   Static HTML extracted to templates, dynamic expressions wrapped in effects.
 *
 * Fine-grained output:
 *   const _t$ = template('<div class="container"><h1>Title</h1><p></p></div>');
 *   function App() {
 *     const _el$ = _t$();
 *     insert(_el$.children[1], () => desc());
 *     return _el$;
 *   }
 *
 * VDOM output (legacy):
 *   h('div', { class: 'container' }, h('h1', null, 'Title'), h('p', null, desc()))
 */

const EVENT_MODIFIERS = new Set(['preventDefault', 'stopPropagation', 'once', 'capture', 'passive', 'self']);
const EVENT_OPTION_MODIFIERS = new Set(['once', 'capture', 'passive']);

export default function whatBabelPlugin({ types: t }) {
  const mode = 'fine-grained'; // Can be overridden via plugin options

  // =====================================================
  // Shared utilities (used by both modes)
  // =====================================================

  function parseEventModifiers(name) {
    const parts = name.split('|');
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

  function getAttributeValue(value) {
    if (!value) return t.booleanLiteral(true);
    if (t.isJSXExpressionContainer(value)) return value.expression;
    if (t.isStringLiteral(value)) return value;
    return t.stringLiteral(value.value || '');
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
  // VDOM Mode (legacy h() calls)
  // =====================================================

  function transformChildrenVdom(children, state) {
    const result = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, ' ').trim();
        if (text) result.push(t.stringLiteral(text));
      } else if (t.isJSXExpressionContainer(child)) {
        if (!t.isJSXEmptyExpression(child.expression)) {
          result.push(child.expression);
        }
      } else if (t.isJSXElement(child)) {
        result.push(transformElementVdom({ node: child }, state));
      } else if (t.isJSXFragment(child)) {
        result.push(transformFragmentVdom({ node: child }, state));
      }
    }
    return result;
  }

  function transformElementVdom(path, state) {
    const { node } = path;
    const openingElement = node.openingElement;
    const tagName = openingElement.name.name;
    const attributes = openingElement.attributes;
    const children = node.children;

    if (isComponent(tagName)) {
      return transformComponentVdom(path, state);
    }

    const props = [];
    let hasSpread = false;
    let spreadExpr = null;

    for (const attr of attributes) {
      if (t.isJSXSpreadAttribute(attr)) {
        hasSpread = true;
        spreadExpr = attr.argument;
        continue;
      }

      const attrName = typeof attr.name.name === 'string' ? attr.name.name : String(attr.name.name);

      if (attrName.startsWith('on') && attrName.includes('|')) {
        const { eventName, modifiers } = parseEventModifiers(attrName);
        const handler = getAttributeValue(attr.value);
        const wrappedHandler = createEventHandler(handler, modifiers);

        const optionMods = modifiers.filter(m => EVENT_OPTION_MODIFIERS.has(m));
        if (optionMods.length > 0) {
          const tempId = path.scope
            ? path.scope.generateUidIdentifier('handler')
            : t.identifier('_h' + Math.random().toString(36).slice(2, 6));

          const optsProps = optionMods.map(m =>
            t.objectProperty(t.identifier(m), t.booleanLiteral(true))
          );

          const iifeHandler = t.callExpression(
            t.arrowFunctionExpression(
              [],
              t.blockStatement([
                t.variableDeclaration('const', [
                  t.variableDeclarator(tempId, wrappedHandler)
                ]),
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.memberExpression(t.cloneNode(tempId), t.identifier('_eventOpts')),
                    t.objectExpression(optsProps)
                  )
                ),
                t.returnStatement(t.cloneNode(tempId))
              ])
            ),
            []
          );

          props.push(t.objectProperty(t.identifier(eventName), iifeHandler));
        } else {
          props.push(t.objectProperty(t.identifier(eventName), wrappedHandler));
        }
        continue;
      }

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

      const value = getAttributeValue(attr.value);
      let domAttrName = attrName;
      if (attrName === 'className') domAttrName = 'class';
      if (attrName === 'htmlFor') domAttrName = 'for';

      props.push(
        t.objectProperty(
          /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(domAttrName)
            ? t.identifier(domAttrName)
            : t.stringLiteral(domAttrName),
          value
        )
      );
    }

    const transformedChildren = transformChildrenVdom(children, state);

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

    const args = [t.stringLiteral(tagName), propsExpr, ...transformedChildren];
    state.needsH = true;
    return t.callExpression(t.identifier('h'), args);
  }

  function transformComponentVdom(path, state) {
    const { node } = path;
    const openingElement = node.openingElement;
    const componentName = openingElement.name.name;
    const attributes = openingElement.attributes;
    const children = node.children;

    let clientDirective = null;
    const filteredAttrs = [];

    for (const attr of attributes) {
      if (t.isJSXAttribute(attr)) {
        const name = attr.name.name;
        if (name && name.startsWith('client:')) {
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
      state.needsH = true;
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
        const attrName = attr.name.name;
        const value = getAttributeValue(attr.value);
        islandProps.push(t.objectProperty(t.identifier(attrName), value));
      }

      return t.callExpression(
        t.identifier('h'),
        [t.identifier('Island'), t.objectExpression(islandProps)]
      );
    }

    const props = [];
    let hasSpread = false;
    let spreadExpr = null;

    for (const attr of filteredAttrs) {
      if (t.isJSXSpreadAttribute(attr)) {
        hasSpread = true;
        spreadExpr = attr.argument;
        continue;
      }

      const attrName = attr.name.name;
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

    const transformedChildren = transformChildrenVdom(children, state);

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

    const args = [t.identifier(componentName), propsExpr, ...transformedChildren];
    state.needsH = true;
    return t.callExpression(t.identifier('h'), args);
  }

  function transformFragmentVdom(path, state) {
    const { node } = path;
    const transformedChildren = transformChildrenVdom(node.children, state);

    state.needsH = true;
    state.needsFragment = true;

    return t.callExpression(
      t.identifier('h'),
      [t.identifier('Fragment'), t.nullLiteral(), ...transformedChildren]
    );
  }

  // =====================================================
  // Fine-Grained Mode (template + insert + effect)
  // =====================================================

  let templateCounter = 0;

  // Check if a JSX child is static (no expressions)
  function isStaticChild(child) {
    if (t.isJSXText(child)) return true;
    if (t.isJSXExpressionContainer(child)) return false;
    if (t.isJSXElement(child)) {
      const el = child.openingElement;
      const tagName = el.name.name;
      if (isComponent(tagName)) return false;
      // Check if attributes are all static
      for (const attr of el.attributes) {
        if (t.isJSXSpreadAttribute(attr)) return false;
        const value = attr.value;
        if (t.isJSXExpressionContainer(value)) return false;
      }
      // Check children recursively
      return child.children.every(isStaticChild);
    }
    return false;
  }

  // Check if an attribute value is dynamic (expression, not string literal)
  function isDynamicAttr(attr) {
    if (t.isJSXSpreadAttribute(attr)) return true;
    if (!attr.value) return false; // boolean attr like `disabled`
    return t.isJSXExpressionContainer(attr.value);
  }

  // Check if an expression is potentially reactive (contains function calls)
  function isPotentiallyReactive(expr) {
    if (t.isCallExpression(expr)) return true;
    if (t.isMemberExpression(expr)) return isPotentiallyReactive(expr.object);
    if (t.isConditionalExpression(expr)) {
      return isPotentiallyReactive(expr.test) || isPotentiallyReactive(expr.consequent) || isPotentiallyReactive(expr.alternate);
    }
    if (t.isBinaryExpression(expr) || t.isLogicalExpression(expr)) {
      return isPotentiallyReactive(expr.left) || isPotentiallyReactive(expr.right);
    }
    if (t.isTemplateLiteral(expr)) {
      return expr.expressions.some(isPotentiallyReactive);
    }
    return false;
  }

  // Extract static HTML from JSX element for template()
  function extractStaticHTML(node) {
    if (t.isJSXText(node)) {
      const text = node.value.replace(/\n\s+/g, ' ').trim();
      return text ? escapeHTML(text) : '';
    }

    if (t.isJSXExpressionContainer(node)) {
      // Dynamic — leave a placeholder
      return '';
    }

    if (!t.isJSXElement(node)) return '';

    const el = node.openingElement;
    const tagName = el.name.name;

    if (isComponent(tagName)) return '';

    let html = `<${tagName}`;

    // Static attributes
    for (const attr of el.attributes) {
      if (t.isJSXSpreadAttribute(attr)) continue;
      const name = attr.name.name;
      if (name.startsWith('on') || name.startsWith('bind:') || name.includes('|')) continue;

      let domName = name;
      if (name === 'className') domName = 'class';
      if (name === 'htmlFor') domName = 'for';

      if (!attr.value) {
        html += ` ${domName}`;
      } else if (t.isStringLiteral(attr.value)) {
        html += ` ${domName}="${escapeAttr(attr.value.value)}"`;
      } else if (t.isJSXExpressionContainer(attr.value)) {
        // Dynamic attr — skip from template, will be set via effect
        continue;
      }
    }

    const selfClosing = node.openingElement.selfClosing;
    if (selfClosing) {
      // Void elements
      html += '/>';
      return html;
    }

    html += '>';

    // Children
    for (const child of node.children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, ' ').trim();
        if (text) html += escapeHTML(text);
      } else if (t.isJSXExpressionContainer(child)) {
        // Dynamic child — placeholder will be handled by insert()
        // Skip entirely from template
      } else if (t.isJSXElement(child)) {
        if (isComponent(child.openingElement.name.name)) {
          // Component — skip from template
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
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // Analyze JSX tree and generate fine-grained output
  function transformElementFineGrained(path, state) {
    const { node } = path;
    const openingElement = node.openingElement;
    const tagName = openingElement.name.name;

    if (isComponent(tagName)) {
      return transformComponentFineGrained(path, state);
    }

    // For <For> and <Show> control flow components
    if (tagName === 'For') {
      return transformForFineGrained(path, state);
    }
    if (tagName === 'Show') {
      return transformShowFineGrained(path, state);
    }

    const attributes = openingElement.attributes;
    const children = node.children;

    // Check if this entire subtree is purely static
    const allChildrenStatic = children.every(isStaticChild);
    const allAttrsStatic = attributes.every(attr => !isDynamicAttr(attr));
    const noEvents = attributes.every(attr => {
      if (t.isJSXSpreadAttribute(attr)) return false;
      const name = attr.name?.name;
      return !name?.startsWith('on') && !name?.startsWith('bind:');
    });

    if (allChildrenStatic && allAttrsStatic && noEvents) {
      // Fully static element — extract to template, return clone call
      const html = extractStaticHTML(node);
      if (html) {
        const tmplId = generateTemplateId(state);
        state.templates.push({ id: tmplId, html });
        state.needsTemplate = true;
        return t.callExpression(t.identifier(tmplId), []);
      }
    }

    // Mixed static/dynamic element — extract template, add effects for dynamic parts
    const html = extractStaticHTML(node);
    if (!html) {
      // Fallback to VDOM mode for degenerate cases
      return transformElementVdom(path, state);
    }

    const tmplId = generateTemplateId(state);
    state.templates.push({ id: tmplId, html });
    state.needsTemplate = true;

    const elId = state.nextVarId();

    // _el$ = _t$()
    const statements = [
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(elId), t.callExpression(t.identifier(tmplId), []))
      ])
    ];

    // Apply dynamic attributes and events
    applyDynamicAttrs(statements, elId, attributes, state);

    // Handle dynamic children
    applyDynamicChildren(statements, elId, children, node, state);

    // Return the element — wrap in IIFE
    statements.push(t.returnStatement(t.identifier(elId)));

    return t.callExpression(
      t.arrowFunctionExpression([], t.blockStatement(statements)),
      []
    );
  }

  function applyDynamicAttrs(statements, elId, attributes, state) {
    for (const attr of attributes) {
      if (t.isJSXSpreadAttribute(attr)) {
        // spread(el, props) — use runtime spread
        state.needsSpread = true;
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier('_$spread'), [t.identifier(elId), attr.argument])
          )
        );
        continue;
      }

      const attrName = attr.name.name;

      // Event handlers
      if (attrName.startsWith('on') && !attrName.includes('|')) {
        const event = attrName.slice(2).toLowerCase();
        const handler = getAttributeValue(attr.value);
        // Direct addEventListener
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(elId), t.identifier('addEventListener')),
              [t.stringLiteral(event), handler]
            )
          )
        );
        continue;
      }

      // Event with modifiers
      if (attrName.startsWith('on') && attrName.includes('|')) {
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
          // Reactive value binding
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
          // Input listener
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
        }
        continue;
      }

      // Dynamic attribute (expression)
      if (t.isJSXExpressionContainer(attr.value)) {
        const expr = attr.value.expression;
        let domName = attrName;
        if (attrName === 'className') domName = 'class';
        if (attrName === 'htmlFor') domName = 'for';

        if (isPotentiallyReactive(expr)) {
          // Reactive attribute — wrap in effect
          state.needsEffect = true;
          if (domName === 'class') {
            statements.push(
              t.expressionStatement(
                t.callExpression(t.identifier('_$effect'), [
                  t.arrowFunctionExpression([], t.assignmentExpression('=',
                    t.memberExpression(t.identifier(elId), t.identifier('className')),
                    t.logicalExpression('||', expr, t.stringLiteral(''))
                  ))
                ])
              )
            );
          } else if (domName === 'style') {
            statements.push(
              t.expressionStatement(
                t.callExpression(t.identifier('_$effect'), [
                  t.arrowFunctionExpression([], t.blockStatement([
                    t.expressionStatement(
                      t.callExpression(
                        t.memberExpression(
                          t.memberExpression(t.identifier('Object'), t.identifier('assign')),
                          t.identifier('call')
                        ),
                        [t.nullLiteral(), t.memberExpression(t.identifier(elId), t.identifier('style')), expr]
                      )
                    )
                  ]))
                ])
              )
            );
          } else {
            statements.push(
              t.expressionStatement(
                t.callExpression(t.identifier('_$effect'), [
                  t.arrowFunctionExpression([], t.callExpression(
                    t.memberExpression(t.identifier(elId), t.identifier('setAttribute')),
                    [t.stringLiteral(domName), expr]
                  ))
                ])
              )
            );
          }
        } else {
          // Static expression (no signal calls) — set once
          if (domName === 'class') {
            statements.push(
              t.expressionStatement(
                t.assignmentExpression('=',
                  t.memberExpression(t.identifier(elId), t.identifier('className')),
                  t.logicalExpression('||', expr, t.stringLiteral(''))
                )
              )
            );
          } else {
            statements.push(
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(t.identifier(elId), t.identifier('setAttribute')),
                  [t.stringLiteral(domName), expr]
                )
              )
            );
          }
        }
      }
      // Static string/boolean attributes already in template
    }
  }

  function applyDynamicChildren(statements, elId, children, parentNode, state) {
    // Build a child access path. We need to track position relative to template's children.
    // Dynamic children (expressions and components) need insert() calls.
    let childIndex = 0;

    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, ' ').trim();
        if (text) childIndex++;
        continue;
      }

      if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) continue;

        const expr = child.expression;
        state.needsInsert = true;

        // insert(parent, () => expr, marker?)
        // For now use simple insert without marker — appends
        if (isPotentiallyReactive(expr)) {
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
        continue;
      }

      if (t.isJSXElement(child)) {
        const childTag = child.openingElement.name.name;
        if (isComponent(childTag) || childTag === 'For' || childTag === 'Show') {
          // Component/control-flow — transform and insert
          const transformed = transformElementFineGrained({ node: child }, state);
          state.needsInsert = true;
          statements.push(
            t.expressionStatement(
              t.callExpression(t.identifier('_$insert'), [
                t.identifier(elId),
                transformed
              ])
            )
          );
        } else {
          // Static child element — already in template
          // But check if it has dynamic children/attrs that need effects
          const hasAnythingDynamic = child.openingElement.attributes.some(isDynamicAttr) ||
            child.openingElement.attributes.some(a => !t.isJSXSpreadAttribute(a) && a.name?.name?.startsWith('on')) ||
            !child.children.every(isStaticChild);

          if (hasAnythingDynamic) {
            // Need to reference this child element and apply effects to it
            const childElId = state.nextVarId();
            statements.push(
              t.variableDeclaration('const', [
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
        // Inline fragment children
        for (const fChild of child.children) {
          if (t.isJSXExpressionContainer(fChild) && !t.isJSXEmptyExpression(fChild.expression)) {
            state.needsInsert = true;
            const expr = fChild.expression;
            if (isPotentiallyReactive(expr)) {
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
    // Build _el$.children[index] or _el$.firstChild / .firstChild.nextSibling chain
    // Use children[n] for simplicity and readability
    return t.memberExpression(
      t.memberExpression(t.identifier(elId), t.identifier('children')),
      t.numericLiteral(index),
      true // computed
    );
  }

  function transformComponentFineGrained(path, state) {
    // Components in fine-grained mode still use h() for now (backward compat)
    // The component itself decides how to render (vdom or fine-grained)
    return transformComponentVdom(path, state);
  }

  function transformForFineGrained(path, state) {
    const { node } = path;
    const attributes = node.openingElement.attributes;
    const children = node.children;

    // <For each={data}>{(item) => <Row />}</For>
    // → mapArray(data, (item) => ...)
    let eachExpr = null;
    for (const attr of attributes) {
      if (t.isJSXAttribute(attr) && attr.name.name === 'each') {
        eachExpr = getAttributeValue(attr.value);
      }
    }

    if (!eachExpr) {
      // Fallback
      return transformElementVdom(path, state);
    }

    // Get the render function from children
    let renderFn = null;
    for (const child of children) {
      if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
        renderFn = child.expression;
        break;
      }
    }

    if (!renderFn) {
      return transformElementVdom(path, state);
    }

    state.needsMapArray = true;
    return t.callExpression(t.identifier('_$mapArray'), [eachExpr, renderFn]);
  }

  function transformShowFineGrained(path, state) {
    const { node } = path;
    const attributes = node.openingElement.attributes;
    const children = node.children;

    // <Show when={cond}>{content}</Show>
    // Still uses h(Show, ...) for now — Show is a runtime component
    return transformElementVdom(path, state);
  }

  function transformFragmentFineGrained(path, state) {
    const { node } = path;
    const children = node.children;

    // Fragments with fine-grained: just return children array or single child
    const transformed = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, ' ').trim();
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

  function generateTemplateId(state) {
    return `_t$${state.templateCount++}`;
  }

  // =====================================================
  // Plugin entry
  // =====================================================

  return {
    name: 'what-jsx-transform',

    visitor: {
      Program: {
        enter(path, state) {
          // Read mode from plugin options
          const pluginMode = state.opts?.mode || mode;
          state.mode = pluginMode;

          // VDOM mode state
          state.needsH = false;
          state.needsFragment = false;
          state.needsIsland = false;

          // Fine-grained mode state
          state.needsTemplate = false;
          state.needsInsert = false;
          state.needsEffect = false;
          state.needsMapArray = false;
          state.needsSpread = false;
          state.templates = [];
          state.templateCount = 0;
          state._varCounter = 0;
          state.nextVarId = () => `_el$${state._varCounter++}`;
        },

        exit(path, state) {
          if (state.mode === 'fine-grained') {
            // Insert template declarations at top of program
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

            // Build imports
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

            // Also include h/Fragment/Island if vdom mode used for components
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
              // Check for existing render import
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

              if (!existingRenderImport) {
                path.unshiftContainer('body',
                  t.importDeclaration(fgSpecifiers, t.stringLiteral('what-framework/render'))
                );
              }
            }

            if (coreSpecifiers.length > 0) {
              addCoreImports(path, t, coreSpecifiers);
            }

          } else {
            // VDOM mode
            if (!state.needsH) return;

            const coreSpecifiers = [
              t.importSpecifier(t.identifier('h'), t.identifier('h')),
            ];
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

            addCoreImports(path, t, coreSpecifiers);
          }
        }
      },

      JSXElement(path, state) {
        const transformed = state.mode === 'fine-grained'
          ? transformElementFineGrained(path, state)
          : transformElementVdom(path, state);
        path.replaceWith(transformed);
      },

      JSXFragment(path, state) {
        const transformed = state.mode === 'fine-grained'
          ? transformFragmentFineGrained(path, state)
          : transformFragmentVdom(path, state);
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
