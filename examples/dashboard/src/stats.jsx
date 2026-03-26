// Stats Cards — computed stat values that update when filters change
// Demonstrates: useComputed, reactive text content via signal functions

import { stats, totalFiltered, data } from './store.js';

function formatCurrency(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Stats() {
  return (
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Records</div>
        <div class="stat-value primary">{() => totalFiltered().toLocaleString()}</div>
        <div class="stat-detail">{() => `of ${data().length.toLocaleString()} total`}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Total Amount</div>
        <div class="stat-value success">{() => formatCurrency(stats().sum)}</div>
        <div class="stat-detail">{() => `Avg: ${formatCurrency(stats().avg)}`}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Active</div>
        <div class="stat-value" style="color: var(--success)">{() => stats().active}</div>
        <div class="stat-detail">{() => {
          const s = stats();
          const pct = s.total > 0 ? Math.round((s.active / s.total) * 100) : 0;
          return `${pct}% of filtered`;
        }}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Pending</div>
        <div class="stat-value" style="color: var(--warning)">{() => stats().pending}</div>
        <div class="stat-detail">{() => {
          const s = stats();
          const pct = s.total > 0 ? Math.round((s.pending / s.total) * 100) : 0;
          return `${pct}% of filtered`;
        }}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Inactive</div>
        <div class="stat-value" style="color: var(--text-muted)">{() => stats().inactive}</div>
        <div class="stat-detail">{() => {
          const s = stats();
          const pct = s.total > 0 ? Math.round((s.inactive / s.total) * 100) : 0;
          return `${pct}% of filtered`;
        }}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Cancelled</div>
        <div class="stat-value" style="color: var(--danger)">{() => stats().cancelled}</div>
        <div class="stat-detail">{() => {
          const s = stats();
          const pct = s.total > 0 ? Math.round((s.cancelled / s.total) * 100) : 0;
          return `${pct}% of filtered`;
        }}</div>
      </div>
    </div>
  );
}
