// A detail panel that opens on a spring. It can be closed while it is still
// opening, which unmounts it mid-animation.

import { onCleanup, signal } from 'what-framework';
import { spring } from 'what-framework/motion';

import { handles, probes } from './probes.js';

function Detail() {
  probes.panelsLive++;
  onCleanup(() => { probes.panelsLive--; });
  const height = spring(0, { stiffness: 200, damping: 20 });
  height.set(140);
  return (
    <div class="detail" data-detail style={`height:${height.current().toFixed(1)}px`}>
      <p>us-east-1 · 14 instances · deploy 2f9c1a</p>
      <p class="muted">p50 41 ms · p99 118 ms · error rate 0.08%</p>
    </div>
  );
}

export function Panel() {
  const open = signal(false);
  handles.panel = { toggle: () => open((o) => !o), open: () => open() };
  return (
    <section class="panel">
      <h2>Region <button data-toggle onClick={() => open((o) => !o)}>{open() ? 'Hide' : 'Show'} detail</button></h2>
      {open() ? <Detail /> : null}
    </section>
  );
}
