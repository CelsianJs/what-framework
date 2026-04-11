// What Framework - TextSVG (ALPHA)
// Renders text as SVG <text>/<tspan> elements via Pretext layout.
// @alpha APIs may change without a major version bump.

import { effect } from '../reactive.js';
import { _getPretextSync } from '../text-engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function TextSVG(props) {
  const width = props.width || 300;
  const height = props.height || 150;
  const font = props.font || '16px sans-serif';
  const children = props.children;

  const pretext = _getPretextSync();
  if (!pretext) {
    throw new Error(
      'TextSVG requires @chenglou/pretext. Install it with: npm i @chenglou/pretext'
    );
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const textEl = document.createElementNS(SVG_NS, 'text');
  svg.appendChild(textEl);

  effect(() => {
    const text = typeof children === 'function' ? children() : children;
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
    const lineHeight = parseFloat(font) * 1.2 || 20;
    const prepared = pretext.prepare(String(text || ''), font);
    const layout = pretext.layout(prepared, width, lineHeight);
    if (layout && Array.isArray(layout.lines)) {
      for (const line of layout.lines) {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('x', String(line.x || 0));
        tspan.setAttribute('y', String(line.y || lineHeight));
        tspan.textContent = line.text;
        textEl.appendChild(tspan);
      }
    }
  });

  return svg;
}
