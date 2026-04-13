// What Text - TextCanvas (ALPHA)
// Renders text to <canvas> via Pretext layout. Requires @chenglou/pretext.
// No text selection or a11y in alpha.
// @alpha APIs may change without a major version bump.

import { effect } from 'what-core';
import { ensurePretext } from '../text-engine.js';

function parseFontSize(fontStr) {
  const match = fontStr.match(/(\d+(?:\.\d+)?)\s*px/i);
  return match ? parseFloat(match[1]) : 16;
}

export function TextCanvas(props) {
  const width = props.width || 300;
  const height = props.height || 150;
  const font = props.font || '16px sans-serif';
  const children = props.children;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // Load Pretext async, then set up reactive rendering
  ensurePretext().then((pretext) => {
    effect(() => {
      const text = typeof children === 'function' ? children() : children;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.font = font;
      const lineHeight = parseFontSize(font) * 1.5;
      const prepared = pretext.prepareWithSegments(String(text || ''), font);
      const layout = pretext.layoutWithLines(prepared, width, lineHeight);
      ctx.fillStyle = getComputedStyle(canvas).color || '#000';
      ctx.textBaseline = 'top';
      if (layout && Array.isArray(layout.lines)) {
        for (const line of layout.lines) {
          ctx.fillText(line.text, 0, line.start ? line.start.segmentIndex * lineHeight : layout.lines.indexOf(line) * lineHeight);
        }
      }
    });
  }).catch((err) => {
    // Show error in canvas
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f44';
      ctx.font = '14px sans-serif';
      ctx.fillText('TextCanvas requires @chenglou/pretext', 10, 30);
      ctx.fillText('npm install @chenglou/pretext', 10, 50);
    }
  });

  return canvas;
}
