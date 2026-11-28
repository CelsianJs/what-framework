// Request latency, redrawn every animation frame: a line of the last 120
// samples and bars for the last 24, all from one signal written once a
// frame. The alert threshold is a handle dragged with the pointer; the line
// it draws follows a spring toward wherever the pointer is.

import { onCleanup, signal } from 'what-framework';
import { spring } from 'what-framework/motion';

import { handles, probes } from './probes.js';

const W = 600;
const H = 160;
const POINTS = 120;
const BARS = 24;

// A latency trace: a slow wave, a faster ripple and a spike now and then.
function sample(t) {
  const spike = t % 97 < 3 ? 40 : 0;
  return 60 + 25 * Math.sin(t / 23) + 9 * Math.sin(t / 3.7) + spike;
}

const yOf = (ms) => H - 10 - ms * 0.6;
const msOf = (y) => Math.round((H - 10 - y) / 0.6);
const clampY = (y) => Math.min(H - 10, Math.max(10, y));

export function Chart() {
  let t = POINTS;
  const samples = signal(Array.from({ length: POINTS }, (_, i) => sample(i)));
  let frame = requestAnimationFrame(function step() {
    t++;
    samples((s) => {
      const next = s.slice(1);
      next.push(sample(t));
      return next;
    });
    probes.chartFrames++;
    frame = requestAnimationFrame(step);
  });
  onCleanup(() => cancelAnimationFrame(frame));

  const threshold = spring(yOf(110), { stiffness: 260, damping: 26 });
  handles.threshold = {
    target: () => msOf(threshold.target()),
    shown: () => msOf(threshold.current()),
    moving: () => threshold.isAnimating(),
  };

  let svg = null;
  let dragging = false;
  const follow = (e) => {
    const r = svg.getBoundingClientRect();
    threshold.set(clampY(((e.clientY - r.top) / r.height) * H));
  };

  const line = () => samples().map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (POINTS - 1)) * W).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');
  const over = () => samples().filter((v) => yOf(v) < threshold.current()).length;

  return (
    <figure class="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        data-chart
        ref={(el) => { svg = el; }}
        onPointerMove={(e) => { if (dragging) follow(e); }}
        onPointerUp={() => { dragging = false; }}
      >
        <path class="trace" d={line()} data-line />
        {Array.from({ length: BARS }, (_, i) => (
          <rect class="bar" x={W - (BARS - i) * 12} width="8" y={yOf(samples()[POINTS - BARS + i])} height={H - yOf(samples()[POINTS - BARS + i])} data-bar />
        ))}
        <line class="threshold" x1="0" x2={W} y1={threshold.current()} y2={threshold.current()} data-threshold />
        <circle
          class="handle"
          cx={W - 20}
          cy={threshold.current()}
          r="9"
          data-handle
          onPointerDown={(e) => { dragging = true; svg.setPointerCapture(e.pointerId); follow(e); }}
        />
      </svg>
      <figcaption>
        Alert above <b data-threshold-value>{msOf(threshold.current())}</b> ms ·{' '}
        <span data-over>{over()}</span> of the last {POINTS} samples over it
      </figcaption>
    </figure>
  );
}
