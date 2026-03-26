// Data Table — sortable, filterable table with pagination
// Demonstrates: computed chains, signal-driven class toggling, pagination controls
//
// Note: Table elements (th, tr, td) are inlined rather than wrapped in
// sub-components, because the framework wraps components in <span display:contents>
// which is invalid inside <table>/<thead>/<tbody>/<tr>.

import {
  paginated, sortColumn, sortDirection, setSort,
  clampedPage, totalPages, totalFiltered, itemsPerPage, goToPage,
} from './store.js';

function formatDate(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatAmount(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function sortIcon(col) {
  if (sortColumn() !== col) return '\u2195';
  return sortDirection() === 'asc' ? '\u2191' : '\u2193';
}

export default function DataTable() {
  return (
    <div class="table-container">
      <div class="data-table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class={() => sortColumn() === 'name' ? 'sorted' : ''} onClick={() => setSort('name')}>
                Name <span class="sort-icon">{() => sortIcon('name')}</span>
              </th>
              <th class={() => sortColumn() === 'email' ? 'sorted' : ''} onClick={() => setSort('email')}>
                Email <span class="sort-icon">{() => sortIcon('email')}</span>
              </th>
              <th class={() => sortColumn() === 'amount' ? 'sorted' : ''} onClick={() => setSort('amount')}>
                Amount <span class="sort-icon">{() => sortIcon('amount')}</span>
              </th>
              <th class={() => sortColumn() === 'status' ? 'sorted' : ''} onClick={() => setSort('status')}>
                Status <span class="sort-icon">{() => sortIcon('status')}</span>
              </th>
              <th class={() => sortColumn() === 'date' ? 'sorted' : ''} onClick={() => setSort('date')}>
                Date <span class="sort-icon">{() => sortIcon('date')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {() => {
              const rows = paginated();
              if (rows.length === 0) {
                return (
                  <tr>
                    <td colspan="5" style="text-align: center; padding: 32px; color: var(--text-muted);">
                      No records match your filters.
                    </td>
                  </tr>
                );
              }
              return rows.map(row => (
                <tr key={row.id}>
                  <td class="cell-name">{row.name}</td>
                  <td class="cell-email">{row.email}</td>
                  <td class="cell-amount">{formatAmount(row.amount)}</td>
                  <td>
                    <span class={`status-badge status-${row.status}`}>{row.status}</span>
                  </td>
                  <td class="cell-date">{formatDate(row.date)}</td>
                </tr>
              ));
            }}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span class="pagination-info">
          {() => {
            const p = clampedPage();
            const perPage = itemsPerPage();
            const filtered = totalFiltered();
            const start = filtered > 0 ? (p - 1) * perPage + 1 : 0;
            const end = Math.min(p * perPage, filtered);
            return `Showing ${start}-${end} of ${filtered}`;
          }}
        </span>
        <div class="pagination-controls">
          <button
            class={() => `page-btn ${clampedPage() <= 1 ? 'disabled' : ''}`}
            onClick={() => { if (clampedPage() > 1) goToPage(clampedPage() - 1); }}
          >
            Prev
          </button>
          {() => {
            const page = clampedPage();
            const max = totalPages();
            const pages = [];
            if (max <= 7) {
              for (let i = 1; i <= max; i++) pages.push(i);
            } else {
              pages.push(1);
              if (page > 3) pages.push('...');
              const start = Math.max(2, page - 1);
              const end = Math.min(max - 1, page + 1);
              for (let i = start; i <= end; i++) pages.push(i);
              if (page < max - 2) pages.push('...');
              pages.push(max);
            }
            return pages.map(p => {
              if (p === '...') {
                return <span class="page-btn" style="cursor: default; border: none;">&hellip;</span>;
              }
              return (
                <button
                  class={page === p ? 'page-btn active' : 'page-btn'}
                  onClick={() => goToPage(p)}
                >
                  {p}
                </button>
              );
            });
          }}
          <button
            class={() => `page-btn ${clampedPage() >= totalPages() ? 'disabled' : ''}`}
            onClick={() => { if (clampedPage() < totalPages()) goToPage(clampedPage() + 1); }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
