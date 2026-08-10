// The reports rollup is recomputed on every visit, which is what makes
// /reports a genuinely slow route.
//
// The latency lives here rather than inside the page because the router can
// only show a route's `loading:` component while a navigation is IN FLIGHT.
// A page that renders instantly and then fetches would never reach that arm:
// isNavigating flips true and false inside one synchronous block, and effects
// flush on a microtask, so nothing ever paints. main.jsx holds the navigation
// open with an async beforeNavigate hook that awaits this.

import { signal } from 'what-framework';
import { ORDERS } from '../data.js';

export const ROLLUP_MS = 700;

export const rollup = signal(null, 'reports:rollup');

export function computeRollup() {
  return new Promise((resolve) => {
    setTimeout(() => {
      const byRegion = {};
      for (const o of ORDERS) {
        byRegion[o.region] ??= { region: o.region, orders: 0, revenue: 0 };
        byRegion[o.region].orders += 1;
        if (o.status !== 'refunded') byRegion[o.region].revenue += o.total;
      }
      const rows = Object.values(byRegion).sort((a, b) => b.revenue - a.revenue);
      rollup({ rows, computedAt: new Date().toISOString().slice(11, 19) });
      resolve(rows);
    }, ROLLUP_MS);
  });
}
