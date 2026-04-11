import { signal, effect, mount } from 'what-framework';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

const SAMPLE = `Typography is the art and technique of arranging type to make written language legible, readable, and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing, and letter-spacing, as well as adjusting the space between pairs of letters. Type design is a closely related craft, sometimes considered part of typography.`;

const LONG = `In the beginning was the Word, and the Word was with the typesetter, and the Word was set in Garamond. And the typesetter saw the letterforms, and they were good. The descenders descended gracefully, and the ascenders reached toward the heavens with quiet dignity. Each glyph was placed with intention, each space calculated to guide the eye across the line, from margin to margin, from thought to thought. The rivers of white space flowed naturally between the words, never pooling, never stagnating, always carrying the reader forward. And so the text was set, and it was readable, and the readers were pleased.`;

// --- State ---
const width = signal(600, 'width');
const lh = signal(26, 'lineHeight');
const fs = signal(16, 'fontSize');
const cols = signal(1, 'columns');
const useCustom = signal(false);
const customText = signal('');
const activeTab = signal('reflow');

const content = () => (useCustom() && customText()) ? customText() : SAMPLE;
const fontStr = () => `${fs()}px Inter, system-ui, sans-serif`;

// --- Slider component ---
function Slider({ label, value, min, max, step }) {
  return (
    <div style="margin-bottom: 4px;">
      <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px; font-family: 'JetBrains Mono', monospace;">
        {() => `${label}: ${value()}`}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step || 1}
        value={value()}
        onInput={(e) => value(Number(e.target.value))}
        style="width: 100%; accent-color: #2563eb;"
      />
    </div>
  );
}

// --- Tab button ---
function Tab({ id, label }) {
  const el = document.createElement('button');
  el.textContent = label;
  el.onclick = () => activeTab(id);
  el.style.cssText = 'padding: 10px 20px; border: none; background: none; cursor: pointer; font-size: 14px; font-family: inherit; margin-bottom: -1px; transition: all 0.15s;';
  effect(() => {
    const active = activeTab() === id;
    el.style.color = active ? '#e0e0e0' : '#555';
    el.style.borderBottom = active ? '2px solid #2563eb' : '2px solid transparent';
  });
  return el;
}

// --- Live Reflow Demo ---
function ReflowDemo() {
  const statsText = signal('');

  effect(() => {
    const w = width(), lineH = lh(), fSize = fs(), c = cols(), txt = content(), font = fontStr();
    const t0 = performance.now();
    const prepared = prepareWithSegments(txt, font);
    const colW = c > 1 ? (w - (c - 1) * 24) / c : w;
    const result = layoutWithLines(prepared, colW, lineH);
    const elapsed = performance.now() - t0;
    statsText(`pretext: ${result.lineCount} lines x ${c} col${c > 1 ? 's' : ''} | ${result.height.toFixed(0)}px | ${elapsed.toFixed(2)}ms (no reflow)`);
  });

  return (
    <div style="border: 1px solid #222; border-radius: 10px; background: #0d0d0d; overflow: hidden;">
      <div style="padding: 20px;">
        <div style={() => `width: ${width()}px; font-size: ${fs()}px; line-height: ${lh()}px; column-count: ${cols()}; column-gap: 24px; color: #ccc; font-family: Inter, system-ui, sans-serif; transition: width 0.15s ease;`}>
          {content}
        </div>
      </div>
      <div style="padding: 10px 20px; font: 12px 'JetBrains Mono', monospace; color: #555; border-top: 1px solid #1a1a1a; background: #080808;">
        {() => statsText()}
      </div>
    </div>
  );
}

// --- Canvas Demo ---
function CanvasDemo() {
  const canvasRef = signal(null);

  effect(() => {
    const canvas = canvasRef();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = width(), lineH = lh(), fSize = fs(), txt = content(), font = fontStr();
    const cw = 1560, ch = 800, scale = 2;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, cw, ch);

    const offsetX = (cw - w * scale) / 2;
    const offsetY = 30 * scale;

    ctx.strokeStyle = '#282828';
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(offsetX, offsetY, w * scale, ch - 60 * scale);
    ctx.setLineDash([]);

    const prepared = prepareWithSegments(txt, font);
    const result = layoutWithLines(prepared, w, lineH);

    ctx.font = `${fSize * scale}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#ccc';
    ctx.textBaseline = 'top';

    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i];
      const y = offsetY + 16 * scale + i * lineH * scale;
      if (y + lineH * scale > ch - 30 * scale) break;
      ctx.fillText(line.text, offsetX + 12 * scale, y);
    }

    ctx.fillStyle = '#555';
    ctx.font = `${11 * scale}px JetBrains Mono, monospace`;
    ctx.fillText(`canvas: ${result.lineCount} lines | ${result.height.toFixed(0)}px`, offsetX + 12 * scale, ch - 18 * scale);
  });

  return (
    <div style="border: 1px solid #222; border-radius: 10px; background: #0d0d0d; overflow: hidden;">
      <canvas
        ref={(el) => canvasRef(el)}
        width="1560"
        height="800"
        style="width: 100%; height: auto; display: block;"
      />
    </div>
  );
}

// --- SVG Demo ---
function SVGDemo() {
  const svgLines = signal([]);
  const statsText = signal('');

  effect(() => {
    const w = width(), lineH = lh(), fSize = fs(), txt = content(), font = fontStr();
    const prepared = prepareWithSegments(txt, font);
    const result = layoutWithLines(prepared, w, lineH);
    const offsetX = (780 - w) / 2;

    const lines = [];
    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i];
      const y = 30 + i * lineH;
      if (y > 370) break;
      lines.push({ text: line.text, x: offsetX + 8, y, fontSize: fSize });
    }
    svgLines(lines);
    statsText(`svg: ${result.lineCount} lines | ${result.height.toFixed(0)}px`);
  });

  // SVG needs raw DOM since JSX doesn't handle SVG namespaces well
  const container = document.createElement('div');
  container.style.cssText = 'border: 1px solid #222; border-radius: 10px; background: #0d0d0d; overflow: hidden;';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 780 400');
  svg.style.cssText = 'width: 100%; background: #0d0d0d; display: block;';
  const group = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(group);
  container.appendChild(svg);

  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = 'padding: 10px 20px; font: 12px "JetBrains Mono", monospace; color: #555; border-top: 1px solid #1a1a1a; background: #080808;';
  container.appendChild(statsDiv);

  effect(() => {
    const lines = svgLines();
    const w = width();
    while (group.firstChild) group.removeChild(group.firstChild);

    const offsetX = (780 - w) / 2;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(offsetX));
    rect.setAttribute('y', '15');
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', '370');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#282828');
    rect.setAttribute('stroke-dasharray', '6 6');
    group.appendChild(rect);

    for (const l of lines) {
      const tEl = document.createElementNS(SVG_NS, 'text');
      tEl.setAttribute('x', String(l.x));
      tEl.setAttribute('y', String(l.y));
      tEl.setAttribute('fill', '#ccc');
      tEl.setAttribute('font-size', String(l.fontSize));
      tEl.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      tEl.textContent = l.text;
      group.appendChild(tEl);
    }

    statsDiv.textContent = statsText();
  });

  return container;
}

// --- Performance Demo ---
function PerfDemo() {
  const container = document.createElement('div');
  container.style.cssText = 'border: 1px solid #222; border-radius: 10px; background: #0d0d0d; overflow: hidden;';

  const inner = document.createElement('div');
  inner.style.cssText = 'padding: 20px;';

  const btn = document.createElement('button');
  btn.textContent = 'Run Benchmark (500 layouts)';
  btn.style.cssText = 'padding: 12px 24px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-family: inherit; font-weight: 500;';

  const pre = document.createElement('pre');
  pre.style.cssText = "margin-top: 16px; font: 13px/1.7 'JetBrains Mono', monospace; color: #ccc; background: #080808; padding: 20px; border-radius: 8px; border: 1px solid #222; white-space: pre-wrap;";
  pre.textContent = 'Compare Pretext layout speed vs DOM reflow.\n\nThis will:\n  1. Prepare text once (font metrics via canvas)\n  2. Run layout() 500 times at different widths\n  3. Do the same via DOM offsetHeight\n\nThe difference is Pretext\'s core insight:\nprepare() is expensive (once), layout() is free (arithmetic).';

  btn.onclick = () => {
    btn.textContent = 'Running...';
    pre.textContent = 'Running...';
    requestAnimationFrame(() => {
      const font = '16px Inter, system-ui, sans-serif';
      const prepared = prepareWithSegments(LONG, font);

      const t0 = performance.now();
      for (let i = 0; i < 500; i++) layoutWithLines(prepared, 300 + (i % 400), 24);
      const pretextTime = performance.now() - t0;

      const measurer = document.createElement('div');
      measurer.style.cssText = 'position:absolute;visibility:hidden;font:16px Inter,system-ui,sans-serif;line-height:24px;top:-9999px;';
      document.body.appendChild(measurer);
      measurer.textContent = LONG;

      const t1 = performance.now();
      for (let i = 0; i < 500; i++) {
        measurer.style.width = `${300 + (i % 400)}px`;
        void measurer.offsetHeight;
      }
      const domTime = performance.now() - t1;
      document.body.removeChild(measurer);

      const speedup = (domTime / pretextTime).toFixed(0);
      pre.textContent =
        `500 text layouts at different widths\n\n` +
        `Pretext (prepare once + 500x layout):  ${pretextTime.toFixed(2)}ms\n` +
        `DOM (500x width change + offsetHeight): ${domTime.toFixed(2)}ms\n\n` +
        `>>> Pretext is ${speedup}x faster <<<\n\n` +
        `prepare() reads font metrics once via Canvas.\n` +
        `After that, layout() is pure arithmetic — no DOM, no reflow.`;
      btn.textContent = 'Run Benchmark (500 layouts)';
    });
  };

  inner.appendChild(btn);
  inner.appendChild(pre);
  container.appendChild(inner);
  return container;
}

// --- App ---
function App() {
  return (
    <div>
      <div style="margin-bottom: 36px;">
        <h1 style="font-size: 32px; font-weight: 700; margin-bottom: 8px;">Pretext Integration</h1>
        <p style="color: #888; font-size: 15px; margin-bottom: 4px;">
          DOM-free text measurement powered by{' '}
          <a href="https://github.com/chenglou/pretext" target="_blank" style="color: #60a5fa; text-decoration: none;">@chenglou/pretext</a>
        </p>
        <p style="color: #555; font-size: 13px;">
          <span style="background: #1e3a5f; color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">ALPHA</span>
          {' '}Text layout without browser reflow — pure arithmetic after initial font probing
        </p>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <Slider label="WIDTH" value={width} min="200" max="780" step="5" />
        <Slider label="LINE HEIGHT" value={lh} min="16" max="48" />
        <Slider label="FONT SIZE" value={fs} min="10" max="36" />
        <Slider label="COLUMNS" value={cols} min="1" max="4" />
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #888; cursor: pointer; margin-bottom: 8px;">
          <input type="checkbox" onChange={(e) => useCustom(e.target.checked)} style="accent-color: #2563eb;" />
          Use custom text
        </label>
        <textarea
          placeholder="Paste or type your own text..."
          onInput={(e) => customText(e.target.value)}
          style="width: 100%; min-height: 80px; padding: 12px; font-size: 14px; border: 1px solid #282828; border-radius: 8px; background: #111; color: #e0e0e0; resize: vertical; font-family: inherit; display: none;"
          ref={(el) => effect(() => { el.style.display = useCustom() ? 'block' : 'none'; })}
        />
      </div>

      <div style="display: flex; gap: 0; border-bottom: 1px solid #222; margin-bottom: 24px;">
        <Tab id="reflow" label="Live Reflow" />
        <Tab id="canvas" label="Canvas" />
        <Tab id="svg" label="SVG" />
        <Tab id="perf" label="Performance" />
      </div>

      <div ref={(el) => effect(() => { el.style.display = activeTab() === 'reflow' ? '' : 'none'; })}><ReflowDemo /></div>
      <div ref={(el) => effect(() => { el.style.display = activeTab() === 'canvas' ? '' : 'none'; })}><CanvasDemo /></div>
      <div ref={(el) => effect(() => { el.style.display = activeTab() === 'svg' ? '' : 'none'; })}><SVGDemo /></div>
      <div ref={(el) => effect(() => { el.style.display = activeTab() === 'perf' ? '' : 'none'; })}><PerfDemo /></div>
    </div>
  );
}

mount(<App />, '#app');
