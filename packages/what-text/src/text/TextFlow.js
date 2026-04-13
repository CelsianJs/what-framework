// What Text - TextFlow (ALPHA)
// Magazine-style text layout. Falls back to CSS columns without Pretext.
// @alpha APIs may change without a major version bump.

import { effect } from 'what-core';
import { ensurePretext, resolveFontInfo, fontInfoToString } from '../text-engine.js';

export function TextFlow(props) {
  const columns = props.columns || 1;
  const around = props.around;
  const gap = props.gap || '1rem';
  const children = props.children;

  const el = document.createElement('div');
  el.style.columnCount = String(columns);
  el.style.columnGap = gap;

  // Set text content reactively
  let currentText = '';
  effect(() => {
    const text = typeof children === 'function' ? children() : children;
    currentText = String(text || '');
    el.textContent = currentText;
  });

  // Warn if around is set but Pretext is missing — check AFTER the text effect
  // runs so there's no race condition reading el.textContent
  if (around) {
    ensurePretext().then((pretext) => {
      if (!el.isConnected) return;
      const font = resolveFontInfo(el);
      const fontStr = fontInfoToString(font);
      const width = el.clientWidth || 400;
      const lineHeight = parseFloat(font.lineHeight) || parseFloat(font.fontSize) * 1.2;
      const prepared = pretext.prepareWithSegments(currentText, fontStr);
      const layout = pretext.layoutWithLines(prepared, width / columns, lineHeight);
      if (typeof layout === 'object') {
        el.setAttribute('data-pretext', 'laid-out');
      }
    }).catch(() => {
      console.warn(
        '[what-text] TextFlow: `around` prop requires @chenglou/pretext for shape-flow layout. ' +
        'Install it with: npm i @chenglou/pretext'
      );
    });
  }

  return el;
}
