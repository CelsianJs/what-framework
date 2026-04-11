// What Framework - TextCanvas (ALPHA)
// Renders text to a <canvas> element via Pretext layout + canvas fillText.
// No text selection or a11y in alpha.
// @alpha APIs may change without a major version bump.

import { effect } from '../reactive.js';
import { _getPretextSync } from '../text-engine.js';

export function TextCanvas(props) {
  const width = props.width || 300;
  const height = props.height || 150;
  const font = props.font || '16px sans-serif';
  const children = props.children;

  const pretext = _getPretextSync();
  if (!pretext) {
    throw new Error(
      'TextCanvas requires @chenglou/pretext. Install it with: npm i @chenglou/pretext'
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  effect(() => {
    const text = typeof children === 'function' ? children() : children;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return; // jsdom — no canvas context
    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    const lineHeight = parseFloat(font) * 1.2 || 20;
    const prepared = pretext.prepare(String(text || ''), font);
    const layout = pretext.layout(prepared, width, lineHeight);
    if (layout && Array.isArray(layout.lines)) {
      for (const line of layout.lines) {
        ctx.fillText(line.text, line.x || 0, line.y || lineHeight);
      }
    }
  });

  return canvas;
}
