import { signal, effect } from 'what-framework';
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

const SAMPLE_TEXT = `Typography is the art and technique of arranging type to make written language legible, readable, and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing (leading), and letter-spacing (tracking), as well as adjusting the space between pairs of letters (kerning). The term typography is also applied to the style, arrangement, and appearance of the letters, numbers, and symbols created by the process.`;

const LONG_TEXT = `In the beginning was the Word, and the Word was with the typesetter, and the Word was set in Garamond. And the typesetter saw the letterforms, and they were good. The descenders descended gracefully, and the ascenders reached toward the heavens with quiet dignity. Each glyph was placed with intention, each space calculated to guide the eye across the line, from margin to margin, from thought to thought. The rivers of white space flowed naturally between the words, never pooling, never stagnating, always carrying the reader forward. And so the text was set, and it was readable, and the readers were pleased.`;

// --- Reactive state ---
const containerWidth = signal(600, 'containerWidth');
const lineHeight = signal(24, 'lineHeight');
const fontSize = signal(16, 'fontSize');
const columns = signal(1, 'columns');
const text = signal(SAMPLE_TEXT, 'text');
const useCustomText = signal(false, 'useCustomText');
const customText = signal('', 'customText');
const activeDemo = signal('reflow', 'activeDemo');

// --- Canvas text rendering using real Pretext ---
function CanvasTextDemo() {
  const canvas = document.createElement('canvas');
  canvas.width = 700;
  canvas.height = 400;
  canvas.style.cssText = 'border: 1px solid #333; border-radius: 8px; background: #0a0a0a; width: 100%; max-width: 700px;';

  effect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const fs = fontSize();
    const lh = lineHeight();
    const maxW = containerWidth();
    const content = useCustomText() && customText() ? customText() : text();
    const font = `${fs}px system-ui, -apple-system, sans-serif`;

    ctx.clearRect(0, 0, w, h);

    // Draw container boundary
    const offsetX = (w - maxW) / 2;
    const offsetY = 20;
    ctx.strokeStyle = '#333';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(offsetX, offsetY, maxW, h - 40);
    ctx.setLineDash([]);

    // Use real Pretext to lay out text
    const prepared = prepareWithSegments(content, font);
    const result = layoutWithLines(prepared, maxW, lh);

    // Render each line
    ctx.font = font;
    ctx.fillStyle = '#e0e0e0';
    ctx.textBaseline = 'top';

    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i];
      const y = offsetY + 10 + i * lh;
      if (y + lh > h - 20) break;
      ctx.fillText(line.text, offsetX + 4, y);
    }

    // Stats overlay
    ctx.fillStyle = '#666';
    ctx.font = '11px monospace';
    ctx.fillText(`${result.lineCount} lines | ${result.height.toFixed(0)}px height | ${maxW}px width`, offsetX + 4, h - 18);
  });

  return canvas;
}

// --- SVG text rendering using real Pretext ---
function SVGTextDemo() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 700 350');
  svg.style.cssText = 'width: 100%; max-width: 700px; border: 1px solid #333; border-radius: 8px; background: #0a0a0a;';

  const textGroup = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(textGroup);

  effect(() => {
    const fs = fontSize();
    const lh = lineHeight();
    const maxW = containerWidth();
    const content = useCustomText() && customText() ? customText() : text();
    const font = `${fs}px system-ui, -apple-system, sans-serif`;

    while (textGroup.firstChild) textGroup.removeChild(textGroup.firstChild);

    // Container boundary
    const offsetX = (700 - maxW) / 2;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(offsetX));
    rect.setAttribute('y', '15');
    rect.setAttribute('width', String(maxW));
    rect.setAttribute('height', '310');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#333');
    rect.setAttribute('stroke-dasharray', '4 4');
    textGroup.appendChild(rect);

    const prepared = prepareWithSegments(content, font);
    const result = layoutWithLines(prepared, maxW, lh);

    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i];
      const y = 30 + i * lh;
      if (y > 310) break;
      const tEl = document.createElementNS(SVG_NS, 'text');
      tEl.setAttribute('x', String(offsetX + 4));
      tEl.setAttribute('y', String(y));
      tEl.setAttribute('fill', '#e0e0e0');
      tEl.setAttribute('font-size', String(fs));
      tEl.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      tEl.textContent = line.text;
      textGroup.appendChild(tEl);
    }

    // Stats
    const stats = document.createElementNS(SVG_NS, 'text');
    stats.setAttribute('x', String(offsetX + 4));
    stats.setAttribute('y', '340');
    stats.setAttribute('fill', '#666');
    stats.setAttribute('font-size', '11');
    stats.setAttribute('font-family', 'monospace');
    stats.textContent = `${result.lineCount} lines | ${result.height.toFixed(0)}px height | SVG render`;
    textGroup.appendChild(stats);
  });

  return svg;
}

// --- Live reflow demo (DOM-based, no framework component) ---
function ReflowDemo() {
  const container = document.createElement('div');
  container.style.cssText = 'position: relative; min-height: 200px;';

  const textEl = document.createElement('div');
  textEl.style.cssText = 'line-height: 1.5; color: #e0e0e0; font-family: system-ui, -apple-system, sans-serif; padding: 16px; border: 1px solid #333; border-radius: 8px; background: #0a0a0a; transition: width 0.15s ease;';
  container.appendChild(textEl);

  const statsEl = document.createElement('div');
  statsEl.style.cssText = 'margin-top: 8px; font: 11px monospace; color: #666;';
  container.appendChild(statsEl);

  effect(() => {
    const fs = fontSize();
    const lh = lineHeight();
    const maxW = containerWidth();
    const cols = columns();
    const content = useCustomText() && customText() ? customText() : text();
    const font = `${fs}px system-ui, -apple-system, sans-serif`;

    textEl.style.width = `${maxW}px`;
    textEl.style.fontSize = `${fs}px`;
    textEl.style.lineHeight = `${lh}px`;
    textEl.style.columnCount = String(cols);
    textEl.style.columnGap = '24px';

    // Measure with Pretext (no DOM reflow needed)
    const t0 = performance.now();
    const prepared = prepareWithSegments(content, font);
    const colWidth = cols > 1 ? (maxW - (cols - 1) * 24) / cols : maxW;
    const result = layoutWithLines(prepared, colWidth, lh);
    const elapsed = performance.now() - t0;

    textEl.textContent = content;
    statsEl.textContent = `Pretext: ${result.lineCount} lines × ${cols} col${cols > 1 ? 's' : ''} | ${result.height.toFixed(0)}px height | measured in ${elapsed.toFixed(2)}ms (no reflow)`;
  });

  return container;
}

// --- Performance comparison ---
function PerfDemo() {
  const container = document.createElement('div');
  const resultEl = document.createElement('pre');
  resultEl.style.cssText = 'font: 13px monospace; color: #e0e0e0; background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #333; white-space: pre-wrap; line-height: 1.6;';

  const runBtn = document.createElement('button');
  runBtn.textContent = 'Run Benchmark (500 layouts)';
  runBtn.style.cssText = 'padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin-bottom: 12px;';

  resultEl.textContent = 'Click the button to compare Pretext layout speed vs DOM measurement.\n\nThis will:\n1. Prepare text once (shared cost)\n2. Run layout() 500 times at different widths\n3. Compare against 500 DOM measurement cycles';

  runBtn.onclick = () => {
    resultEl.textContent = 'Running...';
    requestAnimationFrame(() => {
      const content = LONG_TEXT;
      const font = '16px system-ui, -apple-system, sans-serif';

      // Pretext: prepare once, layout 500 times at varying widths
      const prepared = prepareWithSegments(content, font);
      const t0 = performance.now();
      for (let i = 0; i < 500; i++) {
        const w = 300 + (i % 400);
        layoutWithLines(prepared, w, 24);
      }
      const pretextTime = performance.now() - t0;

      // DOM: create element, set text, read offsetHeight 500 times
      const measurer = document.createElement('div');
      measurer.style.cssText = 'position: absolute; visibility: hidden; font: 16px system-ui; line-height: 24px; top: -9999px;';
      document.body.appendChild(measurer);
      measurer.textContent = content;

      const t1 = performance.now();
      for (let i = 0; i < 500; i++) {
        measurer.style.width = `${300 + (i % 400)}px`;
        void measurer.offsetHeight; // force reflow
      }
      const domTime = performance.now() - t1;
      document.body.removeChild(measurer);

      const speedup = (domTime / pretextTime).toFixed(1);

      resultEl.textContent =
        `=== 500 Text Layouts at Different Widths ===\n\n` +
        `Pretext (prepare once + 500× layout):  ${pretextTime.toFixed(2)}ms\n` +
        `DOM (500× width change + offsetHeight): ${domTime.toFixed(2)}ms\n\n` +
        `Pretext is ${speedup}× faster\n\n` +
        `The key insight: prepare() reads font metrics once via Canvas.\n` +
        `After that, layout() is pure arithmetic — no DOM, no reflow.`;
    });
  };

  container.appendChild(runBtn);
  container.appendChild(resultEl);
  return container;
}

// --- Controls panel ---
function Controls() {
  const panel = document.createElement('div');
  panel.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;';

  function makeSlider(label, sig, min, max, step) {
    const wrap = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display: block; font-size: 13px; color: #999; margin-bottom: 4px;';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step || 1);
    slider.value = String(sig());
    slider.style.cssText = 'width: 100%; accent-color: #2563eb;';

    effect(() => { lbl.textContent = `${label}: ${sig()}`; });
    slider.oninput = () => sig(Number(slider.value));

    wrap.appendChild(lbl);
    wrap.appendChild(slider);
    return wrap;
  }

  panel.appendChild(makeSlider('Container Width', containerWidth, 200, 700, 10));
  panel.appendChild(makeSlider('Line Height', lineHeight, 16, 48, 1));
  panel.appendChild(makeSlider('Font Size', fontSize, 10, 32, 1));
  panel.appendChild(makeSlider('Columns', columns, 1, 4, 1));

  return panel;
}

// --- Text input ---
function TextInput() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom: 24px;';

  const toggle = document.createElement('label');
  toggle.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 13px; color: #999; margin-bottom: 8px; cursor: pointer;';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = useCustomText();
  checkbox.onchange = () => useCustomText(checkbox.checked);
  toggle.appendChild(checkbox);
  toggle.appendChild(document.createTextNode('Use custom text'));
  wrap.appendChild(toggle);

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Type or paste your own text here...';
  textarea.style.cssText = 'width: 100%; min-height: 80px; padding: 12px; font-size: 14px; border: 1px solid #333; border-radius: 8px; background: #111; color: #e0e0e0; resize: vertical; font-family: inherit;';
  textarea.value = customText();
  textarea.oninput = () => customText(textarea.value);

  effect(() => { textarea.style.display = useCustomText() ? 'block' : 'none'; });

  wrap.appendChild(textarea);
  return wrap;
}

// --- Tab navigation ---
function Tabs() {
  const nav = document.createElement('div');
  nav.style.cssText = 'display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid #333; padding-bottom: 0;';

  const tabs = [
    { id: 'reflow', label: 'Live Reflow' },
    { id: 'canvas', label: 'Canvas Render' },
    { id: 'svg', label: 'SVG Render' },
    { id: 'perf', label: 'Performance' },
  ];

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.style.cssText = 'padding: 8px 16px; border: none; background: none; color: #999; cursor: pointer; font-size: 14px; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s;';
    btn.onclick = () => activeDemo(tab.id);
    effect(() => {
      const active = activeDemo() === tab.id;
      btn.style.color = active ? '#e0e0e0' : '#666';
      btn.style.borderBottomColor = active ? '#2563eb' : 'transparent';
    });
    nav.appendChild(btn);
  }

  return nav;
}

// --- Main page ---
export function PretextDemo() {
  const page = document.createElement('div');
  page.style.cssText = 'max-width: 780px; margin: 0 auto; padding: 32px 16px;';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom: 32px;';
  header.innerHTML = `
    <h1 style="font-size: 28px; font-weight: 700; color: #e0e0e0; margin: 0 0 8px;">Pretext Integration</h1>
    <p style="color: #888; font-size: 15px; margin: 0 0 4px;">DOM-free text measurement + layout powered by <a href="https://github.com/chenglou/pretext" style="color: #60a5fa;">@chenglou/pretext</a></p>
    <p style="color: #555; font-size: 13px; margin: 0;"><span style="background: #1e3a5f; color: #60a5fa; padding: 2px 6px; border-radius: 3px; font-size: 11px;">ALPHA</span> Text measurement without browser reflow — pure arithmetic after initial font probing</p>
  `;
  page.appendChild(header);
  page.appendChild(Controls());
  page.appendChild(TextInput());
  page.appendChild(Tabs());

  // Demo container
  const demoArea = document.createElement('div');

  const reflowDemo = ReflowDemo();
  const canvasDemo = CanvasTextDemo();
  const svgDemo = SVGTextDemo();
  const perfDemo = PerfDemo();

  demoArea.appendChild(reflowDemo);
  demoArea.appendChild(canvasDemo);
  demoArea.appendChild(svgDemo);
  demoArea.appendChild(perfDemo);

  effect(() => {
    const active = activeDemo();
    reflowDemo.style.display = active === 'reflow' ? 'block' : 'none';
    canvasDemo.style.display = active === 'canvas' ? 'block' : 'none';
    svgDemo.style.display = active === 'svg' ? 'block' : 'none';
    perfDemo.style.display = active === 'perf' ? 'block' : 'none';
  });

  page.appendChild(demoArea);

  return page;
}
