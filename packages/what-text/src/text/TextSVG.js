// What Text - TextSVG (ALPHA)
// Renders text as SVG <text>/<tspan> elements via Pretext layout.
// Requires @chenglou/pretext.
// @alpha APIs may change without a major version bump.

import { effect } from 'what-core';
import { ensurePretext } from '../text-engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function parseFontSize(fontStr) {
  const match = fontStr.match(/(\d+(?:\.\d+)?)\s*px/i);
  return match ? parseFloat(match[1]) : 16;
}

export function TextSVG(props) {
  const width = props.width || 300;
  const height = props.height || 150;
  const font = props.font || '16px sans-serif';
  const children = props.children;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const textEl = document.createElementNS(SVG_NS, 'text');
  svg.appendChild(textEl);

  // Pool of tspan elements to avoid DOM thrash on every update
  let tspanPool = [];

  ensurePretext().then((pretext) => {
    effect(() => {
      const text = typeof children === 'function' ? children() : children;
      const fSize = parseFontSize(font);
      const lineHeight = fSize * 1.5;
      const prepared = pretext.prepareWithSegments(String(text || ''), font);
      const layout = pretext.layoutWithLines(prepared, width, lineHeight);
      const lines = layout && Array.isArray(layout.lines) ? layout.lines : [];

      // Grow pool if needed
      while (tspanPool.length < lines.length) {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        textEl.appendChild(tspan);
        tspanPool.push(tspan);
      }
      // Hide excess tspans
      for (let i = lines.length; i < tspanPool.length; i++) {
        tspanPool[i].textContent = '';
        tspanPool[i].setAttribute('display', 'none');
      }
      // Update visible tspans
      for (let i = 0; i < lines.length; i++) {
        const tspan = tspanPool[i];
        const line = lines[i];
        tspan.setAttribute('x', '0');
        tspan.setAttribute('y', String(fSize + i * lineHeight));
        tspan.setAttribute('font-size', String(fSize));
        tspan.setAttribute('font-family', font.replace(/^\d+(?:\.\d+)?\s*px\s*/, '').trim() || 'sans-serif');
        tspan.setAttribute('display', '');
        tspan.textContent = line.text;
      }
    });
  }).catch(() => {
    // Show error in SVG
    const errText = document.createElementNS(SVG_NS, 'text');
    errText.setAttribute('x', '10');
    errText.setAttribute('y', '30');
    errText.setAttribute('fill', '#f44');
    errText.setAttribute('font-size', '14');
    errText.textContent = 'TextSVG requires @chenglou/pretext';
    svg.appendChild(errText);
  });

  return svg;
}
