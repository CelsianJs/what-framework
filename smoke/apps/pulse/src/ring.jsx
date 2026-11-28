// A refresh ring that fills over 600 ms. Pressing Refresh again while it
// fills starts it over.

import { signal } from 'what-framework';
import { easings, useTween } from 'what-framework/motion';

import { handles, probes } from './probes.js';

const C = 2 * Math.PI * 26;

export function RefreshRing() {
  const tween = useTween({ duration: 600, easing: easings.easeInOutQuad });
  const refreshed = signal(0);
  const refresh = () => {
    probes.ringStarts++;
    tween.start(() => {
      probes.ringDone++;
      refreshed((n) => n + 1);
    });
  };
  handles.ring = { progress: () => tween.progress(), busy: () => tween.isTransitioning(), refreshed: () => refreshed() };

  return (
    <section class="ring">
      <h2>Data</h2>
      <svg viewBox="0 0 64 64">
        <circle class="track" cx="32" cy="32" r="26" />
        <circle class="fill" cx="32" cy="32" r="26" stroke-dasharray={C} stroke-dashoffset={C * (1 - tween.progress())} data-ring />
      </svg>
      <button data-refresh onClick={refresh} aria-busy={tween.isTransitioning() ? 'true' : 'false'}>Refresh</button>
      <p class="muted">Refreshed <span data-refreshed>{refreshed()}</span> times</p>
    </section>
  );
}
