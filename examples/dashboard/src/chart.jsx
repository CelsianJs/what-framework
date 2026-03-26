// Charts — SVG bar chart and sparkline rendered with reactive data
// Demonstrates: SVG rendering via imperative DOM updates, computed data bindings

import { useEffect } from 'what-framework';
import { chartData, sparklineData } from './store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BAR_COLORS = {
  active: '#22c55e',
  inactive: '#64748b',
  pending: '#f59e0b',
  cancelled: '#ef4444',
};

function formatK(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function svgEl(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child) {
      el.appendChild(child);
    }
  }
  return el;
}

function BarChart() {
  const width = 460;
  const height = 220;
  const pLeft = 60, pTop = 20, pRight = 20, pBottom = 40;
  const chartW = width - pLeft - pRight;
  const chartH = height - pTop - pBottom;

  // Build initial SVG content synchronously using the SVG namespace
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('viewBox', '0 0 460 220');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  function renderBars() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const bars = chartData();
    const maxVal = Math.max(...bars.map(b => b.value), 1);
    const barWidth = chartW / bars.length - 16;

    bars.forEach((bar, i) => {
      const x = pLeft + i * (chartW / bars.length) + 8;
      const barH = (bar.value / maxVal) * chartH;
      const y = pTop + chartH - barH;

      const g = svgEl('g');
      g.appendChild(svgEl('rect', {
        class: 'bar-rect',
        x, y, width: barWidth, height: barH, rx: 4,
        fill: BAR_COLORS[bar.label] || '#6366f1',
      }));
      g.appendChild(svgEl('text', {
        class: 'chart-value',
        x: x + barWidth / 2, y: y - 6,
        'text-anchor': 'middle',
      }, formatK(bar.value)));
      g.appendChild(svgEl('text', {
        class: 'chart-label',
        x: x + barWidth / 2, y: height - 10,
        'text-anchor': 'middle',
      }, bar.label));
      svg.appendChild(g);
    });

    // Y-axis
    svg.appendChild(svgEl('line', {
      x1: pLeft, y1: pTop, x2: pLeft, y2: pTop + chartH,
      stroke: 'var(--border)', 'stroke-width': 1,
    }));
    // X-axis
    svg.appendChild(svgEl('line', {
      x1: pLeft, y1: pTop + chartH, x2: pLeft + chartW, y2: pTop + chartH,
      stroke: 'var(--border)', 'stroke-width': 1,
    }));
  }

  // Render the chart reactively - useEffect auto-tracks chartData signal
  useEffect(() => {
    renderBars();
  });

  return (
    <div class="chart-card">
      <div class="chart-title">Revenue by Status</div>
      {svg}
    </div>
  );
}

function Sparkline() {
  const width = 460;
  const height = 220;
  const pLeft = 20, pTop = 20, pRight = 20, pBottom = 40;
  const chartW = width - pLeft - pRight;
  const chartH = height - pTop - pBottom;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('viewBox', '0 0 460 220');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  function renderSparkline() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const points = sparklineData();
    if (points.length === 0) return;

    const maxVal = Math.max(...points.map(p => p.value), 1);
    const stepX = chartW / (points.length - 1);

    const coords = points.map((p, i) => ({
      x: pLeft + i * stepX,
      y: pTop + chartH - (p.value / maxVal) * chartH,
    }));

    const linePath = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');

    const areaPath = linePath +
      ` L${coords[coords.length - 1].x.toFixed(1)},${(pTop + chartH).toFixed(1)}` +
      ` L${coords[0].x.toFixed(1)},${(pTop + chartH).toFixed(1)} Z`;

    svg.appendChild(svgEl('path', { class: 'sparkline-area', d: areaPath }));
    svg.appendChild(svgEl('path', { class: 'sparkline-path', d: linePath }));

    coords.forEach(c => {
      svg.appendChild(svgEl('circle', { class: 'sparkline-dot', cx: c.x.toFixed(1), cy: c.y.toFixed(1), r: 3 }));
    });

    points.forEach((p, i) => {
      svg.appendChild(svgEl('text', {
        class: 'sparkline-label',
        x: (pLeft + i * stepX).toFixed(1), y: height - 10,
        'text-anchor': 'middle',
      }, p.label));
    });
  }

  useEffect(() => {
    renderSparkline();
  });

  return (
    <div class="chart-card">
      <div class="chart-title">Monthly Revenue Trend</div>
      {svg}
    </div>
  );
}

export default function Charts() {
  return (
    <div class="charts-grid">
      <BarChart />
      <Sparkline />
    </div>
  );
}
