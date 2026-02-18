/**
 * Rule: what/no-camelcase-events
 *
 * Warn on camelCase event handlers (onClick, onChange, etc.) in JSX when not
 * using the What compiler. Without the compiler, esbuild passes props through
 * directly to the DOM, and DOM event handlers must be lowercase (onclick, onchange).
 *
 * The compiler normalizes these automatically, so this rule only applies to
 * projects using esbuild's built-in JSX transform instead of what-compiler.
 *
 * Bad (without compiler):  <button onClick={fn} />
 * Good (without compiler): <button onclick={fn} />
 * Good (with compiler):    <button onClick={fn} />  — compiler handles it
 */

// Common DOM events that have camelCase variants
const CAMEL_EVENTS = new Map([
  ['onClick', 'onclick'],
  ['onChange', 'onchange'],
  ['onInput', 'oninput'],
  ['onSubmit', 'onsubmit'],
  ['onFocus', 'onfocus'],
  ['onBlur', 'onblur'],
  ['onKeyDown', 'onkeydown'],
  ['onKeyUp', 'onkeyup'],
  ['onKeyPress', 'onkeypress'],
  ['onMouseDown', 'onmousedown'],
  ['onMouseUp', 'onmouseup'],
  ['onMouseMove', 'onmousemove'],
  ['onMouseEnter', 'onmouseenter'],
  ['onMouseLeave', 'onmouseleave'],
  ['onMouseOver', 'onmouseover'],
  ['onMouseOut', 'onmouseout'],
  ['onTouchStart', 'ontouchstart'],
  ['onTouchEnd', 'ontouchend'],
  ['onTouchMove', 'ontouchmove'],
  ['onScroll', 'onscroll'],
  ['onWheel', 'onwheel'],
  ['onDragStart', 'ondragstart'],
  ['onDragEnd', 'ondragend'],
  ['onDragOver', 'ondragover'],
  ['onDrop', 'ondrop'],
  ['onContextMenu', 'oncontextmenu'],
  ['onDoubleClick', 'ondblclick'],
  ['onPointerDown', 'onpointerdown'],
  ['onPointerUp', 'onpointerup'],
  ['onPointerMove', 'onpointermove'],
  ['onAnimationEnd', 'onanimationend'],
  ['onTransitionEnd', 'ontransitionend'],
  ['onLoad', 'onload'],
  ['onError', 'onerror'],
]);

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow camelCase event handlers in JSX without the compiler',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      camelCaseEvent:
        '"{{name}}" won\'t work without the What compiler. Use "{{fix}}" instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          hasCompiler: {
            type: 'boolean',
            description: 'Set to true if the project uses what-compiler (skips this rule)',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    if (options.hasCompiler === true) return {};

    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier') return;

        const name = node.name.name;
        const fix = CAMEL_EVENTS.get(name);

        if (fix) {
          context.report({
            node: node.name,
            messageId: 'camelCaseEvent',
            data: { name, fix },
            fix(fixer) {
              return fixer.replaceText(node.name, fix);
            },
          });
        }
      },
    };
  },
};
