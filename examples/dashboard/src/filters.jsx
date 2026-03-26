// Filters — search input + status dropdown that filter the table reactively
// Demonstrates: controlled inputs, useEffect for debouncing, signal-based filtering

import { useSignal, useEffect, useRef } from 'what-framework';
import { statusFilter, setSearch, setStatusFilter, totalFiltered, data } from './store.js';

export default function Filters() {
  // Local signal for debounced search input
  const localSearch = useSignal('');

  // Debounce: update the store search after 200ms of idle typing
  useEffect(() => {
    const value = localSearch();
    const timer = setTimeout(() => {
      setSearch(value);
    }, 200);
    return () => clearTimeout(timer);
  });

  return (
    <div class="filters">
      <div class="filter-input-wrapper">
        <span class="filter-icon">&#128269;</span>
        <input
          class="filter-input"
          type="text"
          placeholder="Search by name or email..."
          onInput={e => localSearch.set(e.target.value)}
        />
      </div>

      <select
        class="filter-select"
        onChange={e => setStatusFilter(e.target.value)}
      >
        <option value="all">All Statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="pending">Pending</option>
        <option value="cancelled">Cancelled</option>
      </select>

      <span class="filter-badge">
        {() => `${totalFiltered()} of ${data().length}`}
      </span>
    </div>
  );
}
