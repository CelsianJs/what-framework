// What Framework - TextFlow (ALPHA)
// Magazine-style text layout rendered to DOM. Uses Pretext for line-breaking
// and shape-flow when available; falls back to CSS column-count when Pretext
// is not installed.
// @alpha APIs may change without a major version bump.

import { effect } from '../reactive.js';
import { ensurePretext, resolveFontInfo, fontInfoToString } from '../text-engine.js';

const warnedAboutAround = new WeakSet();

export function TextFlow(props) {
  const columns = props.columns || 1;
  const around = props.around;
  const children = props.children;

  const el = document.createElement('div');
  el.style.columnCount = String(columns);
  el.style.columnGap = '1rem';

  // Reactive text content
  effect(() => {
    const text = typeof children === 'function' ? children() : children;
    el.textContent = String(text || '');
  });

  // Warn if `around` is set but Pretext is missing
  if (around && !warnedAboutAround.has(el)) {
    warnedAboutAround.add(el);
    ensurePretext().catch(() => {
      console.warn(
        '[what] TextFlow: `around` prop requires @chenglou/pretext for shape-flow layout. ' +
        'The prop has been dropped and basic column layout is used instead. ' +
        'Install it with: npm i @chenglou/pretext'
      );
    });
  }

  // Best-effort Pretext upgrade
  ensurePretext().then((pretext) => {
    if (!el.isConnected) return;
    const font = resolveFontInfo(el);
    const fontStr = fontInfoToString(font);
    const width = el.clientWidth || 400;
    const lineHeight = parseFloat(font.lineHeight) || parseFloat(font.fontSize) * 1.2;
    const text = el.textContent;
    const prepared = pretext.prepare(text, fontStr);
    const layout = pretext.layout(prepared, width / columns, lineHeight);
    if (typeof layout === 'object') {
      el.setAttribute('data-pretext', 'laid-out');
    }
  }).catch(() => {});

  return el;
}
