// Reports: the slow route.
//
// ReportsSkeleton is wired as the route's `loading:` component. The router shows
// it while a navigation is IN FLIGHT, and main.jsx holds that window open with
// an async beforeNavigate hook that awaits computeRollup(). Without that hook
// the loading arm is unreachable in practice: isNavigating flips true and false
// inside one synchronous block and effects flush on a microtask, so no frame
// ever paints the skeleton.

import { rollup, ROLLUP_MS } from '../state/reports.js';
import { formatMoney } from '../data.js';

export function ReportsSkeleton() {
  return (
    <div class="card" data-reports-loading>
      <div class="card-head">
        <h2>Recomputing regional rollup</h2>
        <span class="muted mono">~{String(ROLLUP_MS)}ms</span>
      </div>
      <div class="skeleton-row" style="width:82%" />
      <div class="skeleton-row" style="width:64%" />
      <div class="skeleton-row" style="width:73%" />
      <div class="skeleton-row" style="width:48%" />
    </div>
  );
}

export default function Reports() {
  return (
    <>
      <div class="page-head">
        <div>
          <h1>Reports</h1>
          <p>Regional rollup, recomputed on every visit.</p>
        </div>
      </div>

      <div class="card" data-reports>
        <div class="card-head">
          <h2>Revenue by region</h2>
          <span class="muted mono" data-report-stamp>{() => `computed ${rollup()?.computedAt ?? '--'}`}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Region</th>
              <th class="num">Orders</th>
              <th class="num">Revenue</th>
            </tr>
          </thead>
          <tbody data-report-body>
            {() => (rollup()?.rows ?? []).map((r) => (
              <tr key={r.region} data-region={r.region}>
                <td>{r.region}</td>
                <td class="num">{String(r.orders)}</td>
                <td class="num">{formatMoney(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
