/**
 * What Framework Babel Plugin
 * Transforms JSX into h() calls, routing all rendering through core's VNode reconciler.
 *
 * Output: h(tag, props, ...children) from what-core
 *
 * Features:
 * - Elements: h('div', { class: 'foo', onClick: handler }, child1, child2)
 * - Components: h(Component, { prop: val }, child1, child2)
 * - Fragments: h(Fragment, null, child1, child2)
 * - Event modifiers: onClick|preventDefault → wrapped handler as normal onClick prop
 * - Event options (once/capture/passive): handler._eventOpts = { once: true }
 * - Two-way binding: bind:value={sig} → { value: sig(), onInput: e => sig.set(e.target.value) }
 * - Islands: <Comp client:idle /> → h(Island, { component: Comp, mode: 'idle' })
 * - SVG: handled by dom.js namespace detection, no special output needed
 * - Control flow: <Show when={x}> → h(Show, { when: x }, children) — normal components
 */

const EVENT_MODIFIERS = new Set(['preventDefault', 'stopPropagation', 'once', 'capture', 'passive', 'self']);
const EVENT_OPTION_MODIFIERS = new Set(['once', 'capture', 'passive']);

export default function whatBabelPlugin({ types: t }) {

  // Parse event modifiers from attribute name like onClick|preventDefault|once
  function parseEventModifiers(name) {
    const parts = name.split('|');
    const eventName = parts[0];
    const modifiers = parts.slice(1).filter(m => EVENT_MODIFIERS.has(m));
    return { eventName, modifiers };
  }

  // Check if attribute is a binding
  function isBindingAttribute(name) {
    return name.startsWith('bind:');
  }

  // Get the binding property from bind:value -> value
  function getBindingProperty(name) {
    return name.slice(5);
  }

  // Check if element is a component (starts with uppercase)
  function isComponent(name) {
    return /^[A-Z]/.test(name);
  }

  // Get the expression from a JSX attribute value
  function getAttributeValue(value) {
    if (!value) return t.booleanLiteral(true);
    if (t.isJSXExpressionContainer(value)) return value.expression;
    if (t.isStringLiteral(value)) return value;
    return t.stringLiteral(value.value || '');
  }

  // Create event handler wrapper for inline modifiers (preventDefault, stopPropagation, self)
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

        // once, capture, passive are handled via _eventOpts, not handler wrapping
        case 'once':
        case 'capture':
        case 'passive':
          break;
      }
    }

    return wrappedHandler;
  }

  // Build _eventOpts assignment for once/capture/passive modifiers
  function buildEventOptsStatements(handlerIdentifier, modifiers) {
    const optionMods = modifiers.filter(m => EVENT_OPTION_MODIFIERS.has(m));
    if (optionMods.length === 0) return [];

    const optsProps = optionMods.map(m =>
      t.objectProperty(t.identifier(m), t.booleanLiteral(true))
    );

    // handler._eventOpts = { once: true, ... }
    return [
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(handlerIdentifier, t.identifier('_eventOpts')),
          t.objectExpression(optsProps)
        )
      )
    ];
  }

  // Transform children array from JSX
  function transformChildren(children, state) {
    const result = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = child.value.replace(/\n\s+/g, ' ').trim();
        if (text) {
          result.push(t.stringLiteral(text));
        }
      } else if (t.isJSXExpressionContainer(child)) {
        if (!t.isJSXEmptyExpression(child.expression)) {
          result.push(child.expression);
        }
      } else if (t.isJSXElement(child)) {
        result.push(transformElement({ node: child }, state));
      } else if (t.isJSXFragment(child)) {
        // Inline fragment children
        result.push(transformFragment({ node: child }, state));
      }
    }
    return result;
  }

  // Transform a JSX element to h() call
  function transformElement(path, state) {
    const { node } = path;
    const openingElement = node.openingElement;
    const tagName = openingElement.name.name;
    const attributes = openingElement.attributes;
    const children = node.children;

    if (isComponent(tagName)) {
      return transformComponent(path, state);
    }

    // Build props
    const props = [];
    let hasSpread = false;
    let spreadExpr = null;
    const eventOptsStatements = [];

    for (const attr of attributes) {
      if (t.isJSXSpreadAttribute(attr)) {
        hasSpread = true;
        spreadExpr = attr.argument;
        continue;
      }

      const attrName = typeof attr.name.name === 'string' ? attr.name.name : String(attr.name.name);

      // Handle event modifiers: onClick|preventDefault
      if (attrName.startsWith('on') && attrName.includes('|')) {
        const { eventName, modifiers } = parseEventModifiers(attrName);
        const handler = getAttributeValue(attr.value);
        const wrappedHandler = createEventHandler(handler, modifiers);

        // Check if we need _eventOpts (once/capture/passive)
        const optionMods = modifiers.filter(m => EVENT_OPTION_MODIFIERS.has(m));
        if (optionMods.length > 0) {
          // Need a temp variable for the handler to attach _eventOpts
          const tempId = path.scope
            ? path.scope.generateUidIdentifier('handler')
            : t.identifier('_h' + Math.random().toString(36).slice(2, 6));

          // We'll use an IIFE: (() => { const _h = handler; _h._eventOpts = {...}; return _h; })()
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

          props.push(
            t.objectProperty(t.identifier(eventName), iifeHandler)
          );
        } else {
          props.push(
            t.objectProperty(t.identifier(eventName), wrappedHandler)
          );
        }
        continue;
      }

      // Handle two-way binding: bind:value={sig}
      if (isBindingAttribute(attrName)) {
        const bindProp = getBindingProperty(attrName);
        const signalExpr = attr.value.expression;

        if (bindProp === 'value') {
          // { value: sig(), onInput: (e) => sig.set(e.target.value) }
          props.push(
            t.objectProperty(
              t.identifier('value'),
              t.callExpression(t.cloneNode(signalExpr), [])
            )
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
          // { checked: sig(), onChange: (e) => sig.set(e.target.checked) }
          props.push(
            t.objectProperty(
              t.identifier('checked'),
              t.callExpression(t.cloneNode(signalExpr), [])
            )
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

      // Regular attributes
      const value = getAttributeValue(attr.value);

      // Normalize className -> class, htmlFor -> for
      let domAttrName = attrName;
      if (attrName === 'className') domAttrName = 'class';
      if (attrName === 'htmlFor') domAttrName = 'for';

      props.push(
        t.objectProperty(
          // Use identifier for valid JS identifiers, string literal otherwise
          /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(domAttrName)
            ? t.identifier(domAttrName)
            : t.stringLiteral(domAttrName),
          value
        )
      );
    }

    // Build the h() call: h(tag, props, ...children)
    const transformedChildren = transformChildren(children, state);

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

  // Transform component JSX
  function transformComponent(path, state) {
    const { node } = path;
    const openingElement = node.openingElement;
    const componentName = openingElement.name.name;
    const attributes = openingElement.attributes;
    const children = node.children;

    // Check for client directives (islands)
    let clientDirective = null;
    const filteredAttrs = [];

    for (const attr of attributes) {
      if (t.isJSXAttribute(attr)) {
        const name = attr.name.name;
        if (name && name.startsWith('client:')) {
          const mode = name.slice(7); // 'load', 'idle', 'visible', etc.
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

    // Handle islands — h(Island, { component: Comp, mode: 'idle', ...props })
    if (clientDirective) {
      state.needsH = true;
      state.needsIsland = true;

      const islandProps = [
        t.objectProperty(t.identifier('component'), t.identifier(componentName)),
        t.objectProperty(
          t.identifier('mode'),
          t.stringLiteral(clientDirective.type)
        ),
      ];

      if (clientDirective.value) {
        islandProps.push(
          t.objectProperty(
            t.identifier('mediaQuery'),
            t.stringLiteral(clientDirective.value)
          )
        );
      }

      // Add remaining props
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

    // Build props
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

    // Transform children
    const transformedChildren = transformChildren(children, state);

    // Build props expression
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

    // h(Component, props, ...children)
    const args = [t.identifier(componentName), propsExpr, ...transformedChildren];

    state.needsH = true;
    return t.callExpression(t.identifier('h'), args);
  }

  // Transform JSX fragment to h(Fragment, null, ...children)
  function transformFragment(path, state) {
    const { node } = path;
    const transformedChildren = transformChildren(node.children, state);

    state.needsH = true;
    state.needsFragment = true;

    return t.callExpression(
      t.identifier('h'),
      [t.identifier('Fragment'), t.nullLiteral(), ...transformedChildren]
    );
  }

  return {
    name: 'what-jsx-transform',

    visitor: {
      Program: {
        enter(path, state) {
          state.needsH = false;
          state.needsFragment = false;
          state.needsIsland = false;
        },

        exit(path, state) {
          if (!state.needsH) return;

          // Build imports from what-core
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

          const importDecl = t.importDeclaration(
            coreSpecifiers,
            t.stringLiteral('what-framework')
          );

          // Check if what-core is already imported
          let existingImport = null;
          for (const node of path.node.body) {
            if (t.isImportDeclaration(node) && node.source.value === 'what-core') {
              existingImport = node;
              break;
            }
          }

          // Also check what-framework (alias)
          if (!existingImport) {
            for (const node of path.node.body) {
              if (t.isImportDeclaration(node) && node.source.value === 'what-framework') {
                existingImport = node;
                break;
              }
            }
          }

          if (existingImport) {
            // Add missing specifiers to existing import
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
            path.unshiftContainer('body', importDecl);
          }
        }
      },

      JSXElement(path, state) {
        const transformed = transformElement(path, state);
        path.replaceWith(transformed);
      },

      JSXFragment(path, state) {
        const transformed = transformFragment(path, state);
        path.replaceWith(transformed);
      }
    }
  };
}
