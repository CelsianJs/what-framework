/**
 * Rule: what/no-camelcase-events
 *
 * Asks for the DOM's lowercase event names in JSX (onclick, onchange) instead
 * of React's (onClick, onChange), for a codebase that wants them. Off in every
 * preset: What's runtime maps React's names itself in every JSX pipeline, h(),
 * the automatic runtime (jsxImportSource) and compiled JSX alike (onClick
 * listens for `click`, onDoubleClick for `dblclick`, onChange for `input` and
 * `change`), and the docs write onClick.
 * A file that imports from react, react-dom, preact or what-react is a React
 * component (run on what-react, say), whose JSX takes React's names, so the
 * rule leaves it alone.
 *
 * Reported when on:  <button onClick={fn} />
 * Its fix:           <button onclick={fn} />
 */

import { importsReact } from '../utils/what-state.js';

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
    // A style preference: code with React's names works, so it is not a problem.
    type: 'suggestion',
    docs: {
      description: "Prefer the DOM's lowercase event names in JSX (a style choice: the runtime takes React's too)",
      recommended: false,
    },
    fixable: 'code',
    messages: {
      camelCaseEvent:
        'Write the DOM\'s event name "{{fix}}" for "{{name}}" (this project prefers it; What\'s runtime takes both).',
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

    let reactFile = false;
    return {
      Program(node) {
        reactFile = importsReact(node);
      },
      JSXAttribute(node) {
        if (reactFile || node.name.type !== 'JSXIdentifier') return;

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
