// The error budget left, as a needle that springs to each new reading. A
// reading can land while the needle is still moving to the last one.

import { onCleanup, signal } from 'what-framework';
import { useAnimatedValue } from 'what-framework/motion';

import { handles } from './probes.js';

export function Gauge() {
  const needle = useAnimatedValue(50);
  const live = signal(true);
  const aim = (to) => needle.spring(to, { stiffness: 120, damping: 12 });
  handles.gauge = { aim, value: () => needle.value(), live };

  let n = 0;
  const timer = setInterval(() => {
    if (live.peek()) aim(20 + ((n++ * 37) % 70));
  }, 1200);
  onCleanup(() => clearInterval(timer));

  const angle = () => Math.PI * (1 - needle.value() / 100);
  return (
    <section class="gauge">
      <h2>Error budget left</h2>
      <svg viewBox="0 0 120 70">
        <path class="arc" d="M10 62 A50 50 0 0 1 110 62" />
        <line class="needle" x1="60" y1="62" x2={60 + 46 * Math.cos(angle())} y2={62 - 46 * Math.sin(angle())} data-needle />
      </svg>
      <p class="big"><span data-gauge-value>{Math.round(needle.value())}</span>%</p>
    </section>
  );
}
